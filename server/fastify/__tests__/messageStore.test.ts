import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../src/db.js'
import {
  addAlternateMessage,
  applyChatMessageDiff,
  clearAlternateMessages,
  countAlternateMessages,
  countChatMessages,
  deleteChatHypaV3,
  deleteChatMessages,
  getAllChatHypaV3Grouped,
  getAllChatIdsWithHypaV3,
  getAllChatIdsWithMessages,
  getAlternateMessages,
  getChatHypaV3,
  getChatMessages,
  replaceChatMessages,
  setChatHypaV3,
} from '../src/messageStore.js'
import {
  loadPersisted,
  loadPersistedWithMessages,
  writePersisted,
  writePersistedWithMessages,
  type Persisted,
} from '../src/repository.js'

const dataDirs: string[] = []
const dbs: DatabaseSync[] = []

function makeDataDir(): string {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-msgstore-'))
  dataDirs.push(dataDir)
  return dataDir
}

function makeDb(dataDir: string): DatabaseSync {
  const db = openDatabase(dataDir)
  dbs.push(db)
  return db
}

afterEach(() => {
  for (const db of dbs.splice(0)) db.close()
  for (const dataDir of dataDirs.splice(0)) {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

function msg(uid: string, role: 'user' | 'char', data: string, extra: Record<string, unknown> = {}) {
  return { chatId: uid, role, data, ...extra }
}

describe('messageStore CRUD', () => {
  it('round-trips messages in seq order via the json column', () => {
    const db = makeDb(makeDataDir())
    const messages = [
      msg('m1', 'user', 'hello', { time: 1, name: 'A' }),
      msg('m2', 'char', 'hi there', { generationInfo: { model: 'x' } }),
      msg('m3', 'user', 'bye', { disabled: 'allBefore' }),
    ]
    replaceChatMessages(db, 'chat-1', messages)

    expect(getChatMessages(db, 'chat-1')).toEqual(messages)
    expect(countChatMessages(db, 'chat-1')).toBe(3)
    expect(getAllChatIdsWithMessages(db)).toEqual(['chat-1'])
  })

  it('replaceChatMessages overwrites only the target chat', () => {
    const db = makeDb(makeDataDir())
    replaceChatMessages(db, 'chat-a', [msg('a1', 'user', 'a')])
    replaceChatMessages(db, 'chat-b', [msg('b1', 'user', 'b'), msg('b2', 'char', 'b2')])

    replaceChatMessages(db, 'chat-a', [msg('a1', 'user', 'a-edited')])

    expect(getChatMessages(db, 'chat-a')).toEqual([msg('a1', 'user', 'a-edited')])
    expect(getChatMessages(db, 'chat-b')).toEqual([msg('b1', 'user', 'b'), msg('b2', 'char', 'b2')])
    expect(getAllChatIdsWithMessages(db).sort()).toEqual(['chat-a', 'chat-b'])
  })

  it('deleteChatMessages clears one chat only', () => {
    const db = makeDb(makeDataDir())
    replaceChatMessages(db, 'chat-a', [msg('a1', 'user', 'a')])
    replaceChatMessages(db, 'chat-b', [msg('b1', 'user', 'b')])

    deleteChatMessages(db, 'chat-a')

    expect(getChatMessages(db, 'chat-a')).toEqual([])
    expect(countChatMessages(db, 'chat-a')).toBe(0)
    expect(getAllChatIdsWithMessages(db)).toEqual(['chat-b'])
  })

  it('replaceChatMessages with an empty array removes all active rows', () => {
    const db = makeDb(makeDataDir())
    replaceChatMessages(db, 'chat-a', [msg('a1', 'user', 'a')])
    replaceChatMessages(db, 'chat-a', [])
    expect(getChatMessages(db, 'chat-a')).toEqual([])
    expect(getAllChatIdsWithMessages(db)).toEqual([])
  })
})

// Reroll buffer candidates never appear in active transcript queries.
describe('reroll-alternate rows', () => {
  it('keeps alternates out of every active query', () => {
    const db = makeDb(makeDataDir())
    replaceChatMessages(db, 'chat-1', [msg('m1', 'user', 'hi'), msg('m2', 'char', 'active')])
    addAlternateMessage(db, 'chat-1', msg('alt1', 'char', 'old candidate'))

    // The active transcript is unchanged by the alternate.
    expect(getChatMessages(db, 'chat-1')).toEqual([
      msg('m1', 'user', 'hi'),
      msg('m2', 'char', 'active'),
    ])
    expect(countChatMessages(db, 'chat-1')).toBe(2)
    expect(getAllChatIdsWithMessages(db)).toEqual(['chat-1'])
    // The alternate is retrievable via the dedicated buffer queries.
    expect(getAlternateMessages(db, 'chat-1')).toEqual([msg('alt1', 'char', 'old candidate')])
    expect(countAlternateMessages(db, 'chat-1')).toBe(1)
  })

  it('accumulates alternates with unique negative seqs (most-recent first)', () => {
    const db = makeDb(makeDataDir())
    addAlternateMessage(db, 'chat-1', msg('a', 'char', 'first'))
    addAlternateMessage(db, 'chat-1', msg('b', 'char', 'second'))
    addAlternateMessage(db, 'chat-1', msg('c', 'char', 'third'))

    expect(countAlternateMessages(db, 'chat-1')).toBe(3)
    expect(getAlternateMessages(db, 'chat-1').map((m) => m.data)).toEqual([
      'third',
      'second',
      'first',
    ])
    const seqs = (
      db.prepare('SELECT seq FROM messages WHERE chat_id = ? AND alternate = 1').all('chat-1') as {
        seq: number
      }[]
    ).map((r) => r.seq)
    expect(seqs.sort((x, y) => x - y)).toEqual([-3, -2, -1])
  })

  it('clears a chat reroll buffer without touching the active transcript', () => {
    const db = makeDb(makeDataDir())
    replaceChatMessages(db, 'chat-1', [msg('m1', 'char', 'active')])
    addAlternateMessage(db, 'chat-1', msg('alt', 'char', 'candidate'))

    clearAlternateMessages(db, 'chat-1')

    expect(getAlternateMessages(db, 'chat-1')).toEqual([])
    expect(countAlternateMessages(db, 'chat-1')).toBe(0)
    expect(getChatMessages(db, 'chat-1')).toEqual([msg('m1', 'char', 'active')])
  })

  it('does not disturb alternates when the active transcript is appended/diffed', () => {
    const db = makeDb(makeDataDir())
    const base = [msg('m1', 'user', 'a')]
    replaceChatMessages(db, 'chat-1', base)
    addAlternateMessage(db, 'chat-1', msg('alt', 'char', 'candidate'))

    // Surgical active append must leave the alternate intact.
    applyChatMessageDiff(db, 'chat-1', base, [...base, msg('m2', 'char', 'b')])

    expect(getChatMessages(db, 'chat-1')).toEqual([msg('m1', 'user', 'a'), msg('m2', 'char', 'b')])
    expect(getAlternateMessages(db, 'chat-1')).toEqual([msg('alt', 'char', 'candidate')])
  })

  it('deleteChatMessages drops the reroll buffer too (chat lifecycle)', () => {
    const db = makeDb(makeDataDir())
    replaceChatMessages(db, 'chat-1', [msg('m1', 'char', 'active')])
    addAlternateMessage(db, 'chat-1', msg('alt', 'char', 'candidate'))

    deleteChatMessages(db, 'chat-1')

    expect(getChatMessages(db, 'chat-1')).toEqual([])
    expect(getAlternateMessages(db, 'chat-1')).toEqual([])
  })

  it('scopes the buffer per chat', () => {
    const db = makeDb(makeDataDir())
    addAlternateMessage(db, 'chat-a', msg('a', 'char', 'A'))
    addAlternateMessage(db, 'chat-b', msg('b', 'char', 'B'))

    clearAlternateMessages(db, 'chat-a')

    expect(getAlternateMessages(db, 'chat-a')).toEqual([])
    expect(getAlternateMessages(db, 'chat-b')).toEqual([msg('b', 'char', 'B')])
  })
})

describe('applyChatMessageDiff surgical writes', () => {
  function rowids(db: DatabaseSync, chatId: string): { seq: number; rowid: number }[] {
    return db
      .prepare('SELECT rowid, seq FROM messages WHERE chat_id = ? ORDER BY seq')
      .all(chatId) as { seq: number; rowid: number }[]
  }

  it('appends exactly one row and leaves prior rows physically untouched', () => {
    const db = makeDb(makeDataDir())
    const base = [msg('m1', 'user', 'a'), msg('m2', 'char', 'b')]
    replaceChatMessages(db, 'chat-1', base)
    const before = rowids(db, 'chat-1')

    applyChatMessageDiff(db, 'chat-1', base, [...base, msg('m3', 'user', 'c')])

    const after = rowids(db, 'chat-1')
    // The two prefix rows keep their rowid (not deleted+reinserted); one new row.
    expect(after.slice(0, 2)).toEqual(before)
    expect(after).toHaveLength(3)
    expect(getChatMessages(db, 'chat-1')).toEqual([...base, msg('m3', 'user', 'c')])
  })

  it('writes nothing when the array is unchanged', () => {
    const db = makeDb(makeDataDir())
    const base = [msg('m1', 'user', 'a'), msg('m2', 'char', 'b')]
    replaceChatMessages(db, 'chat-1', base)
    const before = rowids(db, 'chat-1')

    applyChatMessageDiff(db, 'chat-1', base, structuredClone(base))

    expect(rowids(db, 'chat-1')).toEqual(before)
  })

  it('deletes from the divergence point and reseqs the tail', () => {
    const db = makeDb(makeDataDir())
    const base = [msg('m1', 'user', 'a'), msg('m2', 'char', 'b'), msg('m3', 'user', 'c')]
    replaceChatMessages(db, 'chat-1', base)
    const before = rowids(db, 'chat-1')

    // Delete the middle message → tail reseqs.
    applyChatMessageDiff(db, 'chat-1', base, [base[0], base[2]])

    expect(getChatMessages(db, 'chat-1')).toEqual([msg('m1', 'user', 'a'), msg('m3', 'user', 'c')])
    // The untouched prefix (m1 at seq 0) keeps its rowid.
    expect(rowids(db, 'chat-1')[0]).toEqual(before[0])
  })

  it('truncates by dropping trailing rows only', () => {
    const db = makeDb(makeDataDir())
    const base = [msg('m1', 'user', 'a'), msg('m2', 'char', 'b'), msg('m3', 'user', 'c')]
    replaceChatMessages(db, 'chat-1', base)
    const before = rowids(db, 'chat-1')

    applyChatMessageDiff(db, 'chat-1', base, base.slice(0, 1))

    expect(getChatMessages(db, 'chat-1')).toEqual([msg('m1', 'user', 'a')])
    expect(rowids(db, 'chat-1')).toEqual([before[0]])
  })
})

describe('chat hypaV3Data store (Phase 4.4)', () => {
  it('upserts, reads, groups and deletes a chat blob', () => {
    const db = makeDb(makeDataDir())
    setChatHypaV3(db, 'chat-1', { mainChunks: [{ text: 'a' }], lastImportantSummary: 2 })
    setChatHypaV3(db, 'chat-2', { mainChunks: [] })

    expect(getChatHypaV3(db, 'chat-1')).toEqual({
      mainChunks: [{ text: 'a' }],
      lastImportantSummary: 2,
    })
    expect(getAllChatIdsWithHypaV3(db).sort()).toEqual(['chat-1', 'chat-2'])

    // Upsert overwrites.
    setChatHypaV3(db, 'chat-1', { mainChunks: [{ text: 'b' }] })
    expect(getChatHypaV3(db, 'chat-1')).toEqual({ mainChunks: [{ text: 'b' }] })

    // setChatHypaV3(null/undefined) deletes.
    setChatHypaV3(db, 'chat-1', undefined)
    expect(getChatHypaV3(db, 'chat-1')).toBeUndefined()
    deleteChatHypaV3(db, 'chat-2')
    expect(getAllChatHypaV3Grouped(db).size).toBe(0)
  })
})

describe('repository message-aware load/write', () => {
  function seedHydrated(database: unknown): Persisted {
    return { _version: 1, database, assets: [] }
  }

  it('splits embedded messages into SQLite and writes a message-free db.json', () => {
    const dataDir = makeDataDir()
    const db = makeDb(dataDir)
    const database = {
      characters: [
        {
          chaId: 'char-a',
          chats: [
            { id: 'chat-1', message: [msg('m1', 'user', 'hi'), msg('m2', 'char', 'yo')] },
            { id: 'chat-2', message: [msg('m3', 'user', 'second chat')] },
          ],
        },
      ],
    }

    writePersistedWithMessages(db, dataDir, seedHydrated(structuredClone(database)))

    // db.json on disk is message-free.
    const onDisk = JSON.parse(readFileSync(path.join(dataDir, 'db.json'), 'utf8'))
    for (const chat of onDisk.database.characters[0].chats) {
      expect(chat.message).toBeUndefined()
    }
    // Plain load (message-free) sees no messages...
    const plain = loadPersisted(dataDir).database as typeof database
    expect(plain.characters[0].chats[0].message).toBeUndefined()
    // ...while the hydrated load reconstructs them byte-for-byte.
    const hydrated = loadPersistedWithMessages(db, dataDir).database as typeof database
    expect(hydrated.characters[0].chats[0].message).toEqual(database.characters[0].chats[0].message)
    expect(hydrated.characters[0].chats[1].message).toEqual(database.characters[0].chats[1].message)
  })

  it('splits + rejoins per-chat hypaV3Data, message-free + hypa-free on disk', () => {
    const dataDir = makeDataDir()
    const db = makeDb(dataDir)
    const database = {
      characters: [
        {
          chaId: 'c',
          chats: [
            { id: 'chat-1', message: [msg('m1', 'user', 'hi')], hypaV3Data: { mainChunks: [{ t: 1 }] } },
            { id: 'chat-2', message: [], hypaV3Data: undefined },
          ],
        },
      ],
    }

    writePersistedWithMessages(db, dataDir, seedHydrated(structuredClone(database)))

    // db.json carries neither message[] nor hypaV3Data.
    const onDisk = JSON.parse(readFileSync(path.join(dataDir, 'db.json'), 'utf8'))
    for (const chat of onDisk.database.characters[0].chats) {
      expect(chat.message).toBeUndefined()
      expect(chat.hypaV3Data).toBeUndefined()
    }
    // The hydrated load rejoins hypaV3Data (only where present).
    const hydrated = loadPersistedWithMessages(db, dataDir).database as typeof database
    expect(hydrated.characters[0].chats[0].hypaV3Data).toEqual({ mainChunks: [{ t: 1 }] })
    expect(hydrated.characters[0].chats[1].hypaV3Data).toBeUndefined()
  })

  it('round-trips load->write->load preserving messages', () => {
    const dataDir = makeDataDir()
    const db = makeDb(dataDir)
    const database = {
      characters: [
        { chaId: 'c', chats: [{ id: 'chat-1', message: [msg('m1', 'user', 'a'), msg('m2', 'char', 'b')] }] },
      ],
    }
    writePersistedWithMessages(db, dataDir, seedHydrated(structuredClone(database)))

    const first = loadPersistedWithMessages(db, dataDir)
    writePersistedWithMessages(db, dataDir, structuredClone(first))
    const second = loadPersistedWithMessages(db, dataDir)

    expect(second.database).toEqual(first.database)
    expect((second.database as typeof database).characters[0].chats[0].message).toEqual(
      database.characters[0].chats[0].message,
    )
  })

  it('falls back to embedded messages when no SQLite rows exist yet', () => {
    // Simulates an un-migrated db.json (written directly, no command run): the
    // hydrated load must surface the embedded array losslessly.
    const dataDir = makeDataDir()
    const db = makeDb(dataDir)
    const database = {
      characters: [{ chaId: 'c', chats: [{ id: 'chat-1', message: [msg('m1', 'user', 'embedded')] }] }],
    }
    writePersisted(dataDir, { _version: 1, database, assets: [] })

    const hydrated = loadPersistedWithMessages(db, dataDir).database as typeof database
    expect(hydrated.characters[0].chats[0].message).toEqual([msg('m1', 'user', 'embedded')])
    // The first message-aware write then extracts it into SQLite.
    writePersistedWithMessages(db, dataDir, structuredClone(loadPersistedWithMessages(db, dataDir)))
    expect(getChatMessages(db, 'chat-1')).toEqual([msg('m1', 'user', 'embedded')])
  })

  it('reclaims rows for chats removed from the database', () => {
    const dataDir = makeDataDir()
    const db = makeDb(dataDir)
    const withTwo = {
      characters: [
        {
          chaId: 'c',
          chats: [
            { id: 'chat-1', message: [msg('m1', 'user', 'a')] },
            { id: 'chat-2', message: [msg('m2', 'user', 'b')] },
          ],
        },
      ],
    }
    writePersistedWithMessages(db, dataDir, seedHydrated(structuredClone(withTwo)))
    expect(getAllChatIdsWithMessages(db).sort()).toEqual(['chat-1', 'chat-2'])

    const withOne = {
      characters: [{ chaId: 'c', chats: [{ id: 'chat-1', message: [msg('m1', 'user', 'a')] }] }],
    }
    writePersistedWithMessages(db, dataDir, seedHydrated(structuredClone(withOne)))
    expect(getAllChatIdsWithMessages(db)).toEqual(['chat-1'])
  })
})
