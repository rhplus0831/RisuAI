import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const alertMocks = vi.hoisted(() => ({
  alertConfirm: vi.fn(),
  alertError: vi.fn(),
  alertInput: vi.fn(),
  alertNormal: vi.fn(),
}))
const moduleMocks = vi.hoisted(() => ({
  mcps: [] as string[],
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
  return { ...actual, getModuleMcps: () => [...moduleMocks.mcps] }
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
import { callMCPTool, callOnlyMCPs, importMCPModule, MCPs, persistMCPRefreshToken } from './mcp'
import type { MCPTool } from './mcplib'
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

function toolFixture(name: string): MCPTool {
  return {
    name,
    description: `Tool fixture for ${name}`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  vi.unstubAllGlobals()
  moduleMocks.mcps = []
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

describe('MCP indexed tool dispatch', () => {
  it('L55: dispatch builds the tool-name index once and reuses it for later calls', async () => {
    const firstIdentifier = 'plugin:l55-index-first'
    const secondIdentifier = 'plugin:l55-index-second'
    const firstGetToolList = vi.fn(async () => [
      toolFixture('shared_tool'),
      toolFixture('first_only'),
    ])
    const secondGetToolList = vi.fn(async () => [
      toolFixture('shared_tool'),
      toolFixture('second_only'),
    ])
    const firstCallTool = vi.fn(async (toolName: string) => [
      { type: 'text' as const, text: `first:${toolName}` },
    ])
    const secondCallTool = vi.fn(async (toolName: string) => [
      { type: 'text' as const, text: `second:${toolName}` },
    ])

    await registerMCPModule(
      {
        identifier: firstIdentifier,
        name: 'L55 First MCP',
        version: '1.0.0',
        description: 'First duplicate-name MCP fixture.',
      },
      firstGetToolList,
      firstCallTool,
    )
    await registerMCPModule(
      {
        identifier: secondIdentifier,
        name: 'L55 Second MCP',
        version: '1.0.0',
        description: 'Second duplicate-name MCP fixture.',
      },
      secondGetToolList,
      secondCallTool,
    )
    moduleMocks.mcps = [firstIdentifier, secondIdentifier]

    await expect(callMCPTool('shared_tool', {})).resolves.toEqual([
      { type: 'text', text: 'first:shared_tool' },
    ])
    await expect(callMCPTool('second_only', {})).resolves.toEqual([
      { type: 'text', text: 'second:second_only' },
    ])

    expect(firstGetToolList).toHaveBeenCalledTimes(1)
    expect(secondGetToolList).toHaveBeenCalledTimes(1)
    expect(firstCallTool).toHaveBeenCalledTimes(1)
    expect(secondCallTool).toHaveBeenCalledTimes(1)
  })

  it('L55: rebuilds the dispatch index when MCP initialization inputs change', async () => {
    const firstIdentifier = 'plugin:l55-rebuild-first'
    const secondIdentifier = 'plugin:l55-rebuild-second'
    const firstGetToolList = vi.fn(async () => [toolFixture('first_tool')])
    const secondGetToolList = vi.fn(async () => [toolFixture('second_tool')])
    const firstCallTool = vi.fn(async (toolName: string) => [
      { type: 'text' as const, text: `first:${toolName}` },
    ])
    const secondCallTool = vi.fn(async (toolName: string) => [
      { type: 'text' as const, text: `second:${toolName}` },
    ])

    await registerMCPModule(
      {
        identifier: firstIdentifier,
        name: 'L55 Rebuild First MCP',
        version: '1.0.0',
        description: 'Initial MCP fixture.',
      },
      firstGetToolList,
      firstCallTool,
    )
    await registerMCPModule(
      {
        identifier: secondIdentifier,
        name: 'L55 Rebuild Second MCP',
        version: '1.0.0',
        description: 'Added MCP fixture.',
      },
      secondGetToolList,
      secondCallTool,
    )

    moduleMocks.mcps = [firstIdentifier]
    await expect(callMCPTool('first_tool', {})).resolves.toEqual([
      { type: 'text', text: 'first:first_tool' },
    ])
    expect(firstGetToolList).toHaveBeenCalledTimes(1)

    moduleMocks.mcps = [firstIdentifier, secondIdentifier]
    await expect(callMCPTool('second_tool', {})).resolves.toEqual([
      { type: 'text', text: 'second:second_tool' },
    ])
    await expect(callMCPTool('second_tool', {})).resolves.toEqual([
      { type: 'text', text: 'second:second_tool' },
    ])

    expect(firstGetToolList).toHaveBeenCalledTimes(2)
    expect(secondGetToolList).toHaveBeenCalledTimes(1)
    expect(secondCallTool).toHaveBeenCalledTimes(2)
  })

  it('L55: ignores a stale in-flight dispatch index build before initialization cleanup', async () => {
    const oldIdentifier = 'plugin:l55-stale-old'
    const newIdentifier = 'plugin:l55-stale-new'
    const oldToolList = createDeferred<MCPTool[]>()
    const oldGetToolList = vi.fn(() => oldToolList.promise)
    const newGetToolList = vi.fn(async () => [toolFixture('new_tool')])
    const oldCallTool = vi.fn(async (toolName: string) => [
      { type: 'text' as const, text: `old:${toolName}` },
    ])
    const newCallTool = vi.fn(async (toolName: string) => [
      { type: 'text' as const, text: `new:${toolName}` },
    ])

    await registerMCPModule(
      {
        identifier: oldIdentifier,
        name: 'L55 Stale Old MCP',
        version: '1.0.0',
        description: 'Slow MCP fixture removed while its tool index is building.',
      },
      oldGetToolList,
      oldCallTool,
    )
    await registerMCPModule(
      {
        identifier: newIdentifier,
        name: 'L55 Stale New MCP',
        version: '1.0.0',
        description: 'Replacement MCP fixture.',
      },
      newGetToolList,
      newCallTool,
    )
    const newClient = registeredCustomPluginMCPs.get(newIdentifier)
    if (!newClient) throw new Error('Expected replacement MCP test client to be registered')
    const newHandshake = createDeferred<Awaited<ReturnType<typeof newClient.checkHandshake>>>()
    vi.spyOn(newClient, 'checkHandshake').mockReturnValue(newHandshake.promise)

    moduleMocks.mcps = [oldIdentifier]
    const staleDispatch = callMCPTool('old_tool', {})
    await vi.waitFor(() => {
      expect(oldGetToolList).toHaveBeenCalledTimes(1)
    })

    moduleMocks.mcps = [newIdentifier]
    const newDispatch = callMCPTool('new_tool', {})
    await vi.waitFor(() => {
      expect(newClient.checkHandshake).toHaveBeenCalledTimes(1)
    })

    oldToolList.resolve([toolFixture('old_tool')])
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(oldGetToolList).toHaveBeenCalledTimes(1)
    expect(oldCallTool).not.toHaveBeenCalled()

    newHandshake.resolve(newClient.serverInfo)

    await expect(newDispatch).resolves.toEqual([
      { type: 'text', text: 'new:new_tool' },
    ])
    await expect(staleDispatch).resolves.toEqual([
      { type: 'text', text: 'Tool old_tool not found on any MCP' },
    ])
    await expect(callMCPTool('old_tool', {})).resolves.toEqual([
      { type: 'text', text: 'Tool old_tool not found on any MCP' },
    ])
    await expect(callMCPTool('new_tool', {})).resolves.toEqual([
      { type: 'text', text: 'new:new_tool' },
    ])

    expect(oldCallTool).not.toHaveBeenCalled()
    expect(newGetToolList).toHaveBeenCalledTimes(1)
    expect(newCallTool).toHaveBeenCalledTimes(2)
  })
})
