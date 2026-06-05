import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { openDatabase } from '../src/db.js'
import {
  loadPersisted,
  loadPersistedForAssembly,
  loadPersistedWithMessages,
  loadSingleCharacterStubRow,
  loadStubProjection,
  loadStubbedProjectionFields,
} from '../src/repository.js'
import {
  MASKED_PROVIDER_SECRET,
  maskProviderSecrets,
  maskProviderSecretsInPlace,
} from '../src/providerSecrets.js'
import { emitProtocolMetric, protocolMetricsEnabled } from '../src/protocolMetrics.js'
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
// breadth. Phase 2 also flipped the former U1 bulk-hydration breadth control to
// scoped gates while keeping explicit broad-fallback controls for legacy
// pre-extraction states.

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

function hydrationGet(chatId: string) {
  return harness.app.inject({
    method: 'GET',
    url: `/api/v1/projection/chatMessages?id=${chatId}`,
    headers: { 'risu-auth': assertion },
  })
}

async function withJsonStringifySizeInstrumentation<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; stringifyCount: number; maxStringifiedSize: number }> {
  const original = JSON.stringify
  let stringifyCount = 0
  let maxStringifiedSize = 0
  JSON.stringify = function trackedStringify(
    this: unknown,
    value: unknown,
    replacer?: unknown,
    space?: unknown,
  ) {
    stringifyCount += 1
    const out = (original as (...args: unknown[]) => string).call(this, value, replacer, space)
    if (typeof out === 'string' && out.length > maxStringifiedSize) {
      maxStringifiedSize = out.length
    }
    return out
  } as typeof JSON.stringify

  try {
    return { result: await fn(), stringifyCount, maxStringifiedSize }
  } finally {
    JSON.stringify = original
  }
}

async function listen(): Promise<string> {
  await harness.app.listen({ host: '127.0.0.1', port: 0 })
  const address = harness.app.server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (text: string) => boolean,
): Promise<string> {
  const deadline = Date.now() + 2_000
  let text = ''
  while (Date.now() < deadline) {
    const result = await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) =>
        setTimeout(() => reject(new Error('timed out waiting for SSE data')), 250),
      ),
    ])
    if (result.done) break
    text += Buffer.from(result.value).toString('utf8')
    if (predicate(text)) return text
  }
  throw new Error(`timed out waiting for SSE data; received ${JSON.stringify(text)}`)
}

