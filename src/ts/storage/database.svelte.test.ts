import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DBState } from '../stores.svelte'
import {
  mergeServerProjectionCharacterRow,
  setServerProjectionWriteGuardEnabled,
  type Database,
} from './database.svelte'

function seedDatabase(characters: Array<Record<string, unknown>>) {
  DBState.db = {
    characters,
    modules: [],
    personas: [],
    language: 'en',
  } as unknown as Database
}

beforeEach(() => {
  setServerProjectionWriteGuardEnabled(false)
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  DBState.db = {} as Database
})

describe('mergeServerProjectionCharacterRow', () => {
  it('L35: preserves hydrated hypaV3Data on message-empty chat stubs', () => {
    const hypaV3Data = {
      memories: [{ id: 'memory-1', text: 'remember this' }],
    }
    seedDatabase([
      {
        chaId: 'char-a',
        name: 'Ada',
        chats: [{ id: 'chat-a', message: [], hypaV3Data }],
      },
    ])

    const applied = mergeServerProjectionCharacterRow({
      chaId: 'char-a',
      name: 'Ada Lovelace',
      chats: [{ id: 'chat-a', message: [] }],
    })

    expect(applied).toBe(true)
    expect(DBState.db.characters[0].name).toBe('Ada Lovelace')
    expect(DBState.db.characters[0].chats[0].message).toEqual([])
    expect(DBState.db.characters[0].chats[0].hypaV3Data).toEqual(hypaV3Data)
  })

  it('keeps non-empty hydrated messages on incoming chat stubs', () => {
    const priorMessages = [{ role: 'user' as const, data: 'hi' }]
    seedDatabase([
      {
        chaId: 'char-a',
        name: 'Ada',
        chats: [{ id: 'chat-a', message: priorMessages }],
      },
    ])

    const applied = mergeServerProjectionCharacterRow({
      chaId: 'char-a',
      name: 'Ada Lovelace',
      chats: [{ id: 'chat-a', message: [] }],
    })

    expect(applied).toBe(true)
    expect(DBState.db.characters[0].name).toBe('Ada Lovelace')
    expect(DBState.db.characters[0].chats[0].message).toEqual(priorMessages)
    expect(DBState.db.characters[0].chats[0].hypaV3Data).toBeUndefined()
  })

  it('returns false for unknown characters without mutating the corpus', () => {
    seedDatabase([
      {
        chaId: 'char-a',
        name: 'Ada',
        chats: [{ id: 'chat-a', message: [] }],
      },
    ])
    const characters = DBState.db.characters
    const before = JSON.stringify(characters)

    const applied = mergeServerProjectionCharacterRow({
      chaId: 'char-missing',
      name: 'Missing',
      chats: [{ id: 'chat-missing', message: [] }],
    })

    expect(applied).toBe(false)
    expect(DBState.db.characters).toBe(characters)
    expect(JSON.stringify(DBState.db.characters)).toBe(before)
  })
})
