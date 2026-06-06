import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const alertMocks = vi.hoisted(() => ({
  alertConfirm: vi.fn(),
  alertError: vi.fn(),
  alertInput: vi.fn(),
  alertNormal: vi.fn(),
}))

vi.mock('src/ts/platform', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('../../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'mcp-auth-token',
}))

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, getModuleMcps: () => [] }
})

vi.mock('src/ts/alert', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/alert')>()
  return {
    ...actual,
    alertConfirm: alertMocks.alertConfirm,
    alertError: alertMocks.alertError,
    alertInput: alertMocks.alertInput,
    alertNormal: alertMocks.alertNormal,
  }
})

import { clearCachedServerCommandRevision, type CommandEvent } from '../../server/commands'
import { setServerProjectionWriteGuardEnabled } from '../../server/projectionWriteGuard.svelte'
import { DBState } from '../../stores.svelte'
import { callOnlyMCPs, importMCPModule, MCPs, persistMCPRefreshToken } from './mcp'
import { registeredCustomPluginMCPs, registerMCPModule } from './pluginmcp'

interface CapturedFetch {
  url: string
  method: string
  body: unknown
  authHeader: string | null
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubCommandFetch(commandStatus = 200): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      const headers = init.headers as Record<string, string> | undefined
      calls.push({
        url,
        method: init.method ?? 'GET',
        body,
        authHeader: headers?.['risu-auth'] ?? null,
      })
      if (url === '/api/v1/bootstrap') {
        return jsonResponse({ revision: 7 })
      }
      if (commandStatus !== 200) {
        return jsonResponse({ error: 'settings failed' }, commandStatus)
      }
      const event: CommandEvent = {
        type: 'settings.updated',
        revision: 8,
        resource: 'settings',
      }
      return jsonResponse({ revision: 8, event })
    }) as unknown as typeof fetch,
  )
  return calls
}

function clearMCPRuntimeState() {
  for (const registry of [MCPs, callOnlyMCPs]) {
    for (const key of Object.keys(registry)) {
      registry[key].destroy()
      delete registry[key]
    }
  }
  registeredCustomPluginMCPs.clear()
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  vi.unstubAllGlobals()
  alertMocks.alertConfirm.mockReset()
  alertMocks.alertError.mockReset()
  alertMocks.alertInput.mockReset()
  alertMocks.alertNormal.mockReset()
  clearMCPRuntimeState()
  setServerProjectionWriteGuardEnabled(false)
  DBState.db = {
    authRefreshes: [],
  } as any
})

afterEach(() => {
  clearMCPRuntimeState()
  setServerProjectionWriteGuardEnabled(false)
})

describe('MCP runtime persistence', () => {
  it('routes MCP refresh token writes through the settings command in server-backed web mode', async () => {
    const calls = stubCommandFetch()

    persistMCPRefreshToken('https://mcp.example', {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
      tokenUrl: 'https://mcp.example/token',
    })

    expect(DBState.db.authRefreshes).toEqual([
      {
        url: 'https://mcp.example',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        refreshToken: 'refresh-token',
        tokenUrl: 'https://mcp.example/token',
      },
    ])
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/settings/providers')).toBe(
        true,
      )
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/settings/providers')).toEqual({
      url: '/api/v1/commands/settings/providers',
      method: 'PATCH',
      authHeader: 'mcp-auth-token',
      body: {
        baseRevision: 7,
        patch: {
          authRefreshes: DBState.db.authRefreshes,
        },
      },
    })
  })

  it('does not throw and still dispatches the command when the projection guard is active', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    // Baseline: the guard is active, so a raw projection write throws.
    expect(() => {
      DBState.db.authRefreshes.push({ url: 'raw' } as any)
    }).toThrow(/read-only server projection/)

    expect(() =>
      persistMCPRefreshToken('https://mcp.example', {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        refreshToken: 'refresh-token',
        tokenUrl: 'https://mcp.example/token',
      }),
    ).not.toThrow()

    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/settings/providers')).toBe(true)
    })
    expect(DBState.db.authRefreshes).toContainEqual({
      url: 'https://mcp.example',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
      tokenUrl: 'https://mcp.example/token',
    })
  })

  it('rolls back the optimistic refresh token write when the settings command fails', async () => {
    stubCommandFetch(500)
    DBState.db.authRefreshes = [
      {
        url: 'https://existing.example',
        clientId: 'old-client',
        clientSecret: 'old-secret',
        refreshToken: 'old-refresh',
        tokenUrl: 'https://existing.example/token',
      },
    ]

    persistMCPRefreshToken('https://mcp.example', {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
      tokenUrl: 'https://mcp.example/token',
    })

    await vi.waitFor(() => {
      expect(DBState.db.authRefreshes).toEqual([
        {
          url: 'https://existing.example',
          clientId: 'old-client',
          clientSecret: 'old-secret',
          refreshToken: 'old-refresh',
          tokenUrl: 'https://existing.example/token',
        },
      ])
    })
  })
})

describe('MCP module import logging', () => {
  it('L57: importing an MCP module does not log the meta payload by default', async () => {
    const identifier = 'plugin:mcp-import-log-silence'
    await registerMCPModule(
      {
        identifier,
        name: 'Import Log Silence MCP',
        version: '1.0.0',
        description: 'MCP fixture used to prove import meta payload logging is opt-in.',
      },
      async () => [],
      async () => [],
    )
    alertMocks.alertInput.mockResolvedValue(identifier)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {
      /* test spy */
    })

    await importMCPModule()

    expect(alertMocks.alertError).toHaveBeenCalledWith(
      'MCP module import is not supported in Fastify server-backed mode yet',
    )
    expect(logSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({
        [identifier]: expect.objectContaining({
          serverInfo: expect.objectContaining({
            name: 'Import Log Silence MCP',
          }),
        }),
      }),
    )
    expect(logSpy).not.toHaveBeenCalled()
  })
})
