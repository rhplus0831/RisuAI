import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { createBardWikiDocument } from '../src/bardWikiRepository.js'
import { createCommandEventSink, type CommandEventSink } from '../src/commands/events.js'
import { getDatabaseLineage } from '../src/databaseLineage.js'
import { sourceHash } from '../src/translation/greetingTranslationStore.js'
import { setupAuthedClient } from './helpers/auth.js'
import {
  assertCommandMetricGate,
  BARDWIKI_WRITE_TABLES,
  BROAD_WRITE_TABLES,
  type CommandMutationMetric,
} from './helpers/commandMetricGates.js'

const PRESERVED_TABLES = [
  ...new Set([...BARDWIKI_WRITE_TABLES, ...BROAD_WRITE_TABLES, 'messages', 'chat_hypa_v3']),
].filter((table) => table !== 'settings')
const SNAPSHOT_TABLES = [
  ...PRESERVED_TABLES,
  'settings',
  'schema_version',
  'command_events',
  'command_mutation_receipts',
]
const ENDPOINTS = [
  { url: '/api/v1/commands/characters', eventType: 'character.created', selects: false },
  { url: '/api/v1/commands/characters/create-and-select', eventType: 'character.createdAndSelected', selects: true },
] as const

type Row = Record<string, unknown> & { __rowid: number }
type Snapshot = Record<string, Row[]>

let app: FastifyInstance
let dataDir: string
let db: DatabaseSync
let assertion: string
let revision: number
let databaseLineage: string
let commandEvents: CommandEventSink
let metrics: CommandMutationMetric[]

function snapshot(tables: readonly string[] = SNAPSHOT_TABLES): Snapshot {
  return Object.fromEntries(
    tables.map((table) => [
      table,
      db.prepare(`SELECT rowid AS __rowid, * FROM ${table} ORDER BY rowid`).all() as Row[],
    ]),
  )
}

function seedBardWiki(suffix: string): void {
  const chatId = `chat-${suffix}`
  const document = createBardWikiDocument(db, {
    id: `document-${suffix}`,
    chatId,
    kind: 'location',
    title: 'Old Tavern',
    logicalPath: 'Places/Old Tavern',
    aliases: ['The Inn'],
    markdown: '## Old Tavern\nA quiet inn.',
    commandRevision: revision,
  })
  createBardWikiDocument(db, {
    id: `event-${suffix}`,
    chatId,
    kind: 'event',
    title: 'Arrival',
    logicalPath: 'Events/Arrival',
    markdown: 'They met at [[Old Tavern]] and entered [[Places/Old Tavern#Bar]].',
    commandRevision: revision,
  })
  db.prepare('INSERT INTO bardwiki_chat_settings (chat_id, enabled_override) VALUES (?, 1)').run(chatId)
  db.prepare(
    `INSERT INTO bardwiki_turn_receipts (
    id, chat_id, user_message_id, user_content_hash, assistant_message_id,
    assistant_content_hash, confirmation_mode, state, change_set_id, event_document_id
  ) VALUES (?, ?, ?, 'hash-u', ?, 'hash-a', 'explicit', 'applied', ?, ?)`,
  ).run(`receipt-${suffix}`, chatId, `user-${suffix}`, `assistant-${suffix}`, `change-${suffix}`, document.id)
  db.prepare(
    `INSERT INTO bardwiki_jobs (
    id, instance_id, chat_id, receipt_id, kind, status, payload_json
  ) VALUES (?, ?, ?, ?, 'apply_turn', 'completed', '{}')`,
  ).run(`job-${suffix}`, `instance-${suffix}`, chatId, `receipt-${suffix}`)
  db.prepare(
    `INSERT INTO bardwiki_document_sources (
    document_id, document_version, receipt_id, message_id, role, content_hash
  ) VALUES (?, 1, ?, ?, 'assistant', 'hash-a')`,
  ).run(document.id, `receipt-${suffix}`, `assistant-${suffix}`)
  db.prepare(
    `INSERT INTO bardwiki_change_manifest (
    receipt_id, document_id, after_version, after_hash
  ) VALUES (?, ?, 1, ?)`,
  ).run(`receipt-${suffix}`, document.id, document.contentHash)
  db.prepare('INSERT INTO bardwiki_rebuild_staging (rebuild_job_id, ordinal, change_json) VALUES (?, 0, ?)').run(
    `job-${suffix}`,
    '{"preserved":true}',
  )
}

