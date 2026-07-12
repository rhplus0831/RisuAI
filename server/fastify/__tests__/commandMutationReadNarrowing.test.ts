import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { StatementSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { openDatabase } from '../src/db.js'
import { loadPersisted, loadPersistedForChatMutation } from '../src/repository.js'
import { applyTargetedCommandMutation } from '../src/commands/mutations.js'
import { normalizeAllCharacterChats } from '../src/commands/chats.js'
import { setupAuthedClient } from './helpers/auth.js'
import { assertScopedLoadOnHotPath, withServerLoadInstrumentation } from './helpers/loadCostHarness.js'
import { buildLargeCorpusFixture } from '../../../src/ts/__tests__/largeCorpusFixture.js'

// Command-mutation read narrowing: targeted message/scriptstate/generation
// command routes locate one chat row and mutate it (or write the message store
// through kit writers). The opt-in `chatScopedRead` loads exactly the target chat
// row plus its parent character, with a broad `loadPersisted` fallback for
// unknown ids and pre-extraction embedded state so error behavior and the global
// dedup edge stay byte-identical.

interface Harness {
  app: FastifyInstance
  dataDir: string
}

let harness: Harness
let assertion: string

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-cmd-read-'))
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

function command(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload: Record<string, unknown>) {
  return harness.app.inject({ method, url, headers: { 'risu-auth': assertion }, payload })
}

function hydrationGet(chatId: string) {
  return harness.app.inject({
    method: 'GET',
    url: `/api/v1/chats/${encodeURIComponent(chatId)}/messages`,
    headers: { 'risu-auth': assertion },
  })
}

type SqliteReadMethod = 'all' | 'get' | 'iterate'

async function withSqliteSelectReadInstrumentation<T>(
  fn: () => T | Promise<T>,
): Promise<{ result: T; readCountByTable: Record<string, number> }> {
  const readCountByTable: Record<string, number> = {}
  const proto = StatementSync.prototype as unknown as Record<SqliteReadMethod, (...args: unknown[]) => unknown>
  const originals = {
    all: proto.all,
    get: proto.get,
    iterate: proto.iterate,
  }

  for (const method of ['all', 'get', 'iterate'] as const) {
    const original = originals[method]
    proto[method] = function tracked(this: StatementSync, ...args: unknown[]) {
      const normalized = this.sourceSQL.toLowerCase().replace(/\s+/g, ' ').trim()
      const match = normalized.startsWith('select') ? /\bfrom\s+([a-z0-9_]+)/.exec(normalized) : null
      if (match) {
        readCountByTable[match[1]] = (readCountByTable[match[1]] ?? 0) + 1
      }
      return original.apply(this, args)
    }
  }

  try {
    return { result: await fn(), readCountByTable }
  } finally {
    for (const method of ['all', 'get', 'iterate'] as const) proto[method] = originals[method]
  }
}

function expectSettingsCommandReadOnlySettings(readCountByTable: Record<string, number>): void {
  expect(readCountByTable).toEqual({ schema_version: 1, settings: 1 })
}

function expectCollectionCommandReadOnlyTables(
  readCountByTable: Record<string, number>,
  collectionTables: readonly string[],
): void {
  const expected: Record<string, number> = {
    schema_version: 1,
    settings: 1,
    ...Object.fromEntries(collectionTables.map((table) => [table, 1])),
  }
  expect(readCountByTable).toEqual(expected)
}

function expectCollectionLoadOnlyTables(
  loadCountByTable: Record<string, number>,
  collectionTables: readonly string[],
): void {
  const expected = Object.fromEntries(collectionTables.map((table) => [table, 1]))
  expect(loadCountByTable).toEqual(expected)
}

function readSettingsRecord(): Record<string, unknown> {
  const db = openDatabase(harness.dataDir)
  try {
    const row = db.prepare('SELECT data_json FROM settings WHERE id = 1').get() as {
      data_json: string
    }
    return JSON.parse(row.data_json) as Record<string, unknown>
  } finally {
    db.close()
  }
}

describe('command-mutation read narrowing (M3/L5/L6) on the large-corpus fixture', () => {
  it('M3/L5/L6: a scriptstate PATCH performs zero whole-corpus payload reads', async () => {
    const fixture = buildLargeCorpusFixture()
    const revision = await importDatabase(fixture.database)

    const res = await assertScopedLoadOnHotPath(() =>
      command('PATCH', `/api/v1/commands/chats/${fixture.hot.chatId}/scriptstate`, {
        baseRevision: revision,
        patch: { $flag: 'on' },
        deleteKeys: ['$corpusScore'],
      }),
    )
    expect(res.statusCode).toBe(200)
    expect(res.json().revision).toBe(revision + 1)

    // The patched scriptstate persisted into the one chat row.
    const db = openDatabase(harness.dataDir)
    try {
      const row = db.prepare('SELECT data_json FROM chats WHERE id = ?').get(fixture.hot.chatId) as {
        data_json: string
      }
      expect((JSON.parse(row.data_json) as { scriptstate?: unknown }).scriptstate).toEqual({
        $flag: 'on',
      })
    } finally {
      db.close()
    }
  })

  it('H2: chat-create performs zero whole-corpus message/hypa reads while writing only the new transcript', async () => {
    const fixture = buildLargeCorpusFixture()
    const revision = await importDatabase(fixture.database)
    const targetCharacterId = fixture.hot.characterId
    const existingHotMessages = (await hydrationGet(fixture.hot.chatId)).json().message as Array<{
      chatId: string
    }>

    const { result: created, loadCountByTable } = await withServerLoadInstrumentation(() =>
      command('POST', `/api/v1/commands/characters/${targetCharacterId}/chats`, {
        baseRevision: revision,
        select: false,
        chat: {
          id: 'h2-created-chat',
          name: 'H2 created',
          note: '',
          localLore: [],
          message: [
            { role: 'user', data: 'targeted create 1', chatId: 'h2-created-msg-1' },
            { role: 'char', data: 'targeted create 2', chatId: 'h2-created-msg-2' },
          ],
        },
      }),
    )

    expect(created.statusCode).toBe(200)
    expect(created.json()).toMatchObject({
      revision: revision + 1,
      chatId: 'h2-created-chat',
      // The hot fixture starts on chatPage 0; select:false keeps that selection
      // even though the new chat is inserted at position 0.
      selectedChatId: fixture.hot.chatId,
      event: {
        type: 'chat.created',
        resource: 'chatTranscript',
        id: 'h2-created-chat',
        parentId: targetCharacterId,
      },
    })
    // A regression to `loadPersistedWithMessages` would whole-table read both
    // message payload families. The targeted path only does id/scoped lookups.
    expect(loadCountByTable.messages ?? 0).toBe(0)
    expect(loadCountByTable.chat_hypa_v3 ?? 0).toBe(0)

    const db = openDatabase(harness.dataDir)
    try {
      const chatRows = db
        .prepare('SELECT id FROM chats WHERE character_id = ? ORDER BY position')
        .all(targetCharacterId) as Array<{ id: string }>
      expect(chatRows.map((row) => row.id).slice(0, 4)).toEqual([
        'h2-created-chat',
        fixture.hot.chatId,
        `corpus-chat-0-1`,
        `corpus-chat-0-2`,
      ])
      const charRow = db.prepare('SELECT data_json FROM characters WHERE id = ?').get(targetCharacterId) as {
        data_json: string
      }
      expect((JSON.parse(charRow.data_json) as { chatPage?: number }).chatPage).toBe(1)
    } finally {
      db.close()
    }

    const createdMessages = (await hydrationGet('h2-created-chat')).json().message as Array<{
      chatId: string
    }>
    expect(createdMessages.map((message) => message.chatId)).toEqual(['h2-created-msg-1', 'h2-created-msg-2'])
    const hotAfter = (await hydrationGet(fixture.hot.chatId)).json().message as Array<{
      chatId: string
    }>
    expect(hotAfter.map((message) => message.chatId)).toEqual(existingHotMessages.map((message) => message.chatId))
  })

  it('M5: character PATCH repairs and writes the target row without whole-corpus reads', async () => {
    const fixture = buildLargeCorpusFixture()
    const revision = await importDatabase(fixture.database)

    const res = await assertScopedLoadOnHotPath(() =>
      command('PATCH', `/api/v1/commands/characters/${fixture.hot.characterId}`, {
        baseRevision: revision,
        patch: { name: 'M5 renamed character', desc: 'target row only' },
      }),
    )

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      revision: revision + 1,
      characterId: fixture.hot.characterId,
      event: {
        type: 'character.updated',
        resource: 'characterRow',
        id: fixture.hot.characterId,
      },
    })

    const db = openDatabase(harness.dataDir)
    try {
      const target = db.prepare('SELECT data_json FROM characters WHERE id = ?').get(fixture.hot.characterId) as {
        data_json: string
      }
      expect(JSON.parse(target.data_json)).toMatchObject({
        chaId: fixture.hot.characterId,
        name: 'M5 renamed character',
        desc: 'target row only',
      })
      const sibling = db.prepare('SELECT data_json FROM characters WHERE id = ?').get('corpus-char-1') as {
        data_json: string
      }
      expect(JSON.parse(sibling.data_json).name).toBe('Corpus Character 1')
    } finally {
      db.close()
    }
  })

  it('M5: chat PATCH without modules uses chatScopedRead and preserves selected chat state', async () => {
    const fixture = buildLargeCorpusFixture()
    const revision = await importDatabase(fixture.database)

    const { result: res, corpusLoadCount } = await withServerLoadInstrumentation(() =>
      command('PATCH', `/api/v1/commands/chats/${fixture.noHypa.chatId}`, {
        baseRevision: revision,
        select: true,
        patch: { name: 'M5 renamed chat', note: 'scoped metadata' },
      }),
    )

    expect(corpusLoadCount).toBe(0)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      revision: revision + 1,
      chatId: fixture.noHypa.chatId,
      selectedChatId: fixture.noHypa.chatId,
      event: {
        type: 'chat.updated',
        resource: 'characterRow',
        id: fixture.noHypa.chatId,
        parentId: fixture.noHypa.characterId,
      },
    })

    const db = openDatabase(harness.dataDir)
    try {
      const chat = db.prepare('SELECT data_json FROM chats WHERE id = ?').get(fixture.noHypa.chatId) as {
        data_json: string
      }
      expect(JSON.parse(chat.data_json)).toMatchObject({
        id: fixture.noHypa.chatId,
        name: 'M5 renamed chat',
        note: 'scoped metadata',
      })
      const sibling = db.prepare('SELECT data_json FROM chats WHERE id = ?').get(fixture.hot.chatId) as {
        data_json: string
      }
      expect(JSON.parse(sibling.data_json).name).toBe('Chat 0-0')
      const character = db.prepare('SELECT data_json FROM characters WHERE id = ?').get(fixture.noHypa.characterId) as {
        data_json: string
      }
      expect(JSON.parse(character.data_json).chatPage).toBe(1)
    } finally {
      db.close()
    }
  })

  it('M5: chat PATCH takes the explicit broad fallback only for patch.modules', async () => {
    const fixture = buildLargeCorpusFixture()
    const revision = await importDatabase(fixture.database)

    const {
      result: res,
      corpusLoadCount,
      loadCountByTable,
    } = await withServerLoadInstrumentation(() =>
      command('PATCH', `/api/v1/commands/chats/${fixture.hot.chatId}`, {
        baseRevision: revision,
        patch: { modules: ['corpus-module-1'] },
      }),
    )

    expect(res.statusCode).toBe(200)
    expect(corpusLoadCount).toBeGreaterThan(0)
    expect(loadCountByTable.modules).toBeGreaterThanOrEqual(1)

    const scoped = await assertScopedLoadOnHotPath(() =>
      command('PATCH', `/api/v1/commands/chats/${fixture.hot.chatId}`, {
        baseRevision: res.json().revision,
        patch: { note: 'non-module patch stayed scoped after module edit' },
      }),
    )
    expect(scoped.statusCode).toBe(200)
  })

  it('chat generation settings save avoids message and hypa payload reads', async () => {
    const fixture = buildLargeCorpusFixture()
    const revision = await importDatabase(fixture.database)

    const { result: res, loadCountByTable } = await withServerLoadInstrumentation(() =>
      command('PUT', `/api/v1/commands/chats/${fixture.hot.chatId}/generation-settings`, {
        baseRevision: revision,
        generationSettings: {
          configured: true,
          personaId: 'corpus-persona-0',
          modelPresetId: 'corpus-model-preset-0',
          promptPresetId: 'corpus-prompt-preset-0',
          jailbreakToggle: false,
          sidebarToggles: {},
        },
      }),
    )

    expect(res.statusCode).toBe(200)
    expect(loadCountByTable.messages ?? 0).toBe(0)
    expect(loadCountByTable.chat_hypa_v3 ?? 0).toBe(0)

    const db = openDatabase(harness.dataDir)
    try {
      const row = db.prepare('SELECT data_json FROM chats WHERE id = ?').get(fixture.hot.chatId) as {
        data_json: string
      }
      expect(JSON.parse(row.data_json).generationSettings).toEqual({
        configured: true,
        personaId: 'corpus-persona-0',
        modelPresetId: 'corpus-model-preset-0',
        promptPresetId: 'corpus-prompt-preset-0',
        jailbreakToggle: false,
        sidebarToggles: {},
      })
    } finally {
      db.close()
    }
  })

  it('L13: single-key plugin-storage PUT/DELETE skip database loads while bulk merge still reads current storage', async () => {
    const fixture = buildLargeCorpusFixture()
    let revision = await importDatabase(fixture.database)

    const putRun = await withServerLoadInstrumentation(() =>
      command('PUT', '/api/v1/commands/plugin-storage/l13-delete-me', {
        baseRevision: revision,
        value: { mode: 'single-key' },
      }),
    )
    expect(putRun.result.statusCode).toBe(200)
    expect(putRun.corpusLoadCount).toBe(0)
    expect(putRun.loadCountByTable.plugin_custom_storage ?? 0).toBe(0)
    revision = putRun.result.json().revision

    const deleteRun = await withServerLoadInstrumentation(() =>
      command('DELETE', '/api/v1/commands/plugin-storage/l13-delete-me', {
        baseRevision: revision,
      }),
    )
    expect(deleteRun.result.statusCode).toBe(200)
    expect(deleteRun.corpusLoadCount).toBe(0)
    expect(deleteRun.loadCountByTable.plugin_custom_storage ?? 0).toBe(0)
    revision = deleteRun.result.json().revision

    const bulkRun = await withServerLoadInstrumentation(() =>
      command('POST', '/api/v1/commands/plugin-storage/bulk', {
        baseRevision: revision,
        values: { 'l13-bulk-added': { merged: true } },
      }),
    )
    expect(bulkRun.result.statusCode).toBe(200)
    expect(bulkRun.loadCountByTable.plugin_custom_storage ?? 0).toBeGreaterThanOrEqual(1)

    const db = openDatabase(harness.dataDir)
    try {
      const rows = db.prepare('SELECT key, value_json FROM plugin_custom_storage ORDER BY key').all() as Array<{
        key: string
        value_json: string
      }>
      expect(Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value_json)]))).toEqual({
        'corpus-plugin': { counter: 1 },
        'l13-bulk-added': { merged: true },
      })
    } finally {
      db.close()
    }
  })

  it('M3: settings commands read only the settings row on extracted SQLite state', async () => {
    const fixture = buildLargeCorpusFixture()
    let revision = await importDatabase({
      ...fixture.database,
      theme: 'dark',
      mainPrompt: 'Old main prompt',
    })

    const settingsRun = await withSqliteSelectReadInstrumentation(() =>
      withServerLoadInstrumentation(() =>
        command('PATCH', '/api/v1/commands/settings/display', {
          baseRevision: revision,
          patch: { theme: 'light' },
        }),
      ),
    )
    expect(settingsRun.result.result.statusCode).toBe(200)
    expect(settingsRun.result.corpusLoadCount).toBe(0)
    expectSettingsCommandReadOnlySettings(settingsRun.readCountByTable)
    revision = settingsRun.result.result.json().revision

    const memoryRun = await withSqliteSelectReadInstrumentation(() =>
      withServerLoadInstrumentation(() =>
        command('PATCH', '/api/v1/commands/settings/memory', {
          baseRevision: revision,
          patch: { hypaV3Presets: [{ name: 'request-preset' }] },
        }),
      ),
    )
    expect(memoryRun.result.result.statusCode).toBe(200)
    expect(memoryRun.result.corpusLoadCount).toBe(0)
    expect(memoryRun.result.loadCountByTable.hypa_v3_presets ?? 0).toBe(0)
    expectSettingsCommandReadOnlySettings(memoryRun.readCountByTable)

    const db = openDatabase(harness.dataDir)
    try {
      const rows = db.prepare('SELECT data_json FROM hypa_v3_presets ORDER BY position').all() as Array<{
        data_json: string
      }>
      expect(rows.map((row) => JSON.parse(row.data_json))).toEqual([{ name: 'request-preset' }])
    } finally {
      db.close()
    }
    revision = memoryRun.result.result.json().revision

    const promptRun = await withSqliteSelectReadInstrumentation(() =>
      withServerLoadInstrumentation(() =>
        command('PATCH', '/api/v1/commands/prompt-settings', {
          baseRevision: revision,
          patch: { mainPrompt: 'Scoped main prompt' },
        }),
      ),
    )
    expect(promptRun.result.result.statusCode).toBe(200)
    expect(promptRun.result.corpusLoadCount).toBe(0)
    expectSettingsCommandReadOnlySettings(promptRun.readCountByTable)
  })

  it('M3: settings scoped read falls back broad for legacy embedded settings rows', async () => {
    const fixture = buildLargeCorpusFixture()
    const revision = await importDatabase(fixture.database)

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
          chats: [{ id: 'embedded-chat', name: 'Embedded chat', message: [] }],
        },
      ]
      db.prepare('UPDATE settings SET data_json = ? WHERE id = 1').run(JSON.stringify(settings))
      db.exec('DELETE FROM chats')
      db.exec('DELETE FROM characters')
    } finally {
      db.close()
    }

    const {
      result: res,
      corpusLoadCount,
      loadCountByTable,
    } = await withServerLoadInstrumentation(() =>
      command('PATCH', '/api/v1/commands/settings/display', {
        baseRevision: revision,
        patch: { theme: 'legacy-fallback' },
      }),
    )

    expect(res.statusCode).toBe(200)
    expect(corpusLoadCount).toBeGreaterThan(0)
    expect(loadCountByTable.characters ?? 0).toBeGreaterThanOrEqual(1)
  })

  it('L11: collection commands read only settings plus requested collection tables', async () => {
    const fixture = buildLargeCorpusFixture()
    let revision = await importDatabase(fixture.database)

    async function runScopedCollectionCommand(
      method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
      url: string,
      payload: Record<string, unknown>,
      expectedTables: readonly string[],
      expectedLoadTables: readonly string[] = expectedTables,
    ): Promise<Record<string, unknown>> {
      const { result: loadRun, readCountByTable } = await withSqliteSelectReadInstrumentation(() =>
        withServerLoadInstrumentation(() => command(method, url, payload)),
      )
      expect(loadRun.result.statusCode).toBe(200)
      expectCollectionCommandReadOnlyTables(readCountByTable, expectedTables)
      expectCollectionLoadOnlyTables(loadRun.loadCountByTable, expectedLoadTables)
      const body = loadRun.result.json() as Record<string, unknown>
      revision = body.revision as number
      return body
    }

    await runScopedCollectionCommand(
      'POST',
      '/api/v1/commands/presets',
      { baseRevision: revision, preset: { id: 'l11-preset', name: 'L11 Preset' } },
      ['bot_presets'],
    )

    await runScopedCollectionCommand(
      'POST',
      '/api/v1/commands/presets/select',
      { baseRevision: revision, presetId: 'l11-preset' },
      ['bot_presets'],
    )

    await runScopedCollectionCommand(
      'POST',
      '/api/v1/commands/prompt-items',
      {
        baseRevision: revision,
        promptPresetId: 'corpus-prompt-preset-0',
        promptItem: { id: 'l11-prompt-item', type: 'plain', text: 'L11 prompt item' },
      },
      ['prompt_presets'],
      [],
    )

    await runScopedCollectionCommand(
      'POST',
      '/api/v1/commands/personas',
      { baseRevision: revision, persona: { id: 'l11-persona', name: 'L11 Persona' } },
      ['personas'],
    )

    await runScopedCollectionCommand(
      'POST',
      '/api/v1/commands/translator-presets',
      {
        baseRevision: revision,
        select: true,
        preset: {
          id: 'l11-translator',
          name: 'L11 Translator',
          prompt: 'Translate narrowly',
          maxResponse: 777,
        },
      },
      ['translator_presets'],
    )

    await runScopedCollectionCommand(
      'POST',
      '/api/v1/commands/loadouts/corpus-loadout-1/touch',
      { baseRevision: revision, lastUsed: 4242 },
      ['loadouts'],
    )
    expect(readSettingsRecord().lastLoadedLoadoutName).toBe('Loadout 1')

    await runScopedCollectionCommand(
      'PATCH',
      '/api/v1/commands/lorebooks/corpus-lore-1',
      { baseRevision: revision, patch: { name: 'L11 Lore' } },
      ['lore_books'],
    )

    await runScopedCollectionCommand(
      'POST',
      '/api/v1/commands/plugins',
      {
        baseRevision: revision,
        plugin: {
          name: 'l11-plugin',
          script: '',
          arguments: {},
          realArg: {},
          customLink: [],
          argMeta: {},
        },
      },
      ['plugins'],
    )
  })

  it('L11: collection scoped reads fall back broad for unrelated embedded settings rows', async () => {
    const fixture = buildLargeCorpusFixture()
    const revision = await importDatabase(fixture.database)

    const db = openDatabase(harness.dataDir)
    try {
      const settingsRow = db.prepare('SELECT data_json FROM settings WHERE id = 1').get() as {
        data_json: string
      }
      const settings = JSON.parse(settingsRow.data_json) as Record<string, unknown>
      settings.characters = [{ chaId: 'embedded-char', name: 'Embedded' }]
      db.prepare('UPDATE settings SET data_json = ? WHERE id = 1').run(JSON.stringify(settings))
    } finally {
      db.close()
    }

    const {
      result: res,
      corpusLoadCount,
      loadCountByTable,
    } = await withServerLoadInstrumentation(() =>
      command('POST', '/api/v1/commands/presets', {
        baseRevision: revision,
        preset: { id: 'l11-fallback-preset', name: 'L11 Fallback' },
      }),
    )

    expect(res.statusCode).toBe(200)
    expect(corpusLoadCount).toBeGreaterThan(1)
    expect(loadCountByTable.characters ?? 0).toBeGreaterThanOrEqual(1)
  })

  it('M3/L5/L6: the full message lifecycle stays scoped (append, patch, delete, truncate, replace, generation-result)', async () => {
    const fixture = buildLargeCorpusFixture()
    let revision = await importDatabase(fixture.database)
    const chatId = fixture.hot.chatId

    // Append.
    const appended = await assertScopedLoadOnHotPath(() =>
      command('POST', `/api/v1/commands/chats/${chatId}/messages`, {
        baseRevision: revision,
        message: { role: 'user', data: 'scoped append', chatId: 'scoped-msg-1' },
      }),
    )
    expect(appended.statusCode).toBe(200)
    revision = appended.json().revision

    // Patch by message id (the loader resolves the chat from the uid index).
    const patched = await assertScopedLoadOnHotPath(() =>
      command('PATCH', '/api/v1/commands/messages/scoped-msg-1', {
        baseRevision: revision,
        patch: { data: 'scoped append (edited)' },
      }),
    )
    expect(patched.statusCode).toBe(200)
    expect(patched.json().chatId).toBe(chatId)
    revision = patched.json().revision

    // Delete by message id.
    const deleted = await assertScopedLoadOnHotPath(() =>
      command('DELETE', '/api/v1/commands/messages/scoped-msg-1', {
        baseRevision: revision,
      }),
    )
    expect(deleted.statusCode).toBe(200)
    revision = deleted.json().revision

    // Truncate after a fixture message.
    const keepUntil = `corpus-msg-0-0-${fixture.hot.messageCount - 3}`
    const truncated = await assertScopedLoadOnHotPath(() =>
      command('POST', `/api/v1/commands/chats/${chatId}/messages/truncate`, {
        baseRevision: revision,
        afterMessageId: keepUntil,
      }),
    )
    expect(truncated.statusCode).toBe(200)
    expect(truncated.json().removedCount).toBe(2)
    revision = truncated.json().revision

    // Replace the whole transcript.
    const replaced = await assertScopedLoadOnHotPath(() =>
      command('PUT', `/api/v1/commands/chats/${chatId}/messages`, {
        baseRevision: revision,
        messages: [
          { role: 'user', data: 'fresh start', chatId: 'scoped-msg-2' },
          { role: 'char', data: 'fresh reply', chatId: 'scoped-msg-3' },
        ],
      }),
    )
    expect(replaced.statusCode).toBe(200)
    revision = replaced.json().revision

    // Generation-result persistence.
    const generated = await assertScopedLoadOnHotPath(() =>
      command('POST', `/api/v1/commands/chats/${chatId}/generation-result`, {
        baseRevision: revision,
        generationResult: {
          message: {
            role: 'char',
            data: 'generated answer',
            chatId: 'scoped-gen-1',
            generationInfo: { generationId: 'scoped-gen-1' },
          },
        },
      }),
    )
    expect(generated.statusCode).toBe(200)
    revision = generated.json().revision

    // The chained writes landed: hydrate the chat (itself scoped, H1).
    const hydrated = await hydrationGet(chatId)
    expect(hydrated.statusCode).toBe(200)
    expect((hydrated.json().message as Array<{ chatId: string }>).map((m) => m.chatId)).toEqual([
      'scoped-msg-2',
      'scoped-msg-3',
      'scoped-gen-1',
    ])
  })

  it('returns identical rows to the broad loader for both chat-id and message-id targets', async () => {
    const fixture = buildLargeCorpusFixture()
    await importDatabase(fixture.database)

    const db = openDatabase(harness.dataDir)
    try {
      const broad = loadPersisted(db, harness.dataDir).database as {
        characters: Array<{ chaId?: string; chats: Array<{ id?: string }> }>
      }
      const broadChar = broad.characters.find((c) => c.chats.some((chat) => chat.id === fixture.hot.chatId))!
      const broadChat = broadChar.chats.find((chat) => chat.id === fixture.hot.chatId)!

      const scopedRun = await withServerLoadInstrumentation(() =>
        loadPersistedForChatMutation(db, harness.dataDir, { chatId: fixture.hot.chatId }),
      )
      // The scoped read performs zero whole-corpus payload reads of ANY table.
      expect(scopedRun.corpusLoadCount).toBe(0)

      const scoped = scopedRun.result.database as {
        characters: Array<{ chats: Array<{ id?: string }> }>
      }
      expect(scoped.characters).toHaveLength(1)
      expect(scoped.characters[0].chats).toHaveLength(broadChar.chats.length)
      // Identical payload parses: same character (modulo the chats narrowing)
      // and the same target chat record; sibling chats are id-only stubs so
      // chatPage/selectedChatId math stays correct without parsing them.
      expect(scoped.characters[0].chats[0]).toEqual(broadChat)
      expect(scoped.characters[0].chats.slice(1)).toEqual(broadChar.chats.slice(1).map((chat) => ({ id: chat.id })))
      expect({ ...scoped.characters[0], chats: broadChar.chats }).toEqual(broadChar)

      // Message-id targeting resolves the same chat through the uid index.
      const byMessage = await assertScopedLoadOnHotPath(() =>
        loadPersistedForChatMutation(db, harness.dataDir, {
          messageId: `corpus-msg-0-0-0`,
        }),
      )
      const byMessageChars = (byMessage.database as { characters: unknown[] }).characters
      expect(byMessageChars).toEqual(scoped.characters)
    } finally {
      db.close()
    }
  })

  it('falls back to the broad load for an unknown chat id — the 404 contract is unchanged', async () => {
    const fixture = buildLargeCorpusFixture()
    const revision = await importDatabase(fixture.database)

    const { result: res, corpusLoadCount } = await withServerLoadInstrumentation(() =>
      command('PATCH', '/api/v1/commands/chats/no-such-chat/scriptstate', {
        baseRevision: revision,
        patch: { $flag: 'on' },
      }),
    )
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('Chat not found: no-such-chat')
    // The miss path engaged the documented broad fallback (and stayed correct).
    expect(corpusLoadCount).toBeGreaterThan(0)

    const missingMessage = await command('PATCH', '/api/v1/commands/messages/no-such-message', {
      baseRevision: revision,
      patch: { data: 'x' },
    })
    expect(missingMessage.statusCode).toBe(404)
    expect(missingMessage.json().error).toBe('Message not found: no-such-message')
  })

  it('pre-extraction embedded state: falls back broad and the global chat-id dedup still runs', async () => {
    const db = openDatabase(harness.dataDir)
    try {
      // Simulate the pre-extraction edge: characters/chats tables empty, the
      // settings blob still embeds characters — with a cross-character
      // duplicate chat id, the one state where the global dedup has work.
      db.exec('DELETE FROM chats')
      db.exec('DELETE FROM characters')
      const embedded = {
        characters: [
          { chaId: 'char-a', name: 'A', chats: [{ id: 'dup-chat', name: 'A1' }] },
          { chaId: 'char-b', name: 'B', chats: [{ id: 'dup-chat', name: 'B1' }] },
        ],
      }
      db.exec('DELETE FROM settings')
      db.prepare('INSERT INTO settings (id, data_json) VALUES (1, ?)').run(JSON.stringify(embedded))

      // The chats table has no row for the target → broad fallback returns the
      // embedded characters…
      const persisted = loadPersistedForChatMutation(db, harness.dataDir, {
        chatId: 'dup-chat',
      })
      const characters = (persisted.database as { characters: unknown[] }).characters
      expect(characters).toHaveLength(2)

      // …and `normalizeAllCharacterChats` still repairs the duplicate exactly
      // as on the never-narrowed path.
      const normalized = normalizeAllCharacterChats(persisted.database)
      const chatsA = normalized[0].chats as Array<{ id: string }>
      const chatsB = normalized[1].chats as Array<{ id: string }>
      expect(chatsA[0].id).toBe('dup-chat')
      expect(chatsB[0].id).not.toBe('dup-chat')
    } finally {
      db.close()
    }
  })

  it('rejects chatScopedRead combined with writeDatabase (data-loss guard)', async () => {
    const db = openDatabase(harness.dataDir)
    try {
      expect(() =>
        applyTargetedCommandMutation({
          db,
          dataDir: harness.dataDir,
          baseRevision: 0,
          eventSink: { emit() {} } as never,
          mutationPath: 'targeted-chat-row',
          writeDatabase: true,
          chatScopedRead: { chatId: 'any' },
          mutate() {
            throw new Error('must not be reached')
          },
        }),
      ).toThrow('chatScopedRead cannot be combined with writeDatabase')
    } finally {
      db.close()
    }
  })
})
