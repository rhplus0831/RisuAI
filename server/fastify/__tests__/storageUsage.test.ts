import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, link, symlink, rm, statfs } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { isStorageUsageResponse } from '@risuai/protocol/storage-usage'
import { measureStorageUsage } from '../src/storageUsage.js'
import { registerStorageUsageRoutes } from '../src/routes/storageUsage.js'
import { createAuthState } from '../src/auth.js'

let root: string
let dataDir: string
let app: FastifyInstance | undefined

async function file(name: string, bytes: number): Promise<void> {
  const target = path.join(dataDir, name)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, Buffer.alloc(bytes))
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'risu-storage-usage-'))
  dataDir = path.join(root, 'data')
  await mkdir(dataDir)
})

afterEach(async () => {
  await app?.close()
  app = undefined
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

describe('server storage usage', () => {
  it('measures actual files including journals, nested backups, traces and unknown files', async () => {
    await file('risu.db', 100)
    await file('risu.db-wal', 20)
    await file('risu.db-shm', 10)
    await file('assets/image.png', 40)
    await file('backups/snapshot/risu.db', 100)
    await file('backups/snapshot/assets/image.png', 40)
    await file('save/abcd', 5)
    await file('trace/bodies/agent/body.gz', 6)
    await file('__password', 7)
    await file('.restore-staging/risu.db', 8)
    const report = await measureStorageUsage(dataDir)
    expect(report.categories).toEqual({
      database: 100,
      journal: 30,
      assets: 40,
      backups: 140,
      legacy: 5,
      logs: 6,
      other: 15,
    })
    expect(report.totalBytes).toBe(336)
    expect(report.partial).toBe(false)
    expect(isStorageUsageResponse(report)).toBe(true)
    const disk = await statfs(dataDir)
    expect(report.disk?.totalBytes).toBe(disk.blocks * disk.bsize)
    expect(report.disk?.availableBytes).toBeGreaterThan(0)
  })

  it('counts hard links once and does not follow symlinks outside the data tree or in cycles', async () => {
    await file('assets/a.png', 30)
    await link(path.join(dataDir, 'assets/a.png'), path.join(dataDir, 'assets/b.png'))
    await mkdir(path.join(dataDir, 'backups'))
    await link(path.join(dataDir, 'assets/a.png'), path.join(dataDir, 'backups/c.png'))
    await writeFile(path.join(root, 'outside'), Buffer.alloc(100))
    await symlink(path.join(root, 'outside'), path.join(dataDir, 'external'))
    await symlink(dataDir, path.join(dataDir, 'cycle'))
    const report = await measureStorageUsage(dataDir)
    expect(report.totalBytes).toBe(30)
    expect(report.categories.assets).toBe(30)
    expect(report.categories.backups).toBe(0)
    expect(report.partial).toBe(true)
  })

  it('reports empty storage and supports cancellation without creating files', async () => {
    expect((await measureStorageUsage(dataDir)).totalBytes).toBe(0)
    await expect(measureStorageUsage(dataDir, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' })
    await expect(measureStorageUsage(path.join(root, 'missing'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('supports a configured data directory that points to another volume by symlink', async () => {
    await file('risu.db', 100)
    const alias = path.join(root, 'data-alias')
    await symlink(dataDir, alias)
    const report = await measureStorageUsage(alias)
    expect(report.categories.database).toBe(100)
    expect(report.partial).toBe(false)
  })

  it('requires authentication and returns fresh no-store totals without a writer session', async () => {
    app = Fastify()
    const auth = createAuthState(dataDir)
    registerStorageUsageRoutes(app, auth, dataDir)
    expect((await app.inject('/api/v1/storage-usage')).statusCode).toBe(401)
    auth.agentDevAuthBypass = true
    await file('assets/image.png', 10)
    const first = await app.inject('/api/v1/storage-usage')
    expect(first.statusCode).toBe(200)
    expect(first.headers['cache-control']).toBe('no-store')
    expect(isStorageUsageResponse(first.json())).toBe(true)
    expect(first.json().categories.assets).toBe(10)
    await file('assets/image.png', 50)
    const second = await app.inject('/api/v1/storage-usage')
    expect(second.json().categories.assets).toBe(50)
  })
})
