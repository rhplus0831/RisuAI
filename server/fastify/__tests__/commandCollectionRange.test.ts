import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import { buildApp } from '../src/app.js'
import { setupAuthedClient } from './helpers/auth.js'
import {
  assertCommandMetricGate,
  type CommandMutationMetric,
} from './helpers/commandMetricGates.js'
import { assertOnlyRowsWritten, tableRowidsById } from './helpers/rowStability.js'

// Phase 4 (collection-table paths) regression. Each Tier-4 collection family
// route now writes only the one collection table it changed (single-row UPDATE
// for pure field edits; full one-table rewrite for create/delete/reorder) plus
// its pointer scalar in settings only when it moved — instead of the broad
// 13-table rewrite. These tests prove the narrowing three ways: the
// `command_mutation` metric reports `targeted-collection` with an exact
// `writtenTables`; `tableRowidsById` shows every character / chat row keeps its
// rowid; and collection rowid snapshots show single-row edits do not churn the
// table's own sibling rows.

interface Harness {
  app: FastifyInstance
  dataDir: string
}

const PREVIOUS_PROTOCOL_METRICS = process.env.RISU_PROTOCOL_METRICS

let harness: Harness
let assertion: string
let infoSpy: ReturnType<typeof vi.spyOn>
let metrics: CommandMutationMetric[]

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-phase4-range-'))
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
    assetGc: false,
    memoryWorker: false,
  })
  return { app, dataDir }
}

function seedDatabase(): Record<string, unknown> {
  return {
    currentChar: 0,
    theme: 'dark',
    characterOrder: ['char-a', 'char-b'],
    loreBookPage: 0,
    currentPluginProvider: 'plugin-a',
    enabledModules: [],
    botPresetsId: 'preset-0',
    selectedPersona: 0,
    mirrorLegacyProfile: false,
    hypaV3Presets: [{ name: 'hypa-0' }],
    botPresets: [{ name: 'preset-0' }, { name: 'preset-1' }],
    modules: [{ id: 'mod-a', name: 'Module A' }],
    plugins: [
      pluginRecord('plugin-a'),
      pluginRecord('plugin-b'),
      pluginRecord('plugin-c'),
    ],
    personas: [{ name: 'persona-a' }, { name: 'persona-b' }],
    loadouts: [{ id: 'loadout-a', name: 'Loadout A' }],
    loreBook: [
      { id: 'lore-0', name: 'lore-0', data: [] },
      { id: 'lore-1', name: 'lore-1', data: [] },
    ],
    translatorPresets: [{ id: 'tp-a', name: 'TP A' }],
    promptTemplate: [{ type: 'plain', text: 'hi' }],
    pluginCustomStorage: {},
    characters: [
      {
        type: 'character',
        chaId: 'char-a',
        name: 'A',
        chats: [
          { id: 'chat-a-1', name: 'A1', message: [] },
          { id: 'chat-a-2', name: 'A2', message: [] },
        ],
      },
      {
        type: 'character',
        chaId: 'char-b',
        name: 'B',
        chats: [{ id: 'chat-b-1', name: 'B1', message: [] }],
      },
    ],
  }
}

/** A minimal valid plugin record (the validator requires these fields). */
function pluginRecord(name: string): Record<string, unknown> {
  return {
    name,
    script: '',
    arguments: {},
    realArg: {},
    customLink: [],
    argMeta: {},
    enabled: false,
  }
}

async function importDatabase(database: unknown): Promise<number> {
  const res = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/import/risusave',
    headers: { 'risu-auth': assertion },
    payload: { database },
  })
  expect(res.statusCode, JSON.stringify(res.json())).toBe(200)
  return (res.json() as { revision: number }).revision
}

interface CommandRequest {
  method: 'DELETE' | 'PATCH' | 'POST' | 'PUT'
  url: string
  headers?: Record<string, string>
  payload?: unknown
}

interface CommandResponse {
  statusCode: number
  json(): unknown
}

async function runCommand(
  request: CommandRequest,
): Promise<{ revision: number; metric: CommandMutationMetric; body: Record<string, unknown> }> {
  const before = metrics.length
  const inject = harness.app.inject as unknown as (
    request: CommandRequest,
  ) => Promise<CommandResponse>
  const res = await inject({
    ...request,
    headers: { 'risu-auth': assertion, ...(request.headers ?? {}) },
  })
  expect(res.statusCode, JSON.stringify(res.json())).toBe(200)
  const body = res.json() as Record<string, unknown>
  const metric = metrics
    .slice(before)
    .find((entry) => entry.metric === 'command_mutation' && entry.status === 'ok')
  expect(metric, `missing command_mutation metric for ${request.url}`).toBeTruthy()
  return { revision: body.revision as number, metric: metric as CommandMutationMetric, body }
}

function readSettings(): Record<string, unknown> {
  const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
  try {
    const row = db.prepare('SELECT data_json FROM settings WHERE id = 1').get() as {
      data_json: string
    }
    return JSON.parse(row.data_json) as Record<string, unknown>
  } finally {
    db.close()
  }
}

function readCollection(table: string): unknown[] {
  const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
  try {
    const rows = db.prepare(`SELECT data_json FROM ${table} ORDER BY position`).all() as Array<{
      data_json: string
    }>
    return rows.map((r) => JSON.parse(r.data_json))
  } finally {
    db.close()
  }
}

