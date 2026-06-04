import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { openDatabase } from '../src/db.js'
import { loadPersistedWithMessages } from '../src/repository.js'
import { getChatMessagesGroupedByIds } from '../src/messageStore.js'
import { setupAuthedClient } from './helpers/auth.js'
import {
  assertScopedLoadOnHotPath,
  classifyCorpusStatement,
  withServerLoadInstrumentation,
} from './helpers/loadCostHarness.js'
import { buildLargeCorpusFixture } from '../../../src/ts/__tests__/largeCorpusFixture.js'

// Phase 0 (measurement-baseline-harness): prove the server load-count harness
// can (a) pass a genuinely scoped hot path and (b) FAIL a path that performs a
// whole-corpus payload load — on the shared large-corpus fixture both suites
// seed from. The Phase 1 H1 guard (`loadChatHydration` early-return on
// `message.length > 0`) has landed, so missing-hypa hydration is asserted
// scoped below; the zero-row not-yet-extracted fallback keeps its documented
// breadth. The remaining whole-corpus positive control (U1, bulk hydration)
// documents CURRENT breadth — when the Phase 2 narrowing lands, flip it to
// `assertScopedLoadOnHotPath`.

interface Harness {
  app: FastifyInstance
  dataDir: string
}

let harness: Harness
let assertion: string

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-load-cost-'))
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

async function importDatabase(database: unknown): Promise<void> {
  const res = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/import/risusave',
    headers: { 'risu-auth': assertion },
    payload: { database },
  })
  expect(res.statusCode).toBe(200)
}

function hydrationGet(chatId: string) {
  return harness.app.inject({
    method: 'GET',
    url: `/api/v1/projection/chatMessages?id=${chatId}`,
    headers: { 'risu-auth': assertion },
  })
}

describe('classifyCorpusStatement', () => {
  it('flags the whole-corpus payload loaders by their SQL', () => {
    // getAllChatMessagesGrouped
    expect(
      classifyCorpusStatement(
        'SELECT chat_id, json FROM messages WHERE alternate = 0 ORDER BY chat_id, seq',
      ),
    ).toEqual({ table: 'messages' })
    // getAllChatHypaV3Grouped
    expect(classifyCorpusStatement('SELECT chat_id, json FROM chat_hypa_v3')).toEqual({
      table: 'chat_hypa_v3',
    })
    // loadCharactersFromSqlite (both statements)
    expect(
      classifyCorpusStatement('SELECT id, position, data_json FROM characters ORDER BY position'),
    ).toEqual({ table: 'characters' })
    expect(
      classifyCorpusStatement(
        'SELECT id, character_id, position, data_json FROM chats ORDER BY character_id, position',
      ),
    ).toEqual({ table: 'chats' })
    // loadCollectionsFromSqlite (one per collection family)
    expect(classifyCorpusStatement('SELECT data_json FROM modules ORDER BY position')).toEqual({
      table: 'modules',
    })
    // getAllAssetMetadata (L5)
    expect(
      classifyCorpusStatement('SELECT id, ext, size, content_type FROM assets ORDER BY id'),
    ).toEqual({ table: 'assets' })
  })

  it('does not flag scoped, id-only, non-corpus, or write statements', () => {
    // getChatMessages / getChatMessagesGroupedByIds (row-scoped)
    expect(
      classifyCorpusStatement(
        'SELECT json FROM messages WHERE chat_id = ? AND alternate = 0 ORDER BY seq',
      ),
    ).toBeNull()
    expect(
      classifyCorpusStatement(
        'SELECT chat_id, json FROM messages WHERE alternate = 0 AND chat_id IN (?, ?) ORDER BY chat_id, seq',
      ),
    ).toBeNull()
    expect(classifyCorpusStatement('SELECT json FROM chat_hypa_v3 WHERE chat_id = ?')).toBeNull()
    expect(
      classifyCorpusStatement('SELECT id, ext, size, content_type FROM assets WHERE id = ?'),
    ).toBeNull()
    // Id-only scans stay cheap and do not count.
    expect(
      classifyCorpusStatement('SELECT DISTINCT chat_id FROM messages WHERE alternate = 0'),
    ).toBeNull()
    expect(classifyCorpusStatement('SELECT chat_id FROM chat_hypa_v3')).toBeNull()
    expect(
      classifyCorpusStatement(
        'SELECT COUNT(*) AS count FROM messages WHERE chat_id = ? AND alternate = 0',
      ),
    ).toBeNull()
    // Non-corpus tables (settings is one bounded row).
    expect(classifyCorpusStatement('SELECT data_json FROM settings WHERE id = 1')).toBeNull()
    expect(
      classifyCorpusStatement('SELECT version, revision FROM schema_version WHERE id = 1'),
    ).toBeNull()
    // Writes.
    expect(
      classifyCorpusStatement('INSERT INTO characters (id, position, data_json) VALUES (?, ?, ?)'),
    ).toBeNull()
    expect(classifyCorpusStatement('DELETE FROM command_events WHERE revision < ?')).toBeNull()
  })
})

