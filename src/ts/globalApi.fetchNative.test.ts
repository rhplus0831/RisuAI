import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const platformState = vi.hoisted(() => ({ isFastifyServer: true }))

vi.mock('./platform', async (importActual) => {
  const actual = await importActual<typeof import('./platform')>()
  return {
    ...actual,
    get isFastifyServer() {
      return platformState.isFastifyServer
    },
  }
})

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'proxy-auth-token',
}))

vi.mock('./process/modules', async (importActual) => {
  const actual = await importActual<typeof import('./process/modules')>()
  return {
    ...actual,
    getModuleAssets: vi.fn(() => []),
    getModuleLorebooks: vi.fn(() => []),
    getModuleRegexScripts: vi.fn(() => []),
    getModuleTriggers: vi.fn(() => []),
    getModules: vi.fn(() => []),
    moduleUpdate: vi.fn(),
  }
})

import { fetchNative, getFetchLogs } from './globalApi.svelte'
import { DBState } from './stores.svelte'

const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []

beforeEach(() => {
  platformState.isFastifyServer = true
  fetchCalls.length = 0
  getFetchLogs().length = 0
  DBState.db = {
    requestLocation: '',
  } as typeof DBState.db
  delete (window as typeof window & { userScriptFetch?: typeof fetch }).userScriptFetch
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init })
      return new Response('ok', {
        status: 201,
        headers: { 'content-type': 'text/plain' },
      })
    }) as unknown as typeof fetch,
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  getFetchLogs().length = 0
})

describe('fetchNative diagnostics', () => {
  it('L47: does not console.log the request body and keeps structured fetch logs', async () => {
    const body = 'private request body'
    const response = await fetchNative('https://provider.example.test/v1/messages', {
      method: 'POST',
      body,
      headers: { authorization: 'Bearer test' },
      chatId: 'chat-fetch-native',
    })

    expect(response.status).toBe(201)
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0].input).toBe('https://provider.example.test/v1/messages')
    expect(fetchCalls[0].init?.method).toBe('POST')
    expect(new TextDecoder().decode(fetchCalls[0].init?.body as Uint8Array)).toBe(body)
    expect(console.log).not.toHaveBeenCalledWith(body, 'body')
    expect(getFetchLogs()[0]).toMatchObject({
      body,
      header: JSON.stringify({ authorization: 'Bearer test' }, null, 2),
      response: 'Streamed Fetch',
      success: true,
      url: 'https://provider.example.test/v1/messages',
      responseType: 'stream',
      chatId: 'chat-fetch-native',
    })
  })
})
