import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { createBardWikiDocument, updateBardWikiChatSettings } from '../src/bardWikiRepository.js'
import { createCommandEventSink, type CommandEventSink } from '../src/commands/events.js'
import { setupAuthedClient } from './helpers/auth.js'
import { getDatabaseLineage } from '../src/databaseLineage.js'
import { assertCommandMetricGate, type CommandMutationMetric } from './helpers/commandMetricGates.js'

const BARDWIKI_TABLES = [
  'bardwiki_chat_settings',
  'bardwiki_documents',
  'bardwiki_document_versions',
  'bardwiki_document_search',
  'bardwiki_links',
] as const

const AUDITED_TABLES = [
  ...BARDWIKI_TABLES,
  'characters',
  'chats',
  'messages',
  'loadouts',
  'settings',
  'schema_version',
  'command_events',
  'command_mutation_receipts',
]

type StoredRow = Record<string, unknown> & { stored_rowid: number }

let app: FastifyInstance
let dataDir: string
let db: DatabaseSync
let assertion: string
let revision: number
let events: CommandEventSink
let metrics: CommandMutationMetric[]

function snapshot(): Record<string, StoredRow[]> {
  return Object.fromEntries(AUDITED_TABLES.map((table) => [table, rows(table)]))
}

function auditRows(): Array<{ table_name: string; operation: string; stored_rowid: number }> {
  return db.prepare('SELECT * FROM preset_deletion_audit ORDER BY rowid').all() as ReturnType<typeof auditRows>
}

function receiptHeaders(): Record<string, string> {
  return {
    'risu-auth': assertion,
    'risu-writer-session': 'delete-writer',
    'risu-mutation-id': 'delete-preset',
    'risu-database-lineage': getDatabaseLineage(db),
  }
}

function expectMetricTables(tables: string[]): void {
  const metric = metrics.find((entry) => entry.metric === 'command_mutation' && entry.status === 'ok')!
  expect(metric).toBeDefined()
  expect(metric.mutationPath).toBe('targeted-cross-owner')
  expect(metric.writtenTables).toEqual(tables)
  assertCommandMetricGate(metric)
}

function rows(table: string): StoredRow[] {
  return db.prepare(`SELECT rowid AS stored_rowid, * FROM ${table} ORDER BY rowid`).all() as StoredRow[]
}

function storedJson(row: StoredRow): Record<string, unknown> {
  return JSON.parse(row.data_json as string) as Record<string, unknown>
}

beforeEach(async () => {
  vi.stubEnv('LOG_LEVEL', 'silent')
  vi.stubEnv('RISU_PROTOCOL_METRICS', '1')
  metrics = []
  vi.spyOn(console, 'info').mockImplementation((message: unknown) => {
    if (typeof message === 'string' && message.startsWith('[protocol-metric] '))
      metrics.push(JSON.parse(message.slice('[protocol-metric] '.length)) as CommandMutationMetric)
  })
  dataDir = mkdtempSync(path.join(tmpdir(), 'risu-agent-preset-deletion-safety-'))
  events = createCommandEventSink()
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
    commandEvents: events,
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
        characterOrder: ['char-delete', 'char-keep'],
        agentContextEnabled: true,
        agentPresetDefaultId: 'ap_delete',
        agentPresets: [
          { id: 'ap_delete', name: 'Delete Me', enabled: true, version: 1, steps: [] },
          { id: 'ap_keep', name: 'Keep Me', enabled: true, version: 1, steps: [] },
        ],
        loadouts: ['delete', 'keep'].map((suffix) => ({
          id: `loadout-${suffix}`,
          name: `Loadout ${suffix}`,
          lastUsed: 100,
          favorite: false,
          characterIds: [`char-${suffix}`],
          modules: [],
          globalVariables: { preserved: suffix },
          presetName: '',
          agentPresetId: `ap_${suffix}`,
          agentPresetName: suffix === 'delete' ? 'Delete Me' : 'Keep Me',
          personaId: '',
        })),
        characters: ['delete', 'keep'].map((suffix) => ({
          chaId: `char-${suffix}`,
          name: `Character ${suffix}`,
          chatPage: 0,
          chatFolders: [],
          chats: [
            {
              id: `chat-${suffix}`,
              name: `Chat ${suffix}`,
              note: `Preserved note ${suffix}`,
              localLore: [],
              generationSettings: { configured: true, jailbreakToggle: false, agentPresetId: `ap_${suffix}` },
              message: [{ chatId: `message-${suffix}`, role: 'user', data: `Preserved transcript ${suffix}` }],
            },
          ],
        })),
      },
    },
  })
  expect(imported.statusCode, imported.body).toBe(200)
  revision = imported.json().revision as number
  db = new DatabaseSync(path.join(dataDir, 'risu.db'))
  for (const suffix of ['delete', 'keep']) {
    const chatId = `chat-${suffix}`
    updateBardWikiChatSettings(db, chatId, { enabledOverride: true })
    createBardWikiDocument(db, {
      id: `document-${suffix}`,
      chatId,
      kind: 'location',
      title: 'Old Tavern',
      logicalPath: 'Places/Old Tavern',
      aliases: ['The Inn'],
      markdown: '## Old Tavern\nA quiet inn. Return to [[Places/Old Tavern]].',
      commandRevision: revision,
    })
  }
  // Observe actual deletes too: a broad replacement may reuse the old rowid.
  db.exec('CREATE TABLE preset_deletion_audit (table_name TEXT, operation TEXT, stored_rowid INTEGER)')
  for (const table of AUDITED_TABLES) {
    for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
      const record = operation === 'DELETE' ? 'OLD' : 'NEW'
      db.exec(`CREATE TRIGGER audit_preset_deletion_${table}_${operation} AFTER ${operation} ON ${table}
        BEGIN INSERT INTO preset_deletion_audit VALUES ('${table}', '${operation}', ${record}.rowid); END`)
    }
  }
  events.clear()
  metrics.length = 0
})

