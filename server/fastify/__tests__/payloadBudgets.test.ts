import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { jsonPayloadBytes } from '../src/protocolMetrics.js'
import { setupAuthedClient } from './helpers/auth.js'

interface Harness {
  app: FastifyInstance
  dataDir: string
}

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-payload-budgets-'))
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

let harness: Harness
let assertion: string

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

function messageHeavyDatabase(): Record<string, unknown> {
  return {
    currentChar: 0,
    characterOrder: ['char-a'],
    characters: [
      {
        chaId: 'char-a',
        name: 'Ada',
        chats: [
          {
            id: 'chat-a',
            name: 'Chat A',
            note: '',
            localLore: [],
            message: Array.from({ length: 80 }, (_, index) => ({
              role: index % 2 === 0 ? 'user' : 'char',
              data: `Large message ${index} `.repeat(30),
              chatId: `msg-${index}`,
            })),
            hypaV3Data: { mainChunks: [{ text: 'summary'.repeat(30) }] },
          },
        ],
      },
    ],
  }
}

describe('Phase 8 payload budgets', () => {
  it('keeps bootstrap and character reads message-light', async () => {
    const revision = await importDatabase(messageHeavyDatabase())

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.statusCode).toBe(200)
    const bootstrapBody = bootstrap.json()
    expect(bootstrapBody.revision).toBe(revision)

    const characters = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/characters',
      headers: { 'risu-auth': assertion },
    })
    expect(characters.statusCode).toBe(200)
    const charactersBody = characters.json()
    const characterChat = charactersBody.characters[0].chats[0]
    expect(characterChat.message).toEqual([])
    expect(characterChat.hypaV3Data).toBeUndefined()

    const hydration = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/chats/chat-a/messages',
      headers: { 'risu-auth': assertion },
    })
    expect(hydration.statusCode).toBe(200)
    const hydrationBody = hydration.json()
    expect(hydrationBody.message).toHaveLength(80)

    expect(jsonPayloadBytes(bootstrapBody)!).toBeLessThan(jsonPayloadBytes(hydrationBody)!)
    expect(jsonPayloadBytes(charactersBody)!).toBeLessThan(jsonPayloadBytes(hydrationBody)!)
  })
})