/** Snapshot of a collection table's stable rowid keyed by position, to prove a
 *  single-row UPDATE did not DELETE+reINSERT (churn) the table's other rows. */
function collectionRowidsByPosition(table: string): Record<number, number> {
  const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
  try {
    const rows = db.prepare(`SELECT position, rowid FROM ${table} ORDER BY position`).all() as Array<{
      position: number
      rowid: number
    }>
    return Object.fromEntries(rows.map((row) => [row.position, row.rowid]))
  } finally {
    db.close()
  }
}

/** Assert no character or chat row was rewritten (every rowid stayed put). */
function expectNoCharacterOrChatChurn(
  before: { characters: Record<string, number>; chats: Record<string, number> },
): void {
  assertOnlyRowsWritten(before.characters, tableRowidsById(harness.dataDir, 'characters'))
  assertOnlyRowsWritten(before.chats, tableRowidsById(harness.dataDir, 'chats'))
}

function rowidSnapshot(): { characters: Record<string, number>; chats: Record<string, number> } {
  return {
    characters: tableRowidsById(harness.dataDir, 'characters'),
    chats: tableRowidsById(harness.dataDir, 'chats'),
  }
}

beforeEach(async () => {
  process.env.RISU_PROTOCOL_METRICS = '1'
  metrics = []
  infoSpy = vi.spyOn(console, 'info').mockImplementation((message: unknown) => {
    if (typeof message !== 'string' || !message.startsWith('[protocol-metric] ')) return
    metrics.push(JSON.parse(message.slice('[protocol-metric] '.length)) as CommandMutationMetric)
  })
  harness = await startHarness()
  ;({ assertion } = await setupAuthedClient(harness.app))
})

afterEach(async () => {
  infoSpy.mockRestore()
  if (PREVIOUS_PROTOCOL_METRICS === undefined) {
    delete process.env.RISU_PROTOCOL_METRICS
  } else {
    process.env.RISU_PROTOCOL_METRICS = PREVIOUS_PROTOCOL_METRICS
  }
  await harness.app.close()
  rmSync(harness.dataDir, { recursive: true, force: true })
})

describe('Phase 4 plugins collection range', () => {
  it('POST plugins rewrites only the plugins table', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/plugins',
      payload: { baseRevision: revision, plugin: pluginRecord('plugin-d') },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['plugins'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(readCollection('plugins').map((p) => (p as { name: string }).name)).toEqual([
      'plugin-a',
      'plugin-b',
      'plugin-c',
      'plugin-d',
    ])
    // The other eight collection tables are provably untouched (not in writtenTables).
    expect(readCollection('bot_presets')).toHaveLength(2)
  })

  it('PATCH plugins/:id updates one row in place (no sibling churn)', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()
    const beforeRowids = collectionRowidsByPosition('plugins')

    const { metric } = await runCommand({
      method: 'PATCH',
      url: '/api/v1/commands/plugins/plugin-b',
      payload: { baseRevision: revision, patch: { displayName: 'Renamed B' } },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['plugins'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    // Single-row UPDATE: position 1 changed value but every rowid stayed put.
    expect(collectionRowidsByPosition('plugins')).toEqual(beforeRowids)
    const plugins = readCollection('plugins') as Array<{ name: string; displayName?: string }>
    expect(plugins[1]).toMatchObject({ name: 'plugin-b', displayName: 'Renamed B' })
    expect(plugins[0].displayName).toBeUndefined()
  })

  it('DELETE plugins/:id (non-provider) rewrites only the plugins table', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'DELETE',
      url: '/api/v1/commands/plugins/plugin-b',
      payload: { baseRevision: revision },
    })

    // plugin-b is not the active provider, so settings stays out of writtenTables.
    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['plugins'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(readCollection('plugins').map((p) => (p as { name: string }).name)).toEqual([
      'plugin-a',
      'plugin-c',
    ])
    expect(readSettings().currentPluginProvider).toBe('plugin-a')
  })

  it('DELETE plugins/:id (active provider) also co-writes settings', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'DELETE',
      url: '/api/v1/commands/plugins/plugin-a',
      payload: { baseRevision: revision },
    })

    // plugin-a is the active provider, so the pointer clears and settings rides along.
    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['plugins', 'settings'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(readCollection('plugins').map((p) => (p as { name: string }).name)).toEqual([
      'plugin-b',
      'plugin-c',
    ])
    expect(readSettings().currentPluginProvider).toBe('')
  })

  it('POST plugins/:id/enable updates one row in place', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()
    const beforeRowids = collectionRowidsByPosition('plugins')

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/plugins/plugin-c/enable',
      payload: { baseRevision: revision, enabled: true },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['plugins'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(collectionRowidsByPosition('plugins')).toEqual(beforeRowids)
    const plugins = readCollection('plugins') as Array<{ name: string; enabled?: boolean }>
    expect(plugins[2]).toMatchObject({ name: 'plugin-c', enabled: true })
    expect(plugins[0].enabled).toBe(false)
  })

  it('POST plugins/reorder rewrites only the plugins table', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/plugins/reorder',
      payload: { baseRevision: revision, pluginIds: ['plugin-c', 'plugin-a', 'plugin-b'] },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['plugins'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(readCollection('plugins').map((p) => (p as { name: string }).name)).toEqual([
      'plugin-c',
      'plugin-a',
      'plugin-b',
    ])
  })
})
