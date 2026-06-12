import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./platform', async (importActual) => {
  const actual = await importActual<typeof import('./platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'image-emotion-token',
}))

import { clearCachedServerCommandRevision } from './server/commands'
import { setServerProjectionWriteGuardEnabled } from './server/projectionWriteGuard.svelte'
import { DBState, selectedCharID } from './stores.svelte'
import { seedCloneCostDb, withCloneInstrumentation } from './__tests__/cloneCostHarness'
// Import the heavy `./characters` module last so its circular dependency on
// `stores`/`database` finishes initializing before the reactive `moduleUpdate`
// effect can run (matches the working characters.importChat test ordering).
import { rmCharEmotion } from './characters'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function tick(times = 2): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  selectedCharID.set(0)
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('Phase 7 image/emotion scoped rollback', () => {
  it('rmCharEmotion captures a single-row baseline, never the whole characters array', async () => {
    // char-0 carries the large 40-message hydrated transcript; the edit targets a
    // small sibling so a whole-array clone would dwarf the single-row clone.
    DBState.db = seedCloneCostDb() as any
    ;(DBState.db.characters[1] as any).emotionImages = [
      ['happy', 'happy.png'],
      ['sad', 'sad.png'],
    ]
    selectedCharID.set(1)
    const charactersSize = JSON.stringify(DBState.db.characters).length
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ revision: 10 })) as unknown as typeof fetch)

    const instrumented = withCloneInstrumentation(() => {
      rmCharEmotion(1, 0)
    })

    // the rollback baseline + diff clone only the one edited row, never the
    // multi-message corpus stored on char-0.
    expect(instrumented.maxClonedSize).toBeLessThan(charactersSize)
    expect(DBState.db.characters[1].emotionImages).toEqual([['sad', 'sad.png']])

    await tick()
  })

  it('rolls back only the edited row on command failure, leaving siblings intact', async () => {
    DBState.db = seedCloneCostDb() as any
    ;(DBState.db.characters[1] as any).emotionImages = [
      ['happy', 'happy.png'],
      ['sad', 'sad.png'],
    ]
    selectedCharID.set(1)

    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        calls.push(url)
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
        if (url === '/api/v1/commands/characters/char-1') {
          return jsonResponse({ error: 'nope' }, 500)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    rmCharEmotion(1, 0)
    // a concurrent edit to an unrelated sibling that a whole-array restore wipes.
    DBState.db.characters[2].name = 'Concurrent sibling edit'

    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (DBState.db.characters[1].emotionImages.length >= 2) break
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    // the failed update restores only char-1's emotionImages; the sibling edit
    // survives, proving the rollback did not reinstall the whole characters array.
    expect(DBState.db.characters[1].emotionImages).toEqual([
      ['happy', 'happy.png'],
      ['sad', 'sad.png'],
    ])
    expect(DBState.db.characters[2].name).toBe('Concurrent sibling edit')
  })
})