function installWriteAudit(): void {
  // Rowids alone cannot reveal DELETE + INSERT when SQLite reuses the same id.
  // These triggers also observe cascading deletes, which writtenTables omits.
  db.exec('CREATE TABLE creation_write_audit (table_name TEXT, operation TEXT, affected_rowid INTEGER)')
  for (const table of SNAPSHOT_TABLES) {
    for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
      const record = operation === 'DELETE' ? 'OLD' : 'NEW'
      db.exec(`CREATE TRIGGER creation_audit_${table}_${operation} AFTER ${operation} ON ${table}
        BEGIN INSERT INTO creation_write_audit VALUES ('${table}', '${operation}', ${record}.rowid); END`)
    }
  }
}

function auditRows(): Array<{ table_name: string; operation: string; affected_rowid: number }> {
  return db.prepare('SELECT * FROM creation_write_audit ORDER BY rowid').all() as ReturnType<typeof auditRows>
}

function expectPreserved(before: Snapshot): void {
  // Assert every BardWiki family independently, including search and resolved links.
  for (const table of PRESERVED_TABLES) {
    const oldIds = new Set(before[table].map((row) => row.__rowid))
    expect(
      snapshot([table])[table].filter((row) => oldIds.has(row.__rowid)),
      `${table} existing rows`,
    ).toEqual(before[table])
    expect(
      auditRows().filter((row) => row.table_name === table && row.operation !== 'INSERT'),
      `${table} must not delete/reinsert or update existing rows`,
    ).toEqual([])
  }
}

function headers(mutationId: string): Record<string, string> {
  return {
    'risu-auth': assertion,
    'risu-writer-session': 'creation-writer',
    'risu-mutation-id': mutationId,
    'risu-database-lineage': databaseLineage,
  }
}

function payload(withInitialChat = true): Record<string, unknown> {
  return {
    baseRevision: revision,
    // Leave defaulted fields absent so replay also verifies the receipt hashes
    // the original request before character/chat normalization mutates it.
    character: { chaId: 'char-new', name: 'New', firstMessage: 'Hello', chats: [], chatFolders: [] },
    ...(withInitialChat
      ? { initialChat: { id: 'chat-new', name: 'First chat', message: [], localLore: [], note: '' } }
      : {}),
    lastInteraction: 9876,
  }
}