describe('server load-count harness on the large-corpus fixture', () => {
  it('passes a scoped hot path: hydration of a chat with messages AND hypaV3Data', async () => {
    const fixture = buildLargeCorpusFixture()
    await importDatabase(fixture.database)

    const started = performance.now()
    const res = await assertScopedLoadOnHotPath(() => hydrationGet(fixture.hot.chatId))
    const scopedMs = performance.now() - started

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.message).toHaveLength(fixture.hot.messageCount)
    expect(body.hypaV3Data).toBeDefined()

    if (process.env.RISU_PROTOCOL_METRICS === '1') {
      console.info(`[load-cost] scoped hydration (hot chat): ${scopedMs.toFixed(1)}ms, 0 corpus loads`)
    }
  })

  it('H1 guard: hydration of a chat WITHOUT a chat_hypa_v3 row stays scoped', async () => {
    const fixture = buildLargeCorpusFixture()
    await importDatabase(fixture.database)
    expect(fixture.noHypa.chatId).not.toBe(fixture.hot.chatId)

    // Audit H1 regression: a legitimately `undefined` hypaV3Data used to drop
    // this request into `loadPersisted` (13 whole-corpus payload reads on the
    // default fixture). The guard makes the messages table authoritative once
    // populated; this call now performs zero whole-corpus payload reads.
    const started = performance.now()
    const res = await assertScopedLoadOnHotPath(() => hydrationGet(fixture.noHypa.chatId))
    const scopedMs = performance.now() - started

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.message).toHaveLength(fixture.noHypa.messageCount)
    // A non-HypaV3 chat still reports no hypaV3Data, as before the guard.
    expect(body.hypaV3Data).toBeUndefined()

    if (process.env.RISU_PROTOCOL_METRICS === '1') {
      console.info(
        `[load-cost] H1 guarded hydration (no-hypa chat): ${scopedMs.toFixed(1)}ms, 0 corpus loads`,
      )
    }
  })

  it('H1 guard keeps the zero-row fallback: a not-yet-extracted chat hydrates from its embedded copy', async () => {
    const fixture = buildLargeCorpusFixture()
    await importDatabase(fixture.database)

    // Simulate the defensive pre-extraction state: a chat row whose data_json
    // still embeds `message`, with zero rows in the messages table.
    const embedded = [
      { role: 'user', data: 'embedded hello', chatId: 'pre-extract-m1', time: 1700000000000 },
      { role: 'char', data: 'embedded reply', chatId: 'pre-extract-m2', time: 1700000000001 },
    ]
    const db = openDatabase(harness.dataDir)
    try {
      db.prepare(
        'INSERT INTO chats (id, character_id, position, data_json) VALUES (?, ?, ?, ?)',
      ).run(
        'pre-extract-chat',
        fixture.hot.characterId,
        999,
        JSON.stringify({
          id: 'pre-extract-chat',
          name: 'Pre-extract',
          note: '',
          localLore: [],
          message: embedded,
        }),
      )
    } finally {
      db.close()
    }

    const { result: res, corpusLoadCount, loadCountByTable } = await withServerLoadInstrumentation(
      () => hydrationGet('pre-extract-chat'),
    )
    expect(res.statusCode).toBe(200)
    expect(res.json().message).toEqual(embedded)
    // The zero-row fallback is the one legitimate broad consumer on this route:
    // it still walks `loadPersisted` to find the embedded copy…
    expect(corpusLoadCount).toBeGreaterThan(0)
    expect(loadCountByTable.characters).toBeGreaterThanOrEqual(1)
    expect(loadCountByTable.chats).toBeGreaterThanOrEqual(1)

    // …so the scoped-load assertion still fails for it — the harness can gate.
    await expect(
      assertScopedLoadOnHotPath(() => hydrationGet('pre-extract-chat')),
    ).rejects.toThrow(/whole-corpus payload read/)
  })

  it('detects bulk hydration breadth (U1): the bulk route loads the corpus even for one known id', async () => {
    const fixture = buildLargeCorpusFixture()
    await importDatabase(fixture.database)

    const { result: res, loadCountByTable } = await withServerLoadInstrumentation(() =>
      harness.app.inject({
        method: 'POST',
        url: '/api/v1/projection/chatMessages/bulk',
        headers: { 'risu-auth': assertion },
        payload: { ids: [fixture.hot.chatId] },
      }),
    )
    expect(res.statusCode).toBe(200)
    expect(res.json().chats).toHaveLength(1)
    // CURRENT breadth (audit U1): `loadChatHydrations` always falls into
    // `loadPersisted` for its known-id check. Phase 2 may narrow this; if it
    // does, flip to `assertScopedLoadOnHotPath`.
    expect(loadCountByTable.characters).toBeGreaterThanOrEqual(1)
  })

  it('separates the broad loader from the scoped loader at the function level', async () => {
    const fixture = buildLargeCorpusFixture()
    await importDatabase(fixture.database)
    const db = openDatabase(harness.dataDir)
    try {
      // The genuine full-corpus consumer's loader is loud under the harness…
      const broad = await withServerLoadInstrumentation(() =>
        loadPersistedWithMessages(db, harness.dataDir),
      )
      expect(broad.loadCountByTable.messages).toBeGreaterThanOrEqual(1)
      expect(broad.loadCountByTable.characters).toBeGreaterThanOrEqual(1)
      expect(broad.corpusLoadCount).toBeGreaterThanOrEqual(3)

      // …and the scoped per-id loader is silent, with identical row results.
      const scoped = await assertScopedLoadOnHotPath(() =>
        getChatMessagesGroupedByIds(db, [fixture.hot.chatId]),
      )
      expect(scoped.get(fixture.hot.chatId)).toHaveLength(fixture.hot.messageCount)

      // `allowTables` permits a declared exception but nothing else.
      await expect(
        assertScopedLoadOnHotPath(() => loadPersistedWithMessages(db, harness.dataDir), {
          allowTables: ['messages'],
        }),
      ).rejects.toThrow(/\[characters\]/)
    } finally {
      db.close()
    }
  })

  it('restores the statement primitives when the instrumented body throws', async () => {
    const { StatementSync } = await import('node:sqlite')
    const originalAll = StatementSync.prototype.all
    const originalGet = StatementSync.prototype.get
    await expect(
      withServerLoadInstrumentation(() => {
        expect(StatementSync.prototype.all).not.toBe(originalAll)
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(StatementSync.prototype.all).toBe(originalAll)
    expect(StatementSync.prototype.get).toBe(originalGet)
  })
})
