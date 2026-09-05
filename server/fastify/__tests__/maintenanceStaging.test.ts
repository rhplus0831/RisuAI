import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import * as fflate from 'fflate'
import { buildApp } from '../src/app.js'
import { getSchemaState } from '../src/db.js'
import { getAllAssetMetadata } from '../src/repository.js'
import {
  getMaintenanceCoordinator,
  MaintenanceBusyError,
  type MaintenanceLease,
} from '../src/maintenanceCoordinator.js'
import { setupAuthedClient } from './helpers/auth.js'

const converterControl = vi.hoisted(() => ({ pause: null as (() => Promise<void>) | null }))

vi.mock('../src/realmImport/characterCard.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/realmImport/characterCard.js')>()
  return {
    ...actual,
    convertRealmCharacterCard: async (...args: Parameters<typeof actual.convertRealmCharacterCard>) => {
      await converterControl.pause?.()
      return actual.convertRealmCharacterCard(...args)
    },
  }
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function multipartFile(bytes: Uint8Array, filename: string) {
  const boundary = 'risu-maintenance-import'
  return {
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      Buffer.from(bytes),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

const imageBytes = Buffer.from('maintenance-protected staged character image')
const imageId = createHash('sha256').update(imageBytes).digest('hex')
const legacyKey = Buffer.from('database/database.bin').toString('hex')

function characterArchive(lowLevelAccess = false): Buffer {
  return Buffer.from(
    fflate.zipSync(
      {
        'card.json': Buffer.from(
          JSON.stringify({
            spec: 'chara_card_v3',
            spec_version: '3.0',
            data: {
              name: 'Maintenance import',
              description: 'Protected across converter awaits',
              first_mes: 'Hello',
              extensions: { risuai: { lowLevelAccess } },
              assets: [{ type: 'icon', uri: 'embeded://assets/main.png', name: 'main', ext: 'png' }],
            },
          }),
        ),
        'assets/main.png': imageBytes,
      },
      { level: 0 },
    ),
  )
}

let app: FastifyInstance
let dataDir: string
let assertion: string

function readState() {
  const db = new DatabaseSync(path.join(dataDir, 'risu.db'))
  try {
    return {
      revision: getSchemaState(db).revision,
      characterCount: (db.prepare('SELECT COUNT(*) AS count FROM characters').get() as { count: number }).count,
      assets: getAllAssetMetadata(db),
    }
  } finally {
    db.close()
  }
}

function headers() {
  return { 'risu-auth': assertion, 'risu-writer-session': 'writer-a' }
}

function requestLocalCharacter(lowLevelAccess = false) {
  const upload = multipartFile(characterArchive(lowLevelAccess), 'character.charx')
  return app.inject({
    method: 'POST',
    url: `/api/v1/import/character-card?baseRevision=${readState().revision}`,
    headers: { ...headers(), 'content-type': upload.contentType },
    payload: upload.payload,
  })
}

function writeLegacy(bytes: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/storage/write',
    headers: { ...headers(), 'file-path': legacyKey },
    payload: Buffer.from(bytes),
  })
}

beforeEach(async () => {
  process.env.LOG_LEVEL = 'silent'
  dataDir = fs.mkdtempSync(path.join(tmpdir(), 'risu-maintenance-staging-'))
  ;({ app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      importMaxBytes: 1024 * 1024,
      trustProxy: false,
      hubUrl: 'https://realm.test',
      realmUrl: 'https://realm.test',
    },
    assetGc: false,
    memoryWorker: false,
  }))
  ;({ assertion } = await setupAuthedClient(app))
  const initialized = await app.inject({
    method: 'POST',
    url: '/api/v1/commands/state/initialize',
    headers: headers(),
    payload: {},
  })
  expect(initialized.statusCode, initialized.body).toBe(200)
})

