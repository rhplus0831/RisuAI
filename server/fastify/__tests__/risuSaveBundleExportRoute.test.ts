import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as fflate from 'fflate'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { createCommandEventSink, type CommandEventSink } from '../src/commands/events.js'
import { decodeRisuSaveImportSnapshot } from '../src/risuSave/importSnapshot.js'
import { writePersisted, assetsDir } from '../src/repository.js'

interface Harness {
  app: FastifyInstance
  dataDir: string
  commandEvents: CommandEventSink
}

const INCLUDED_ASSET = 'a'.repeat(64)
const MISSING_REFERENCE = 'b'.repeat(64)
const MISSING_FILE = 'c'.repeat(64)
const ORPHANED_ASSET = 'd'.repeat(64)

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
  writePersisted(dataDir, {
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
    assets: [
      { id: INCLUDED_ASSET, ext: 'png', size: 12, contentType: 'image/png' },
      { id: MISSING_FILE, ext: 'webp', size: 8, contentType: 'image/webp' },
      { id: ORPHANED_ASSET, ext: 'png', size: 7, contentType: 'image/png' },
    ],
  })

  const dir = assetsDir(dataDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, `${INCLUDED_ASSET}.png`), Buffer.from('included-png'))
  writeFileSync(path.join(dir, `${ORPHANED_ASSET}.png`), Buffer.from('orphan'))
}

async function setupPassword(app: FastifyInstance): Promise<void> {
  const setup = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    payload: { password: 'hunter2' },
  })
  expect(setup.statusCode).toBe(200)
}

function unzipBundle(bytes: Buffer): Record<string, Uint8Array> {
  return fflate.unzipSync(new Uint8Array(bytes))
}

function parseManifest(files: Record<string, Uint8Array>): Record<string, unknown> {
  const raw = files['manifest.json']
  expect(raw).toBeInstanceOf(Uint8Array)
  return JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>
}

let harness: Harness

beforeEach(async () => {
  harness = await startHarness()
})

afterEach(async () => {
  await stopHarness(harness)
})

describe('Phase 9-8d repository .risu bundle export route', () => {
  it('exports a zip with the .risu file, manifest, and only walked present assets', async () => {
    persistBundleDatabase(harness.dataDir)

    const exported = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/export/bundle',
    })

    expect(exported.statusCode).toBe(200)
    expect(exported.headers['content-type']).toContain('application/zip')
    expect(exported.headers['content-disposition']).toBe('attachment; filename="database.risu.zip"')

    const files = unzipBundle(exported.rawPayload)
    expect(Object.keys(files).sort()).toEqual([
      `assets/${INCLUDED_ASSET}.png`,
      'database.risu',
      'manifest.json',
    ])
    expect(Buffer.from(files[`assets/${INCLUDED_ASSET}.png`]).toString('utf8')).toBe('included-png')

    const decoded = decodeRisuSaveImportSnapshot(files['database.risu'])
    expect((decoded.database.characters as Array<Record<string, unknown>>)[0].image).toBe(
      INCLUDED_ASSET,
    )

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
    expect(manifest.orphanedAssets).toEqual([
      { id: ORPHANED_ASSET, ext: 'png', size: 7, contentType: 'image/png' },
    ])
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

    const exported = await harness.app.inject({
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

  it('includes assets referenced through legacy local asset paths', async () => {
    writePersisted(harness.dataDir, {
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
      assets: [{ id: INCLUDED_ASSET, ext: 'png', size: 12, contentType: 'image/png' }],
    })
    const dir = assetsDir(harness.dataDir)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, `${INCLUDED_ASSET}.png`), Buffer.from('legacy-path-png'))

    const exported = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/export/bundle',
    })

    expect(exported.statusCode).toBe(200)
    const files = unzipBundle(exported.rawPayload)
    expect(Buffer.from(files[`assets/${INCLUDED_ASSET}.png`]).toString('utf8')).toBe(
      'legacy-path-png',
    )
    expect(parseManifest(files).assetReport).toEqual({
      referencedCount: 1,
      missingCount: 0,
      orphanedCount: 0,
    })
  })

  it('rejects unauthenticated bundle exports once a password is set', async () => {
    persistBundleDatabase(harness.dataDir)
    await setupPassword(harness.app)

    const exported = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/export/bundle',
    })

    expect(exported.statusCode).toBe(401)
    expect(harness.commandEvents.list()).toEqual([])
  })

  it('rejects invalid bundle export query parameters', async () => {
    persistBundleDatabase(harness.dataDir)

    const badEnvelope = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/export/bundle?envelope=zip',
    })
    expect(badEnvelope.statusCode).toBe(400)
    expect(badEnvelope.json()).toEqual({
      error: 'envelope must be risusave-blocks or a legacy .risu envelope',
    })
    expect(harness.commandEvents.list()).toEqual([])

    const badCompression = await harness.app.inject({
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
    const exported = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/export/bundle',
    })

    expect(exported.statusCode).toBe(400)
    expect(exported.json()).toEqual({ error: 'database payload missing' })
    expect(harness.commandEvents.list()).toEqual([])
  })
})
