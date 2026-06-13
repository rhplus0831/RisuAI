import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs, { mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { StatementSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { runAssetGc } from '../src/assetGc.js'
import { openDatabase } from '../src/db.js'
import type { CompletionStreamFrame } from '../src/generation/frames.js'
import {
  insertAssetMetadataBatch,
  loadBootstrapProjectionDatabase,
  loadPersisted,
  loadPersistedForAssembly,
  loadPersistedWithMessages,
  loadSingleCharacterStubRow,
  loadStubProjection,
  loadStubbedProjectionFields,
  type PersistedAsset,
} from '../src/repository.js'
import { MASKED_PROVIDER_SECRET, maskProviderSecrets, maskProviderSecretsInPlace } from '../src/providerSecrets.js'
import { emitProtocolMetric, protocolMetricsEnabled } from '../src/protocolMetrics.js'
import {
  appendActiveChatMessageTail,
  applyChatMessageDiff,
  getChatMessageDiffInstrumentation,
  getChatMessagesGroupedByIds,
  replaceChatMessages,
  resetChatMessageDiffInstrumentation,
} from '../src/messageStore.js'
import {
  getAssemblyMessageCaptureInstrumentation,
  resetAssemblyMessageCaptureInstrumentation,
} from '../src/prompt/assemble.js'
import {
  getChatDispatchReformatInstrumentation,
  resetChatDispatchReformatInstrumentation,
} from '../src/prompt/chatDispatch.js'
import { getPromptAssetTableInstrumentation, resetPromptAssetTableInstrumentation } from '../src/prompt/promptAssets.js'
import { getTriggerCloneInstrumentation, resetTriggerCloneInstrumentation } from '../src/prompt/triggers.js'
import { createMemoryChunk, createMemoryEmbedding, createMemorySummary } from '../src/memoryRepository.js'
import { resourceProjectionFields } from '../src/routes/projection.js'
import { setupAuthedClient } from './helpers/auth.js'
import {
  assertScopedLoadOnHotPath,
  classifyCorpusStatement,
  withServerLoadInstrumentation,
} from './helpers/loadCostHarness.js'
import type { GenerationChatRouteOptions } from '../src/routes/generationChat.js'
import { buildLargeCorpusFixture, type LargeCorpusFixture } from '../../../src/ts/__tests__/largeCorpusFixture.js'

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

type JsonRecord = Record<string, unknown>

interface MemorySummaryPayloadReadObservation {
  method: 'all' | 'get' | 'iterate'
  sql: string
}

let harness: Harness
let assertion: string

async function startHarness(generationChat?: GenerationChatRouteOptions): Promise<Harness> {
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
    generationChat,
  })
  return { app, dataDir }
}

beforeEach(async () => {
  harness = await startHarness()
  ;({ assertion } = await setupAuthedClient(harness.app))
})

afterEach(async () => {
  resetTriggerCloneInstrumentation()
  await harness.app.close()
  rmSync(harness.dataDir, { recursive: true, force: true })
})

async function restartHarness(generationChat: GenerationChatRouteOptions): Promise<void> {
  await harness.app.close()
  rmSync(harness.dataDir, { recursive: true, force: true })
  harness = await startHarness(generationChat)
  ;({ assertion } = await setupAuthedClient(harness.app))
}

async function importDatabase(database: unknown): Promise<number> {
  const res = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/import/risusave',
    headers: { 'risu-auth': assertion },
    payload: { database },
  })
  expect(res.statusCode).toBe(200)
  const imported = res.json() as { revision: number }
  return configureImportedCurrentChatGenerationSettings(database, imported.revision)
}

async function configureImportedCurrentChatGenerationSettings(
  database: unknown,
  baseRevision: number,
): Promise<number> {
  const chatSettings = activeChatGenerationSettings(database)
  if (!chatSettings) return baseRevision

  const res = await harness.app.inject({
    method: 'PUT',
    url: `/api/v1/commands/chats/${encodeURIComponent(chatSettings.chatId)}/generation-settings`,
    headers: { 'risu-auth': assertion },
    payload: {
      baseRevision,
      generationSettings: {
        ...chatSettings.generationSettings,
        configured: true,
      },
    },
  })
  expect(res.statusCode).toBe(200)
  return (res.json() as { revision: number }).revision
}

function activeChatGenerationSettings(database: unknown): { chatId: string; generationSettings: JsonRecord } | null {
  if (!isJsonRecord(database)) return null
  const characters = Array.isArray(database.characters) ? database.characters : []
  const currentCharIndex = Number.isInteger(database.currentChar as number) ? (database.currentChar as number) : 0
  const character = findRecordAt(characters, currentCharIndex) ?? findRecordAt(characters, 0)
  if (!character) return null

  const chats = Array.isArray(character.chats) ? character.chats : []
  const chatPage = Number.isInteger(character.chatPage as number) ? (character.chatPage as number) : 0
  const chat = findRecordAt(chats, chatPage) ?? findRecordAt(chats, 0)
  if (!chat || typeof chat.id !== 'string') return null
  const generationSettings = chat.generationSettings
  if (!isJsonRecord(generationSettings)) return null
  if (!generationSettingReferencesExist(database, generationSettings)) return null

  return {
    chatId: chat.id,
    generationSettings,
  }
}

function generationSettingReferencesExist(database: JsonRecord, settings: JsonRecord): boolean {
  return (
    typeof settings.personaId === 'string' &&
    collectionHasId(database.personas, settings.personaId) &&
    typeof settings.presetId === 'string' &&
    collectionHasId(database.botPresets, settings.presetId)
  )
}

