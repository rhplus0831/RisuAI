import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { cpus, platform, release, tmpdir, totalmem } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.js'
import { runAssetGc } from '../src/assetGc.js'
import { openDatabase } from '../src/db.js'
import {
  assetPath,
  assetsDir,
  backupDir,
  createBackup,
  getAllAssetMetadata,
  insertAssetMetadataBatch,
  writePersistedWithMessages,
  type PersistedAsset,
} from '../src/repository.js'
import { setupAuthedClient } from './helpers/auth.js'

// Only the test wraps the real online backup. These marks also distinguish
// progress during SQLite's existing await from progress during asset copying.
const snapshotMarks = vi.hoisted(() => ({ start: 0, end: 0 }))
vi.mock('node:sqlite', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:sqlite')>()
  return {
    ...original,
    backup: async (...args: Parameters<typeof original.backup>) => {
      snapshotMarks.start = performance.now()
      try {
        return await original.backup(...args)
      } finally {
        snapshotMarks.end = performance.now()
      }
    },
  }
})

const MATRIX_ENABLED = process.env.RISU_MAINTENANCE_COSTS === '1'
const REPETITIONS = Number(process.env.RISU_MAINTENANCE_COST_REPETITIONS ?? 3)
const ASSET_BYTES = 1024
const NOW = 1_800_000_000_000
const OLD_MTIME = (NOW - 2 * 60 * 60_000) / 1000
const SAVE_BYTES = Buffer.from('synthetic compatibility save\n'.repeat(32))
const immediate = () => new Promise<void>((resolve) => setImmediate(resolve))

interface Fixture {
  dataDir: string
  db: DatabaseSync
  assets: PersistedAsset[]
  referencedIds: string[]
  orphanIds: string[]
  characterCount: number
  messageCount: number
}

function seedFixture(assetCount: number): Fixture {
  const dataDir = fs.mkdtempSync(path.join(tmpdir(), 'risu-maintenance-cost-'))
  const db = openDatabase(dataDir)
  const assets: PersistedAsset[] = []
  fs.mkdirSync(assetsDir(dataDir), { recursive: true })
  for (let index = 0; index < assetCount; index++) {
    const bytes = Buffer.alloc(ASSET_BYTES, index % 251)
    bytes.writeUInt32LE(index)
    const id = createHash('sha256').update(bytes).digest('hex')
    const asset = { id, ext: 'bin', size: bytes.length, contentType: 'application/octet-stream' }
    assets.push(asset)
    const file = assetPath(dataDir, asset)
    fs.writeFileSync(file, bytes)
    fs.utimesSync(file, OLD_MTIME, OLD_MTIME)
  }
  const referencedIds = assets.slice(0, assetCount / 2).map((asset) => asset.id)
  const orphanIds = assets.slice(assetCount / 2).map((asset) => asset.id)
  const characterCount = assetCount / 10
  const characters = Array.from({ length: characterCount }, (_, characterIndex) => ({
    chaId: `maintenance-character-${characterIndex}`,
    type: 'character',
    name: `Synthetic ${characterIndex}`,
    image: referencedIds[characterIndex % referencedIds.length],
    chats: Array.from({ length: 2 }, (_, chatIndex) => ({
      id: `maintenance-chat-${characterIndex}-${chatIndex}`,
      message: Array.from({ length: 10 }, (_, messageIndex) => {
        const index = characterIndex * 20 + chatIndex * 10 + messageIndex
        return {
          chatId: `maintenance-message-${index}`,
          role: 'user',
          data: `${'x'.repeat(256)} {{inlay::${referencedIds[index % referencedIds.length]}}}`,
        }
      }),
    })),
  }))
  writePersistedWithMessages(db, dataDir, { _version: 1, database: { characters }, assets: [] })
  insertAssetMetadataBatch(db, assets)
  fs.mkdirSync(path.join(dataDir, 'save', 'nested'), { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'save', 'nested', 'compatibility.bin'), SAVE_BYTES)
  return { dataDir, db, assets, referencedIds, orphanIds, characterCount, messageCount: characterCount * 20 }
}

