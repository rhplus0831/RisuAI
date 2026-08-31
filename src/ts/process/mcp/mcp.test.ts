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
const moduleCommandMocks = vi.hoisted(() => ({
  createGlobalModule: vi.fn(),
}))
const mcpOAuthMocks = vi.hoisted(() => ({
  requestStoredMcpOAuthRefresh: vi.fn(async () => 'stored-access-token'),
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

vi.mock('../../server/mcpOAuthRefresh', () => ({
  requestStoredMcpOAuthRefresh: mcpOAuthMocks.requestStoredMcpOAuthRefresh,
}))

vi.mock('../modules', () => ({
  getModuleAssets: () => [],
  getModuleLorebooks: () => [],
  getModuleMcps: () => [...moduleMocks.mcps],
  getModuleRegexScripts: () => [],
  getModules: () => [],
  getModuleTriggers: () => [],
  getModuleToggles: () => '',
  moduleUpdate: vi.fn(),
}))

vi.mock('../../moduleCommands', () => moduleCommandMocks)

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
import { setResourceWriteGuardEnabled } from '../../server/resourceWriteGuard.svelte'
import {
  getResourceDatabase as getDatabase,
  replaceResourceDatabase as setDatabaseLite,
} from '../../server/resourceState.svelte'
import {
  callMCPTool,
  callMCPToolFrom,
  callOnlyMCPs,
  decodeToolCall,
  encodeToolCall,
  getMCPMeta,
  getTools,
  initializeMCPs,
  importMCPModule,
  MCPs,
  persistMCPRefreshToken,
  resolveMCPRefreshTokenSource,
} from './mcp'
import { MCPClient, type MCPTool } from './mcplib'
import { registeredCustomPluginMCPs, registerMCPModule, unregisterMCPModule } from './pluginmcp'
import { requestChatData } from '../request/request'
import { language } from 'src/lang'

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

function mcpServerInfoFixture(): MCPClient['serverInfo'] {
  return {
    protocolVersion: '2025-03-26',
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: 'test-mcp',
      version: '1.0.0',
    },
  }
}

function configureServerCompletionDb() {
  setDatabaseLite({
    authRefreshes: [],
    aiModel: 'echo_model',
    subModel: 'echo_model',
    fallbackModels: {},
    modelProfiles: [{ id: 'mcp-test-profile', name: 'MCP test profile', modelId: 'echo_model' }],
    modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'mcp-test-profile' } },
    maxResponse: 64,
    temperature: 40,
    useStreaming: false,
    genTime: 1,
    seperateModelsForAxModels: false,
    seperateModels: {},
    customModels: [],
    fallbackWhenBlankResponse: false,
    banCharacterset: [],
    requestRetrys: 0,
    characters: [],
  } as any)
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

function stubDeferredProviderSettingsFailure(): {
  calls: CapturedFetch[]
  failProviderSettings: () => void
} {
  const calls: CapturedFetch[] = []
  const providerSettingsResponse = createDeferred<Response>()
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
      if (url === '/api/v1/commands/settings/providers') {
        return providerSettingsResponse.promise
      }
      const event: CommandEvent = {
        type: 'settings.updated',
        revision: 8,
        resource: 'settings',
      }
      return jsonResponse({ revision: 8, event })
    }) as unknown as typeof fetch,
  )

  return {
    calls,
    failProviderSettings: () => {
      providerSettingsResponse.resolve(jsonResponse({ error: 'settings failed' }, 500))
    },
  }
}

function stubDeferredFirstProviderSettingsFailure(): {
  calls: CapturedFetch[]
  failFirstProviderSettings: () => void
} {
  const calls: CapturedFetch[] = []
  const firstProviderSettingsResponse = createDeferred<Response>()
  let providerSettingsCalls = 0
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
      if (url === '/api/v1/commands/settings/providers') {
        providerSettingsCalls += 1
        if (providerSettingsCalls === 1) return firstProviderSettingsResponse.promise
      }
      const event: CommandEvent = {
        type: 'settings.updated',
        revision: 8,
        resource: 'settings',
      }
      return jsonResponse({ revision: 8, event })
    }) as unknown as typeof fetch,
  )

  return {
    calls,
    failFirstProviderSettings: () => {
      firstProviderSettingsResponse.resolve(jsonResponse({ error: 'settings failed' }, 500))
    },
  }
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
  vi.stubGlobal('safeStructuredClone', <T>(value: T) => structuredClone(value))
  moduleMocks.mcps = []
  alertMocks.alertConfirm.mockReset()
  alertMocks.alertError.mockReset()
  alertMocks.alertInput.mockReset()
  alertMocks.alertNormal.mockReset()
  moduleCommandMocks.createGlobalModule.mockReset()
  moduleCommandMocks.createGlobalModule.mockResolvedValue(null)
  mcpOAuthMocks.requestStoredMcpOAuthRefresh.mockClear()
  clearMCPRuntimeState()
  setResourceWriteGuardEnabled(false)
  setDatabaseLite({
    authRefreshes: [],
  } as any)
})

