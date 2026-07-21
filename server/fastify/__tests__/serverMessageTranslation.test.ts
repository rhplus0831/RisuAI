import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCommandEventSink } from '../src/commands/events.js'
import { openDatabase } from '../src/db.js'
import { resolveActiveMessageLocationById } from '../src/messageStore.js'
import { writePersistedWithMessages } from '../src/repository.js'

const serverTranslationMocks = vi.hoisted(() => ({
  dispatchChatProvider: vi.fn(),
}))

vi.mock('../src/prompt/chatDispatch.js', () => ({
  dispatchChatProvider: serverTranslationMocks.dispatchChatProvider,
}))

import { runServerMessageTranslation } from '../src/translation/serverMessageTranslation.js'

function textFrames(text: string) {
  return (async function* () {
    yield { kind: 'token' as const, content: text }
  })()
}

let dataDir: string
let db: DatabaseSync

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'risu-server-message-translation-'))
  db = openDatabase(dataDir)
})

afterEach(() => {
  serverTranslationMocks.dispatchChatProvider.mockReset()
  db.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('runServerMessageTranslation', () => {
  it('hydrates a persisted multi-step preset and stores the final chained LLM output', async () => {
    writePersistedWithMessages(db, dataDir, {
      _version: 1,
      database: {
        translator: 'ko',
        translatorInputLanguage: 'en',
        translatorType: 'llm',
        translatorSendTextAsIs: true,
        aiModel: 'echo_model',
        translatorPresetId: 0,
        // Real persistence keeps these legacy scalars synced to step one.
        translatorPrompt: 'Draft {{slot::content}}',
        translatorMaxResponse: 111,
        translatorPresets: [
          {
            id: 'pipeline',
            name: 'Pipeline',
            prompt: 'Draft {{slot::content}}',
            maxResponse: 111,
            steps: [
              {
                id: 'draft',
                name: 'Draft',
                enabled: true,
                prompt: 'Draft {{slot::content}}',
                maxResponse: 111,
                model: { mode: 'inheritTranslate' },
              },
              {
                id: 'polish',
                name: 'Polish',
                enabled: true,
                prompt: 'Polish the previous translation',
                maxResponse: 222,
                model: { mode: 'inheritTranslate' },
              },
            ],
          },
        ],
        characters: [
          {
            chaId: 'char-a',
            name: 'A',
            chats: [
              {
                id: 'chat-a',
                name: 'Chat',
                note: '',
                localLore: [],
                message: [{ role: 'user', data: 'original source', chatId: 'message-a' }],
              },
            ],
            chatPage: 0,
            chatFolders: [],
          },
        ],
        characterOrder: ['char-a'],
      },
      assets: [],
    })

    const settingsRow = db.prepare('SELECT data_json FROM settings WHERE id = 1').get() as { data_json: string }
    expect(JSON.parse(settingsRow.data_json)).not.toHaveProperty('translatorPresets')
    expect(db.prepare('SELECT COUNT(*) AS count FROM translator_presets').get()).toEqual({ count: 1 })

    serverTranslationMocks.dispatchChatProvider
      .mockImplementationOnce(async () => textFrames('draft output'))
      .mockImplementationOnce(async () => textFrames('final output'))

    const result = await runServerMessageTranslation({
      db,
      dataDir,
      eventSink: createCommandEventSink(),
      messageId: 'message-a',
    })

    expect(serverTranslationMocks.dispatchChatProvider).toHaveBeenCalledTimes(2)
    expect(serverTranslationMocks.dispatchChatProvider.mock.calls[0][0]).toMatchObject({
      outputTokens: 111,
      formated: [{ role: 'system', content: 'Draft original source' }],
    })
    expect(serverTranslationMocks.dispatchChatProvider.mock.calls[1][0]).toMatchObject({
      outputTokens: 222,
      formated: [
        { role: 'system', content: 'Polish the previous translation' },
        { role: 'user', content: 'draft output' },
      ],
    })
    expect(result.translation.text).toBe('final output')

    const persisted = resolveActiveMessageLocationById(db, 'message-a')
    expect(persisted.ok).toBe(true)
    if (persisted.ok) {
      expect(persisted.location.message.translation).toMatchObject({
        text: 'final output',
        source: 'raw',
        translatorType: 'llm',
      })
    }
  })
})
