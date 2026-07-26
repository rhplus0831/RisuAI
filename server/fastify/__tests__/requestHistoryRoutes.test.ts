import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { beginRequestHistory, completeRequestHistory } from '../src/requestHistory.js'
import { setupAuthedClient } from './helpers/auth.js'

let app: FastifyInstance
let dataDir: string
let assertion: string

beforeEach(async () => {
  process.env.LOG_LEVEL = 'silent'
  dataDir = mkdtempSync(path.join(tmpdir(), 'risu-request-history-routes-'))
  ;({ app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      importMaxBytes: Infinity,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
    },
    memoryWorker: false,
    assetGc: false,
  }))
  ;({ assertion } = await setupAuthedClient(app))
  const initialized = await app.inject({
    method: 'POST',
    url: '/api/v1/commands/state/initialize',
    headers: { 'risu-auth': assertion },
    payload: {},
  })
  expect(initialized.statusCode).toBe(200)
})

afterEach(async () => {
  await app.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('request history routes', () => {
  it('lists private summaries, reads full detail, and deletes one record', async () => {
    const writer = new DatabaseSync(path.join(dataDir, 'risu.db'))
    try {
      const handle = beginRequestHistory({
        db: writer,
        limit: 20,
        id: 'history-a',
        startedAt: 100,
        source: 'chat',
        profile: {
          id: 'profile-a',
          name: 'Profile A',
          role: 'chatMain',
          sourceKind: 'durable-profile',
          provider: 'openai',
          modelId: 'gpt-4o',
          requestModel: 'gpt-4o',
        },
        prompt: [{ role: 'user', content: 'private prompt' }],
        context: { characterId: 'char-a', chatId: 'chat-a' },
        toggles: { lore: '1' },
      })
      completeRequestHistory(handle, { status: 'success', response: 'private response', completedAt: 200 })
    } finally {
      writer.close()
    }

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/request-history',
      headers: { 'risu-auth': assertion },
    })
    expect(listed.statusCode).toBe(200)
    expect(listed.headers['cache-control']).toBe('no-store')
    expect(listed.json()).toMatchObject({
      limit: 20,
      records: [{ id: 'history-a', responsePreview: 'private response' }],
    })
    expect(JSON.stringify(listed.json())).not.toContain('private prompt')

    const detail = await app.inject({
      method: 'GET',
      url: '/api/v1/request-history/history-a',
      headers: { 'risu-auth': assertion },
    })
    expect(detail.statusCode).toBe(200)
    expect(detail.json()).toMatchObject({
      record: {
        id: 'history-a',
        prompt: [{ role: 'user', content: 'private prompt' }],
        response: 'private response',
        toggles: { lore: '1' },
      },
    })

    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/v1/request-history/history-a',
      headers: { 'risu-auth': assertion },
    })
    expect(removed.statusCode).toBe(200)
    expect(removed.json()).toEqual({ id: 'history-a' })

    const missing = await app.inject({
      method: 'GET',
      url: '/api/v1/request-history/history-a',
      headers: { 'risu-auth': assertion },
    })
    expect(missing.statusCode).toBe(404)
  })

  it('persists the configured limit and prunes immediately when it is lowered', async () => {
    const writer = new DatabaseSync(path.join(dataDir, 'risu.db'))
    try {
      for (let index = 1; index <= 3; index += 1) {
        beginRequestHistory({
          db: writer,
          limit: 20,
          id: `history-${index}`,
          startedAt: index,
          source: 'completion',
          profile: {
            id: 'profile-a',
            role: 'otherAx',
            sourceKind: 'durable-profile',
            modelId: 'gpt-4o',
            requestModel: 'gpt-4o',
          },
          prompt: [{ role: 'user', content: String(index) }],
        })
      }
    } finally {
      writer.close()
    }

    const lowered = await app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/data',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 1, patch: { requestHistoryLimit: 1 } },
    })
    expect(lowered.statusCode).toBe(200)

    const one = await app.inject({
      method: 'GET',
      url: '/api/v1/request-history',
      headers: { 'risu-auth': assertion },
    })
    expect(one.json()).toMatchObject({ limit: 1, records: [{ id: 'history-3' }] })

    const disabled = await app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/data',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: 2, patch: { requestHistoryLimit: 0 } },
    })
    expect(disabled.statusCode).toBe(200)

    const empty = await app.inject({
      method: 'GET',
      url: '/api/v1/request-history',
      headers: { 'risu-auth': assertion },
    })
    expect(empty.json()).toEqual({ limit: 0, records: [] })
  })
})
