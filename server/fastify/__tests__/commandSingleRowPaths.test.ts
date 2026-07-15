import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import { buildApp } from '../src/app.js'
import { setupAuthedClient } from './helpers/auth.js'
import { assertCommandMetricGate, type CommandMutationMetric } from './helpers/commandMetricGates.js'
import { assertOnlyRowsWritten, tableRowidsById } from './helpers/rowStability.js'
import { serializeChatGenerationSettingsDigestInput } from '../../../src/ts/chatGenerationSettings.js'

// Single character-row / single chat-row regression. Character/chat metadata
// edits write only their target row plus documented conditional co-writes instead
// of the broad rewrite set. Each test proves the narrowing via the
// `command_mutation` metric (targeted path + exact `writtenTables`) and
// `tableRowidsById` (no unrelated character/chat row churn).

interface Harness {
  app: FastifyInstance
  dataDir: string
}

function chatGenerationSettingsDigest(settings: Parameters<typeof serializeChatGenerationSettingsDigestInput>[0]) {
  return createHash('sha256').update(serializeChatGenerationSettingsDigestInput(settings), 'utf8').digest('hex')
}

const PREVIOUS_PROTOCOL_METRICS = process.env.RISU_PROTOCOL_METRICS

let harness: Harness
let assertion: string
let infoSpy: ReturnType<typeof vi.spyOn>
let metrics: CommandMutationMetric[]

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-phase3-range-'))
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
    modelPresets: [{ id: 'model-a', name: 'Model A' }],
    promptPresets: [{ id: 'prompt-a', name: 'Prompt A' }],
    personas: [{ id: 'persona-a', name: 'Persona A', icon: '', personaPrompt: '', note: '' }],
    modules: [
      { id: 'mod-a', name: 'Module A' },
      { id: 'mod-b', name: 'Module B' },
    ],
    enabledModules: [],
    characters: [
      {
        type: 'character',
        chaId: 'char-a',
        name: 'A',
        chatPage: 0,
        globalLore: [],
        modules: ['mod-a'],
        chatFolders: [{ id: 'folder-1', name: 'F1', folded: false }],
        chats: [
          { id: 'chat-a-1', name: 'A1', folderId: 'folder-1', scriptstate: {}, localLore: [], message: [] },
          { id: 'chat-a-2', name: 'A2', folderId: null, scriptstate: {}, localLore: [], message: [] },
        ],
      },
      {
        type: 'character',
        chaId: 'char-b',
        name: 'B',
        chatPage: 0,
        globalLore: [],
        chats: [{ id: 'chat-b-1', name: 'B1', scriptstate: {}, localLore: [], message: [] }],
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

function mutateRawDb(mutator: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
  try {
    mutator(db)
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

/** Active (alternate=0) message uids for one chat in `seq` order. */
function readChatMessageIds(chatId: string): string[] {
  const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
  try {
    const rows = db
      .prepare('SELECT uid FROM messages WHERE chat_id = ? AND alternate = 0 ORDER BY seq')
      .all(chatId) as Array<{ uid: string }>
    return rows.map((r) => r.uid)
  } finally {
    db.close()
  }
}

function readChatMessages(chatId: string): Record<string, unknown>[] {
  const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
  try {
    const rows = db
      .prepare('SELECT json FROM messages WHERE chat_id = ? AND alternate = 0 ORDER BY seq')
      .all(chatId) as Array<{ json: string }>
    return rows.map((row) => JSON.parse(row.json) as Record<string, unknown>)
  } finally {
    db.close()
  }
}

function readRevision(): number {
  const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
  try {
    return (db.prepare('SELECT revision FROM schema_version WHERE id = 1').get() as { revision: number }).revision
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

describe('Phase 3 single character-row paths', () => {
  it('PATCH characters/:id writes only the character row', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'PATCH',
      url: '/api/v1/commands/characters/char-a',
      payload: { baseRevision: revision, patch: { name: 'A renamed' } },
    })

    expect(metric.mutationPath).toBe('targeted-character-row')
    expect(metric.writtenTables).toEqual(['characters'])
    assertCommandMetricGate(metric)
    expectNoChurn(before)
    expect(readCharacter('char-a').name).toBe('A renamed')
  })

  it('PATCH characters/:id co-writes settings when trashTime is set', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'PATCH',
      url: '/api/v1/commands/characters/char-a',
      payload: { baseRevision: revision, patch: { trashTime: 123456 } },
    })

    expect(metric.mutationPath).toBe('targeted-character-row')
    expect(metric.writtenTables).toEqual(['characters', 'settings'])
    assertCommandMetricGate(metric)
    expectNoChurn(before)
    expect(readCharacter('char-a').trashTime).toBe(123456)
    // The trashed character drops out of the order/currentChar settings repair.
    expect(readSettings().characterOrder).toEqual(['char-b'])
  })

  it('PUT characters/:id/lorebooks writes only the character row (globalLore)', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const entry = {
      id: 'entry-a',
      key: 'k',
      secondkey: '',
      insertorder: 100,
      comment: 'C',
      content: 'c',
      mode: 'normal',
      alwaysActive: false,
      selective: false,
    }
    const { metric } = await runCommand({
      method: 'PUT',
      url: '/api/v1/commands/characters/char-a/lorebooks',
      payload: { baseRevision: revision, entries: [entry] },
    })

    expect(metric.mutationPath).toBe('targeted-character-row')
    expect(metric.writtenTables).toEqual(['characters'])
    assertCommandMetricGate(metric)
    expectNoChurn(before)
    expect(readCharacter('char-a').globalLore).toEqual([entry])
  })

  it('POST chat-folders writes only the character row', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric, body } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/characters/char-a/chat-folders',
      payload: { baseRevision: revision, folder: { id: 'folder-2', name: 'F2' } },
    })

    expect(metric.mutationPath).toBe('targeted-character-row')
    expect(metric.writtenTables).toEqual(['characters'])
    assertCommandMetricGate(metric)
    expectNoChurn(before)
    expect(body.folderId).toBe('folder-2')
    const folders = readCharacter('char-a').chatFolders as Array<{ id: string }>
    expect(folders.map((f) => f.id)).toEqual(['folder-2', 'folder-1'])
  })

  it('PATCH chat-folders/:id writes only the character row', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'PATCH',
      url: '/api/v1/commands/chat-folders/folder-1',
      payload: { baseRevision: revision, patch: { name: 'F1 renamed' } },
    })

    expect(metric.mutationPath).toBe('targeted-character-row')
    expect(metric.writtenTables).toEqual(['characters'])
    assertCommandMetricGate(metric)
    expectNoChurn(before)
    const folders = readCharacter('char-a').chatFolders as Array<{ id: string; name: string }>
    expect(folders[0].name).toBe('F1 renamed')
  })

  it('POST chat-folders/reorder writes only the character row', async () => {
    const revision = await importDatabase(seedDatabase())
    // Add a second folder so there is something to reorder.
    const second = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/characters/char-a/chat-folders',
      payload: { baseRevision: revision, folder: { id: 'folder-2', name: 'F2' } },
    })
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/characters/char-a/chat-folders/reorder',
      payload: { baseRevision: second.revision, folderIds: ['folder-1', 'folder-2'] },
    })

    expect(metric.mutationPath).toBe('targeted-character-row')
    expect(metric.writtenTables).toEqual(['characters'])
    assertCommandMetricGate(metric)
    expectNoChurn(before)
    const folders = readCharacter('char-a').chatFolders as Array<{ id: string }>
    expect(folders.map((f) => f.id)).toEqual(['folder-1', 'folder-2'])
  })

  it('POST characters/:id/modules/reorder writes only the character row', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/characters/char-a/modules/reorder',
      payload: { baseRevision: revision, moduleIds: ['mod-b', 'mod-a'] },
    })

    expect(metric.mutationPath).toBe('targeted-character-row')
    expect(metric.writtenTables).toEqual(['characters'])
    assertCommandMetricGate(metric)
    expectNoChurn(before)
    expect(readCharacter('char-a').modules).toEqual(['mod-b', 'mod-a'])
  })
})