interface Observation {
  durationMs: number
  beforeSnapshotMs: number | null
  sqliteSnapshotMs: number | null
  afterSnapshotMs: number | null
  directoryCopyMs: number
  directoryCopyCalls: number
  eventLoopTurns: number
  eventLoopTurnsAfterSnapshot: number
  maxEventLoopGapMs: number
  apiResponsesDuringWork: number
  apiResponsesAfterSnapshot: number
  apiRequests: number
  maxApiResponseMs: number
  heapAtStartBytes: number
  sampledPeakHeapBytes: number
  rssAtStartBytes: number
  sampledPeakRssBytes: number
  processLifetimePeakRssBytes: number
}

async function observe<T>(
  app: FastifyInstance,
  assertion: string,
  action: () => T | Promise<T>,
): Promise<{ value: T; observation: Observation }> {
  snapshotMarks.start = 0
  snapshotMarks.end = 0
  const initialMemory = process.memoryUsage()
  const startedAt = performance.now()
  let finishedAt = startedAt
  let active = true
  let lastTurn = startedAt
  const observation: Observation = {
    durationMs: 0,
    beforeSnapshotMs: null,
    sqliteSnapshotMs: null,
    afterSnapshotMs: null,
    directoryCopyMs: 0,
    directoryCopyCalls: 0,
    eventLoopTurns: 0,
    eventLoopTurnsAfterSnapshot: 0,
    maxEventLoopGapMs: 0,
    apiResponsesDuringWork: 0,
    apiResponsesAfterSnapshot: 0,
    apiRequests: 0,
    maxApiResponseMs: 0,
    heapAtStartBytes: initialMemory.heapUsed,
    sampledPeakHeapBytes: initialMemory.heapUsed,
    rssAtStartBytes: initialMemory.rss,
    sampledPeakRssBytes: initialMemory.rss,
    processLifetimePeakRssBytes: 0,
  }
  const sampleMemory = () => {
    const memory = process.memoryUsage()
    observation.sampledPeakHeapBytes = Math.max(observation.sampledPeakHeapBytes, memory.heapUsed)
    observation.sampledPeakRssBytes = Math.max(observation.sampledPeakRssBytes, memory.rss)
  }
  // This diagnostic records current recursive-copy calls, including a future
  // switch to fs.promises.cp. Total post-snapshot cost stays comparable if the
  // implementation instead chooses a bounded copyFile loop or a worker.
  const realCpSync = fs.cpSync
  const realCp = fs.promises.cp
  const copySyncSpy = vi.spyOn(fs, 'cpSync').mockImplementation((...args) => {
    const start = performance.now()
    observation.directoryCopyCalls++
    try {
      return realCpSync(...args)
    } finally {
      observation.directoryCopyMs += performance.now() - start
      sampleMemory()
    }
  })
  const copyAsyncSpy = vi.spyOn(fs.promises, 'cp').mockImplementation(async (...args) => {
    const start = performance.now()
    observation.directoryCopyCalls++
    try {
      return await realCp(...args)
    } finally {
      observation.directoryCopyMs += performance.now() - start
      sampleMemory()
    }
  })
  const heartbeat = new Promise<void>((resolve) => {
    const tick = () => {
      const now = performance.now()
      // The final callback captures a wholly synchronous operation's stall.
      observation.maxEventLoopGapMs = Math.max(observation.maxEventLoopGapMs, (active ? now : finishedAt) - lastTurn)
      lastTurn = now
      if (!active) return resolve()
      observation.eventLoopTurns++
      if (snapshotMarks.end) observation.eventLoopTurnsAfterSnapshot++
      sampleMemory()
      setImmediate(tick)
    }
    setImmediate(tick)
  })
  // One real authenticated request is pending when maintenance starts; another
  // starts each turn while it is active. The empty catalog response stays fixed
  // as character/message/asset fixture dimensions grow. No network or provider
  // traffic is needed: Fastify inject executes the real auth and route hooks.
  const requests = (async () => {
    do {
      const start = performance.now()
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/inlay-assets',
        headers: { 'risu-auth': assertion },
      })
      observation.apiRequests++
      observation.maxApiResponseMs = Math.max(observation.maxApiResponseMs, performance.now() - start)
      expect(response.statusCode).toBe(200)
      if (!active) return
      observation.apiResponsesDuringWork++
      if (snapshotMarks.end) observation.apiResponsesAfterSnapshot++
      await immediate()
    } while (active)
  })()
  try {
    const value = await action()
    return { value, observation }
  } finally {
    finishedAt = performance.now()
    active = false
    observation.durationMs = finishedAt - startedAt
    if (snapshotMarks.end) {
      observation.beforeSnapshotMs = snapshotMarks.start - startedAt
      observation.sqliteSnapshotMs = snapshotMarks.end - snapshotMarks.start
      observation.afterSnapshotMs = finishedAt - snapshotMarks.end
    }
    sampleMemory()
    observation.processLifetimePeakRssBytes = process.resourceUsage().maxRSS * 1024
    copySyncSpy.mockRestore()
    copyAsyncSpy.mockRestore()
    await Promise.all([heartbeat, requests])
  }
}

