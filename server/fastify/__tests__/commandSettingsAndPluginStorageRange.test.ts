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

// Phase 2 (settings + plugin-storage paths) regression. Each of the six Tier-1
// settings-scalar routes and the three Tier-2 plugin-storage routes now writes
// only its own table instead of the broad 13-table set. These tests prove the
// narrowing two ways: the `command_mutation` metric reports the targeted path
// and an exact `writtenTables`, and `tableRowidsById` shows every unrelated
// character / chat row keeps its rowid (no DELETE+reINSERT churn).

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
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-phase2-range-'))
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
    currentPluginProvider: 'none',
    enabledModules: [],
    hypaV3Presets: [{ name: 'hypa-0' }],
    botPresets: [{ name: 'preset-0' }, { name: 'preset-1' }],
    modules: [{ id: 'mod-a', name: 'Module A' }],
    plugins: [{ name: 'plugin-a' }],
    personas: [{ name: 'persona-a' }],
    loadouts: [{ id: 'loadout-a', name: 'Loadout A' }],
    loreBook: [
      { id: 'lore-0', name: 'lore-0', data: [] },
      { id: 'lore-1', name: 'lore-1', data: [] },
    ],
    translatorPresets: [{ id: 'tp-a', name: 'TP A' }],
    promptTemplate: [{ type: 'plain', text: 'hi' }],
    pluginCustomStorage: {
      keep: { mode: 'baseline' },
      drop: { mode: 'baseline' },
    },
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

function readPluginStorage(): Record<string, unknown> {
  const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
  try {
    const rows = db.prepare('SELECT key, value_json FROM plugin_custom_storage').all() as Array<{
      key: string
      value_json: string
    }>
    return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value_json)]))
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

describe('Phase 2 settings-scalar mutation range', () => {
  it('settings/:group writes only the settings row', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'PATCH',
      url: '/api/v1/commands/settings/display',
      payload: { baseRevision: revision, patch: { theme: 'light' } },
    })

    expect(metric.mutationPath).toBe('targeted-settings')
    expect(metric.writtenTables).toEqual(['settings'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(readSettings().theme).toBe('light')
    // `writtenTables` is the complete set of tables written, so the nine
    // collection tables were provably left untouched (the broad path would have
    // DELETE+reINSERTed all of them); the collection still has its two rows.
    expect(readCollection('bot_presets')).toHaveLength(2)
  })

  it('settings/:group memory co-writes only hypa_v3_presets with settings', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'PATCH',
      url: '/api/v1/commands/settings/memory',
      payload: {
        baseRevision: revision,
        patch: { hypaV3Presets: [{ name: 'hypa-0' }, { name: 'hypa-1' }] },
      },
    })

    expect(metric.mutationPath).toBe('targeted-settings')
    expect(metric.writtenTables).toEqual(['hypa_v3_presets', 'settings'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(readCollection('hypa_v3_presets')).toEqual([{ name: 'hypa-0' }, { name: 'hypa-1' }])
    // The presets array lives in its table, not the settings row.
    expect(readSettings().hypaV3Presets).toBeUndefined()
    // The other eight collection tables are untouched.
    expect(readCollection('bot_presets')).toHaveLength(2)
  })

  it('prompt-settings writes only the settings row', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'PATCH',
      url: '/api/v1/commands/prompt-settings',
      payload: { baseRevision: revision, patch: { mainPrompt: 'Prompt main' } },
    })

    expect(metric.mutationPath).toBe('targeted-settings')
    expect(metric.writtenTables).toEqual(['settings'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(readSettings().mainPrompt).toBe('Prompt main')
  })

  it('characters/reorder writes only the settings row (characterOrder)', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric, body } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/characters/reorder',
      payload: { baseRevision: revision, characterOrder: ['char-b', 'char-a'] },
    })

    expect(metric.mutationPath).toBe('targeted-settings')
    expect(metric.writtenTables).toEqual(['settings'])
    assertCommandMetricGate(metric)
    // Reorder edits presentation order, so no character row is rewritten.
    expectNoCharacterOrChatChurn(before)
    expect(readSettings().characterOrder).toEqual(['char-b', 'char-a'])
    expect(body.selectedCharacterId).toBe('char-a')
  })

  it('plugins/provider writes only the settings row', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/plugins/provider',
      payload: { baseRevision: revision, provider: 'openai' },
    })

    expect(metric.mutationPath).toBe('targeted-settings')
    expect(metric.writtenTables).toEqual(['settings'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(readSettings().currentPluginProvider).toBe('openai')
  })

  it('modules/enable writes only the settings row (enabledModules)', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/modules/enable',
      payload: { baseRevision: revision, moduleId: 'mod-a', enabled: true },
    })

    expect(metric.mutationPath).toBe('targeted-settings')
    expect(metric.writtenTables).toEqual(['settings'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(readSettings().enabledModules).toEqual(['mod-a'])
    // `enabledModules` is a settings scalar; the module collection table itself
    // is untouched (not in `writtenTables`).
    expect(readCollection('modules')).toHaveLength(1)
  })

  it('lorebooks/:id/select writes only the settings row (loreBookPage)', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/lorebooks/lore-1/select',
      payload: { baseRevision: revision },
    })

    expect(metric.mutationPath).toBe('targeted-settings')
    expect(metric.writtenTables).toEqual(['settings'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(readSettings().loreBookPage).toBe(1)
    // `loreBookPage` is a settings scalar; the global lorebook collection table
    // is untouched (not in `writtenTables`).
    expect(readCollection('lore_books')).toHaveLength(2)
  })
})

