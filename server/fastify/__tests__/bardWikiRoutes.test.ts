import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { webcrypto } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { getDatabaseLineage } from '../src/databaseLineage.js'
import { DEFAULT_BARDWIKI_GLOBAL_SETTINGS } from '@risuai/protocol'
import { createInitialDatabase } from '../src/databaseDefaults.js'

const subtle = webcrypto.subtle

let app: FastifyInstance
let dataDir: string
let assertion: string

beforeEach(async () => {
  process.env.LOG_LEVEL = 'silent'
  dataDir = mkdtempSync(path.join(tmpdir(), 'risu-bardwiki-routes-'))
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
  }))
  assertion = await setupAuthedClient(app)
  const db = new DatabaseSync(path.join(dataDir, 'risu.db'))
  try {
    db.prepare("INSERT INTO characters (id, position, data_json) VALUES ('character-a', 0, '{}')").run()
    db.prepare(
      "INSERT INTO chats (id, character_id, position, data_json) VALUES ('chat-a', 'character-a', 0, '{}')",
    ).run()
  } finally {
    db.close()
  }
})

afterEach(async () => {
  await app.close()
  rmSync(dataDir, { recursive: true, force: true })
})

async function setupAuthedClient(target: FastifyInstance): Promise<string> {
  const setup = await target.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    payload: { password: 'hunter2' },
  })
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
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + 60, pub: publicKey })).toString('base64url')
  const signingInput = `${header}.${payload}`
  const signature = await subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    keypair.privateKey,
    Buffer.from(signingInput),
  )
  return `${signingInput}.${Buffer.from(signature).toString('base64url')}`
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'risu-auth': assertion, ...extra }
}

function inspectRows(sql: string, ...params: Array<string | number>): unknown[] {
  const db = new DatabaseSync(path.join(dataDir, 'risu.db'))
  try {
    return db.prepare(sql).all(...params)
  } finally {
    db.close()
  }
}

function databaseLineage(): string {
  const db = new DatabaseSync(path.join(dataDir, 'risu.db'))
  try {
    return getDatabaseLineage(db)
  } finally {
    db.close()
  }
}

