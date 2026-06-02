import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

interface PayloadMetric {
  metric: string
  resource?: string
  revision?: number
  payloadBytes?: number | null
}

const capturedMetrics = vi.hoisted((): PayloadMetric[] => [])

vi.mock('../src/protocolMetrics.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/protocolMetrics.js')>()
  return {
    ...actual,
    emitProtocolMetric: (name: string, fields: Record<string, unknown>) => {
      if (!actual.protocolMetricsEnabled()) return
      capturedMetrics.push({ metric: name, ...fields } as PayloadMetric)
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
    .find(
      (entry) => entry.metric === name && (resource === undefined || entry.resource === resource),
    )
  expect(metric, `missing ${name}${resource ? `/${resource}` : ''} payload metric`).toBeTruthy()
  return metric as PayloadMetric
}

describe('Phase 8 payload budgets', () => {
  it('emits bootstrap and projection payload metrics for message-light responses', async () => {
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
    const bootstrapChat = bootstrapBody.database.characters[0].chats[0]
    expect(bootstrapChat.message).toEqual([])
    expect(bootstrapChat.hypaV3Data).toBeUndefined()

    const projection = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/projection/character',
      headers: { 'risu-auth': assertion },
    })
    expect(projection.statusCode).toBe(200)
    const projectionBody = projection.json()
    expect(projectionBody.mode).toBe('fields')
    const projectionChat = projectionBody.fields.characters[0].chats[0]
    expect(projectionChat.message).toEqual([])
    expect(projectionChat.hypaV3Data).toBeUndefined()

    const hydration = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/projection/chatMessages?id=chat-a',
      headers: { 'risu-auth': assertion },
    })
    expect(hydration.statusCode).toBe(200)
    const hydrationBody = hydration.json()
    expect(hydrationBody.mode).toBe('chat-messages')
    expect(hydrationBody.message).toHaveLength(80)

    const bootstrapMetric = latestMetric('bootstrap_projection')
    const characterProjectionMetric = latestMetric('projection_response', 'character')
    const hydrationMetric = latestMetric('projection_response', 'chatMessages')

    expect(bootstrapMetric.payloadBytes).toBe(jsonPayloadBytes(bootstrapBody))
    expect(characterProjectionMetric.payloadBytes).toBe(jsonPayloadBytes(projectionBody))
    expect(hydrationMetric.payloadBytes).toBe(jsonPayloadBytes(hydrationBody))
    expect(bootstrapMetric.payloadBytes).toBeLessThan(hydrationMetric.payloadBytes!)
    expect(characterProjectionMetric.payloadBytes).toBeLessThan(hydrationMetric.payloadBytes!)
  })
})
