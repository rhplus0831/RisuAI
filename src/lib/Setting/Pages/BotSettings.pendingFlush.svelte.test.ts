import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

const botSettingsMocks = vi.hoisted(() => {
  function deferredResult() {
    let resolve!: (value: Record<string, unknown>) => void
    const promise = new Promise<Record<string, unknown>>((resolvePromise) => {
      resolve = resolvePromise
    })
    return { promise, resolve }
  }
  return {
    patchInputs: [] as Array<Record<string, unknown>>,
    patchTransportOptions: [] as Array<{ signal?: AbortSignal | null; keepalive?: boolean }>,
    runInputs: [] as Array<{ signal?: AbortSignal | null; keepalive?: boolean }>,
    failNextPatch: false,
    deferNextPatch: false,
    deferredPatchResults: [] as Array<ReturnType<typeof deferredResult>>,
    deferredResult,
    runTail: Promise.resolve() as Promise<unknown>,
  }
})

vi.mock('src/ts/server/commands', () => ({
  canUseServerCommands: vi.fn(() => true),
  enablePromptItemsCommand: vi.fn(async () => ({ status: 'ok' })),
  patchPromptSettingsCommand: vi.fn(
    async (
      input: Record<string, unknown>,
      signal?: AbortSignal | null,
      keepalive?: boolean,
    ): Promise<Record<string, unknown>> => {
      botSettingsMocks.patchInputs.push(input)
      botSettingsMocks.patchTransportOptions.push({ signal, keepalive })
      if (botSettingsMocks.deferNextPatch) {
        botSettingsMocks.deferNextPatch = false
        const deferred = botSettingsMocks.deferredResult()
        botSettingsMocks.deferredPatchResults.push(deferred)
        return deferred.promise
      }
      if (botSettingsMocks.failNextPatch) {
        botSettingsMocks.failNextPatch = false
        return { status: 'error', error: 'forced prompt patch failure' }
      }
      return { status: 'ok', revision: Number(input.baseRevision) + 1 }
    },
  ),
  runServerCommand: vi.fn(
    (input: {
      command: (baseRevision: number) => Promise<Record<string, unknown>>
      rollback?: () => void
      signal?: AbortSignal | null
      keepalive?: boolean
      executionWrapper?: (execute: () => Promise<Record<string, unknown>>) => Promise<Record<string, unknown>>
    }) => {
      botSettingsMocks.runInputs.push({ signal: input.signal, keepalive: input.keepalive })
      const execution = botSettingsMocks.runTail.then(async () => {
        const execute = () => input.command(100)
        const result = input.executionWrapper ? await input.executionWrapper(execute) : await execute()
        if (result.status !== 'ok') input.rollback?.()
        return result
      })
      botSettingsMocks.runTail = execution.then(
        () => undefined,
        () => undefined,
      )
      return execution
    },
  ),
}))

vi.mock('src/ts/server/settingsBridge.svelte', () => ({
  createServerBackedSettingDraft: (_key: string, fallback: unknown) => ({ value: fallback }),
  watchServerBackedSettings: vi.fn(() => vi.fn()),
}))

vi.mock('src/ts/server/commandLocalEffectEvents', () => ({
  subscribeServerCommandLocalEffectApplied: vi.fn(() => vi.fn()),
}))

vi.mock('src/ts/server/promptTemplateHydration', async () => {
  const { readable } = await import('svelte/store')
  return {
    currentPromptTemplateOwnerId: vi.fn(() => null),
    ensurePromptTemplateHydrated: vi.fn(async () => true),
    isPromptTemplateHydrated: vi.fn(() => true),
    promptTemplateHydratedStore: readable(true),
  }
})

vi.mock('src/ts/promptPresetModelOverrides.svelte', () => ({
  createPromptPresetModelOverrideDraft: (_key: string, fallback: unknown) => ({ value: fallback }),
  promptPresetModelOverrideEnabled: vi.fn(() => false),
  setPromptPresetModelOverrideEnabled: vi.fn(),
}))

vi.mock('src/ts/pluginCommands', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/pluginCommands')>()
  return {
    ...actual,
    currentPluginStateSnapshot: vi.fn(() => ({})),
    currentPluginWatchSuppressionVersion: vi.fn(() => 0),
    dispatchSelectPluginProvider: vi.fn(),
  }
})

vi.mock('src/ts/tokenizer', () => ({
  tokenizeAccurate: vi.fn(async () => 0),
  tokenizerList: [],
}))

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

vi.mock('src/lib/UI/GUI/TextAreaInput.svelte', async () => {
  const mock = await import('../../SideBars/AuthorNoteEditor.testTextArea.svelte')
  return { default: mock.default }
})

