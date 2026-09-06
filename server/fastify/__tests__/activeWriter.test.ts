import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { ACTIVE_WRITER_SESSION_HEADER } from '../src/activeWriter.js'
import { buildApp } from '../src/app.js'
import { setupAuthedClient } from './helpers/auth.js'

interface Harness {
  app: FastifyInstance
  dataDir: string
}

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-active-writer-'))
  return { app: await buildHarnessApp(dataDir), dataDir }
}

async function buildHarnessApp(dataDir: string): Promise<FastifyInstance> {
  const { app } = await buildApp({
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
  })
  return app
}

async function stopHarness(h: Harness): Promise<void> {
  await h.app.close()
  rmSync(h.dataDir, { recursive: true, force: true })
}

async function bootstrapSession(app: FastifyInstance, sessionId: string): Promise<void> {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/bootstrap',
    headers: { 'risu-auth': assertion, [ACTIVE_WRITER_SESSION_HEADER]: sessionId },
  })
  expect(res.statusCode).toBe(200)
}

function authedHeaders(sessionId?: string): Record<string, string> {
  return {
    'risu-auth': assertion,
    ...(sessionId ? { [ACTIVE_WRITER_SESSION_HEADER]: sessionId } : {}),
  }
}

function expectStaleWriter(res: { statusCode: number; json: () => unknown }): void {
  expect(res.statusCode).toBe(423)
  expect(res.json()).toMatchObject({ error: 'active_writer_stale' })
}

let harness: Harness
let assertion: string

beforeEach(async () => {
  harness = await startHarness()
  ;({ assertion } = await setupAuthedClient(harness.app))
})

afterEach(async () => {
  await stopHarness(harness)
})

