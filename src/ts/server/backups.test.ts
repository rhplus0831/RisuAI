import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const platformState = vi.hoisted(() => ({ isFastifyServer: true }))
const projectionResyncSpies = vi.hoisted(() => ({
  hydrateActiveCharacterLorebook: vi.fn(async () => undefined),
  hydrateActiveChat: vi.fn(async () => undefined),
  recordHydratedCharacterLorebooks: vi.fn(),
  resetChatHydration: vi.fn(),
  resetLorebookHydration: vi.fn(),
  setActiveGenerationJobs: vi.fn(),
  triggerOpenChatGenerationReattach: vi.fn(),
}))

vi.mock('../platform', async (importActual) => {
  const actual = await importActual<typeof import('../platform')>()
  return {
    ...actual,
    get isFastifyServer() {
      return platformState.isFastifyServer
    },
  }
})

vi.mock('../storage/nodeStorage', () => ({
  getNodeServerProxyAuth: async () => 'backup-auth-token',
}))

vi.mock('./chatMessageHydration.svelte', () => ({
  hydrateActiveCharacterLorebook: projectionResyncSpies.hydrateActiveCharacterLorebook,
  hydrateActiveChat: projectionResyncSpies.hydrateActiveChat,
  resetChatHydration: projectionResyncSpies.resetChatHydration,
}))

vi.mock('./lorebookBridge.svelte', () => ({
  recordHydratedCharacterLorebooks: projectionResyncSpies.recordHydratedCharacterLorebooks,
  resetLorebookHydration: projectionResyncSpies.resetLorebookHydration,
}))

vi.mock('../process/reattach', () => ({
  setActiveGenerationJobs: projectionResyncSpies.setActiveGenerationJobs,
  triggerOpenChatGenerationReattach: projectionResyncSpies.triggerOpenChatGenerationReattach,
}))

