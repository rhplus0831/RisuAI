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
  getNodeServerProxyAuth: async () => 'setting-auth-token',
}))

import { clearCachedServerCommandRevision } from '../server/commands'
import { setServerProjectionWriteGuardEnabled } from '../server/projectionWriteGuard.svelte'
import { DBState } from '../stores.svelte'
import type { SettingContext, SettingItem } from './types'
import { setSettingValue } from './utils'

interface CapturedFetch {
  url: string
  method: string
  body: unknown
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubSettingsFetch(): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      calls.push({ url, method: init.method ?? 'GET', body })
      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 4 })
      if (url === '/api/v1/commands/settings/display') {
        return jsonResponse({ error: 'revision_conflict', currentRevision: 8 }, 409)
      }
      return jsonResponse({ revision: 9, event: { type: 'settings.updated' } })
    }) as unknown as typeof fetch,
  )
  return calls
}

beforeEach(() => {
  platformState.isFastifyServer = true
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  DBState.db = { notification: false } as any
})

afterEach(() => {
  vi.unstubAllGlobals()
  setServerProjectionWriteGuardEnabled(false)
})

describe('server-backed data-driven settings', () => {
  it('surfaces conflicts without replaying the same setting patch', async () => {
    const calls = stubSettingsFetch()
    const item: SettingItem = {
      id: 'notification',
      type: 'check',
      bindKey: 'notification' as keyof typeof DBState.db,
    }
    const ctx = { db: DBState.db, modelInfo: {}, subModelInfo: {} } as SettingContext

    setSettingValue(item, true, ctx)

    await vi.waitFor(() => {
      expect(DBState.db.notification).toBe(false)
    })

    expect(calls).toEqual([
      { url: '/api/v1/bootstrap', method: 'GET', body: null },
      {
        url: '/api/v1/commands/settings/display',
        method: 'PATCH',
        body: { baseRevision: 4, patch: { notification: true } },
      },
    ])
  })
})
