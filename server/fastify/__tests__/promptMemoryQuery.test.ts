import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDatabase } from '../src/db.js'
import { createMemoryChunk, createMemoryEmbedding, createMemorySummary } from '../src/memoryRepository.js'
import {
  buildPromptMemoryQueryTexts,
  prefetchPromptMemoryQueryVectors,
  type PromptMemoryQueryDatabase,
  type PromptMemoryQueryMessage,
} from '../src/promptMemoryQuery.js'

const dataDirs: string[] = []

afterEach(() => {
  for (const dataDir of dataDirs.splice(0)) rmSync(dataDir, { recursive: true, force: true })
})

function database(messages: PromptMemoryQueryMessage[]): PromptMemoryQueryDatabase {
  return {
    characters: [
      {
        chaId: 'character-a',
        chats: [{ id: 'chat-a', message: messages }],
      },
    ],
  }
}

const source = {
  chatId: 'chat-a',
  characterId: 'character-a',
  mode: 'send' as const,
}

describe('prompt memory query text projection', () => {
  it('uses normalized defaults for an invalid preset pointer instead of stale flat settings', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-prompt-memory-query-'))
    dataDirs.push(dataDir)
    const db = openDatabase(dataDir)
    try {
      createMemoryChunk(db, {
        id: 'chunk-a',
        chatId: 'chat-a',
        messageId: 'message-a',
        rangeStartSeq: 0,
        rangeEndSeq: 0,
        text: 'hello',
      })
      createMemorySummary(db, {
        id: 'summary-a',
        chatId: 'chat-a',
        chunkId: 'chunk-a',
        model: 'subModel',
        text: 'summary',
        metadata: {},
        tokens: 1,
      })
      createMemoryEmbedding(db, {
        id: 'embedding-a',
        chatId: 'chat-a',
        chunkId: 'chunk-a',
        model: 'custom',
        vector: [1, 0],
      })
      const databaseWithConflictingLegacySettings = {
        ...database([{ role: 'user', data: 'hello' }]),
        hypaV3: true,
        hypaV3PresetId: 99,
        hypaV3Presets: [{ settings: { summarizationModel: 'subModel', similarMemoryRatio: 1, queryChatCount: 1 } }],
        hypaV3Settings: { similarMemoryRatio: 0, queryChatCount: 0 },
        hypaModel: 'custom',
        hypaCustomSettings: { url: 'https://example.test/v1', model: 'embed-model', key: 'secret' },
      } as PromptMemoryQueryDatabase & { hypaV3Settings: unknown }
      databaseWithConflictingLegacySettings.characters[0].supaMemory = true

      const embed = async ({ input }: { input: readonly string[] }) => ({
        model: 'custom',
        vectors: input.map(() => new Float32Array([1, 0])),
        dim: 2,
      })
      const result = await prefetchPromptMemoryQueryVectors({
        db,
        database: databaseWithConflictingLegacySettings,
        input: { ...source, userMessage: 'pending' },
        embed,
      })

      expect(result.diagnostics).toMatchObject({ status: 'success', error: null })
      expect(result.diagnostics.queryTexts).toBe(2)
      expect(result.vectors).toHaveLength(2)
    } finally {
      db.close()
    }
  })

  it('deduplicates an appended send and includes a distinct pending user message', () => {
    const messages: PromptMemoryQueryMessage[] = [
      { role: 'char', data: 'answer' },
      { role: 'user', data: 'already appended' },
    ]

    expect(buildPromptMemoryQueryTexts(database(messages), { ...source, userMessage: 'already appended' }, 0)).toEqual([
      'answer',
      'already appended',
    ])
    expect(buildPromptMemoryQueryTexts(database(messages), { ...source, userMessage: 'pending input' }, 0)).toEqual([
      'answer',
      'already appended',
      'pending input',
    ])
  })

  it('trims a regenerate tail before filtering reset, disabled, empty, and count-limited rows', () => {
    const messages: PromptMemoryQueryMessage[] = [
      { role: 'user', data: 'before reset' },
      { role: 'char', data: 'reset marker', disabled: 'allBefore' },
      { role: 'user', data: 'disabled', disabled: true },
      { role: 'user', data: 'recent user' },
      { role: 'char', data: 'kept alternate', chatId: 'alternate-1', saying: 'Tess' },
      { role: 'char', data: 'other speaker', chatId: 'alternate-2', saying: 'Other' },
      { role: 'char', data: 'regenerate target', chatId: 'target', saying: 'Tess' },
      { role: 'user', data: '   ' },
    ]

    expect(
      buildPromptMemoryQueryTexts(
        database(messages.slice(0, -1)),
        { chatId: 'chat-a', characterId: 'character-a', mode: 'regenerate', regenerateMessageId: 'target' },
        2,
      ),
    ).toEqual(['recent user', 'kept alternate'])

    expect(buildPromptMemoryQueryTexts(database(messages), source, 2)).toEqual(['regenerate target'])
  })

  it('returns no queries for an unknown chat', () => {
    expect(buildPromptMemoryQueryTexts(database([]), { ...source, chatId: 'missing' }, 0)).toEqual([])
  })
})
