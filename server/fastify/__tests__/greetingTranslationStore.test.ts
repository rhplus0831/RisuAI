import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GreetingTranslationJobRegistry } from '../src/greetingTranslationJobs.js'
import {
  GreetingTranslationValidationError,
  createGreetingTranslationTable,
  getGreetingTranslation,
  getSourceValidGreetingTranslation,
  listSourceValidGreetingTranslations,
  remapAlternateGreetingTranslations,
  sourceHash,
  upsertGreetingTranslation,
} from '../src/translation/greetingTranslationStore.js'
import type { RawMessageTranslation } from '../src/translation/rawMessageTranslation.js'

function translation(source: string, settingsHash: string, text: string): RawMessageTranslation {
  return {
    text,
    source: 'raw',
    sourceHash: sourceHash(source),
    targetLanguage: 'ko',
    inputLanguage: 'en',
    translatorType: 'google',
    settingsHash,
    updatedAt: 123,
  }
}

let db: DatabaseSync

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE characters (id TEXT PRIMARY KEY);
    INSERT INTO characters (id) VALUES ('char-a');
  `)
  createGreetingTranslationTable(db)
})

afterEach(() => db.close())

describe('greeting translation store', () => {
  it('stores independent settings variants and filters stale sources', () => {
    upsertGreetingTranslation(db, 'char-a', -1, translation('primary', 'settings-a', '기본'))
    upsertGreetingTranslation(db, 'char-a', -1, translation('primary', 'settings-b', '기본 B'))

    expect(getSourceValidGreetingTranslation(db, 'char-a', -1, 'settings-a', 'primary')?.text).toBe('기본')
    expect(getSourceValidGreetingTranslation(db, 'char-a', -1, 'settings-a', 'edited')).toBeNull()
    expect(
      listSourceValidGreetingTranslations(db, 'char-a', { firstMessage: 'primary', alternateGreetings: [] }).map(
        (row) => row.settingsHash,
      ),
    ).toEqual(['settings-a', 'settings-b'])
  })

  it('rejects nested metadata that disagrees with the normalized row contract', () => {
    db.prepare(
      `INSERT INTO greeting_translations
       (character_id, greeting_index, settings_hash, source_hash, translation_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'char-a',
      -1,
      'row-settings',
      sourceHash('primary'),
      JSON.stringify(translation('primary', 'nested-settings', 'bad')),
      123,
    )

    expect(() => getGreetingTranslation(db, 'char-a', -1, 'row-settings')).toThrow(GreetingTranslationValidationError)
  })

  it('cascades character deletion', () => {
    upsertGreetingTranslation(db, 'char-a', -1, translation('primary', 'settings-a', '기본'))
    db.prepare('DELETE FROM characters WHERE id = ?').run('char-a')
    expect(db.prepare('SELECT COUNT(*) AS count FROM greeting_translations').get()).toEqual({ count: 0 })
  })

  it('swaps and deletes alternate indices without collisions or moving the primary row', () => {
    upsertGreetingTranslation(db, 'char-a', -1, translation('primary', 'settings-a', 'primary translated'))
    upsertGreetingTranslation(db, 'char-a', 0, translation('zero', 'settings-a', 'zero translated'))
    upsertGreetingTranslation(db, 'char-a', 1, translation('one', 'settings-a', 'one translated'))
    upsertGreetingTranslation(db, 'char-a', 2, translation('two', 'settings-a', 'two translated'))

    remapAlternateGreetingTranslations(db, 'char-a', { type: 'swap', firstIndex: 0, secondIndex: 2 })
    expect(getGreetingTranslation(db, 'char-a', 0, 'settings-a')?.translation.text).toBe('two translated')
    expect(getGreetingTranslation(db, 'char-a', 2, 'settings-a')?.translation.text).toBe('zero translated')

    remapAlternateGreetingTranslations(db, 'char-a', { type: 'delete', index: 1 })
    expect(getGreetingTranslation(db, 'char-a', 1, 'settings-a')?.translation.text).toBe('zero translated')
    expect(getGreetingTranslation(db, 'char-a', 2, 'settings-a')).toBeNull()
    expect(getGreetingTranslation(db, 'char-a', -1, 'settings-a')?.translation.text).toBe('primary translated')
  })
})

describe('GreetingTranslationJobRegistry', () => {
  it('keeps only the latest same-target job current while independent targets continue', () => {
    const registry = new GreetingTranslationJobRegistry()
    const first = registry.register({
      characterId: 'char-a',
      greetingIndex: 0,
      settingsHash: 'settings-a',
      jobId: 'first',
    })
    const other = registry.register({
      characterId: 'char-a',
      greetingIndex: 1,
      settingsHash: 'settings-a',
      jobId: 'other',
    })
    const latest = registry.register({
      characterId: 'char-a',
      greetingIndex: 0,
      settingsHash: 'settings-a',
      jobId: 'latest',
    })

    expect(first.isCurrent()).toBe(false)
    expect(other.isCurrent()).toBe(true)
    expect(latest.isCurrent()).toBe(true)
    first.succeed()
    other.succeed()
    latest.fail(new Error('provider key secret'))
    expect(registry.translations()).toEqual([
      expect.objectContaining({ greetingIndex: 1, jobId: 'other', status: 'succeeded' }),
      expect.objectContaining({ greetingIndex: 0, jobId: 'latest', status: 'failed' }),
    ])
  })

  it('invalidates only alternate jobs affected by a positional mutation', () => {
    const registry = new GreetingTranslationJobRegistry()
    const primary = registry.register({
      characterId: 'char-a',
      greetingIndex: -1,
      settingsHash: 'settings-a',
    })
    const before = registry.register({ characterId: 'char-a', greetingIndex: 0, settingsHash: 'settings-a' })
    const shifted = registry.register({ characterId: 'char-a', greetingIndex: 2, settingsHash: 'settings-a' })
    const otherCharacter = registry.register({
      characterId: 'char-b',
      greetingIndex: 2,
      settingsHash: 'settings-a',
    })

    registry.invalidateAlternateMutation('char-a', { type: 'delete', index: 1 })
    expect(primary.isCurrent()).toBe(true)
    expect(before.isCurrent()).toBe(true)
    expect(shifted.isCurrent()).toBe(false)
    expect(otherCharacter.isCurrent()).toBe(true)
  })

  it('bounds retained terminal jobs without evicting a running target', () => {
    const registry = new GreetingTranslationJobRegistry()
    const running = registry.register({ characterId: 'char-running', greetingIndex: -1, settingsHash: 'settings-a' })
    for (let greetingIndex = 0; greetingIndex < 130; greetingIndex += 1) {
      registry
        .register({ characterId: 'char-a', greetingIndex, settingsHash: 'settings-a', jobId: `job-${greetingIndex}` })
        .succeed()
    }

    const jobs = registry.translations()
    expect(running.isCurrent()).toBe(true)
    expect(jobs.filter((job) => job.status !== 'running')).toHaveLength(128)
    expect(jobs).not.toEqual(expect.arrayContaining([expect.objectContaining({ jobId: 'job-0' })]))
    expect(jobs).toEqual(expect.arrayContaining([expect.objectContaining({ jobId: 'job-129' })]))
  })
})