describe('BardWiki revisioned commands', () => {
  it('requires authentication', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/commands/bardwiki/chats/chat-a/documents',
      payload: {
        baseRevision: 0,
        document: { kind: 'event', title: 'Arrival', logicalPath: 'Events/Arrival', markdown: 'Hello.' },
      },
    })
    expect(response.statusCode).toBe(401)

    const read = await app.inject({ method: 'GET', url: '/api/v1/bardwiki/chats/chat-a' })
    expect(read.statusCode).toBe(401)
  })

  it('serves body-free indexes, lazy document bodies, ETags, and paginated versions', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/commands/bardwiki/chats/chat-a/documents',
      headers: authHeaders(),
      payload: {
        baseRevision: 0,
        document: {
          kind: 'location',
          title: 'Old Tavern',
          logicalPath: 'Places/Old Tavern',
          markdown: '## Old Tavern\nAda waits at [[People/Ada]].',
        },
      },
    })
    const createdBody = created.json()

    const index = await app.inject({
      method: 'GET',
      url: '/api/v1/bardwiki/chats/chat-a',
      headers: authHeaders(),
    })
    expect(index.statusCode).toBe(200)
    expect(index.headers.etag).toMatch(/^"[a-f0-9]{64}"$/u)
    expect(index.json()).toMatchObject({
      protocolVersion: 1,
      revision: 1,
      chatId: 'chat-a',
      effectiveSettings: { enabledByDefault: false, memoryMode: 'hypa' },
      documents: [{ id: createdBody.document.id, title: 'Old Tavern', version: 1 }],
      receipts: [],
      jobs: [],
    })
    expect(index.json().documents[0]).not.toHaveProperty('markdown')

    const unchanged = await app.inject({
      method: 'GET',
      url: '/api/v1/bardwiki/chats/chat-a',
      headers: authHeaders({ 'if-none-match': index.headers.etag as string }),
    })
    expect(unchanged.statusCode).toBe(304)
    expect(unchanged.body).toBe('')

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/bardwiki/chats/chat-a/documents/${createdBody.document.id}`,
      headers: authHeaders(),
    })
    expect(detail.statusCode).toBe(200)
    expect(detail.json()).toMatchObject({
      document: { markdown: '## Old Tavern\nAda waits at [[People/Ada]].' },
      links: [{ rawTarget: 'People/Ada', normalizedTarget: 'people/ada' }],
    })

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/commands/bardwiki/chats/chat-a/documents/${createdBody.document.id}`,
      headers: authHeaders(),
      payload: {
        baseRevision: 1,
        expectedVersion: 1,
        expectedContentHash: createdBody.document.contentHash,
        patch: { markdown: '# Renovated' },
      },
    })
    expect(updated.statusCode).toBe(200)

    const firstPage = await app.inject({
      method: 'GET',
      url: `/api/v1/bardwiki/chats/chat-a/documents/${createdBody.document.id}/versions?limit=1`,
      headers: authHeaders(),
    })
    expect(firstPage.statusCode).toBe(200)
    expect(firstPage.json()).toMatchObject({
      documentId: createdBody.document.id,
      versions: [{ version: 2, markdown: '# Renovated' }],
      nextBeforeVersion: 2,
    })

    const secondPage = await app.inject({
      method: 'GET',
      url: `/api/v1/bardwiki/chats/chat-a/documents/${createdBody.document.id}/versions?limit=1&beforeVersion=2`,
      headers: authHeaders(),
    })
    expect(secondPage.json()).toMatchObject({ versions: [{ version: 1 }], nextBeforeVersion: null })

    const wrongChat = await app.inject({
      method: 'GET',
      url: `/api/v1/bardwiki/chats/chat-b/documents/${createdBody.document.id}`,
      headers: authHeaders(),
    })
    expect(wrongChat.statusCode).toBe(404)
  })

  it('persists strict global defaults through the canonical memory settings group', async () => {
    const bardWiki = {
      ...DEFAULT_BARDWIKI_GLOBAL_SETTINGS,
      enabledByDefault: true,
      memoryMode: 'hybrid' as const,
      totalTokenBudget: 4096,
      hybridHypaTokenBudget: 2048,
      hybridBardWikiTokenBudget: 2048,
    }
    const db = new DatabaseSync(path.join(dataDir, 'risu.db'))
    try {
      db.prepare('INSERT INTO settings (id, data_json) VALUES (1, ?)').run(JSON.stringify(createInitialDatabase()))
    } finally {
      db.close()
    }
    const updated = await app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/memory',
      headers: authHeaders(),
      payload: { baseRevision: 0, patch: { bardWiki } },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toMatchObject({
      revision: 1,
      event: { type: 'settings.updated', resource: 'settings', id: 'memory' },
      acknowledgedKeys: ['bardWiki'],
    })

    const resource = await app.inject({
      method: 'GET',
      url: '/api/v1/bardwiki/chats/chat-a',
      headers: authHeaders(),
    })
    expect(resource.json()).toMatchObject({ globalSettings: bardWiki, effectiveSettings: bardWiki })

    const invalid = await app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/memory',
      headers: authHeaders(),
      payload: { baseRevision: 1, patch: { bardWiki: { ...bardWiki, maxDocuments: 1000 } } },
    })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json()).toEqual({ error: 'bardWiki must match the BardWiki global settings contract' })

    const unavailable = await app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/settings/memory',
      headers: authHeaders(),
      payload: {
        baseRevision: 1,
        patch: { bardWiki: { ...bardWiki, confirmationPolicy: 'automatic', canonicalUpdates: true } },
      },
    })
    expect(unavailable.statusCode).toBe(400)
    expect(unavailable.json()).toEqual({ error: 'BardWiki autonomous updates are not available yet' })
    expect(inspectRows('SELECT revision FROM schema_version WHERE id = 1')).toEqual([{ revision: 1 }])
  })

  it('updates settings and creates, edits, and soft-deletes one document with one event/revision each', async () => {
    for (const patch of [{ confirmationPolicyOverride: 'automatic' }, { canonicalUpdatesOverride: true }]) {
      const unavailable = await app.inject({
        method: 'PATCH',
        url: '/api/v1/commands/bardwiki/chats/chat-a/settings',
        headers: authHeaders(),
        payload: { baseRevision: 0, patch },
      })
      expect(unavailable.statusCode).toBe(400)
      expect(unavailable.json()).toEqual({ error: 'BardWiki autonomous updates are not available yet' })
    }

    const settings = await app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/bardwiki/chats/chat-a/settings',
      headers: authHeaders(),
      payload: { baseRevision: 0, patch: { enabledOverride: true, memoryModeOverride: 'bardwiki' } },
    })
    expect(settings.statusCode).toBe(200)
    expect(settings.json()).toMatchObject({
      revision: 1,
      event: { type: 'bardwiki.settings.updated', resource: 'bardWikiChat', id: 'chat-a' },
      settings: { enabledOverride: true, memoryModeOverride: 'bardwiki' },
    })

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/commands/bardwiki/chats/chat-a/documents',
      headers: authHeaders(),
      payload: {
        baseRevision: 1,
        document: {
          kind: 'location',
          title: 'Old Tavern',
          logicalPath: 'Places/Old Tavern',
          aliases: ['The Inn'],
          contextPolicy: 'always',
          reviewState: 'active',
          markdown: '## Old Tavern\nA quiet inn.',
        },
      },
    })
    expect(created.statusCode).toBe(200)
    const createdBody = created.json()
    expect(createdBody).toMatchObject({
      revision: 2,
      event: {
        type: 'bardwiki.document.created',
        resource: 'bardWikiDocument',
        parentId: 'chat-a',
      },
      document: { version: 1, title: 'Old Tavern' },
    })

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/commands/bardwiki/chats/chat-a/documents/${createdBody.document.id}`,
      headers: authHeaders(),
      payload: {
        baseRevision: 2,
        expectedVersion: 1,
        expectedContentHash: createdBody.document.contentHash,
        patch: { title: 'New Tavern', logicalPath: 'Places/New Tavern' },
      },
    })
    expect(updated.statusCode).toBe(200)
    const updatedBody = updated.json()
    expect(updatedBody).toMatchObject({ revision: 3, document: { version: 2, title: 'New Tavern' } })

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/commands/bardwiki/chats/chat-a/documents/${createdBody.document.id}`,
      headers: authHeaders(),
      payload: {
        baseRevision: 3,
        expectedVersion: 2,
        expectedContentHash: updatedBody.document.contentHash,
      },
    })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json()).toMatchObject({ revision: 4, document: { version: 3 } })
    expect(inspectRows('SELECT revision, type, resource FROM command_events ORDER BY revision')).toEqual([
      { revision: 1, type: 'bardwiki.settings.updated', resource: 'bardWikiChat' },
      { revision: 2, type: 'bardwiki.document.created', resource: 'bardWikiDocument' },
      { revision: 3, type: 'bardwiki.document.updated', resource: 'bardWikiDocument' },
      { revision: 4, type: 'bardwiki.document.deleted', resource: 'bardWikiDocument' },
    ])
    expect(
      inspectRows('SELECT version, reason, command_revision FROM bardwiki_document_versions ORDER BY version'),
    ).toEqual([
      { version: 1, reason: 'create', command_revision: 2 },
      { version: 2, reason: 'update', command_revision: 3 },
      { version: 3, reason: 'delete', command_revision: 4 },
    ])
  })

  it('rolls back stale revisions, stale document fences, and invalid paths without residue', async () => {
    const createPayload = {
      baseRevision: 0,
      document: { kind: 'event', title: 'Arrival', logicalPath: 'Events/Arrival', markdown: 'Hello.' },
    }
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/commands/bardwiki/chats/chat-a/documents',
      headers: authHeaders(),
      payload: createPayload,
    })
    const document = created.json().document

    const staleRevision = await app.inject({
      method: 'POST',
      url: '/api/v1/commands/bardwiki/chats/chat-a/documents',
      headers: authHeaders(),
      payload: { ...createPayload, document: { ...createPayload.document, logicalPath: 'Events/Other' } },
    })
    expect(staleRevision.statusCode).toBe(409)
    expect(staleRevision.json()).toMatchObject({ error: 'revision_conflict', currentRevision: 1 })

    const staleFence = await app.inject({
      method: 'PATCH',
      url: `/api/v1/commands/bardwiki/chats/chat-a/documents/${document.id}`,
      headers: authHeaders(),
      payload: {
        baseRevision: 1,
        expectedVersion: 1,
        expectedContentHash: '0'.repeat(64),
        patch: { markdown: 'overwrite' },
      },
    })
    expect(staleFence.statusCode).toBe(409)
    expect(staleFence.json()).toEqual({ error: 'bardwiki_document_conflict' })

    const invalidPath = await app.inject({
      method: 'POST',
      url: '/api/v1/commands/bardwiki/chats/chat-a/documents',
      headers: authHeaders(),
      payload: {
        baseRevision: 1,
        document: { kind: 'event', title: 'Escape', logicalPath: '../escape', markdown: 'No.' },
      },
    })
    expect(invalidPath.statusCode).toBe(400)
    expect(invalidPath.json()).toEqual({ error: 'bardwiki_invalid_path' })
    expect(inspectRows('SELECT id FROM bardwiki_documents')).toEqual([{ id: document.id }])
    expect(inspectRows('SELECT revision FROM command_events')).toEqual([{ revision: 1 }])
  })

  it('replays a durable mutation receipt without a second document, revision, or event', async () => {
    const headers = authHeaders({
      'risu-writer-session': 'writer-a',
      'risu-database-lineage': databaseLineage(),
      'risu-mutation-id': 'bardwiki-create-1',
    })
    const request = {
      method: 'POST' as const,
      url: '/api/v1/commands/bardwiki/chats/chat-a/documents',
      headers,
      payload: {
        baseRevision: 0,
        document: { kind: 'event', title: 'Arrival', logicalPath: 'Events/Arrival', markdown: 'Hello.' },
      },
    }
    const first = await app.inject(request)
    const replay = await app.inject(request)
    expect(first.statusCode).toBe(200)
    expect(replay.statusCode).toBe(200)
    expect(replay.json()).toEqual(first.json())
    expect(inspectRows('SELECT COUNT(*) AS count FROM bardwiki_documents')).toEqual([{ count: 1 }])
    expect(inspectRows('SELECT COUNT(*) AS count FROM command_events')).toEqual([{ count: 1 }])
  })
})
