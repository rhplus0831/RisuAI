import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import { buildApp } from '../src/app.js'
import { setupAuthedClient } from './helpers/auth.js'
import { assertCommandMetricGate, type CommandMutationMetric } from './helpers/commandMetricGates.js'
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
    botPresetsId: 0,
    // A "current" settings scalar + prompt items that `applyPreset` overwrites.
    temperature: 0.5,
    selectedPersona: 0,
    // Legacy profile mirror scalars (settings) that select/delete/patch refresh.
    username: 'legacy-user',
    userIcon: '',
    personaPrompt: 'legacy-prompt',
    userNote: 'legacy-note',
    // Translator legacy scalars (settings) re-synced on every translator command.
    translatorPresetId: 0,
    translatorPrompt: 'pa-prompt',
    translatorMaxResponse: 500,
    // Loadout legacy pointer scalar (settings); touch/delete rewrite it.
    lastLoadedLoadoutName: 'Loadout A',
    hypaV3Presets: [{ name: 'hypa-0' }],
    botPresets: [
      { id: 'preset-0', name: 'P0', temperature: 0.1, promptTemplate: [{ type: 'plain', text: 'pt-0' }] },
      { id: 'preset-1', name: 'P1', temperature: 0.9, promptTemplate: [{ type: 'plain', text: 'pt-1' }] },
    ],
    modules: [
      { id: 'mod-a', name: 'Module A', regex: [], trigger: [], lorebook: [] },
      { id: 'mod-b', name: 'Module B', regex: [], trigger: [], lorebook: [] },
    ],
    plugins: [pluginRecord('plugin-a'), pluginRecord('plugin-b'), pluginRecord('plugin-c')],
    personas: [
      { id: 'persona-a', name: 'Persona A', personaPrompt: 'pa-prompt', note: 'pa-note' },
      { id: 'persona-b', name: 'Persona B', personaPrompt: 'pb-prompt', note: 'pb-note' },
    ],
    loadouts: [
      { id: 'loadout-a', name: 'Loadout A', lastUsed: 1 },
      { id: 'loadout-b', name: 'Loadout B', lastUsed: 2 },
    ],
    loreBook: [
      { id: 'lore-0', name: 'lore-0', data: [] },
      { id: 'lore-1', name: 'lore-1', data: [] },
    ],
    translatorPresets: [
      { id: 'tp-a', name: 'TP A', prompt: 'pa-prompt', maxResponse: 500 },
      { id: 'tp-b', name: 'TP B', prompt: 'pb-prompt', maxResponse: 800 },
    ],
    promptTemplate: [{ type: 'plain', text: 'current' }],
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
  const inject = harness.app.inject as unknown as (request: CommandRequest) => Promise<CommandResponse>
  const res = await inject({
    ...request,
    headers: { 'risu-auth': assertion, ...(request.headers ?? {}) },
  })
  expect(res.statusCode, JSON.stringify(res.json())).toBe(200)
  const body = res.json() as Record<string, unknown>
  const metric = metrics.slice(before).find((entry) => entry.metric === 'command_mutation' && entry.status === 'ok')
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
function expectNoCharacterOrChatChurn(before: {
  characters: Record<string, number>
  chats: Record<string, number>
}): void {
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
    expect(readCollection('plugins').map((p) => (p as { name: string }).name)).toEqual(['plugin-a', 'plugin-c'])
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
    expect(readCollection('plugins').map((p) => (p as { name: string }).name)).toEqual(['plugin-b', 'plugin-c'])
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

describe('Phase 4 presets collection range', () => {
  it('POST presets rewrites only the bot_presets table', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/presets',
      payload: { baseRevision: revision, preset: { id: 'preset-2', name: 'P2' } },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['bot_presets'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(readCollection('bot_presets').map((p) => (p as { id: string }).id)).toEqual([
      'preset-0',
      'preset-1',
      'preset-2',
    ])
    expect(readSettings().botPresetsId).toBe(0)
  })

  it('PATCH presets/:id updates one row in place', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()
    const beforeRowids = collectionRowidsByPosition('bot_presets')

    const { metric } = await runCommand({
      method: 'PATCH',
      url: '/api/v1/commands/presets/preset-1',
      payload: { baseRevision: revision, patch: { name: 'Renamed P1' } },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['bot_presets'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(collectionRowidsByPosition('bot_presets')).toEqual(beforeRowids)
    const presets = readCollection('bot_presets') as Array<{ id: string; name: string }>
    expect(presets[1]).toMatchObject({ id: 'preset-1', name: 'Renamed P1' })
    expect(presets[0].name).toBe('P0')
  })

  it('POST presets/:id/copy rewrites only the bot_presets table', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/presets/preset-0/copy',
      payload: { baseRevision: revision, newPresetId: 'preset-0-copy', saveCurrent: false },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['bot_presets'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(readCollection('bot_presets').map((p) => (p as { id: string }).id)).toEqual([
      'preset-0',
      'preset-1',
      'preset-0-copy',
    ])
    expect(readSettings().botPresetsId).toBe(0)
  })

  it('POST presets/import rewrites only the bot_presets table', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/presets/import',
      payload: { baseRevision: revision, preset: { id: 'preset-imp', name: 'Imported' } },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['bot_presets'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(readCollection('bot_presets').map((p) => (p as { id: string }).id)).toEqual([
      'preset-0',
      'preset-1',
      'preset-imp',
    ])
  })

  it('POST presets/reorder co-writes settings when the selected index moves', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    // Selected preset-0 (index 0) moves to index 1, so botPresetsId must update.
    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/presets/reorder',
      payload: { baseRevision: revision, presetIds: ['preset-1', 'preset-0'] },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['bot_presets', 'settings'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(readCollection('bot_presets').map((p) => (p as { id: string }).id)).toEqual(['preset-1', 'preset-0'])
    expect(readSettings().botPresetsId).toBe(1)
  })

  it('DELETE presets/:id (no apply) co-writes settings when the pointer shifts', async () => {
    // Select preset-1 (index 1); deleting preset-0 shifts it to index 0.
    const seed = seedDatabase()
    seed.botPresetsId = 1
    const revision = await importDatabase(seed)
    const before = rowidSnapshot()

    const { metric, body } = await runCommand({
      method: 'DELETE',
      url: '/api/v1/commands/presets/preset-0',
      payload: { baseRevision: revision },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['bot_presets', 'settings'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(readCollection('bot_presets').map((p) => (p as { id: string }).id)).toEqual(['preset-1'])
    expect(readSettings().botPresetsId).toBe(0)
    expect(body.selectedPresetId).toBe('preset-1')
    // No apply, so the prompt-items table is untouched (still the "current" item;
    // import stamps each prompt item with a normalization id).
    const promptItems = readCollection('prompt_templates') as Array<{ text: string }>
    expect(promptItems).toHaveLength(1)
    expect(promptItems[0].text).toBe('current')
  })

  it('DELETE presets/:id with apply=true also writes prompt_templates + settings', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    // Delete preset-1, re-select + apply preset-0 (carries its promptTemplate +
    // settings scalars). This is the documented two-table + settings case.
    const { metric } = await runCommand({
      method: 'DELETE',
      url: '/api/v1/commands/presets/preset-1',
      payload: { baseRevision: revision, apply: true, presetId: 'preset-0' },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['bot_presets', 'prompt_templates', 'settings'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(readCollection('bot_presets').map((p) => (p as { id: string }).id)).toEqual(['preset-0'])
    // applyPreset copied preset-0's promptTemplate + temperature scalar.
    expect(readCollection('prompt_templates')).toEqual([{ type: 'plain', text: 'pt-0' }])
    expect(readSettings().temperature).toBe(0.1)
  })

  it('POST presets/select writes bot_presets + prompt_templates + settings (apply)', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    // Default saveCurrent + apply: snapshot the outgoing preset into bot_presets,
    // move the pointer, and apply preset-1's promptTemplate + scalars.
    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/presets/select',
      payload: { baseRevision: revision, presetId: 'preset-1' },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['bot_presets', 'prompt_templates', 'settings'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(readSettings().botPresetsId).toBe(1)
    expect(readSettings().temperature).toBe(0.9)
    expect(readCollection('prompt_templates')).toEqual([{ type: 'plain', text: 'pt-1' }])
  })
})

describe('Phase 4 prompt-items collection range', () => {
  // Seed prompt items (with stable ids so per-id routes resolve them).
  async function importWithPromptItems(): Promise<number> {
    const seed = seedDatabase()
    seed.promptTemplate = [
      { id: 'item-0', type: 'plain', text: 'i0' },
      { id: 'item-1', type: 'plain', text: 'i1' },
      { id: 'item-2', type: 'plain', text: 'i2' },
    ]
    return importDatabase(seed)
  }

  it('POST prompt-items rewrites only the prompt_templates table', async () => {
    const revision = await importWithPromptItems()
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/prompt-items',
      payload: { baseRevision: revision, promptItem: { id: 'item-3', type: 'plain', text: 'i3' } },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['prompt_templates'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect((readCollection('prompt_templates') as Array<{ id: string }>).map((i) => i.id)).toEqual([
      'item-0',
      'item-1',
      'item-2',
      'item-3',
    ])
  })

  it('PATCH prompt-items/:id updates one row in place', async () => {
    const revision = await importWithPromptItems()
    const before = rowidSnapshot()
    const beforeRowids = collectionRowidsByPosition('prompt_templates')

    const { metric } = await runCommand({
      method: 'PATCH',
      url: '/api/v1/commands/prompt-items/item-1',
      payload: { baseRevision: revision, patch: { text: 'patched' } },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['prompt_templates'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(collectionRowidsByPosition('prompt_templates')).toEqual(beforeRowids)
    const items = readCollection('prompt_templates') as Array<{ id: string; text: string }>
    expect(items[1]).toMatchObject({ id: 'item-1', text: 'patched' })
    expect(items[0].text).toBe('i0')
  })

  it('DELETE prompt-items/:id rewrites only the prompt_templates table', async () => {
    const revision = await importWithPromptItems()
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'DELETE',
      url: '/api/v1/commands/prompt-items/item-1',
      payload: { baseRevision: revision },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['prompt_templates'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect((readCollection('prompt_templates') as Array<{ id: string }>).map((i) => i.id)).toEqual(['item-0', 'item-2'])
  })

  it('POST prompt-items/enable=false clears only the prompt_templates table', async () => {
    const revision = await importWithPromptItems()
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/prompt-items/enable',
      payload: { baseRevision: revision, enabled: false },
    })

    // Disabling clears the whole collection — still one table, no characters/chats.
    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['prompt_templates'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(readCollection('prompt_templates')).toEqual([])
  })

  it('POST prompt-items/reorder rewrites only the prompt_templates table', async () => {
    const revision = await importWithPromptItems()
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/prompt-items/reorder',
      payload: { baseRevision: revision, itemIds: ['item-2', 'item-0', 'item-1'] },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['prompt_templates'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect((readCollection('prompt_templates') as Array<{ id: string }>).map((i) => i.id)).toEqual([
      'item-2',
      'item-0',
      'item-1',
    ])
  })
})

describe('Phase 4 personas collection range', () => {
  it('POST personas (no mirror) rewrites only the personas table', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/personas',
      payload: { baseRevision: revision, persona: { id: 'persona-c', name: 'Persona C' } },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['personas'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect((readCollection('personas') as Array<{ id: string }>).map((p) => p.id)).toEqual([
      'persona-a',
      'persona-b',
      'persona-c',
    ])
    // No mirror: pointer + legacy scalars untouched.
    expect(readSettings().selectedPersona).toBe(0)
    expect(readSettings().username).toBe('legacy-user')
  })

  it('POST personas with mirror co-writes settings (pointer + legacy scalars)', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/personas',
      payload: {
        baseRevision: revision,
        mirrorLegacyProfile: true,
        persona: { id: 'persona-c', name: 'Persona C', personaPrompt: 'pc-prompt', note: 'pc-note' },
      },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['personas', 'settings'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    const settings = readSettings()
    expect(settings.selectedPersona).toBe(2)
    expect(settings.username).toBe('Persona C')
    expect(settings.personaPrompt).toBe('pc-prompt')
    expect(settings.userNote).toBe('pc-note')
  })

  it('PATCH personas/:id updates one row in place (no mirror by default)', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()
    const beforeRowids = collectionRowidsByPosition('personas')

    const { metric } = await runCommand({
      method: 'PATCH',
      url: '/api/v1/commands/personas/persona-b',
      payload: { baseRevision: revision, patch: { name: 'Renamed B' } },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['personas'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(collectionRowidsByPosition('personas')).toEqual(beforeRowids)
    const personas = readCollection('personas') as Array<{ id: string; name: string }>
    expect(personas[1]).toMatchObject({ id: 'persona-b', name: 'Renamed B' })
    expect(personas[0].name).toBe('Persona A')
  })

  it('POST personas/select writes personas + settings (default mirror + save)', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/personas/select',
      payload: { baseRevision: revision, personaId: 'persona-b' },
    })

    // Default saveCurrent snapshots the outgoing persona into the table; default
    // mirror copies persona-b's profile into the legacy settings scalars.
    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['personas', 'settings'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    const settings = readSettings()
    expect(settings.selectedPersona).toBe(1)
    expect(settings.username).toBe('Persona B')
    expect(settings.personaPrompt).toBe('pb-prompt')
    expect(settings.userNote).toBe('pb-note')
  })

  it('POST personas/select (no save, no mirror) writes only settings (pointer)', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/personas/select',
      payload: {
        baseRevision: revision,
        personaId: 'persona-b',
        saveCurrent: false,
        mirrorLegacyProfile: false,
      },
    })

    // Only the pointer moves — no table write, just the one settings scalar.
    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['settings'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(readSettings().selectedPersona).toBe(1)
    // Mirror off: legacy scalars unchanged.
    expect(readSettings().username).toBe('legacy-user')
  })

  it('DELETE personas/:id writes personas + settings (default mirror)', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric, body } = await runCommand({
      method: 'DELETE',
      url: '/api/v1/commands/personas/persona-a',
      payload: { baseRevision: revision },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['personas', 'settings'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect((readCollection('personas') as Array<{ id: string }>).map((p) => p.id)).toEqual(['persona-b'])
    expect(readSettings().selectedPersona).toBe(0)
    expect(body.selectedPersonaId).toBe('persona-b')
    // Default mirror refreshed the legacy scalars from the new selection.
    expect(readSettings().username).toBe('Persona B')
  })

  it('POST personas/reorder co-writes settings when the selected index moves', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    // Selected persona-a (index 0) moves to index 1.
    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/personas/reorder',
      payload: { baseRevision: revision, personaIds: ['persona-b', 'persona-a'] },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['personas', 'settings'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect((readCollection('personas') as Array<{ id: string }>).map((p) => p.id)).toEqual(['persona-b', 'persona-a'])
    expect(readSettings().selectedPersona).toBe(1)
  })
})

describe('Phase 4 translator-presets collection range', () => {
  // Every translator route re-syncs the legacy scalars, so all four write the
  // table + settings unconditionally.
  const EXPECTED = ['settings', 'translator_presets']

  it('POST translator-presets writes translator_presets + settings', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/translator-presets',
      payload: {
        baseRevision: revision,
        preset: { id: 'tp-c', name: 'TP C', prompt: 'pc', maxResponse: 900 },
      },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(EXPECTED)
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect((readCollection('translator_presets') as Array<{ id: string }>).map((p) => p.id)).toEqual([
      'tp-a',
      'tp-b',
      'tp-c',
    ])
    // No select: pointer + legacy fields still reflect tp-a.
    expect(readSettings().translatorPresetId).toBe(0)
    expect(readSettings().translatorPrompt).toBe('pa-prompt')
  })

  it('PATCH translator-presets/:id rewrites the table + re-syncs settings', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'PATCH',
      url: '/api/v1/commands/translator-presets/tp-a',
      payload: { baseRevision: revision, patch: { prompt: 'pa-edited' } },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(EXPECTED)
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    // tp-a is selected, so its edited prompt mirrors into the legacy scalar.
    expect(readSettings().translatorPrompt).toBe('pa-edited')
  })

  it('DELETE translator-presets/:id writes translator_presets + settings', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric, body } = await runCommand({
      method: 'DELETE',
      url: '/api/v1/commands/translator-presets/tp-b',
      payload: { baseRevision: revision },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(EXPECTED)
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect((readCollection('translator_presets') as Array<{ id: string }>).map((p) => p.id)).toEqual(['tp-a'])
    expect(body.selectedPresetId).toBe('tp-a')
  })

  it('POST translator-presets/select writes translator_presets + settings', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/translator-presets/select',
      payload: { baseRevision: revision, presetId: 'tp-b' },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(EXPECTED)
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    const settings = readSettings()
    expect(settings.translatorPresetId).toBe(1)
    expect(settings.translatorPrompt).toBe('pb-prompt')
    expect(settings.translatorMaxResponse).toBe(800)
  })
})

describe('Phase 4 loadouts collection range', () => {
  it('POST loadouts rewrites only the loadouts table', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/loadouts',
      payload: { baseRevision: revision, loadout: { id: 'loadout-c', name: 'Loadout C' } },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['loadouts'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect((readCollection('loadouts') as Array<{ id: string }>).map((l) => l.id)).toEqual([
      'loadout-a',
      'loadout-b',
      'loadout-c',
    ])
    // Pointer scalar unchanged → settings stayed out of writtenTables.
    expect(readSettings().lastLoadedLoadoutName).toBe('Loadout A')
  })

  it('PATCH loadouts/:id rewrites only the loadouts table', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'PATCH',
      url: '/api/v1/commands/loadouts/loadout-b',
      payload: { baseRevision: revision, patch: { name: 'Renamed B' } },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['loadouts'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    const loadouts = readCollection('loadouts') as Array<{ id: string; name: string }>
    expect(loadouts[1]).toMatchObject({ id: 'loadout-b', name: 'Renamed B' })
  })

  it('DELETE loadouts/:id rewrites only the loadouts table', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'DELETE',
      url: '/api/v1/commands/loadouts/loadout-a',
      payload: { baseRevision: revision },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['loadouts'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect((readCollection('loadouts') as Array<{ id: string }>).map((l) => l.id)).toEqual(['loadout-b'])
  })

  it('POST loadouts/:id/favorite rewrites only the loadouts table', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/loadouts/loadout-b/favorite',
      payload: { baseRevision: revision, favorite: true },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['loadouts'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    const loadouts = readCollection('loadouts') as Array<{ id: string; favorite: boolean }>
    expect(loadouts[1]).toMatchObject({ id: 'loadout-b', favorite: true })
  })

  it('POST loadouts/:id/touch co-writes settings (lastLoadedLoadoutName)', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/loadouts/loadout-b/touch',
      payload: { baseRevision: revision, lastUsed: 999 },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['loadouts', 'settings'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    // touch sets lastLoadedLoadoutName to the touched loadout's name.
    expect(readSettings().lastLoadedLoadoutName).toBe('Loadout B')
    const loadouts = readCollection('loadouts') as Array<{ id: string; lastUsed: number }>
    expect(loadouts[1]).toMatchObject({ id: 'loadout-b', lastUsed: 999 })
  })
})

describe('Phase 4 lorebooks collection range', () => {
  it('POST lorebooks rewrites only the lore_books table', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/lorebooks',
      payload: { baseRevision: revision, lorebook: { id: 'lore-2', name: 'lore-2', data: [] } },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['lore_books'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect((readCollection('lore_books') as Array<{ id: string }>).map((l) => l.id)).toEqual([
      'lore-0',
      'lore-1',
      'lore-2',
    ])
    // Pointer unchanged → settings stayed out; child lorebooks untouched.
    expect(readSettings().loreBookPage).toBe(0)
  })

  it('PATCH lorebooks/:id updates one row in place (no settings)', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()
    const beforeRowids = collectionRowidsByPosition('lore_books')

    const { metric } = await runCommand({
      method: 'PATCH',
      url: '/api/v1/commands/lorebooks/lore-1',
      payload: { baseRevision: revision, patch: { name: 'Renamed Lore 1' } },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['lore_books'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(collectionRowidsByPosition('lore_books')).toEqual(beforeRowids)
    const books = readCollection('lore_books') as Array<{ id: string; name: string }>
    expect(books[1]).toMatchObject({ id: 'lore-1', name: 'Renamed Lore 1' })
    expect(books[0].name).toBe('lore-0')
  })

  it('DELETE lorebooks/:id co-writes settings when the page pointer shifts', async () => {
    const seed = seedDatabase()
    seed.loreBookPage = 1
    const revision = await importDatabase(seed)
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'DELETE',
      url: '/api/v1/commands/lorebooks/lore-0',
      payload: { baseRevision: revision },
    })

    // delete resets loreBookPage to 0; the seed had 1, so settings rides along.
    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['lore_books', 'settings'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect((readCollection('lore_books') as Array<{ id: string }>).map((l) => l.id)).toEqual(['lore-1'])
    expect(readSettings().loreBookPage).toBe(0)
  })

  it('POST lorebooks/reorder co-writes settings when the page pointer moves', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    // Selected lore-0 (page 0) moves to index 1.
    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/lorebooks/reorder',
      payload: { baseRevision: revision, lorebookIds: ['lore-1', 'lore-0'] },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['lore_books', 'settings'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect((readCollection('lore_books') as Array<{ id: string }>).map((l) => l.id)).toEqual(['lore-1', 'lore-0'])
    expect(readSettings().loreBookPage).toBe(1)
  })

  it('PUT lorebooks/:id/entries updates one row in place (no settings)', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()
    const beforeRowids = collectionRowidsByPosition('lore_books')

    const { metric } = await runCommand({
      method: 'PUT',
      url: '/api/v1/commands/lorebooks/lore-0/entries',
      payload: {
        baseRevision: revision,
        entries: [{ id: 'entry-1', key: 'k', content: 'c' }],
      },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['lore_books'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(collectionRowidsByPosition('lore_books')).toEqual(beforeRowids)
    const books = readCollection('lore_books') as Array<{ id: string; data: Array<{ id: string }> }>
    expect(books[0].id).toBe('lore-0')
    expect(books[0].data.map((e) => e.id)).toEqual(['entry-1'])
    // Sibling lorebook untouched.
    expect(books[1].id).toBe('lore-1')
  })
})

describe('Phase 4 modules collection range', () => {
  const SCRIPT = {
    id: 'script-a',
    comment: 'Regex',
    in: 'a',
    out: 'b',
    type: 'editinput',
    flag: 'g',
    ableFlag: true,
  }
  const TRIGGER = { id: 'trigger-a', comment: 'Start', type: 'start', conditions: [], effect: [] }

  it('PATCH modules/:id updates one row in place', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()
    const beforeRowids = collectionRowidsByPosition('modules')

    const { metric } = await runCommand({
      method: 'PATCH',
      url: '/api/v1/commands/modules/mod-b',
      payload: { baseRevision: revision, patch: { name: 'Renamed B' } },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['modules'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(collectionRowidsByPosition('modules')).toEqual(beforeRowids)
    const modules = readCollection('modules') as Array<{ id: string; name: string }>
    expect(modules[1]).toMatchObject({ id: 'mod-b', name: 'Renamed B' })
    expect(modules[0].name).toBe('Module A')
  })

  it('POST modules/reorder rewrites only the modules table', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/modules/reorder',
      payload: { baseRevision: revision, moduleIds: ['mod-b', 'mod-a'] },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['modules'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect((readCollection('modules') as Array<{ id: string }>).map((m) => m.id)).toEqual(['mod-b', 'mod-a'])
  })

  it('PUT modules/:id/lorebooks updates one row in place', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()
    const beforeRowids = collectionRowidsByPosition('modules')

    const { metric } = await runCommand({
      method: 'PUT',
      url: '/api/v1/commands/modules/mod-b/lorebooks',
      payload: { baseRevision: revision, entries: [{ id: 'e-1', key: 'k', content: 'c' }] },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['modules'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    expect(collectionRowidsByPosition('modules')).toEqual(beforeRowids)
    const modules = readCollection('modules') as Array<{ id: string; lorebook: Array<{ id: string }> }>
    expect(modules[1].id).toBe('mod-b')
    expect(modules[1].lorebook.map((e) => e.id)).toEqual(['e-1'])
  })

  it('PUT modules/:id/scripts rewrites modules; character repairs stay validate-only', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'PUT',
      url: '/api/v1/commands/modules/mod-a/scripts',
      payload: { baseRevision: revision, scripts: [SCRIPT] },
    })

    // writtenTables proves characters were NOT written — the cross-character
    // script-definition repair was dropped to validate-only.
    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['modules'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    const modules = readCollection('modules') as Array<{ id: string; regex: Array<{ id: string }> }>
    expect(modules[0].regex.map((s) => s.id)).toEqual(['script-a'])
  })

  it('PUT modules/:id/triggers rewrites modules; character repairs stay validate-only', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'PUT',
      url: '/api/v1/commands/modules/mod-a/triggers',
      payload: { baseRevision: revision, triggers: [TRIGGER] },
    })

    expect(metric.mutationPath).toBe('targeted-collection')
    expect(metric.writtenTables).toEqual(['modules'])
    assertCommandMetricGate(metric)
    expectNoCharacterOrChatChurn(before)
    const modules = readCollection('modules') as Array<{ id: string; trigger: Array<{ id: string }> }>
    expect(modules[0].trigger.map((t) => t.id)).toEqual(['trigger-a'])
  })
})