afterEach(async () => {
  converterControl.pause = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await app.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('maintenance admission for compatibility files and import staging', () => {
  it('rejects conflicting writes and imports before Realm SSE starts while compatibility reads continue', async () => {
    expect((await writeLegacy('preserved')).statusCode).toBe(200)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const lease = getMaintenanceCoordinator(dataDir).beginExclusive('backup')
    try {
      const responses = [
        await writeLegacy('replacement'),
        await app.inject({
          method: 'POST',
          url: '/api/v1/storage/remove',
          headers: { ...headers(), 'file-path': legacyKey },
        }),
        await requestLocalCharacter(),
        await app.inject({
          method: 'POST',
          url: '/api/v1/import/module',
          headers: headers(),
          payload: { baseRevision: readState().revision, pendingImportToken: 'unclaimed-token' },
        }),
        await app.inject({
          method: 'POST',
          url: '/api/v1/import/realm-character',
          headers: { ...headers(), accept: 'text/event-stream' },
          payload: { baseRevision: readState().revision, id: 'realm-card' },
        }),
      ]
      for (const response of responses) {
        expect(response.statusCode, response.body).toBe(503)
        expect(response.json()).toMatchObject({ error: 'maintenance_busy' })
        expect(response.headers['content-type']).toContain('application/json')
      }
      expect(fetchMock).not.toHaveBeenCalled()
      const read = await app.inject({
        method: 'GET',
        url: '/api/v1/storage/read',
        headers: { ...headers(), 'file-path': legacyKey },
      })
      expect(read.statusCode).toBe(200)
      expect(read.body).toBe('preserved')
    } finally {
      lease.release()
    }
  })

  it('keeps a cancelled compatibility write protected until partial bytes are removed', async () => {
    expect((await writeLegacy('old bytes')).statusCode).toBe(200)
    const entered = deferred()
    const resume = deferred()
    const originalWrite = fs.promises.writeFile.bind(fs.promises)
    vi.spyOn(fs.promises, 'writeFile').mockImplementation(async (file, bytes, options) => {
      await originalWrite(file, bytes, options)
      if (String(file).includes('.legacy-storage-')) {
        entered.resolve()
        await resume.promise
      }
    })
    const pendingWrite = writeLegacy('new bytes').then((response) => response)
    const coordinator = getMaintenanceCoordinator(dataDir)
    let drained = false
    try {
      await entered.promise
      expect(() => coordinator.beginExclusive('backup')).toThrow(MaintenanceBusyError)
      const close = coordinator.close().then(() => {
        drained = true
      })
      await Promise.resolve()
      expect(drained).toBe(false)
      resume.resolve()
      const response = await pendingWrite
      await close
      expect(response.statusCode).toBeGreaterThanOrEqual(400)
      expect(fs.readFileSync(path.join(dataDir, 'save', legacyKey), 'utf8')).toBe('old bytes')
      expect(fs.readdirSync(path.join(dataDir, 'save'))).toEqual([legacyKey])
    } finally {
      resume.resolve()
      await pendingWrite
    }
  })

  it('finishes durability and accepts a compatibility replacement already renamed during shutdown', async () => {
    const entered = deferred()
    const resume = deferred()
    const originalRename = fs.promises.rename.bind(fs.promises)
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      await originalRename(from, to)
      if (String(from).includes('.legacy-storage-')) {
        entered.resolve()
        await resume.promise
      }
    })
    const pendingWrite = writeLegacy('committed bytes').then((response) => response)
    try {
      await entered.promise
      const close = getMaintenanceCoordinator(dataDir).close()
      resume.resolve()
      const response = await pendingWrite
      await close
      expect(response.statusCode, response.body).toBe(200)
      expect(response.json()).toEqual({ success: true })
      expect(fs.readFileSync(path.join(dataDir, 'save', legacyKey), 'utf8')).toBe('committed bytes')
    } finally {
      resume.resolve()
      await pendingWrite
    }
  })

  it('releases staging while a local import waits for user confirmation', async () => {
    const pending = await requestLocalCharacter(true)
    expect(pending.statusCode, pending.body).toBe(409)
    expect(pending.json().code).toBe('low_level_access_confirmation_required')
    expect(readState().assets).toEqual([])
    const exclusive = getMaintenanceCoordinator(dataDir).beginExclusive('backup')
    exclusive.release()
    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/import/character-card',
      headers: headers(),
      payload: {
        baseRevision: readState().revision,
        pendingImportToken: pending.json().pendingImportToken,
        allowLowLevelAccess: true,
      },
    })
    expect(accepted.statusCode, accepted.body).toBe(200)
    const after = getMaintenanceCoordinator(dataDir).beginExclusive('backup')
    after.release()
  })

  it('allows maintenance during temporary upload intake and rechecks admission before decoding', async () => {
    const entered = deferred()
    const resume = deferred()
    let uploadDir: string | undefined
    const originalMkdtemp = fs.promises.mkdtemp.bind(fs.promises)
    vi.spyOn(fs.promises, 'mkdtemp').mockImplementation(async (prefix) => {
      const created = await originalMkdtemp(prefix)
      if (String(prefix).includes('risu-character-import-')) {
        uploadDir = created
        entered.resolve()
        await resume.promise
      }
      return created
    })
    const pendingImport = requestLocalCharacter().then((response) => response)
    let lease: MaintenanceLease | undefined
    try {
      await entered.promise
      lease = getMaintenanceCoordinator(dataDir).beginExclusive('backup')
      resume.resolve()
      const response = await pendingImport
      expect(response.statusCode, response.body).toBe(503)
      expect(response.json()).toMatchObject({ error: 'maintenance_busy' })
      expect(readState().assets).toEqual([])
      expect(readState().characterCount).toBe(0)
      await vi.waitFor(() => expect(fs.existsSync(uploadDir!)).toBe(false))
    } finally {
      resume.resolve()
      await pendingImport
      lease?.release()
    }
  })

  it.each(['local', 'realm'] as const)(
    'drains %s CharX staging across conversion and prevents a cancelled character commit',
    async (source) => {
      const entered = deferred()
      const resume = deferred()
      converterControl.pause = async () => {
        entered.resolve()
        await resume.promise
      }
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(characterArchive(), { headers: { 'content-type': 'application/charx' } })),
      )
      const pendingImport = (
        source === 'local'
          ? requestLocalCharacter()
          : app.inject({
              method: 'POST',
              url: '/api/v1/import/realm-character',
              headers: headers(),
              payload: { baseRevision: readState().revision, id: 'realm-card' },
            })
      ).then((response) => response)
      const coordinator = getMaintenanceCoordinator(dataDir)
      let drained = false
      try {
        await entered.promise
        expect(fs.readFileSync(path.join(dataDir, 'assets', `${imageId}.png`))).toEqual(imageBytes)
        expect(() => coordinator.beginExclusive('backup')).toThrow(MaintenanceBusyError)
        const close = coordinator.close().then(() => {
          drained = true
        })
        await Promise.resolve()
        expect(drained).toBe(false)
        resume.resolve()
        const response = await pendingImport
        await close
        expect(response.statusCode).toBeGreaterThanOrEqual(400)
        expect(readState().characterCount).toBe(0)
        if (source === 'realm') {
          expect(readState().assets).toEqual([])
          expect(fs.existsSync(path.join(dataDir, 'assets', `${imageId}.png`))).toBe(false)
        }
      } finally {
        resume.resolve()
        await pendingImport
      }
    },
  )
})
