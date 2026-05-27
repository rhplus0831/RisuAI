import { beforeEach, describe, expect, it, vi } from 'vitest'

const alertState = vi.hoisted(() => ({
  alertInput: vi.fn(async () => 'hunter2'),
}))

vi.mock('../alert', () => ({
  alertError: vi.fn(),
  alertInput: alertState.alertInput,
  waitAlert: vi.fn(async () => undefined),
}))

vi.mock('src/lang', () => ({
  language: {
    setNodePassword: 'Set Fastify password',
    inputNodePassword: 'Input Fastify password',
  },
}))

vi.mock('../util', () => ({
  base64url: vi.fn((value: Uint8Array) => Buffer.from(value).toString('base64url')),
  getKeypairStore: vi.fn(async () => null),
  saveKeypairStore: vi.fn(async () => undefined),
}))

import { NodeStorage } from './nodeStorage'

interface CapturedFetch {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain' },
  })
}

function captureFetch(handler: (url: string, init: RequestInit) => Response): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = init.headers as Record<string, string> | undefined
      calls.push({
        url: String(input),
        method: init.method ?? 'GET',
        headers: headers ?? {},
        body: typeof init.body === 'string' ? init.body : undefined,
      })
      return handler(String(input), init)
    }) as unknown as typeof fetch,
  )
  return calls
}

describe('Fastify NodeStorage client', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    alertState.alertInput.mockClear()
  })

  it('uses only Fastify storage endpoints for persisted app data', async () => {
    const calls = captureFetch((url) => {
      if (url === '/api/v1/storage/read') return textResponse('hello')
      if (url === '/api/v1/storage/list')
        return jsonResponse({ content: ['database/database.bin'] })
      return jsonResponse({ success: true })
    })
    const storage = new NodeStorage()
    storage.authChecked = true
    vi.spyOn(storage, 'createAuth').mockResolvedValue('auth-token')

    await storage.setItem('database/database.bin', new Uint8Array([1, 2, 3]))
    await expect(storage.getItem('database/database.bin')).resolves.toEqual(Buffer.from('hello'))
    await expect(storage.keys()).resolves.toEqual(['database/database.bin'])
    await storage.removeItem(['coldstorage/a', 'coldstorage/b'])

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'POST /api/v1/storage/write',
      'GET /api/v1/storage/read',
      'GET /api/v1/storage/list',
      'POST /api/v1/storage/remove',
    ])
    expect(calls.every((call) => call.headers['risu-auth'] === 'auth-token')).toBe(true)
    expect(calls[0].headers['file-path']).toBe(Buffer.from('database/database.bin').toString('hex'))
    expect(calls[3].headers['file-path']).toBe(
      `${Buffer.from('coldstorage/a').toString('hex')}$$${Buffer.from('coldstorage/b').toString(
        'hex',
      )}`,
    )
    expect(calls.map((call) => call.url).some((url) => url.startsWith('/api/v1/'))).toBe(true)
    expect(
      calls.map((call) => call.url).some((url) => /^\/api\/(write|read|list|remove)$/.test(url)),
    ).toBe(false)
  })

  it('sets up auth through Fastify auth and crypto endpoints', async () => {
    const calls = captureFetch((url) => {
      if (url === '/api/v1/auth/status') return jsonResponse({ noPassword: true })
      if (url === '/api/v1/auth/crypto') return textResponse('hashed-password')
      return jsonResponse({ success: true })
    })
    const storage = new NodeStorage()
    vi.spyOn(storage, 'createAuth').mockResolvedValue('auth-token')

    await storage.setItem('database/database.bin', new Uint8Array([1]))

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /api/v1/auth/status',
      'POST /api/v1/auth/crypto',
      'POST /api/v1/auth/setup',
      'POST /api/v1/storage/write',
    ])
    expect(JSON.parse(calls[1].body ?? '{}')).toEqual({ data: 'hunter2' })
    expect(JSON.parse(calls[2].body ?? '{}')).toEqual({ password: 'hashed-password' })
    expect(alertState.alertInput).toHaveBeenCalledTimes(1)
  })
})