afterEach(async () => {
  db?.close()
  await app?.close()
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('Agent Preset deletion data preservation', () => {
  it('clears only matching selections while preserving both affected and unrelated chats and their BardWiki rows', async () => {
    const beforeWiki = Object.fromEntries(BARDWIKI_TABLES.map((table) => [table, rows(table)]))
    for (const table of BARDWIKI_TABLES) expect(beforeWiki[table], `${table} fixture`).toHaveLength(2)
    const beforeCharacters = rows('characters')
    const beforeChats = rows('chats')
    const beforeMessages = rows('messages')
    const beforeSettings = storedJson(rows('settings')[0])
    const beforeLoadouts = rows('loadouts')
    const emittedSnapshots: ReturnType<typeof snapshot>[] = []
    const unsubscribe = events.subscribe(() => emittedSnapshots.push(snapshot()))
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/agent-presets/ap_delete',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision },
    })

    unsubscribe()
    expect(response.statusCode, response.body).toBe(200)
    const event = {
      type: 'agentPreset.deleted',
      resource: 'agentPresetDeleted',
      id: 'ap_delete',
      revision: revision + 1,
    }
    expect(response.json()).toEqual({
      revision: revision + 1,
      event,
      presetId: 'ap_delete',
      clearedDefault: true,
      clearedChatCount: 1,
      clearedLoadoutCount: 1,
    })
    expect(events.list()).toEqual([event])
    expect(emittedSnapshots).toEqual([snapshot()])
    expect(db.prepare('SELECT revision FROM schema_version WHERE id = 1').get()).toEqual({ revision: revision + 1 })

    const expectedSettings = { ...beforeSettings }
    delete expectedSettings.agentPresetDefaultId
    expectedSettings.agentPresets = (beforeSettings.agentPresets as Array<{ id: string }>).filter(
      ({ id }) => id !== 'ap_delete',
    )
    expect(storedJson(rows('settings')[0])).toEqual(expectedSettings)
    expect(rows('characters')).toEqual(beforeCharacters)
    expect(rows('messages')).toEqual(beforeMessages)
    for (const beforeChat of beforeChats) {
      const expectedChat = storedJson(beforeChat)
      if (beforeChat.id === 'chat-delete') {
        delete (expectedChat.generationSettings as Record<string, unknown>).agentPresetId
      }
      const afterChat = rows('chats').find(({ id }) => id === beforeChat.id)!
      expect({ ...afterChat, data_json: undefined }).toEqual({ ...beforeChat, data_json: undefined })
      expect(storedJson(afterChat)).toEqual(expectedChat)
    }
    for (const beforeLoadout of beforeLoadouts) {
      const expectedLoadout = storedJson(beforeLoadout)
      if (expectedLoadout.id === 'loadout-delete') {
        delete expectedLoadout.agentPresetId
        delete expectedLoadout.agentPresetName
      }
      const afterLoadout = rows('loadouts').find(({ position }) => position === beforeLoadout.position)!
      expect(afterLoadout.stored_rowid).toBe(beforeLoadout.stored_rowid)
      expect(storedJson(afterLoadout)).toEqual(expectedLoadout)
    }

    expect(Object.fromEntries(BARDWIKI_TABLES.map((table) => [table, rows(table).length]))).toEqual(
      Object.fromEntries(BARDWIKI_TABLES.map((table) => [table, beforeWiki[table].length])),
    )
    for (const table of BARDWIKI_TABLES) {
      expect(rows(table), `${table} must survive ordinary Agent Preset deletion`).toEqual(beforeWiki[table])
    }
    expectMetricTables(['chats', 'loadouts', 'settings'])
    expect(
      auditRows()
        .map(({ table_name, operation }) => `${table_name}:${operation}`)
        .sort(),
    ).toEqual(['chats:UPDATE', 'command_events:INSERT', 'loadouts:UPDATE', 'schema_version:UPDATE', 'settings:UPDATE'])
    expect(auditRows().filter(({ table_name }) => table_name === 'chats' || table_name === 'loadouts')).toEqual([
      {
        table_name: 'chats',
        operation: 'UPDATE',
        stored_rowid: beforeChats.find(({ id }) => id === 'chat-delete')!.stored_rowid,
      },
      {
        table_name: 'loadouts',
        operation: 'UPDATE',
        stored_rowid: beforeLoadouts.find((row) => storedJson(row).id === 'loadout-delete')!.stored_rowid,
      },
    ])
  })

  it('writes only settings when no default, chat, or loadout selects the deleted preset', async () => {
    db.prepare(
      "UPDATE chats SET data_json = json_set(data_json, '$.generationSettings.agentPresetId', 'ap_keep')",
    ).run()
    db.prepare(
      "UPDATE loadouts SET data_json = json_set(data_json, '$.agentPresetId', 'ap_keep', '$.agentPresetName', 'Keep Me')",
    ).run()
    db.prepare("UPDATE settings SET data_json = json_set(data_json, '$.agentPresetDefaultId', 'ap_keep')").run()
    db.exec('DELETE FROM preset_deletion_audit')
    const before = snapshot()
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/agent-presets/ap_delete',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision },
    })
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toMatchObject({ clearedDefault: false, clearedChatCount: 0, clearedLoadoutCount: 0 })
    for (const table of [...BARDWIKI_TABLES, 'characters', 'chats', 'messages', 'loadouts'])
      expect(rows(table)).toEqual(before[table])
    expectMetricTables(['settings'])
    expect(
      auditRows()
        .map(({ table_name, operation }) => `${table_name}:${operation}`)
        .sort(),
    ).toEqual(['command_events:INSERT', 'schema_version:UPDATE', 'settings:UPDATE'])
  })

  it('does not parse unrelated character or chat bodies', async () => {
    const unrelatedJson = [
      ...rows('characters').map((row) => row.data_json),
      rows('chats').find(({ id }) => id === 'chat-keep')!.data_json,
    ]
    const parse = vi.spyOn(JSON, 'parse')
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/agent-presets/ap_delete',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision },
    })
    expect(response.statusCode, response.body).toBe(200)
    expect(parse.mock.calls.filter(([source]) => unrelatedJson.includes(source))).toEqual([])
    parse.mockRestore()
  })

  it.each(['chats', 'command_events', 'command_mutation_receipts'])(
    'rolls back every row, revision, receipt, and event when %s persistence fails',
    async (table) => {
      db.exec(`CREATE TRIGGER fail_preset_delete BEFORE ${table === 'chats' ? 'UPDATE' : 'INSERT'} ON ${table}
      BEGIN SELECT RAISE(ABORT, 'injected preset deletion failure'); END`)
      const before = snapshot()
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/commands/agent-presets/ap_delete',
        headers: receiptHeaders(),
        payload: { baseRevision: revision },
      })
      expect(response.statusCode, response.body).toBe(500)
      expect(snapshot()).toEqual(before)
      expect(auditRows()).toEqual([])
      expect(events.list()).toEqual([])
    },
  )

  it.each([
    'stale revision',
    'missing preset',
    'invalid default',
    'noncanonical Agent configuration',
    'invalid loadout',
  ])('rejects %s without persisting any cleanup', async (failure) => {
    if (failure === 'invalid default')
      db.prepare("UPDATE settings SET data_json = json_set(data_json, '$.agentPresetDefaultId', 'ap_missing')").run()
    if (failure === 'noncanonical Agent configuration')
      db.prepare("UPDATE settings SET data_json = json_remove(data_json, '$.agentPresets[0].agentUses')").run()
    if (failure === 'invalid loadout')
      db.prepare("UPDATE loadouts SET data_json = json_remove(data_json, '$.name') WHERE position = 1").run()
    db.exec('DELETE FROM preset_deletion_audit')
    const before = snapshot()
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/commands/agent-presets/${failure === 'missing preset' ? 'ap_missing' : 'ap_delete'}`,
      headers: receiptHeaders(),
      payload: { baseRevision: failure === 'stale revision' ? revision - 1 : revision },
    })
    expect(response.statusCode, response.body).toBe(
      failure === 'stale revision' ? 409 : failure === 'missing preset' ? 404 : 400,
    )
    expect(snapshot()).toEqual(before)
    expect(auditRows()).toEqual([])
    expect(events.list()).toEqual([])
  })

  it('preserves legacy embedded owner fields while clearing their matching selections in settings', async () => {
    const embedded = {
      ...storedJson(rows('settings')[0]),
      characters: rows('characters').map((character) => ({
        ...storedJson(character),
        chats: rows('chats')
          .filter((chat) => chat.character_id === character.id)
          .map(storedJson),
      })),
      loadouts: rows('loadouts').map(storedJson),
    }
    db.prepare('UPDATE settings SET data_json = ? WHERE id = 1').run(JSON.stringify(embedded))
    db.exec('DELETE FROM characters')
    db.exec('DELETE FROM loadouts')
    db.exec('DELETE FROM preset_deletion_audit')
    const expected: Record<string, unknown> = structuredClone(embedded)
    delete expected.agentPresetDefaultId
    expected.agentPresets = (expected.agentPresets as Array<{ id: string }>).filter(({ id }) => id !== 'ap_delete')
    const characters = expected.characters as Array<{ chats: Array<{ generationSettings: Record<string, unknown> }> }>
    delete characters[0].chats[0].generationSettings.agentPresetId
    const loadouts = expected.loadouts as Array<Record<string, unknown>>
    delete loadouts[0].agentPresetId
    delete loadouts[0].agentPresetName
    const beforeMessages = rows('messages')
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/agent-presets/ap_delete',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision },
    })
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toMatchObject({ clearedDefault: true, clearedChatCount: 1, clearedLoadoutCount: 1 })
    expect(storedJson(rows('settings')[0])).toEqual(expected)
    for (const table of ['characters', 'chats', 'loadouts']) expect(rows(table)).toEqual([])
    expect(rows('messages')).toEqual(beforeMessages)
    expectMetricTables(['settings'])
    expect(
      auditRows()
        .map(({ table_name, operation }) => `${table_name}:${operation}`)
        .sort(),
    ).toEqual(['command_events:INSERT', 'schema_version:UPDATE', 'settings:UPDATE'])
  })

  it('replays the accepted receipt before missing-preset and revision validation without writing or emitting again', async () => {
    const request = {
      method: 'DELETE' as const,
      url: '/api/v1/commands/agent-presets/ap_delete',
      headers: receiptHeaders(),
      payload: { baseRevision: revision },
    }
    const first = await app.inject(request)
    expect(first.statusCode, first.body).toBe(200)
    const accepted = snapshot()
    const writes = auditRows()
    const emitted = events.list()
    expect(emitted).toHaveLength(1)
    expect(rows('command_mutation_receipts')).toHaveLength(1)
    const replay = await app.inject({ ...request, payload: { baseRevision: revision + 100 } })
    expect(replay.statusCode, replay.body).toBe(200)
    expect(replay.json()).toEqual(first.json())
    expect(snapshot()).toEqual(accepted)
    expect(auditRows()).toEqual(writes)
    expect(events.list()).toEqual(emitted)
  })
})
