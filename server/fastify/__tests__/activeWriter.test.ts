import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { ACTIVE_WRITER_SESSION_HEADER } from '../src/activeWriter.js'
import { buildApp } from '../src/app.js'

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
    headers: { [ACTIVE_WRITER_SESSION_HEADER]: sessionId },
  })
  expect(res.statusCode).toBe(200)
}

function expectStaleWriter(res: { statusCode: number; json: () => unknown }): void {
  expect(res.statusCode).toBe(423)
  expect(res.json()).toMatchObject({ error: 'active_writer_stale' })
}

let harness: Harness

beforeEach(async () => {
  harness = await startHarness()
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
      headers: { [ACTIVE_WRITER_SESSION_HEADER]: 'session-b' },
      payload: { database: { useServerPromptAssembly: false } },
    })
    expect(imported.statusCode).toBe(200)

    const stale = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: { [ACTIVE_WRITER_SESSION_HEADER]: 'session-a' },
      payload: { baseRevision: 1, patch: { useServerPromptAssembly: true } },
    })
    expectStaleWriter(stale)

    const active = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: { [ACTIVE_WRITER_SESSION_HEADER]: 'session-b' },
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
      headers: { [ACTIVE_WRITER_SESSION_HEADER]: 'session-b' },
      payload: { database: { useServerPromptAssembly: false } },
    })
    expect(imported.statusCode).toBe(200)

    const passiveRefresh = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
    })
    expect(passiveRefresh.statusCode).toBe(200)

    const staleAfterPassiveRefresh = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      headers: { [ACTIVE_WRITER_SESSION_HEADER]: 'session-a' },
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
        headers: { [ACTIVE_WRITER_SESSION_HEADER]: 'session-a' },
        payload: { database: { greeting: 'stale' } },
      }),
    )

    expectStaleWriter(
      await harness.app.inject({
        method: 'POST',
        url: '/api/v1/import/realm-character',
        headers: { [ACTIVE_WRITER_SESSION_HEADER]: 'session-a' },
        payload: { id: 'realm-id', baseRevision: 0 },
      }),
    )

    expectStaleWriter(
      await harness.app.inject({
        method: 'POST',
        url: '/api/v1/assets',
        headers: {
          [ACTIVE_WRITER_SESSION_HEADER]: 'session-a',
          'content-type': 'image/png',
        },
        payload: Buffer.from('stale-asset'),
      }),
    )

    expectStaleWriter(
      await harness.app.inject({
        method: 'POST',
        url: '/api/v1/backups',
        headers: { [ACTIVE_WRITER_SESSION_HEADER]: 'session-a' },
        payload: { label: 'stale backup' },
      }),
    )

    expectStaleWriter(
      await harness.app.inject({
        method: 'POST',
        url: '/api/v1/storage/write',
        headers: {
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
      headers: { [ACTIVE_WRITER_SESSION_HEADER]: 'session-b' },
      payload: { label: 'active backup' },
    })
    expect(backup.statusCode).toBe(201)
    const backupId = backup.json().id as string

    expectStaleWriter(
      await harness.app.inject({
        method: 'POST',
        url: `/api/v1/backups/${encodeURIComponent(backupId)}/restore`,
        headers: { [ACTIVE_WRITER_SESSION_HEADER]: 'session-a' },
      }),
    )

    expectStaleWriter(
      await harness.app.inject({
        method: 'DELETE',
        url: `/api/v1/backups/${encodeURIComponent(backupId)}`,
        headers: { [ACTIVE_WRITER_SESSION_HEADER]: 'session-a' },
      }),
    )

    expectStaleWriter(
      await harness.app.inject({
        method: 'POST',
        url: '/api/v1/storage/remove',
        headers: {
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
        headers: { [ACTIVE_WRITER_SESSION_HEADER]: 'session-a' },
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
      headers: { [ACTIVE_WRITER_SESSION_HEADER]: 'session-b' },
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
      headers: { [ACTIVE_WRITER_SESSION_HEADER]: 'session-a' },
    })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().jobs).toHaveLength(1)

    expectStaleWriter(
      await harness.app.inject({
        method: 'DELETE',
        url: `/api/v1/memory/jobs/${encodeURIComponent(jobId)}`,
        headers: { [ACTIVE_WRITER_SESSION_HEADER]: 'session-a' },
      }),
    )

    const cancelled = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/memory/jobs/${encodeURIComponent(jobId)}`,
      headers: { [ACTIVE_WRITER_SESSION_HEADER]: 'session-b' },
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
        headers: { [ACTIVE_WRITER_SESSION_HEADER]: 'session-a' },
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
        headers: { [ACTIVE_WRITER_SESSION_HEADER]: 'session-a' },
        payload: {
          chatId: 'chat-1',
          characterId: 'char-1',
        },
      }),
    )
  })
})
