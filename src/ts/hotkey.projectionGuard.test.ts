import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Regression coverage: ordinary keydown matching must not mutate
// `DBState.db.hotkeys`, and hotkey settings edits must route through a
// server-backed settings patch instead of a raw projection write. Both throw
// under the read-only server projection guard otherwise.

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

vi.mock('./storage/nodeStorage', () => ({
  getNodeServerProxyAuth: async () => 'hotkey-command-token',
}))

// stores.svelte.ts installs a root $effect that calls moduleUpdate() whenever
// DBState.db changes; stub it so seeding the database does not trigger the
// module pipeline (and its circular-import init order) under test.
vi.mock('./process/modules', async (importActual) => {
  const actual = await importActual<typeof import('./process/modules')>()
  return { ...actual, getModuleTriggers: () => [], moduleUpdate: () => {} }
})

import { hotkeyMatches } from './hotkey'
import { applyServerBackedSetting } from './server/settingsBridge.svelte'
import { settingsGroupForKey, clearCachedServerCommandRevision } from './server/commands'
import { setServerProjectionWriteGuardEnabled } from './server/projectionWriteGuard.svelte'
import { DBState } from './stores.svelte'

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
      if (url.startsWith('/api/v1/commands/settings/')) {
        return jsonResponse({
          revision: 11,
          event: { type: 'settings.patched', revision: 11, resource: 'settings' },
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
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const match = calls.find(predicate)
    if (match) return match
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`command not dispatched; saw: ${JSON.stringify(calls)}`)
}

function seedDatabase(): void {
  DBState.db = {
    hotkeys: [
      { key: 'a', action: 'home' },
      { key: 'r', ctrl: true, alt: true, action: 'reroll' },
    ],
  } as any
}

beforeEach(() => {
  platformState.isFastifyServer = true
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  seedDatabase()
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('hotkey handling under the projection guard', () => {
  it('maps hotkeys to sidebar settings group', () => {
    expect(settingsGroupForKey('hotkeys')).toBe('sidebar')
  })

  it('matches hotkeys without mutating the read-only projection', () => {
    setServerProjectionWriteGuardEnabled(true)

    // Baseline: the guard is active, so a raw projection write throws.
    expect(() => {
      ;(DBState.db.hotkeys[0] as any).ctrl = true
    }).toThrow()

    const hotkey = DBState.db.hotkeys[0]
    const event = new KeyboardEvent('keydown', { key: 'a' })

    // hotkeyMatches must not write default modifier fields back onto the entry.
    let matched = false
    expect(() => {
      matched = hotkeyMatches(hotkey, event)
    }).not.toThrow()
    expect(matched).toBe(true)
    // The entry is left untouched: no defaults were projected onto it.
    expect(hotkey.ctrl).toBeUndefined()
    expect(hotkey.alt).toBeUndefined()
    expect(hotkey.shift).toBeUndefined()
  })

  it('rejects mismatched modifiers without mutation', () => {
    setServerProjectionWriteGuardEnabled(true)

    const hotkey = DBState.db.hotkeys[0]
    const event = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true })

    expect(hotkeyMatches(hotkey, event)).toBe(false)
    expect(hotkey.ctrl).toBeUndefined()
  })

  it('routes a hotkey settings edit through a sidebar settings patch', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    // Mirror HotkeySettings.svelte: build a fresh array and apply it.
    const next = DBState.db.hotkeys.map((hotkey, i) =>
      i === 0 ? { ...hotkey, ctrl: true } : { ...hotkey },
    )

    expect(() => applyServerBackedSetting('hotkeys', next)).not.toThrow()

    // Optimistic projection update is applied without throwing the guard.
    expect(DBState.db.hotkeys[0].ctrl).toBe(true)

    const patch = await waitForCommand(
      calls,
      (call) => call.url === '/api/v1/commands/settings/sidebar' && call.method === 'PATCH',
    )
    expect(patch.body.patch.hotkeys).toBeDefined()
    expect(patch.body.patch.hotkeys[0].ctrl).toBe(true)
    expect(patch.body.patch.hotkeys[0].action).toBe('home')
  })
})
