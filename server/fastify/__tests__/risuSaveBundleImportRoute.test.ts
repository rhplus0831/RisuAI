import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as fflate from 'fflate'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { createCommandEventSink, type CommandEventSink } from '../src/commands/events.js'
import { ACTIVE_WRITER_SESSION_HEADER } from '../src/activeWriter.js'
import { DatabaseSync } from 'node:sqlite'
import { writePersistedWithMessages, assetsDir, insertAssetMetadataBatch } from '../src/repository.js'
import { openDatabase } from '../src/db.js'
import { setupAuthedClient } from './helpers/auth.js'

interface Harness {
  app: FastifyInstance
  dataDir: string
  commandEvents: CommandEventSink
}

const ASSET_BYTES = Buffer.from('bundle-import-png-bytes')
const ASSET_ID = createHash('sha256').update(ASSET_BYTES).digest('hex')

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-risu-bundle-import-'))
  const commandEvents = createCommandEventSink()
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 4 * 1024 * 1024,
      importMaxBytes: Infinity,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
    },
    memoryWorker: false,
    commandEvents,
  })
  return { app, dataDir, commandEvents }
}

async function stopHarness(h: Harness): Promise<void> {
  await h.app.close()
  rmSync(h.dataDir, { recursive: true, force: true })
}

/**
 * Persist a database that references a real content-addressed asset and write
 * the matching asset file, so the exported bundle round-trips through the
 * import hash check (which a faithful export always satisfies).
 */
function persistDatabaseWithAsset(dataDir: string): void {
  const db = openDatabase(dataDir)
  try {
    writePersistedWithMessages(db, dataDir, {
      _version: 1,
      database: {
        version: 1,
        selectedCharID: 0,
        characters: [
          {
            chaId: 'bundle-import-char',
            name: 'Bundle Import Character',
            image: ASSET_ID,
            chats: [
              {
                id: 'bundle-import-chat',
                name: 'Bundle Import Chat',
                note: '',
                localLore: [],
                generationSettings: {
                  configured: true,
                  personaId: 'persona-a',
                  presetId: 'preset-a',
                  jailbreakToggle: false,
                  sidebarToggles: { mode: 'source-mode' },
                },
                message: [{ role: 'user', data: 'hello', chatId: 'bundle-import-message' }],
              },
            ],
          },
        ],
        characterOrder: ['bundle-import-char'],
        personas: [{ id: 'persona-a', name: 'Persona A' }],
        botPresets: [{ id: 'preset-a', name: 'Preset A' }],
        modules: [{ id: 'module-a', name: 'Module A' }],
        loadouts: [{ id: 'loadout-a', name: 'Loadout A' }],
        plugins: [{ id: 'plugin-a', name: 'Plugin A' }],
        pluginCustomStorage: {},
      },
      assets: [],
    })
    insertAssetMetadataBatch(db, [{ id: ASSET_ID, ext: 'png', size: ASSET_BYTES.length, contentType: 'image/png' }])
  } finally {
    db.close()
  }

  const dir = assetsDir(dataDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, `${ASSET_ID}.png`), ASSET_BYTES)
}

/** Build the original app's LocalWriter `.bin` blob: [u32-LE nameLen][name][u32-LE dataLen][data] records. */
function buildLegacyBin(records: { name: string; data: Uint8Array }[]): Buffer {
  const parts: Buffer[] = []
  for (const record of records) {
    const name = Buffer.from(record.name, 'utf8')
    const nameLen = Buffer.alloc(4)
    nameLen.writeUInt32LE(name.length, 0)
    const dataLen = Buffer.alloc(4)
    dataLen.writeUInt32LE(record.data.length, 0)
    parts.push(nameLen, name, dataLen, Buffer.from(record.data))
  }
  return Buffer.concat(parts)
}

