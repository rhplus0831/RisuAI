import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { createCommandEventSink, type CommandEventSink } from '../src/commands/events.js'
import { decodeRisuSaveBlockEnvelope } from '../src/risuSave/blockCodec.js'
import { decodeRisuSaveImportSnapshot } from '../src/risuSave/importSnapshot.js'
import { classifyRisuSaveEnvelope } from '../src/risuSave/legacyEnvelopeCodec.js'
import { writePersisted } from '../src/repository.js'
import { setupAuthedClient } from './helpers/auth.js'

interface Harness {
  app: FastifyInstance
  dataDir: string
  commandEvents: CommandEventSink
}

interface ExportMetric {
  metric: string
  bundle?: boolean
  envelope?: string
  compression?: boolean
  snapshotLoadMs?: number
  encodeMs?: number
  outputBytes?: number
}

// Capture opt-in protocol metrics regardless of the logger sink so the ordinary
// `.risu` export materialization measurement can separate snapshot hydration
// from encode/output-buffer cost.
const capturedMetrics = vi.hoisted((): ExportMetric[] => [])

vi.mock('../src/protocolMetrics.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/protocolMetrics.js')>()
  return {
    ...actual,
    emitProtocolMetric: (name: string, fields: Record<string, unknown>) => {
      if (!actual.protocolMetricsEnabled()) return
      capturedMetrics.push({ metric: name, ...fields } as ExportMetric)
    },
  }
})

const ASSET_ID = 'c'.repeat(64)
const EXPORT_REQUIRED_ARRAY_FAMILIES = [
  'characters',
  'botPresets',
  'modules',
  'loadouts',
  'plugins',
] as const

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-risu-export-route-'))
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
    memoryWorker: false,
    commandEvents,
  })
  return { app, dataDir, commandEvents }
}

async function stopHarness(h: Harness): Promise<void> {
  await h.app.close()
  rmSync(h.dataDir, { recursive: true, force: true })
}

function persistExportableDatabase(dataDir: string): void {
  writePersisted(dataDir, {
    _version: 1,
    database: {
      version: 1,
      selectedCharID: 0,
      characters: [
        {
          chaId: 'export-route-char',
          name: 'Export Route Character',
          image: ASSET_ID,
          chats: [
            {
              id: 'export-route-chat',
              name: 'Export Route Chat',
              note: '',
              localLore: [],
              message: [{ role: 'user', data: 'hello', chatId: 'export-route-message' }],
            },
          ],
        },
      ],
      characterOrder: ['export-route-char'],
      botPresets: [{ id: 'preset-a', name: 'Preset A' }],
      modules: [{ id: 'module-a', name: 'Module A' }],
      loadouts: [{ id: 'loadout-a', name: 'Loadout A' }],
      plugins: [{ id: 'plugin-a', name: 'Plugin A' }],
      pluginCustomStorage: { 'plugin-a:key': { assetId: ASSET_ID } },
    },
    assets: [{ id: ASSET_ID, ext: 'png', size: 12, contentType: 'image/png' }],
  })
}

