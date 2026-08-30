import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { jsonPayloadBytes } from '../src/protocolMetrics.js'
import { setupAuthedClient } from './helpers/auth.js'
import { buildLargeCorpusFixture } from '../../../src/ts/__tests__/largeCorpusFixture.js'
import { isServerCharactersSummaryPayload } from '@risuai/protocol/character-summary-resource'
import { isServerShellPayload } from '@risuai/protocol/shell-resource'

interface Harness {
  app: FastifyInstance
  dataDir: string
}

interface PayloadMetric {
  metric: string
  resource?: string
  revision?: number
  payloadBytes?: number | null
  durationMs?: number
  requestUid?: string
  cacheHits?: number
  cacheMisses?: number
}

const capturedMetrics = vi.hoisted((): PayloadMetric[] => [])

vi.mock('../src/protocolMetrics.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/protocolMetrics.js')>()
  return {
    ...actual,
    emitProtocolMetric: (name: string, fields: Record<string, unknown> | (() => Record<string, unknown>)) => {
      if (!actual.protocolMetricsEnabled()) return
      capturedMetrics.push({
        metric: name,
        ...(typeof fields === 'function' ? fields() : fields),
      } as PayloadMetric)
    },
  }
})

const PREVIOUS_PROTOCOL_METRICS = process.env.RISU_PROTOCOL_METRICS

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
      requestTrace: { mode: 'agent' },
    },
    assetGc: false,
    memoryWorker: false,
  })
  return { app, dataDir }
}

let harness: Harness
let assertion: string

beforeEach(async () => {
  process.env.RISU_PROTOCOL_METRICS = '1'
  capturedMetrics.length = 0
  harness = await startHarness()
  ;({ assertion } = await setupAuthedClient(harness.app))
})

afterEach(async () => {
  if (PREVIOUS_PROTOCOL_METRICS === undefined) {
    delete process.env.RISU_PROTOCOL_METRICS
  } else {
    process.env.RISU_PROTOCOL_METRICS = PREVIOUS_PROTOCOL_METRICS
  }
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

function latestMetric(name: string, resource?: string): PayloadMetric {
  const metric = [...capturedMetrics]
    .reverse()
    .find((entry) => entry.metric === name && (resource === undefined || entry.resource === resource))
  expect(metric, `missing ${name}${resource ? `/${resource}` : ''} payload metric`).toBeTruthy()
  return metric as PayloadMetric
}

describe('bootstrap and resource payload budgets', () => {
  it('emits bootstrap and resource payload metrics for message-light responses', async () => {
    const revision = await importDatabase(messageHeavyDatabase())
    capturedMetrics.length = 0

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
    expect(isServerCharactersSummaryPayload(charactersBody)).toBe(true)
    expect(charactersBody.characters[0]).toMatchObject({
      chatCount: 1,
      activeChatId: 'chat-a',
      chatIds: ['chat-a'],
    })
    expect(charactersBody.characters[0]).not.toHaveProperty('chats')

    const shell = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/resources/shell',
      headers: { 'risu-auth': assertion },
    })
    expect(shell.statusCode).toBe(200)
    const shellBody = shell.json()
    expect(isServerShellPayload(shellBody)).toBe(true)

    const cachedCharacters = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/characters',
      headers: { 'risu-auth': assertion, 'content-type': 'application/json' },
      payload: { cache: { version: 2, hashes: { characters: [] } } },
    })
    expect(cachedCharacters.statusCode).toBe(200)
    const cachedCharactersBody = cachedCharacters.json()

    const hydration = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/chats/chat-a/messages',
      headers: { 'risu-auth': assertion },
    })
    expect(hydration.statusCode).toBe(200)
    const hydrationBody = hydration.json()
    expect(hydrationBody.message).toHaveLength(80)

    const bootstrapMetric = latestMetric('bootstrap_projection')
    const shellMetric = latestMetric('resource_response', 'shell')
    const charactersMetric = latestMetric('resource_response', 'characters')
    const hydrationMetric = latestMetric('resource_response', 'chatMessages')

    expect(bootstrapMetric.payloadBytes).toBe(jsonPayloadBytes(bootstrapBody))
    expect(shellMetric.payloadBytes).toBe(jsonPayloadBytes(shellBody))
    expect(charactersMetric.payloadBytes).toBe(jsonPayloadBytes(cachedCharactersBody))
    expect(hydrationMetric.payloadBytes).toBe(jsonPayloadBytes(hydrationBody))
    expect(bootstrapMetric.durationMs).toBeGreaterThanOrEqual(0)
    expect(charactersMetric.durationMs).toBeGreaterThanOrEqual(0)
    expect(hydrationMetric.durationMs).toBeGreaterThanOrEqual(0)
    expect(bootstrapMetric.requestUid).toBe(bootstrap.headers['x-request-uid'])
    expect(charactersMetric.requestUid).toBe(cachedCharacters.headers['x-request-uid'])
    expect(hydrationMetric.requestUid).toBe(hydration.headers['x-request-uid'])
    expect(charactersMetric).toMatchObject({ cacheHits: 0, cacheMisses: 1 })
    expect(bootstrapMetric.payloadBytes).toBeLessThan(hydrationMetric.payloadBytes!)
    expect(shellMetric.payloadBytes).toBeLessThan(hydrationMetric.payloadBytes!)
    expect(charactersMetric.payloadBytes).toBeLessThan(hydrationMetric.payloadBytes!)
    expect(JSON.stringify(capturedMetrics)).not.toContain('char-a')
    expect(JSON.stringify(capturedMetrics)).not.toContain('chat-a')
    expect(JSON.stringify(capturedMetrics)).not.toContain('Large message')
  })

  it('keeps the large-corpus summary at least 80% smaller than the legacy aggregate', async () => {
    await importDatabase(buildLargeCorpusFixture().database)
    capturedMetrics.length = 0

    const legacyCharacters = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/characters/aggregate',
      headers: { 'risu-auth': assertion },
    })
    expect(legacyCharacters.statusCode).toBe(200)

    const characters = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/characters',
      headers: { 'risu-auth': assertion },
    })

    expect(characters.statusCode).toBe(200)
    expect(isServerCharactersSummaryPayload(characters.json())).toBe(true)
    const summaryPayloadBytes = jsonPayloadBytes(characters.json())!
    const legacyPayloadBytes = jsonPayloadBytes(legacyCharacters.json())!
    expect(latestMetric('resource_response', 'characters').payloadBytes).toBe(summaryPayloadBytes)
    expect(summaryPayloadBytes).toBeLessThanOrEqual(legacyPayloadBytes * 0.2)
  })
})
