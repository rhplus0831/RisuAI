import { beforeEach, describe, expect, it } from 'vitest'
import { charactersResourceState } from 'src/ts/server/resourceState.svelte'
import type { character } from 'src/ts/storage/database.svelte'
import { createSidebarChatProjection } from './sidebarChatProjection.svelte'

function row(id: string): character {
  return {
    chaId: id,
    name: id,
    image: '',
    chatPage: 0,
    chats: [{ id: `chat-${id}`, name: id, message: [] }],
  } as character
}

beforeEach(() => {
  charactersResourceState.status = 'ready'
  charactersResourceState.characters = [row('a'), row('b')]
})

function projection() {
  return createSidebarChatProjection(
    () => charactersResourceState.characters,
    () => charactersResourceState.status === 'ready',
  )
}

describe('shared sidebar chat projection', () => {
  it('rejects duplicate chat IDs and follows replacement, error and rollback', () => {
    const read = projection()
    expect(read.activeIndexes(new Set(['chat-b']))).toEqual(new Set([1]))
    charactersResourceState.characters[1].chats[0].id = 'chat-a'
    expect(read.rows().map((row) => row.chats.length)).toEqual([0, 0])
    charactersResourceState.characters[1].chats[0].id = 'chat-b'
    expect(read.activeIndexes(new Set(['chat-a']))).toEqual(new Set([0]))
    charactersResourceState.characters.reverse()
    expect(read.activeIndexes(new Set(['chat-a']))).toEqual(new Set([1]))
    charactersResourceState.status = 'error'
    expect(read.rows()).toEqual([])
    charactersResourceState.status = 'ready'
    charactersResourceState.characters = [row('replacement')]
    expect(read.rows()[0].chaId).toBe('replacement')
  })

  it('reuses one projection across badges and A-B-A selection without reading unrelated character data', () => {
    let idReads = 0
    const rows = Array.from({ length: 200 }, (_, i) => {
      const character = row(`${i}`)
      Object.defineProperty(character.chats[0], 'id', {
        get: () => {
          idReads++
          return `chat-${i}`
        },
      })
      Object.defineProperty(character, 'desc', {
        get: () => {
          throw new Error('must not spread full characters')
        },
      })
      return character
    })
    charactersResourceState.characters = rows
    const read = projection()
    const first = read.rows()
    const initialReads = idReads
    for (const currentChar of [0, 1, 0]) {
      charactersResourceState.currentChar = currentChar
      charactersResourceState.characters[currentChar].chatPage++
      for (let i = 0; i < 200; i++) expect(read.rows()).toBe(first)
    }
    expect(idReads).toBe(initialReads)
    expect(idReads).toBeLessThan(200 * 8)
    charactersResourceState.characters[0].chats[0].name = 'renamed chat'
    expect(read.rows()[0].chats[0].name).toBe('renamed chat')
    charactersResourceState.characters[0].name = 'renamed character'
    expect(read.rows()[0].name).toBe('renamed character')
  })
})