beforeEach(async () => {
  vi.stubEnv('RISU_PROTOCOL_METRICS', '1')
  vi.stubEnv('LOG_LEVEL', 'silent')
  metrics = []
  vi.spyOn(console, 'info').mockImplementation((message: unknown) => {
    if (typeof message === 'string' && message.startsWith('[protocol-metric] ')) {
      metrics.push(JSON.parse(message.slice('[protocol-metric] '.length)) as CommandMutationMetric)
    }
  })
  dataDir = mkdtempSync(path.join(tmpdir(), 'risu-character-creation-safety-'))
  commandEvents = createCommandEventSink()
  ;({ app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      importMaxBytes: Infinity,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
    },
    commandEvents,
    assetGc: false,
    memoryWorker: false,
  }))
  ;({ assertion } = await setupAuthedClient(app))
  const imported = await app.inject({
    method: 'POST',
    url: '/api/v1/import/risusave',
    headers: { 'risu-auth': assertion },
    payload: {
      database: {
        currentChar: 0,
        theme: 'dark',
        characterOrder: ['char-a', 'char-b'],
        characters: ['a', 'b'].map((suffix) => ({
          chaId: `char-${suffix}`,
          name: `Character ${suffix}`,
          firstMessage: `Greeting ${suffix}`,
          chatPage: 0,
          chatFolders: [],
          globalLore: [],
          lastInteraction: 123,
          chats: [
            {
              id: `chat-${suffix}`,
              name: `Chat ${suffix}`,
              localLore: [],
              scriptstate: {},
              message: [
                { chatId: `user-${suffix}`, role: 'user', data: `Question ${suffix}` },
                { chatId: `assistant-${suffix}`, role: 'char', data: `Answer ${suffix}` },
              ],
            },
          ],
        })),
      },
    },
  })
  expect(imported.statusCode, imported.body).toBe(200)
  revision = imported.json().revision as number
  db = new DatabaseSync(path.join(dataDir, 'risu.db'))
  databaseLineage = getDatabaseLineage(db)
  for (const suffix of ['a', 'b']) {
    seedBardWiki(suffix)
    db.prepare('INSERT INTO chat_hypa_v3 (chat_id, json) VALUES (?, ?)').run(
      `chat-${suffix}`,
      JSON.stringify({ version: 3, summaries: [{ text: `Preserved summary ${suffix}` }] }),
    )
    const translation = {
      text: `Translation ${suffix}`,
      source: 'raw',
      sourceHash: sourceHash(`Greeting ${suffix}`),
      targetLanguage: 'ko',
      inputLanguage: 'en',
      translatorType: 'google',
      settingsHash: 'translation-settings',
      updatedAt: 1234,
    }
    db.prepare(
      `INSERT INTO greeting_translations (
      character_id, greeting_index, settings_hash, source_hash, translation_json, updated_at
    ) VALUES (?, -1, ?, ?, ?, ?)`,
    ).run(
      `char-${suffix}`,
      translation.settingsHash,
      translation.sourceHash,
      JSON.stringify(translation),
      translation.updatedAt,
    )
  }
  for (const table of BROAD_WRITE_TABLES.filter(
    (table) => !['characters', 'chats', 'greeting_translations', 'settings', 'plugin_custom_storage'].includes(table),
  )) {
    db.prepare(`INSERT OR REPLACE INTO ${table} (position, data_json) VALUES (0, ?)`).run(
      JSON.stringify({ id: `${table}-fixture`, name: `Preserved ${table}` }),
    )
  }
  db.prepare('INSERT INTO plugin_custom_storage (key, value_json) VALUES (?, ?)').run('preserved', '{"value":7}')
  db.prepare(
    `INSERT INTO command_mutation_receipts (
    mutation_id, database_lineage, creator_writer_session_id, request_fingerprint, response_json
  ) VALUES ('existing-mutation', ?, 'older-writer', 'old-fingerprint', '{"preserved":true}')`,
  ).run(databaseLineage)
  for (const table of PRESERVED_TABLES) {
    expect(snapshot([table])[table].length, `${table} fixture must exercise preservation`).toBeGreaterThan(0)
  }
  installWriteAudit()
  metrics.length = 0
  commandEvents.clear()
})

