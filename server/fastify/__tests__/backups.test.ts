import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash, webcrypto } from 'node:crypto'
import { buildApp } from '../src/app.js'
import { createCommandEventSink, type CommandEventSink } from '../src/commands/events.js'
import { assetsDir } from '../src/repository.js'
import type { FastifyInstance } from 'fastify'

const subtle = webcrypto.subtle
const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex',
)
const PNG_SHA = createHash('sha256').update(PNG_BYTES).digest('hex')

interface Harness {
  app: FastifyInstance
  dataDir: string
  commandEvents: CommandEventSink
}

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-'))
  const commandEvents = createCommandEventSink()
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
    },
    commandEvents,
  })
  return { app, dataDir, commandEvents }
}

async function stopHarness(h: Harness): Promise<void> {
  await h.app.close()
  rmSync(h.dataDir, { recursive: true, force: true })
}

async function signAssertion(
  privateKey: CryptoKey,
  publicJwk: JsonWebKey,
  ttlSec = 60,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'ES256', typ: 'JWT' }
  const payload = { iat: now, exp: now + ttlSec, pub: publicJwk }
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url')
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signingInput = `${headerB64}.${payloadB64}`
  const signature = await subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    privateKey,
    Buffer.from(signingInput),
  )
  const sigB64 = Buffer.from(signature).toString('base64url')
  return `${signingInput}.${sigB64}`
}

async function setupAuthedClient(app: FastifyInstance): Promise<{ assertion: string }> {
  const setup = await app.inject({
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

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { password: 'hunter2', publicKey },
  })
  expect(login.statusCode).toBe(200)

  const assertion = await signAssertion(keypair.privateKey, publicKey)
  return { assertion }
}

async function importDb(
  app: FastifyInstance,
  assertion: string,
  database: unknown,
): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/import/risusave',
    headers: { 'risu-auth': assertion },
    payload: { database },
  })
  expect(res.statusCode).toBe(200)
  return res.json().revision as number
}

let harness: Harness

beforeEach(async () => {
  harness = await startHarness()
})

afterEach(async () => {
  await stopHarness(harness)
})

