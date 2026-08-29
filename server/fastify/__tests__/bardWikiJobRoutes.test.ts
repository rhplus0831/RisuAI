import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { webcrypto } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { openDatabase } from '../src/db.js'
import { claimNextBardWikiJob, enqueueBardWikiJob, retryOrFailBardWikiJob } from '../src/bardWikiJobs.js'
import type { MemoryEvent } from '../src/memoryEvents.js'

const subtle = webcrypto.subtle
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
let app: FastifyInstance
let dataDir: string
let assertion: string
let events: MemoryEvent[]

beforeEach(async () => {
  process.env.LOG_LEVEL = 'silent'
  dataDir = mkdtempSync(path.join(tmpdir(), 'risu-bardwiki-job-routes-'))
  events = []
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
    bardWikiWorker: false,
    memoryEvents: (event) => events.push(event),
  }))
  assertion = await setupAuthedClient(app)
  seedJob()
})

afterEach(async () => {
  await app.close()
  rmSync(dataDir, { recursive: true, force: true })
})

function seedJob(): void {
  const db = openDatabase(dataDir)
  try {
    db.prepare('INSERT INTO characters (id, position, data_json) VALUES (?, 0, ?)').run('character-a', '{}')
    db.prepare('INSERT INTO chats (id, character_id, position, data_json) VALUES (?, ?, 0, ?)').run(
      'chat-a',
      'character-a',
      '{}',
    )
    db.prepare(
      `INSERT INTO bardwiki_turn_receipts (
        id, chat_id, user_message_id, user_content_hash, assistant_message_id,
        assistant_content_hash, confirmation_mode, state, change_set_id
      ) VALUES ('receipt-a', 'chat-a', 'user-a', ?, 'assistant-a', ?, 'explicit', 'queued', 'changes-a')`,
    ).run(HASH_A, HASH_B)
    enqueueBardWikiJob(db, {
      id: 'job-a',
      instanceId: 'instance-a',
      chatId: 'chat-a',
      receiptId: 'receipt-a',
      kind: 'apply_turn',
      payload: {
        receiptId: 'receipt-a',
        expectedUserContentHash: HASH_A,
        expectedAssistantContentHash: HASH_B,
        modelProfileId: null,
        promptPresetId: null,
        promptVersion: 'bardwiki-event-v1',
        canonicalEnabled: false,
        repairAttemptCount: 0,
      },
    })
  } finally {
    db.close()
  }
}

describe('BardWiki operational job routes', () => {
  it('requires authentication and active-writer authority', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/bardwiki/jobs/job-a' })).statusCode).toBe(401)
    const bootstrap = await app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion, 'risu-writer-session': 'writer-a' },
    })
    expect(bootstrap.statusCode).toBe(200)
    const withoutWriter = await app.inject({
      method: 'DELETE',
      url: '/api/v1/bardwiki/jobs/job-a',
      headers: { 'risu-auth': assertion },
    })
    expect(withoutWriter.statusCode).toBe(423)
    expect(withoutWriter.json()).toMatchObject({ error: 'active_writer_stale' })
  })

  it('cancels a job and emits only a sanitized status projection', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/bardwiki/jobs/job-a',
      headers: { 'risu-auth': assertion, 'risu-writer-session': 'writer-a' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      job: { id: 'job-a', receiptId: 'receipt-a', status: 'cancelled', errorCode: 'cancelled' },
    })
    expect(response.json().job).not.toHaveProperty('payload')
    expect(events).toMatchObject([
      {
        type: 'bardwiki.job',
        chatId: 'chat-a',
        job: { id: 'job-a', receiptId: 'receipt-a', status: 'cancelled', errorCode: 'cancelled' },
      },
    ])
    expect(JSON.stringify(events)).not.toContain(HASH_A)
  })

  it('retries failed work with a fresh instance id and rejects public BardWiki enqueue through Hypa', async () => {
    const db = openDatabase(dataDir)
    try {
      claimNextBardWikiJob(db)
      retryOrFailBardWikiJob(db, 'job-a', 'bardwiki_model_unavailable', 'token=super-secret', {
        backoffBaseMs: 0,
      })
      claimNextBardWikiJob(db)
      retryOrFailBardWikiJob(db, 'job-a', 'bardwiki_model_unavailable', 'token=super-secret', {
        backoffBaseMs: 0,
      })
      claimNextBardWikiJob(db)
      retryOrFailBardWikiJob(db, 'job-a', 'bardwiki_model_unavailable', 'token=super-secret', {
        backoffBaseMs: 0,
      })
    } finally {
      db.close()
    }

    const retry = await app.inject({
      method: 'POST',
      url: '/api/v1/bardwiki/jobs/job-a/retry',
      headers: { 'risu-auth': assertion, 'risu-writer-session': 'writer-a' },
    })
    expect(retry.statusCode).toBe(200)
    expect(retry.json()).toMatchObject({ job: { id: 'job-a', status: 'pending', attemptCount: 0 } })
    expect(retry.json().job.instanceId).not.toBe('instance-a')
    expect(retry.json().job).not.toHaveProperty('payload')

    const publicEnqueue = await app.inject({
      method: 'POST',
      url: '/api/v1/memory/jobs',
      headers: { 'risu-auth': assertion },
      payload: { chatId: 'chat-a', kind: 'apply_turn', payload: {} },
    })
    expect(publicEnqueue.statusCode).toBe(400)
    expect(publicEnqueue.json()).toEqual({ error: 'kind must be one of: chunk, embed, summarize' })
  })
})

async function setupAuthedClient(target: FastifyInstance): Promise<string> {
  const setup = await target.inject({ method: 'POST', url: '/api/v1/auth/setup', payload: { password: 'hunter2' } })
  expect(setup.statusCode).toBe(200)
  const keypair = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const publicKey = await subtle.exportKey('jwk', keypair.publicKey)
  const login = await target.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { password: 'hunter2', publicKey },
  })
  expect(login.statusCode).toBe(200)
  const now = Math.floor(Date.now() / 1000)
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url')
  const payloadB64 = Buffer.from(JSON.stringify({ iat: now, exp: now + 60, pub: publicKey })).toString('base64url')
  const signingInput = `${headerB64}.${payloadB64}`
  const signature = await subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    keypair.privateKey,
    Buffer.from(signingInput),
  )
  return `${signingInput}.${Buffer.from(signature).toString('base64url')}`
}
