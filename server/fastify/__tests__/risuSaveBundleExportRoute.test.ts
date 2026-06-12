import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs, { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as fflate from 'fflate'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { createCommandEventSink, type CommandEventSink } from '../src/commands/events.js'
import { decodeRisuSaveImportSnapshot } from '../src/risuSave/importSnapshot.js'
import { DatabaseSync } from 'node:sqlite'
import {
  writePersistedWithMessages,
  assetsDir,
  getAllAssetMetadata,
  insertAssetMetadataBatch,
  loadPersistedWithMessages,
} from '../src/repository.js'
import { buildRepositoryRisuSaveBundleExport } from '../src/risuSave/bundleExport.js'
import { openDatabase } from '../src/db.js'
import { setupAuthedClient } from './helpers/auth.js'

interface ExportMetric {
  metric: string
  bundle?: boolean
  envelope?: string
  snapshotLoadMs?: number
  encodeMs?: number
  outputBytes?: number
}

// Capture opt-in protocol metrics so the bundle export measurement can confirm
// the embedded `.risu` materialization is attributed without changing behavior.
const capturedMetrics = vi.hoisted((): ExportMetric[] => [])

vi.mock('../src/protocolMetrics.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/protocolMetrics.js')>()
  return {
    ...actual,
    emitProtocolMetric: (name: string, fields: Record<string, unknown> | (() => Record<string, unknown>)) => {
      if (!actual.protocolMetricsEnabled()) return
      capturedMetrics.push({
        metric: name,
        ...(typeof fields === 'function' ? fields() : fields),
      } as ExportMetric)
    },
  }
})

interface Harness {
  app: FastifyInstance
  dataDir: string
  commandEvents: CommandEventSink
}

const INCLUDED_ASSET = 'a'.repeat(64)
const MISSING_REFERENCE = 'b'.repeat(64)
const MISSING_FILE = 'c'.repeat(64)
const ORPHANED_ASSET = 'd'.repeat(64)
const ESTIMATED_BACKUP_BYTES_HEADER = 'x-risu-estimated-backup-bytes'
const SQLITE_EXPORT_ESTIMATE_FILE = 'risu.db'

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-risu-bundle-route-'))
  const commandEvents = createCommandEventSink()
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
    commandEvents,
  })
  return { app, dataDir, commandEvents }
}

async function stopHarness(h: Harness): Promise<void> {
  await h.app.close()
  rmSync(h.dataDir, { recursive: true, force: true })
}

function persistBundleDatabase(dataDir: string): void {
  const db = openDatabase(dataDir)
  try {
    writePersistedWithMessages(db, dataDir, {
      _version: 1,
      database: {
        version: 1,
        selectedCharID: 0,
        userIcon: MISSING_FILE,
        characters: [
          {
            chaId: 'bundle-route-char',
            name: 'Bundle Route Character',
            image: INCLUDED_ASSET,
            emotionImages: [['missing', MISSING_REFERENCE]],
            chats: [
              {
                id: 'bundle-route-chat',
                name: 'Bundle Route Chat',
                note: '',
                localLore: [],
                message: [{ role: 'user', data: 'hello', chatId: 'bundle-route-message' }],
              },
            ],
          },
        ],
        characterOrder: ['bundle-route-char'],
        botPresets: [{ id: 'preset-a', name: 'Preset A' }],
        modules: [{ id: 'module-a', name: 'Module A' }],
        loadouts: [{ id: 'loadout-a', name: 'Loadout A' }],
        plugins: [{ id: 'plugin-a', name: 'Plugin A' }],
        pluginCustomStorage: {},
      },
      assets: [],
    })
    insertAssetMetadataBatch(db, [
      { id: INCLUDED_ASSET, ext: 'png', size: 12, contentType: 'image/png' },
      { id: MISSING_FILE, ext: 'webp', size: 8, contentType: 'image/webp' },
      { id: ORPHANED_ASSET, ext: 'png', size: 7, contentType: 'image/png' },
    ])
  } finally {
    db.close()
  }

  const dir = assetsDir(dataDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, `${INCLUDED_ASSET}.png`), Buffer.from('included-png'))
  writeFileSync(path.join(dir, `${ORPHANED_ASSET}.png`), Buffer.from('orphan'))
}

