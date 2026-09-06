import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
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
import { buildRepositoryRisuLocalBackupExport } from '../src/risuSave/localBackupExport.js'
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

const INCLUDED_ASSET_BYTES = Buffer.from('included-png')
const INCLUDED_ASSET = createHash('sha256').update(INCLUDED_ASSET_BYTES).digest('hex')
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

function persistBundleDatabase(dataDir: string, account?: unknown): void {
  const db = openDatabase(dataDir)
  try {
    writePersistedWithMessages(db, dataDir, {
      _version: 1,
      database: {
        version: 1,
        selectedCharID: 0,
        ...(account === undefined ? {} : { account }),
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
        plugins: [{ id: 'plugin-a', name: 'Plugin A', version: '3.0' }],
        pluginCustomStorage: {},
      },
      assets: [],
    })
    insertAssetMetadataBatch(db, [
      { id: INCLUDED_ASSET, ext: 'png', size: INCLUDED_ASSET_BYTES.byteLength, contentType: 'image/png' },
      { id: MISSING_FILE, ext: 'webp', size: 8, contentType: 'image/webp' },
      { id: ORPHANED_ASSET, ext: 'png', size: 7, contentType: 'image/png' },
    ])
  } finally {
    db.close()
  }

  const dir = assetsDir(dataDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, `${INCLUDED_ASSET}.png`), INCLUDED_ASSET_BYTES)
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

