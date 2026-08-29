import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../src/db.js'
import {
  createBardWikiDocument,
  deleteBardWikiDocument,
  extractBardWikiLinks,
  getBardWikiDocument,
  listBardWikiDocumentVersions,
  listBardWikiDocuments,
  listBardWikiLinks,
  normalizeBardWikiAliases,
  normalizeBardWikiPath,
  updateBardWikiChatSettings,
  updateBardWikiDocument,
} from '../src/bardWikiRepository.js'

let dataDir: string
let db: DatabaseSync

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'risu-bardwiki-repository-'))
  db = openDatabase(dataDir)
  seedChat('character-a', 'chat-a')
  seedChat('character-b', 'chat-b')
})

afterEach(() => {
  db.close()
  rmSync(dataDir, { recursive: true, force: true })
})

function seedChat(characterId: string, chatId: string): void {
  db.prepare('INSERT INTO characters (id, position, data_json) VALUES (?, 0, ?)').run(characterId, '{}')
  db.prepare('INSERT INTO chats (id, character_id, position, data_json) VALUES (?, ?, 0, ?)').run(
    chatId,
    characterId,
    '{}',
  )
}

function createDocument(
  overrides: Partial<Parameters<typeof createBardWikiDocument>[1]> = {},
): ReturnType<typeof createBardWikiDocument> {
  return createBardWikiDocument(db, {
    id: 'document-a',
    chatId: 'chat-a',
    kind: 'location',
    title: 'Old Tavern',
    logicalPath: 'Places/Old Tavern',
    aliases: ['The Inn'],
    markdown: '## Old Tavern\nA quiet inn.',
    commandRevision: 1,
    ...overrides,
  })
}

describe('BardWiki validation', () => {
  it('normalizes paths, titles, and aliases deterministically', () => {
    expect(normalizeBardWikiPath(' Places\\Old   Tavern ')).toEqual({
      logicalPath: 'Places/Old Tavern',
      normalizedPath: 'places/old tavern',
    })
    expect(normalizeBardWikiAliases([' The   Inn ', 'the inn', '宿屋'])).toEqual(['The Inn', '宿屋'])
  })

  it.each(['/absolute', '../escape', 'Places/.', 'Places/name.', 'manifest.json', 'attachments/file'])(
    'rejects unsafe logical path %s',
    (logicalPath) => {
      expect(() => normalizeBardWikiPath(logicalPath)).toThrowError(
        expect.objectContaining({ code: 'bardwiki_invalid_path' }),
      )
    },
  )

  it('parses bounded wikilink targets without treating labels or headings as identity', () => {
    expect(extractBardWikiLinks('[[Places/Inn#Bar|the bar]] and [[Alice]]')).toEqual([
      { rawTarget: 'Places/Inn#Bar', normalizedTarget: 'places/inn' },
      { rawTarget: 'Alice', normalizedTarget: 'alice' },
    ])
  })
})

