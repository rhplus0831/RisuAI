import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const platformState = vi.hoisted(() => ({ isFastifyServer: true }))

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
  getNodeServerProxyAuth: async () => 'test-auth-token',
}))

import {
  canUseServerCommands,
  clearCachedServerCommandRevision,
  getServerCommandBaseRevision,
  patchRuntimeSettings,
  patchSettingsGroup,
} from './commands'

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

function makeCommandFetch(bodyForUrl: (url: string, init: RequestInit) => unknown): {
  calls: CapturedFetch[]
  fetch: typeof fetch
} {
  const calls: CapturedFetch[] = []
  return {
    calls,
    fetch: vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = init.headers as Record<string, string> | undefined
      const rawBody = typeof init.body === 'string' ? JSON.parse(init.body) : null
      const url = String(input)
      calls.push({
        url,
        method: init.method ?? 'GET',
        authHeader: headers?.['risu-auth'] ?? null,
        contentType: headers?.['content-type'] ?? null,
        body: rawBody,
      })
      const body = bodyForUrl(url, init)
      return body instanceof Response ? body : jsonResponse(body)
    }) as unknown as typeof fetch,
  }
}

beforeEach(() => {
  platformState.isFastifyServer = true
  clearCachedServerCommandRevision()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('server command API adapter', () => {
  it('reports availability from the Fastify platform gate', () => {
    expect(canUseServerCommands()).toBe(true)
    platformState.isFastifyServer = false
    expect(canUseServerCommands()).toBe(false)
  })

  it('patches runtime settings with the auth header and baseRevision', async () => {
    const event = { type: 'settings.updated', revision: 2, resource: 'settings' }
    const commandFetch = makeCommandFetch(() => ({ revision: 2, event }))
    vi.stubGlobal('fetch', commandFetch.fetch)

    const result = await patchRuntimeSettings({
      baseRevision: 1,
      patch: { useServerPromptAssembly: true },
    })

    expect(result).toEqual({ status: 'ok', revision: 2, event })
    expect(commandFetch.calls).toEqual([
      {
        url: '/api/v1/commands/settings/runtime',
        method: 'PATCH',
        authHeader: 'test-auth-token',
        contentType: 'application/json',
        body: {
          baseRevision: 1,
          patch: { useServerPromptAssembly: true },
        },
      },
    ])
  })

  it('patches grouped scalar settings with the auth header and baseRevision', async () => {
    const event = { type: 'settings.updated', revision: 3, resource: 'settings' }
    const commandFetch = makeCommandFetch(() => ({ revision: 3, event }))
    vi.stubGlobal('fetch', commandFetch.fetch)

    const result = await patchSettingsGroup({
      group: 'display',
      baseRevision: 2,
      patch: { theme: 'light', zoomsize: 90 },
    })

    expect(result).toEqual({ status: 'ok', revision: 3, event })
    expect(commandFetch.calls).toEqual([
      {
        url: '/api/v1/commands/settings/display',
        method: 'PATCH',
        authHeader: 'test-auth-token',
        contentType: 'application/json',
        body: {
          baseRevision: 2,
          patch: { theme: 'light', zoomsize: 90 },
        },
      },
    ])
  })

  it('reads and caches the command base revision from bootstrap', async () => {
    const commandFetch = makeCommandFetch(() => ({ revision: 12 }))
    vi.stubGlobal('fetch', commandFetch.fetch)

    await expect(getServerCommandBaseRevision()).resolves.toBe(12)
    await expect(getServerCommandBaseRevision()).resolves.toBe(12)

    expect(commandFetch.calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'test-auth-token',
        contentType: null,
        body: null,
      },
    ])
  })

  it('maps revision conflicts to a typed conflict result', async () => {
    const commandFetch = makeCommandFetch(() =>
      jsonResponse({ error: 'revision_conflict', currentRevision: 7 }, 409),
    )
    vi.stubGlobal('fetch', commandFetch.fetch)

    const result = await patchRuntimeSettings({
      baseRevision: 6,
      patch: { useServerPromptAssembly: true },
    })

    expect(result).toEqual({ status: 'conflict', currentRevision: 7 })
  })

  it('maps command errors to status:error', async () => {
    const commandFetch = makeCommandFetch(() =>
      jsonResponse({ error: 'useServerPromptAssembly must be a boolean' }, 400),
    )
    vi.stubGlobal('fetch', commandFetch.fetch)

    const result = await patchRuntimeSettings({
      baseRevision: 1,
      patch: { useServerPromptAssembly: true },
    })

    expect(result).toEqual({
      status: 'error',
      error: 'useServerPromptAssembly must be a boolean',
    })
  })

  it('does not fetch when server commands are unavailable', async () => {
    platformState.isFastifyServer = false
    const commandFetch = makeCommandFetch(() => ({ revision: 2 }))
    vi.stubGlobal('fetch', commandFetch.fetch)

    const result = await patchRuntimeSettings({
      baseRevision: 1,
      patch: { useServerPromptAssembly: true },
    })

    expect(result).toEqual({ status: 'unavailable' })
    expect(commandFetch.calls).toEqual([])
  })
})
