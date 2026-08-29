import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_BARDWIKI_GLOBAL_SETTINGS, type BardWikiGlobalSettings } from '@risuai/protocol'
import type { Database } from '../../../src/ts/storage/database.svelte'
import { createBardWikiDocument, updateBardWikiChatSettings } from '../src/bardWikiRepository.js'
import { resolveBardWikiMemoryBudgets } from '../src/bardWikiSettings.js'
import { openDatabase } from '../src/db.js'
import { buildBardWikiPromptRows } from '../src/prompt/bardWiki.js'

let dataDir: string
let db: DatabaseSync

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'risu-bardwiki-prompt-'))
  db = openDatabase(dataDir)
  db.prepare('INSERT INTO characters (id, position, data_json) VALUES (?, 0, ?)').run('character-a', '{}')
  db.prepare('INSERT INTO chats (id, character_id, position, data_json) VALUES (?, ?, 0, ?)').run(
    'chat-a',
    'character-a',
    '{}',
  )
  createBardWikiDocument(db, {
    id: 'document-a',
    chatId: 'chat-a',
    kind: 'character',
    title: 'Alice',
    logicalPath: 'Characters/Alice',
    aliases: [],
    contextPolicy: 'relevant',
    reviewState: 'active',
    markdown: '## Alice\n\nAlice is a ranger. PRIVATE_BODY_SENTINEL',
    commandRevision: 1,
  })
})

afterEach(() => {
  db.close()
  rmSync(dataDir, { recursive: true, force: true })
})

function database(settings: BardWikiGlobalSettings): Database {
  return {
    aiModel: 'gpt-4o-mini',
    bardWiki: settings,
    characters: [
      {
        chaId: 'character-a',
        chats: [
          {
            id: 'chat-a',
            message: [
              { role: 'user', data: 'Earlier context', chatId: 'message-1' },
              { role: 'char', data: 'Earlier answer', chatId: 'message-2' },
            ],
          },
        ],
      },
    ],
  } as unknown as Database
}

function enabledSettings(overrides: Partial<BardWikiGlobalSettings> = {}): BardWikiGlobalSettings {
  return {
    ...DEFAULT_BARDWIKI_GLOBAL_SETTINGS,
    enabledByDefault: true,
    memoryMode: 'bardwiki',
    ...overrides,
  }
}

describe('BardWiki prompt adapter', () => {
  it('emits bounded reference rows and privacy-safe diagnostics without writing storage', () => {
    const before = db.prepare('SELECT total_changes() AS count').get() as { count: number }
    const result = buildBardWikiPromptRows({
      db,
      database: database(enabledSettings()),
      querySource: {
        chatId: 'chat-a',
        characterId: 'character-a',
        mode: 'send',
        userMessage: 'Where is Alice?',
      },
    })
    const after = db.prepare('SELECT total_changes() AS count').get() as { count: number }

    expect(result.rows).toEqual([expect.objectContaining({ role: 'system', memo: 'bardWiki', removable: true })])
    expect(result.rows[0]?.content).toContain('<bardwiki-reference')
    expect(result.rows[0]?.content).toContain('PRIVATE_BODY_SENTINEL')
    expect(result.diagnostics).toMatchObject({
      reason: 'selected',
      memoryMode: 'bardwiki',
      candidateCount: 1,
      selectedCount: 1,
    })
    expect(JSON.stringify(result.diagnostics)).not.toContain('PRIVATE_BODY_SENTINEL')
    expect(after.count).toBe(before.count)
  })

  it('keeps disabled and Hypa modes byte-empty while honoring a chat override', () => {
    const disabled = buildBardWikiPromptRows({
      db,
      database: database(DEFAULT_BARDWIKI_GLOBAL_SETTINGS),
      querySource: { chatId: 'chat-a', characterId: 'character-a', mode: 'send', userMessage: 'Alice' },
    })
    expect(disabled.rows).toEqual([])
    expect(disabled.diagnostics.reason).toBe('disabled')

    updateBardWikiChatSettings(db, 'chat-a', { enabledOverride: true, memoryModeOverride: 'bardwiki' })
    const overridden = buildBardWikiPromptRows({
      db,
      database: database(DEFAULT_BARDWIKI_GLOBAL_SETTINGS),
      querySource: { chatId: 'chat-a', characterId: 'character-a', mode: 'send', userMessage: 'Alice' },
    })
    expect(overridden.rows).toHaveLength(1)

    updateBardWikiChatSettings(db, 'chat-a', { enabledOverride: null, memoryModeOverride: null })
    const hypa = buildBardWikiPromptRows({
      db,
      database: database(enabledSettings({ memoryMode: 'hypa' })),
      querySource: { chatId: 'chat-a', characterId: 'character-a', mode: 'send', userMessage: 'Alice' },
    })
    expect(hypa.rows).toEqual([])
    expect(hypa.diagnostics.reason).toBe('hypa_mode')
  })

  it('partitions Hybrid by reducing BardWiki first and never borrows unused tokens', () => {
    expect(
      resolveBardWikiMemoryBudgets(
        enabledSettings({
          memoryMode: 'hybrid',
          totalTokenBudget: 1_000,
          hybridHypaTokenBudget: 800,
          hybridBardWikiTokenBudget: 800,
        }),
      ),
    ).toEqual({ hypaTokenBudget: 800, bardWikiTokenBudget: 200 })
    expect(
      resolveBardWikiMemoryBudgets(
        enabledSettings({
          memoryMode: 'hybrid',
          totalTokenBudget: 1_000,
          hybridHypaTokenBudget: 100,
          hybridBardWikiTokenBudget: 200,
        }),
      ),
    ).toEqual({ hypaTokenBudget: 100, bardWikiTokenBudget: 200 })
  })
})
