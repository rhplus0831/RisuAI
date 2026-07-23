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

// Scoped floor-unblock regression. The high-value routes write only the target
// character's row(s) instead of the broad floor:
//   - PUT characters/:id/scripts + /triggers write one `characters` row
//     (normalization is validate-only via discard).
//   - DELETE chats/:id writes the parent character's rows plus a targeted
//     message/hypa delete.
// Each test proves the narrowing via the `command_mutation` metric (targeted path
// + `writtenTables`) and `tableRowidsById` (no unrelated row churn).

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
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-phase8-unblock-'))
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
    // A couple of collection rows so a broad-floor regression (a return to
    // rewriting everything) would churn collection tables the gate forbids.
    botPresets: [{ name: 'preset-0' }, { name: 'preset-1' }],
    modules: [{ id: 'mod-a', name: 'Module A' }],
    enabledModules: [],
    characters: [
      {
        type: 'character',
        chaId: 'char-a',
        name: 'A',
        chatPage: 1,
        globalLore: [],
        customscript: [{ id: 'rx-old', comment: 'old', in: 'a', out: 'b', type: 'editdisplay' }],
        triggerscript: [{ id: 'tr-old', comment: '', type: 'start', conditions: [], effect: [] }],
        chats: [
          {
            id: 'chat-a-1',
            name: 'A1',
            scriptstate: {},
            localLore: [],
            message: [
              { role: 'user', data: 'a1-m0', chatId: 'msg-a1-0' },
              { role: 'char', data: 'a1-m1', chatId: 'msg-a1-1' },
            ],
          },
          {
            id: 'chat-a-2',
            name: 'A2',
            scriptstate: {},
            localLore: [],
            hypaV3Data: { summaries: [{ text: 'a2 summary' }] },
            message: [{ role: 'user', data: 'a2-m0', chatId: 'msg-a2-0' }],
          },
          {
            id: 'chat-a-3',
            name: 'A3',
            scriptstate: {},
            localLore: [],
            message: [{ role: 'user', data: 'a3-m0', chatId: 'msg-a3-0' }],
          },
        ],
      },
      {
        type: 'character',
        chaId: 'char-b',
        name: 'B',
        chatPage: 0,
        globalLore: [],
        customscript: [{ id: 'rx-b', comment: 'b', in: 'x', out: 'y', type: 'editdisplay' }],
        chats: [
          {
            id: 'chat-b-1',
            name: 'B1',
            scriptstate: {},
            localLore: [],
            message: [{ role: 'user', data: 'b1-m0', chatId: 'msg-b1-0' }],
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

function readCharacter(id: string): Record<string, unknown> {
  const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
  try {
    const row = db.prepare('SELECT data_json FROM characters WHERE id = ?').get(id) as {
      data_json: string
    }
    return JSON.parse(row.data_json) as Record<string, unknown>
  } finally {
    db.close()
  }
}

/** Chat ids for one character in stored `position` order. */
function readChatOrder(characterId: string): string[] {
  const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
  try {
    const rows = db.prepare('SELECT id FROM chats WHERE character_id = ? ORDER BY position').all(characterId) as Array<{
      id: string
    }>
    return rows.map((r) => r.id)
  } finally {
    db.close()
  }
}

/** Character id→position pairs in stored `position` order (contiguity check). */
function readCharacterRows(): Array<{ id: string; position: number }> {
  const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
  try {
    return db.prepare('SELECT id, position FROM characters ORDER BY position').all() as Array<{
      id: string
      position: number
    }>
  } finally {
    db.close()
  }
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

/** Total message rows for a chat (active + every alternate). */
function countChatMessages(chatId: string): number {
  const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?').get(chatId) as { n: number }
    return row.n
  } finally {
    db.close()
  }
}

function countChatHypa(chatId: string): number {
  const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM chat_hypa_v3 WHERE chat_id = ?').get(chatId) as { n: number }
    return row.n
  } finally {
    db.close()
  }
}

function rowidSnapshot(): { characters: Record<string, number>; chats: Record<string, number> } {
  return {
    characters: tableRowidsById(harness.dataDir, 'characters'),
    chats: tableRowidsById(harness.dataDir, 'chats'),
  }
}

function expectNoChurn(
  before: { characters: Record<string, number>; chats: Record<string, number> },
  options: { characters?: string[]; chats?: string[] } = {},
): void {
  assertOnlyRowsWritten(before.characters, tableRowidsById(harness.dataDir, 'characters'), options.characters ?? [])
  assertOnlyRowsWritten(before.chats, tableRowidsById(harness.dataDir, 'chats'), options.chats ?? [])
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

describe('Phase 8a script/trigger PUTs → targeted-character-row', () => {
  it('PUT characters/:id/scripts writes only the target character row', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'PUT',
      url: '/api/v1/commands/characters/char-a/scripts',
      payload: {
        baseRevision: revision,
        scripts: [
          { id: 'rx-new-1', comment: 'n1', in: 'p', out: 'q', type: 'editdisplay' },
          { id: 'rx-new-2', comment: 'n2', in: 'r', out: 's', type: 'editinput' },
        ],
      },
    })

    expect(metric.mutationPath).toBe('targeted-character-row')
    expect(metric.writtenTables).toEqual(['characters'])
    expect(metric.dbJsonWriteMs).toBe(0)
    assertCommandMetricGate(metric)

    // Only char-a's row may have been rewritten; char-b and every chat row stay.
    expectNoChurn(before)

    const updated = readCharacter('char-a').customscript as Array<{ id: string }>
    expect(updated.map((s) => s.id)).toEqual(['rx-new-1', 'rx-new-2'])
    // Sibling character untouched (its row was never written).
    expect((readCharacter('char-b').customscript as Array<{ id: string }>)[0].id).toBe('rx-b')
  })

  it('PUT characters/:id/triggers writes only the target character row', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'PUT',
      url: '/api/v1/commands/characters/char-a/triggers',
      payload: {
        baseRevision: revision,
        triggers: [{ id: 'tr-new', comment: 'c', type: 'start', conditions: [], effect: [] }],
      },
    })

    expect(metric.mutationPath).toBe('targeted-character-row')
    expect(metric.writtenTables).toEqual(['characters'])
    expect(metric.dbJsonWriteMs).toBe(0)
    assertCommandMetricGate(metric)
    expectNoChurn(before)

    const updated = readCharacter('char-a').triggerscript as Array<{ id: string }>
    expect(updated.map((t) => t.id)).toEqual(['tr-new'])
    // The character's other fields (customscript, chatPage) are preserved.
    expect((readCharacter('char-a').customscript as Array<{ id: string }>)[0].id).toBe('rx-old')
    expect(readCharacter('char-a').chatPage).toBe(1)
  })

  it('PATCH characters/:id/scripts mutates one definition in only the target character row', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'PATCH',
      url: '/api/v1/commands/characters/char-a/scripts',
      payload: {
        baseRevision: revision,
        mutation: { op: 'update', id: 'rx-old', patch: { comment: 'compact update' } },
      },
    })

    expect(metric.mutationPath).toBe('targeted-character-row')
    expect(metric.writtenTables).toEqual(['characters'])
    expect(metric.dbJsonWriteMs).toBe(0)
    assertCommandMetricGate(metric)
    expectNoChurn(before)
    expect((readCharacter('char-a').customscript as Array<{ comment: string }>)[0].comment).toBe('compact update')
    expect((readCharacter('char-b').customscript as Array<{ id: string }>)[0].id).toBe('rx-b')
  })

  it('a malformed scripts payload is rejected without any write', async () => {
    const revision = await importDatabase(seedDatabase())
    const res = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/characters/char-a/scripts',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, scripts: [{ comment: 'no id' }] },
    })
    expect(res.statusCode).toBe(400)
    // Unchanged target row.
    expect((readCharacter('char-a').customscript as Array<{ id: string }>)[0].id).toBe('rx-old')
  })
})

