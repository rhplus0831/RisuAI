import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// MCP `setCharacterInfo` restores only the target row on command failure.

vi.mock('src/ts/platform', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/platform')>()
  return { ...actual, isFastifyServer: true }
})

vi.mock('src/ts/storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'mcp-character-token',
}))

vi.mock('src/ts/alert', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/alert')>()
  return { ...actual, alertConfirm: vi.fn(async () => true) }
})

import { clearCachedServerCommandRevision } from 'src/ts/server/commands'
import { setServerProjectionWriteGuardEnabled } from 'src/ts/server/projectionWriteGuard.svelte'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { seedCloneCostDb } from 'src/ts/__tests__/cloneCostHarness'
import { CharacterHandler } from '../characters'

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

function stubCommandFetch(patchStatus = 200): CapturedFetch[] {
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
      if (url === '/api/v1/commands/characters/char-1') {
        if (patchStatus !== 200) return jsonResponse({ error: 'nope' }, patchStatus)
        return jsonResponse({
          revision: 11,
          event: { type: 'character.updated', revision: 11, resource: 'character' },
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

async function waitForCallCount(calls: CapturedFetch[], expected: number): Promise<void> {
  for (let attempt = 0; attempt < 40 && calls.length < expected; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(calls).toHaveLength(expected)
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  DBState.db = seedCloneCostDb() as any // char-0 large (40 messages), siblings small
  selectedCharID.set(0)
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  selectedCharID.set(-1)
  vi.unstubAllGlobals()
})

describe('MCP setCharacterInfo single-row snapshot (L35)', () => {
  it('L35: setCharacterInfo patches via a scoped character command', async () => {
    const calls = stubCommandFetch()
    const handler = new CharacterHandler()

    const result = await handler.handle('risu-set-character-info', {
      id: 'char-1',
      data: { name: 'Renamed via MCP' },
    })

    expect(result?.[0]).toMatchObject({ type: 'text' })
    expect((result?.[0] as { text: string }).text).toContain('Successfully updated')

    await waitForCallCount(calls, 2)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/characters/char-1',
      method: 'PATCH',
      body: { baseRevision: 10, patch: { name: 'Renamed via MCP' } },
    })
  })

  it('L35: a failed patch rolls back only the target row, preserving sibling edits', async () => {
    const calls = stubCommandFetch(500)
    const handler = new CharacterHandler()

    await handler.handle('risu-set-character-info', {
      id: 'char-1',
      data: { name: 'Renamed via MCP' },
    })
    // a concurrent, unrelated sibling edit the old whole-corpus restore
    // (restoreCharacterState) would have wiped
    DBState.db.characters[0].name = 'Concurrent sibling edit'

    await waitForCallCount(calls, 2)
    await new Promise((resolve) => setTimeout(resolve, 0))

    // dispatchUpdateCharacterScoped rolls back through the single-row restore
    // (restoreCharacterRow), touching only char-1.
    expect(DBState.db.characters[1].name).toBe('Character 1')
    expect(DBState.db.characters[0].name).toBe('Concurrent sibling edit')
  })
})