function collectionHasId(collection: unknown, id: string): boolean {
  return Array.isArray(collection) && collection.some((row) => isJsonRecord(row) && row.id === id)
}

function findRecordAt(collection: unknown[], index: number): JsonRecord | null {
  const value = collection[index]
  return isJsonRecord(value) ? value : null
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function promptReadyLargeCorpusDatabase(fixture: LargeCorpusFixture): Record<string, unknown> {
  const promptSettings = {
    assistantPrefill: '',
    postEndInnerFormat: '',
    sendChatAsSystem: false,
    sendName: false,
    utilOverride: false,
  }
  const database: Record<string, unknown> = {
    ...structuredClone(fixture.database),
    promptTemplate: undefined,
    formatingOrder: ['main', 'description', 'chats', 'lastChat'],
    promptSettings,
    mainPrompt: 'MAIN',
    maxContext: 100_000,
    maxResponse: 50,
  }
  const botPresets = Array.isArray(database.botPresets) ? (database.botPresets as Array<Record<string, unknown>>) : []
  if (botPresets[0]) {
    const promptReadyPreset: Record<string, unknown> = {
      ...botPresets[0],
      mainPrompt: database.mainPrompt,
      formatingOrder: database.formatingOrder,
      promptSettings,
      maxContext: database.maxContext,
      maxResponse: database.maxResponse,
      customPromptTemplateToggle: '',
    }
    delete promptReadyPreset.promptTemplate
    botPresets[0] = promptReadyPreset
    database.botPresets = botPresets
  }
  return database
}

function isMemorySummaryPayloadRead(sql: string): boolean {
  const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim()
  return (
    normalized.startsWith('select *') &&
    /\bfrom memory_summaries\b/.test(normalized) &&
    !/\bchunk_id\s*=/.test(normalized)
  )
}

async function withMemorySummaryPayloadReadCount<T>(
  fn: () => T | Promise<T>,
): Promise<{ result: T; reads: MemorySummaryPayloadReadObservation[] }> {
  const reads: MemorySummaryPayloadReadObservation[] = []
  const proto = StatementSync.prototype as unknown as Record<
    MemorySummaryPayloadReadObservation['method'],
    (...args: unknown[]) => unknown
  >
  const originals = {
    all: proto.all,
    get: proto.get,
    iterate: proto.iterate,
  }

  for (const method of ['all', 'get', 'iterate'] as const) {
    const original = originals[method]
    proto[method] = function tracked(this: StatementSync, ...args: unknown[]) {
      if (isMemorySummaryPayloadRead(this.sourceSQL)) {
        reads.push({ method, sql: this.sourceSQL })
      }
      return original.apply(this, args)
    }
  }

  try {
    return { result: await fn(), reads }
  } finally {
    proto.all = originals.all
    proto.get = originals.get
    proto.iterate = originals.iterate
  }
}

function createPausedProvider(text: string): {
  generationChat: GenerationChatRouteOptions
  waitForProvider: Promise<void>
  release: () => void
} {
  let resolveReady!: () => void
  let resolveRelease!: () => void
  const waitForProvider = new Promise<void>((resolve) => {
    resolveReady = resolve
  })
  const releasePromise = new Promise<void>((resolve) => {
    resolveRelease = resolve
  })

  return {
    waitForProvider,
    release: resolveRelease,
    generationChat: {
      dispatchProvider: () => {
        async function* source(): AsyncGenerator<CompletionStreamFrame> {
          resolveReady()
          await releasePromise
          yield { kind: 'token', content: text }
          yield { kind: 'done', finishReason: 'stop' }
        }
        return source()
      },
    },
  }
}

function hydrationGet(chatId: string) {
  return harness.app.inject({
    method: 'GET',
    url: `/api/v1/projection/chatMessages?id=${chatId}`,
    headers: { 'risu-auth': assertion },
  })
}

function characterLorebookGet(characterId: string) {
  return harness.app.inject({
    method: 'GET',
    url: `/api/v1/projection/characterLorebook?id=${characterId}`,
    headers: { 'risu-auth': assertion },
  })
}

function selectFields(database: Record<string, unknown>, fieldKeys: readonly string[]): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  for (const key of fieldKeys) {
    if (Object.prototype.hasOwnProperty.call(database, key)) {
      fields[key] = database[key]
    }
  }
  return fields
}

function asset(id: string): PersistedAsset {
  return { id, ext: 'png', size: 1, contentType: 'image/png' }
}

