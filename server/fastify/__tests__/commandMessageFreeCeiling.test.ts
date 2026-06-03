import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import { buildApp } from '../src/app.js'
import { setupAuthedClient } from './helpers/auth.js'
import {
  BROAD_WRITE_TABLES,
  assertCommandMetricGate,
  type CommandMutationMetric,
} from './helpers/commandMetricGates.js'

// Phase 6 (the message-free ceiling) regression. Each test PROVES a Tier-5
// route's floor was correct and the documented blocker is load-bearing. Phase 8
// has since landed the unblock prerequisites for the high-value subset, so the
// two deletes and the two script/trigger PUTs have graduated below the floor
// (asserted here at their new range; detailed proof in commandFloorUnblock.test.ts):
//
//   * DELETE characters/:id and DELETE chats/:id GRADUATED to
//     `targeted-character-row` (Phase 8b + follow-up): the orphan cleanup now
//     loops the targeted deleteChatMessages/deleteChatHypaV3 over the removed
//     chat(s) instead of hydrating every message of every chat.
//   * DELETE modules/:id stays `message-free`: `removeModuleReferences` strips
//     the id across characters, chats, the loadouts collection, and settings, so
//     no single-table lever applies and it writes the full broad set.
//   * POST characters/:id/chats stays `hydrated`: the duplicate-message-id
//     validation scans every chat's messages corpus-wide, a real message-load
//     dependency.
//   * POST characters, POST characters/create-and-select, POST modules stay
//     `message-free` (their dropped id-repair side effects are the recorded
//     unblock conditions, not done here).
//   * PUT characters/:id/scripts and PUT characters/:id/triggers GRADUATED to
//     `targeted-character-row` (Phase 8a): the normalization is validate-only via
//     discard, so only the target character row is written.

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
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-phase6-ceiling-'))
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
    enabledModules: ['mod-x'],
    modules: [
      { id: 'mod-x', name: 'Module X' },
      { id: 'mod-y', name: 'Module Y' },
    ],
    loadouts: [{ id: 'loadout-a', name: 'Loadout A', modules: ['mod-x', 'mod-y'] }],
    characters: [
      {
        type: 'character',
        chaId: 'char-a',
        name: 'A',
        chatPage: 0,
        globalLore: [],
        modules: ['mod-x'],
        chats: [
          {
            id: 'chat-a-1',
            name: 'A1',
            modules: ['mod-x'],
            localLore: [],
            message: [{ role: 'user', data: 'hello a1', chatId: 'msg-a-1' }],
          },
          { id: 'chat-a-2', name: 'A2', localLore: [], message: [] },
        ],
      },
      {
        type: 'character',
        chaId: 'char-b',
        name: 'B',
        chatPage: 0,
        globalLore: [],
        chats: [
          {
            id: 'chat-b-1',
            name: 'B1',
            localLore: [],
            message: [{ role: 'user', data: 'hello b1', chatId: 'shared-msg' }],
          },
        ],
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

function inject(request: CommandRequest): Promise<CommandResponse> {
  const fn = harness.app.inject as unknown as (request: CommandRequest) => Promise<CommandResponse>
  return fn({ ...request, headers: { 'risu-auth': assertion, ...(request.headers ?? {}) } })
}

async function runCommand(
  request: CommandRequest,
): Promise<{ revision: number; metric: CommandMutationMetric; body: Record<string, unknown> }> {
  const before = metrics.length
  const res = await inject(request)
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

function readCharacter(id: string): Record<string, unknown> {
  const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
  try {
    const row = db.prepare('SELECT data_json FROM characters WHERE id = ?').get(id) as
      | { data_json: string }
      | undefined
    return row ? (JSON.parse(row.data_json) as Record<string, unknown>) : {}
  } finally {
    db.close()
  }
}

function readChat(id: string): Record<string, unknown> {
  const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
  try {
    const row = db.prepare('SELECT data_json FROM chats WHERE id = ?').get(id) as {
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

/** Stored character ids in `position` order. */
function readCharacterIds(): string[] {
  const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
  try {
    const rows = db.prepare('SELECT id FROM characters ORDER BY position').all() as Array<{
      id: string
    }>
    return rows.map((r) => r.id)
  } finally {
    db.close()
  }
}

/** Stored chat ids for one character in `position` order. */
function readChatIds(characterId: string): string[] {
  const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
  try {
    const rows = db
      .prepare('SELECT id FROM chats WHERE character_id = ? ORDER BY position')
      .all(characterId) as Array<{ id: string }>
    return rows.map((r) => r.id)
  } finally {
    db.close()
  }
}

/** Count of active + alternate message rows still stored for a chat id. */
function messageRowCount(chatId: string): number {
  const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
  try {
    const row = db
      .prepare('SELECT COUNT(*) AS count FROM messages WHERE chat_id = ?')
      .get(chatId) as { count: number }
    return row.count
  } finally {
    db.close()
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

describe('Phase 6 message-dependent delete floors', () => {
  it('DELETE characters/:id narrows to targeted-character-row (Phase 8 follow-up) and cleans up its chats\' message rows', async () => {
    const revision = await importDatabase(seedDatabase())
    // The deleted character owns a chat with a persisted message row.
    expect(messageRowCount('chat-a-1')).toBe(1)

    const { metric } = await runCommand({
      method: 'DELETE',
      url: '/api/v1/commands/characters/char-a',
      payload: { baseRevision: revision },
    })

    // Graduated off the hydrated floor: the orphan cleanup loops the targeted
    // deleteChatMessages/deleteChatHypaV3 over the removed character's chats
    // instead of hydrating the corpus. Detailed proof in commandFloorUnblock.test.ts.
    expect(metric.mutationPath).toBe('targeted-character-row')
    expect(metric.writtenTables).toContain('messages')
    assertCommandMetricGate(metric)
    expect(readCharacterIds()).toEqual(['char-b'])
    expect(messageRowCount('chat-a-1')).toBe(0)
  })

  it('DELETE chats/:id narrows to targeted-character-row (Phase 8b) and still cleans the deleted chat\'s message rows', async () => {
    const revision = await importDatabase(seedDatabase())
    expect(messageRowCount('chat-a-1')).toBe(1)

    const { metric } = await runCommand({
      method: 'DELETE',
      url: '/api/v1/commands/chats/chat-a-1',
      payload: { baseRevision: revision },
    })

    // Phase 8b graduated this off the hydrated floor: the orphan cleanup now uses
    // the targeted deleteChatMessages/deleteChatHypaV3 instead of a corpus-wide
    // message load. Detailed proof lives in commandFloorUnblock.test.ts.
    expect(metric.mutationPath).toBe('targeted-character-row')
    expect(metric.writtenTables).toContain('messages')
    assertCommandMetricGate(metric)
    // The deleted chat's messages are gone; the sibling chat survives untouched.
    expect(messageRowCount('chat-a-1')).toBe(0)
    expect(readChatIds('char-a')).toEqual(['chat-a-2'])
    expect(messageRowCount('chat-b-1')).toBe(1)
  })

  it('DELETE modules/:id stays message-free and strips references across every table', async () => {
    const revision = await importDatabase(seedDatabase())

    const { metric } = await runCommand({
      method: 'DELETE',
      url: '/api/v1/commands/modules/mod-x',
      payload: { baseRevision: revision },
    })

    // `removeModuleReferences` spans settings + characters + chats + loadouts, so
    // the floor is `message-free` writing the full broad set — no single-table
    // lever applies. The gate enforces exactly the broad table set.
    expect(metric.mutationPath).toBe('message-free')
    assertCommandMetricGate(metric)
    expect(readSettings().enabledModules).toEqual([])
    expect(readCharacter('char-a').modules).toEqual([])
    expect(readChat('chat-a-1').modules).toEqual([])
    expect((readCollection('loadouts')[0] as { modules: string[] }).modules).toEqual(['mod-y'])
    expect((readCollection('modules') as Array<{ id: string }>).map((m) => m.id)).toEqual(['mod-y'])
  })
})

describe('Phase 6 message-validation create floor', () => {
  it('POST characters/:id/chats stays hydrated and validates message ids corpus-wide', async () => {
    const revision = await importDatabase(seedDatabase())

    // The new chat reuses a message id that lives in a DIFFERENT character's
    // chat. Detecting it requires the full message corpus — the message-load
    // dependency that pins this route to `hydrated`.
    const rejected = await inject({
      method: 'POST',
      url: '/api/v1/commands/characters/char-a/chats',
      payload: {
        baseRevision: revision,
        chat: {
          id: 'chat-a-dup',
          name: 'Dup',
          message: [{ role: 'user', data: 'dup', chatId: 'shared-msg' }],
        },
      },
    })
    expect(rejected.statusCode).toBe(400)
    expect((rejected.json() as { error: string }).error).toContain('Duplicate message id')
    // The rejected create wrote no new chat row.
    expect(readChatIds('char-a')).toEqual(['chat-a-1', 'chat-a-2'])

    // A unique-id create succeeds and reports the `hydrated` floor.
    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/characters/char-a/chats',
      payload: {
        baseRevision: revision,
        chat: {
          id: 'chat-a-new',
          name: 'New',
          message: [{ role: 'user', data: 'fresh', chatId: 'fresh-msg' }],
        },
      },
    })
    expect(metric.mutationPath).toBe('hydrated')
    assertCommandMetricGate(metric)
    // unshift: the new chat lands at the head of char-a's chats.
    expect(readChatIds('char-a')).toEqual(['chat-a-new', 'chat-a-1', 'chat-a-2'])
    expect(messageRowCount('chat-a-new')).toBe(1)
  })
})

describe('Phase 6 message-free create + normalization floors', () => {
  it('POST characters appends one character at the message-free floor', async () => {
    const revision = await importDatabase(seedDatabase())

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/characters',
      payload: { baseRevision: revision, character: { chaId: 'char-c', name: 'C' } },
    })

    expect(metric.mutationPath).toBe('message-free')
    expect(metric.writtenTables).toEqual([...BROAD_WRITE_TABLES])
    assertCommandMetricGate(metric)
    expect(readCharacterIds()).toEqual(['char-a', 'char-b', 'char-c'])
  })

  it('POST characters/create-and-select appends + selects at the message-free floor', async () => {
    const revision = await importDatabase(seedDatabase())

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/characters/create-and-select',
      payload: { baseRevision: revision, character: { chaId: 'char-d', name: 'D' } },
    })

    expect(metric.mutationPath).toBe('message-free')
    expect(metric.writtenTables).toEqual([...BROAD_WRITE_TABLES])
    assertCommandMetricGate(metric)
    expect(readCharacterIds()).toEqual(['char-a', 'char-b', 'char-d'])
    expect(readSettings().currentChar).toBe(2)
  })

  it('POST modules appends one module at the message-free floor', async () => {
    const revision = await importDatabase(seedDatabase())

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/modules',
      payload: { baseRevision: revision, module: { id: 'mod-z', name: 'Module Z' } },
    })

    expect(metric.mutationPath).toBe('message-free')
    expect(metric.writtenTables).toEqual([...BROAD_WRITE_TABLES])
    assertCommandMetricGate(metric)
    expect((readCollection('modules') as Array<{ id: string }>).map((m) => m.id)).toEqual([
      'mod-x',
      'mod-y',
      'mod-z',
    ])
  })

  it('PUT characters/:id/scripts replaces customscript at the targeted-character-row range (Phase 8a)', async () => {
    const revision = await importDatabase(seedDatabase())

    const script = {
      id: 'script-a',
      comment: 'Regex',
      in: 'a',
      out: 'b',
      type: 'editinput',
      flag: 'g',
      ableFlag: true,
    }
    const { metric } = await runCommand({
      method: 'PUT',
      url: '/api/v1/commands/characters/char-a/scripts',
      payload: { baseRevision: revision, scripts: [script] },
    })

    // Phase 8a graduated this off the message-free floor onto one character row
    // (normalization is validate-only via discard). Detailed proof lives in
    // commandFloorUnblock.test.ts.
    expect(metric.mutationPath).toBe('targeted-character-row')
    expect(metric.writtenTables).toEqual(['characters'])
    assertCommandMetricGate(metric)
    expect(readCharacter('char-a').customscript).toEqual([script])
  })

  it('PUT characters/:id/triggers replaces triggerscript at the targeted-character-row range (Phase 8a)', async () => {
    const revision = await importDatabase(seedDatabase())

    const trigger = { id: 'trigger-a', comment: 'Start', type: 'start', conditions: [], effect: [] }
    const { metric } = await runCommand({
      method: 'PUT',
      url: '/api/v1/commands/characters/char-a/triggers',
      payload: { baseRevision: revision, triggers: [trigger] },
    })

    // Phase 8a graduated this off the message-free floor onto one character row.
    expect(metric.mutationPath).toBe('targeted-character-row')
    expect(metric.writtenTables).toEqual(['characters'])
    assertCommandMetricGate(metric)
    expect(readCharacter('char-a').triggerscript).toEqual([trigger])
  })
})