afterEach(() => {
  clearMCPRuntimeState()
  setResourceWriteGuardEnabled(false)
})

describe('MCP remembered tool calls', () => {
  it('round-trips the complete encoded wrapper as well as its inner payload', async () => {
    const toolCall = {
      call: { id: 'remembered-call', name: 'remembered_tool', arg: { value: 3 } },
      response: [{ type: 'text' as const, text: 'remembered result' }],
    }

    const encoded = await encodeToolCall(toolCall)
    await expect(decodeToolCall(encoded)).resolves.toEqual(toolCall)
    await expect(decodeToolCall(encoded.match(/<tool_call>(.*?)<\/tool_call>/s)?.[1] ?? '')).resolves.toEqual(toolCall)
  })
})

describe('MCP request discovery', () => {
  it('skips MCP tool discovery for Fastify server completions that discard tools', async () => {
    const identifier = 'plugin:l45-server-skip'
    const getToolList = vi.fn(async () => [toolFixture('discarded_tool')])
    await registerMCPModule(
      {
        identifier,
        name: 'L45 Server Skip MCP',
        version: '1.0.0',
        description: 'MCP fixture that should not initialize for server completions.',
      },
      getToolList,
      async () => [],
    )
    moduleMocks.mcps = [identifier]
    configureServerCompletionDb()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          type: 'success',
          result: 'server-ok',
        }),
      ),
    )

    await expect(
      requestChatData(
        {
          bias: {},
          formated: [{ role: 'user', content: 'hi' }],
          useStreaming: false,
        },
        'model',
      ),
    ).resolves.toEqual({
      type: 'success',
      result: 'server-ok',
    })

    expect(getToolList).not.toHaveBeenCalled()
    expect(MCPs[identifier]).toBeUndefined()
  })
})

describe('MCP client initialization lifecycle', () => {
  it('shares concurrent first construction for one remote MCP key', async () => {
    const mcpUrl = 'https://mcp.example/messages'
    const handshake = createDeferred<MCPClient['serverInfo']>()
    const constructedUrls: string[] = []
    const checkHandshakeSpy = vi.spyOn(MCPClient.prototype, 'checkHandshake').mockImplementation(function (
      this: MCPClient,
    ) {
      constructedUrls.push(this.url)
      return handshake.promise as unknown as ReturnType<MCPClient['checkHandshake']>
    })
    moduleMocks.mcps = [mcpUrl]

    try {
      const first = initializeMCPs()
      const second = initializeMCPs()

      await vi.waitFor(() => {
        expect(constructedUrls).toHaveLength(1)
      })
      handshake.resolve(mcpServerInfoFixture())
      await Promise.all([first, second])
    } finally {
      checkHandshakeSpy.mockRestore()
    }

    expect(constructedUrls).toEqual([mcpUrl])
    expect(MCPs[mcpUrl]).toBeDefined()
  })

  it('clears a failed in-flight remote construction so a later call can retry', async () => {
    const mcpUrl = 'https://mcp-retry.example/messages'
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* expected first failure */
    })
    let initializeCalls = 0
    const checkHandshakeSpy = vi.spyOn(MCPClient.prototype, 'checkHandshake').mockImplementation(() => {
      initializeCalls += 1
      if (initializeCalls === 1) {
        return Promise.reject(new Error('temporary failure'))
      }
      return Promise.resolve(mcpServerInfoFixture())
    })
    moduleMocks.mcps = [mcpUrl]

    try {
      await initializeMCPs()
      expect(MCPs[mcpUrl]).toBeUndefined()

      await initializeMCPs()
      expect(MCPs[mcpUrl]).toBeDefined()
    } finally {
      errorSpy.mockRestore()
      checkHandshakeSpy.mockRestore()
    }

    expect(initializeCalls).toBe(2)
  })

  it('keeps an import probe client leased through its metadata snapshot', async () => {
    const identifier = 'plugin:metadata-import-probe'
    const client = await registerMCPModule(
      {
        identifier,
        name: 'Metadata Import Probe',
        version: '1.0.0',
        description: 'Client used only while an import reads metadata.',
      },
      async () => [],
      async () => [],
    )
    const handshake = createDeferred<Awaited<ReturnType<typeof client.checkHandshake>>>()
    const checkHandshake = vi.spyOn(client, 'checkHandshake').mockReturnValue(handshake.promise)
    const destroy = vi.spyOn(client, 'destroy')

    const metadata = getMCPMeta([identifier])
    await vi.waitFor(() => expect(checkHandshake).toHaveBeenCalledTimes(1))

    await initializeMCPs()

    expect(MCPs[identifier]).toBe(client)
    expect(destroy).not.toHaveBeenCalled()

    handshake.resolve(client.serverInfo)
    await expect(metadata).resolves.toMatchObject({
      [identifier]: client.serverInfo,
    })

    await initializeMCPs()

    expect(MCPs[identifier]).toBeUndefined()
    expect(destroy).toHaveBeenCalledTimes(1)
  })
})