describe('Phase 8b DELETE chats/:id → targeted-character-row', () => {
  it('writes only the parent character rows + the deleted chat message/hypa rows', async () => {
    const revision = await importDatabase(seedDatabase())

    // Preconditions: the target chat has message + hypa rows; siblings too.
    expect(countChatMessages('chat-a-2')).toBe(1)
    expect(countChatHypa('chat-a-2')).toBe(1)
    expect(readChatOrder('char-a')).toEqual(['chat-a-1', 'chat-a-2', 'chat-a-3'])

    const before = rowidSnapshot()
    const { metric, body } = await runCommand({
      method: 'DELETE',
      url: '/api/v1/commands/chats/chat-a-2',
      payload: { baseRevision: revision },
    })

    expect(metric.mutationPath).toBe('targeted-character-row')
    expect(metric.dbJsonWriteMs).toBe(0)
    // The targeted write touches the parent character row, the chats table, and
    // the deleted chat's message/hypa rows — nothing else (no collections).
    expect(metric.writtenTables).toEqual(['characters', 'chat_hypa_v3', 'chats', 'messages'])
    assertCommandMetricGate(metric)

    // Only the deleted chat row changed identity; remaining chats were UPDATEd in
    // place (rowid stable) and char-b's chat is untouched.
    expectNoChurn(before, { chats: ['chat-a-2'] })

    // The deleted chat is gone from the chats table and order is preserved.
    expect(readChatOrder('char-a')).toEqual(['chat-a-1', 'chat-a-3'])
    // Its orphan message + hypa rows are cleaned (the unblock).
    expect(countChatMessages('chat-a-2')).toBe(0)
    expect(countChatHypa('chat-a-2')).toBe(0)
    // Sibling chats' messages are intact.
    expect(countChatMessages('chat-a-1')).toBe(2)
    expect(countChatMessages('chat-a-3')).toBe(1)
    expect(countChatMessages('chat-b-1')).toBe(1)

    // Same selection semantics as the broad path: chatPage (1) is unchanged, so
    // the selected chat is whatever now sits at index 1.
    expect(readCharacter('char-a').chatPage).toBe(1)
    expect(body.selectedChatId).toBe('chat-a-3')
  })

  it('refuses to delete the only chat of a character', async () => {
    const revision = await importDatabase(seedDatabase())
    const res = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/chats/chat-b-1',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision },
    })
    expect(res.statusCode).toBe(400)
    // Nothing removed.
    expect(readChatOrder('char-b')).toEqual(['chat-b-1'])
    expect(countChatMessages('chat-b-1')).toBe(1)
  })
})