describe('Phase 3 single chat-row paths', () => {
  it('PATCH chats/:id/scriptstate writes only the chat row', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'PATCH',
      url: '/api/v1/commands/chats/chat-a-1/scriptstate',
      payload: { baseRevision: revision, patch: { counter: 5 } },
    })

    expect(metric.mutationPath).toBe('targeted-chat-row')
    expect(metric.writtenTables).toEqual(['chats'])
    assertCommandMetricGate(metric)
    expectNoChurn(before)
    expect(readChat('chat-a-1').scriptstate).toEqual({ counter: 5 })
  })

  it('PATCH chats/:id writes only the chat row', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'PATCH',
      url: '/api/v1/commands/chats/chat-a-1',
      payload: { baseRevision: revision, patch: { name: 'A1 renamed' } },
    })

    expect(metric.mutationPath).toBe('targeted-chat-row')
    expect(metric.writtenTables).toEqual(['chats'])
    assertCommandMetricGate(metric)
    expectNoChurn(before)
    expect(readChat('chat-a-1').name).toBe('A1 renamed')
  })

  it('PATCH chats/:id fails when fallback found an embedded chat but the split row is missing', async () => {
    const revision = await importDatabase(seedDatabase())
    mutateRawDb((db) => {
      db.exec('DELETE FROM messages')
      db.exec('DELETE FROM chats')
      db.exec('DELETE FROM characters')
      db.prepare('UPDATE settings SET data_json = ? WHERE id = 1').run(JSON.stringify(seedDatabase()))
    })

    const res = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/chats/chat-a-1',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision, patch: { name: 'Should fail' } },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('Chat row not found: chat-a-1')
  })

  it('PUT chats/:id/generation-settings writes only the chat row', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric, body } = await runCommand({
      method: 'PUT',
      url: '/api/v1/commands/chats/chat-a-1/generation-settings',
      payload: {
        baseRevision: revision,
        generationSettings: {
          configured: true,
          personaId: 'persona-a',
          modelPresetId: 'model-a',
          promptPresetId: 'prompt-a',
          jailbreakToggle: false,
          sidebarToggles: {},
        },
      },
    })

    expect(metric.mutationPath).toBe('targeted-chat-row')
    expect(metric.writtenTables).toEqual(['chats'])
    assertCommandMetricGate(metric)
    expectNoChurn(before)
    expect(body.event).toMatchObject({
      type: 'chat.updated',
      resource: 'characterRow',
      id: 'chat-a-1',
      parentId: 'char-a',
    })
    expect(readChat('chat-a-1').generationSettings).toEqual({
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-a',
      promptPresetId: 'prompt-a',
      jailbreakToggle: false,
      sidebarToggles: {},
    })
  })

  it('sparse PUT chats/:id/generation-settings still writes only the chat row', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()
    const generationSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-a',
      promptPresetId: 'prompt-a',
      jailbreakToggle: false,
      sidebarToggles: {},
    }

    const { metric, body } = await runCommand({
      method: 'PUT',
      url: '/api/v1/commands/chats/chat-a-1/generation-settings',
      payload: {
        baseRevision: revision,
        baseGenerationSettingsDigest: chatGenerationSettingsDigest(null),
        patch: generationSettings,
      },
    })

    expect(metric.mutationPath).toBe('targeted-chat-row')
    expect(metric.writtenTables).toEqual(['chats'])
    assertCommandMetricGate(metric)
    expectNoChurn(before)
    expect(body).toMatchObject({
      certificate: 'chat-generation-settings-sparse-v1',
      patchedKeys: ['configured', 'jailbreakToggle', 'modelPresetId', 'personaId', 'promptPresetId', 'sidebarToggles'],
      deletedKeys: [],
      sidebarTogglePatchedKeys: [],
      sidebarToggleDeletedKeys: [],
      prunedSidebarToggleKeys: [],
    })
    expect(body).not.toHaveProperty('generationSettings')
    expect(readChat('chat-a-1').generationSettings).toEqual(generationSettings)
  })

  it('PATCH chats/:id with select:true co-writes the parent character row', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'PATCH',
      url: '/api/v1/commands/chats/chat-a-2',
      payload: { baseRevision: revision, select: true, patch: {} },
    })

    expect(metric.mutationPath).toBe('targeted-chat-row')
    expect(metric.writtenTables).toEqual(['characters', 'chats'])
    assertCommandMetricGate(metric)
    expectNoChurn(before)
    // chat-a-2 is index 1 in char-a's chats, so selecting it moves chatPage.
    expect(readCharacter('char-a').chatPage).toBe(1)
  })

  it('PUT chats/:id/lorebooks writes only the chat row (localLore)', async () => {
    const revision = await importDatabase(seedDatabase())
    const before = rowidSnapshot()

    const entry = {
      id: 'entry-chat',
      key: 'k',
      secondkey: '',
      insertorder: 100,
      comment: 'C',
      content: 'c',
      mode: 'normal',
      alwaysActive: false,
      selective: false,
    }
    const { metric } = await runCommand({
      method: 'PUT',
      url: '/api/v1/commands/chats/chat-a-1/lorebooks',
      payload: { baseRevision: revision, entries: [entry] },
    })

    expect(metric.mutationPath).toBe('targeted-chat-row')
    expect(metric.writtenTables).toEqual(['chats'])
    assertCommandMetricGate(metric)
    expectNoChurn(before)
    expect(readChat('chat-a-1').localLore).toEqual([entry])
  })

  it('preserves degraded sibling fields across every character/chat lorebook mutation', async () => {
    let revision = await importDatabase(seedDatabase())
    const entry = (id: string, content = id) => ({
      id,
      key: id,
      secondkey: '',
      insertorder: 100,
      comment: id,
      content,
      mode: 'normal',
      alwaysActive: false,
      selective: false,
    })
    const withoutField = (row: Record<string, unknown>, field: string): Record<string, unknown> => {
      const result = structuredClone(row)
      delete result[field]
      return result
    }

    mutateRawDb((db) => {
      const characterRow = db.prepare('SELECT data_json FROM characters WHERE id = ?').get('char-a') as {
        data_json: string
      }
      const character = JSON.parse(characterRow.data_json) as Record<string, unknown>
      delete character.displayName
      character.legacySibling = { nested: ['character', 1] }
      character.globalLore = [{ id: 'legacy-character-entry' }]
      db.prepare('UPDATE characters SET data_json = ? WHERE id = ?').run(JSON.stringify(character), 'char-a')

      const chatRow = db.prepare('SELECT data_json FROM chats WHERE id = ?').get('chat-a-1') as {
        data_json: string
      }
      const chat = JSON.parse(chatRow.data_json) as Record<string, unknown>
      delete chat.name
      delete chat.note
      chat.generationSettings = {
        configured: 'legacy',
        sidebarToggles: { keep: 'on', invalid: 17 },
        unknown: { nested: true },
      }
      chat.legacySibling = { nested: ['chat', 2] }
      chat.localLore = [{ id: 'legacy-chat-entry' }]
      db.prepare('UPDATE chats SET data_json = ? WHERE id = ?').run(JSON.stringify(chat), 'chat-a-1')
    })

    const characterSiblings = withoutField(readCharacter('char-a'), 'globalLore')
    const chatSiblings = withoutField(readChat('chat-a-1'), 'localLore')
    const before = rowidSnapshot()

    const characterCommands: Array<{
      method: 'DELETE' | 'POST' | 'PUT'
      url: string
      payload: Record<string, unknown>
      expected?: Record<string, unknown>
    }> = [
      {
        method: 'PUT',
        url: '/api/v1/commands/characters/char-a/lorebooks/entries/char-c',
        payload: { entry: entry('char-c', 'created') },
        expected: { entryId: 'char-c', entryIndex: 1, created: true },
      },
      {
        method: 'POST',
        url: '/api/v1/commands/characters/char-a/lorebooks/entries/reorder',
        payload: { entryIds: ['char-c', 'legacy-character-entry'] },
      },
      {
        method: 'DELETE',
        url: '/api/v1/commands/characters/char-a/lorebooks/entries/legacy-character-entry',
        payload: {},
        expected: { entryId: 'legacy-character-entry', entryIndex: 1 },
      },
      {
        method: 'PUT',
        url: '/api/v1/commands/characters/char-a/lorebooks',
        payload: { entries: [entry('char-a'), entry('char-b')] },
      },
    ]

    for (let index = 0; index < characterCommands.length; index++) {
      const command = characterCommands[index]
      const result = await runCommand({
        method: command.method,
        url: command.url,
        payload: { ...command.payload, baseRevision: revision },
      })
      revision = result.revision
      expect(result.metric.mutationPath).toBe('targeted-character-row')
      expect(result.metric.writtenTables).toEqual(['characters'])
      assertCommandMetricGate(result.metric)
      expectNoChurn(before)
      expect(withoutField(readCharacter('char-a'), 'globalLore')).toStrictEqual(characterSiblings)
      if (index === 0) {
        expect((readCharacter('char-a').globalLore as Array<Record<string, unknown>>)[0]).toMatchObject({
          id: 'legacy-character-entry',
          key: '',
          mode: 'normal',
        })
      }
      if (command.expected) expect(result.body).toMatchObject(command.expected)
    }

    const chatCommands: Array<{
      method: 'DELETE' | 'POST' | 'PUT'
      url: string
      payload: Record<string, unknown>
      expected?: Record<string, unknown>
    }> = [
      {
        method: 'PUT',
        url: '/api/v1/commands/chats/chat-a-1/lorebooks/entries/chat-c',
        payload: { entry: entry('chat-c', 'created') },
        expected: { entryId: 'chat-c', entryIndex: 1, created: true },
      },
      {
        method: 'POST',
        url: '/api/v1/commands/chats/chat-a-1/lorebooks/entries/reorder',
        payload: { entryIds: ['chat-c', 'legacy-chat-entry'] },
      },
      {
        method: 'DELETE',
        url: '/api/v1/commands/chats/chat-a-1/lorebooks/entries/legacy-chat-entry',
        payload: {},
        expected: { entryId: 'legacy-chat-entry', entryIndex: 1 },
      },
      {
        method: 'PUT',
        url: '/api/v1/commands/chats/chat-a-1/lorebooks',
        payload: { entries: [entry('chat-a'), entry('chat-b')] },
      },
    ]

    for (let index = 0; index < chatCommands.length; index++) {
      const command = chatCommands[index]
      const result = await runCommand({
        method: command.method,
        url: command.url,
        payload: { ...command.payload, baseRevision: revision },
      })
      revision = result.revision
      expect(result.metric.mutationPath).toBe('targeted-chat-row')
      expect(result.metric.writtenTables).toEqual(['chats'])
      assertCommandMetricGate(result.metric)
      expectNoChurn(before)
      expect(withoutField(readChat('chat-a-1'), 'localLore')).toStrictEqual(chatSiblings)
      if (index === 0) {
        expect((readChat('chat-a-1').localLore as Array<Record<string, unknown>>)[0]).toMatchObject({
          id: 'legacy-chat-entry',
          key: '',
          mode: 'normal',
        })
      }
      if (command.expected) expect(result.body).toMatchObject(command.expected)
    }
  })
})