describe('MCP runtime persistence', () => {
  it('routes masked persisted rows by stable identity and raw rows directly', () => {
    const identity = 'https://mcp.example/messages'
    getDatabase().authRefreshes = [
      {
        url: identity,
        clientId: 'client-id',
        clientSecret: 'raw-client-secret',
        refreshToken: 'raw-refresh-token',
        tokenUrl: 'https://auth.example/token',
      },
    ]

    expect(resolveMCPRefreshTokenSource(identity)).toEqual({
      source: 'provided',
      clientId: 'client-id',
      clientSecret: 'raw-client-secret',
      refreshToken: 'raw-refresh-token',
      tokenUrl: 'https://auth.example/token',
    })

    getDatabase().authRefreshes[0].clientSecret = '__RISU_SECRET_MASKED__'
    getDatabase().authRefreshes[0].refreshToken = '__RISU_SECRET_MASKED__'
    expect(resolveMCPRefreshTokenSource(identity)).toEqual({ source: 'stored' })

    getDatabase().authRefreshes[0].refreshToken = 'partially-raw-refresh-token'
    expect(resolveMCPRefreshTokenSource(identity)).toEqual({ source: 'stored' })
  })

  it('uses the original stdio record identity for server-owned refresh', async () => {
    const identity = 'stdio:{"url":"http://127.0.0.1:3010/messages"}'
    getDatabase().authRefreshes = [
      {
        url: identity,
        clientId: 'client-id',
        clientSecret: '__RISU_SECRET_MASKED__',
        refreshToken: '__RISU_SECRET_MASKED__',
        tokenUrl: 'http://127.0.0.1:3010/token',
      },
    ]
    moduleMocks.mcps = [identity]
    let constructedClient: MCPClient | null = null
    const checkHandshake = vi.spyOn(MCPClient.prototype, 'checkHandshake').mockImplementation(function (
      this: MCPClient,
    ) {
      constructedClient = this
      return Promise.resolve(mcpServerInfoFixture())
    })

    try {
      await initializeMCPs()
      expect(await constructedClient?.getRefreshToken?.()).toEqual({ source: 'stored' })
      const cancellation = new AbortController()
      await expect(constructedClient?.refreshStoredAccessToken?.(cancellation.signal)).resolves.toBe(
        'stored-access-token',
      )
      expect(mcpOAuthMocks.requestStoredMcpOAuthRefresh).toHaveBeenCalledWith(identity, {
        signal: cancellation.signal,
      })
    } finally {
      checkHandshake.mockRestore()
    }
  })

  it('upserts an existing refresh token by stable MCP URL', async () => {
    const calls = stubCommandFetch()
    getDatabase().authRefreshes = [
      {
        url: 'https://mcp.example',
        clientId: 'old-client',
        clientSecret: 'old-secret',
        refreshToken: 'old-refresh',
        tokenUrl: 'https://mcp.example/old-token',
      },
    ]

    persistMCPRefreshToken('https://mcp.example', {
      clientId: 'new-client',
      clientSecret: 'new-secret',
      refreshToken: 'new-refresh',
      tokenUrl: 'https://mcp.example/new-token',
    })

    expect(getDatabase().authRefreshes).toEqual([
      {
        url: 'https://mcp.example',
        clientId: 'new-client',
        clientSecret: 'new-secret',
        refreshToken: 'new-refresh',
        tokenUrl: 'https://mcp.example/new-token',
      },
    ])
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/settings/providers')).toBe(true)
    })
    expect(
      (calls.find((call) => call.url === '/api/v1/commands/settings/providers')?.body as any).patch.authRefreshes,
    ).toHaveLength(1)
  })

  it('routes MCP refresh token writes through the settings command in server-backed web mode', async () => {
    const calls = stubCommandFetch()

    persistMCPRefreshToken('https://mcp.example', {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
      tokenUrl: 'https://mcp.example/token',
    })

    expect(getDatabase().authRefreshes).toEqual([
      {
        url: 'https://mcp.example',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        refreshToken: 'refresh-token',
        tokenUrl: 'https://mcp.example/token',
      },
    ])
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/settings/providers')).toBe(true)
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/settings/providers')).toEqual({
      url: '/api/v1/commands/settings/providers',
      method: 'PATCH',
      authHeader: 'mcp-auth-token',
      body: {
        baseRevision: 7,
        patch: {
          authRefreshes: getDatabase().authRefreshes,
        },
      },
    })
  })

  it('does not throw and still dispatches the command when the resource guard is active', async () => {
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    // Baseline: the guard is active, so a raw projection write throws.
    expect(() => {
      getDatabase().authRefreshes.push({ url: 'raw' } as any)
    }).toThrow(/resource database compatibility view is read-only/)

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
    expect(getDatabase().authRefreshes).toContainEqual({
      url: 'https://mcp.example',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
      tokenUrl: 'https://mcp.example/token',
    })
  })

  it('rolls back the optimistic refresh token write when the settings command fails', async () => {
    stubCommandFetch(500)
    getDatabase().authRefreshes = [
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
      expect(getDatabase().authRefreshes).toEqual([
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

  it('failed refresh-token rollback removes only the unchanged appended token after newer edits', async () => {
    const { calls, failProviderSettings } = stubDeferredProviderSettingsFailure()
    const existingToken = {
      url: 'https://existing.example',
      clientId: 'old-client',
      clientSecret: 'old-secret',
      refreshToken: 'old-refresh',
      tokenUrl: 'https://existing.example/token',
    }
    const newerToken = {
      url: 'https://newer.example',
      clientId: 'newer-client',
      clientSecret: 'newer-secret',
      refreshToken: 'newer-refresh',
      tokenUrl: 'https://newer.example/token',
    }
    getDatabase().authRefreshes = [existingToken]

    persistMCPRefreshToken('https://mcp.example', {
      clientId: 'client-a',
      clientSecret: 'secret-a',
      refreshToken: 'refresh-a',
      tokenUrl: 'https://mcp.example/token',
    })

    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/settings/providers')).toBe(true)
    })
    getDatabase().authRefreshes.push(newerToken)
    getDatabase().authRefreshes[2].refreshToken = 'newer-refresh-mutated'

    failProviderSettings()

    await vi.waitFor(() => {
      expect(getDatabase().authRefreshes).toEqual([
        existingToken,
        {
          ...newerToken,
          refreshToken: 'newer-refresh-mutated',
        },
      ])
    })
  })

  it('restores a replaced token on failure without overwriting a newer unrelated edit', async () => {
    const { calls, failProviderSettings } = stubDeferredProviderSettingsFailure()
    const previousToken = {
      url: 'https://mcp.example',
      clientId: 'old-client',
      clientSecret: 'old-secret',
      refreshToken: 'old-refresh',
      tokenUrl: 'https://mcp.example/old-token',
    }
    const unrelatedToken = {
      url: 'https://unrelated.example',
      clientId: 'unrelated-client',
      clientSecret: 'unrelated-secret',
      refreshToken: 'unrelated-refresh',
      tokenUrl: 'https://unrelated.example/token',
    }
    getDatabase().authRefreshes = [previousToken]

    persistMCPRefreshToken(previousToken.url, {
      clientId: 'new-client',
      clientSecret: 'new-secret',
      refreshToken: 'new-refresh',
      tokenUrl: 'https://mcp.example/new-token',
    })
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/settings/providers')).toBe(true)
    })
    getDatabase().authRefreshes.push(unrelatedToken)
    failProviderSettings()

    await vi.waitFor(() => {
      expect(getDatabase().authRefreshes).toEqual([previousToken, unrelatedToken])
    })
  })

  it('rebases queued replacements for the same MCP URL after the first save fails', async () => {
    const { calls, failFirstProviderSettings } = stubDeferredFirstProviderSettingsFailure()
    const identity = 'https://mcp.example'
    getDatabase().authRefreshes = [
      {
        url: identity,
        clientId: 'original-client',
        clientSecret: 'original-secret',
        refreshToken: 'original-refresh',
        tokenUrl: 'https://mcp.example/original-token',
      },
    ]
    const first = {
      url: identity,
      clientId: 'first-client',
      clientSecret: 'first-secret',
      refreshToken: 'first-refresh',
      tokenUrl: 'https://mcp.example/first-token',
    }
    const second = {
      url: identity,
      clientId: 'second-client',
      clientSecret: 'second-secret',
      refreshToken: 'second-refresh',
      tokenUrl: 'https://mcp.example/second-token',
    }

    persistMCPRefreshToken(identity, first)
    await vi.waitFor(() => {
      expect(calls.filter((call) => call.url === '/api/v1/commands/settings/providers')).toHaveLength(1)
    })
    persistMCPRefreshToken(identity, second)
    expect(getDatabase().authRefreshes).toEqual([second])
    failFirstProviderSettings()

    await vi.waitFor(() => {
      expect(calls.filter((call) => call.url === '/api/v1/commands/settings/providers')).toHaveLength(2)
    })
    const providerCalls = calls.filter((call) => call.url === '/api/v1/commands/settings/providers')
    expect(providerCalls[1].body).toMatchObject({ patch: { authRefreshes: [second] } })
    await vi.waitFor(() => expect(getDatabase().authRefreshes).toEqual([second]))
  })

  it('rebases a queued refresh-token save after its predecessor fails', async () => {
    const { calls, failFirstProviderSettings } = stubDeferredFirstProviderSettingsFailure()
    const tokenA = {
      url: 'https://mcp-a.example',
      clientId: 'client-a',
      clientSecret: 'secret-a',
      refreshToken: 'refresh-a',
      tokenUrl: 'https://mcp-a.example/token',
    }
    const tokenB = {
      url: 'https://mcp-b.example',
      clientId: 'client-b',
      clientSecret: 'secret-b',
      refreshToken: 'refresh-b',
      tokenUrl: 'https://mcp-b.example/token',
    }

    persistMCPRefreshToken(tokenA.url, tokenA)
    await vi.waitFor(() => {
      expect(calls.filter((call) => call.url === '/api/v1/commands/settings/providers')).toHaveLength(1)
    })
    persistMCPRefreshToken(tokenB.url, tokenB)
    expect(getDatabase().authRefreshes).toEqual([tokenA, tokenB])

    failFirstProviderSettings()

    await vi.waitFor(() => {
      expect(calls.filter((call) => call.url === '/api/v1/commands/settings/providers')).toHaveLength(2)
    })
    const providerCalls = calls.filter((call) => call.url === '/api/v1/commands/settings/providers')
    expect(providerCalls[0].body).toMatchObject({ patch: { authRefreshes: [tokenA] } })
    expect(providerCalls[1].body).toMatchObject({ patch: { authRefreshes: [tokenB] } })
    await vi.waitFor(() => {
      expect(getDatabase().authRefreshes).toEqual([tokenB])
    })
  })
})

