import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
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
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
    },
    memoryWorker: false,
  })
  return { app, dataDir }
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
  it('lets the most recently bootstrapped session mutate and rejects stale command writers', async () => {
    await bootstrapSession(harness.app, 'session-a')
    await bootstrapSession(harness.app, 'session-b')
    const imported = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/risusave',
      headers: authedHeaders('session-b'),
      payload: { database: { useServerPromptAssembly: false } },
    })
    expect(imported.statusCode).toBe(200)

    const stale = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: authedHeaders('session-a'),
      payload: { baseRevision: 1, patch: { useServerPromptAssembly: true } },
    })
    expectStaleWriter(stale)

    const active = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: authedHeaders('session-b'),
      payload: { baseRevision: 1, patch: { useServerPromptAssembly: true } },
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
      payload: { database: { useServerPromptAssembly: false } },
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
      payload: { baseRevision: 1, patch: { useServerPromptAssembly: true } },
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
          assets: [
            { contentType: 'image/png', data: Buffer.from('stale-asset').toString('base64') },
          ],
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
  })
})