function expectExportRequiredShape(database: Record<string, unknown>): void {
  for (const key of EXPORT_REQUIRED_ARRAY_FAMILIES) {
    expect(Array.isArray(database[key]), key).toBe(true)
  }
  expect(database.pluginCustomStorage).toEqual(expect.any(Object))
  expect(Array.isArray(database.pluginCustomStorage)).toBe(false)
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

describe('Phase 9-8b repository .risu export route', () => {
  it('exports repository snapshots as downloadable RISUSAVE block bytes by default', async () => {
    persistExportableDatabase(harness.dataDir)

    const exported = await authedInject({
      method: 'GET',
      url: '/api/v1/export/risusave',
    })

    expect(exported.statusCode).toBe(200)
    expect(exported.headers['content-type']).toContain('application/octet-stream')
    expect(exported.headers['content-disposition']).toBe('attachment; filename="database.risu"')

    const bytes = new Uint8Array(exported.rawPayload)
    expect(classifyRisuSaveEnvelope(bytes)).toBe('risusave-blocks')
    expect(decodeRisuSaveBlockEnvelope(bytes).unsupportedReferences).toEqual([])
    const decoded = decodeRisuSaveImportSnapshot(bytes)
    expect(decoded.envelope).toBe('risusave-blocks')
    expect((decoded.database.characters as Array<Record<string, unknown>>)[0].image).toBe(ASSET_ID)
    expect(decoded.database.pluginCustomStorage).toEqual({
      'plugin-a:key': { assetId: ASSET_ID },
    })
    expect(harness.commandEvents.list()).toEqual([
      {
        type: 'state.exported',
        revision: 0,
        resource: 'state',
      },
    ])
  })

  it('supports compressed block exports with explicit query parameters', async () => {
    persistExportableDatabase(harness.dataDir)

    const exported = await authedInject({
      method: 'GET',
      url: '/api/v1/export/risusave?envelope=risusave-blocks&compression=true',
    })

    expect(exported.statusCode).toBe(200)
    const blocks = decodeRisuSaveBlockEnvelope(new Uint8Array(exported.rawPayload))
    expect(blocks.blocks.map((block) => block.compression)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ])
  })

  it('supports route-ready legacy envelope exports', async () => {
    persistExportableDatabase(harness.dataDir)

    const exported = await authedInject({
      method: 'GET',
      url: '/api/v1/export/risusave?envelope=legacy-raw',
    })

    expect(exported.statusCode).toBe(200)
    const bytes = new Uint8Array(exported.rawPayload)
    expect(classifyRisuSaveEnvelope(bytes)).toBe('legacy-raw')
    const decoded = decodeRisuSaveImportSnapshot(bytes)
    expect(decoded.envelope).toBe('legacy-raw')
    expect((decoded.database.characters as Array<Record<string, unknown>>)[0].image).toBe(ASSET_ID)
  })

  it('normalizes missing resource families before block export', async () => {
    writePersisted(harness.dataDir, {
      _version: 1,
      database: { v: 1 },
      assets: [],
    })

    const exported = await authedInject({
      method: 'GET',
      url: '/api/v1/export/risusave?envelope=risusave-blocks',
    })

    expect(exported.statusCode).toBe(200)
    const decoded = decodeRisuSaveImportSnapshot(new Uint8Array(exported.rawPayload))
    expectExportRequiredShape(decoded.database)
  })

  it('rejects unauthenticated exports once a password is set', async () => {
    persistExportableDatabase(harness.dataDir)

    const exported = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/export/risusave',
    })

    expect(exported.statusCode).toBe(401)
    expect(harness.commandEvents.list()).toEqual([])
  })

  it('rejects invalid export query parameters', async () => {
    persistExportableDatabase(harness.dataDir)

    const badEnvelope = await authedInject({
      method: 'GET',
      url: '/api/v1/export/risusave?envelope=zip',
    })
    expect(badEnvelope.statusCode).toBe(400)
    expect(badEnvelope.json()).toEqual({
      error: 'envelope must be risusave-blocks or a legacy .risu envelope',
    })
    expect(harness.commandEvents.list()).toEqual([])

    const badCompression = await authedInject({
      method: 'GET',
      url: '/api/v1/export/risusave?envelope=legacy-raw&compression=true',
    })
    expect(badCompression.statusCode).toBe(400)
    expect(badCompression.json()).toEqual({
      error: 'compression is only supported for risusave-blocks exports',
    })
    expect(harness.commandEvents.list()).toEqual([])
  })

  it('returns validation errors for missing or malformed persisted databases', async () => {
    const missing = await authedInject({
      method: 'GET',
      url: '/api/v1/export/risusave',
    })
    expect(missing.statusCode).toBe(400)
    expect(missing.json()).toEqual({ error: 'database payload missing' })
    expect(harness.commandEvents.list()).toEqual([])

    writeFileSync(
      path.join(harness.dataDir, 'db.json'),
      JSON.stringify({
        _version: 1,
        database: {
          characters: [
            {
              chaId: 'bad-export-char',
              name: 'Bad Export Character',
              chats: [
                {
                  id: 'bad-export-chat',
                  name: 'Bad Export Chat',
                  note: '',
                  localLore: [],
                  message: [{ role: 'system', data: 'nope', chatId: 'bad-export-message' }],
                },
              ],
            },
          ],
          botPresets: [],
          modules: [],
          loadouts: [],
          plugins: [],
          pluginCustomStorage: {},
        },
        assets: [],
      }),
    )

    const malformed = await authedInject({
      method: 'GET',
      url: '/api/v1/export/risusave',
    })
    expect(malformed.statusCode).toBe(400)
    expect(malformed.json()).toEqual({
      error: 'message[0].role must be user or char',
    })
    expect(harness.commandEvents.list()).toEqual([])
  })
})