function unzipBundle(bytes: Buffer): Record<string, Uint8Array> {
  return fflate.unzipSync(new Uint8Array(bytes))
}

function parseManifest(files: Record<string, Uint8Array>): Record<string, unknown> {
  const raw = files['manifest.json']
  expect(raw).toBeInstanceOf(Uint8Array)
  return JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>
}

function parseLegacyLocalBackupBin(bytes: Buffer): Map<string, Uint8Array> {
  const records = new Map<string, Uint8Array>()
  let offset = 0
  while (offset < bytes.length) {
    expect(offset + 4).toBeLessThanOrEqual(bytes.length)
    const nameLength = bytes.readUInt32LE(offset)
    offset += 4
    expect(offset + nameLength).toBeLessThanOrEqual(bytes.length)
    const name = bytes.subarray(offset, offset + nameLength).toString('utf8')
    offset += nameLength
    expect(offset + 4).toBeLessThanOrEqual(bytes.length)
    const dataLength = bytes.readUInt32LE(offset)
    offset += 4
    expect(offset + dataLength).toBeLessThanOrEqual(bytes.length)
    records.set(name, bytes.subarray(offset, offset + dataLength))
    offset += dataLength
  }
  return records
}

function expectedEstimatedBackupBytes(dataDir: string, includedAssetBytes: number): number {
  return fs.statSync(path.join(dataDir, SQLITE_EXPORT_ESTIMATE_FILE)).size + includedAssetBytes
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

describe('Phase 9-8d repository .risu bundle export route', () => {
  it('exports a zip with the .risu file, manifest, and only walked present assets', async () => {
    persistBundleDatabase(harness.dataDir)

    const exported = await authedInject({
      method: 'GET',
      url: '/api/v1/export/bundle',
    })

    expect(exported.statusCode).toBe(200)
    expect(exported.headers['content-type']).toContain('application/zip')
    expect(exported.headers['content-disposition']).toBe('attachment; filename="database.risu.zip"')
    expect(Number(exported.headers[ESTIMATED_BACKUP_BYTES_HEADER])).toBe(
      expectedEstimatedBackupBytes(harness.dataDir, 12),
    )

    const files = unzipBundle(exported.rawPayload)
    expect(Object.keys(files).sort()).toEqual([`assets/${INCLUDED_ASSET}.png`, 'database.risu', 'manifest.json'])
    expect(Buffer.from(files[`assets/${INCLUDED_ASSET}.png`]).toString('utf8')).toBe('included-png')

    const decoded = decodeRisuSaveImportSnapshot(files['database.risu'])
    expect((decoded.database.characters as Array<Record<string, unknown>>)[0].image).toBe(INCLUDED_ASSET)

    const manifest = parseManifest(files)
    expect(manifest.risu).toEqual({
      path: 'database.risu',
      envelope: 'risusave-blocks',
      compression: false,
    })
    expect(manifest.assetReport).toEqual({
      referencedCount: 3,
      missingCount: 1,
      orphanedCount: 1,
    })
    expect(manifest.includedAssets).toEqual([
      {
        id: INCLUDED_ASSET,
        ext: 'png',
        size: 12,
        contentType: 'image/png',
        path: `assets/${INCLUDED_ASSET}.png`,
      },
    ])
    expect(manifest.missingReferences).toEqual([
      {
        id: MISSING_REFERENCE,
        paths: ['database.characters[0].emotionImages[0][1]'],
      },
    ])
    expect(manifest.missingFiles).toEqual([
      {
        id: MISSING_FILE,
        ext: 'webp',
        size: 8,
        contentType: 'image/webp',
        path: `assets/${MISSING_FILE}.webp`,
      },
    ])
    expect(manifest.orphanedAssets).toEqual([{ id: ORPHANED_ASSET, ext: 'png', size: 7, contentType: 'image/png' }])
    expect(harness.commandEvents.list()).toEqual([
      {
        type: 'state.exported',
        revision: 0,
        resource: 'state',
      },
    ])
  })

  it('passes export query options through to the bundled .risu file and manifest', async () => {
    persistBundleDatabase(harness.dataDir)

    const exported = await authedInject({
      method: 'GET',
      url: '/api/v1/export/bundle?envelope=legacy-raw',
    })

    expect(exported.statusCode).toBe(200)
    const files = unzipBundle(exported.rawPayload)
    const decoded = decodeRisuSaveImportSnapshot(files['database.risu'])
    expect(decoded.envelope).toBe('legacy-raw')
    expect(parseManifest(files).risu).toEqual({
      path: 'database.risu',
      envelope: 'legacy-raw',
      compression: false,
    })
  })

  it('exports an original Risu .bin local backup with database.risudat and asset records', async () => {
    persistBundleDatabase(harness.dataDir)

    const exported = await authedInject({
      method: 'GET',
      url: '/api/v1/export/local-backup',
    })

    expect(exported.statusCode).toBe(200)
    expect(exported.headers['content-type']).toContain('application/octet-stream')
    expect(exported.headers['content-disposition']).toBe('attachment; filename="database.bin"')
    expect(Number(exported.headers[ESTIMATED_BACKUP_BYTES_HEADER])).toBe(
      expectedEstimatedBackupBytes(harness.dataDir, 12),
    )

    const records = parseLegacyLocalBackupBin(exported.rawPayload)
    expect([...records.keys()].sort()).toEqual([`${INCLUDED_ASSET}.png`, 'database.risudat'])
    expect(Buffer.from(records.get(`${INCLUDED_ASSET}.png`) ?? []).toString('utf8')).toBe('included-png')

    const databaseBytes = records.get('database.risudat')
    expect(databaseBytes).toBeInstanceOf(Uint8Array)
    const decoded = decodeRisuSaveImportSnapshot(databaseBytes ?? new Uint8Array())
    expect(decoded.envelope).toBe('legacy-compressed')
    expect((decoded.database.characters as Array<Record<string, unknown>>)[0].image).toBe(INCLUDED_ASSET)
    expect(harness.commandEvents.list()).toEqual([
      {
        type: 'state.exported',
        revision: 0,
        resource: 'state',
      },
    ])
  })

  it('includes assets referenced through legacy local asset paths', async () => {
    const legacyDb = openDatabase(harness.dataDir)
    try {
      writePersistedWithMessages(legacyDb, harness.dataDir, {
        _version: 1,
        database: {
          version: 1,
          selectedCharID: 0,
          userIcon: `assets/${INCLUDED_ASSET}.png`,
          characters: [],
          characterOrder: [],
          botPresets: [],
          modules: [],
          loadouts: [],
          plugins: [],
          pluginCustomStorage: {},
        },
        assets: [],
      })
      insertAssetMetadataBatch(legacyDb, [{ id: INCLUDED_ASSET, ext: 'png', size: 12, contentType: 'image/png' }])
    } finally {
      legacyDb.close()
    }
    const dir = assetsDir(harness.dataDir)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, `${INCLUDED_ASSET}.png`), Buffer.from('legacy-path-png'))

    const exported = await authedInject({
      method: 'GET',
      url: '/api/v1/export/bundle',
    })

    expect(exported.statusCode).toBe(200)
    const files = unzipBundle(exported.rawPayload)
    expect(Buffer.from(files[`assets/${INCLUDED_ASSET}.png`]).toString('utf8')).toBe('legacy-path-png')
    expect(parseManifest(files).assetReport).toEqual({
      referencedCount: 1,
      missingCount: 0,
      orphanedCount: 0,
    })
  })

  it('L25: reports an asset that disappears after bundle planning without aborting export', async () => {
    persistBundleDatabase(harness.dataDir)
    const includedPath = path.join(assetsDir(harness.dataDir), `${INCLUDED_ASSET}.png`)
    const renamedPath = `${includedPath}.renamed`
    const realOpen = fs.promises.open.bind(fs.promises)
    let renamedBeforeStreamOpen = false
    const openSpy = vi
      .spyOn(fs.promises, 'open')
      .mockImplementation(async (...args: Parameters<typeof fs.promises.open>) => {
        if (!renamedBeforeStreamOpen && args[0] === includedPath) {
          renamedBeforeStreamOpen = true
          await fs.promises.rename(includedPath, renamedPath)
        }
        return realOpen(...args)
      })

    let exported: Awaited<ReturnType<typeof authedInject>>
    try {
      exported = await authedInject({
        method: 'GET',
        url: '/api/v1/export/bundle',
      })
    } finally {
      openSpy.mockRestore()
    }

    expect(renamedBeforeStreamOpen).toBe(true)
    expect(exported.statusCode).toBe(200)
    const files = unzipBundle(exported.rawPayload)
    expect(Object.keys(files).sort()).toEqual(['database.risu', 'manifest.json'])

    const manifest = parseManifest(files)
    expect(manifest.includedAssets).toEqual([])
    expect(manifest.missingFiles).toEqual([
      {
        id: INCLUDED_ASSET,
        ext: 'png',
        size: 12,
        contentType: 'image/png',
        path: `assets/${INCLUDED_ASSET}.png`,
      },
      {
        id: MISSING_FILE,
        ext: 'webp',
        size: 8,
        contentType: 'image/webp',
        path: `assets/${MISSING_FILE}.webp`,
      },
    ])
    expect(harness.commandEvents.list()).toEqual([
      {
        type: 'state.exported',
        revision: 0,
        resource: 'state',
      },
    ])
  })

  it('rejects unauthenticated bundle exports once a password is set', async () => {
    persistBundleDatabase(harness.dataDir)

    const exported = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/export/bundle',
    })

    expect(exported.statusCode).toBe(401)
    expect(harness.commandEvents.list()).toEqual([])
  })

  it('rejects invalid bundle export query parameters', async () => {
    persistBundleDatabase(harness.dataDir)

    const badEnvelope = await authedInject({
      method: 'GET',
      url: '/api/v1/export/bundle?envelope=zip',
    })
    expect(badEnvelope.statusCode).toBe(400)
    expect(badEnvelope.json()).toEqual({
      error: 'envelope must be risusave-blocks or a legacy .risu envelope',
    })
    expect(harness.commandEvents.list()).toEqual([])

    const badCompression = await authedInject({
      method: 'GET',
      url: '/api/v1/export/bundle?envelope=legacy-raw&compression=true',
    })
    expect(badCompression.statusCode).toBe(400)
    expect(badCompression.json()).toEqual({
      error: 'compression is only supported for risusave-blocks exports',
    })
    expect(harness.commandEvents.list()).toEqual([])
  })

  it('returns validation errors for missing persisted databases', async () => {
    const exported = await authedInject({
      method: 'GET',
      url: '/api/v1/export/bundle',
    })

    expect(exported.statusCode).toBe(400)
    expect(exported.json()).toEqual({ error: 'database payload missing' })
    expect(harness.commandEvents.list()).toEqual([])
  })
})

