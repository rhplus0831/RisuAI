import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { openDatabase } from '../src/db.js'
import {
  loadPersisted,
  loadPersistedForChatMutation,
} from '../src/repository.js'
import { applyTargetedCommandMutation } from '../src/commands/mutations.js'
import { normalizeAllCharacterChats } from '../src/commands/chats.js'
import { setupAuthedClient } from './helpers/auth.js'
import {
  assertScopedLoadOnHotPath,
  withServerLoadInstrumentation,
} from './helpers/loadCostHarness.js'
import { buildLargeCorpusFixture } from '../../../src/ts/__tests__/largeCorpusFixture.js'

// Phase 2 command-mutation read narrowing (audit M3, L5, L6): the targeted
// message/scriptstate/generation command routes only locate one chat row and
// mutate it (or write the message store through the kit writers), yet every
// mutation paid `loadPersisted` — all 9 collection tables + plugin storage
// (M3), the assets metadata scan (L5), and the whole characters+chats payload
// parse (L6). The opt-in `chatScopedRead` loads exactly the target chat row +
// its parent character, with a broad `loadPersisted` fallback for unknown ids
// and the pre-extraction embedded state so error behavior and the global
// dedup edge stay byte-identical.

interface Harness {
  app: FastifyInstance
  dataDir: string
}

let harness: Harness
let assertion: string

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-cmd-read-'))
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 20 * 1024 * 1024,
      importMaxBytes: Infinity,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
    },
    // Background DB consumers would pollute the process-global statement spy.
    assetGc: false,
    memoryWorker: false,
  })
  return { app, dataDir }
}

beforeEach(async () => {
  harness = await startHarness()
  ;({ assertion } = await setupAuthedClient(harness.app))
})

afterEach(async () => {
  await harness.app.close()
  rmSync(harness.dataDir, { recursive: true, force: true })
})

async function importDatabase(database: unknown): Promise<number> {
  const res = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/import/risusave',
    headers: { 'risu-auth': assertion },
    payload: { database },
  })
  expect(res.statusCode).toBe(200)
  return res.json().revision as number
}

function command(
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  payload: Record<string, unknown>,
) {
  return harness.app.inject({ method, url, headers: { 'risu-auth': assertion }, payload })
}

function hydrationGet(chatId: string) {
  return harness.app.inject({
    method: 'GET',
    url: `/api/v1/projection/chatMessages?id=${chatId}`,
    headers: { 'risu-auth': assertion },
  })
}

