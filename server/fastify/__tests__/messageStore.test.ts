import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../src/db.js'
import {
  applyChatMessageDiff,
  countChatMessages,
  deleteChatMessages,
  getAllChatIdsWithMessages,
  getChatMessages,
  replaceChatMessages,
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

  it('replaceChatMessages with an empty array removes all rows', () => {
    const db = makeDb(makeDataDir())
    replaceChatMessages(db, 'chat-a', [msg('a1', 'user', 'a')])
    replaceChatMessages(db, 'chat-a', [])
    expect(getChatMessages(db, 'chat-a')).toEqual([])
    expect(getAllChatIdsWithMessages(db)).toEqual([])
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
