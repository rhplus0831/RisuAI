// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { selectedCharID } from '../../stores.svelte'
import { charactersResourceState } from '../../server/resourceState.svelte'

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
})

describe('applyChatTemplate character owner', () => {
  it('uses the unique ready character owner for risu_char', () => {
    expect(applyChatTemplate([], { type: 'jinja', custom: '{{ risu_char }}' })).toBe('Canonical character')
  })

  it('falls back to the aggregate character only before owners are ready', () => {
    charactersResourceState.status = 'loading'

    expect(applyChatTemplate([], { type: 'jinja', custom: '{{ risu_char }}' })).toBe('Aggregate character')
  })

  it.each([
    ['missing', []],
    ['duplicate', [owner('First'), owner('Second')]],
  ])('fails closed for a %s ready owner', (_label, characters) => {
    charactersResourceState.characters = characters as never

    expect(applyChatTemplate([], { type: 'jinja', custom: '{{ risu_char }}' })).toBe('')
  })
})