async function withJsonStringifySizeInstrumentation<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; stringifyCount: number; maxStringifiedSize: number }> {
  const original = JSON.stringify
  let stringifyCount = 0
  let maxStringifiedSize = 0
  JSON.stringify = function trackedStringify(this: unknown, value: unknown, replacer?: unknown, space?: unknown) {
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
      classifyCorpusStatement('SELECT chat_id, json FROM messages WHERE alternate = 0 ORDER BY chat_id, seq'),
    ).toEqual({ table: 'messages' })
    // getAllChatHypaV3Grouped
    expect(classifyCorpusStatement('SELECT chat_id, json FROM chat_hypa_v3')).toEqual({
      table: 'chat_hypa_v3',
    })
    // loadCharactersFromSqlite (both statements)
    expect(classifyCorpusStatement('SELECT id, position, data_json FROM characters ORDER BY position')).toEqual({
      table: 'characters',
    })
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
    expect(classifyCorpusStatement('SELECT id, ext, size, content_type FROM assets ORDER BY id')).toEqual({
      table: 'assets',
    })
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
      classifyCorpusStatement('SELECT json FROM messages WHERE chat_id = ? AND alternate = 0 ORDER BY seq'),
    ).toBeNull()
    expect(
      classifyCorpusStatement(
        'SELECT chat_id, json FROM messages WHERE alternate = 0 AND chat_id IN (?, ?) ORDER BY chat_id, seq',
      ),
    ).toBeNull()
    expect(classifyCorpusStatement('SELECT json FROM chat_hypa_v3 WHERE chat_id = ?')).toBeNull()
    expect(classifyCorpusStatement('SELECT id, ext, size, content_type FROM assets WHERE id = ?')).toBeNull()
    expect(
      classifyCorpusStatement("SELECT json_extract(data_json, '$.image') AS image FROM characters ORDER BY position"),
    ).toBeNull()
    // Id-only scans stay cheap and do not count.
    expect(classifyCorpusStatement('SELECT DISTINCT chat_id FROM messages WHERE alternate = 0')).toBeNull()
    expect(classifyCorpusStatement('SELECT chat_id FROM chat_hypa_v3')).toBeNull()
    // The command-event prune threshold walk reads only the revision column.
    expect(
      classifyCorpusStatement('SELECT revision FROM command_events ORDER BY revision DESC LIMIT 1 OFFSET ?'),
    ).toBeNull()
    expect(
      classifyCorpusStatement('SELECT COUNT(*) AS count FROM messages WHERE chat_id = ? AND alternate = 0'),
    ).toBeNull()
    // Non-corpus tables (settings is one bounded row).
    expect(classifyCorpusStatement('SELECT data_json FROM settings WHERE id = 1')).toBeNull()
    expect(classifyCorpusStatement('SELECT version, revision FROM schema_version WHERE id = 1')).toBeNull()
    // Writes.
    expect(classifyCorpusStatement('INSERT INTO characters (id, position, data_json) VALUES (?, ?, ?)')).toBeNull()
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
      console.info(`[load-cost] H1 guarded hydration (no-hypa chat): ${scopedMs.toFixed(1)}ms, 0 corpus loads`)
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
      db.prepare('INSERT INTO chats (id, character_id, position, data_json) VALUES (?, ?, ?, ?)').run(
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

    const {
      result: res,
      corpusLoadCount,
      loadCountByTable,
    } = await withServerLoadInstrumentation(() => hydrationGet('pre-extract-chat'))
    expect(res.statusCode).toBe(200)
    expect(res.json().message).toEqual(embedded)
    // The zero-row fallback is the one legitimate broad consumer on this route:
    // it still walks `loadPersisted` to find the embedded copy…
    expect(corpusLoadCount).toBeGreaterThan(0)
    expect(loadCountByTable.characters).toBeGreaterThanOrEqual(1)
    expect(loadCountByTable.chats).toBeGreaterThanOrEqual(1)

    // …so the scoped-load assertion still fails for it — the harness can gate.
    await expect(assertScopedLoadOnHotPath(() => hydrationGet('pre-extract-chat'))).rejects.toThrow(
      /whole-corpus payload read/,
    )
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
      expect(JSON.stringify({ m: chat.message, h: chat.hypaV3Data, a: chat.alternates })).toBe(
        JSON.stringify({ m: single.message, h: single.hypaV3Data, a: single.alternates }),
      )
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
              message: [{ role: 'user', data: 'created under H2 load guard', chatId: 'h2-load-msg-1' }],
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
    expect((hydrated.json().message as Array<{ chatId: string }>).map((m) => m.chatId)).toEqual(['h2-load-msg-1'])
  })

  it('L14: append-only message diff cost stays constant with long prefixes', () => {
    const db = openDatabase(harness.dataDir)
    try {
      const base = Array.from({ length: 256 }, (_, index) => ({
        chatId: `l14-msg-${index}`,
        role: index % 2 === 0 ? 'user' : 'char',
        data: `message ${index}`,
      }))
      const next = [...base, { chatId: 'l14-msg-tail', role: 'char', data: 'new tail' }]
      replaceChatMessages(db, 'l14-chat', base)

      resetChatMessageDiffInstrumentation()
      expect(appendActiveChatMessageTail(db, 'l14-chat', next, base.length)).toBe(true)
      expect(getChatMessageDiffInstrumentation()).toMatchObject({
        stableEqualCalls: 0,
        stableEqualStringifies: 0,
        appendFastPathRows: 1,
      })

      resetChatMessageDiffInstrumentation()
      applyChatMessageDiff(db, 'l14-chat', next, [
        ...next.slice(0, 200),
        { ...next[200], data: 'edited prefix row' },
        ...next.slice(201),
      ])
      expect(getChatMessageDiffInstrumentation().stableEqualCalls).toBeGreaterThan(100)

      resetChatMessageDiffInstrumentation()
      applyChatMessageDiff(db, 'l14-chat', next, next.slice(0, next.length - 1))
      expect(getChatMessageDiffInstrumentation().stableEqualCalls).toBeGreaterThan(100)
    } finally {
      db.close()
    }
  })

  it('L14: single character-lorebook hydration performs zero whole-corpus payload reads', async () => {
    const fixture = buildLargeCorpusFixture()
    await importDatabase({ ...fixture.database, enableLorebookStubs: true })

    const characterId = fixture.characters[0].chaId
    const bulk = await assertScopedLoadOnHotPath(() =>
      harness.app.inject({
        method: 'POST',
        url: '/api/v1/projection/characterLorebooks/bulk',
        headers: { 'risu-auth': assertion },
        payload: { ids: [characterId] },
      }),
    )
    expect(bulk.statusCode).toBe(200)
    const bulkBody = bulk.json()
    expect(bulkBody.characters).toHaveLength(1)
    expect(bulkBody.missing).toEqual([])

    const single = await assertScopedLoadOnHotPath(() => characterLorebookGet(characterId))
    expect(single.statusCode).toBe(200)
    const singleBody = single.json()
    expect(singleBody).toMatchObject({
      resource: 'characterLorebook',
      mode: 'character-lorebook',
      characterId,
    })
    expect(singleBody.globalLore).toEqual(bulkBody.characters[0].globalLore)
    expect(singleBody.globalLore).toHaveLength(fixture.characters[0].globalLore.length)
    const expectedFirstLore = fixture.characters[0].globalLore[0] as Record<string, unknown>
    expect(singleBody.globalLore[0]).toMatchObject(expectedFirstLore)

    const missing = await assertScopedLoadOnHotPath(() => characterLorebookGet('missing-char'))
    expect(missing.statusCode).toBe(200)
    expect(missing.json()).toMatchObject({
      mode: 'character-lorebook',
      characterId: 'missing-char',
      globalLore: [],
    })
  })

  it('L14: single character-lorebook hydration keeps the broad pre-extraction fallback', async () => {
    const fixture = buildLargeCorpusFixture()
    await importDatabase({ ...fixture.database, enableLorebookStubs: true })

    const embeddedLore = [{ key: 'embedded', content: 'legacy embedded lore' }]
    const db = openDatabase(harness.dataDir)
    try {
      const settingsRow = db.prepare('SELECT data_json FROM settings WHERE id = 1').get() as {
        data_json: string
      }
      const settings = JSON.parse(settingsRow.data_json) as Record<string, unknown>
      settings.characters = [
        {
          chaId: 'embedded-char',
          name: 'Embedded',
          globalLore: embeddedLore,
        },
      ]
      db.prepare('UPDATE settings SET data_json = ? WHERE id = 1').run(JSON.stringify(settings))
      db.exec('DELETE FROM chats')
      db.exec('DELETE FROM characters')
    } finally {
      db.close()
    }

    const { result: res, corpusLoadCount } = await withServerLoadInstrumentation(() =>
      characterLorebookGet('embedded-char'),
    )
    expect(res.statusCode).toBe(200)
    expect(res.json().globalLore).toEqual(embeddedLore)
    expect(corpusLoadCount).toBeGreaterThan(0)
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
    expect(body.characters.map((row: { characterId: string }) => row.characterId)).toEqual([charA, charB])
    for (const row of body.characters) {
      const single = (await assertScopedLoadOnHotPath(() => characterLorebookGet(row.characterId))).json()
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
      db.prepare('INSERT INTO chats (id, character_id, position, data_json) VALUES (?, ?, ?, ?)').run(
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
    await importDatabase(promptReadyLargeCorpusDatabase(fixture))

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

  it('M1: no-var editinput transcript replacement adds zero whole-corpus loads', async () => {
    const fixture = buildLargeCorpusFixture()

    await importDatabase(promptReadyLargeCorpusDatabase(fixture))
    const plainRun = await withServerLoadInstrumentation(() =>
      harness.app.inject({
        method: 'POST',
        url: '/api/v1/generate/chat',
        headers: { 'risu-auth': assertion },
        payload: {
          chatId: fixture.hot.chatId,
          characterId: fixture.hot.characterId,
          mode: 'send',
          userMessage: 'hi',
        },
      }),
    )
    expect(plainRun.result.statusCode).toBe(200)

    const editinputDatabase = promptReadyLargeCorpusDatabase(fixture)
    const hotCharacter = (editinputDatabase.characters as Array<Record<string, unknown>>).find(
      (character) => character.chaId === fixture.hot.characterId,
    )
    if (!hotCharacter) throw new Error('large-corpus hot character missing')
    hotCharacter.customscript = [{ in: 'hi', out: 'HELLO', type: 'editinput', flag: '', ableFlag: false }]

    await importDatabase(editinputDatabase)
    const editinputRun = await withServerLoadInstrumentation(() =>
      harness.app.inject({
        method: 'POST',
        url: '/api/v1/generate/chat',
        headers: { 'risu-auth': assertion },
        payload: {
          chatId: fixture.hot.chatId,
          characterId: fixture.hot.characterId,
          mode: 'send',
          userMessage: 'hi',
        },
      }),
    )
    expect(editinputRun.result.statusCode).toBe(200)
    expect(editinputRun.result.body).toContain('HELLO')
    expect(editinputRun.corpusLoadCount).toBe(plainRun.corpusLoadCount)
    expect(editinputRun.loadCountByTable).toEqual(plainRun.loadCountByTable)
  })

  it('L1: image-bearing chat send performs zero assembly-time readFileSync asset reads', async () => {
    const fixture = buildLargeCorpusFixture({ hotChatMessageCount: 1 })
    const database = promptReadyLargeCorpusDatabase(fixture)
    const assetBytes = Buffer.from('l1-image-bytes')
    const upload = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      headers: { 'risu-auth': assertion, 'content-type': 'image/png' },
      payload: assetBytes,
    })
    expect(upload.statusCode).toBe(201)
    const assetId = upload.json().assetId as string

    const hotCharacter = (database.characters as Array<Record<string, unknown>>).find(
      (character) => character.chaId === fixture.hot.characterId,
    )
    if (!hotCharacter) throw new Error('large-corpus hot character missing')
    hotCharacter.additionalAssets = [['hero', assetId, '']]
    const hotChat = (hotCharacter.chats as Array<Record<string, unknown>>).find(
      (chat) => chat.id === fixture.hot.chatId,
    )
    if (!hotChat) throw new Error('large-corpus hot chat missing')
    hotChat.message = [
      {
        role: 'user',
        data: 'look {{asset_prompt::hero}}',
        chatId: 'l1-image-row',
      },
    ]
    await importDatabase(database)

    const assetFile = path.join(harness.dataDir, 'assets', `${assetId}.png`)
    const readFileSyncSpy = vi.spyOn(fs, 'readFileSync')
    try {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/generate/chat',
        headers: { 'risu-auth': assertion },
        payload: {
          chatId: fixture.hot.chatId,
          characterId: fixture.hot.characterId,
          mode: 'send',
          userMessage: 'hi',
        },
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain(`data:image/png;base64,${assetBytes.toString('base64')}`)
      expect(readFileSyncSpy.mock.calls.filter(([file]) => file === assetFile)).toHaveLength(0)
    } finally {
      readFileSyncSpy.mockRestore()
    }
  })

  it('L6: image-bearing chat send builds one shared asset table per assembly', async () => {
    const fixture = buildLargeCorpusFixture({ hotChatMessageCount: 2 })
    const database = promptReadyLargeCorpusDatabase(fixture)
    const charAssetBytes = Buffer.from('l6-char-image-bytes')
    const moduleAssetBytes = Buffer.from('l6-module-image-bytes')
    const charUpload = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      headers: { 'risu-auth': assertion, 'content-type': 'image/png' },
      payload: charAssetBytes,
    })
    expect(charUpload.statusCode).toBe(201)
    const moduleUpload = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      headers: { 'risu-auth': assertion, 'content-type': 'image/png' },
      payload: moduleAssetBytes,
    })
    expect(moduleUpload.statusCode).toBe(201)
    const charAssetId = charUpload.json().assetId as string
    const moduleAssetId = moduleUpload.json().assetId as string

    const hotCharacter = (database.characters as Array<Record<string, unknown>>).find(
      (character) => character.chaId === fixture.hot.characterId,
    )
    if (!hotCharacter) throw new Error('large-corpus hot character missing')
    hotCharacter.additionalAssets = [['hero', charAssetId, '']]
    hotCharacter.modules = ['mod-assets']
    const hotChat = (hotCharacter.chats as Array<Record<string, unknown>>).find(
      (chat) => chat.id === fixture.hot.chatId,
    )
    if (!hotChat) throw new Error('large-corpus hot chat missing')
    hotChat.message = [
      {
        role: 'user',
        data: 'look {{asset_prompt::hero}}',
        chatId: 'l6-char-asset-row',
      },
      {
        role: 'char',
        data: 'module {{asset_prompt::moduleHero}} and {{asset_prompt::hero}} again',
        chatId: 'l6-module-asset-row',
      },
    ]
    database.modules = [
      {
        id: 'mod-assets',
        name: 'Asset Module',
        assets: [['moduleHero', moduleAssetId, '']],
      },
    ]
    await importDatabase(database)

    resetPromptAssetTableInstrumentation()
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: {
        chatId: fixture.hot.chatId,
        characterId: fixture.hot.characterId,
        mode: 'send',
        userMessage: 'hi',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain(`data:image/png;base64,${charAssetBytes.toString('base64')}`)
    expect(res.body).toContain(`data:image/png;base64,${moduleAssetBytes.toString('base64')}`)
    expect(getPromptAssetTableInstrumentation()).toEqual({ builds: 1 })
  })

  it('L20: prompt memory cleanup and selection share one summary payload read', async () => {
    const fixture = buildLargeCorpusFixture({ hotChatMessageCount: 12 })
    await importDatabase({
      ...promptReadyLargeCorpusDatabase(fixture),
      hypaV3: true,
      hypaModel: 'embedding-model',
      characters: fixture.characters.map((character, index) =>
        index === 0 ? { ...character, supaMemory: true } : character,
      ),
      hypaV3Presets: [
        {
          name: 'Test',
          settings: {
            summarizationModel: 'summary-model',
            memoryTokensRatio: 0.2,
            recentMemoryRatio: 1,
            similarMemoryRatio: 0,
          },
        },
      ],
      hypaV3PresetId: 0,
    })

    const db = openDatabase(harness.dataDir)
    try {
      createMemoryChunk(db, {
        id: 'chunk-l20-selected',
        chatId: fixture.hot.chatId,
        rangeStartSeq: 0,
        rangeEndSeq: 1,
        text: 'L20 selected summary',
        status: 'summarized',
      })
      createMemorySummary(db, {
        id: 'summary-l20-selected',
        chatId: fixture.hot.chatId,
        chunkId: 'chunk-l20-selected',
        model: 'summary-model',
        text: 'L20 selected summary',
        metadata: {
          chatMemos: Array.from({ length: fixture.hot.messageCount }, (_unused, index) => `corpus-msg-0-0-${index}`),
        },
        tokens: 4,
      })
      createMemoryEmbedding(db, {
        id: 'embedding-l20-selected',
        chatId: fixture.hot.chatId,
        chunkId: 'chunk-l20-selected',
        model: 'embedding-model',
        vector: [1, 0],
      })
    } finally {
      db.close()
    }

    const observed = await withMemorySummaryPayloadReadCount(() =>
      harness.app.inject({
        method: 'POST',
        url: '/api/v1/generate/preview-prompt',
        headers: { 'risu-auth': assertion },
        payload: { chatId: fixture.hot.chatId, characterId: fixture.hot.characterId },
      }),
    )

    expect(observed.result.statusCode).toBe(200)
    expect(JSON.stringify(observed.result.json().messages)).toContain('L20 selected summary')
    expect(observed.reads).toHaveLength(1)
  })

  it('M1: the scoped assembly loader matches the broad loader on the target chat and stubs siblings', async () => {
    const fixture = buildLargeCorpusFixture()
    await importDatabase(fixture.database)

    type LoadedChat = { id?: unknown; message?: unknown[]; hypaV3Data?: unknown }
    const chatsById = (database: unknown): Map<string, LoadedChat> => {
      const out = new Map<string, LoadedChat>()
      const characters = (database as { characters?: Array<{ chats?: LoadedChat[] }> })?.characters ?? []
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
      db.prepare('INSERT INTO chats (id, character_id, position, data_json) VALUES (?, ?, ?, ?)').run(
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
        (persisted.database as { characters?: Array<{ chats?: Array<Record<string, unknown>> }> })?.characters ?? []
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
      const broad = await withServerLoadInstrumentation(() => loadPersistedWithMessages(db, harness.dataDir))
      expect(broad.loadCountByTable.messages).toBeGreaterThanOrEqual(1)
      expect(broad.loadCountByTable.characters).toBeGreaterThanOrEqual(1)
      expect(broad.corpusLoadCount).toBeGreaterThanOrEqual(3)

      // …and the scoped per-id loader is silent, with identical row results.
      const scoped = await assertScopedLoadOnHotPath(() => getChatMessagesGroupedByIds(db, [fixture.hot.chatId]))
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
      const broadRows = maskProviderSecrets(loadStubbedProjectionFields(db, harness.dataDir, ['characters']))
        .characters as Array<Record<string, unknown>>
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
        maskProviderSecrets(loadStubbedProjectionFields(db, harness.dataDir, ['characters'])).characters as Array<
          Record<string, unknown>
        >
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
          chats: [{ id: 'embedded-chat', name: 'E', message: [{ role: 'user', data: 'embedded hi' }] }],
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

  it('M6: foreign field projections skip character and chat table payload reads', async () => {
    const fixture = buildLargeCorpusFixture()
    const database = {
      ...fixture.database,
      botPresets: [{ id: 'preset-a', name: 'Preset A', openAIKey: 'sk-preset-secret' }],
      botPresetsId: 3,
      currentPluginProvider: 'plugin-a',
      enabledModules: ['mod-a'],
      modules: [{ id: 'mod-a', name: 'Module A', description: '' }],
      plugins: [{ id: 'plugin-a', name: 'Plugin A', enabled: true }],
    }
    const revision = await importDatabase(database)

    const db = openDatabase(harness.dataDir)
    try {
      const broadDatabase = loadPersisted(db, harness.dataDir).database as Record<string, unknown>
      for (const resource of ['preset', 'plugin', 'moduleEnabled'] as const) {
        const fieldKeys = resourceProjectionFields(resource)
        expect(fieldKeys).not.toBeNull()
        const expected = {
          revision,
          resource,
          mode: 'fields',
          fields: maskProviderSecrets(selectFields(broadDatabase, fieldKeys!)),
        }

        const observed = await withServerLoadInstrumentation(() =>
          harness.app.inject({
            method: 'GET',
            url: `/api/v1/projection/${resource}`,
            headers: { 'risu-auth': assertion },
          }),
        )

        expect(observed.result.statusCode).toBe(200)
        expect(observed.result.body).toBe(JSON.stringify(expected))
        expect(observed.loadCountByTable.characters ?? 0).toBe(0)
        expect(observed.loadCountByTable.chats ?? 0).toBe(0)
      }
    } finally {
      db.close()
    }
  })

  it('L3: server-intent completion performs zero loadPersisted-shaped corpus reads', async () => {
    const fixture = buildLargeCorpusFixture()
    await importDatabase({
      ...fixture.database,
      aiModel: 'echo_model',
      subModel: 'echo_model',
      echoMessage: 'settings-sized pong',
      echoDelay: 0,
      maxResponse: 50,
      temperature: 50,
    })

    const {
      result: res,
      corpusLoadCount,
      loadCountByTable,
    } = await withServerLoadInstrumentation(() =>
      harness.app.inject({
        method: 'POST',
        url: '/api/v1/generate/completion',
        headers: { 'risu-auth': assertion },
        payload: {
          kind: 'server-intent',
          messages: [{ role: 'user', content: 'hi' }],
          stream: false,
          mode: 'model',
        },
      }),
    )

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ type: 'success', result: 'settings-sized pong' })
    expect(corpusLoadCount).toBe(0)
    expect(loadCountByTable.characters ?? 0).toBe(0)
    expect(loadCountByTable.chats ?? 0).toBe(0)
  })

  it('Phase 7 L3/K3: default chat dispatch performs zero prompt and restoration clones', async () => {
    const fixture = buildLargeCorpusFixture()
    await importDatabase({
      ...promptReadyLargeCorpusDatabase(fixture),
      aiModel: 'echo_model',
      subModel: 'echo_model',
      echoMessage: 'clone-count pong',
      echoDelay: 0,
    })
    resetChatDispatchReformatInstrumentation()
    resetAssemblyMessageCaptureInstrumentation()

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: {
        chatId: fixture.hot.chatId,
        characterId: fixture.hot.characterId,
        mode: 'send',
        userMessage: 'hi',
        durable: false,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('clone-count pong')
    expect(getChatDispatchReformatInstrumentation().fullPromptClones).toBe(0)
    expect(getAssemblyMessageCaptureInstrumentation().fullTranscriptClones.restoration).toBe(0)
  })

  it('Phase 7 L8: no-message input/start/output triggers perform zero full transcript clones', async () => {
    const fixture = buildLargeCorpusFixture()
    const database = promptReadyLargeCorpusDatabase(fixture)
    const characters = database.characters as Array<Record<string, unknown>>
    characters[0] = {
      ...characters[0],
      triggerscript: [
        {
          comment: '',
          type: 'input',
          conditions: [],
          effect: [{ type: 'setvar', operator: '=', var: 'l8Input', value: '1' }],
        },
        {
          comment: '',
          type: 'start',
          conditions: [],
          effect: [{ type: 'setvar', operator: '=', var: 'l8Start', value: '1' }],
        },
        {
          comment: '',
          type: 'output',
          conditions: [],
          effect: [{ type: 'v2GetMessageCount', outputVar: 'l8OutputCount', indent: 0 }],
        },
      ],
    }
    await importDatabase({
      ...database,
      aiModel: 'echo_model',
      subModel: 'echo_model',
      echoMessage: 'l8 clone-count pong',
      echoDelay: 0,
    })
    resetTriggerCloneInstrumentation()

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: {
        chatId: fixture.hot.chatId,
        characterId: fixture.hot.characterId,
        mode: 'send',
        userMessage: 'hi',
        durable: false,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('l8 clone-count pong')
    const cloneMetrics = getTriggerCloneInstrumentation()
    expect(cloneMetrics.fullTranscriptClones.input).toBe(0)
    expect(cloneMetrics.fullTranscriptClones.start).toBe(0)
    expect(cloneMetrics.fullTranscriptClones.output).toBe(0)
  })

  it('L13: Realm character append performs zero loadPersisted-shaped corpus reads', async () => {
    const baseRevision = await importDatabase({
      characters: [],
      characterOrder: [],
      currentChar: -1,
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('https://realm.risuai.net/api/v1/download/dynamic/realm-id')) {
        return new Response(
          JSON.stringify({
            img: 'main-img',
            card: {
              spec: 'chara_card_v2',
              spec_version: '2.0',
              data: {
                name: 'Realm Scoped',
                description: 'narrow append',
                personality: '',
                scenario: '',
                first_mes: 'hello',
                mes_example: '',
                creator_notes: '',
                system_prompt: '',
                post_history_instructions: '',
                alternate_greetings: [],
                tags: [],
                creator: '',
                character_version: '1',
                extensions: { risuai: {} },
              },
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }
      if (url === 'https://sv.risuai.xyz/resource/main-img') {
        return new Response('main image', { headers: { 'content-type': 'image/png' } })
      }
      return new Response('', { status: 404 })
    })

    try {
      const {
        result: res,
        corpusLoadCount,
        loadCountByTable,
      } = await withServerLoadInstrumentation(() =>
        harness.app.inject({
          method: 'POST',
          url: '/api/v1/import/realm-character',
          headers: { 'risu-auth': assertion, 'risu-writer-session': 'writer-a' },
          payload: { id: 'realm-id', baseRevision },
        }),
      )

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({
        characterId: expect.any(String),
        event: { type: 'character.created', resource: 'character' },
      })
      expect(corpusLoadCount).toBe(0)
      expect(loadCountByTable.characters ?? 0).toBe(0)
      expect(loadCountByTable.chats ?? 0).toBe(0)
      expect(loadCountByTable.messages ?? 0).toBe(0)
      expect(loadCountByTable.chat_hypa_v3 ?? 0).toBe(0)
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('K1: message-only generation finalization performs zero loadPersisted-shaped corpus reads', async () => {
    const fixture = buildLargeCorpusFixture()
    const paused = createPausedProvider('K1 scoped finalization reply')
    await restartHarness(paused.generationChat)
    await importDatabase(fixture.database)

    const request = harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: {
        chatId: fixture.hot.chatId,
        characterId: fixture.hot.characterId,
        mode: 'send',
        userMessage: 'hi',
        durable: true,
      },
    })
    await paused.waitForProvider

    const {
      result: res,
      corpusLoadCount,
      loadCountByTable,
    } = await withServerLoadInstrumentation(async () => {
      paused.release()
      return request
    })

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('K1 scoped finalization reply')
    expect(corpusLoadCount).toBe(0)
    expect(loadCountByTable.characters ?? 0).toBe(0)
    expect(loadCountByTable.chats ?? 0).toBe(0)
    expect(loadCountByTable.messages ?? 0).toBe(0)

    const hydration = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/projection/chatMessages?id=${fixture.hot.chatId}`,
      headers: { 'risu-auth': assertion },
    })
    expect(hydration.statusCode).toBe(200)
    expect(hydration.json().message.at(-1)).toMatchObject({
      role: 'char',
      data: 'K1 scoped finalization reply',
    })
  })

  it('K1: chat-variable generation finalization keeps the broad write path', async () => {
    const fixture = buildLargeCorpusFixture()
    const database = structuredClone(fixture.database)
    const characters = database.characters as Array<Record<string, unknown>>
    characters[0] = {
      ...characters[0],
      triggerscript: [
        {
          comment: '',
          type: 'output',
          conditions: [],
          effect: [{ type: 'setvar', operator: '=', var: 'k1flag', value: '1' }],
        },
      ],
    }
    const paused = createPausedProvider('K1 broad finalization reply')
    await restartHarness(paused.generationChat)
    await importDatabase(database)

    const request = harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: {
        chatId: fixture.hot.chatId,
        characterId: fixture.hot.characterId,
        mode: 'send',
        userMessage: 'hi',
        durable: true,
      },
    })
    await paused.waitForProvider

    const {
      result: res,
      corpusLoadCount,
      loadCountByTable,
    } = await withServerLoadInstrumentation(async () => {
      paused.release()
      return request
    })

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('K1 broad finalization reply')
    expect(corpusLoadCount).toBeGreaterThan(0)
    expect(loadCountByTable.characters ?? 0).toBeGreaterThanOrEqual(1)
    expect(loadCountByTable.chats ?? 0).toBeGreaterThanOrEqual(1)
    expect(loadCountByTable.messages ?? 0).toBe(0)

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.statusCode).toBe(200)
    expect(bootstrap.json().database.characters[0].chats[0].scriptstate).toMatchObject({
      $k1flag: '1',
    })
  })

  it('K2: asset GC avoids loadPersisted-shaped corpus reads', async () => {
    const settingRef = '1'.repeat(64)
    const collectionRef = '2'.repeat(64)
    const characterRef = '3'.repeat(64)
    const messageRef = '4'.repeat(64)
    const orphan = '5'.repeat(64)
    await importDatabase({
      userIcon: settingRef,
      modules: [{ assets: [['module', collectionRef]] }],
      personas: [{ icon: collectionRef }],
      botPresets: [{ image: collectionRef }],
      characters: [
        {
          chaId: 'k2-char',
          image: characterRef,
          chats: [
            {
              id: 'k2-chat',
              message: [
                {
                  chatId: 'k2-message',
                  role: 'user',
                  data: `message {{inlay::${messageRef}}}`,
                },
              ],
            },
          ],
        },
      ],
    })

    const db = openDatabase(harness.dataDir)
    try {
      insertAssetMetadataBatch(db, [
        asset(settingRef),
        asset(collectionRef),
        asset(characterRef),
        asset(messageRef),
        asset(orphan),
      ])

      const observed = await withServerLoadInstrumentation(() =>
        runAssetGc(harness.dataDir, { db, graceMs: 0, now: () => Date.now() }),
      )

      expect(observed.result.deletedAssetIds).toEqual([orphan])
      expect(observed.loadCountByTable.assets).toBe(1)
      expect(observed.loadCountByTable.characters ?? 0).toBe(0)
      expect(observed.loadCountByTable.chats ?? 0).toBe(0)
      expect(observed.loadCountByTable.modules ?? 0).toBe(0)
      expect(observed.loadCountByTable.personas ?? 0).toBe(0)
      expect(observed.loadCountByTable.bot_presets ?? 0).toBe(0)
      expect(observed.loadCountByTable.messages ?? 0).toBe(0)
      expect(observed.loadCountByTable.chat_hypa_v3 ?? 0).toBe(0)
      expect(observed.corpusLoads.filter((load) => load.table !== 'assets').map((load) => load.table)).toEqual([])
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
      // Same wire bytes as the copying mask over the bootstrap-specific
      // database projection, while inactive character rows are shell-light.
      const expected = maskProviderSecrets(loadBootstrapProjectionDatabase(db, harness.dataDir))
      expect(JSON.stringify(body.database)).toBe(JSON.stringify(expected))
      expect(body.database.characters[0]).not.toHaveProperty('__serverCharacterShell')
      expect(body.database.characters[1]).toMatchObject({
        __serverCharacterShell: true,
        chaId: fixture.characters[1].chaId,
        name: fixture.characters[1].name,
      })
      expect(body.database.characters[1]).not.toHaveProperty('desc')
      expect(body.database.characters[1]).not.toHaveProperty('globalLore')
      expect(JSON.stringify(body.database).length).toBeLessThan(
        JSON.stringify(maskProviderSecrets(loadStubProjection(db, harness.dataDir).database)).length,
      )
      // …and the in-place mask never reaches the persisted rows.
      const onDisk = loadPersisted(db, harness.dataDir).database as Record<string, unknown>
      expect(onDisk.openAIKey).toBe('sk-bootstrap-secret')
    } finally {
      db.close()
    }
  })

  it('L5: bootstrap skips asset metadata reads while preserving database bytes', async () => {
    const fixture = buildLargeCorpusFixture()
    await importDatabase({ ...fixture.database, openAIKey: 'sk-bootstrap-secret' })

    const db = openDatabase(harness.dataDir)
    let expectedDatabaseJson = ''
    try {
      insertAssetMetadataBatch(db, [asset('a'.repeat(64))])
      expectedDatabaseJson = JSON.stringify(maskProviderSecrets(loadBootstrapProjectionDatabase(db, harness.dataDir)))
    } finally {
      db.close()
    }

    const { result: res, loadCountByTable } = await withProtocolMetricsEnv('', () =>
      withServerLoadInstrumentation(() =>
        harness.app.inject({
          method: 'GET',
          url: '/api/v1/bootstrap',
          headers: { 'risu-auth': assertion },
        }),
      ),
    )

    expect(res.statusCode).toBe(200)
    expect(JSON.stringify(res.json().database)).toBe(expectedDatabaseJson)
    expect(loadCountByTable.assets ?? 0).toBe(0)
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
      withServerLoadInstrumentation(() => connect(`${baseUrl}/api/v1/events?sinceRevision=${revision}`)),
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
      !!arg && typeof arg === 'object' && (arg as { assetBaseUrl?: unknown }).assetBaseUrl === '/api/v1/assets'

    const hydrate = () => hydrationGet(fixture.hot.chatId)
    const bootstrap = () =>
      harness.app.inject({
        method: 'GET',
        url: '/api/v1/bootstrap',
        headers: { 'risu-auth': assertion },
      })

    const hydrationOff = await withProtocolMetricsEnv('', () => countResponseStringifies(hydrate, hydrationShaped))
    const hydrationOn = await withProtocolMetricsEnv('1', () => countResponseStringifies(hydrate, hydrationShaped))
    expect(hydrationOn).toBe(hydrationOff + 1)

    const bootstrapOff = await withProtocolMetricsEnv('', () => countResponseStringifies(bootstrap, bootstrapShaped))
    const bootstrapOn = await withProtocolMetricsEnv('1', () => countResponseStringifies(bootstrap, bootstrapShaped))
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