describe('MCP module import', () => {
  async function importFixture(createResult: Awaited<ReturnType<typeof moduleCommandMocks.createGlobalModule>> = null) {
    const mcpUrl = 'https://mcp.example/sse'
    const serverInfo = mcpServerInfoFixture()
    alertMocks.alertInput.mockResolvedValue(mcpUrl)
    moduleCommandMocks.createGlobalModule.mockImplementation(async (module) => {
      getDatabase().modules ??= []
      getDatabase().modules.push(module)
      if (createResult && createResult.status !== 'ok') {
        getDatabase().modules = getDatabase().modules.filter((candidate) => candidate.id !== module.id)
      }
      return createResult
    })
    const handshake = vi.spyOn(MCPClient.prototype, 'checkHandshake').mockImplementation(function (this: MCPClient) {
      this.serverInfo = serverInfo
      return Promise.resolve(serverInfo)
    })
    try {
      return await importMCPModule()
    } finally {
      handshake.mockRestore()
    }
  }

  it('imports a validated MCP through the durable global-module command', async () => {
    await expect(importFixture()).resolves.toBe('applied')

    expect(moduleCommandMocks.createGlobalModule).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        name: 'test-mcp',
        description: 'MCP from https://mcp.example/sse',
        mcp: { url: 'https://mcp.example/sse' },
      }),
    )
    expect(alertMocks.alertNormal).toHaveBeenCalledWith(language.moduleImport.mcpSuccess('test-mcp'))
    expect(alertMocks.alertError).not.toHaveBeenCalled()
  })

  it('does not announce success until module persistence settles', async () => {
    const persistence = createDeferred<any>()
    moduleCommandMocks.createGlobalModule.mockReturnValue(persistence.promise)
    const mcpUrl = 'https://mcp.example/sse'
    const serverInfo = mcpServerInfoFixture()
    alertMocks.alertInput.mockResolvedValue(mcpUrl)
    const handshake = vi.spyOn(MCPClient.prototype, 'checkHandshake').mockImplementation(function (this: MCPClient) {
      this.serverInfo = serverInfo
      return Promise.resolve(serverInfo)
    })

    const importing = importMCPModule()
    await vi.waitFor(() => expect(moduleCommandMocks.createGlobalModule).toHaveBeenCalledOnce())
    expect(alertMocks.alertNormal).not.toHaveBeenCalled()

    persistence.resolve(null)
    await expect(importing).resolves.toBe('applied')
    expect(alertMocks.alertNormal).toHaveBeenCalledWith(language.moduleImport.mcpSuccess('test-mcp'))
    handshake.mockRestore()
  })

  it('reports a rejected module command without showing success', async () => {
    await expect(
      importFixture({ status: 'error', error: 'invalid MCP module', reason: 'invalid-request' }),
    ).resolves.toBe('failed')

    expect(alertMocks.alertError).toHaveBeenCalledWith(language.moduleImport.commandError('invalid MCP module'))
    expect(alertMocks.alertNormal).not.toHaveBeenCalled()
  })

  it('reports a retained optimistic module as queued', async () => {
    const mcpUrl = 'https://mcp.example/sse'
    const serverInfo = mcpServerInfoFixture()
    alertMocks.alertInput.mockResolvedValue(mcpUrl)
    moduleCommandMocks.createGlobalModule.mockImplementation(async (module) => {
      getDatabase().modules ??= []
      getDatabase().modules.push(module)
      return { status: 'unavailable' }
    })
    const handshake = vi.spyOn(MCPClient.prototype, 'checkHandshake').mockImplementation(function (this: MCPClient) {
      this.serverInfo = serverInfo
      return Promise.resolve(serverInfo)
    })

    await expect(importMCPModule()).resolves.toBe('queued')

    expect(alertMocks.alertNormal).toHaveBeenCalledWith(language.moduleImport.queued)
    expect(alertMocks.alertError).not.toHaveBeenCalled()
    handshake.mockRestore()
  })

  it('treats dismissing the URL prompt as cancellation', async () => {
    alertMocks.alertInput.mockResolvedValue('')

    await expect(importMCPModule()).resolves.toBe('cancelled')

    expect(moduleCommandMocks.createGlobalModule).not.toHaveBeenCalled()
    expect(alertMocks.alertError).not.toHaveBeenCalled()
  })

  it('does not advertise the unsupported Google Search client', async () => {
    alertMocks.alertInput.mockResolvedValue('')

    await expect(importMCPModule()).resolves.toBe('cancelled')

    const choices = alertMocks.alertInput.mock.calls[0]?.[1] as Array<[string, string]>
    expect(choices.map(([identifier]) => identifier)).not.toContain('internal:googlesearch')
  })

  it.each(['https:not-a-url', 'http://127.example/mcp', 'ftp://mcp.example/tools'])(
    'rejects an unsafe or malformed MCP identifier: %s',
    async (identifier) => {
      alertMocks.alertInput.mockResolvedValue(identifier)

      await expect(importMCPModule()).resolves.toBe('failed')

      expect(moduleCommandMocks.createGlobalModule).not.toHaveBeenCalled()
      expect(alertMocks.alertError).toHaveBeenCalledWith(language.moduleImport.mcpInvalidUrl)
    },
  )
})

