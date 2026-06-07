import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  settings: [] as unknown[],
  character: [] as unknown[],
  chat: [] as unknown[],
  lorebook: [] as unknown[],
  promptTemplate: [] as unknown[],
  scriptDefinition: [] as unknown[],
}))

vi.mock('./settingsBridge.svelte', () => ({
  flushPendingServerBackedSettingsPatch: vi.fn((options: unknown) => {
    calls.settings.push(options)
  }),
}))

vi.mock('./characterBridge.svelte', () => ({
  flushPendingServerBackedCharacterPatches: vi.fn((options: unknown) => {
    calls.character.push(options)
  }),
}))

vi.mock('./chatBridge.svelte', () => ({
  flushPendingServerBackedChatPatches: vi.fn((options: unknown) => {
    calls.chat.push(options)
  }),
}))

vi.mock('./lorebookBridge.svelte', () => ({
  flushPendingServerBackedLorebookPatches: vi.fn((options: unknown) => {
    calls.lorebook.push(options)
  }),
}))

vi.mock('./promptTemplateBridge.svelte', () => ({
  flushPendingPromptTemplatePatches: vi.fn((options: unknown) => {
    calls.promptTemplate.push(options)
  }),
}))

vi.mock('./scriptDefinitionBridge.svelte', () => ({
  flushPendingServerBackedScriptDefinitionPatches: vi.fn((options: unknown) => {
    calls.scriptDefinition.push(options)
  }),
}))

import { flushAllPendingBridgePatches, startBridgePatchLifecycleFlush } from './bridgeFlush'

function allCallBuckets(): unknown[][] {
  return [
    calls.settings,
    calls.character,
    calls.chat,
    calls.lorebook,
    calls.promptTemplate,
    calls.scriptDefinition,
  ]
}

beforeEach(() => {
  for (const bucket of allCallBuckets()) bucket.length = 0
  Object.defineProperty(document, 'visibilityState', {
    value: 'visible',
    configurable: true,
  })
})

describe('flushAllPendingBridgePatches', () => {
  it('M8: aggregates every bridge flush hook', () => {
    flushAllPendingBridgePatches({ keepalive: true })

    for (const bucket of allCallBuckets()) {
      expect(bucket).toEqual([{ keepalive: true }])
    }
  })

  it('M8: pagehide and hidden visibility flush with keepalive until teardown', () => {
    const stop = startBridgePatchLifecycleFlush()

    window.dispatchEvent(new Event('pagehide'))
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))

    for (const bucket of allCallBuckets()) {
      expect(bucket).toEqual([{ keepalive: true }, { keepalive: true }])
    }

    stop()
    window.dispatchEvent(new Event('pagehide'))
    for (const bucket of allCallBuckets()) {
      expect(bucket).toHaveLength(2)
    }
  })
})
