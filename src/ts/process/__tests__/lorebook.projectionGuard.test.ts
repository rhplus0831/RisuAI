import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Regression coverage for the Phase 9 projection-guard audit: the global
// lorebook add / folder / import helpers captured a `lorebook`/`lore` alias
// from the read-only projection *before* the trusted write swapped DBState.db
// to a mutable clone, then pushed into that stale alias and threw. The writes
// must run against the freshly-cloned mutable projection and still dispatch the
// matching global-lorebook command.

const platformState = vi.hoisted(() => ({ isFastifyServer: true }))

vi.mock('../../platform', async (importActual) => {
  const actual = await importActual<typeof import('../../platform')>()
  return {
    ...actual,
    get isFastifyServer() {
      return platformState.isFastifyServer
    },
  }
})

vi.mock('../../storage/nodeStorage', () => ({
  getNodeServerProxyAuth: async () => 'lorebook-projection-token',
}))

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, getModuleLorebooks: () => [] }
})

const fileSelection = vi.hoisted(() => ({ data: null as Uint8Array | null }))

vi.mock('../../util', async (importActual) => {
  const actual = await importActual<typeof import('../../util')>()
  return {
    ...actual,
    selectSingleFile: async () => ({ name: 'lore.json', data: fileSelection.data }),
  }
})

import { safeStructuredClone } from '../../polyfill'
import { addLorebook, addLorebookFolder, importLoreBook } from '../lorebook.svelte'
import { clearCachedServerCommandRevision } from '../../server/commands'
import { setServerProjectionWriteGuardEnabled } from '../../server/projectionWriteGuard.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'

interface CapturedFetch {
  url: string
  method: string
  body: any
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubCommandFetch(): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      })
      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
      if (/\/api\/v1\/commands\/lorebooks\/[^/]+\/entries$/.test(url)) {
        return jsonResponse({
          revision: 11,
          event: { type: 'lorebook.entries.replaced', revision: 11, resource: 'lorebook' },
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

async function waitForCommand(
  calls: CapturedFetch[],
  predicate: (call: CapturedFetch) => boolean,
): Promise<CapturedFetch> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const match = calls.find(predicate)
    if (match) return match
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`command not dispatched; saw: ${JSON.stringify(calls)}`)
}

function seedDatabase(): void {
  selectedCharID.set(0)
  DBState.db = {
    loreBook: [{ id: 'lore-1', name: 'Global', data: [] }],
    loreBookPage: 0,
    characters: [
      {
        chaId: 'char-a',
        name: 'Character',
        chatPage: 0,
        chats: [{ id: 'chat-1', message: [], note: '', name: 'main', localLore: [] }],
        globalLore: [],
        type: 'character',
      },
    ],
    modules: [],
    characterOrder: [],
  } as any
}

const isGlobalEntries = (call: CapturedFetch) =>
  /\/api\/v1\/commands\/lorebooks\/lore-1\/entries$/.test(call.url) && call.method === 'PUT'

beforeEach(() => {
  platformState.isFastifyServer = true
  ;(globalThis as Record<string, unknown>).safeStructuredClone = safeStructuredClone
  fileSelection.data = null
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  seedDatabase()
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('global lorebook durable writes under the projection guard', () => {
  it('baseline: a raw global lorebook write throws while the guard is active', () => {
    setServerProjectionWriteGuardEnabled(true)
    expect(() => {
      ;(DBState.db.loreBook[0] as { data: unknown[] }).data.push({ id: 'raw' })
    }).toThrow(/read-only server projection/)
  })

  it('addLorebook(-1) appends a global entry and dispatches the entries command', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    expect(() => addLorebook(-1)).not.toThrow()
    expect((DBState.db.loreBook[0] as { data: unknown[] }).data).toHaveLength(1)

    const cmd = await waitForCommand(calls, isGlobalEntries)
    expect(cmd.body.entries).toHaveLength(1)
  })

  it('addLorebookFolder(-1) appends a global folder and dispatches the entries command', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    expect(() => addLorebookFolder(-1)).not.toThrow()
    const entries = (DBState.db.loreBook[0] as { data: { mode?: string }[] }).data
    expect(entries).toHaveLength(1)
    expect(entries[0].mode).toBe('folder')

    const cmd = await waitForCommand(calls, isGlobalEntries)
    expect(cmd.body.entries).toHaveLength(1)
  })

  it('importLoreBook(sglobal) merges imported entries and dispatches the entries command', async () => {
    const imported = { type: 'risu', data: [{ key: 'imported', comment: 'Imported', content: 'x' }] }
    fileSelection.data = new TextEncoder().encode(JSON.stringify(imported))
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    await expect(importLoreBook('sglobal')).resolves.not.toThrow()
    expect((DBState.db.loreBook[0] as { data: unknown[] }).data).toHaveLength(1)

    const cmd = await waitForCommand(calls, isGlobalEntries)
    expect(cmd.body.entries).toHaveLength(1)
    expect(cmd.body.entries[0].comment).toBe('Imported')
  })
})