describe('active writer session guard', () => {
  it('persists writer ownership and epochs across a server restart', async () => {
    const writerA = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: authedHeaders('session-a'),
    })
    expect(writerA.statusCode).toBe(200)
    expect(writerA.json()).toMatchObject({ requestedWriterWasActive: true, writerEpoch: 1 })

    const writerB = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: authedHeaders('session-b'),
    })
    expect(writerB.statusCode).toBe(200)
    expect(writerB.json()).toMatchObject({ requestedWriterWasActive: false, writerEpoch: 2 })

    await harness.app.close()
    harness.app = await buildHarnessApp(harness.dataDir)

    const staleBeforeBootstrap = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: authedHeaders('session-a'),
      payload: { database: { shouldNotPersist: true } },
    })
    expectStaleWriter(staleBeforeBootstrap)

    const returningWriterA = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: authedHeaders('session-a'),
    })
    expect(returningWriterA.statusCode).toBe(200)
    expect(returningWriterA.json()).toMatchObject({ requestedWriterWasActive: false, writerEpoch: 3 })

    const passive = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: authedHeaders(),
    })
    expect(passive.statusCode).toBe(200)
    expect(passive.json()).toMatchObject({ writerEpoch: 3 })
    expect(passive.json()).not.toHaveProperty('requestedWriterWasActive')
  })

  it('lets the most recently bootstrapped session mutate and rejects stale command writers', async () => {
    await bootstrapSession(harness.app, 'session-a')
    await bootstrapSession(harness.app, 'session-b')
    const imported = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: authedHeaders('session-b'),
      payload: { database: { streamGeminiThoughts: false } },
    })
    expect(imported.statusCode).toBe(200)

    const stale = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: authedHeaders('session-a'),
      payload: { baseRevision: 1, patch: { streamGeminiThoughts: true } },
    })
    expectStaleWriter(stale)

    const active = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: authedHeaders('session-b'),
      payload: { baseRevision: 1, patch: { streamGeminiThoughts: true } },
    })
    expect(active.statusCode).toBe(200)
    expect(active.json().revision).toBe(2)
  })

  it('does not let passive bootstrap reads reclaim active-writer ownership', async () => {
    await bootstrapSession(harness.app, 'session-a')
    await bootstrapSession(harness.app, 'session-b')

    const imported = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: authedHeaders('session-b'),
      payload: { database: { streamGeminiThoughts: false } },
    })
    expect(imported.statusCode).toBe(200)

    const passiveRefresh = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: authedHeaders(),
    })
    expect(passiveRefresh.statusCode).toBe(200)

    const staleAfterPassiveRefresh = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: authedHeaders('session-a'),
      payload: { baseRevision: 1, patch: { streamGeminiThoughts: true } },
    })
    expectStaleWriter(staleAfterPassiveRefresh)
  })

  it('rejects stale writers on import, asset upload, backups, and legacy storage writes', async () => {
    await bootstrapSession(harness.app, 'session-a')
    await bootstrapSession(harness.app, 'session-b')

    expectStaleWriter(
      await harness.app.inject({
        method: 'POST',
        url: '/api/v1/import/risusave',
        headers: authedHeaders('session-a'),
        payload: { database: { greeting: 'stale' } },
      }),
    )

    expectStaleWriter(
      await harness.app.inject({
        method: 'POST',
        url: '/api/v1/import/realm-character',
        headers: authedHeaders('session-a'),
        payload: { id: 'realm-id', baseRevision: 0 },
      }),
    )

    expectStaleWriter(
      await harness.app.inject({
        method: 'POST',
        url: '/api/v1/assets',
        headers: {
          'risu-auth': assertion,
          [ACTIVE_WRITER_SESSION_HEADER]: 'session-a',
          'content-type': 'image/png',
        },
        payload: Buffer.from('stale-asset'),
      }),
    )

    expectStaleWriter(
      await harness.app.inject({
        method: 'POST',
        url: '/api/v1/assets/bulk',
        headers: authedHeaders('session-a'),
        payload: {
          assets: [{ contentType: 'image/png', data: Buffer.from('stale-asset').toString('base64') }],
        },
      }),
    )

    expectStaleWriter(
      await harness.app.inject({
        method: 'POST',
        url: '/api/v1/backups',
        headers: authedHeaders('session-a'),
        payload: { label: 'stale backup' },
      }),
    )

    expectStaleWriter(
      await harness.app.inject({
        method: 'POST',
        url: '/api/v1/storage/write',
        headers: {
          'risu-auth': assertion,
          [ACTIVE_WRITER_SESSION_HEADER]: 'session-a',
          'content-type': 'application/octet-stream',
          'file-path': Buffer.from('legacy-key').toString('hex'),
        },
        payload: Buffer.from('stale legacy bytes'),
      }),
    )

    const activeBootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: authedHeaders('session-b'),
    })
    expect(activeBootstrap.statusCode).toBe(200)
    expect(activeBootstrap.json()).toMatchObject({ initialized: false, revision: 0 })

    const staleAssetId = createHash('sha256').update('stale-asset').digest('hex')
    expect(existsSync(path.join(harness.dataDir, 'assets', `${staleAssetId}.png`))).toBe(false)
    expect(existsSync(path.join(harness.dataDir, 'save', Buffer.from('legacy-key').toString('hex')))).toBe(false)
    const backups = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/backups',
      headers: authedHeaders('session-b'),
    })
    expect(backups.statusCode).toBe(200)
    expect(backups.json()).toEqual({ backups: [] })
  })

  it('rejects stale restore/delete backup and legacy storage remove mutations', async () => {
    await bootstrapSession(harness.app, 'session-a')
    await bootstrapSession(harness.app, 'session-b')

    const backup = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: authedHeaders('session-b'),
      payload: { label: 'active backup' },
    })
    expect(backup.statusCode).toBe(201)
    const backupId = backup.json().id as string

    expectStaleWriter(
      await harness.app.inject({
        method: 'POST',
        url: `/api/v1/backups/${encodeURIComponent(backupId)}/restore`,
        headers: authedHeaders('session-a'),
      }),
    )

    expectStaleWriter(
      await harness.app.inject({
        method: 'DELETE',
        url: `/api/v1/backups/${encodeURIComponent(backupId)}`,
        headers: authedHeaders('session-a'),
      }),
    )

    expectStaleWriter(
      await harness.app.inject({
        method: 'POST',
        url: '/api/v1/storage/remove',
        headers: {
          'risu-auth': assertion,
          [ACTIVE_WRITER_SESSION_HEADER]: 'session-a',
          'file-path': Buffer.from('legacy-key').toString('hex'),
        },
      }),
    )
  })

  it('rejects stale memory job create and cancel mutations while keeping list reads open', async () => {
    await bootstrapSession(harness.app, 'session-a')
    await bootstrapSession(harness.app, 'session-b')

    expectStaleWriter(
      await harness.app.inject({
        method: 'POST',
        url: '/api/v1/memory/jobs',
        headers: authedHeaders('session-a'),
        payload: {
          chatId: 'chat-1',
          kind: 'summarize',
          payload: { chunkId: 'chunk-1', model: 'model-a' },
        },
      }),
    )

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/memory/jobs',
      headers: authedHeaders('session-b'),
      payload: {
        chatId: 'chat-1',
        kind: 'summarize',
        payload: { chunkId: 'chunk-1', model: 'model-a' },
      },
    })
    expect(created.statusCode).toBe(201)
    const jobId = created.json().job.id as string

    const listed = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/jobs?chatId=chat-1',
      headers: authedHeaders('session-a'),
    })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().jobs).toHaveLength(1)

    expectStaleWriter(
      await harness.app.inject({
        method: 'DELETE',
        url: `/api/v1/memory/jobs/${encodeURIComponent(jobId)}`,
        headers: authedHeaders('session-a'),
      }),
    )

    const cancelled = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/memory/jobs/${encodeURIComponent(jobId)}`,
      headers: authedHeaders('session-b'),
    })
    expect(cancelled.statusCode).toBe(200)
    expect(cancelled.json().job.status).toBe('cancelled')
  })

  it('rejects stale generation-time memory planning entrypoints', async () => {
    await bootstrapSession(harness.app, 'session-a')
    await bootstrapSession(harness.app, 'session-b')

    expectStaleWriter(
      await harness.app.inject({
        method: 'POST',
        url: '/api/v1/generate/chat',
        headers: authedHeaders('session-a'),
        payload: {
          chatId: 'chat-1',
          characterId: 'char-1',
          mode: 'preview_prompt',
        },
      }),
    )

    expectStaleWriter(
      await harness.app.inject({
        method: 'POST',
        url: '/api/v1/generate/preview-prompt',
        headers: authedHeaders('session-a'),
        payload: {
          chatId: 'chat-1',
          characterId: 'char-1',
        },
      }),
    )

    const activeBootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: authedHeaders('session-b'),
    })
    expect(activeBootstrap.statusCode).toBe(200)
    expect(activeBootstrap.json()).toMatchObject({
      activeGenerationJobs: [],
      generationOperations: [],
    })
  })

  it('keeps streaming observe and public asset exceptions outside the writer gate', async () => {
    await bootstrapSession(harness.app, 'session-a')
    await bootstrapSession(harness.app, 'session-b')

    expectStaleWriter(
      await harness.app.inject({
        method: 'DELETE',
        url: '/api/v1/generate/chat/job-1',
        headers: authedHeaders('session-a'),
      }),
    )

    const reattach = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/generate/chat/job-1/stream',
      headers: authedHeaders('session-a'),
    })
    expect(reattach.statusCode).toBe(404)

    const eventCursorError = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/events?sinceRevision=not-a-number',
      headers: authedHeaders('session-a'),
    })
    expect(eventCursorError.statusCode).toBe(400)

    const exists = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets/exists',
      headers: authedHeaders('session-a'),
      payload: { ids: [] },
    })
    expect(exists.statusCode).toBe(200)
  })
})