describe('BardWiki document persistence', () => {
  it('stores nullable chat overrides without conflating inherit and explicit null references', () => {
    const settings = updateBardWikiChatSettings(db, 'chat-a', {
      enabledOverride: true,
      memoryModeOverride: 'hybrid',
      modelProfileIdOverride: null,
      modelProfileIdIsSet: true,
      maxLinkHopsOverride: 2,
    })
    expect(settings).toMatchObject({
      chatId: 'chat-a',
      enabledOverride: true,
      memoryModeOverride: 'hybrid',
      modelProfileIdOverride: null,
      modelProfileIdIsSet: true,
      maxLinkHopsOverride: 2,
    })
    expect(() => updateBardWikiChatSettings(db, 'chat-a', { recentMessageCountOverride: 51 })).toThrowError(
      expect.objectContaining({ code: 'bardwiki_limit_exceeded' }),
    )
  })

  it('creates immutable versions and current search/link projections', () => {
    const target = createDocument()
    const source = createDocument({
      id: 'document-event',
      kind: 'event',
      title: 'Arrival',
      logicalPath: 'Events/Arrival',
      aliases: [],
      markdown: 'They met at [[Old Tavern]] and entered [[Places/Old Tavern#Bar]].',
    })

    expect(listBardWikiDocuments(db, 'chat-a').map(({ id }) => id)).toEqual(['document-event', 'document-a'])
    expect(listBardWikiDocumentVersions(db, target.id)).toEqual([
      expect.objectContaining({
        documentId: target.id,
        version: 1,
        actor: 'user',
        reason: 'create',
        commandRevision: 1,
      }),
    ])
    expect(listBardWikiLinks(db, source.id)).toEqual([
      expect.objectContaining({ ordinal: 0, resolvedDocumentId: target.id }),
      expect.objectContaining({ ordinal: 1, resolvedDocumentId: target.id }),
    ])
    expect(
      db
        .prepare('SELECT title_terms, alias_terms, heading_terms FROM bardwiki_document_search WHERE document_id = ?')
        .get(target.id),
    ).toEqual({
      title_terms: 'old tavern',
      alias_terms: 'the inn',
      heading_terms: 'old tavern',
    })
  })

  it('updates under a version/hash fence and never overwrites a stale writer', () => {
    const created = createDocument()
    const updated = updateBardWikiDocument(db, 'chat-a', created.id, {
      expectedVersion: created.version,
      expectedContentHash: created.contentHash,
      title: 'New Tavern',
      logicalPath: 'Places/New Tavern',
      markdown: '## New Tavern\nNow bustling.',
      commandRevision: 2,
    })

    expect(updated).toMatchObject({ version: 2, title: 'New Tavern', logicalPath: 'Places/New Tavern' })
    expect(listBardWikiDocumentVersions(db, created.id).map(({ version }) => version)).toEqual([2, 1])
    expect(() =>
      updateBardWikiDocument(db, 'chat-a', created.id, {
        expectedVersion: created.version,
        expectedContentHash: created.contentHash,
        markdown: 'stale overwrite',
        commandRevision: 3,
      }),
    ).toThrowError(expect.objectContaining({ code: 'bardwiki_document_conflict' }))
    expect(getBardWikiDocument(db, 'chat-a', created.id)?.markdown).toBe('## New Tavern\nNow bustling.')
  })

  it('enforces live normalized paths per chat while allowing cross-chat reuse and deleted-path reuse', () => {
    const created = createDocument()
    expect(() => createDocument({ id: 'duplicate', logicalPath: 'places/old tavern' })).toThrowError(
      expect.objectContaining({ code: 'bardwiki_path_conflict' }),
    )
    expect(createDocument({ id: 'other-chat', chatId: 'chat-b' }).normalizedPath).toBe('places/old tavern')

    const deleted = deleteBardWikiDocument(db, 'chat-a', created.id, {
      expectedVersion: created.version,
      expectedContentHash: created.contentHash,
      commandRevision: 2,
    })
    expect(deleted).toMatchObject({ version: 2 })
    expect(deleted.deletedAt).not.toBeNull()
    expect(getBardWikiDocument(db, 'chat-a', created.id)).toBeNull()
    expect(listBardWikiDocumentVersions(db, created.id)[0]).toMatchObject({ reason: 'delete', deleted: true })
    expect(createDocument({ id: 'replacement' }).id).toBe('replacement')
  })

  it('can participate in a caller-owned transaction without leaving partial projections', () => {
    db.exec('BEGIN IMMEDIATE')
    try {
      createDocument()
      throw new Error('force rollback')
    } catch {
      db.exec('ROLLBACK')
    }

    for (const table of [
      'bardwiki_documents',
      'bardwiki_document_versions',
      'bardwiki_links',
      'bardwiki_document_search',
    ]) {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 })
    }
  })

  it('cascades every authoritative, operational, and derived row with its chat', () => {
    const document = createDocument()
    db.prepare(
      `INSERT INTO bardwiki_chat_settings (chat_id, enabled_override)
       VALUES ('chat-a', 1)`,
    ).run()
    db.prepare(
      `INSERT INTO bardwiki_turn_receipts (
        id, chat_id, user_message_id, user_content_hash, assistant_message_id,
        assistant_content_hash, confirmation_mode, state, change_set_id, event_document_id
      ) VALUES ('receipt-a', 'chat-a', 'user-a', 'hash-u', 'assistant-a', 'hash-a',
        'explicit', 'applied', 'change-a', ?)`,
    ).run(document.id)
    db.prepare(
      `INSERT INTO bardwiki_jobs (
        id, instance_id, chat_id, receipt_id, kind, status, payload_json
      ) VALUES ('job-a', 'instance-a', 'chat-a', 'receipt-a', 'apply_turn', 'completed', '{}')`,
    ).run()
    db.prepare(
      `INSERT INTO bardwiki_change_manifest (
        receipt_id, document_id, after_version, after_hash
      ) VALUES ('receipt-a', ?, 1, ?)`,
    ).run(document.id, document.contentHash)
    db.prepare("DELETE FROM chats WHERE id = 'chat-a'").run()

    for (const table of [
      'bardwiki_chat_settings',
      'bardwiki_documents',
      'bardwiki_document_versions',
      'bardwiki_turn_receipts',
      'bardwiki_jobs',
      'bardwiki_links',
      'bardwiki_change_manifest',
      'bardwiki_document_search',
      'bardwiki_rebuild_staging',
    ]) {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 })
    }
  })
})
