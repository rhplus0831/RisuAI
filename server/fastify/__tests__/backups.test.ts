import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash, webcrypto } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { buildApp } from '../src/app.js'
import { createCommandEventSink, type CommandEventSink } from '../src/commands/events.js'
import { CURRENT_SCHEMA_VERSION } from '../src/db.js'
import { assetsDir, getAllAssetMetadata, listBackups, loadPersistedWithMessages } from '../src/repository.js'
import type { FastifyInstance } from 'fastify'
import { installResourceDatabaseBootstrapAdapter } from './helpers/resourceDatabase.js'

const subtle = webcrypto.subtle
const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex',
)
const PNG_SHA = createHash('sha256').update(PNG_BYTES).digest('hex')

function failCommandEventPersistence(dataDir: string): void {
  const db = new DatabaseSync(path.join(dataDir, 'risu.db'))
  try {
    db.exec(`
      CREATE TRIGGER fail_command_event_insert
      BEFORE INSERT ON command_events
      BEGIN
        SELECT RAISE(FAIL, 'injected command event failure');
      END;
    `)
  } finally {
    db.close()
  }
}

interface Harness {
  app: FastifyInstance
  dataDir: string
  commandEvents: CommandEventSink
}

function harnessConfig(dataDir: string, automaticBackupRetention?: number) {
  return {
    host: '127.0.0.1',
    port: 0,
    dataDir,
    bodyLimit: 1024 * 1024,
    importMaxBytes: Infinity,
    automaticBackupRetention,
    trustProxy: false,
    hubUrl: 'https://sv.risuai.xyz',
  }
}

async function startHarness(automaticBackupRetention?: number): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-'))
  const commandEvents = createCommandEventSink()
  const { app } = await buildApp({
    config: harnessConfig(dataDir, automaticBackupRetention),
    commandEvents,
  })
  installResourceDatabaseBootstrapAdapter(app)
  return { app, dataDir, commandEvents }
}

async function restartHarness(harness: Harness): Promise<void> {
  await harness.app.close()
  const commandEvents = createCommandEventSink()
  const { app } = await buildApp({
    config: harnessConfig(harness.dataDir),
    commandEvents,
  })
  installResourceDatabaseBootstrapAdapter(app)
  harness.app = app
  harness.commandEvents = commandEvents
}

async function stopHarness(h: Harness): Promise<void> {
  await h.app.close()
  rmSync(h.dataDir, { recursive: true, force: true })
}

async function signAssertion(privateKey: CryptoKey, publicJwk: JsonWebKey, ttlSec = 60): Promise<string> {
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

async function importDb(app: FastifyInstance, assertion: string, database: unknown): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/import/risusave',
    headers: { 'risu-auth': assertion },
    // Minimal fixtures need one recognized core key to pass the
    // risusave_empty_database import guard.
    payload: { database: { characters: [], ...(database as Record<string, unknown>) } },
  })
  expect(res.statusCode).toBe(200)
  return res.json().revision as number
}

function readBackupDatabase(dataDir: string, id: string): Record<string, unknown> {
  const backupRoot = path.join(dataDir, 'backups', id)
  const backupDb = new DatabaseSync(path.join(backupRoot, 'risu.db'), { readOnly: true })
  try {
    return loadPersistedWithMessages(backupDb, backupRoot).database as Record<string, unknown>
  } finally {
    backupDb.close()
  }
}

let harness: Harness

beforeEach(async () => {
  harness = await startHarness()
})

