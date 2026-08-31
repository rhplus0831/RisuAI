import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  settingsStatus: 'ready' as 'idle' | 'loading' | 'ready' | 'error',
  providerStatus: 'ready' as 'idle' | 'loading' | 'ready' | 'error',
  settings: {} as Record<string, unknown>,
}))

vi.mock('src/ts/server/resourceState.svelte', () => ({
  settingsResourceState: {
    get status() {
      return state.settingsStatus
    },
    get value() {
      return state.settings
    },
    groupStatuses: {
      get providers() {
        return state.providerStatus
      },
    },
  },
}))

vi.mock('src/ts/utilState', () => ({
  getUserName: () => 'Owner User',
}))

import { stringlizeNAIChat } from './nai'

beforeEach(() => {
  state.settingsStatus = 'ready'
  state.providerStatus = 'ready'
  state.settings = {
    NAIsettings: { seperator: '\\n---\\n', starter: '[START]' },
    NAIappendName: true,
    NAIadventure: true,
  }
})

describe('NovelAI chat serialization', () => {
  it('formats chat from the ready provider settings owner', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      expect(
        stringlizeNAIChat(
          [
            { role: 'system', content: '[Start a new chat]' },
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi' },
          ],
          'Character',
          false,
        ),
      ).toBe('[START]\n---\n> Owner User: Hello\n---\nCharacter: Hi\n---\nCharacter:')
    } finally {
      log.mockRestore()
    }
  })

  it.each(['idle', 'loading', 'error'] as const)('rejects a %s provider settings owner', (status) => {
    state.providerStatus = status

    expect(() => stringlizeNAIChat([], 'Character', false)).toThrow('NovelAI settings owner unavailable')
  })

  it('rejects the provider owner when the settings resource has failed', () => {
    state.settingsStatus = 'error'

    expect(() => stringlizeNAIChat([], 'Character', false)).toThrow('NovelAI settings owner unavailable')
  })
})