describe('Phase 2 plugin-storage mutation range', () => {
  it('PUT plugin-storage/:key upserts one key and leaves siblings put', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'PUT',
      url: '/api/v1/commands/plugin-storage/added',
      payload: { baseRevision: revision, value: { mode: 'new' } },
    })

    expect(metric.mutationPath).toBe('targeted-plugin-storage')
    expect(metric.writtenTables).toEqual(['plugin_custom_storage'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(readPluginStorage()).toEqual({
      keep: { mode: 'baseline' },
      drop: { mode: 'baseline' },
      added: { mode: 'new' },
    })
  })

  it('DELETE plugin-storage/:key removes one key and leaves siblings put', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'DELETE',
      url: '/api/v1/commands/plugin-storage/drop',
      payload: { baseRevision: revision },
    })

    expect(metric.mutationPath).toBe('targeted-plugin-storage')
    expect(metric.writtenTables).toEqual(['plugin_custom_storage'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(readPluginStorage()).toEqual({ keep: { mode: 'baseline' } })
  })

  it('POST plugin-storage/bulk applies clear + delete + replace semantics', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/plugin-storage/bulk',
      payload: {
        baseRevision: revision,
        clear: true,
        values: { fresh: { mode: 'fresh' }, also: { mode: 'also' } },
      },
    })

    expect(metric.mutationPath).toBe('targeted-plugin-storage')
    expect(metric.writtenTables).toEqual(['plugin_custom_storage'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    // clear=true drops the baseline keys; only the replacement values remain.
    expect(readPluginStorage()).toEqual({ fresh: { mode: 'fresh' }, also: { mode: 'also' } })
  })

  it('POST plugin-storage/bulk without clear merges over existing keys', async () => {
    const revision = await importDatabase(seedDatabase())

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/plugin-storage/bulk',
      payload: {
        baseRevision: revision,
        deleteKeys: ['drop'],
        values: { keep: { mode: 'updated' }, added: { mode: 'new' } },
      },
    })

    expect(metric.mutationPath).toBe('targeted-plugin-storage')
    expect(metric.writtenTables).toEqual(['plugin_custom_storage'])
    expect(readPluginStorage()).toEqual({
      keep: { mode: 'updated' },
      added: { mode: 'new' },
    })
  })
})
