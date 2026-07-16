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
    enableInputs: [] as Array<Record<string, unknown>>,
    failNextEnableTerminal: false,
    failNextPromptItemUpdateTransient: false,
    promptItemUpdateInputs: [] as Array<Record<string, unknown>>,
    replayInlineResults: [] as Array<Record<string, unknown>>,
    replayInlineInputs: [] as Array<{
      requests: Array<{ path?: string }>
      mutationId: string
      databaseLineage: string
    }>,
    networkOrder: [] as string[],
    ownerId: null as string | null,
    runTail: Promise.resolve() as Promise<unknown>,
  }
})

vi.mock('src/ts/server/commands', () => ({
  acknowledgeServerMutationReceipts: vi.fn(async () => true),
  canUseServerCommands: vi.fn(() => true),
  createPromptItemCommand: vi.fn(async (input: Record<string, unknown>) => ({
    status: 'ok',
    revision: Number(input.baseRevision) + 1,
  })),
  deletePromptItemCommand: vi.fn(async (input: Record<string, unknown>) => ({
    status: 'ok',
    revision: Number(input.baseRevision) + 1,
  })),
  settingsGroupForKey: vi.fn((key: string) => {
    if (key === 'guiHTML') return 'display'
    if (key === 'jsonSchemaEnabled' || key === 'mainPrompt') return 'prompt'
    return null
  }),
  enablePromptItemsCommand: vi.fn(async (input: Record<string, unknown>) => {
    botSettingsMocks.enableInputs.push(input)
    botSettingsMocks.networkOrder.push('toggle-live')
    if (botSettingsMocks.failNextEnableTerminal) {
      botSettingsMocks.failNextEnableTerminal = false
      return { status: 'error', error: 'stale owner', reason: 'stale-writer' }
    }
    return { status: 'ok', revision: Number(input.baseRevision) + 1 }
  }),
  peekCachedServerCommandRevision: vi.fn(() => 100),
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
  replayDurableMutationRequests: vi.fn(async () => ({ status: 'ok' })),
  replayDurableMutationRequestsInline: vi.fn(
    async (requests: Array<{ path?: string }>, mutationId: string, databaseLineage: string) => {
      botSettingsMocks.replayInlineInputs.push({ requests, mutationId, databaseLineage })
      botSettingsMocks.networkOrder.push(`replay:${requests[0]?.path}`)
      return botSettingsMocks.replayInlineResults.shift() ?? { status: 'ok' }
    },
  ),
  runServerCommandWithoutMutationReceipt: vi.fn(<T>(execute: () => Promise<T>) => execute()),
  runServerCommandWithMutationReceipt: vi.fn(<T>(execute: () => Promise<T>) => execute()),
  reorderPromptItemsCommand: vi.fn(async (input: Record<string, unknown>) => ({
    status: 'ok',
    revision: Number(input.baseRevision) + 1,
  })),
  updatePromptPresetCommand: vi.fn(async (input: Record<string, unknown>) => ({
    status: 'ok',
    revision: Number(input.baseRevision) + 1,
  })),
  updatePromptItemCommand: vi.fn(async (input: Record<string, unknown>) => {
    botSettingsMocks.promptItemUpdateInputs.push(input)
    botSettingsMocks.networkOrder.push('row-live')
    if (botSettingsMocks.failNextPromptItemUpdateTransient) {
      botSettingsMocks.failNextPromptItemUpdateTransient = false
      return { status: 'error', error: 'temporarily offline' }
    }
    return { status: 'ok', revision: Number(input.baseRevision) + 1 }
  }),
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
    capturePromptTemplateOwnerProjectionEpoch: vi.fn(() => 0),
    currentPromptTemplateOwnerId: vi.fn(() => botSettingsMocks.ownerId),
    ensurePromptTemplateHydrated: vi.fn(async () => true),
    hasPromptTemplateOwnerProjectionEpochChanged: vi.fn(() => false),
    isPromptTemplateHydrated: vi.fn(() => true),
    markPromptTemplateOwnerAcknowledgementTainted: vi.fn(),
    peekPromptTemplateOwnerRevision: vi.fn(() => 100),
    promptTemplateHydratedStore: readable(true),
  }
})

