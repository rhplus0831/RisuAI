import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../src/db.js'
import {
  deleteCharacterRow,
  deletePluginStorageKey,
  loadPersisted,
  replaceAllCharactersInTable,
  writePersistedWithMessages,
  writePluginStorageKey,
  writeSettingsOnly,
  writeSingleCharacterRow,
  writeSingleChatRow,
  writeSingleChatRowExact,
  writeSingleCollectionRow,
  writeSingleCollectionTable,
} from '../src/repository.js'
import {
  getGreetingTranslation,
  sourceHash,
  upsertGreetingTranslation,
} from '../src/translation/greetingTranslationStore.js'

// Targeted writer kit: each writer must touch exactly its rows and leave every
// unrelated character / chat / collection rowid stable. A SQLite rowid only
// changes on DELETE+reINSERT, so snapshotting id-to-rowid (or position-to-rowid)
// before and after is the proof the broad rewrite was avoided.

let dataDir: string
let db: DatabaseSync

function seedDatabase(): void {
  const database = {
    currentChar: 0,
    theme: 'dark',
    selectedPersona: 0,
    modules: [
      { id: 'm1', name: 'Module 1' },
      { id: 'm2', name: 'Module 2' },
    ],
    plugins: [{ name: 'P1' }],
    botPresets: [{ name: 'preset-0' }, { name: 'preset-1' }],
    personas: [{ name: 'Persona 0' }],
    pluginCustomStorage: { existing: { mode: 'baseline' } },
    characters: [
      {
        chaId: 'char-a',
        name: 'A',
        chats: [
          { id: 'chat-a-1', name: 'A1', message: [] },
          { id: 'chat-a-2', name: 'A2', message: [] },
        ],
      },
      {
        chaId: 'char-b',
        name: 'B',
        chats: [{ id: 'chat-b-1', name: 'B1', message: [] }],
      },
    ],
  }
  writePersistedWithMessages(db, dataDir, { _version: 1, database, assets: [] })
}

/** id→rowid (or position→rowid) snapshot on the live handle. */
function rowids(table: string, pk: 'id' | 'position'): Record<string, number> {
  const rows = db.prepare(`SELECT ${pk} AS pk, rowid FROM ${table}`).all() as Array<{
    pk: string | number
    rowid: number
  }>
  return Object.fromEntries(rows.map((row) => [String(row.pk), row.rowid]))
}

function readSettings(): Record<string, unknown> {
  const row = db.prepare('SELECT data_json FROM settings WHERE id = 1').get() as { data_json: string }
  return JSON.parse(row.data_json) as Record<string, unknown>
}

function readCollection(table: string): Array<Record<string, unknown>> {
  const rows = db.prepare(`SELECT data_json FROM ${table} ORDER BY position`).all() as Array<{
    data_json: string
  }>
  return rows.map((row) => JSON.parse(row.data_json) as Record<string, unknown>)
}

function readPluginStorage(): Record<string, unknown> {
  const rows = db.prepare('SELECT key, value_json FROM plugin_custom_storage').all() as Array<{
    key: string
    value_json: string
  }>
  return Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value_json)]))
}

const COLLECTION_TABLES = [
  'modules',
  'plugins',
  'bot_presets',
  'prompt_templates',
  'personas',
  'loadouts',
  'lore_books',
  'translator_presets',
  'hypa_v3_presets',
] as const

/** Tracked collection table position-to-rowid snapshots, keyed by table. */
function allCollectionRowids(): Record<string, Record<string, number>> {
  return Object.fromEntries(COLLECTION_TABLES.map((table) => [table, rowids(table, 'position')]))
}

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'risu-writer-kit-'))
  db = openDatabase(dataDir)
  seedDatabase()
})

