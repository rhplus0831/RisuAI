import type { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { recordTableWrite } from '../protocolMetrics.js'
import type { RawMessageTranslation } from './rawMessageTranslation.js'

export const GREETING_TRANSLATIONS_PORTABLE_FIELD = 'greetingTranslations'

export interface GreetingTranslationRow {
  characterId: string
  greetingIndex: number
  settingsHash: string
  sourceHash: string
  translation: RawMessageTranslation
  updatedAt: number
}

export interface PortableGreetingTranslation {
  greetingIndex: number
  settingsHash: string
  translation: RawMessageTranslation
}

interface StoredGreetingTranslationRow {
  character_id: string
  greeting_index: number
  settings_hash: string
  source_hash: string
  translation_json: string
  updated_at: number
}

export interface SelectedGreeting {
  greetingIndex: number
  source: string
}

export class GreetingTranslationValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GreetingTranslationValidationError'
  }
}

export function createGreetingTranslationTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS greeting_translations (
      character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      greeting_index INTEGER NOT NULL CHECK (greeting_index >= -1),
      settings_hash TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      translation_json TEXT NOT NULL CHECK (json_valid(translation_json)),
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (character_id, greeting_index, settings_hash)
    )
  `)
}

export function sourceHash(source: string): string {
  return createHash('sha256').update(source).digest('hex')
}

export function greetingSourceAtIndex(character: Record<string, unknown>, greetingIndex: number): string | null {
  if (!Number.isInteger(greetingIndex) || greetingIndex < -1) return null
  if (greetingIndex === -1) {
    return typeof character.firstMessage === 'string' ? character.firstMessage : null
  }
  if (!Array.isArray(character.alternateGreetings) || greetingIndex >= character.alternateGreetings.length) return null
  const source = character.alternateGreetings[greetingIndex]
  return typeof source === 'string' ? source : null
}

export function selectedGreeting(
  character: Record<string, unknown>,
  chatOrIndex: Record<string, unknown> | number,
): SelectedGreeting {
  const candidate = typeof chatOrIndex === 'number' ? chatOrIndex : chatOrIndex.fmIndex
  const greetingIndex = Number.isInteger(candidate) && (candidate as number) >= -1 ? (candidate as number) : -1
  return {
    greetingIndex,
    source: greetingSourceAtIndex(character, greetingIndex) ?? '',
  }
}

export function parseRawMessageTranslation(value: unknown, label = 'translation'): RawMessageTranslation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GreetingTranslationValidationError(`${label} must be an object`)
  }
  const record = value as Record<string, unknown>
  if (typeof record.text !== 'string') {
    throw new GreetingTranslationValidationError(`${label}.text must be a string`)
  }
  if (record.source !== 'raw') {
    throw new GreetingTranslationValidationError(`${label}.source must be raw`)
  }
  for (const key of ['sourceHash', 'targetLanguage', 'inputLanguage', 'settingsHash'] as const) {
    if (typeof record[key] !== 'string' || record[key].trim() === '') {
      throw new GreetingTranslationValidationError(`${label}.${key} must be a non-empty string`)
    }
  }
  if (
    record.translatorType !== 'google' &&
    record.translatorType !== 'deepl' &&
    record.translatorType !== 'deeplX' &&
    record.translatorType !== 'llm'
  ) {
    throw new GreetingTranslationValidationError(`${label}.translatorType is invalid`)
  }
  if (typeof record.updatedAt !== 'number' || !Number.isFinite(record.updatedAt)) {
    throw new GreetingTranslationValidationError(`${label}.updatedAt must be a finite number`)
  }
  return structuredClone(record) as unknown as RawMessageTranslation
}

export function parsePortableGreetingTranslation(
  value: unknown,
  label = GREETING_TRANSLATIONS_PORTABLE_FIELD,
): PortableGreetingTranslation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GreetingTranslationValidationError(`${label} must be an object`)
  }
  const record = value as Record<string, unknown>
  if (!Number.isInteger(record.greetingIndex) || (record.greetingIndex as number) < -1) {
    throw new GreetingTranslationValidationError(`${label}.greetingIndex must be an integer at least -1`)
  }
  if (typeof record.settingsHash !== 'string' || record.settingsHash.trim() === '') {
    throw new GreetingTranslationValidationError(`${label}.settingsHash must be a non-empty string`)
  }
  const translation = parseRawMessageTranslation(record.translation, `${label}.translation`)
  if (translation.settingsHash !== record.settingsHash) {
    throw new GreetingTranslationValidationError(`${label}.settingsHash must match translation.settingsHash`)
  }
  return {
    greetingIndex: record.greetingIndex as number,
    settingsHash: record.settingsHash,
    translation,
  }
}

function rowFromStored(row: StoredGreetingTranslationRow): GreetingTranslationRow {
  let parsed: unknown
  try {
    parsed = JSON.parse(row.translation_json)
  } catch {
    throw new GreetingTranslationValidationError('Stored greeting translation must contain valid JSON')
  }
  const translation = parseRawMessageTranslation(parsed, 'stored greeting translation')
  if (
    translation.sourceHash !== row.source_hash ||
    translation.settingsHash !== row.settings_hash ||
    translation.updatedAt !== row.updated_at
  ) {
    throw new GreetingTranslationValidationError(
      'Stored greeting translation hashes or timestamp disagree with its row',
    )
  }
  return {
    characterId: row.character_id,
    greetingIndex: row.greeting_index,
    settingsHash: row.settings_hash,
    sourceHash: row.source_hash,
    translation,
    updatedAt: row.updated_at,
  }
}

export function getGreetingTranslation(
  db: DatabaseSync,
  characterId: string,
  greetingIndex: number,
  settingsHash: string,
): GreetingTranslationRow | null {
  const row = db
    .prepare(
      `SELECT character_id, greeting_index, settings_hash, source_hash, translation_json, updated_at
       FROM greeting_translations
       WHERE character_id = ? AND greeting_index = ? AND settings_hash = ?`,
    )
    .get(characterId, greetingIndex, settingsHash) as unknown as StoredGreetingTranslationRow | undefined
  return row ? rowFromStored(row) : null
}

export function getSourceValidGreetingTranslation(
  db: DatabaseSync,
  characterId: string,
  greetingIndex: number,
  settingsHash: string,
  source: string,
): RawMessageTranslation | null {
  const row = getGreetingTranslation(db, characterId, greetingIndex, settingsHash)
  return row && row.sourceHash === sourceHash(source) ? row.translation : null
}

export function listSourceValidGreetingTranslations(
  db: DatabaseSync,
  characterId: string,
  character: Record<string, unknown>,
  settingsHash?: string,
): GreetingTranslationRow[] {
  const rows = (settingsHash === undefined
    ? db
        .prepare(
          `SELECT character_id, greeting_index, settings_hash, source_hash, translation_json, updated_at
           FROM greeting_translations WHERE character_id = ?
           ORDER BY greeting_index, settings_hash`,
        )
        .all(characterId)
    : db
        .prepare(
          `SELECT character_id, greeting_index, settings_hash, source_hash, translation_json, updated_at
           FROM greeting_translations WHERE character_id = ? AND settings_hash = ?
           ORDER BY greeting_index`,
        )
        .all(characterId, settingsHash)) as unknown as StoredGreetingTranslationRow[]

  return rows.map(rowFromStored).filter((row) => {
    const source = greetingSourceAtIndex(character, row.greetingIndex)
    return source !== null && sourceHash(source) === row.sourceHash
  })
}

export function listAllGreetingTranslations(db: DatabaseSync): GreetingTranslationRow[] {
  const rows = db
    .prepare(
      `SELECT character_id, greeting_index, settings_hash, source_hash, translation_json, updated_at
       FROM greeting_translations
       ORDER BY character_id, greeting_index, settings_hash`,
    )
    .all() as unknown as StoredGreetingTranslationRow[]
  return rows.map(rowFromStored)
}

export function upsertGreetingTranslation(
  db: DatabaseSync,
  characterId: string,
  greetingIndex: number,
  translationValue: RawMessageTranslation,
): void {
  if (!Number.isInteger(greetingIndex) || greetingIndex < -1) {
    throw new GreetingTranslationValidationError('greetingIndex must be an integer at least -1')
  }
  const translation = parseRawMessageTranslation(translationValue)
  recordTableWrite('greeting_translations')
  db.prepare(
    `INSERT INTO greeting_translations (
       character_id, greeting_index, settings_hash, source_hash, translation_json, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(character_id, greeting_index, settings_hash) DO UPDATE SET
       source_hash = excluded.source_hash,
       translation_json = excluded.translation_json,
       updated_at = excluded.updated_at`,
  ).run(
    characterId,
    greetingIndex,
    translation.settingsHash,
    translation.sourceHash,
    JSON.stringify(translation),
    translation.updatedAt,
  )
}

export function deleteGreetingTranslationsForIndex(db: DatabaseSync, characterId: string, greetingIndex: number): void {
  recordTableWrite('greeting_translations')
  db.prepare('DELETE FROM greeting_translations WHERE character_id = ? AND greeting_index = ?').run(
    characterId,
    greetingIndex,
  )
}

export function deleteChangedGreetingTranslations(
  db: DatabaseSync,
  characterId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): void {
  if (greetingSourceAtIndex(before, -1) !== greetingSourceAtIndex(after, -1)) {
    deleteGreetingTranslationsForIndex(db, characterId, -1)
  }
  const beforeAlternates = Array.isArray(before.alternateGreetings) ? before.alternateGreetings : []
  const afterAlternates = Array.isArray(after.alternateGreetings) ? after.alternateGreetings : []
  const count = Math.max(beforeAlternates.length, afterAlternates.length)
  for (let greetingIndex = 0; greetingIndex < count; greetingIndex += 1) {
    if (greetingSourceAtIndex(before, greetingIndex) !== greetingSourceAtIndex(after, greetingIndex)) {
      deleteGreetingTranslationsForIndex(db, characterId, greetingIndex)
    }
  }
}

export function remapAlternateGreetingTranslations(
  db: DatabaseSync,
  characterId: string,
  operation: { type: 'delete'; index: number } | { type: 'swap'; firstIndex: number; secondIndex: number },
): void {
  const rows = db
    .prepare(
      `SELECT character_id, greeting_index, settings_hash, source_hash, translation_json, updated_at
       FROM greeting_translations
       WHERE character_id = ? AND greeting_index >= 0
       ORDER BY greeting_index, settings_hash`,
    )
    .all(characterId) as unknown as StoredGreetingTranslationRow[]
  if (rows.length === 0) return

  recordTableWrite('greeting_translations')
  db.prepare('DELETE FROM greeting_translations WHERE character_id = ? AND greeting_index >= 0').run(characterId)
  const insert = db.prepare(
    `INSERT INTO greeting_translations (
       character_id, greeting_index, settings_hash, source_hash, translation_json, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  )
  for (const row of rows) {
    let nextIndex = row.greeting_index
    if (operation.type === 'delete') {
      if (nextIndex === operation.index) continue
      if (nextIndex > operation.index) nextIndex -= 1
    } else if (nextIndex === operation.firstIndex) {
      nextIndex = operation.secondIndex
    } else if (nextIndex === operation.secondIndex) {
      nextIndex = operation.firstIndex
    }
    insert.run(row.character_id, nextIndex, row.settings_hash, row.source_hash, row.translation_json, row.updated_at)
  }
}

export function replaceGreetingTranslationsForImport(db: DatabaseSync, rows: readonly GreetingTranslationRow[]): void {
  recordTableWrite('greeting_translations')
  db.exec('DELETE FROM greeting_translations')
  const insert = db.prepare(
    `INSERT INTO greeting_translations (
       character_id, greeting_index, settings_hash, source_hash, translation_json, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  )
  for (const row of rows) {
    const translation = parseRawMessageTranslation(row.translation)
    if (
      row.settingsHash !== translation.settingsHash ||
      row.sourceHash !== translation.sourceHash ||
      row.updatedAt !== translation.updatedAt
    ) {
      throw new GreetingTranslationValidationError('Imported greeting translation disagrees with its row')
    }
    insert.run(
      row.characterId,
      row.greetingIndex,
      row.settingsHash,
      row.sourceHash,
      JSON.stringify(translation),
      row.updatedAt,
    )
  }
}