vi.mock('src/ts/promptPresetModelOverrides.svelte', () => ({
  createPromptPresetModelOverrideDraft: (_key: string, fallback: unknown) => ({ value: fallback }),
  currentPromptPresetModelOverrideValue: (_key: string, fallback: unknown) => fallback,
  mirrorPromptPresetModelOverrideField: vi.fn(() => false),
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
  beginPendingMutationDispatch,
  clearPendingMutationOutbox,
  listPendingMutations,
  preparePendingMutationOutbox,
  resetPendingMutationOutboxForTests,
} from 'src/ts/server/pendingMutationOutbox'
import { queuePromptItemProjectionUpdate } from 'src/ts/server/promptTemplateBridge.svelte'
import type { PromptItem } from 'src/ts/process/prompt'

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
  botSettingsMocks.enableInputs.length = 0
  botSettingsMocks.failNextEnableTerminal = false
  botSettingsMocks.failNextPromptItemUpdateTransient = false
  botSettingsMocks.promptItemUpdateInputs.length = 0
  botSettingsMocks.replayInlineResults.length = 0
  botSettingsMocks.replayInlineInputs.length = 0
  botSettingsMocks.networkOrder.length = 0
  botSettingsMocks.ownerId = null
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
    guiHTML: 'old renderer value',
    jsonSchemaEnabled: true,
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
  async function editPromptTextarea(label: string, value: string): Promise<void> {
    await tick()
    const textarea = Array.from(target.querySelectorAll<HTMLTextAreaElement>('textarea')).find(
      (candidate) => candidate.getAttribute('aria-label') === label,
    )
    expect(textarea).toBeTruthy()
    textarea!.value = value
    textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
  }

  async function editMainPrompt(value: string): Promise<void> {
    await editPromptTextarea(language.mainPrompt, value)
  }

  async function openOtherPromptSettings(): Promise<void> {
    const button = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(
      (candidate) => candidate.textContent?.trim() === language.others,
    )
    expect(button).toBeTruthy()
    button!.click()
    await tick()
    const promptTemplateAccordion = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(
      (candidate) => candidate.textContent?.trim() === language.promptTemplate,
    )
    expect(promptTemplateAccordion).toBeTruthy()
    promptTemplateAccordion!.click()
    await tick()
  }

  function promptTemplateToggle(): HTMLInputElement | undefined {
    return Array.from(target.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find(
      (candidate) => candidate.getAttribute('aria-label') === language.usePromptTemplate,
    )
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

  it('keeps a reverted Bot prompt field in the absolute closure while a sibling remains dirty', async () => {
    await editMainPrompt('temporary main prompt')
    await editPromptTextarea(language.jailbreakPrompt, 'final jailbreak')
    await editMainPrompt('old main prompt')

    expect(botSettingsMocks.patchInputs).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(250)
    await Promise.resolve()

    expect(botSettingsMocks.patchInputs).toEqual([
      expect.objectContaining({
        patch: {
          jailbreak: 'final jailbreak',
          mainPrompt: 'old main prompt',
        },
      }),
    ])
  })

  it('dispatches a Bot prompt correction immediately on a total revert', async () => {
    await editMainPrompt('temporary main prompt')
    await editMainPrompt('old main prompt')
    await Promise.resolve()

    expect(botSettingsMocks.patchInputs).toEqual([
      expect.objectContaining({ patch: { mainPrompt: 'old main prompt' } }),
    ])
    await vi.advanceTimersByTimeAsync(250)
    expect(botSettingsMocks.patchInputs).toHaveLength(1)
  })

  it('retains a remotely marked Bot prompt write ahead of its immediate baseline correction', async () => {
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
      let pending = await listPendingMutations()
      await vi.waitFor(async () => {
        pending = await listPendingMutations()
        expect(pending.map((entry) => entry.intent)).toEqual([
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
      expect(pending[0].handle.key).toBe('settings:bridge')
      await expect(beginPendingMutationDispatch(pending[0].handle)).resolves.toBe('persisted')

      const commandGate = botSettingsMocks.deferredResult()
      botSettingsMocks.runTail = commandGate.promise
      await editMainPrompt('old main prompt')
      await vi.waitFor(async () => {
        pending = await listPendingMutations()
        expect(pending).toHaveLength(2)
      })
      expect(botSettingsMocks.patchInputs).toEqual([])
      expect(pending.map((entry) => entry.handle.key)).toEqual(['settings:bridge', 'settings:bridge'])
      expect(pending.map((entry) => entry.intent.requests[0])).toEqual([
        {
          method: 'PATCH',
          path: '/settings/prompt',
          body: { patch: { mainPrompt: 'durable main prompt' } },
        },
        {
          method: 'PATCH',
          path: '/settings/prompt',
          body: { patch: { mainPrompt: 'old main prompt' } },
        },
      ])
      await clearPendingMutationOutbox()
      commandGate.resolve({ status: 'ok' })
      await botSettingsMocks.runTail
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
      vi.useFakeTimers()
    }
  })

  it('keeps a delayed prompt row ahead of disable across transient replay and recovery', async () => {
    vi.useRealTimers()
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-bot-toggle-order',
      writerEpoch: 8,
      databaseLineage: 'lineage-bot-toggle-order',
      requestedWriterWasActive: true,
    })

    if (component) {
      unmount(component)
      component = undefined
    }
    botSettingsMocks.ownerId = 'prompt-a'
    const originalRow = {
      id: 'row-a',
      type: 'plain',
      type2: 'normal',
      role: 'system',
      text: 'original row',
    } as PromptItem
    setDatabaseLite({
      aiModel: 'gpt35',
      subModel: 'gpt35',
      promptPresets: [{ id: 'prompt-a', name: 'Prompt A', promptTemplate: [originalRow] }],
      promptPresetsId: 0,
      promptTemplate: [originalRow],
      botPresets: [],
      useLegacyGUI: false,
      mainPrompt: 'old main prompt',
      guiHTML: 'old renderer value',
      jsonSchemaEnabled: true,
      jailbreak: 'old jailbreak',
      globalNote: 'old global note',
      formatingOrder: [],
    } as any)
    component = mount(BotSettings, { target, props: { settingsKind: 'prompt' } })

    try {
      await tick()
      await openOtherPromptSettings()
      let draftRows = [{ ...originalRow, text: 'edited row' }] as PromptItem[]
      queuePromptItemProjectionUpdate(
        {
          getItems: () => draftRows,
          setItems: (items) => {
            draftRows = items
          },
        },
        'row-a',
        originalRow,
        500,
        'prompt-a',
      )
      await vi.waitFor(async () => expect(await listPendingMutations()).toHaveLength(1))

      botSettingsMocks.failNextPromptItemUpdateTransient = true
      botSettingsMocks.replayInlineResults.push({ status: 'error', error: 'still offline' })
      let toggle = promptTemplateToggle()
      expect(toggle?.checked).toBe(true)
      toggle!.checked = false
      toggle!.dispatchEvent(new Event('change', { bubbles: true }))

      await vi.waitFor(async () => expect(await listPendingMutations()).toHaveLength(2))
      await botSettingsMocks.runTail
      await tick()

      let pending = await listPendingMutations()
      expect(pending.map((entry) => entry.handle.key)).toEqual([
        'prompt-template-owner:prompt-a',
        'prompt-template-owner:prompt-a',
      ])
      expect(pending.map((entry) => entry.intent.requests[0])).toEqual([
        {
          method: 'PATCH',
          path: '/prompt-items/row-a',
          body: { promptPresetId: 'prompt-a', patch: { text: 'edited row' } },
        },
        {
          method: 'POST',
          path: '/prompt-items/enable',
          body: { promptPresetId: 'prompt-a', enabled: false },
        },
      ])
      expect(botSettingsMocks.networkOrder).toEqual(['row-live', 'replay:/prompt-items/row-a'])
      expect(botSettingsMocks.enableInputs).toEqual([])
      expect(getDatabase().promptPresets[0]).toHaveProperty('promptTemplate')

      toggle = promptTemplateToggle()
      expect(toggle?.checked).toBe(true)
      toggle!.checked = false
      toggle!.dispatchEvent(new Event('change', { bubbles: true }))

      await vi.waitFor(() => expect(botSettingsMocks.enableInputs).toHaveLength(1))
      await botSettingsMocks.runTail
      await vi.waitFor(async () => expect(await listPendingMutations()).toEqual([]))
      pending = await listPendingMutations()
      expect(pending).toEqual([])
      expect(botSettingsMocks.networkOrder).toEqual([
        'row-live',
        'replay:/prompt-items/row-a',
        'replay:/prompt-items/row-a',
        'replay:/prompt-items/enable',
        'toggle-live',
      ])
      await tick()
      expect(getDatabase().promptPresets[0].promptTemplate).toBeUndefined()
      expect(promptTemplateToggle()?.checked).toBe(false)
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
      botSettingsMocks.ownerId = null
      vi.useFakeTimers()
    }
  })

  it('rolls back a disabled prompt template and discards its terminal durable mutation', async () => {
    vi.useRealTimers()
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-bot-toggle-terminal',
      writerEpoch: 7,
      databaseLineage: 'lineage-bot-toggle-terminal',
      requestedWriterWasActive: true,
    })

    if (component) {
      unmount(component)
      component = undefined
    }
    botSettingsMocks.ownerId = 'prompt-a'
    const originalTemplate = [{ id: 'row-a', type: 'plain', type2: 'normal', role: 'system', text: 'retained' }]
    setDatabaseLite({
      aiModel: 'gpt35',
      subModel: 'gpt35',
      promptPresets: [{ id: 'prompt-a', name: 'Prompt A', promptTemplate: originalTemplate }],
      promptPresetsId: 0,
      promptTemplate: originalTemplate,
      botPresets: [],
      useLegacyGUI: false,
      mainPrompt: 'old main prompt',
      guiHTML: 'old renderer value',
      jsonSchemaEnabled: true,
      jailbreak: 'old jailbreak',
      globalNote: 'old global note',
      formatingOrder: [],
    } as any)
    component = mount(BotSettings, { target, props: { settingsKind: 'prompt' } })

    try {
      await tick()
      await openOtherPromptSettings()
      const toggle = promptTemplateToggle()
      expect(toggle?.checked).toBe(true)

      botSettingsMocks.failNextEnableTerminal = true
      toggle!.checked = false
      toggle!.dispatchEvent(new Event('change', { bubbles: true }))

      await vi.waitFor(() => expect(botSettingsMocks.enableInputs).toHaveLength(1))
      await botSettingsMocks.runTail
      await tick()

      expect(botSettingsMocks.enableInputs[0]).toMatchObject({
        promptPresetId: 'prompt-a',
        enabled: false,
      })
      expect(getDatabase().promptPresets[0].promptTemplate).toEqual(originalTemplate)
      expect(getDatabase().promptTemplate).toEqual(originalTemplate)
      expect(promptTemplateToggle()?.checked).toBe(true)
      await vi.waitFor(async () => expect(await listPendingMutations()).toEqual([]))
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
      botSettingsMocks.ownerId = null
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
