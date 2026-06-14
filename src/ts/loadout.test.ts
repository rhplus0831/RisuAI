import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'loadout-command-token',
}))

import { clearCachedServerCommandRevision } from './server/commands'
import { setServerProjectionWriteGuardEnabled } from './server/projectionWriteGuard.svelte'
import { DBState } from './stores.svelte'
import { deleteLoadout, toggleLoadoutFavorite, type Loadout } from './loadout'

interface CapturedFetch {
  url: string
  method: string
  authHeader: string | null
  body: unknown
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function makeLoadout(overrides: Partial<Loadout>): Loadout {
  return {
    id: 'loadout-a',
    name: 'Loadout A',
    lastUsed: 100,
    favorite: false,
    characterIds: ['char-a'],
    modules: ['module-a'],
    globalVariables: { mood: 'calm' },
    presetName: 'Preset A',
    personaId: 'persona-a',
    ...overrides,
  }
}

function seedLoadouts(): void {
  DBState.db = {
    loadouts: [
      makeLoadout({ id: 'loadout-a', name: 'Loadout A', favorite: false }),
      makeLoadout({ id: 'loadout-b', name: 'Loadout B', favorite: true, lastUsed: 50 }),
    ],
    lastLoadedLoadoutName: 'Loadout A',
  } as any
}

function stubCommandFetch(options: { failCommands?: boolean } = {}): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = init.headers as Record<string, string> | undefined
      const url = String(input)
      calls.push({
        url,
        method: init.method ?? 'GET',
        authHeader: headers?.['risu-auth'] ?? null,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      })

      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
      if (options.failCommands) return jsonResponse({ error: 'forced failure' }, 500)
      if (url === '/api/v1/commands/loadouts/loadout-a/favorite') {
        return jsonResponse({
          revision: 11,
          event: { type: 'loadout.favorited', revision: 11, resource: 'loadout', id: 'loadout-a' },
          loadoutId: 'loadout-a',
        })
      }
      if (url === '/api/v1/commands/loadouts/loadout-b') {
        return jsonResponse({
          revision: 11,
          event: { type: 'loadout.deleted', revision: 11, resource: 'loadout', id: 'loadout-b' },
          loadoutId: 'loadout-b',
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

async function waitForCallCount(calls: CapturedFetch[], expected: number): Promise<void> {
  for (let attempt = 0; attempt < 20 && calls.length < expected; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(calls).toHaveLength(expected)
}

async function flushCommandEffects(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  seedLoadouts()
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('LoadoutModal projection write cleanup', () => {
  it('routes modal favorite and delete operations through loadout domain helpers', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/Others/LoadoutModal.svelte'), 'utf8')

    expect(source).not.toContain('withTrustedServerProjectionWrite')
    expect(source).not.toContain('currentLoadoutStateSnapshot')
    expect(source).not.toContain('dispatchDeleteLoadout')
    expect(source).not.toContain('dispatchFavoriteLoadout')
    expect(source).toContain('toggleLoadoutFavorite')
    expect(source).toContain('deleteLoadout')
  })
})

describe('loadout projection command helpers', () => {
  it('toggles favorite projection, dispatches the favorite command, and rolls back on failure', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    const previousLoadouts = cloneJsonValue(DBState.db.loadouts)
    setServerProjectionWriteGuardEnabled(true)

    expect(() => {
      DBState.db.loadouts[0].favorite = true
    }).toThrow()

    expect(toggleLoadoutFavorite('loadout-a')).toBe(true)
    expect(DBState.db.loadouts[0].favorite).toBe(true)

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'loadout-command-token',
        body: null,
      },
      {
        url: '/api/v1/commands/loadouts/loadout-a/favorite',
        method: 'POST',
        authHeader: 'loadout-command-token',
        body: {
          baseRevision: 10,
          favorite: true,
        },
      },
    ])
    expect(DBState.db.loadouts).toEqual(previousLoadouts)
    expect(DBState.db.lastLoadedLoadoutName).toBe('Loadout A')
  })

  it('removes the deleted loadout projection, dispatches the delete command, and rolls back on failure', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    const previousLoadouts = cloneJsonValue(DBState.db.loadouts)
    setServerProjectionWriteGuardEnabled(true)

    expect(deleteLoadout('loadout-b')).toBe(true)
    expect(DBState.db.loadouts.map((loadout) => loadout.id)).toEqual(['loadout-a'])

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'loadout-command-token',
        body: null,
      },
      {
        url: '/api/v1/commands/loadouts/loadout-b',
        method: 'DELETE',
        authHeader: 'loadout-command-token',
        body: {
          baseRevision: 10,
        },
      },
    ])
    expect(DBState.db.loadouts).toEqual(previousLoadouts)
    expect(DBState.db.lastLoadedLoadoutName).toBe('Loadout A')
  })

  it('returns false for missing ids without dispatching commands or mutating loadouts', () => {
    const calls = stubCommandFetch()
    const previousLoadouts = cloneJsonValue(DBState.db.loadouts)
    setServerProjectionWriteGuardEnabled(true)

    expect(toggleLoadoutFavorite('missing-loadout')).toBe(false)
    expect(deleteLoadout('missing-loadout')).toBe(false)

    expect(calls).toHaveLength(0)
    expect(DBState.db.loadouts).toEqual(previousLoadouts)
  })
})