/** Run `fn` with `RISU_PROTOCOL_METRICS` forced to `value` ('' = off). */
async function withProtocolMetricsEnv<T>(value: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.RISU_PROTOCOL_METRICS
  if (value === '') {
    delete process.env.RISU_PROTOCOL_METRICS
  } else {
    process.env.RISU_PROTOCOL_METRICS = value
  }
  try {
    return await fn()
  } finally {
    if (previous === undefined) {
      delete process.env.RISU_PROTOCOL_METRICS
    } else {
      process.env.RISU_PROTOCOL_METRICS = previous
    }
  }
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
    // listPersistedCommandEventHistory (L10)
    expect(
      classifyCorpusStatement(
        'SELECT revision, type, resource, id, parent_id AS parentId FROM command_events ORDER BY revision ASC',
      ),
    ).toEqual({ table: 'command_events' })
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
    // The command-event prune threshold walk reads only the revision column.
    expect(
      classifyCorpusStatement(
        'SELECT revision FROM command_events ORDER BY revision DESC LIMIT 1 OFFSET ?',
      ),
    ).toBeNull()
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

  it('U1: bulk chat hydration performs zero whole-corpus payload reads, missing ids included', async () => {
    const fixture = buildLargeCorpusFixture()
    await importDatabase(fixture.database)

    // Audit U1 regression: `loadChatHydrations` paid a full `loadPersisted`
    // just to compute known ids and the embedded fallback. The known-id check
    // now reads only the requested chat rows; a genuinely unknown id resolves
    // to `missing` without the broad walk.
    const res = await assertScopedLoadOnHotPath(() =>
      harness.app.inject({
        method: 'POST',
        url: '/api/v1/projection/chatMessages/bulk',
        headers: { 'risu-auth': assertion },
        payload: { ids: [fixture.hot.chatId, fixture.noHypa.chatId, 'missing-chat'] },
      }),
    )
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.missing).toEqual(['missing-chat'])
    expect(body.chats).toHaveLength(2)

    // Each bulk row carries exactly what the single hydration route serves.
    for (const chat of body.chats) {
      const single = (await hydrationGet(chat.chatId)).json()
      expect(
        JSON.stringify({ m: chat.message, h: chat.hypaV3Data, a: chat.alternates }),
      ).toBe(JSON.stringify({ m: single.message, h: single.hypaV3Data, a: single.alternates }))
    }
    expect(body.chats[0].message).toHaveLength(fixture.hot.messageCount)
    expect(body.chats[0].hypaV3Data).toBeDefined()
    expect(body.chats[1].hypaV3Data).toBeUndefined()
  })

  it('H2: chat-create performs zero hydrated message loads and no full-database clone-sized stringify', async () => {
    const fixture = buildLargeCorpusFixture()
    const revision = await importDatabase(fixture.database)
    const fullHydratedDatabaseSize = JSON.stringify(fixture.database).length

    const { result: stringifyRun, loadCountByTable } = await withServerLoadInstrumentation(() =>
      withJsonStringifySizeInstrumentation(() =>
        harness.app.inject({
          method: 'POST',
          url: `/api/v1/commands/characters/${fixture.hot.characterId}/chats`,
          headers: { 'risu-auth': assertion },
          payload: {
            baseRevision: revision,
            chat: {
              id: 'h2-load-created-chat',
              name: 'H2 load created',
              note: '',
              localLore: [],
              message: [
                { role: 'user', data: 'created under H2 load guard', chatId: 'h2-load-msg-1' },
              ],
            },
          },
        }),
      ),
    )

    const res = stringifyRun.result
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      revision: revision + 1,
      chatId: 'h2-load-created-chat',
      selectedChatId: 'h2-load-created-chat',
      event: {
        type: 'chat.created',
        resource: 'chat',
        id: 'h2-load-created-chat',
        parentId: fixture.hot.characterId,
      },
    })

    // `loadPersistedWithMessages` would execute whole-table message/hypa reads;
    // the targeted writer kit only performs scoped/id lookups for the new chat.
    expect(loadCountByTable.messages ?? 0).toBe(0)
    expect(loadCountByTable.chat_hypa_v3 ?? 0).toBe(0)
    // A regression to `applyJsonCommandMutation` would call cloneJsonValue on
    // the hydrated database, producing a stringify around the full corpus size
    // (messages included). Legitimate targeted writes may still stringify
    // message-free rows/table payloads, so gate the old hydrated-clone signature.
    expect(stringifyRun.maxStringifiedSize).toBeLessThan(fullHydratedDatabaseSize * 0.75)

    const hydrated = await hydrationGet('h2-load-created-chat')
    expect(hydrated.statusCode).toBe(200)
    expect((hydrated.json().message as Array<{ chatId: string }>).map((m) => m.chatId)).toEqual([
      'h2-load-msg-1',
    ])
  })

  it('U1: bulk character-lorebook hydration performs zero whole-corpus payload reads', async () => {
    const fixture = buildLargeCorpusFixture()
    await importDatabase({ ...fixture.database, enableLorebookStubs: true })

    const charA = fixture.characters[0].chaId
    const charB = fixture.characters[1].chaId
    const res = await assertScopedLoadOnHotPath(() =>
      harness.app.inject({
        method: 'POST',
        url: '/api/v1/projection/characterLorebooks/bulk',
        headers: { 'risu-auth': assertion },
        payload: { ids: [charA, 'missing-char', charB] },
      }),
    )
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.missing).toEqual(['missing-char'])
    // The table stores the full un-stubbed globalLore; each bulk row carries
    // exactly what the single characterLorebook hydration route serves.
    expect(body.characters.map((row: { characterId: string }) => row.characterId)).toEqual([
      charA,
      charB,
    ])
    for (const row of body.characters) {
      const single = (
        await harness.app.inject({
          method: 'GET',
          url: `/api/v1/projection/characterLorebook?id=${row.characterId}`,
          headers: { 'risu-auth': assertion },
        })
      ).json()
      expect(row.globalLore).toHaveLength(fixture.characters[0].globalLore.length)
      expect(JSON.stringify(row.globalLore)).toBe(JSON.stringify(single.globalLore))
    }
  })

  it('U1: bulk hydration serves a legacy embedded-message chat row without the broad walk', async () => {
    const fixture = buildLargeCorpusFixture()
    await importDatabase(fixture.database)

    // A chats-table row that still embeds `message` with zero rows in the
    // messages table (legacy shape). The characters table is populated, so the
    // scoped known-id read is authoritative — and the row read already carries
    // the embedded fallback payload. (The single-chat hydration route keeps its
    // documented broad zero-row fallback; the bulk route is now stricter.)
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

    const res = await assertScopedLoadOnHotPath(() =>
      harness.app.inject({
        method: 'POST',
        url: '/api/v1/projection/chatMessages/bulk',
        headers: { 'risu-auth': assertion },
        payload: { ids: ['pre-extract-chat'] },
      }),
    )
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.missing).toEqual([])
    expect(body.chats[0].message).toEqual(embedded)
  })

  it('U1: bulk hydration keeps the broad fallback on a pre-extraction embedded-characters database', async () => {
    const fixture = buildLargeCorpusFixture()
    await importDatabase(fixture.database)

    const embedded = [{ role: 'user', data: 'embedded hi', chatId: 'em-1', time: 1700000000000 }]
    const db = openDatabase(harness.dataDir)
    try {
      // Simulate the legacy pre-extraction state: characters embedded in the
      // settings record with empty characters/chats tables. The chats table is
      // not the known-id authority here, so the loader must take the broad walk.
      const settingsRow = db.prepare('SELECT data_json FROM settings WHERE id = 1').get() as {
        data_json: string
      }
      const settings = JSON.parse(settingsRow.data_json) as Record<string, unknown>
      settings.characters = [
        {
          chaId: 'embedded-char',
          name: 'Embedded',
          chats: [{ id: 'embedded-chat', name: 'E', message: embedded }],
        },
      ]
      db.prepare('UPDATE settings SET data_json = ? WHERE id = 1').run(JSON.stringify(settings))
      db.exec('DELETE FROM chats')
      db.exec('DELETE FROM characters')
      db.exec('DELETE FROM messages')
      db.exec('DELETE FROM chat_hypa_v3')
    } finally {
      db.close()
    }

    const { result: res, corpusLoadCount } = await withServerLoadInstrumentation(() =>
      harness.app.inject({
        method: 'POST',
        url: '/api/v1/projection/chatMessages/bulk',
        headers: { 'risu-auth': assertion },
        payload: { ids: ['embedded-chat', 'missing-chat'] },
      }),
    )
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.missing).toEqual(['missing-chat'])
    expect(body.chats[0].message).toEqual(embedded)
    // The broad walk is the one legitimate consumer on this state.
    expect(corpusLoadCount).toBeGreaterThan(0)
  })

  it('M1: prompt assembly performs zero whole-corpus message/hypa payload reads', async () => {
    const fixture = buildLargeCorpusFixture()
    // The fixture is hydration-oriented; add the assembly settings the prompt
    // path needs (and drop the template so the `chats` history slot renders).
    await importDatabase({
      ...fixture.database,
      promptTemplate: undefined,
      formatingOrder: ['main', 'description', 'chats', 'lastChat'],
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: '',
        sendChatAsSystem: false,
        sendName: false,
        utilOverride: false,
      },
      mainPrompt: 'MAIN',
      maxContext: 100_000,
      maxResponse: 50,
    })

    // Audit M1 regression: assembly resolved its database through
    // `loadPersistedWithMessages`, paying the whole-table messages +
    // chat_hypa_v3 parse per send/preview. The scoped assembly loader joins
    // only the target chat; `loadPersisted`'s character/collection reads are
    // the path's legitimate remaining breadth.
    const { result: res, loadCountByTable } = await withServerLoadInstrumentation(() =>
      harness.app.inject({
        method: 'POST',
        url: '/api/v1/generate/preview-prompt',
        headers: { 'risu-auth': assertion },
        payload: { chatId: fixture.hot.chatId, characterId: fixture.hot.characterId },
      }),
    )
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.stopSending).toBeUndefined()
    // The target transcript actually hydrated: the hot chat's last message
    // body made it into the assembled rows.
    const lastMarker = `-0-0-${fixture.hot.messageCount - 1}`
    expect(JSON.stringify(body.messages)).toContain(lastMarker)
    expect(loadCountByTable.messages ?? 0).toBe(0)
    expect(loadCountByTable.chat_hypa_v3 ?? 0).toBe(0)
  })

  it('M1: the scoped assembly loader matches the broad loader on the target chat and stubs siblings', async () => {
    const fixture = buildLargeCorpusFixture()
    await importDatabase(fixture.database)

    type LoadedChat = { id?: unknown; message?: unknown[]; hypaV3Data?: unknown }
    const chatsById = (database: unknown): Map<string, LoadedChat> => {
      const out = new Map<string, LoadedChat>()
      const characters =
        (database as { characters?: Array<{ chats?: LoadedChat[] }> })?.characters ?? []
      for (const character of characters) {
        for (const chat of character.chats ?? []) {
          if (typeof chat.id === 'string') out.set(chat.id, chat)
        }
      }
      return out
    }

    const db = openDatabase(harness.dataDir)
    try {
      const broad = chatsById(loadPersistedWithMessages(db, harness.dataDir).database)
      const scopedRun = await withServerLoadInstrumentation(() =>
        loadPersistedForAssembly(db, harness.dataDir, fixture.hot.chatId),
      )
      // Scoped: zero whole-corpus payload reads of the message/hypa tables.
      expect(scopedRun.loadCountByTable.messages ?? 0).toBe(0)
      expect(scopedRun.loadCountByTable.chat_hypa_v3 ?? 0).toBe(0)

      const scoped = chatsById(scopedRun.result.database)
      expect([...scoped.keys()].sort()).toEqual([...broad.keys()].sort())

      // Target chat: identical to the broad loader (messages AND hypaV3Data).
      expect(scoped.get(fixture.hot.chatId)).toEqual(broad.get(fixture.hot.chatId))
      expect(scoped.get(fixture.hot.chatId)?.message).toHaveLength(fixture.hot.messageCount)

      // Every sibling chat: `message = []`, everything else identical.
      for (const [chatId, broadChat] of broad) {
        if (chatId === fixture.hot.chatId) continue
        const scopedChat = scoped.get(chatId)!
        expect(scopedChat.message).toEqual([])
        expect({ ...scopedChat, message: broadChat.message }).toEqual(broadChat)
      }
    } finally {
      db.close()
    }
  })

  it('M1: the scoped assembly loader keeps the embedded-copy fallback for a not-yet-extracted target chat', async () => {
    const fixture = buildLargeCorpusFixture()
    await importDatabase(fixture.database)

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

      const persisted = loadPersistedForAssembly(db, harness.dataDir, 'pre-extract-chat')
      const characters =
        (persisted.database as { characters?: Array<{ chats?: Array<Record<string, unknown>> }> })
          ?.characters ?? []
      const chat = characters
        .flatMap((character) => character.chats ?? [])
        .find((candidate) => candidate.id === 'pre-extract-chat')
      expect(chat?.message).toEqual(embedded)
    } finally {
      db.close()
    }
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

  it('M4: the characterRow projection performs zero whole-corpus payload reads', async () => {
    const fixture = buildLargeCorpusFixture()
    // The owned-row mask must still apply on the narrow path: give the target
    // character the one character-scoped secret (`oaiTTSConfig.apiKey`).
    ;(fixture.characters[0] as unknown as Record<string, unknown>).oaiTTSConfig = {
      enabled: true,
      apiKey: 'sk-tts-secret',
      model: 'tts-1',
    }
    await importDatabase(fixture.database)

    // Audit M4 regression: the route loaded ALL characters+chats and JSON-deep-
    // cloned the whole array just to `.find()` one row. The single-row loader +
    // in-place mask make the per-character projection a per-character read.
    const res = await assertScopedLoadOnHotPath(() =>
      harness.app.inject({
        method: 'GET',
        url: `/api/v1/projection/characterRow?id=${fixture.hot.characterId}`,
        headers: { 'risu-auth': assertion },
      }),
    )
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.mode).toBe('character-row')
    expect(body.characterId).toBe(fixture.hot.characterId)
    expect(body.character.chaId).toBe(fixture.hot.characterId)
    // The stub contract holds: chats present, message-free; secrets masked.
    expect(body.character.chats).toHaveLength(3)
    expect(body.character.chats.every((chat: { message: unknown[] }) => chat.message.length === 0)).toBe(true)
    expect(body.character.oaiTTSConfig.apiKey).toBe(MASKED_PROVIDER_SECRET)
  })

  it('M4: the single-row loader is byte-identical to the broad composition for every character', async () => {
    const fixture = buildLargeCorpusFixture()
    ;(fixture.characters[1] as unknown as Record<string, unknown>).oaiTTSConfig = {
      enabled: true,
      apiKey: 'sk-tts-secret',
      model: 'tts-1',
    }
    await importDatabase(fixture.database)

    const db = openDatabase(harness.dataDir)
    try {
      // The pre-M4 route composition: broad stubbed load + whole-array mask clone.
      const broadRows = maskProviderSecrets(
        loadStubbedProjectionFields(db, harness.dataDir, ['characters']),
      ).characters as Array<Record<string, unknown>>
      expect(broadRows).toHaveLength(fixture.characters.length)

      for (const broadRow of broadRows) {
        const scoped = await assertScopedLoadOnHotPath(() =>
          loadSingleCharacterStubRow(db, harness.dataDir, broadRow.chaId as string),
        )
        expect(scoped).not.toBeNull()
        // The route's masking shape on the owned row.
        const masked = maskProviderSecretsInPlace({ characters: [scoped!] }).characters[0]
        expect(JSON.stringify(masked)).toBe(JSON.stringify(broadRow))
      }

      // Unknown ids still resolve to null (the route's 404 contract).
      expect(loadSingleCharacterStubRow(db, harness.dataDir, 'no-such-character')).toBeNull()
    } finally {
      db.close()
    }
  })

  it('M4: the single-row loader respects enableLorebookStubs like the broad loader', async () => {
    const fixture = buildLargeCorpusFixture()
    await importDatabase({ ...fixture.database, enableLorebookStubs: true })

    const db = openDatabase(harness.dataDir)
    try {
      const scoped = await assertScopedLoadOnHotPath(() =>
        loadSingleCharacterStubRow(db, harness.dataDir, fixture.hot.characterId),
      )
      expect(scoped).not.toBeNull()
      expect(scoped).not.toHaveProperty('globalLore')

      const broadRow = (
        maskProviderSecrets(loadStubbedProjectionFields(db, harness.dataDir, ['characters']))
          .characters as Array<Record<string, unknown>>
      ).find((row) => row.chaId === fixture.hot.characterId)
      const masked = maskProviderSecretsInPlace({ characters: [scoped!] }).characters[0]
      expect(JSON.stringify(masked)).toBe(JSON.stringify(broadRow))
    } finally {
      db.close()
    }
  })

  it('M4: the single-row loader keeps the embedded-characters fallback (pre-extraction settings)', async () => {
    const fixture = buildLargeCorpusFixture()
    await importDatabase(fixture.database)

    const db = openDatabase(harness.dataDir)
    try {
      // Simulate the legacy pre-extraction state: characters embedded in the
      // settings record with empty characters/chats tables. The single-row
      // read cannot serve it, so the loader must fall back to the broad
      // stubbed loader (which keeps the embedded array).
      const settingsRow = db.prepare('SELECT data_json FROM settings WHERE id = 1').get() as {
        data_json: string
      }
      const settings = JSON.parse(settingsRow.data_json) as Record<string, unknown>
      settings.characters = [
        {
          chaId: 'embedded-char',
          name: 'Embedded',
          chats: [
            { id: 'embedded-chat', name: 'E', message: [{ role: 'user', data: 'embedded hi' }] },
          ],
        },
      ]
      db.prepare('UPDATE settings SET data_json = ? WHERE id = 1').run(JSON.stringify(settings))
      db.exec('DELETE FROM chats')
      db.exec('DELETE FROM characters')

      const row = loadSingleCharacterStubRow(db, harness.dataDir, 'embedded-char')
      expect(row?.chaId).toBe('embedded-char')
      // The fallback applies the same stub contract: message-free chats.
      expect((row?.chats as Array<Record<string, unknown>>)[0].message).toEqual([])
    } finally {
      db.close()
    }
  })

  it('M4: bootstrap in-place masking matches the copying mask byte-for-byte', async () => {
    const fixture = buildLargeCorpusFixture()
    await importDatabase({ ...fixture.database, openAIKey: 'sk-bootstrap-secret' })

    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.database.openAIKey).toBe(MASKED_PROVIDER_SECRET)

    const db = openDatabase(harness.dataDir)
    try {
      // Same wire bytes as the pre-M4 copying mask…
      const expected = maskProviderSecrets(loadStubProjection(db, harness.dataDir).database)
      expect(JSON.stringify(body.database)).toBe(JSON.stringify(expected))
      // …and the in-place mask never reaches the persisted rows.
      const onDisk = loadPersisted(db, harness.dataDir).database as Record<string, unknown>
      expect(onDisk.openAIKey).toBe('sk-bootstrap-secret')
    } finally {
      db.close()
    }
  })

  it('L10: a fresh (no-replay) SSE connect performs zero command-event history reads', async () => {
    const fixture = buildLargeCorpusFixture()
    await importDatabase(fixture.database)
    const baseUrl = await listen()
    const abort = new AbortController()

    try {
      // Audit L10 regression: every SSE connect loaded + mapped the full
      // command-event history even when no replay cursor was sent. A fresh
      // connect now performs zero corpus payload reads of any table.
      await withProtocolMetricsEnv('', () =>
        assertScopedLoadOnHotPath(async () => {
          const res = await fetch(`${baseUrl}/api/v1/events`, {
            headers: { 'risu-auth': assertion },
            signal: abort.signal,
          })
          expect(res.status).toBe(200)
          const reader = res.body!.getReader()
          try {
            await readUntil(reader, (text) => text.includes(': connected\n\n'))
          } finally {
            reader.releaseLock()
          }
        }),
      )
    } finally {
      abort.abort()
    }
  })

  it('L10: a replay connect still reads the history; so does a fresh connect with metrics on', async () => {
    const fixture = buildLargeCorpusFixture()
    await importDatabase(fixture.database)
    const revision = (
      await harness.app.inject({
        method: 'GET',
        url: '/api/v1/bootstrap',
        headers: { 'risu-auth': assertion },
      })
    ).json().revision as number
    const baseUrl = await listen()

    const connect = async (url: string): Promise<void> => {
      const abort = new AbortController()
      try {
        const res = await fetch(url, {
          headers: { 'risu-auth': assertion },
          signal: abort.signal,
        })
        expect(res.status).toBe(200)
        const reader = res.body!.getReader()
        try {
          await readUntil(reader, (text) => text.includes(': connected\n\n'))
        } finally {
          reader.releaseLock()
        }
      } finally {
        abort.abort()
      }
    }

    // Replay requested: the history load is the path's legitimate breadth.
    const replayRun = await withProtocolMetricsEnv('', () =>
      withServerLoadInstrumentation(() =>
        connect(`${baseUrl}/api/v1/events?sinceRevision=${revision}`),
      ),
    )
    expect(replayRun.loadCountByTable.command_events).toBeGreaterThanOrEqual(1)

    // Metrics on: the replay metric's oldest/latest fields keep their
    // fidelity, so the history still loads for a fresh connect.
    const metricsRun = await withProtocolMetricsEnv('1', () =>
      withServerLoadInstrumentation(() => connect(`${baseUrl}/api/v1/events`)),
    )
    expect(metricsRun.loadCountByTable.command_events).toBeGreaterThanOrEqual(1)
  })

  it('M5: metric fields are not built when metrics are off (and are identical when on)', async () => {
    // Unit guarantee on the real emitter: the thunk only runs after the
    // enabled guard.
    const thunk = vi.fn(() => ({ payloadBytes: 123 }))
    await withProtocolMetricsEnv('', async () => {
      emitProtocolMetric('m5_probe', thunk)
    })
    expect(thunk).not.toHaveBeenCalled()

    const logged: Record<string, unknown>[] = []
    const logger = { info: (payload: Record<string, unknown>) => logged.push(payload) }
    await withProtocolMetricsEnv('1', async () => {
      emitProtocolMetric('m5_probe', thunk, logger as never)
      emitProtocolMetric('m5_probe_eager', { payloadBytes: 123 }, logger as never)
    })
    expect(thunk).toHaveBeenCalledTimes(1)
    expect(logged[0]).toEqual({ metric: 'm5_probe', payloadBytes: 123 })
    expect(logged[1]).toEqual({ metric: 'm5_probe_eager', payloadBytes: 123 })
  })

  it('M5: projection and bootstrap responses are serialized once when metrics are off', async () => {
    const fixture = buildLargeCorpusFixture()
    await importDatabase(fixture.database)

    // Count JSON.stringify calls that receive the route's response object.
    // Metrics-on pays exactly one extra (the deferred `jsonPayloadBytes`);
    // metrics-off must not — before the fix both modes paid it.
    const countResponseStringifies = async (
      request: () => Promise<{ statusCode: number }>,
      isResponseShaped: (arg: unknown) => boolean,
    ): Promise<number> => {
      const spy = vi.spyOn(JSON, 'stringify')
      try {
        const res = await request()
        expect(res.statusCode).toBe(200)
        return spy.mock.calls.filter(([arg]) => isResponseShaped(arg)).length
      } finally {
        spy.mockRestore()
      }
    }

    const hydrationShaped = (arg: unknown): boolean =>
      !!arg &&
      typeof arg === 'object' &&
      (arg as { resource?: unknown }).resource === 'chatMessages' &&
      (arg as { mode?: unknown }).mode === 'chat-messages'
    const bootstrapShaped = (arg: unknown): boolean =>
      !!arg &&
      typeof arg === 'object' &&
      (arg as { assetBaseUrl?: unknown }).assetBaseUrl === '/api/v1/assets'

    const hydrate = () => hydrationGet(fixture.hot.chatId)
    const bootstrap = () =>
      harness.app.inject({
        method: 'GET',
        url: '/api/v1/bootstrap',
        headers: { 'risu-auth': assertion },
      })

    const hydrationOff = await withProtocolMetricsEnv('', () =>
      countResponseStringifies(hydrate, hydrationShaped),
    )
    const hydrationOn = await withProtocolMetricsEnv('1', () =>
      countResponseStringifies(hydrate, hydrationShaped),
    )
    expect(hydrationOn).toBe(hydrationOff + 1)

    const bootstrapOff = await withProtocolMetricsEnv('', () =>
      countResponseStringifies(bootstrap, bootstrapShaped),
    )
    const bootstrapOn = await withProtocolMetricsEnv('1', () =>
      countResponseStringifies(bootstrap, bootstrapShaped),
    )
    expect(bootstrapOn).toBe(bootstrapOff + 1)
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