// Phase 5 ordinary `.risu` export materialization measurement (bundle side).
// Bundle export still materializes the embedded `.risu` bytes before streaming
// assets; the opt-in `risusave_export` metric attributes that materialization
// with `bundle: true`. Asset streaming is unchanged.
describe('bundle export materialization measurement', () => {
  const PREVIOUS_PROTOCOL_METRICS = process.env.RISU_PROTOCOL_METRICS

  beforeEach(() => {
    process.env.RISU_PROTOCOL_METRICS = '1'
    capturedMetrics.length = 0
  })

  afterEach(() => {
    if (PREVIOUS_PROTOCOL_METRICS === undefined) {
      delete process.env.RISU_PROTOCOL_METRICS
    } else {
      process.env.RISU_PROTOCOL_METRICS = PREVIOUS_PROTOCOL_METRICS
    }
  })

  it('records the embedded .risu materialization with bundle:true', async () => {
    persistBundleDatabase(harness.dataDir)
    capturedMetrics.length = 0

    const exported = await authedInject({
      method: 'GET',
      url: '/api/v1/export/bundle?envelope=risusave-blocks',
    })
    expect(exported.statusCode).toBe(200)

    const metric = [...capturedMetrics].reverse().find((entry) => entry.metric === 'risusave_export')
    expect(metric, 'missing risusave_export metric').toBeTruthy()
    expect(metric?.bundle).toBe(true)
    expect(metric?.envelope).toBe('risusave-blocks')
    expect(metric?.snapshotLoadMs).toBeGreaterThanOrEqual(0)
    expect(metric?.encodeMs).toBeGreaterThanOrEqual(0)
    // The metric measures the embedded `.risu` bytes, not the final (compressed,
    // multi-entry) zip, so only its presence and positivity are asserted here.
    expect(metric?.outputBytes).toBeGreaterThan(0)
  })
})