function verifyBackup(fixture: Fixture, backupId: string): void {
  const root = backupDir(fixture.dataDir, backupId)
  const snapshot = new DatabaseSync(path.join(root, 'risu.db'), { readOnly: true })
  try {
    const assets = getAllAssetMetadata(snapshot)
    expect(assets).toEqual(getAllAssetMetadata(fixture.db))
    expect(snapshot.prepare('SELECT count(*) AS n FROM characters').get()).toEqual({ n: fixture.characterCount })
    expect(snapshot.prepare('SELECT count(*) AS n FROM messages').get()).toEqual({ n: fixture.messageCount })
    for (const asset of assets) {
      const bytes = fs.readFileSync(assetPath(root, asset))
      expect(bytes.length).toBe(asset.size)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.id)
    }
    expect(fs.readFileSync(path.join(root, 'save', 'nested', 'compatibility.bin'))).toEqual(SAVE_BYTES)
  } finally {
    snapshot.close()
  }
}

async function runFixture(assetCount: number) {
  const fixture = seedFixture(assetCount)
  let app: FastifyInstance | undefined
  try {
    const built = await buildApp({
      config: {
        host: '127.0.0.1',
        port: 0,
        dataDir: fixture.dataDir,
        bodyLimit: 1024 * 1024,
        importMaxBytes: Infinity,
        trustProxy: false,
        hubUrl: 'https://sv.risuai.xyz',
      },
      memoryWorker: false,
      bardWikiWorker: false,
      assetGc: false,
      generationChat: { finalizationRetry: false },
    })
    app = built.app
    const { assertion } = await setupAuthedClient(app)
    const unauthorized = await app.inject({ method: 'GET', url: '/api/v1/inlay-assets' })
    expect(unauthorized.statusCode).toBe(401)
    const backup = await observe(app, assertion, () =>
      createBackup(fixture.db, fixture.dataDir, 'Synthetic cost probe'),
    )
    expect(backup.value.assetCount).toBe(assetCount)
    verifyBackup(fixture, backup.value.id)
    const gc = await observe(app, assertion, () => runAssetGc(fixture.dataDir, { db: fixture.db, now: () => NOW }))
    expect(gc.value.deletedAssetIds.slice().sort()).toEqual(fixture.orphanIds.slice().sort())
    expect(gc.value.scannedOrphans).toBe(fixture.orphanIds.length)
    expect(gc.value.skippedByGrace).toBe(0)
    expect(
      getAllAssetMetadata(fixture.db)
        .map((asset) => asset.id)
        .sort(),
    ).toEqual(fixture.referencedIds.slice().sort())
    for (const asset of fixture.assets) {
      const exists = fs.existsSync(assetPath(fixture.dataDir, asset))
      expect(exists).toBe(fixture.referencedIds.includes(asset.id))
      // GC of live orphans must not remove the already captured backup bytes.
      expect(fs.existsSync(assetPath(backupDir(fixture.dataDir, backup.value.id), asset))).toBe(true)
    }
    return {
      fixture: {
        assetCount,
        assetBytes: ASSET_BYTES,
        totalAssetBytes: assetCount * ASSET_BYTES,
        referencedAssetCount: fixture.referencedIds.length,
        orphanAssetCount: fixture.orphanIds.length,
        characterCount: fixture.characterCount,
        chatsPerCharacter: 2,
        messagesPerChat: 10,
        messageCount: fixture.messageCount,
        messagePrefixBytes: 256,
        compatibilitySaveFiles: 1,
        compatibilitySaveBytes: SAVE_BYTES.length,
      },
      backup: backup.observation,
      gc: gc.observation,
    }
  } finally {
    await app?.close()
    fixture.db.close()
    fs.rmSync(fixture.dataDir, { recursive: true, force: true })
  }
}