describe('Phase 3 character + chat-row cascade paths', () => {
  it('DELETE chat-folders/:id writes the character row + the re-homed chat rows', async () => {
    const revision = await importDatabase(seedDatabase())
    expect(readChat('chat-a-1').folderId, 'folderId preserved on import').toBe('folder-1')
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'DELETE',
      url: '/api/v1/commands/chat-folders/folder-1',
      payload: { baseRevision: revision },
    })

    expect(metric.mutationPath).toBe('targeted-character-row')
    // chat-a-1 was in folder-1, so its row is re-homed alongside the char row.
    expect(metric.writtenTables).toEqual(['characters', 'chats'])
    assertCommandMetricGate(metric)
    // UPDATE-in-place: no row is DELETE+reINSERTed, so every rowid stays put.
    expectNoChurn(before)
    expect(readCharacter('char-a').chatFolders).toEqual([])
    expect(readChat('chat-a-1').folderId).toBeNull()
  })

  it("POST chats/reorder shifts only that character's chat-row positions", async () => {
    const revision = await importDatabase(seedDatabase())
    expect(readChatOrder('char-a')).toEqual(['chat-a-1', 'chat-a-2'])
    const before = rowidSnapshot()

    const { metric } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/characters/char-a/chats/reorder',
      payload: { baseRevision: revision, chatIds: ['chat-a-2', 'chat-a-1'] },
    })

    expect(metric.mutationPath).toBe('targeted-character-row')
    expect(metric.writtenTables).toEqual(['characters', 'chats'])
    assertCommandMetricGate(metric)
    // Positions are UPDATEd in place, so no chat row churns its rowid.
    expectNoChurn(before)
    expect(readChatOrder('char-a')).toEqual(['chat-a-2', 'chat-a-1'])
    // char-b's single chat is untouched.
    expect(readChatOrder('char-b')).toEqual(['chat-b-1'])
  })
})