describe('bundle export abort cleanup (M11)', () => {
  async function waitFor(predicate: () => boolean, what: string): Promise<void> {
    const deadline = Date.now() + 2_000
    while (Date.now() < deadline) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  it('terminates the entry loop and destroys the in-flight asset read stream on premature close', async () => {
    // A multi-megabyte asset guarantees write backpressure (PassThrough
    // high-water mark is 16 KiB) parks the entry loop mid-file with the asset
    // read stream open — the empirically reproduced leak shape.
    const dataDir = harness.dataDir
    const bigAsset = Buffer.alloc(4 * 1024 * 1024, 7)
    const db = openDatabase(dataDir)
    try {
      writePersistedWithMessages(db, dataDir, {
        _version: 1,
        database: { version: 1, userIcon: INCLUDED_ASSET, characters: [] },
        assets: [],
      })
      insertAssetMetadataBatch(db, [
        { id: INCLUDED_ASSET, ext: 'png', size: bigAsset.length, contentType: 'image/png' },
      ])
      mkdirSync(assetsDir(dataDir), { recursive: true })
      writeFileSync(path.join(assetsDir(dataDir), `${INCLUDED_ASSET}.png`), bigAsset)

      const openedReadStreams: Array<ReturnType<typeof fs.createReadStream>> = []
      const realOpen = fs.promises.open.bind(fs.promises)
      const spy = vi
        .spyOn(fs.promises, 'open')
        .mockImplementation(async (...args: Parameters<typeof fs.promises.open>) => {
          const file = await realOpen(...args)
          const realCreateReadStream = file.createReadStream.bind(file)
          file.createReadStream = ((...streamArgs: Parameters<typeof file.createReadStream>) => {
            const stream = realCreateReadStream(...streamArgs)
            openedReadStreams.push(stream)
            return stream
          }) as typeof file.createReadStream
          return file
        })
      try {
        const persisted = loadPersistedWithMessages(db, dataDir)
        persisted.assets = getAllAssetMetadata(db)
        const bundle = buildRepositoryRisuSaveBundleExport({
          dataDir,
          persisted,
          risuBytes: new Uint8Array([1, 2, 3]),
          envelope: 'risusave-blocks',
          compression: false,
        })
        // No consumer reads the bundle stream, so the writer parks on
        // backpressure while the asset file is mid-read.
        await waitFor(() => openedReadStreams.length === 1, 'the asset read stream to open')
        expect(openedReadStreams[0].destroyed).toBe(false)

        // The client aborts: Fastify destroys the reply stream — a clean
        // 'close', no 'error'. The parked loop must unwind and free the FD.
        bundle.stream.destroy()
        await waitFor(() => openedReadStreams[0].destroyed, 'the asset read stream to be destroyed')
      } finally {
        spy.mockRestore()
      }
    } finally {
      db.close()
    }
  })
})