describe('MCP indexed tool dispatch', () => {
  it('routes a duplicate tool name to the MCP selected by the caller', async () => {
    const firstIdentifier = 'plugin:selected-first'
    const secondIdentifier = 'plugin:selected-second'
    const firstCallTool = vi.fn(async () => [{ type: 'text' as const, text: 'first' }])
    const secondCallTool = vi.fn(async () => [{ type: 'text' as const, text: 'second' }])

    await registerMCPModule(
      {
        identifier: firstIdentifier,
        name: 'Selected First MCP',
        version: '1.0.0',
        description: 'First duplicate-name MCP fixture.',
      },
      async () => [toolFixture('shared_tool')],
      firstCallTool,
    )
    await registerMCPModule(
      {
        identifier: secondIdentifier,
        name: 'Selected Second MCP',
        version: '1.0.0',
        description: 'Second duplicate-name MCP fixture.',
      },
      async () => [toolFixture('shared_tool')],
      secondCallTool,
    )
    moduleMocks.mcps = [firstIdentifier, secondIdentifier]

    await expect(callMCPToolFrom(secondIdentifier, 'shared_tool', { selected: true })).resolves.toEqual([
      { type: 'text', text: 'second' },
    ])
    expect(firstCallTool).not.toHaveBeenCalled()
    expect(secondCallTool).toHaveBeenCalledWith('shared_tool', { selected: true })
  })

  it('replaces an initialized plugin MCP and ignores delayed cleanup from the old registration', async () => {
    const identifier = 'plugin:reload-current-registration'
    const oldGetToolList = vi.fn(async () => [toolFixture('old_plugin_tool')])
    const oldCallTool = vi.fn(async () => [{ type: 'text' as const, text: 'old registration' }])
    const newGetToolList = vi.fn(async () => [toolFixture('new_plugin_tool')])
    const newCallTool = vi.fn(async () => [{ type: 'text' as const, text: 'new registration' }])
    const oldClient = await registerMCPModule(
      {
        identifier,
        name: 'Old Plugin MCP',
        version: '1.0.0',
        description: 'Registration from the old plugin generation.',
      },
      oldGetToolList,
      oldCallTool,
    )
    const oldDestroy = vi.spyOn(oldClient, 'destroy')
    moduleMocks.mcps = [identifier]

    await expect(callMCPTool('old_plugin_tool', {})).resolves.toEqual([{ type: 'text', text: 'old registration' }])
    expect(MCPs[identifier]).toBe(oldClient)

    const newClient = await registerMCPModule(
      {
        identifier,
        name: 'New Plugin MCP',
        version: '2.0.0',
        description: 'Registration from the current plugin generation.',
      },
      newGetToolList,
      newCallTool,
    )
    await unregisterMCPModule(identifier, oldClient)

    expect(registeredCustomPluginMCPs.get(identifier)).toBe(newClient)
    expect(MCPs[identifier]).toBeUndefined()
    expect(oldDestroy).toHaveBeenCalledTimes(1)
    await expect(callMCPTool('old_plugin_tool', {})).resolves.toEqual([
      { type: 'text', text: 'Tool old_plugin_tool not found on any MCP' },
    ])
    await expect(callMCPTool('new_plugin_tool', {})).resolves.toEqual([{ type: 'text', text: 'new registration' }])

    expect(MCPs[identifier]).toBe(newClient)
    expect(oldGetToolList).toHaveBeenCalledTimes(1)
    expect(oldCallTool).toHaveBeenCalledTimes(1)
    expect(newGetToolList).toHaveBeenCalledTimes(1)
    expect(newCallTool).toHaveBeenCalledTimes(1)
  })

  it('removes initialized tools and client references when a plugin MCP unregisters', async () => {
    const identifier = 'plugin:unload-registration'
    const getToolList = vi.fn(async () => [toolFixture('unloaded_plugin_tool')])
    const callTool = vi.fn(async () => [{ type: 'text' as const, text: 'loaded registration' }])
    const client = await registerMCPModule(
      {
        identifier,
        name: 'Unload Plugin MCP',
        version: '1.0.0',
        description: 'Registration removed during plugin unload.',
      },
      getToolList,
      callTool,
    )
    const destroy = vi.spyOn(client, 'destroy')
    moduleMocks.mcps = [identifier]

    await expect(callMCPTool('unloaded_plugin_tool', {})).resolves.toEqual([
      { type: 'text', text: 'loaded registration' },
    ])

    await unregisterMCPModule(identifier)

    expect(registeredCustomPluginMCPs.has(identifier)).toBe(false)
    expect(MCPs[identifier]).toBeUndefined()
    expect(destroy).toHaveBeenCalledTimes(1)
    await expect(callMCPTool('unloaded_plugin_tool', {})).resolves.toEqual([
      { type: 'text', text: 'Tool unloaded_plugin_tool not found on any MCP' },
    ])
    expect(getToolList).toHaveBeenCalledTimes(1)
    expect(callTool).toHaveBeenCalledTimes(1)
  })

  it('dispatch builds the tool-name index once and reuses it for later calls', async () => {
    const firstIdentifier = 'plugin:l55-index-first'
    const secondIdentifier = 'plugin:l55-index-second'
    const firstGetToolList = vi.fn(async () => [toolFixture('shared_tool'), toolFixture('first_only')])
    const secondGetToolList = vi.fn(async () => [toolFixture('shared_tool'), toolFixture('second_only')])
    const firstCallTool = vi.fn(async (toolName: string) => [{ type: 'text' as const, text: `first:${toolName}` }])
    const secondCallTool = vi.fn(async (toolName: string) => [{ type: 'text' as const, text: `second:${toolName}` }])

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

    await expect(callMCPTool('shared_tool', {})).resolves.toEqual([{ type: 'text', text: 'first:shared_tool' }])
    await expect(callMCPTool('second_only', {})).resolves.toEqual([{ type: 'text', text: 'second:second_only' }])

    expect(firstGetToolList).toHaveBeenCalledTimes(1)
    expect(secondGetToolList).toHaveBeenCalledTimes(1)
    expect(firstCallTool).toHaveBeenCalledTimes(1)
    expect(secondCallTool).toHaveBeenCalledTimes(1)
  })

  it('rebuilds the dispatch index when MCP initialization inputs change', async () => {
    const firstIdentifier = 'plugin:l55-rebuild-first'
    const secondIdentifier = 'plugin:l55-rebuild-second'
    const firstGetToolList = vi.fn(async () => [toolFixture('first_tool')])
    const secondGetToolList = vi.fn(async () => [toolFixture('second_tool')])
    const firstCallTool = vi.fn(async (toolName: string) => [{ type: 'text' as const, text: `first:${toolName}` }])
    const secondCallTool = vi.fn(async (toolName: string) => [{ type: 'text' as const, text: `second:${toolName}` }])

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
    await expect(callMCPTool('first_tool', {})).resolves.toEqual([{ type: 'text', text: 'first:first_tool' }])
    expect(firstGetToolList).toHaveBeenCalledTimes(1)

    moduleMocks.mcps = [firstIdentifier, secondIdentifier]
    await expect(callMCPTool('second_tool', {})).resolves.toEqual([{ type: 'text', text: 'second:second_tool' }])
    await expect(callMCPTool('second_tool', {})).resolves.toEqual([{ type: 'text', text: 'second:second_tool' }])

    expect(firstGetToolList).toHaveBeenCalledTimes(2)
    expect(secondGetToolList).toHaveBeenCalledTimes(1)
    expect(secondCallTool).toHaveBeenCalledTimes(2)
  })

  it('ignores a stale in-flight dispatch index build before initialization cleanup', async () => {
    const oldIdentifier = 'plugin:l55-stale-old'
    const newIdentifier = 'plugin:l55-stale-new'
    const oldToolList = createDeferred<MCPTool[]>()
    const oldGetToolList = vi.fn(() => oldToolList.promise)
    const newGetToolList = vi.fn(async () => [toolFixture('new_tool')])
    const oldCallTool = vi.fn(async (toolName: string) => [{ type: 'text' as const, text: `old:${toolName}` }])
    const newCallTool = vi.fn(async (toolName: string) => [{ type: 'text' as const, text: `new:${toolName}` }])

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

    await expect(newDispatch).resolves.toEqual([{ type: 'text', text: 'new:new_tool' }])
    await expect(staleDispatch).resolves.toEqual([{ type: 'text', text: 'Tool old_tool not found on any MCP' }])
    await expect(callMCPTool('old_tool', {})).resolves.toEqual([
      { type: 'text', text: 'Tool old_tool not found on any MCP' },
    ])
    await expect(callMCPTool('new_tool', {})).resolves.toEqual([{ type: 'text', text: 'new:new_tool' }])

    expect(oldCallTool).not.toHaveBeenCalled()
    expect(newGetToolList).toHaveBeenCalledTimes(1)
    expect(newCallTool).toHaveBeenCalledTimes(2)
  })

  it('isolates a failing internal handshake while keeping other MCP tools usable', async () => {
    const pluginIdentifier = 'plugin:v4-l33-survivor'
    const pluginToolList = vi.fn(async () => [toolFixture('survivor_tool')])
    const pluginCallTool = vi.fn(async (toolName: string) => [{ type: 'text' as const, text: `survivor:${toolName}` }])
    await registerMCPModule(
      {
        identifier: pluginIdentifier,
        name: 'v4 L33 Survivor MCP',
        version: '1.0.0',
        description: 'Survives a sibling internal handshake failure.',
      },
      pluginToolList,
      pluginCallTool,
    )
    moduleMocks.mcps = ['internal:googlesearch', pluginIdentifier]
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(getTools()).resolves.toEqual([
        expect.objectContaining({ name: 'survivor_tool', mcpURL: pluginIdentifier }),
      ])
    } finally {
      errorSpy.mockRestore()
    }

    expect(MCPs['internal:googlesearch']).toBeUndefined()
    expect(MCPs[pluginIdentifier]).toBeDefined()
    expect(pluginToolList).toHaveBeenCalledTimes(1)
  })
})