describe('maintenance cost probe', () => {
  it('checks snapshot byte consistency and GC progress instrumentation on a small fixture', async () => {
    vi.stubEnv('LOG_LEVEL', 'silent')
    try {
      const result = await runFixture(20)
      expect(result.backup.sqliteSnapshotMs).not.toBeNull()
      expect(result.backup.apiRequests).toBeGreaterThan(0)
      expect(result.gc.apiRequests).toBeGreaterThan(0)
      // Responsiveness is reported, never asserted to remain at the blocking
      // baseline. Phase 4 adds positive progress gates after choosing bounds.
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it.skipIf(!MATRIX_ENABLED)(
    'reports the isolated small/intermediate/large maintenance matrix',
    async () => {
      expect(Number.isInteger(REPETITIONS) && REPETITIONS > 0 && REPETITIONS <= 20).toBe(true)
      vi.stubEnv('LOG_LEVEL', 'silent')
      try {
        const environment = {
          sourceAnchor: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
          node: process.version,
          platform: platform(),
          release: release(),
          cpu: cpus()[0]?.model,
          logicalCpus: cpus().length,
          hostMemoryBytes: totalmem(),
          repetitions: REPETITIONS,
          warmupPerSize: 1,
          cacheState: 'Fresh temporary files each repetition; OS page cache is not flushed',
          concurrency: 'One injected authenticated GET plus one setImmediate heartbeat',
          memoryMethod:
            'Samples at operation boundaries, recursive-copy completion, and heartbeat; process maxRSS is lifetime high-water, not per-operation peak',
          phaseMethod:
            'Real node:sqlite backup marks; post-snapshot includes copies and manifest; recursive cp timings sum calls and exclude retention, which createBackup does not run',
        }
        console.log('MAINTENANCE_COST_ENV', JSON.stringify(environment))
        const samples: Array<{ repetition: number } & Awaited<ReturnType<typeof runFixture>>> = []
        for (const assetCount of [20, 200, 2000]) {
          await runFixture(assetCount)
          for (let repetition = 1; repetition <= REPETITIONS; repetition++) {
            const sample = { repetition, ...(await runFixture(assetCount)) }
            samples.push(sample)
            console.log('MAINTENANCE_COST', JSON.stringify(sample))
          }
        }
        const artifactDir = path.resolve(import.meta.dirname, '../../../fast-bootstrap-results/maintainability')
        fs.mkdirSync(artifactDir, { recursive: true })
        fs.writeFileSync(
          path.join(artifactDir, 'maintenance-costs.json'),
          `${JSON.stringify({ environment, samples }, null, 2)}\n`,
        )
      } finally {
        vi.unstubAllEnvs()
      }
    },
    180_000,
  )
})
