import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DBState, selectedCharID } from './stores.svelte'
import {
  checkPersonaBinded,
  getPersonaPrompt,
  getUserDisplayName,
  getUserIcon,
  getUserIconProtrait,
  getUserName,
} from './util'

function seedPersonaDisplayState(chatPatch: Record<string, unknown>): void {
  selectedCharID.set(0)
  DBState.db = {
    selectedPersona: 1,
    username: 'Global Persona',
    userIcon: 'global.png',
    personaPrompt: 'global prompt',
    personas: [
      {
        id: 'chat-persona',
        name: 'Chat Persona',
        displayName: 'Visible Chat Persona',
        icon: 'chat.png',
        personaPrompt: 'chat prompt',
        note: '',
        largePortrait: true,
      },
      {
        id: 'global-persona',
        name: 'Global Persona',
        displayName: 'Visible Global Persona',
        icon: 'global.png',
        personaPrompt: 'global prompt',
        note: '',
        largePortrait: false,
      },
      {
        id: 'legacy-persona',
        name: 'Legacy Persona',
        icon: 'legacy.png',
        personaPrompt: 'legacy prompt',
        note: '',
        largePortrait: false,
      },
    ],
    characters: [
      {
        chaId: 'char-a',
        name: 'Character A',
        chatPage: 0,
        chats: [
          {
            id: 'chat-a',
            name: 'Chat A',
            message: [],
            note: '',
            localLore: [],
            ...chatPatch,
          },
        ],
      },
    ],
  } as never
}

beforeEach(() => {
  seedPersonaDisplayState({})
})

afterEach(() => {
  selectedCharID.set(-1)
  DBState.db = {} as never
})

describe('active chat persona display helpers', () => {
  it('uses the chat generation-settings persona before the global selected persona', () => {
    seedPersonaDisplayState({
      generationSettings: {
        configured: true,
        personaId: 'chat-persona',
        presetId: 'preset-a',
        jailbreakToggle: false,
        sidebarToggles: {},
      },
    })

    expect(checkPersonaBinded()?.id).toBe('chat-persona')
    expect(getUserName()).toBe('Chat Persona')
    expect(getUserDisplayName()).toBe('Visible Chat Persona')
    expect(getUserIcon()).toBe('chat.png')
    expect(getPersonaPrompt()).toBe('chat prompt')
    expect(getUserIconProtrait()).toBe(true)
  })

  it('falls back to legacy bindedPersona when generation settings have no persona', () => {
    seedPersonaDisplayState({
      bindedPersona: 'legacy-persona',
    })

    expect(checkPersonaBinded()?.id).toBe('legacy-persona')
    expect(getUserName()).toBe('Legacy Persona')
    expect(getUserDisplayName()).toBe('Legacy Persona')
    expect(getUserIcon()).toBe('legacy.png')
    expect(getPersonaPrompt()).toBe('legacy prompt')
    expect(getUserIconProtrait()).toBe(false)
  })

  it('uses the selected persona display name only for visible labels', () => {
    expect(getUserName()).toBe('Global Persona')
    expect(getUserDisplayName()).toBe('Visible Global Persona')
  })
})
