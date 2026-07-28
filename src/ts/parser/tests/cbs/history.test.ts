import { writable } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { risuChatParser } from '../../parser.svelte'

//#region module mocks

// A single shared, mutable DB the history CBS functions read through
// `getDatabase()`. Exposing the same object to the test lets us assert the live
// `Message` rows are never mutated by the shallow-spread render path.
const mocks = vi.hoisted(() => {
  const db = {
    characters: [
      {
        chatPage: 0,
        firstMessage: 'FIRST',
        alternateGreetings: [] as string[],
        chats: [
          {
            fmIndex: -1,
            scriptstate: {},
            message: [
              { role: 'user', data: 'hello {{char}}', chatId: 'm0' },
              { role: 'char', data: 'reply to {{user}}', chatId: 'm1' },
              { role: 'user', data: 'plain user line', chatId: 'm2' },
            ],
          },
        ],
        defaultVariables: '',
      },
    ],
    globalChatVariables: {},
    templateDefaultVariables: '',
    username: 'TestUser',
  }
  return { db }
})

vi.mock(
  import('../../../storage/database.svelte'),
  () =>
    ({
      appVer: '1234.5.67',
      getCurrentCharacter: () => mocks.db.characters[0],
      getDatabase: () => mocks.db,
      reapplyPendingPresetProjections: () => {},
    }) as unknown as typeof import('../../../storage/database.svelte'),
)

vi.mock(import('../../../globalApi.svelte'), () => ({
  aiWatermarkingLawApplies: () => false,
  getFileSrc: () => Promise.resolve(''),
}))

vi.mock(import('../../../stores.svelte'), () => {
  return {
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
  } as unknown as typeof import('../../../stores.svelte')
})

//#endregion

beforeEach(() => {
  vi.clearAllMocks()
})

describe('history CBS functions shallow-spread (Phase 7)', () => {
  test('{{userhistory}} returns only user messages and never mutates the live rows', () => {
    const liveRows = mocks.db.characters[0].chats[0].message
    const rowRefs = liveRows.map((m) => m)
    const rawData = liveRows.map((m) => m.data)

    const out = risuChatParser('{{userhistory}}')
    const parsed: string[] = JSON.parse(out)

    // Two user rows, each a JSON.stringify'd message object.
    expect(parsed).toHaveLength(2)
    const decoded = parsed.map((s) => JSON.parse(s) as { role: string; data: string })
    expect(decoded.every((m) => m.role === 'user')).toBe(true)
    expect(decoded[1].data).toBe('plain user line')

    // The live rows are the same object identities with their original `.data`;
    // the spread copy is what gets reparsed, not the stored Message.
    liveRows.forEach((m, i) => {
      expect(m).toBe(rowRefs[i])
      expect(m.data).toBe(rawData[i])
    })
  })

  test('{{charhistory}} returns only char messages without mutating the chat', () => {
    const before = JSON.parse(JSON.stringify(mocks.db.characters[0].chats[0].message))
    const out = risuChatParser('{{charhistory}}')
    const parsed: string[] = JSON.parse(out)
    expect(parsed).toHaveLength(1)
    expect((JSON.parse(parsed[0]) as { role: string }).role).toBe('char')
    expect(mocks.db.characters[0].chats[0].message).toEqual(before)
  })

  test('{{history}} prepends the first message and leaves the stored rows intact', () => {
    const before = JSON.parse(JSON.stringify(mocks.db.characters[0].chats[0].message))
    const out = risuChatParser('{{history}}')
    const parsed: string[] = JSON.parse(out)
    // first message + the 3 stored rows
    expect(parsed).toHaveLength(4)
    expect((JSON.parse(parsed[0]) as { data: string }).data).toBe('FIRST')
    expect(mocks.db.characters[0].chats[0].message).toEqual(before)
  })

  test('{{history::N}} returns the N most recent stored messages in chronological order', () => {
    expect(JSON.parse(risuChatParser('{{history::2}}'))).toEqual(['reply to {{user}}', 'plain user line'])
    expect(JSON.parse(risuChatParser('{{messages::1}}'))).toEqual(['plain user line'])
  })

  test('{{history::N}} returns all stored messages when N exceeds the chat length without adding the greeting', () => {
    expect(JSON.parse(risuChatParser('{{history::50}}'))).toEqual([
      'hello {{char}}',
      'reply to {{user}}',
      'plain user line',
    ])
  })

  test('{{history::N::role}} preserves role prefixes within the selected window', () => {
    expect(JSON.parse(risuChatParser('{{history::2::role}}'))).toEqual([
      'char: reply to {{user}}',
      'user: plain user line',
    ])
    expect(JSON.parse(risuChatParser('{{history::role}}'))).toHaveLength(3)
  })

  test('{{history::N}} returns an empty array for invalid counts', () => {
    expect(JSON.parse(risuChatParser('{{history::0}}'))).toEqual([])
    expect(JSON.parse(risuChatParser('{{history::-1}}'))).toEqual([])
    expect(JSON.parse(risuChatParser('{{history::1.5}}'))).toEqual([])
    expect(JSON.parse(risuChatParser('{{history::many}}'))).toEqual([])
  })
})