describe('repository .risu bundle export route', () => {
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
      expectedEstimatedBackupBytes(harness.dataDir, INCLUDED_ASSET_BYTES.byteLength),
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
        size: INCLUDED_ASSET_BYTES.byteLength,
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
    persistBundleDatabase(harness.dataDir, { id: 'legacy-account-id', token: 'legacy-account-token' })

    const exported = await authedInject({
      method: 'GET',
      url: '/api/v1/export/local-backup',
    })

    expect(exported.statusCode).toBe(200)
    expect(exported.headers['content-type']).toContain('application/octet-stream')
    expect(exported.headers['content-disposition']).toBe('attachment; filename="database.bin"')
    expect(Number(exported.headers[ESTIMATED_BACKUP_BYTES_HEADER])).toBe(
      expectedEstimatedBackupBytes(harness.dataDir, INCLUDED_ASSET_BYTES.byteLength),
    )

    const records = parseLegacyLocalBackupBin(exported.rawPayload)
    expect([...records.keys()].sort()).toEqual([`${INCLUDED_ASSET}.png`, 'database.risudat'])
    expect(Buffer.from(records.get(`${INCLUDED_ASSET}.png`) ?? []).toString('utf8')).toBe('included-png')

    const databaseBytes = records.get('database.risudat')
    expect(databaseBytes).toBeInstanceOf(Uint8Array)
    const decoded = decodeRisuSaveImportSnapshot(databaseBytes ?? new Uint8Array())
    expect(decoded.envelope).toBe('legacy-compressed')
    expect((decoded.database.characters as Array<Record<string, unknown>>)[0].image).toBe(
      `assets/${INCLUDED_ASSET}.png`,
    )
    expect(decoded.database).not.toHaveProperty('account')

    const liveDb = openDatabase(harness.dataDir)
    try {
      const liveDatabase = loadPersistedWithMessages(liveDb, harness.dataDir).database as Record<string, unknown>
      expect(liveDatabase.account).toEqual({
        id: 'legacy-account-id',
        token: 'legacy-account-token',
      })
      expect((liveDatabase.characters as Array<Record<string, unknown>>)[0].image).toBe(INCLUDED_ASSET)
    } finally {
      liveDb.close()
    }
    expect(harness.commandEvents.list()).toEqual([
      {
        type: 'state.exported',
        revision: 0,
        resource: 'state',
      },
    ])
  })

  it('includes assets referenced through legacy local asset paths', async () => {
    const legacyAssetBytes = Buffer.from('legacy-path-png')
    const legacyAssetId = createHash('sha256').update(legacyAssetBytes).digest('hex')
    const legacyDb = openDatabase(harness.dataDir)
    try {
      writePersistedWithMessages(legacyDb, harness.dataDir, {
        _version: 1,
        database: {
          version: 1,
          selectedCharID: 0,
          userIcon: `assets/${legacyAssetId}.png`,
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
      insertAssetMetadataBatch(legacyDb, [
        { id: legacyAssetId, ext: 'png', size: legacyAssetBytes.byteLength, contentType: 'image/png' },
      ])
    } finally {
      legacyDb.close()
    }
    const dir = assetsDir(harness.dataDir)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, `${legacyAssetId}.png`), legacyAssetBytes)

    const exported = await authedInject({
      method: 'GET',
      url: '/api/v1/export/bundle',
    })

    expect(exported.statusCode).toBe(200)
    const files = unzipBundle(exported.rawPayload)
    expect(Buffer.from(files[`assets/${legacyAssetId}.png`]).toString('utf8')).toBe('legacy-path-png')
    expect(parseManifest(files).assetReport).toEqual({
      referencedCount: 1,
      missingCount: 0,
      orphanedCount: 0,
    })
  })

  it('reports an asset that disappears after bundle planning without aborting export', async () => {
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
        size: INCLUDED_ASSET_BYTES.byteLength,
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

  it.each([
    ['bundle', '/api/v1/export/bundle'],
    ['legacy local backup', '/api/v1/export/local-backup'],
  ])('rejects a %s whose asset bytes do not match their metadata hash', async (_label, url) => {
    persistBundleDatabase(harness.dataDir)
    writeFileSync(path.join(assetsDir(harness.dataDir), `${INCLUDED_ASSET}.png`), Buffer.from('tampered bytes'))

    const exported = await authedInject({ method: 'GET', url })

    expect(exported.statusCode).toBe(400)
    expect(exported.json()).toEqual({
      error: `Export asset ${INCLUDED_ASSET}.png failed its content hash check`,
    })
    expect(harness.commandEvents.list()).toEqual([])
  })

  it.each([
    ['bundle', '/api/v1/export/bundle'],
    ['legacy local backup', '/api/v1/export/local-backup'],
  ])('rejects a %s whose asset size does not match its metadata', async (_label, url) => {
    persistBundleDatabase(harness.dataDir)
    const db = openDatabase(harness.dataDir)
    try {
      db.prepare('UPDATE assets SET size = ? WHERE id = ?').run(INCLUDED_ASSET_BYTES.byteLength + 1, INCLUDED_ASSET)
    } finally {
      db.close()
    }

    const exported = await authedInject({ method: 'GET', url })

    expect(exported.statusCode).toBe(400)
    expect(exported.json()).toEqual({
      error:
        `Export asset ${INCLUDED_ASSET}.png has ${INCLUDED_ASSET_BYTES.byteLength} bytes but its metadata declares ` +
        `${INCLUDED_ASSET_BYTES.byteLength + 1}`,
    })
    expect(harness.commandEvents.list()).toEqual([])
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

describe('export stream integrity and abort cleanup', () => {
  async function waitFor(predicate: () => boolean, what: string): Promise<void> {
    const deadline = Date.now() + 2_000
    while (Date.now() < deadline) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  async function consumeStream(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks)
  }

  it.each(['bundle', 'legacy local backup'] as const)(
    'terminates a %s stream when an asset changes after preflight verification',
    async (format) => {
      persistBundleDatabase(harness.dataDir)
      const db = openDatabase(harness.dataDir)
      const persisted = loadPersistedWithMessages(db, harness.dataDir)
      persisted.assets = getAllAssetMetadata(db)
      db.close()

      const assetFile = path.join(assetsDir(harness.dataDir), `${INCLUDED_ASSET}.png`)
      const realOpen = fs.promises.open.bind(fs.promises)
      let targetOpenCount = 0
      let markSecondOpenStarted!: () => void
      let releaseSecondOpen!: () => void
      const secondOpenStarted = new Promise<void>((resolve) => {
        markSecondOpenStarted = resolve
      })
      const secondOpenRelease = new Promise<void>((resolve) => {
        releaseSecondOpen = resolve
      })
      const spy = vi
        .spyOn(fs.promises, 'open')
        .mockImplementation(async (...args: Parameters<typeof fs.promises.open>) => {
          if (String(args[0]) === assetFile) {
            targetOpenCount += 1
            if (targetOpenCount === 2) {
              markSecondOpenStarted()
              await secondOpenRelease
            }
          }
          return realOpen(...args)
        })

      try {
        const exported =
          format === 'bundle'
            ? await buildRepositoryRisuSaveBundleExport({
                dataDir: harness.dataDir,
                persisted,
                risuBytes: new Uint8Array([1, 2, 3]),
                envelope: 'risusave-blocks',
                compression: false,
              })
            : await buildRepositoryRisuLocalBackupExport({
                dataDir: harness.dataDir,
                persisted,
                databaseBytes: new Uint8Array([1, 2, 3]),
                envelope: 'legacy-compressed',
              })
        const consumed = consumeStream(exported.stream)

        await secondOpenStarted
        writeFileSync(assetFile, Buffer.from('changed-after-preflight'))
        releaseSecondOpen()

        await expect(consumed).rejects.toThrow(`Export asset ${INCLUDED_ASSET}.png failed its content hash check`)
        expect(exported.stream.destroyed).toBe(true)
      } finally {
        releaseSecondOpen()
        spy.mockRestore()
      }
    },
  )

  it('terminates the entry loop and destroys the in-flight asset read stream on premature close', async () => {
    // A multi-megabyte asset guarantees write backpressure (PassThrough
    // high-water mark is 16 KiB) parks the entry loop mid-file with the asset
    // read stream open — the empirically reproduced leak shape.
    const dataDir = harness.dataDir
    const bigAsset = Buffer.alloc(4 * 1024 * 1024, 7)
    const bigAssetId = createHash('sha256').update(bigAsset).digest('hex')
    const db = openDatabase(dataDir)
    try {
      writePersistedWithMessages(db, dataDir, {
        _version: 1,
        database: { version: 1, userIcon: bigAssetId, characters: [] },
        assets: [],
      })
      insertAssetMetadataBatch(db, [{ id: bigAssetId, ext: 'png', size: bigAsset.length, contentType: 'image/png' }])
      mkdirSync(assetsDir(dataDir), { recursive: true })
      writeFileSync(path.join(assetsDir(dataDir), `${bigAssetId}.png`), bigAsset)

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
        const bundle = await buildRepositoryRisuSaveBundleExport({
          dataDir,
          persisted,
          risuBytes: new Uint8Array([1, 2, 3]),
          envelope: 'risusave-blocks',
          compression: false,
        })
        // No consumer reads the bundle stream, so the writer parks on
        // backpressure while the asset file is mid-read.
        await waitFor(() => openedReadStreams.some((stream) => !stream.destroyed), 'the asset read stream to open')
        const activeReadStream = openedReadStreams.find((stream) => !stream.destroyed)
        expect(activeReadStream).toBeDefined()

        // The client aborts: Fastify destroys the reply stream — a clean
        // 'close', no 'error'. The parked loop must unwind and free the FD.
        bundle.stream.destroy()
        await waitFor(() => activeReadStream?.destroyed === true, 'the asset read stream to be destroyed')
      } finally {
        spy.mockRestore()
      }
    } finally {
      db.close()
    }
  })
})