import BotSettings from './BotSettings.svelte'
import { language } from 'src/lang'
import { getDatabase, setDatabaseLite } from 'src/ts/storage/database.svelte'
import { flushRegisteredPendingBridgePatches } from 'src/ts/server/pendingBridgeFlushRegistry'
import { resetServerResourceState } from 'src/ts/server/resourceState.svelte'
import {
  clearPendingMutationOutbox,
  listPendingMutations,
  preparePendingMutationOutbox,
  resetPendingMutationOutboxForTests,
} from 'src/ts/server/pendingMutationOutbox'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

beforeEach(() => {
  vi.useFakeTimers()
  botSettingsMocks.patchInputs.length = 0
  botSettingsMocks.patchTransportOptions.length = 0
  botSettingsMocks.runInputs.length = 0
  botSettingsMocks.failNextPatch = false
  botSettingsMocks.deferNextPatch = false
  botSettingsMocks.deferredPatchResults.length = 0
  botSettingsMocks.runTail = Promise.resolve()
  resetServerResourceState()
  setDatabaseLite({
    aiModel: 'gpt35',
    subModel: 'gpt35',
    promptPresets: [],
    promptPresetsId: -1,
    botPresets: [],
    useLegacyGUI: false,
    mainPrompt: 'old main prompt',
    jailbreak: 'old jailbreak',
    globalNote: 'old global note',
    formatingOrder: [],
  } as any)
  target = document.createElement('div')
  document.body.appendChild(target)
  component = mount(BotSettings, { target, props: { settingsKind: 'prompt' } })
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  setDatabaseLite({} as any)
  target.remove()
  document.body.innerHTML = ''
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('BotSettings pending prompt persistence', () => {
  async function editMainPrompt(value: string): Promise<void> {
    await tick()
    const textarea = Array.from(target.querySelectorAll<HTMLTextAreaElement>('textarea')).find(
      (candidate) => candidate.getAttribute('aria-label') === language.mainPrompt,
    )
    expect(textarea).toBeTruthy()
    textarea!.value = value
    textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
  }

  it('flushes a pending prompt edit with keepalive through the lifecycle registry', async () => {
    await editMainPrompt('draft before pagehide')

    expect(botSettingsMocks.patchInputs).toHaveLength(0)

    flushRegisteredPendingBridgePatches({ keepalive: true })
    await Promise.resolve()

    expect(botSettingsMocks.patchInputs).toEqual([
      expect.objectContaining({
        baseRevision: 100,
        patch: { mainPrompt: 'draft before pagehide' },
      }),
    ])
    expect(botSettingsMocks.patchTransportOptions).toEqual([{ signal: undefined, keepalive: true }])
    expect(botSettingsMocks.runInputs).toEqual([{ signal: undefined, keepalive: true }])

    await vi.advanceTimersByTimeAsync(250)
    expect(botSettingsMocks.patchInputs).toHaveLength(1)
  })

  it('persists the exact prompt settings PATCH at edit time and discards it on a net revert', async () => {
    vi.useRealTimers()
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-bot-prompt',
      writerEpoch: 6,
      databaseLineage: 'lineage-bot-prompt',
      requestedWriterWasActive: true,
    })

    try {
      await editMainPrompt('durable main prompt')
      await vi.waitFor(async () => {
        expect((await listPendingMutations()).map((entry) => entry.intent)).toEqual([
          {
            version: 1,
            requests: [
              {
                method: 'PATCH',
                path: '/settings/prompt',
                body: { patch: { mainPrompt: 'durable main prompt' } },
              },
            ],
          },
        ])
      })

      await editMainPrompt('old main prompt')
      await vi.waitFor(async () => expect(await listPendingMutations()).toEqual([]))
      expect(botSettingsMocks.patchInputs).toEqual([])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
      vi.useFakeTimers()
    }
  })

  it('rebases a queued prompt rollback when the earlier optimistic patch fails', async () => {
    botSettingsMocks.deferNextPatch = true
    await editMainPrompt('first optimistic prompt')
    await vi.advanceTimersByTimeAsync(250)
    expect(botSettingsMocks.patchInputs).toHaveLength(1)

    await editMainPrompt('second optimistic prompt')
    botSettingsMocks.failNextPatch = true
    await vi.advanceTimersByTimeAsync(250)
    expect(botSettingsMocks.patchInputs).toHaveLength(1)

    botSettingsMocks.deferredPatchResults.shift()?.resolve({ status: 'error', error: 'forced first failure' })
    for (let attempt = 0; attempt < 10 && botSettingsMocks.patchInputs.length < 2; attempt += 1) {
      await Promise.resolve()
    }
    await botSettingsMocks.runTail
    await tick()

    expect(botSettingsMocks.patchInputs).toHaveLength(2)
    expect(getDatabase().mainPrompt).toBe('old main prompt')
  })
})
