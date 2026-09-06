import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { openDatabase, getSchemaState } from '../src/db.js'
import { applyImport, loadPersistedForGenerationAssembly } from '../src/repository.js'
import { normalizeRisuSaveSnapshotDatabase } from '../src/risuSave/importSnapshot.js'
import { setupAuthedClient } from './helpers/auth.js'

let app: FastifyInstance
let dataDir: string
beforeEach(async () => {
  process.env.LOG_LEVEL = 'silent'
  dataDir = mkdtempSync(path.join(tmpdir(), 'risu-lore-tokens-'))
  ;({ app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 8 * 1024 * 1024,
      importMaxBytes: Infinity,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
    },
    memoryWorker: false,
    assetGc: false,
  }))
})
afterEach(async () => {
  await app.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('read-only lore token route', () => {
  it('requires authentication', async () => {
    await setupAuthedClient(app)
    expect((await app.inject({ url: '/api/v1/chats/chat-1/lore-token-counts?characterId=char-1' })).statusCode).toBe(
      401,
    )
  })

  it('uses complete persisted history and preserves state and revision over repeated reads', async () => {
    const { assertion } = await setupAuthedClient(app)
    const db = openDatabase(dataDir)
    const message = Array.from({ length: 40 }, (_, index) => ({
      chatId: `message-${index}`,
      role: 'user',
      data: index === 0 ? 'old-key' : 'recent',
    }))
    await applyImport(
      db,
      dataDir,
      normalizeRisuSaveSnapshotDatabase({
        currentChar: 0,
        aiModel: 'gpt35',
        personas: [{ id: 'persona', name: 'User', personaPrompt: '' }],
        modelPresets: [{ id: 'model', name: 'Model', aiModel: 'gpt35' }],
        promptPresets: [{ id: 'prompt', name: 'Prompt' }],
        characters: [
          {
            type: 'character',
            chaId: 'char-1',
            name: 'Tess',
            chatPage: 0,
            loreSettings: { scanDepth: 50, tokenBudget: 800, recursiveScanning: true },
            globalLore: [
              {
                id: 'once',
                key: 'old-key',
                content: '@@dont_activate_after_match\nhello',
                comment: 'Once',
                insertorder: 100,
                mode: 'normal',
                alwaysActive: false,
              },
            ],
            chats: [
              {
                generationSettings: {
                  configured: true,
                  personaId: 'persona',
                  modelPresetId: 'model',
                  promptPresetId: 'prompt',
                  jailbreakToggle: false,
                },
                id: 'chat-1',
                name: 'Chat',
                note: '',
                localLore: [],
                scriptstate: {},
                message,
              },
            ],
          },
        ],
      }),
    )
    const before = loadPersistedForGenerationAssembly(db, dataDir, { characterId: 'char-1', chatId: 'chat-1' })
    const revision = getSchemaState(db).revision
    const request = {
      url: '/api/v1/chats/chat-1/lore-token-counts?characterId=char-1',
      headers: { 'risu-auth': assertion },
    }
    const first = await app.inject(request)
    expect(first.statusCode, first.body).toBe(200)
    expect(first.json()).toMatchObject({
      characterId: 'char-1',
      chatId: 'chat-1',
      character: 1,
      module: 0,
      chat: 0,
      hasRandomActivation: false,
    })
    expect((await app.inject(request)).json()).toEqual(first.json())
    expect(getSchemaState(db).revision).toBe(revision)
    expect(loadPersistedForGenerationAssembly(db, dataDir, { characterId: 'char-1', chatId: 'chat-1' })).toEqual(before)
    expect(
      (await app.inject({ ...request, url: '/api/v1/chats/missing/lore-token-counts?characterId=char-1' })).statusCode,
    ).toBe(404)
    db.close()
  })
})