vi.mock('../process/modules', () => ({
  getModuleLorebooks: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

import {
  canUseServerBackups,
  createServerBackup,
  deleteServerBackup,
  exportServerBundle,
  importServerBundle,
  listServerBackups,
  restoreServerBackup,
} from './backups'
import { clearCachedServerCommandRevision, peekCachedServerCommandRevision } from './commands'
import { DBState } from '../stores.svelte'

interface CapturedFetch {
  url: string
  method: string
  authHeader: string | null
  contentType: string | null
  body: unknown
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeBackupFetch(bodyForUrl: (url: string, init: RequestInit) => unknown): {
  calls: CapturedFetch[]
  fetch: typeof fetch
} {
  const calls: CapturedFetch[] = []
  return {
    calls,
    fetch: vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = init.headers as Record<string, string> | undefined
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      const url = String(input)
      calls.push({
        url,
        method: init.method ?? 'GET',
        authHeader: headers?.['risu-auth'] ?? null,
        contentType: headers?.['content-type'] ?? null,
        body,
      })
      const responseBody = bodyForUrl(url, init)
      return responseBody instanceof Response ? responseBody : jsonResponse(responseBody)
    }) as unknown as typeof fetch,
  }
}

const backupManifest = {
  _version: 1,
  id: '2026-05-26-01-02-03-abcdef',
  label: 'manual',
  createdAt: '2026-05-26T01:02:03.000Z',
  revision: 7,
  assetCount: 2,
}

beforeEach(() => {
  platformState.isFastifyServer = true
  vi.stubGlobal('safeStructuredClone', (value: unknown) => JSON.parse(JSON.stringify(value)))
  clearCachedServerCommandRevision()
  DBState.db = {} as any
  projectionResyncSpies.hydrateActiveCharacterLorebook.mockClear()
  projectionResyncSpies.hydrateActiveChat.mockClear()
  projectionResyncSpies.recordHydratedCharacterLorebooks.mockClear()
  projectionResyncSpies.resetChatHydration.mockClear()
  projectionResyncSpies.resetLorebookHydration.mockClear()
  projectionResyncSpies.setActiveGenerationJobs.mockClear()
  projectionResyncSpies.triggerOpenChatGenerationReattach.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('server backup helpers', () => {
  it('reports availability from the Fastify platform gate', async () => {
    expect(canUseServerBackups()).toBe(true)
    platformState.isFastifyServer = false
    expect(canUseServerBackups()).toBe(false)

    const backupFetch = makeBackupFetch(() => backupManifest)
    vi.stubGlobal('fetch', backupFetch.fetch)

    await expect(listServerBackups()).resolves.toEqual({ status: 'unavailable' })
    expect(backupFetch.calls).toEqual([])
  })

  it('creates and lists backups with auth headers', async () => {
    const backupFetch = makeBackupFetch((url, init) => {
      if (url === '/api/v1/backups' && init.method === 'GET') return { backups: [backupManifest] }
      return backupManifest
    })
    vi.stubGlobal('fetch', backupFetch.fetch)

    await expect(createServerBackup({ label: 'manual' })).resolves.toEqual({
      status: 'ok',
      backup: backupManifest,
    })
    await expect(listServerBackups()).resolves.toEqual({
      status: 'ok',
      backups: [backupManifest],
    })

    expect(backupFetch.calls).toEqual([
      {
        url: '/api/v1/backups',
        method: 'POST',
        authHeader: 'backup-auth-token',
        contentType: 'application/json',
        body: { label: 'manual' },
      },
      {
        url: '/api/v1/backups',
        method: 'GET',
        authHeader: 'backup-auth-token',
        contentType: null,
        body: null,
      },
    ])
  })

  it('restores backups, refreshes projection, and then caches the bootstrap revision', async () => {
    const event = { type: 'state.restored', resource: 'state', revision: 12 }
    const backupFetch = makeBackupFetch((url) => {
      if (url === '/api/v1/backups/2026-05-26-01-02-03-abcdef/restore') {
        return { revision: 12, event }
      }
      if (url === '/api/v1/bootstrap') {
        return {
          revision: 12,
          database: {
            characters: [{ chaId: 'char-a', name: 'Restored', chats: [] }],
            modules: [],
            personas: [],
            language: 'ko',
          },
          activeGenerationJobs: [{ chatId: 'chat-a', jobId: 'job-a' }],
        }
      }
      return { revision: 13, database: { characters: [], modules: [], personas: [] } }
    })
    vi.stubGlobal('fetch', backupFetch.fetch)

    await expect(restoreServerBackup({ id: backupManifest.id })).resolves.toEqual({
      status: 'ok',
      revision: 12,
      event,
    })
    expect(peekCachedServerCommandRevision()).toBe(12)
    expect(DBState.db).toMatchObject({
      language: 'ko',
      characters: [{ chaId: 'char-a', name: 'Restored', chats: [] }],
    })
    expect(projectionResyncSpies.setActiveGenerationJobs).toHaveBeenCalledWith([
      { chatId: 'chat-a', jobId: 'job-a' },
    ])
    expect(projectionResyncSpies.triggerOpenChatGenerationReattach).toHaveBeenCalledTimes(1)
    expect(projectionResyncSpies.resetChatHydration).toHaveBeenCalled()
    expect(projectionResyncSpies.hydrateActiveChat).toHaveBeenCalledWith({ force: true })
    expect(backupFetch.calls).toHaveLength(2)
    expect(backupFetch.calls[0]).toMatchObject({
      url: '/api/v1/backups/2026-05-26-01-02-03-abcdef/restore',
      method: 'POST',
      authHeader: 'backup-auth-token',
    })
    expect(backupFetch.calls[1]).toMatchObject({
      url: '/api/v1/bootstrap',
      method: 'GET',
      authHeader: 'backup-auth-token',
    })
  })

  it('does not cache the restore revision when the required projection refresh fails', async () => {
    const backupFetch = makeBackupFetch((url) => {
      if (url === '/api/v1/backups/2026-05-26-01-02-03-abcdef/restore') {
        return { revision: 12, event: { type: 'state.restored', resource: 'state', revision: 12 } }
      }
      if (url === '/api/v1/bootstrap') {
        return jsonResponse({ error: 'bootstrap failed' }, 500)
      }
      return { revision: 13 }
    })
    vi.stubGlobal('fetch', backupFetch.fetch)

    await expect(restoreServerBackup({ id: backupManifest.id })).resolves.toEqual({
      status: 'error',
      error: 'Backup restored, but projection refresh failed: bootstrap failed',
    })
    expect(peekCachedServerCommandRevision()).toBeNull()
    expect(DBState.db).toEqual({})
  })

  it('deletes backups and reports server errors', async () => {
    const backupFetch = makeBackupFetch((url) => {
      if (url.endsWith('/missing')) return jsonResponse({ error: 'Backup not found' }, 404)
      return { id: backupManifest.id }
    })
    vi.stubGlobal('fetch', backupFetch.fetch)

    await expect(deleteServerBackup({ id: backupManifest.id })).resolves.toEqual({
      status: 'ok',
      id: backupManifest.id,
    })
    await expect(deleteServerBackup({ id: 'missing' })).resolves.toEqual({
      status: 'error',
      error: 'Backup not found',
    })
  })
})

describe('device backup helpers (Save/Load Backup Locally)', () => {
  const BUNDLE_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4])

  it('only downloads the bundle on the Fastify platform', async () => {
    platformState.isFastifyServer = false
    const backupFetch = makeBackupFetch(() => new Response(BUNDLE_BYTES))
    vi.stubGlobal('fetch', backupFetch.fetch)

    await expect(exportServerBundle()).resolves.toEqual({ status: 'unavailable' })
    expect(backupFetch.calls).toEqual([])
  })

  it('downloads the bundle bytes with an auth header and content-disposition filename', async () => {
    const backupFetch = makeBackupFetch(
      () =>
        new Response(BUNDLE_BYTES, {
          status: 200,
          headers: { 'content-disposition': 'attachment; filename="database.risu.zip"' },
        }),
    )
    vi.stubGlobal('fetch', backupFetch.fetch)

    const result = await exportServerBundle()
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.filename).toBe('database.risu.zip')
      expect(result.blob).toBeInstanceOf(Blob)
      expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(BUNDLE_BYTES)
    }
    expect(backupFetch.calls).toEqual([
      {
        url: '/api/v1/export/bundle',
        method: 'GET',
        authHeader: 'backup-auth-token',
        contentType: null,
        body: null,
      },
    ])
  })

  it('reports server errors when the bundle export fails', async () => {
    const backupFetch = makeBackupFetch(() =>
      jsonResponse({ error: 'database payload missing' }, 400),
    )
    vi.stubGlobal('fetch', backupFetch.fetch)

    await expect(exportServerBundle()).resolves.toEqual({
      status: 'error',
      error: 'database payload missing',
    })
  })

  it('uploads a bundle file, restores it, and refreshes the projection', async () => {
    const event = { type: 'state.imported', resource: 'state', revision: 21 }
    const backupFetch = makeBackupFetch((url) => {
      if (url === '/api/v1/import/bundle') return { revision: 21, event }
      if (url === '/api/v1/bootstrap') {
        return {
          revision: 21,
          database: {
            characters: [{ chaId: 'char-z', name: 'Imported', chats: [] }],
            modules: [],
            personas: [],
            language: 'en',
          },
        }
      }
      return { revision: 22 }
    })
    vi.stubGlobal('fetch', backupFetch.fetch)

    const file = new Blob([BUNDLE_BYTES], { type: 'application/zip' })
    await expect(importServerBundle({ file, filename: 'database.risu.zip' })).resolves.toEqual({
      status: 'ok',
      revision: 21,
      event,
    })
    expect(peekCachedServerCommandRevision()).toBe(21)
    expect(DBState.db).toMatchObject({
      language: 'en',
      characters: [{ chaId: 'char-z', name: 'Imported', chats: [] }],
    })

    expect(backupFetch.calls).toHaveLength(2)
    // The upload carries auth but no explicit content-type (the browser sets the
    // multipart boundary for the FormData body).
    expect(backupFetch.calls[0]).toMatchObject({
      url: '/api/v1/import/bundle',
      method: 'POST',
      authHeader: 'backup-auth-token',
      contentType: null,
    })
    expect(backupFetch.calls[1]).toMatchObject({ url: '/api/v1/bootstrap', method: 'GET' })
  })

  it('does not cache the import revision when the projection refresh fails', async () => {
    const backupFetch = makeBackupFetch((url) => {
      if (url === '/api/v1/import/bundle') {
        return { revision: 21, event: { type: 'state.imported', resource: 'state', revision: 21 } }
      }
      if (url === '/api/v1/bootstrap') return jsonResponse({ error: 'bootstrap failed' }, 500)
      return { revision: 22 }
    })
    vi.stubGlobal('fetch', backupFetch.fetch)

    const file = new Blob([BUNDLE_BYTES], { type: 'application/zip' })
    await expect(importServerBundle({ file })).resolves.toEqual({
      status: 'error',
      error: 'Backup imported, but projection refresh failed: bootstrap failed',
    })
    expect(peekCachedServerCommandRevision()).toBeNull()
    expect(DBState.db).toEqual({})
  })

  it('gates bundle import behind the Fastify platform', async () => {
    platformState.isFastifyServer = false
    const backupFetch = makeBackupFetch(() => ({ revision: 1 }))
    vi.stubGlobal('fetch', backupFetch.fetch)

    const file = new Blob([BUNDLE_BYTES], { type: 'application/zip' })
    await expect(importServerBundle({ file })).resolves.toEqual({ status: 'unavailable' })
    expect(backupFetch.calls).toEqual([])
  })
})