describe('command-mutation read narrowing (M3/L5/L6) on the large-corpus fixture', () => {
  it('M3/L5/L6: a scriptstate PATCH performs zero whole-corpus payload reads', async () => {
    const fixture = buildLargeCorpusFixture()
    const revision = await importDatabase(fixture.database)

    const res = await assertScopedLoadOnHotPath(() =>
      command('PATCH', `/api/v1/commands/chats/${fixture.hot.chatId}/scriptstate`, {
        baseRevision: revision,
        patch: { $flag: 'on' },
        deleteKeys: ['$corpusScore'],
      }),
    )
    expect(res.statusCode).toBe(200)
    expect(res.json().revision).toBe(revision + 1)

    // The patched scriptstate persisted into the one chat row.
    const db = openDatabase(harness.dataDir)
    try {
      const row = db
        .prepare('SELECT data_json FROM chats WHERE id = ?')
        .get(fixture.hot.chatId) as { data_json: string }
      expect((JSON.parse(row.data_json) as { scriptstate?: unknown }).scriptstate).toEqual({
        $flag: 'on',
      })
    } finally {
      db.close()
    }
  })

  it('H2: chat-create performs zero whole-corpus message/hypa reads while writing only the new transcript', async () => {
    const fixture = buildLargeCorpusFixture()
    const revision = await importDatabase(fixture.database)
    const targetCharacterId = fixture.hot.characterId
    const existingHotMessages = (await hydrationGet(fixture.hot.chatId)).json()
      .message as Array<{ chatId: string }>

    const { result: created, loadCountByTable } = await withServerLoadInstrumentation(() =>
      command('POST', `/api/v1/commands/characters/${targetCharacterId}/chats`, {
        baseRevision: revision,
        select: false,
        chat: {
          id: 'h2-created-chat',
          name: 'H2 created',
          note: '',
          localLore: [],
          message: [
            { role: 'user', data: 'targeted create 1', chatId: 'h2-created-msg-1' },
            { role: 'char', data: 'targeted create 2', chatId: 'h2-created-msg-2' },
          ],
        },
      }),
    )

    expect(created.statusCode).toBe(200)
    expect(created.json()).toMatchObject({
      revision: revision + 1,
      chatId: 'h2-created-chat',
      // The hot fixture starts on chatPage 0; select:false keeps that selection
      // even though the new chat is inserted at position 0.
      selectedChatId: fixture.hot.chatId,
      event: {
        type: 'chat.created',
        resource: 'chat',
        id: 'h2-created-chat',
        parentId: targetCharacterId,
      },
    })
    // A regression to `loadPersistedWithMessages` would whole-table read both
    // message payload families. The targeted path only does id/scoped lookups.
    expect(loadCountByTable.messages ?? 0).toBe(0)
    expect(loadCountByTable.chat_hypa_v3 ?? 0).toBe(0)

    const db = openDatabase(harness.dataDir)
    try {
      const chatRows = db
        .prepare('SELECT id FROM chats WHERE character_id = ? ORDER BY position')
        .all(targetCharacterId) as Array<{ id: string }>
      expect(chatRows.map((row) => row.id).slice(0, 4)).toEqual([
        'h2-created-chat',
        fixture.hot.chatId,
        `corpus-chat-0-1`,
        `corpus-chat-0-2`,
      ])
      const charRow = db
        .prepare('SELECT data_json FROM characters WHERE id = ?')
        .get(targetCharacterId) as { data_json: string }
      expect((JSON.parse(charRow.data_json) as { chatPage?: number }).chatPage).toBe(1)
    } finally {
      db.close()
    }

    const createdMessages = (await hydrationGet('h2-created-chat')).json()
      .message as Array<{ chatId: string }>
    expect(createdMessages.map((message) => message.chatId)).toEqual([
      'h2-created-msg-1',
      'h2-created-msg-2',
    ])
    const hotAfter = (await hydrationGet(fixture.hot.chatId)).json()
      .message as Array<{ chatId: string }>
    expect(hotAfter.map((message) => message.chatId)).toEqual(
      existingHotMessages.map((message) => message.chatId),
    )
  })

  it('M3/L5/L6: the full message lifecycle stays scoped (append, patch, delete, truncate, replace, generation-result)', async () => {
    const fixture = buildLargeCorpusFixture()
    let revision = await importDatabase(fixture.database)
    const chatId = fixture.hot.chatId

    // Append.
    const appended = await assertScopedLoadOnHotPath(() =>
      command('POST', `/api/v1/commands/chats/${chatId}/messages`, {
        baseRevision: revision,
        message: { role: 'user', data: 'scoped append', chatId: 'scoped-msg-1' },
      }),
    )
    expect(appended.statusCode).toBe(200)
    revision = appended.json().revision

    // Patch by message id (the loader resolves the chat from the uid index).
    const patched = await assertScopedLoadOnHotPath(() =>
      command('PATCH', '/api/v1/commands/messages/scoped-msg-1', {
        baseRevision: revision,
        patch: { data: 'scoped append (edited)' },
      }),
    )
    expect(patched.statusCode).toBe(200)
    expect(patched.json().chatId).toBe(chatId)
    revision = patched.json().revision

    // Delete by message id.
    const deleted = await assertScopedLoadOnHotPath(() =>
      command('DELETE', '/api/v1/commands/messages/scoped-msg-1', {
        baseRevision: revision,
      }),
    )
    expect(deleted.statusCode).toBe(200)
    revision = deleted.json().revision

    // Truncate after a fixture message.
    const keepUntil = `corpus-msg-0-0-${fixture.hot.messageCount - 3}`
    const truncated = await assertScopedLoadOnHotPath(() =>
      command('POST', `/api/v1/commands/chats/${chatId}/messages/truncate`, {
        baseRevision: revision,
        afterMessageId: keepUntil,
      }),
    )
    expect(truncated.statusCode).toBe(200)
    expect(truncated.json().removedCount).toBe(2)
    revision = truncated.json().revision

    // Replace the whole transcript.
    const replaced = await assertScopedLoadOnHotPath(() =>
      command('PUT', `/api/v1/commands/chats/${chatId}/messages`, {
        baseRevision: revision,
        messages: [
          { role: 'user', data: 'fresh start', chatId: 'scoped-msg-2' },
          { role: 'char', data: 'fresh reply', chatId: 'scoped-msg-3' },
        ],
      }),
    )
    expect(replaced.statusCode).toBe(200)
    revision = replaced.json().revision

    // Generation-result persistence.
    const generated = await assertScopedLoadOnHotPath(() =>
      command('POST', `/api/v1/commands/chats/${chatId}/generation-result`, {
        baseRevision: revision,
        generationResult: {
          message: {
            role: 'char',
            data: 'generated answer',
            chatId: 'scoped-gen-1',
            generationInfo: { generationId: 'scoped-gen-1' },
          },
        },
      }),
    )
    expect(generated.statusCode).toBe(200)
    revision = generated.json().revision

    // The chained writes landed: hydrate the chat (itself scoped, H1).
    const hydrated = await hydrationGet(chatId)
    expect(hydrated.statusCode).toBe(200)
    expect(
      (hydrated.json().message as Array<{ chatId: string }>).map((m) => m.chatId),
    ).toEqual(['scoped-msg-2', 'scoped-msg-3', 'scoped-gen-1'])
  })

  it('returns identical rows to the broad loader for both chat-id and message-id targets', async () => {
    const fixture = buildLargeCorpusFixture()
    await importDatabase(fixture.database)

    const db = openDatabase(harness.dataDir)
    try {
      const broad = loadPersisted(db, harness.dataDir).database as {
        characters: Array<{ chaId?: string; chats: Array<{ id?: string }> }>
      }
      const broadChar = broad.characters.find((c) =>
        c.chats.some((chat) => chat.id === fixture.hot.chatId),
      )!
      const broadChat = broadChar.chats.find((chat) => chat.id === fixture.hot.chatId)!

      const scopedRun = await withServerLoadInstrumentation(() =>
        loadPersistedForChatMutation(db, harness.dataDir, { chatId: fixture.hot.chatId }),
      )
      // The scoped read performs zero whole-corpus payload reads of ANY table.
      expect(scopedRun.corpusLoadCount).toBe(0)

      const scoped = scopedRun.result.database as {
        characters: Array<{ chats: unknown[] }>
      }
      expect(scoped.characters).toHaveLength(1)
      expect(scoped.characters[0].chats).toHaveLength(1)
      // Identical payload parses: same character (modulo the chats narrowing)
      // and the same chat record.
      expect(scoped.characters[0].chats[0]).toEqual(broadChat)
      expect({ ...scoped.characters[0], chats: broadChar.chats }).toEqual(broadChar)

      // Message-id targeting resolves the same chat through the uid index.
      const byMessage = await assertScopedLoadOnHotPath(() =>
        loadPersistedForChatMutation(db, harness.dataDir, {
          messageId: `corpus-msg-0-0-0`,
        }),
      )
      const byMessageChars = (byMessage.database as { characters: unknown[] }).characters
      expect(byMessageChars).toEqual(scoped.characters)
    } finally {
      db.close()
    }
  })

  it('falls back to the broad load for an unknown chat id — the 404 contract is unchanged', async () => {
    const fixture = buildLargeCorpusFixture()
    const revision = await importDatabase(fixture.database)

    const { result: res, corpusLoadCount } = await withServerLoadInstrumentation(() =>
      command('PATCH', '/api/v1/commands/chats/no-such-chat/scriptstate', {
        baseRevision: revision,
        patch: { $flag: 'on' },
      }),
    )
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('Chat not found: no-such-chat')
    // The miss path engaged the documented broad fallback (and stayed correct).
    expect(corpusLoadCount).toBeGreaterThan(0)

    const missingMessage = await command('PATCH', '/api/v1/commands/messages/no-such-message', {
      baseRevision: revision,
      patch: { data: 'x' },
    })
    expect(missingMessage.statusCode).toBe(404)
    expect(missingMessage.json().error).toBe('Message not found: no-such-message')
  })

  it('pre-extraction embedded state: falls back broad and the global chat-id dedup still runs', async () => {
    const db = openDatabase(harness.dataDir)
    try {
      // Simulate the pre-extraction edge: characters/chats tables empty, the
      // settings blob still embeds characters — with a cross-character
      // duplicate chat id, the one state where the global dedup has work.
      db.exec('DELETE FROM chats')
      db.exec('DELETE FROM characters')
      const embedded = {
        characters: [
          { chaId: 'char-a', name: 'A', chats: [{ id: 'dup-chat', name: 'A1' }] },
          { chaId: 'char-b', name: 'B', chats: [{ id: 'dup-chat', name: 'B1' }] },
        ],
      }
      db.exec('DELETE FROM settings')
      db.prepare('INSERT INTO settings (id, data_json) VALUES (1, ?)').run(
        JSON.stringify(embedded),
      )

      // The chats table has no row for the target → broad fallback returns the
      // embedded characters…
      const persisted = loadPersistedForChatMutation(db, harness.dataDir, {
        chatId: 'dup-chat',
      })
      const characters = (persisted.database as { characters: unknown[] }).characters
      expect(characters).toHaveLength(2)

      // …and `normalizeAllCharacterChats` still repairs the duplicate exactly
      // as on the never-narrowed path.
      const normalized = normalizeAllCharacterChats(persisted.database)
      const chatsA = normalized[0].chats as Array<{ id: string }>
      const chatsB = normalized[1].chats as Array<{ id: string }>
      expect(chatsA[0].id).toBe('dup-chat')
      expect(chatsB[0].id).not.toBe('dup-chat')
    } finally {
      db.close()
    }
  })

  it('rejects chatScopedRead combined with writeDatabase (data-loss guard)', async () => {
    const db = openDatabase(harness.dataDir)
    try {
      expect(() =>
        applyTargetedCommandMutation({
          db,
          dataDir: harness.dataDir,
          baseRevision: 0,
          eventSink: { emit() {} } as never,
          mutationPath: 'targeted-chat-row',
          writeDatabase: true,
          chatScopedRead: { chatId: 'any' },
          mutate() {
            throw new Error('must not be reached')
          },
        }),
      ).toThrow('chatScopedRead cannot be combined with writeDatabase')
    } finally {
      db.close()
    }
  })
})
