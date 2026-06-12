import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// runTrigger clones only the active state required by the trigger path.

vi.mock('../platform', async (importActual) => {
  const actual = await importActual<typeof import('../platform')>()
  return { ...actual, isFastifyServer: true }
})

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'trigger-clonecost-token',
}))

vi.mock('./modules', async (importActual) => {
  const actual = await importActual<typeof import('./modules')>()
  return { ...actual, getModuleTriggers: () => [], moduleUpdate: () => {} }
})

import { safeStructuredClone } from '../polyfill'
import { runTrigger } from './triggers'
import { clearCachedServerCommandRevision } from '../server/commands'
import { setServerProjectionWriteGuardEnabled } from '../server/projectionWriteGuard.svelte'
import { DBState, selectedCharID } from '../stores.svelte'
import { withCloneInstrumentation } from '../__tests__/cloneCostHarness'
import type { character } from '../storage/database.svelte'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubCommandFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
      if (url.startsWith('/api/v1/commands/chats/')) {
        return jsonResponse({
          revision: 11,
          event: { type: 'chat.updated', revision: 11, resource: 'chat' },
        })
      }
      return jsonResponse({ revision: 11, event: { type: 'noop', revision: 11 } })
    }) as unknown as typeof fetch,
  )
}

// Active chat (chatPage 0) is tiny; a sibling chat carries a large message
// history so a whole-character clone is distinguishable by size from an
// active-chat-only clone.
function seedDb(): { activeChat: unknown; siblingSize: number } {
  const body = 'z'.repeat(2000)
  const siblingMessages = Array.from({ length: 40 }, (_unused, index) => ({
    role: index % 2 === 0 ? 'user' : 'char',
    data: `${body}-${index}`,
    chatId: `sib-${index}`,
  }))
  selectedCharID.set(0)
  DBState.db = {
    characters: [
      {
        chaId: 'char-a',
        name: 'Character',
        desc: '',
        chatPage: 0,
        chats: [
          { id: 'chat-1', message: [], note: '', name: 'active', localLore: [], scriptstate: {} },
          { id: 'chat-2', message: siblingMessages, note: '', name: 'big', localLore: [], scriptstate: {} },
        ],
        triggerscript: [],
        defaultVariables: '',
        globalLore: [],
        type: 'character',
      },
    ],
    characterOrder: [],
    templateDefaultVariables: '',
  } as any
  return {
    activeChat: DBState.db.characters[0].chats[0],
    siblingSize: JSON.stringify(siblingMessages).length,
  }
}

function characterWithTriggers(triggerscript: unknown[]): character {
  return { ...DBState.db.characters[0], triggerscript } as unknown as character
}

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).safeStructuredClone = safeStructuredClone
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  seedDb()
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  vi.unstubAllGlobals()
  selectedCharID.set(-1)
})

describe('runTrigger clone cost (Phase 3)', () => {
  it('a zero-trigger character pays no char/chat clone (early return)', () => {
    const { siblingSize } = seedDb()
    expect(siblingSize).toBeGreaterThan(50_000)
    setServerProjectionWriteGuardEnabled(true)
    const char = characterWithTriggers([])

    const instrumented = withCloneInstrumentation(() => runTrigger(char, 'manual', { chat: char.chats[char.chatPage] }))

    // The early return runs before any clone primitive.
    expect(instrumented.structuredCloneCount).toBe(0)
    // The pass returns null synchronously for a zero-trigger character.
    return expect(instrumented.result).resolves.toBeNull()
  })

  it('a setVar trigger clones only the active chat, never the whole character', async () => {
    const { siblingSize } = seedDb()
    expect(siblingSize).toBeGreaterThan(50_000)
    stubCommandFetch()
    // Runs under the projection guard: `setVar` now writes the optimistic
    // scriptstate through `withTrustedServerProjectionWrite`, so a trigger-bearing
    // pass clones only the active chat (the large sibling transcript a whole-char
    // clone would serialize is never cloned) and does not throw on the read-only
    // projection.
    setServerProjectionWriteGuardEnabled(true)
    const char = characterWithTriggers([
      {
        comment: 'set',
        type: 'manual',
        conditions: [],
        effect: [{ type: 'v2SetVar', var: 'score', operator: '=', valueType: 'value', value: '1' }],
      },
    ])

    const instrumented = withCloneInstrumentation(() =>
      runTrigger(char, 'manual', { chat: char.chats[char.chatPage], manualName: 'set' }),
    )

    // The synchronous clone work is bounded to the tiny active chat — the large
    // sibling transcript (which a whole-character clone would serialize) is never
    // cloned.
    expect(instrumented.maxClonedSize).toBeLessThan(siblingSize)
    await instrumented.result
  })
})
