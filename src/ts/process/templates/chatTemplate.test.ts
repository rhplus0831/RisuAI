// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { selectedCharID } from '../../stores.svelte'
import { charactersResourceState, settingsResourceState } from '../../server/resourceState.svelte'

const databaseState = vi.hoisted(() => ({
  db: {
    characters: [
      {
        chaId: 'character-a',
        name: 'Aggregate character',
        chats: [{ id: 'chat-a', message: [] }],
        chatPage: 0,
      },
    ],
    personas: [],
    selectedPersona: -1,
    username: 'User',
    instructChatTemplate: 'jinja',
    JinjaTemplate: '{{ risu_char }}',
  },
}))

vi.mock('src/ts/storage/database.svelte', () => ({
  getDatabase: () => databaseState.db,
}))

import { applyChatTemplate } from './chatTemplate'

function owner(name: string) {
  return {
    chaId: 'character-a',
    name,
    chats: [{ id: 'chat-a', message: [] }],
    chatPage: 0,
  }
}

beforeEach(() => {
  selectedCharID.set(0)
  charactersResourceState.characters = [owner('Canonical character') as never]
  charactersResourceState.status = 'ready'
  settingsResourceState.value = {
    instructChatTemplate: 'jinja',
    JinjaTemplate: '{{ risu_char }}',
  }
  settingsResourceState.status = 'ready'
  settingsResourceState.groupStatuses.providers = 'ready'
})

describe('applyChatTemplate character owner', () => {
  it('uses the unique ready character owner for risu_char', () => {
    expect(applyChatTemplate([], { type: 'jinja', custom: '{{ risu_char }}' })).toBe('Canonical character')
  })

  it('falls back to the aggregate character only before owners are ready', () => {
    charactersResourceState.status = 'loading'

    expect(applyChatTemplate([], { type: 'jinja', custom: '{{ risu_char }}' })).toBe('Aggregate character')
  })

  it('uses the ready template-settings owner instead of aggregate settings', () => {
    databaseState.db.JinjaTemplate = 'aggregate template'
    settingsResourceState.value.JinjaTemplate = 'owner {{ risu_char }}'

    expect(applyChatTemplate([])).toBe('owner Canonical character')
  })

  it('allows explicit public template input but not stale owner settings after an error', () => {
    settingsResourceState.groupStatuses.providers = 'error'

    expect(applyChatTemplate([], { type: 'jinja', custom: 'explicit' })).toBe('explicit')
    expect(() => applyChatTemplate([])).toThrow('Template type is not set')
  })

  it.each([
    ['missing', []],
    ['duplicate', [owner('First'), owner('Second')]],
  ])('fails closed for a %s ready owner', (_label, characters) => {
    charactersResourceState.characters = characters as never

    expect(applyChatTemplate([], { type: 'jinja', custom: '{{ risu_char }}' })).toBe('')
  })
})