afterEach(async () => {
  db?.close()
  await app?.close()
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

for (const endpoint of ENDPOINTS) {
  describe(endpoint.url, () => {
    it.each([false, true])(
      'preserves every existing row with initialChat=%s and writes only the append budget',
      async (withInitialChat) => {
        const before = snapshot()
        const committedWhenEmitted: Snapshot[] = []
        const unsubscribe = commandEvents.subscribe(() => committedWhenEmitted.push(snapshot()))
        const response = await app.inject({
          method: 'POST',
          url: endpoint.url,
          headers: headers('create-new'),
          payload: payload(withInitialChat),
        })
        unsubscribe()
        expect(response.statusCode, response.body).toBe(200)
        expectPreserved(before)
        const event = {
          type: endpoint.eventType,
          resource: 'character',
          id: 'char-new',
          revision: revision + 1,
        }
        expect(response.json()).toEqual({
          revision: revision + 1,
          event,
          characterId: 'char-new',
          selectedCharacterId: endpoint.selects ? 'char-new' : 'char-a',
        })
        expect(commandEvents.list()).toEqual([{ ...event, origin: { writerSessionId: 'creation-writer' } }])
        expect(committedWhenEmitted).toEqual([snapshot()])
        const settings = JSON.parse(snapshot(['settings']).settings[0].data_json as string) as Record<string, unknown>
        expect(settings).toMatchObject({
          currentChar: endpoint.selects ? 2 : 0,
          characterOrder: ['char-a', 'char-b', 'char-new'],
          theme: 'dark',
        })
        const character = db.prepare('SELECT position, data_json FROM characters WHERE id = ?').get('char-new')!
        expect(character.position).toBe(2)
        expect(JSON.parse(character.data_json as string)).toMatchObject({
          chaId: 'char-new',
          name: 'New',
          chatPage: withInitialChat ? 0 : -1,
          chatFolders: [],
          ...(endpoint.selects ? { lastInteraction: 9876 } : {}),
        })
        expect(
          db.prepare('SELECT id, character_id, position FROM chats WHERE character_id = ?').all('char-new'),
        ).toEqual(withInitialChat ? [{ id: 'chat-new', character_id: 'char-new', position: 0 }] : [])
        const metric = metrics.find((entry) => entry.metric === 'command_mutation' && entry.status === 'ok')!
        expect(metric).toBeTruthy()
        expect(metric.mutationPath).toBe('targeted-character-row')
        expect(metric.writtenTables).toEqual(
          withInitialChat ? ['characters', 'chats', 'settings'] : ['characters', 'settings'],
        )
        assertCommandMetricGate(metric)
        expect(
          auditRows()
            .map(({ table_name, operation }) => `${table_name}:${operation}`)
            .sort(),
        ).toEqual(
          [
            'characters:INSERT',
            ...(withInitialChat ? ['chats:INSERT'] : []),
            'settings:UPDATE',
            'schema_version:UPDATE',
            'command_events:INSERT',
            'command_mutation_receipts:INSERT',
          ].sort(),
        )
        expect(snapshot(['command_mutation_receipts']).command_mutation_receipts[0]).toEqual(
          before.command_mutation_receipts[0],
        )
      },
    )

    it.each([
      'stale revision',
      'duplicate character',
      'duplicate chat',
      'failed insertion',
      'failed event',
      'failed receipt',
    ])('rolls back %s without changing rows, revision, receipts, or events', async (failure) => {
      const requestPayload = payload()
      if (failure === 'stale revision') requestPayload.baseRevision = revision - 1
      if (failure === 'duplicate character') requestPayload.character = { chaId: 'char-a', name: 'Duplicate' }
      if (failure === 'duplicate chat') requestPayload.initialChat = { id: 'chat-b', name: 'Duplicate' }
      if (failure === 'failed insertion') {
        db.exec(`CREATE TRIGGER fail_new_chat BEFORE INSERT ON chats WHEN NEW.id = 'chat-new'
          BEGIN SELECT RAISE(ABORT, 'injected initial chat failure'); END`)
      }
      if (failure === 'failed event' || failure === 'failed receipt') {
        const table = failure === 'failed event' ? 'command_events' : 'command_mutation_receipts'
        db.exec(`CREATE TRIGGER fail_commit_infrastructure BEFORE INSERT ON ${table}
            BEGIN SELECT RAISE(ABORT, 'injected commit infrastructure failure'); END`)
      }
      const before = snapshot()
      const response = await app.inject({
        method: 'POST',
        url: endpoint.url,
        headers: headers('failed-create'),
        payload: requestPayload,
      })
      expect(response.statusCode, response.body).toBe(
        failure === 'stale revision' ? 409 : failure.startsWith('failed ') ? 500 : 400,
      )
      expect(snapshot()).toEqual(before)
      expect(auditRows()).toEqual([])
      expect(commandEvents.list()).toEqual([])
    })

    it('replays the durable receipt before duplicate and revision validation without more writes or events', async () => {
      const request = {
        method: 'POST' as const,
        url: endpoint.url,
        headers: headers('replayed-create'),
        payload: payload(),
      }
      const first = await app.inject(request)
      expect(first.statusCode, first.body).toBe(200)
      const accepted = snapshot()
      const writes = auditRows()
      const emitted = commandEvents.list()
      expect(emitted).toHaveLength(1)
      const replay = await app.inject({ ...request, payload: { ...request.payload, baseRevision: revision + 100 } })
      expect(replay.statusCode, replay.body).toBe(200)
      expect(replay.json()).toEqual(first.json())
      expect(snapshot()).toEqual(accepted)
      expect(auditRows()).toEqual(writes)
      expect(commandEvents.list()).toEqual(emitted)
    })
  })
}