function multipartBundle(bytes: Uint8Array, filename = 'database.risu.zip') {
  const boundary = `risu-bundle-boundary-${ASSET_ID.slice(0, 8)}`
  const head = Buffer.from(
    [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      'Content-Type: application/zip',
      '',
      '',
    ].join('\r\n'),
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  return {
    payload: Buffer.concat([head, Buffer.from(bytes), tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
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

function authedInject(opts: Record<string, unknown>) {
  const headers = (opts.headers ?? {}) as Record<string, string>
  return harness.app.inject({
    ...opts,
    headers: { 'risu-auth': assertion, ...headers },
  })
}

async function exportBundleZip(): Promise<Buffer> {
  const exported = await authedInject({ method: 'GET', url: '/api/v1/export/bundle' })
  expect(exported.statusCode).toBe(200)
  return exported.rawPayload
}

describe('repository .risu bundle import route', () => {
  it('restores the database and bundled assets into a fresh instance', async () => {
    persistDatabaseWithAsset(harness.dataDir)
    const zip = await exportBundleZip()

    // A clean instance with no prior state, proving the bundle alone is a
    // portable backup that reconstructs both the database and its assets.
    const fresh = await startHarness()
    try {
      const { assertion: freshAssertion } = await setupAuthedClient(fresh.app)
      const upload = multipartBundle(zip)
      const imported = await fresh.app.inject({
        method: 'POST',
        url: '/api/v1/import/bundle',
        headers: { 'risu-auth': freshAssertion, 'content-type': upload.contentType },
        payload: upload.payload,
      })

      expect(imported.statusCode).toBe(200)
      const body = imported.json() as Record<string, unknown>
      expect(body.importReport).toEqual({
        incompleteChatCount: 1,
        unsupportedReferenceCount: 0,
      })
      expect(body.importReport).not.toHaveProperty('unsupportedReferences')
      expect(body).not.toHaveProperty('format')
      expect(body).not.toHaveProperty('envelope')
      expect(body.bundleReport).toEqual({ includedAssetCount: 1, assetsCreated: true })
      expect(body.assetReport).toMatchObject({ referencedCount: 1, missingCount: 0 })
      expect(typeof body.revision).toBe('number')

      // The bundled asset bytes are now served by the fresh instance.
      const asset = await fresh.app.inject({
        method: 'GET',
        url: `/api/v1/assets/${ASSET_ID}`,
      })
      expect(asset.statusCode).toBe(200)
      expect(Buffer.from(asset.rawPayload).equals(ASSET_BYTES)).toBe(true)

      // The database is restored with imported chats requiring local confirmation.
      const bootstrap = await fresh.app.inject({
        method: 'GET',
        url: '/api/v1/bootstrap',
        headers: { 'risu-auth': freshAssertion },
      })
      expect(bootstrap.statusCode).toBe(200)
      expect(bootstrap.json().database.characters[0].chats[0].generationSettings).toEqual({
        configured: false,
        personaId: 'persona-a',
        presetId: 'preset-a',
        jailbreakToggle: false,
        sidebarToggles: { mode: 'source-mode' },
      })

      // The character that references the asset is exportable after import.
      const exported = await fresh.app.inject({
        method: 'GET',
        url: '/api/v1/export/risusave',
        headers: { 'risu-auth': freshAssertion },
      })
      expect(exported.statusCode).toBe(200)

      // state.imported is emitted so subscribers resync.
      expect(fresh.commandEvents.list().some((event) => event.type === 'state.imported')).toBe(true)
    } finally {
      await stopHarness(fresh)
    }
  })

  it('restores a legacy .bin backup from the original app (database.risudat + assets)', async () => {
    // A legacy `.bin` carries `database.risudat` (a legacy-compressed `.risu`)
    // plus content-addressed asset records named `<sha256>.<ext>`. The original
    // app and Fastify both hash asset bytes with sha256, so references resolve
    // without remapping. Produce the database bytes via the legacy export.
    persistDatabaseWithAsset(harness.dataDir)
    const exported = await authedInject({
      method: 'GET',
      url: '/api/v1/export/risusave?envelope=legacy-compressed',
    })
    expect(exported.statusCode).toBe(200)
    const databaseRisudat = exported.rawPayload

    const bin = buildLegacyBin([
      { name: 'database.risudat', data: databaseRisudat },
      // Original LocalWriter records use the asset's basename `<sha256>.png`.
      { name: `${ASSET_ID}.png`, data: ASSET_BYTES },
      // Cold-storage records have no server analogue and must be skipped.
      { name: 'somekey.json', data: Buffer.from('{"cold":true}') },
    ])

    const fresh = await startHarness()
    try {
      const { assertion: freshAssertion } = await setupAuthedClient(fresh.app)
      const upload = multipartBundle(bin, 'backup.bin')
      const imported = await fresh.app.inject({
        method: 'POST',
        url: '/api/v1/import/bundle',
        headers: { 'risu-auth': freshAssertion, 'content-type': upload.contentType },
        payload: upload.payload,
      })

      expect(imported.statusCode).toBe(200)
      const body = imported.json() as Record<string, unknown>
      expect(body.importReport).toEqual({
        incompleteChatCount: 1,
        unsupportedReferenceCount: 0,
      })
      expect(body.importReport).not.toHaveProperty('unsupportedReferences')
      expect(body).not.toHaveProperty('format')
      // Only the media record registered; the cold-storage `.json` was skipped.
      expect(body.bundleReport).toEqual({ includedAssetCount: 1, assetsCreated: true })
      expect(body.assetReport).toMatchObject({ referencedCount: 1, missingCount: 0 })

      const asset = await fresh.app.inject({ method: 'GET', url: `/api/v1/assets/${ASSET_ID}` })
      expect(asset.statusCode).toBe(200)
      expect(Buffer.from(asset.rawPayload).equals(ASSET_BYTES)).toBe(true)
    } finally {
      await stopHarness(fresh)
    }
  })

  it('accepts an upload larger than the global body limit', async () => {
    // The harness body limit is 4 MiB; the device-import route uses its own
    // (much larger) limit and streams the upload to disk, so a bundle bigger
    // than the body limit must still import.
    const bigBytes = Buffer.alloc(5 * 1024 * 1024, 7)
    const bigId = createHash('sha256').update(bigBytes).digest('hex')
    const bigDb = openDatabase(harness.dataDir)
    try {
      writePersistedWithMessages(bigDb, harness.dataDir, {
        _version: 1,
        database: {
          version: 1,
          selectedCharID: 0,
          characters: [{ chaId: 'big', name: 'Big', image: bigId, chats: [] }],
          characterOrder: ['big'],
          botPresets: [],
          modules: [],
          loadouts: [],
          plugins: [],
          pluginCustomStorage: {},
        },
        assets: [],
      })
      insertAssetMetadataBatch(bigDb, [{ id: bigId, ext: 'png', size: bigBytes.length, contentType: 'image/png' }])
    } finally {
      bigDb.close()
    }
    const dir = assetsDir(harness.dataDir)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, `${bigId}.png`), bigBytes)

    const zip = await exportBundleZip()
    expect(zip.length).toBeGreaterThan(4 * 1024 * 1024)

    const fresh = await startHarness()
    try {
      const { assertion: freshAssertion } = await setupAuthedClient(fresh.app)
      const upload = multipartBundle(zip)
      const imported = await fresh.app.inject({
        method: 'POST',
        url: '/api/v1/import/bundle',
        headers: { 'risu-auth': freshAssertion, 'content-type': upload.contentType },
        payload: upload.payload,
      })
      expect(imported.statusCode).toBe(200)
      const asset = await fresh.app.inject({ method: 'GET', url: `/api/v1/assets/${bigId}` })
      expect(asset.statusCode).toBe(200)
    } finally {
      await stopHarness(fresh)
    }
  })

  it('rejects a device-backup upload larger than a configured finite ceiling', async () => {
    // The import ceiling defaults to unlimited (multi-GB backups stream in with
    // bounded memory), but an operator can still cap it via importMaxBytes. With
    // a tiny cap, an over-limit upload is truncated mid-stream and rejected
    // rather than silently saved.
    const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-import-cap-'))
    const { app } = await buildApp({
      config: {
        host: '127.0.0.1',
        port: 0,
        dataDir,
        bodyLimit: 4 * 1024 * 1024,
        importMaxBytes: 1024,
        trustProxy: false,
        hubUrl: 'https://sv.risuai.xyz',
      },
      memoryWorker: false,
      commandEvents: createCommandEventSink(),
    })
    try {
      const { assertion: capAssertion } = await setupAuthedClient(app)
      const oversized = buildLegacyBin([{ name: 'database.risudat', data: Buffer.alloc(4096, 1) }])
      const upload = multipartBundle(oversized, 'backup.bin')
      const imported = await app.inject({
        method: 'POST',
        url: '/api/v1/import/bundle',
        headers: { 'risu-auth': capAssertion, 'content-type': upload.contentType },
        payload: upload.payload,
      })
      expect(imported.statusCode).toBe(400)
      expect((imported.json() as { error: string }).error).toContain('exceeds size limit')
    } finally {
      await app.close()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('rejects unauthenticated bundle imports once a password is set', async () => {
    persistDatabaseWithAsset(harness.dataDir)
    const zip = await exportBundleZip()
    const upload = multipartBundle(zip)

    const imported = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/import/bundle',
      payload: upload.payload,
      headers: { 'content-type': upload.contentType },
    })
    expect(imported.statusCode).toBe(401)
  })

  it('rejects non-multipart bundle imports', async () => {
    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/bundle',
      payload: { database: {} },
    })
    expect(imported.statusCode).toBe(400)
    expect(imported.json()).toEqual({
      error: 'backup import requires a multipart .risu.zip or .bin upload',
    })
  })

  it('rejects archives that are not valid zips', async () => {
    const upload = multipartBundle(new TextEncoder().encode('not a zip at all'))
    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/bundle',
      payload: upload.payload,
      headers: { 'content-type': upload.contentType },
    })
    expect(imported.statusCode).toBe(400)
  })

  it('caps the expanded size of the embedded database.risu even when the bundle import is unlimited (M9)', async () => {
    // importMaxBytes is Infinity in this harness, so the inner `.risu` falls
    // back to the expanded-import cap (bodyLimit = 4 MiB). A tiny gzip that
    // expands past that must be rejected during inflate, not materialized.
    const { encodeLegacyRisuSaveEnvelope } = await import('../src/risuSave/legacyEnvelopeCodec.js')
    const bomb = encodeLegacyRisuSaveEnvelope({ version: 1, blob: 'x'.repeat(6 * 1024 * 1024) }, 'legacy-stream')
    const zip = fflate.zipSync({
      'database.risu': bomb,
      'manifest.json': new TextEncoder().encode(JSON.stringify({ version: 1 })),
    })

    const upload = multipartBundle(zip)
    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/bundle',
      payload: upload.payload,
      headers: { 'content-type': upload.contentType },
    })
    expect(imported.statusCode).toBe(400)
    expect((imported.json() as { error: string }).error).toContain('exceeds size limit')
  })

  it('rejects a bundle whose manifest version is unsupported', async () => {
    persistDatabaseWithAsset(harness.dataDir)
    const files = fflate.unzipSync(new Uint8Array(await exportBundleZip()))
    const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString('utf8'))
    manifest.version = 2
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))
    const tampered = fflate.zipSync(files)

    const upload = multipartBundle(tampered)
    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/bundle',
      payload: upload.payload,
      headers: { 'content-type': upload.contentType },
    })
    expect(imported.statusCode).toBe(400)
    expect((imported.json() as { error: string }).error).toContain('manifest version')
  })

  it('rejects a bundle whose asset bytes do not match their content hash', async () => {
    persistDatabaseWithAsset(harness.dataDir)
    const files = fflate.unzipSync(new Uint8Array(await exportBundleZip()))
    files[`assets/${ASSET_ID}.png`] = new TextEncoder().encode('tampered asset bytes')
    const tampered = fflate.zipSync(files)

    const upload = multipartBundle(tampered)
    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/bundle',
      payload: upload.payload,
      headers: { 'content-type': upload.contentType },
    })
    expect(imported.statusCode).toBe(400)
    expect((imported.json() as { error: string }).error).toContain('content hash')
  })

  it('refuses bundle imports from a stale (non-active) writer session', async () => {
    persistDatabaseWithAsset(harness.dataDir)
    const zip = await exportBundleZip()

    // Latch session-a as the active writer via the writer-intent bootstrap.
    const bootstrap = await authedInject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { [ACTIVE_WRITER_SESSION_HEADER]: 'session-a' },
    })
    expect(bootstrap.statusCode).toBe(200)

    const upload = multipartBundle(zip)
    const imported = await authedInject({
      method: 'POST',
      url: '/api/v1/import/bundle',
      payload: upload.payload,
      headers: { 'content-type': upload.contentType },
    })
    expect(imported.statusCode).toBe(423)
    expect(imported.json()).toMatchObject({ error: 'active_writer_stale' })
  })
})