describe('Phase 3 fork (character row + chat rows + surgical messages)', () => {
  it('forks a chat: inserts the new chat + its messages, preserves the source messages', async () => {
    const revision = await importDatabase(seedDatabase())
    // Give the source chat an existing message so we can prove it survives.
    const appended = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a-1/messages',
      payload: {
        baseRevision: revision,
        message: { role: 'user', data: 'source message', chatId: 'src-msg-1' },
      },
    })
    expect(readChatMessageIds('chat-a-1')).toEqual(['src-msg-1'])
    const before = rowidSnapshot()

    const { metric, body } = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a-1/fork',
      payload: {
        baseRevision: appended.revision,
        select: true,
        chat: {
          id: 'fork-1',
          name: 'Forked',
          message: [
            { role: 'user', data: 'forked 1', chatId: 'fork-msg-1' },
            {
              role: 'char',
              data: 'forked 2',
              chatId: 'fork-msg-2',
              extensionPayload: { preserved: true },
            },
          ],
        },
      },
    })

    expect(metric.mutationPath).toBe('targeted-character-row')
    expect(metric.writtenTables).toEqual(['characters', 'chats', 'messages'])
    assertCommandMetricGate(metric)
    // Existing character/chat rows are UPDATEd in place (rowids stable); the
    // forked chat is a new row, ignored by the before-snapshot.
    expectNoChurn(before)
    expect(body.chatId).toBe('fork-1')
    // The forked chat lands at the head; the source chat shifts down.
    expect(readChatOrder('char-a')).toEqual(['fork-1', 'chat-a-1', 'chat-a-2'])
    expect(readCharacter('char-a').chatPage).toBe(0)
    // The forked chat's messages persisted; the source chat's message survived.
    expect(readChatMessageIds('fork-1')).toEqual(['fork-msg-1', 'fork-msg-2'])
    expect(readChatMessages('fork-1')[1]).toMatchObject({
      chatId: 'fork-msg-2',
      extensionPayload: { preserved: true },
    })
    expect(readChatMessageIds('chat-a-1')).toEqual(['src-msg-1'])
  })

  it('rejects unloaded placeholders in fork and create transcripts without writing anything', async () => {
    const revision = await importDatabase(seedDatabase())
    const appended = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a-1/messages',
      payload: {
        baseRevision: revision,
        message: { role: 'user', data: 'source message', chatId: 'src-msg-1' },
      },
    })
    const before = rowidSnapshot()

    const placeholder = {
      role: 'char',
      data: '',
      chatId: 'unloaded-placeholder',
      disabled: true,
      isComment: true,
      __risuServerUnloadedMessage: true,
    }
    const requests: CommandRequest[] = [
      {
        method: 'POST',
        url: '/api/v1/commands/chats/chat-a-1/fork',
        payload: {
          baseRevision: appended.revision,
          chat: { id: 'fork-placeholder', name: 'Invalid fork', message: [placeholder] },
        },
      },
      {
        method: 'POST',
        url: '/api/v1/commands/characters/char-a/chats',
        payload: {
          baseRevision: appended.revision,
          chat: { id: 'created-placeholder', name: 'Invalid chat', message: [placeholder] },
        },
      },
    ]
    const inject = harness.app.inject as unknown as (request: CommandRequest) => Promise<CommandResponse>

    for (const request of requests) {
      const res = await inject({
        ...request,
        headers: { 'risu-auth': assertion },
      })
      expect(res.statusCode).toBe(400)
      expect((res.json() as { error: string }).error).toBe('messages[0] is an unloaded server-message placeholder')
    }

    expect(readRevision()).toBe(appended.revision)
    expectNoChurn(before)
    expect(readChatOrder('char-a')).toEqual(['chat-a-1', 'chat-a-2'])
    expect(readChatMessageIds('chat-a-1')).toEqual(['src-msg-1'])
    expect(readChatMessageIds('fork-placeholder')).toEqual([])
    expect(readChatMessageIds('created-placeholder')).toEqual([])
  })

  it('rejects a forked message whose id already exists', async () => {
    const revision = await importDatabase(seedDatabase())
    const appended = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a-1/messages',
      payload: {
        baseRevision: revision,
        message: { role: 'user', data: 'source message', chatId: 'dup-msg' },
      },
    })

    const inject = harness.app.inject as unknown as (request: CommandRequest) => Promise<CommandResponse>
    const res = await inject({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a-1/fork',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: appended.revision,
        chat: {
          id: 'fork-2',
          message: [{ role: 'user', data: 'dup', chatId: 'dup-msg' }],
        },
      },
    })

    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: string }).error).toContain('Duplicate message id')
    // The rejected fork wrote nothing: no new chat row.
    expect(readChatOrder('char-a')).toEqual(['chat-a-1', 'chat-a-2'])
  })
})

describe('Phase 3 message replacement placeholder guard', () => {
  it('rejects an unloaded placeholder atomically instead of replacing the transcript', async () => {
    const revision = await importDatabase(seedDatabase())
    const appended = await runCommand({
      method: 'POST',
      url: '/api/v1/commands/chats/chat-a-1/messages',
      payload: {
        baseRevision: revision,
        message: { role: 'user', data: 'source message', chatId: 'src-msg-1' },
      },
    })
    const before = rowidSnapshot()

    const res = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/chats/chat-a-1/messages',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: appended.revision,
        messages: [
          { role: 'user', data: 'replacement', chatId: 'replacement-msg' },
          {
            role: 'char',
            data: '',
            chatId: 'unloaded-placeholder',
            disabled: true,
            isComment: true,
            __risuServerUnloadedMessage: true,
          },
        ],
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('messages[1] is an unloaded server-message placeholder')
    expect(readRevision()).toBe(appended.revision)
    expectNoChurn(before)
    expect(readChatMessages('chat-a-1')).toEqual([{ role: 'user', data: 'source message', chatId: 'src-msg-1' }])
  })
})