// Phase 5 ordinary `.risu` export materialization measurement. The export route
// behavior (bytes, headers, event) is unchanged; the opt-in `risusave_export`
// metric separates snapshot hydration cost from encode/output-buffer cost.
describe('ordinary .risu export materialization measurement', () => {
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

  function exportMetric(): ExportMetric {
    const metric = [...capturedMetrics]
      .reverse()
      .find((entry) => entry.metric === 'risusave_export')
    expect(metric, 'missing risusave_export metric').toBeTruthy()
    return metric as ExportMetric
  }

  it('records snapshot/encode split and output size for block exports', async () => {
    persistExportableDatabase(harness.dataDir)
    capturedMetrics.length = 0

    const exported = await authedInject({
      method: 'GET',
      url: '/api/v1/export/risusave?envelope=risusave-blocks',
    })
    expect(exported.statusCode).toBe(200)

    const metric = exportMetric()
    expect(metric.bundle).toBe(false)
    expect(metric.envelope).toBe('risusave-blocks')
    expect(metric.compression).toBe(false)
    expect(metric.snapshotLoadMs).toBeGreaterThanOrEqual(0)
    expect(metric.encodeMs).toBeGreaterThanOrEqual(0)
    // Output size matches the materialized bytes actually sent.
    expect(metric.outputBytes).toBe(exported.rawPayload.length)
  })

  it('records the legacy envelope and compression flag', async () => {
    persistExportableDatabase(harness.dataDir)
    capturedMetrics.length = 0

    const exported = await authedInject({
      method: 'GET',
      url: '/api/v1/export/risusave?envelope=legacy-raw',
    })
    expect(exported.statusCode).toBe(200)

    const metric = exportMetric()
    expect(metric.bundle).toBe(false)
    expect(metric.envelope).toBe('legacy-raw')
    expect(metric.outputBytes).toBe(exported.rawPayload.length)
  })

  it('summarizes export materialization when RISU_EXPORT_MATERIALIZE_SUMMARY=1', async () => {
    persistExportableDatabase(harness.dataDir)

    for (const url of [
      '/api/v1/export/risusave?envelope=risusave-blocks',
      '/api/v1/export/risusave?envelope=risusave-blocks&compression=true',
      '/api/v1/export/risusave?envelope=legacy-raw',
    ]) {
      capturedMetrics.length = 0
      const exported = await authedInject({ method: 'GET', url })
      expect(exported.statusCode).toBe(200)
      const metric = exportMetric()
      if (process.env.RISU_EXPORT_MATERIALIZE_SUMMARY === '1') {
        console.log(
          JSON.stringify(
            {
              envelope: metric.envelope,
              compression: metric.compression,
              snapshotLoadMs: metric.snapshotLoadMs,
              encodeMs: metric.encodeMs,
              outputBytes: metric.outputBytes,
            },
            null,
            2,
          ),
        )
      }
    }
  })
})
