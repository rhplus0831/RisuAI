import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const botSettingsMocks = vi.hoisted(() => ({
  patchInputs: [] as Array<Record<string, unknown>>,
  patchTransportOptions: [] as Array<{ signal?: AbortSignal | null; keepalive?: boolean }>,
  runInputs: [] as Array<{ signal?: AbortSignal | null; keepalive?: boolean }>,
}))

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
      return { status: 'ok', revision: Number(input.baseRevision) + 1 }
    },
  ),
  runServerCommand: vi.fn(
    async (input: {
      command: (baseRevision: number) => Promise<Record<string, unknown>>
      signal?: AbortSignal | null
      keepalive?: boolean
    }) => {
      botSettingsMocks.runInputs.push({ signal: input.signal, keepalive: input.keepalive })
      return input.command(100)
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
import { setDatabaseLite } from 'src/ts/storage/database.svelte'
import { flushRegisteredPendingBridgePatches } from 'src/ts/server/pendingBridgeFlushRegistry'
import { resetServerResourceState } from 'src/ts/server/resourceState.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

beforeEach(() => {
  vi.useFakeTimers()
  botSettingsMocks.patchInputs.length = 0
  botSettingsMocks.patchTransportOptions.length = 0
  botSettingsMocks.runInputs.length = 0
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
  it('flushes a pending prompt edit with keepalive through the lifecycle registry', async () => {
    await tick()
    const textarea = Array.from(target.querySelectorAll<HTMLTextAreaElement>('textarea')).find(
      (candidate) => candidate.getAttribute('aria-label') === language.mainPrompt,
    )
    expect(textarea).toBeTruthy()

    textarea!.value = 'draft before pagehide'
    textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

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
})
