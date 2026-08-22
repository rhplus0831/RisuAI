import { describe, expect, it } from 'vitest'
import type { Chat, Database } from './storage/database.svelte'
import { resolveEffectivePersonaId, resolvePersonaModuleIds } from './personaModuleLinks'

function database(): Database {
  return {
    selectedPersona: 0,
    personas: [
      { id: 'persona-global', name: 'Global', icon: '', personaPrompt: '', modules: ['module-a'] },
      {
        id: 'persona-chat',
        name: 'Chat',
        icon: '',
        personaPrompt: '',
        modules: ['module-b', 'module-b', ''],
      },
    ],
  } as Database
}

function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    message: [],
    note: '',
    name: 'Chat',
    localLore: [],
    ...overrides,
  } as Chat
}

describe('Persona module links', () => {
  it('uses chat generation settings before the legacy and global Persona selections', () => {
    const db = database()
    const current = chat({
      generationSettings: { personaId: 'persona-chat' },
      bindedPersona: 'persona-global',
    })

    expect(resolveEffectivePersonaId(db, current)).toBe('persona-chat')
    expect(resolvePersonaModuleIds(db, current)).toEqual(['module-b'])
  })

  it('falls back through the legacy chat binding to the global Persona', () => {
    const db = database()

    expect(resolvePersonaModuleIds(db, chat({ bindedPersona: 'persona-chat' }))).toEqual(['module-b'])
    expect(resolvePersonaModuleIds(db, chat())).toEqual(['module-a'])
  })

  it('ignores missing Persona references and malformed link values', () => {
    const db = database()
    ;(db.personas[1] as unknown as { modules: unknown }).modules = ['module-b', null, 3]

    expect(resolvePersonaModuleIds(db, chat({ generationSettings: { personaId: 'missing' } }))).toEqual([])
    expect(resolvePersonaModuleIds(db, chat({ generationSettings: { personaId: 'persona-chat' } }))).toEqual([
      'module-b',
    ])
  })
})