afterEach(async () => {
  vi.restoreAllMocks()
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
      kind: 'manual',
      revision: 0,
      assetCount: 0,
    })
    expect(manifest.id).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[a-f0-9]{6}$/)
    expect(existsSync(path.join(harness.dataDir, 'backups', manifest.id, 'manifest.json'))).toBe(true)
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

  it('snapshots pre-restore state and also protects restores of automatic snapshots', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await importDb(harness.app, assertion, { tag: 'A' })
    await importDb(harness.app, assertion, { tag: 'B' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await importDb(harness.app, assertion, { tag: 'C' })

    const beforeRestore = listBackups(harness.dataDir).filter((backup) => backup.kind === 'automatic')
    const automaticA = beforeRestore.find((backup) => readBackupDatabase(harness.dataDir, backup.id).tag === 'A')
    expect(automaticA).toMatchObject({
      kind: 'automatic',
      label: 'Automatic safety snapshot',
    })

    const restored = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/backups/${automaticA!.id}/restore`,
      headers: { 'risu-auth': assertion },
    })
    expect(restored.statusCode).toBe(200)

    const afterRestore = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(afterRestore.json().database).toMatchObject({ tag: 'A' })

    const automaticAfter = listBackups(harness.dataDir).filter((backup) => backup.kind === 'automatic')
    expect(automaticAfter.some((backup) => backup.id === automaticA!.id)).toBe(true)
    expect(automaticAfter.some((backup) => readBackupDatabase(harness.dataDir, backup.id).tag === 'C')).toBe(true)
  })

  it('prunes only the oldest automatic snapshots beyond the configured cap', async () => {
    const capped = await startHarness(2)
    try {
      const { assertion } = await setupAuthedClient(capped.app)
      await importDb(capped.app, assertion, { tag: 'A' })
      const manual = await capped.app.inject({
        method: 'POST',
        url: '/api/v1/backups',
        headers: { 'risu-auth': assertion },
        payload: { label: 'manual A' },
      })
      expect(manual.statusCode).toBe(201)

      await new Promise((resolve) => setTimeout(resolve, 5))
      await importDb(capped.app, assertion, { tag: 'B' })
      await new Promise((resolve) => setTimeout(resolve, 5))
      await importDb(capped.app, assertion, { tag: 'C' })
      await new Promise((resolve) => setTimeout(resolve, 5))
      await importDb(capped.app, assertion, { tag: 'D' })

      const backups = listBackups(capped.dataDir)
      expect(backups.find((backup) => backup.id === manual.json().id)).toMatchObject({
        kind: 'manual',
        label: 'manual A',
      })
      const automatic = backups.filter((backup) => backup.kind === 'automatic')
      expect(automatic).toHaveLength(2)
      expect(automatic.map((backup) => readBackupDatabase(capped.dataDir, backup.id).tag).sort()).toEqual(['B', 'C'])
    } finally {
      await stopHarness(capped)
    }
  })

  it('fails restore closed when its safety snapshot cannot be created', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await importDb(harness.app, assertion, { tag: 'A' })
    const manual = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
      payload: { label: 'restore target A' },
    })
    expect(manual.statusCode).toBe(201)
    await importDb(harness.app, assertion, { tag: 'B' })

    const liveSqlite = path.join(harness.dataDir, 'risu.db')
    const originalCopyFileSync = fs.copyFileSync.bind(fs)
    vi.spyOn(fs, 'copyFileSync').mockImplementation((source, destination, mode) => {
      if (String(source) === liveSqlite && String(destination).includes(`${path.sep}backups${path.sep}`)) {
        throw new Error('injected automatic backup copy failure')
      }
      return originalCopyFileSync(source, destination, mode)
    })

    const automaticBefore = listBackups(harness.dataDir).filter((backup) => backup.kind === 'automatic')
    const restored = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/backups/${manual.json().id}/restore`,
      headers: { 'risu-auth': assertion },
    })
    expect(restored.statusCode).toBe(500)
    expect(restored.json()).toEqual({ error: 'automatic_backup_failed' })

    const after = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(after.json().database).toMatchObject({ tag: 'B' })
    expect(listBackups(harness.dataDir).filter((backup) => backup.kind === 'automatic')).toEqual(automaticBefore)
  })

  it.each([
    {
      name: 'manifest-only backup',
      id: '2026-07-21-01-02-03-a0a0a0',
      expectedError: 'backup_database_missing',
      prepareDatabasePayload: (_backupRoot: string) => {},
    },
    {
      name: 'zero-byte SQLite backup',
      id: '2026-07-21-01-02-04-b0b0b0',
      expectedError: 'backup_database_invalid',
      prepareDatabasePayload: (backupRoot: string) => {
        writeFileSync(path.join(backupRoot, 'risu.db'), '')
      },
    },
    {
      name: 'SQLite backup without core tables',
      id: '2026-07-21-01-02-05-c0c0c0',
      expectedError: 'backup_database_invalid',
      prepareDatabasePayload: (backupRoot: string) => {
        const guttedDb = new DatabaseSync(path.join(backupRoot, 'risu.db'))
        try {
          guttedDb.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY)')
        } finally {
          guttedDb.close()
        }
      },
    },
    {
      name: 'legacy backup whose database is not an object',
      id: '2026-07-21-01-02-06-d0d0d0',
      expectedError: 'backup_database_invalid',
      prepareDatabasePayload: (backupRoot: string) => {
        writeFileSync(path.join(backupRoot, 'db.json'), JSON.stringify({ database: [] }))
      },
    },
  ])('rejects a $name before touching live data or restore staging', async (testCase) => {
    const { assertion } = await setupAuthedClient(harness.app)
    const liveTag = `live-before-${testCase.id}`
    await importDb(harness.app, assertion, { tag: liveTag })

    const liveAssetFile = path.join(assetsDir(harness.dataDir), 'live-sentinel.bin')
    const liveSaveFile = path.join(harness.dataDir, 'save', 'live-sentinel')
    mkdirSync(path.dirname(liveAssetFile), { recursive: true })
    mkdirSync(path.dirname(liveSaveFile), { recursive: true })
    writeFileSync(liveAssetFile, 'live-asset')
    writeFileSync(liveSaveFile, 'live-save')

    const backupRoot = path.join(harness.dataDir, 'backups', testCase.id)
    mkdirSync(backupRoot, { recursive: true })
    writeFileSync(
      path.join(backupRoot, 'manifest.json'),
      JSON.stringify({ id: testCase.id, createdAt: '2026-07-21T01:02:03.000Z' }),
    )
    testCase.prepareDatabasePayload(backupRoot)

    const restoreScratchDirs = [
      path.join(harness.dataDir, `.assets-${testCase.id}.tmp`),
      path.join(harness.dataDir, `.assets-${testCase.id}.old`),
      path.join(harness.dataDir, `.save-${testCase.id}.tmp`),
      path.join(harness.dataDir, `.save-${testCase.id}.old`),
    ]
    for (const scratchDir of restoreScratchDirs) {
      mkdirSync(scratchDir, { recursive: true })
      writeFileSync(path.join(scratchDir, 'untouched'), 'sentinel')
    }

    const before = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    const revisionBefore = before.json().revision as number
    harness.commandEvents.clear()

    const restored = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/backups/${testCase.id}/restore`,
      headers: { 'risu-auth': assertion },
    })
    expect(restored.statusCode).toBe(400)
    expect(restored.json()).toEqual({ error: testCase.expectedError })
    expect(listBackups(harness.dataDir).filter((backup) => backup.kind === 'automatic')).toEqual([])

    const after = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(after.json().revision).toBe(revisionBefore)
    expect(after.json().database).toMatchObject({ tag: liveTag })
    expect(readFileSync(liveAssetFile, 'utf8')).toBe('live-asset')
    expect(readFileSync(liveSaveFile, 'utf8')).toBe('live-save')
    for (const scratchDir of restoreScratchDirs) {
      expect(readFileSync(path.join(scratchDir, 'untouched'), 'utf8')).toBe('sentinel')
    }
    expect(harness.commandEvents.list()).toEqual([])
  })

  it('repairs stable lorebook ids while restoring a pre-v23 SQLite backup', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const legacyEntry = {
      id: 'entry-before-backup',
      key: 'legacy',
      secondkey: '',
      insertorder: 100,
      comment: 'Legacy entry',
      content: 'before backup',
      mode: 'normal',
      alwaysActive: false,
      selective: false,
    }
    await importDb(harness.app, assertion, {
      tag: 'pre-v23',
      loreBook: [{ id: 'book-before-backup', name: 'Legacy book', data: [legacyEntry] }],
    })
    const backup = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
      payload: { label: 'pre-v23 lorebook' },
    })
    expect(backup.statusCode).toBe(201)

    const backupDb = new DatabaseSync(path.join(harness.dataDir, 'backups', backup.json().id, 'risu.db'))
    try {
      const row = backupDb.prepare('SELECT data_json FROM lore_books WHERE position = 0').get() as {
        data_json: string
      }
      const idlessLorebook = JSON.parse(row.data_json) as {
        id?: string
        data: Array<{ id?: string }>
      }
      delete idlessLorebook.id
      delete idlessLorebook.data[0].id
      backupDb.prepare('UPDATE lore_books SET data_json = ? WHERE position = 0').run(JSON.stringify(idlessLorebook))
      backupDb.prepare('UPDATE schema_version SET version = 22 WHERE id = 1').run()
    } finally {
      backupDb.close()
    }

    await importDb(harness.app, assertion, { tag: 'live-after-backup' })
    const restored = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/backups/${backup.json().id}/restore`,
      headers: { 'risu-auth': assertion },
    })
    expect(restored.statusCode).toBe(200)

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    const restoredLorebook = bootstrap.json().database.loreBook[0] as {
      id: string
      data: Array<{ id: string }>
    }
    expect(restoredLorebook.id).toEqual(expect.any(String))
    expect(restoredLorebook.data[0].id).toEqual(expect.any(String))

    const liveDb = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
    try {
      expect(
        (liveDb.prepare('SELECT version FROM schema_version WHERE id = 1').get() as { version: number }).version,
      ).toBe(CURRENT_SCHEMA_VERSION)
    } finally {
      liveDb.close()
    }

    const addedEntry = { ...legacyEntry, id: 'entry-after-restore', content: 'after restore' }
    const added = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/commands/lorebooks/${encodeURIComponent(restoredLorebook.id)}/entries/${addedEntry.id}`,
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: bootstrap.json().revision, entry: addedEntry },
    })
    expect(added.statusCode).toBe(200)

    const reloaded = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(reloaded.json().database.loreBook[0]).toMatchObject({
      id: restoredLorebook.id,
      data: [
        expect.objectContaining({ id: restoredLorebook.data[0].id }),
        expect.objectContaining({ id: addedEntry.id }),
      ],
    })
  })

  it('round-trips split model and prompt preset tables with backup/restore', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await importDb(harness.app, assertion, {
      tag: 'preset-A',
      modelPresetsId: 0,
      modelPresets: [{ id: 'model-A', name: 'Model A', aiModel: 'model-before-backup' }],
      promptPresetsId: 0,
      promptPresets: [{ id: 'prompt-A', name: 'Prompt A', promptTemplate: [{ role: 'system', content: 'A' }] }],
    })
    const backup = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
      payload: { label: 'preset snapshot A' },
    })
    expect(backup.statusCode).toBe(201)
    const backupId = backup.json().id

    await importDb(harness.app, assertion, {
      tag: 'preset-B',
      modelPresetsId: 0,
      modelPresets: [{ id: 'model-B', name: 'Model B', aiModel: 'model-after-backup' }],
      promptPresetsId: 0,
      promptPresets: [{ id: 'prompt-B', name: 'Prompt B', promptTemplate: [{ role: 'system', content: 'B' }] }],
    })
    const beforeRestore = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(beforeRestore.json().database).toMatchObject({
      tag: 'preset-B',
      modelPresets: [{ id: 'model-B', name: 'Model B', aiModel: 'model-after-backup' }],
      promptPresets: [{ id: 'prompt-B', name: 'Prompt B' }],
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
    expect(afterRestore.json().database).toMatchObject({
      tag: 'preset-A',
      modelPresetsId: 0,
      modelPresets: [{ id: 'model-A', name: 'Model A', aiModel: 'model-before-backup' }],
      promptPresetsId: 0,
      promptPresets: [{ id: 'prompt-A', name: 'Prompt A' }],
    })
  })

  it('keeps pre-restore state when restore event persistence fails', async () => {
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
    harness.commandEvents.clear()
    failCommandEventPersistence(harness.dataDir)

    const restored = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/backups/${backupId}/restore`,
      headers: { 'risu-auth': assertion },
    })

    expect(restored.statusCode).toBe(500)
    expect(harness.commandEvents.list()).toEqual([])
    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().revision).toBe(2)
    expect(bootstrap.json().database).toMatchObject({
      tag: 'B',
      characters: [],
      botPresets: [],
      modules: [],
      loadouts: [],
      plugins: [],
      pluginCustomStorage: {},
    })
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
      url: '/api/v1/chats/chat-1/messages',
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
    expect(readFileSync(path.join(harness.dataDir, 'backups', backupId, 'assets', `${PNG_SHA}.png`))).toEqual(PNG_BYTES)

    rmSync(assetsDir(harness.dataDir), { recursive: true, force: true })

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

  it('restores a legacy db.json backup into SQLite tables', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await importDb(harness.app, assertion, { tag: 'live-before-legacy-restore' })

    const backupId = '2026-06-03-01-02-03-abcdef'
    const backupRoot = path.join(harness.dataDir, 'backups', backupId)
    mkdirSync(path.join(backupRoot, 'assets'), { recursive: true })
    writeFileSync(path.join(backupRoot, 'assets', `${PNG_SHA}.png`), PNG_BYTES)

    const legacyAsset = {
      id: PNG_SHA,
      ext: 'png',
      size: PNG_BYTES.length,
      contentType: 'image/png',
    }
    const legacyDatabase = {
      tag: 'legacy-db-json',
      modules: [{ id: 'module-a', name: 'Legacy module', assets: [['icon.png', PNG_SHA, 'png']] }],
      pluginCustomStorage: { 'plugin-a': { enabled: true } },
      characters: [
        {
          chaId: 'legacy-char',
          name: 'Legacy',
          chats: [
            {
              id: 'legacy-chat',
              name: 'Legacy chat',
              note: '',
              localLore: [],
              message: [{ role: 'user', data: 'from legacy', chatId: 'legacy-msg' }],
            },
          ],
        },
      ],
    }
    const legacySnapshotPath = path.join(backupRoot, 'db.json')
    const legacySnapshotRaw = JSON.stringify({ _version: 1, database: legacyDatabase, assets: [legacyAsset] })
    writeFileSync(legacySnapshotPath, legacySnapshotRaw)
    const copyFileSpy = vi.spyOn(fs, 'copyFileSync')

    const restored = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/backups/${backupId}/restore`,
      headers: { 'risu-auth': assertion },
    })
    expect(restored.statusCode).toBe(200)
    expect(existsSync(path.join(harness.dataDir, 'db.json'))).toBe(false)
    expect(existsSync(path.join(harness.dataDir, 'db.json.migrated'))).toBe(false)
    expect(readFileSync(legacySnapshotPath, 'utf8')).toBe(legacySnapshotRaw)
    expect(
      copyFileSpy.mock.calls.some(([, destination]) => String(destination) === path.join(harness.dataDir, 'db.json')),
    ).toBe(false)

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.statusCode).toBe(200)
    expect(bootstrap.json().database).toMatchObject({
      tag: 'legacy-db-json',
      modules: [{ id: 'module-a', name: 'Legacy module' }],
      pluginCustomStorage: { 'plugin-a': { enabled: true } },
      characters: [{ chaId: 'legacy-char', chats: [{ id: 'legacy-chat', message: [] }] }],
    })

    const hydration = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/chats/legacy-chat/messages',
      headers: { 'risu-auth': assertion },
    })
    expect(hydration.statusCode).toBe(200)
    expect(hydration.json().message).toEqual([{ role: 'user', data: 'from legacy', chatId: 'legacy-msg' }])

    const asset = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/assets/${PNG_SHA}`,
    })
    expect(asset.statusCode).toBe(200)
    expect(Buffer.from(asset.rawPayload)).toEqual(PNG_BYTES)

    const verify = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
    try {
      expect(getAllAssetMetadata(verify)).toEqual([legacyAsset])
      expect(loadPersistedWithMessages(verify, harness.dataDir).assets).toEqual([legacyAsset])
    } finally {
      verify.close()
    }
  })

  it('rolls back a transient legacy import failure without staging a live db.json or poisoning the next boot', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await importDb(harness.app, assertion, { tag: 'live-before-failed-legacy-restore' })

    const backupId = '2026-06-03-02-03-04-fedcba'
    const backupRoot = path.join(harness.dataDir, 'backups', backupId)
    mkdirSync(backupRoot, { recursive: true })
    const legacySnapshotPath = path.join(backupRoot, 'db.json')
    const failingAssetId = 'c'.repeat(64)
    writeFileSync(
      legacySnapshotPath,
      JSON.stringify({
        _version: 1,
        database: {
          tag: 'stale-legacy-restore',
          characters: [],
        },
        assets: [{ id: failingAssetId, ext: 'png', size: 1, contentType: 'image/png' }],
      }),
    )

    const liveDbPath = path.join(harness.dataDir, 'risu.db')
    const injectFailure = new DatabaseSync(liveDbPath)
    try {
      injectFailure.exec(`
        CREATE TRIGGER fail_legacy_restore_asset_import
        BEFORE INSERT ON assets
        WHEN NEW.id = '${failingAssetId}'
        BEGIN
          SELECT RAISE(FAIL, 'injected transient legacy restore import failure');
        END;
      `)
    } finally {
      injectFailure.close()
    }

    const restored = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/backups/${backupId}/restore`,
      headers: { 'risu-auth': assertion },
    })
    expect(restored.statusCode).toBe(500)
    expect(existsSync(path.join(harness.dataDir, 'db.json'))).toBe(false)
    expect(existsSync(path.join(harness.dataDir, 'db.json.migrated'))).toBe(false)
    expect(existsSync(legacySnapshotPath)).toBe(true)

    const afterFailure = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(afterFailure.json().database).toMatchObject({ tag: 'live-before-failed-legacy-restore' })

    const removeFailure = new DatabaseSync(liveDbPath)
    try {
      removeFailure.exec('DROP TRIGGER fail_legacy_restore_asset_import')
    } finally {
      removeFailure.close()
    }
    await importDb(harness.app, assertion, { tag: 'newer-write-after-failed-restore' })

    await restartHarness(harness)
    const afterRestart = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(afterRestart.statusCode).toBe(200)
    expect(afterRestart.json().database).toMatchObject({ tag: 'newer-write-after-failed-restore' })
    expect(existsSync(path.join(harness.dataDir, 'db.json'))).toBe(false)
  })

  it('skips a corrupt manifest instead of failing the whole backups list (L27)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const a = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
      payload: { label: 'healthy' },
    })
    expect(a.statusCode).toBe(201)

    // One corrupt (unparsable) and one misshapen (no createdAt) manifest.
    const corruptId = '2026-06-05-01-02-03-c0ffee'
    mkdirSync(path.join(harness.dataDir, 'backups', corruptId), { recursive: true })
    writeFileSync(path.join(harness.dataDir, 'backups', corruptId, 'manifest.json'), '{not valid json')
    const misshapenId = '2026-06-05-01-02-04-c0ffee'
    mkdirSync(path.join(harness.dataDir, 'backups', misshapenId), { recursive: true })
    writeFileSync(
      path.join(harness.dataDir, 'backups', misshapenId, 'manifest.json'),
      JSON.stringify({ id: misshapenId }),
    )

    const list = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/backups',
      headers: { 'risu-auth': assertion },
    })
    expect(list.statusCode).toBe(200)
    expect(list.json().backups.map((m: { id: string }) => m.id)).toEqual([a.json().id])
  })

  it('rejects an unreadable legacy db.json before restore staging, with no restore event (L28)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await importDb(harness.app, assertion, { tag: 'live-before-broken-legacy' })
    const before = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    const revisionBefore = before.json().revision as number
    harness.commandEvents.clear()

    // A legacy-only backup (db.json, no risu.db) whose snapshot is unreadable.
    const backupId = '2026-06-05-02-03-04-abcdef'
    const backupRoot = path.join(harness.dataDir, 'backups', backupId)
    mkdirSync(backupRoot, { recursive: true })
    writeFileSync(path.join(backupRoot, 'db.json'), '{broken legacy snapshot')

    const restored = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/backups/${backupId}/restore`,
      headers: { 'risu-auth': assertion },
    })
    expect(restored.statusCode).toBe(400)
    expect(restored.json()).toEqual({ error: 'backup_database_invalid' })

    // Validation happens before the table clear and no restore event is emitted
    // or persisted.
    expect(harness.commandEvents.list()).toEqual([])
    const after = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(after.json().revision).toBe(revisionBefore)
    expect(after.json().database).toMatchObject({ tag: 'live-before-broken-legacy' })
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
      const rows = verify.prepare(`SELECT id FROM memory_chunks ORDER BY id ASC`).all() as {
        id: string
      }[]
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
    expect(existsSync(path.join(harness.dataDir, 'backups', backupId, 'save', filePath))).toBe(true)

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