describe('Phase 2D backups', () => {
  it('rejects all four routes without auth when password is set', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { password: 'hunter2' },
    })
    for (const op of [
      { method: 'POST' as const, url: '/api/v1/backups' },
      { method: 'GET' as const, url: '/api/v1/backups' },
      { method: 'POST' as const, url: '/api/v1/backups/2026-05-20-12-00-00-abc123/restore' },
      { method: 'DELETE' as const, url: '/api/v1/backups/2026-05-20-12-00-00-abc123' },
    ]) {
      const res = await harness.app.inject(op)
      expect(res.statusCode, `${op.method} ${op.url}`).toBe(401)
    }
  })

  it('creates a backup on a fresh data dir', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
      payload: {},
    })
    expect(res.statusCode).toBe(201)
    const manifest = res.json()
    expect(manifest).toMatchObject({
      _version: 1,
      label: null,
      revision: 0,
      assetCount: 0,
    })
    expect(manifest.id).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[a-f0-9]{6}$/)
    expect(existsSync(path.join(harness.dataDir, 'backups', manifest.id, 'db.json'))).toBe(true)
    expect(existsSync(path.join(harness.dataDir, 'backups', manifest.id, 'manifest.json'))).toBe(
      true,
    )
  })

  it('persists an explicit label', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
      payload: { label: 'before refactor' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().label).toBe('before refactor')
  })

  it('rejects a non-string label', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
      payload: { label: 42 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('captures the live revision and asset count', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await importDb(harness.app, assertion, { v: 1 })
    await importDb(harness.app, assertion, { v: 2 })
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
      payload: {},
    })
    expect(res.json().revision).toBe(2)
    expect(res.json().assetCount).toBe(0)
  })

  it('lists backups newest-first', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const a = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
      payload: { label: 'a' },
    })
    await new Promise((r) => setTimeout(r, 15))
    const b = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
      payload: { label: 'b' },
    })
    const list = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
    })
    expect(list.statusCode).toBe(200)
    const ids = list.json().backups.map((m: { id: string }) => m.id)
    expect(ids).toEqual([b.json().id, a.json().id])
  })

  it('lists empty on a fresh data dir', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
    })
    expect(res.json()).toEqual({ backups: [] })
  })

  it('round-trips: import A, backup, import B, restore, bootstrap returns A', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await importDb(harness.app, assertion, { tag: 'A' })
    const backup = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
      payload: { label: 'snapshot of A' },
    })
    expect(backup.statusCode).toBe(201)
    const backupId = backup.json().id

    await importDb(harness.app, assertion, { tag: 'B' })
    const beforeRestore = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(beforeRestore.json().database).toMatchObject({
      tag: 'B',
      characters: [],
      botPresets: [],
      modules: [],
      loadouts: [],
      plugins: [],
      pluginCustomStorage: {},
    })

    const restored = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/backups/${backupId}/restore`,
      headers: { 'risu-auth': assertion },
    })
    expect(restored.statusCode).toBe(200)
    const revisionAfter = restored.json().revision
    expect(restored.json().event).toEqual({
      type: 'state.restored',
      resource: 'state',
      revision: revisionAfter,
    })
    expect(harness.commandEvents.list()).toContainEqual({
      type: 'state.restored',
      resource: 'state',
      revision: revisionAfter,
    })

    const afterRestore = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(afterRestore.json().database).toMatchObject({
      tag: 'A',
      characters: [],
      botPresets: [],
      modules: [],
      loadouts: [],
      plugins: [],
      pluginCustomStorage: {},
    })
    expect(afterRestore.json().revision).toBe(revisionAfter)
  })

  it('round-trips chat messages and per-chat hypaV3Data (SQLite tables) with backup/restore', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await importDb(harness.app, assertion, {
      characters: [
        {
          chaId: 'c',
          name: 'C',
          chats: [
            {
              id: 'chat-1',
              name: 'Chat',
              note: '',
              localLore: [],
              hypaV3Data: { marker: 'hypa-A' },
              message: [{ role: 'user', data: 'message-A', chatId: 'mA' }],
            },
          ],
        },
      ],
    })
    const backup = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
      payload: { label: 'msgs A' },
    })
    expect(backup.statusCode).toBe(201)
    const backupId = backup.json().id

    // Replace with a different chat/message so the messages table now holds B.
    await importDb(harness.app, assertion, {
      characters: [
        {
          chaId: 'c',
          name: 'C',
          chats: [
            {
              id: 'chat-2',
              name: 'Chat 2',
              note: '',
              localLore: [],
              hypaV3Data: { marker: 'hypa-B' },
              message: [{ role: 'user', data: 'message-B', chatId: 'mB' }],
            },
          ],
        },
      ],
    })

    const restored = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/backups/${backupId}/restore`,
      headers: { 'risu-auth': assertion },
    })
    expect(restored.statusCode).toBe(200)

    const afterRestore = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    const chats = afterRestore.json().database.characters[0].chats
    expect(chats).toHaveLength(1)
    expect(chats[0].id).toBe('chat-1')
    expect(chats[0].message).toEqual([]) // stub — messages hydrate on open

    // The restored chat hydrates A's message — not B's, and not empty.
    const hydration = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/projection/chatMessages?id=chat-1',
      headers: { 'risu-auth': assertion },
    })
    expect(hydration.statusCode).toBe(200)
    expect(hydration.json().message).toEqual([{ role: 'user', data: 'message-A', chatId: 'mA' }])
    expect(hydration.json().hypaV3Data).toEqual({ marker: 'hypa-A' })
  })

  it('round-trips asset bytes with the backup snapshot', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const upload = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      headers: { 'content-type': 'image/png', 'risu-auth': assertion },
      payload: PNG_BYTES,
    })
    expect(upload.statusCode).toBe(201)

    await importDb(harness.app, assertion, { userIcon: PNG_SHA })
    const backup = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
      payload: { label: 'asset snapshot' },
    })
    expect(backup.statusCode).toBe(201)
    const backupId = backup.json().id
    expect(
      readFileSync(path.join(harness.dataDir, 'backups', backupId, 'assets', `${PNG_SHA}.png`)),
    ).toEqual(PNG_BYTES)

    rmSync(assetsDir(harness.dataDir), { recursive: true, force: true })
    writeFileSync(path.join(harness.dataDir, 'db.json'), JSON.stringify({ database: { tag: 'B' } }))

    const restored = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/backups/${backupId}/restore`,
      headers: { 'risu-auth': assertion },
    })
    expect(restored.statusCode).toBe(200)

    const asset = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/assets/${PNG_SHA}`,
    })
    expect(asset.statusCode).toBe(200)
    expect(Buffer.from(asset.rawPayload)).toEqual(PNG_BYTES)
  })

  it('restore of an unknown id returns 404', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups/2026-05-20-12-00-00-aaaaaa/restore',
      headers: { 'risu-auth': assertion },
    })
    expect(res.statusCode).toBe(404)
  })

  it('delete removes the backup directory', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
      payload: {},
    })
    const id = created.json().id
    expect(existsSync(path.join(harness.dataDir, 'backups', id))).toBe(true)

    const del = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/backups/${id}`,
      headers: { 'risu-auth': assertion },
    })
    expect(del.statusCode).toBe(200)
    expect(del.json()).toEqual({ id })
    expect(existsSync(path.join(harness.dataDir, 'backups', id))).toBe(false)

    const list = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
    })
    expect(list.json().backups).toEqual([])
  })

  it('delete of unknown id returns 404', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/backups/2026-05-20-12-00-00-aaaaaa',
      headers: { 'risu-auth': assertion },
    })
    expect(res.statusCode).toBe(404)
  })

  it('rejects path-traversal attempts via the id parameter', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    for (const malformed of ['..', '../foo', 'not-a-valid-id', '2026-05-20']) {
      const restore = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/backups/${encodeURIComponent(malformed)}/restore`,
        headers: { 'risu-auth': assertion },
      })
      expect(restore.statusCode).toBe(404)

      const del = await harness.app.inject({
        method: 'DELETE',
        url: `/api/v1/backups/${encodeURIComponent(malformed)}`,
        headers: { 'risu-auth': assertion },
      })
      expect(del.statusCode).toBe(404)
    }
  })

  it('A4EC4/B4: round-trips SQLite memory tables across backup and restore', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await importDb(harness.app, assertion, { tag: 'pre-mem' })

    // Open the live SQLite db directly to seed a memory_chunks row that the
    // backup must preserve. We use the same Node sqlite binding.
    const { DatabaseSync } = await import('node:sqlite')
    const liveDbPath = path.join(harness.dataDir, 'risu.db')
    const seed = new DatabaseSync(liveDbPath)
    try {
      seed.exec(
        `INSERT INTO memory_chunks (id, chat_id, range_start_seq, range_end_seq, text, status)
         VALUES ('chunk-pre', 'chat-a', 0, 1, 'pre', 'pending')`,
      )
    } finally {
      seed.close()
    }

    const backup = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
      payload: { label: 'mem snapshot' },
    })
    expect(backup.statusCode).toBe(201)
    const backupId = backup.json().id
    expect(existsSync(path.join(harness.dataDir, 'backups', backupId, 'risu.db'))).toBe(true)

    // Mutate the memory table post-backup; restore must revert it.
    const mutate = new DatabaseSync(liveDbPath)
    try {
      mutate.exec(
        `INSERT INTO memory_chunks (id, chat_id, range_start_seq, range_end_seq, text, status)
         VALUES ('chunk-post', 'chat-b', 0, 1, 'post', 'pending')`,
      )
      mutate.exec(`DELETE FROM memory_chunks WHERE id = 'chunk-pre'`)
    } finally {
      mutate.close()
    }

    const restored = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/backups/${backupId}/restore`,
      headers: { 'risu-auth': assertion },
    })
    expect(restored.statusCode).toBe(200)

    // The memory table must now match the snapshot.
    const verify = new DatabaseSync(liveDbPath)
    try {
      const rows = verify
        .prepare(`SELECT id FROM memory_chunks ORDER BY id ASC`)
        .all() as { id: string }[]
      expect(rows.map((r) => r.id)).toEqual(['chunk-pre'])
    } finally {
      verify.close()
    }
  })

  it('A4EC4/B5: round-trips data/save directory across backup and restore', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await importDb(harness.app, assertion, { tag: 'pre-save' })

    // Write a legacy storage entry through the /storage/write route, then
    // backup, mutate, restore, and verify the file content round-trips.
    const filePath = Buffer.from('remotes/preserved.local.bin').toString('hex')
    const initial = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/storage/write',
      headers: {
        'risu-auth': assertion,
        'content-type': 'application/octet-stream',
        'file-path': filePath,
      },
      payload: Buffer.from('preserved-bytes'),
    })
    expect(initial.statusCode).toBe(200)
    const savedFile = path.join(harness.dataDir, 'save', filePath)
    expect(existsSync(savedFile)).toBe(true)

    const backup = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
      payload: { label: 'save snapshot' },
    })
    expect(backup.statusCode).toBe(201)
    const backupId = backup.json().id
    expect(
      existsSync(path.join(harness.dataDir, 'backups', backupId, 'save', filePath)),
    ).toBe(true)

    // Overwrite and add a different file, then restore.
    writeFileSync(savedFile, 'tampered-bytes')
    const addedHex = Buffer.from('remotes/after.local.bin').toString('hex')
    const addedFile = path.join(harness.dataDir, 'save', addedHex)
    writeFileSync(addedFile, 'after-restore-must-disappear')

    const restored = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/backups/${backupId}/restore`,
      headers: { 'risu-auth': assertion },
    })
    expect(restored.statusCode).toBe(200)

    expect(readFileSync(savedFile, 'utf-8')).toBe('preserved-bytes')
    expect(existsSync(addedFile)).toBe(false)
  })
})