describe('Phase 8 follow-up: DELETE characters/:id → targeted-character-row', () => {
  it('removes the character + all its chats/messages/hypa and compacts positions', async () => {
    const revision = await importDatabase(seedDatabase())

    // char-a owns three chats (one with hypa); char-b is the sibling.
    expect(readCharacterRows()).toEqual([
      { id: 'char-a', position: 0 },
      { id: 'char-b', position: 1 },
    ])
    expect(countChatMessages('chat-a-1')).toBe(2)
    expect(countChatHypa('chat-a-2')).toBe(1)

    const before = rowidSnapshot()
    const { metric, body } = await runCommand({
      method: 'DELETE',
      url: '/api/v1/commands/characters/char-a',
      payload: { baseRevision: revision },
    })

    expect(metric.mutationPath).toBe('targeted-character-row')
    expect(metric.dbJsonWriteMs).toBe(0)
    // The character row, its chat rows, those chats' message/hypa rows, and the
    // settings pointers — but no collection table.
    expect(metric.writtenTables).toEqual([
      'characters',
      'chat_hypa_v3',
      'chats',
      'greeting_translations',
      'messages',
      'settings',
    ])
    assertCommandMetricGate(metric)

    // char-a (and its chats) are removed; char-b's rows keep their rowids.
    expectNoChurn(before, {
      characters: ['char-a'],
      chats: ['chat-a-1', 'chat-a-2', 'chat-a-3'],
    })

    // The characters table is compacted: char-b is the lone row at position 0.
    expect(readCharacterRows()).toEqual([{ id: 'char-b', position: 0 }])
    // Every one of char-a's chats and their message/hypa rows are gone.
    expect(readChatOrder('char-a')).toEqual([])
    expect(countChatMessages('chat-a-1')).toBe(0)
    expect(countChatMessages('chat-a-2')).toBe(0)
    expect(countChatMessages('chat-a-3')).toBe(0)
    expect(countChatHypa('chat-a-2')).toBe(0)
    // char-b is untouched.
    expect(readChatOrder('char-b')).toEqual(['chat-b-1'])
    expect(countChatMessages('chat-b-1')).toBe(1)

    // The re-normalized settings pointers are persisted: char-a is dropped from
    // characterOrder and currentChar resolves to the surviving character.
    expect(readSettings().characterOrder).toEqual(['char-b'])
    expect(body.selectedCharacterId).toBe('char-b')
  })
})
