import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./platform', async (importActual) => {
  const actual = await importActual<typeof import('./platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'chat-select-token',
}))

// stores first, then the heavy globalApi module (test import-order TDZ).
import { selectedCharID } from './stores.svelte'
import { changeChatTo } from './globalApi.svelte'
import { testDatabaseState } from './__tests__/resourceDatabaseState'
import { clearCachedServerCommandRevision } from './server/commands'
import { seedCloneCostDb, withCloneInstrumentation } from './__tests__/cloneCostHarness'

// Guards chat selection against whole-collection cloning.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  testDatabaseState.db = seedCloneCostDb() as any
  ;(testDatabaseState.db.characters[0].chats as unknown[]).push({
    id: 'chat-0b',
    name: 'Chat 0b',
    note: '',
    folderId: null,
    message: [],
    localLore: [],
    scriptstate: {},
  })
  selectedCharID.set(0)
  // The select dispatch fires fetches asynchronously after the click returns.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
      return jsonResponse({
        revision: 11,
        event: { type: 'chat.updated', revision: 11, resource: 'chat' },
        selectedChatId: 'chat-0b',
      })
    }) as unknown as typeof fetch,
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('changeChatTo (H2 clone-cost gate)', () => {
  it('switches chatPage by index without cloning the characters array', () => {
    const charactersSize = JSON.stringify(testDatabaseState.db.characters).length

    const instrumented = withCloneInstrumentation(() => changeChatTo(1))

    expect(testDatabaseState.db.characters[0].chatPage).toBe(1)
    // The old whole-characters snapshot showed up here as a clone at least as
    // large as the serialized characters array.
    expect(instrumented.maxClonedSize).toBeLessThan(charactersSize)
  })

  it('switches chatPage by chat id without cloning the characters array', () => {
    const charactersSize = JSON.stringify(testDatabaseState.db.characters).length

    const instrumented = withCloneInstrumentation(() => changeChatTo('chat-0b'))

    expect(testDatabaseState.db.characters[0].chatPage).toBe(1)
    expect(instrumented.maxClonedSize).toBeLessThan(charactersSize)
  })

  it('returns without mutation for an unknown chat id', () => {
    changeChatTo('missing-chat')
    expect(testDatabaseState.db.characters[0].chatPage).toBe(0)
  })
})