afterEach(() => {
  vi.restoreAllMocks()
  db.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('targeted writer kit', () => {
  it('broad character rewrites drop poisoned greeting cache rows but preserve valid rows', () => {
    const validTranslation = {
      text: 'translated',
      source: 'raw' as const,
      sourceHash: sourceHash('source'),
      targetLanguage: 'ko',
      inputLanguage: 'en',
      translatorType: 'google' as const,
      settingsHash: 'valid-settings',
      updatedAt: 123,
    }
    upsertGreetingTranslation(db, 'char-a', -1, validTranslation)
    db.prepare(
      `INSERT INTO greeting_translations
       (character_id, greeting_index, settings_hash, source_hash, translation_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'char-a',
      0,
      'poisoned-settings',
      sourceHash('poisoned'),
      JSON.stringify({ ...validTranslation, settingsHash: 'poisoned-settings', translatorType: 'future-provider' }),
      123,
    )
    const database = loadPersisted(db, dataDir).database as { characters: Array<Record<string, unknown>> }
    database.characters[0].name = 'A rewritten'
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    replaceAllCharactersInTable(db, database)

    expect(
      (loadPersisted(db, dataDir).database as { characters: Array<Record<string, unknown>> }).characters[0].name,
    ).toBe('A rewritten')
    expect(getGreetingTranslation(db, 'char-a', -1, 'valid-settings')?.translation).toEqual(validTranslation)
    expect(
      db
        .prepare(
          `SELECT 1 FROM greeting_translations
           WHERE character_id = ? AND greeting_index = ? AND settings_hash = ?`,
        )
        .get('char-a', 0, 'poisoned-settings'),
    ).toBeUndefined()
    expect(warning).toHaveBeenCalledTimes(1)
    expect(warning).toHaveBeenCalledWith(
      'Dropped invalid greeting translation cache rows during broad character rewrite',
      {
        droppedKeys: [{ characterId: 'char-a', greetingIndex: 0, settingsHash: 'poisoned-settings' }],
      },
    )
    warning.mockRestore()
  })

  it('writeSettingsOnly rewrites only the settings row', () => {
    const charsBefore = rowids('characters', 'id')
    const chatsBefore = rowids('chats', 'id')
    const collectionsBefore = allCollectionRowids()

    const settings = readSettings()
    settings.theme = 'light'
    settings.currentChar = 1
    writeSettingsOnly(db, settings)

    expect(readSettings()).toMatchObject({ theme: 'light', currentChar: 1 })
    expect(rowids('characters', 'id')).toEqual(charsBefore)
    expect(rowids('chats', 'id')).toEqual(chatsBefore)
    expect(allCollectionRowids()).toEqual(collectionsBefore)
  })

  it('writeSingleCharacterRow updates one character and strips chats', () => {
    const charsBefore = rowids('characters', 'id')
    const chatsBefore = rowids('chats', 'id')
    const collectionsBefore = allCollectionRowids()

    const loaded = loadPersisted(db, dataDir).database as {
      characters: Array<Record<string, unknown>>
    }
    const charB = loaded.characters.find((c) => c.chaId === 'char-b')!
    expect(Array.isArray(charB.chats)).toBe(true)
    charB.name = 'B renamed'
    writeSingleCharacterRow(db, 'char-b', charB)

    const row = db.prepare('SELECT data_json FROM characters WHERE id = ?').get('char-b') as {
      data_json: string
    }
    const stored = JSON.parse(row.data_json) as Record<string, unknown>
    expect(stored.name).toBe('B renamed')
    expect(stored).not.toHaveProperty('chats') // chats live in the chats table

    // Unrelated rows: every rowid stable, including char-b's (UPDATE keeps rowid).
    expect(rowids('characters', 'id')).toEqual(charsBefore)
    expect(rowids('chats', 'id')).toEqual(chatsBefore)
    expect(allCollectionRowids()).toEqual(collectionsBefore)
    // The other character row is byte-identical.
    const charA = db.prepare('SELECT data_json FROM characters WHERE id = ?').get('char-a') as {
      data_json: string
    }
    expect((JSON.parse(charA.data_json) as Record<string, unknown>).name).toBe('A')
  })

  it('writeSingleChatRow updates one chat and strips message/hypaV3Data', () => {
    const charsBefore = rowids('characters', 'id')
    const chatsBefore = rowids('chats', 'id')

    writeSingleChatRow(db, 'chat-a-2', {
      id: 'chat-a-2',
      name: 'A2 renamed',
      message: [{ role: 'user', data: 'should be stripped' }],
      hypaV3Data: { should: 'be stripped' },
    })

    const row = db.prepare('SELECT data_json FROM chats WHERE id = ?').get('chat-a-2') as {
      data_json: string
    }
    const stored = JSON.parse(row.data_json) as Record<string, unknown>
    expect(stored.name).toBe('A2 renamed')
    expect(stored).not.toHaveProperty('message')
    expect(stored).not.toHaveProperty('hypaV3Data')

    expect(rowids('characters', 'id')).toEqual(charsBefore)
    expect(rowids('chats', 'id')).toEqual(chatsBefore)
    // Sibling chats untouched.
    const chatA1 = db.prepare('SELECT data_json FROM chats WHERE id = ?').get('chat-a-1') as {
      data_json: string
    }
    expect((JSON.parse(chatA1.data_json) as Record<string, unknown>).name).toBe('A1')
  })

  it('writeSingleChatRowExact strips storage-owned bodies without repairing sibling fields', () => {
    const generationSettings = {
      configured: 'legacy',
      sidebarToggles: { keep: 'on', invalid: 17 },
      unknown: { nested: true },
    }
    const legacySibling = { nested: ['preserve', 1] }

    writeSingleChatRowExact(db, 'chat-a-2', {
      id: 'chat-a-2',
      localLore: [{ id: 'entry-a' }],
      generationSettings,
      legacySibling,
      message: [{ role: 'user', data: 'should be stripped' }],
      hypaV3Data: { should: 'be stripped' },
    })

    const row = db.prepare('SELECT data_json FROM chats WHERE id = ?').get('chat-a-2') as {
      data_json: string
    }
    const stored = JSON.parse(row.data_json) as Record<string, unknown>
    expect(stored.generationSettings).toStrictEqual(generationSettings)
    expect(stored.legacySibling).toStrictEqual(legacySibling)
    expect(stored).not.toHaveProperty('message')
    expect(stored).not.toHaveProperty('hypaV3Data')
  })

  it('writeSingleCollectionRow updates one row of one table, keeping rowids stable', () => {
    const collectionsBefore = allCollectionRowids()
    const charsBefore = rowids('characters', 'id')
    const chatsBefore = rowids('chats', 'id')

    writeSingleCollectionRow(db, 'botPresets', 1, { name: 'preset-1 renamed' })

    expect(readCollection('bot_presets')).toEqual([{ name: 'preset-0' }, { name: 'preset-1 renamed' }])
    // A pure UPDATE keeps every rowid, including the edited row's.
    expect(allCollectionRowids()).toEqual(collectionsBefore)
    expect(rowids('characters', 'id')).toEqual(charsBefore)
    expect(rowids('chats', 'id')).toEqual(chatsBefore)
  })

  it('writeSingleCollectionTable rebuilds one table and leaves the other eight + characters alone', () => {
    const collectionsBefore = allCollectionRowids()
    const charsBefore = rowids('characters', 'id')
    const chatsBefore = rowids('chats', 'id')

    writeSingleCollectionTable(db, 'modules', [
      { id: 'm1', name: 'Module 1' },
      { id: 'm2', name: 'Module 2' },
      { id: 'm3', name: 'Module 3' },
    ])

    expect(readCollection('modules')).toHaveLength(3)
    // Only `modules` was touched; other tracked tables keep their rowids.
    for (const table of COLLECTION_TABLES) {
      if (table === 'modules') continue
      expect(rowids(table, 'position'), table).toEqual(collectionsBefore[table])
    }
    expect(rowids('characters', 'id')).toEqual(charsBefore)
    expect(rowids('chats', 'id')).toEqual(chatsBefore)
  })

  it('writeSingleCollectionTable rejects an unknown collection field', () => {
    expect(() => writeSingleCollectionTable(db, 'characters', [])).toThrow(/Unknown collection field/)
  })

  it('writePluginStorageKey upserts a single key without touching other tables', () => {
    const collectionsBefore = allCollectionRowids()
    const charsBefore = rowids('characters', 'id')

    writePluginStorageKey(db, 'fresh', { mode: 'added', count: 1 })
    writePluginStorageKey(db, 'existing', { mode: 'updated' })

    expect(readPluginStorage()).toEqual({
      existing: { mode: 'updated' },
      fresh: { mode: 'added', count: 1 },
    })
    expect(allCollectionRowids()).toEqual(collectionsBefore)
    expect(rowids('characters', 'id')).toEqual(charsBefore)
  })

  it('deletePluginStorageKey removes a single key without touching other tables', () => {
    writePluginStorageKey(db, 'fresh', { mode: 'added' })
    const collectionsBefore = allCollectionRowids()
    const charsBefore = rowids('characters', 'id')

    deletePluginStorageKey(db, 'existing')

    expect(readPluginStorage()).toEqual({ fresh: { mode: 'added' } })
    expect(allCollectionRowids()).toEqual(collectionsBefore)
    expect(rowids('characters', 'id')).toEqual(charsBefore)
  })

  it('deleteCharacterRow alone cascades the chats rows via the FK (no explicit chats DELETE)', () => {
    // Precondition the cascade depends on: the pragma is actually enabled on
    // this connection (a connection-level setting, not a schema property).
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })

    const siblingChatsBefore = rowids('chats', 'id')
    expect(Object.keys(siblingChatsBefore).sort()).toEqual(['chat-a-1', 'chat-a-2', 'chat-b-1'])

    deleteCharacterRow(db, 'char-a')

    // The single characters DELETE removed char-a's chat rows through
    // `chats.character_id ON DELETE CASCADE`; char-b and its chat are intact
    // (same rowid — no DELETE+reINSERT churn).
    expect(rowids('characters', 'id')).toEqual({ 'char-b': expect.any(Number) })
    expect(rowids('chats', 'id')).toEqual({ 'chat-b-1': siblingChatsBefore['chat-b-1'] })
  })
})
