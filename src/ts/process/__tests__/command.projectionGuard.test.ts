import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Regression coverage: slash-command handlers (`/send`, `/setvar`, `/cut`, ...)
// apply an optimistic local update before dispatching a command. That update
// must run inside a trusted write scope so it does not throw against the
// server-backed read-only projection guard, and it must still dispatch the
// matching chat command.

vi.mock('../../platform', async (importActual) => {
  const actual = await importActual<typeof import('../../platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('../../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'command-projection-token',
}))

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, getModuleTriggers: () => [], moduleUpdate: () => {} }
})

// M12 spy: count setDatabase normalizer runs without changing its behavior.
// `/setvar`/`/addvar` must not reach it (the in-place scriptstate write + the
// scoped dispatch persist the change); `/send`'s message mutation still does.
const setDatabaseSpy = vi.hoisted(() => ({ count: 0 }))
vi.mock('../../storage/database.svelte', async (importActual) => {
  const actual = await importActual<typeof import('../../storage/database.svelte')>()
  return {
    ...actual,
    setDatabase: (...args: Parameters<typeof actual.setDatabase>) => {
      setDatabaseSpy.count += 1
      return actual.setDatabase(...args)
    },
  }
})

import { safeStructuredClone } from '../../polyfill'
import { processMultiCommand } from '../command'
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
      if (url.endsWith('/scriptstate')) {
        return jsonResponse({
          revision: 11,
          event: { type: 'chat.scriptstate.updated', revision: 11, resource: 'chat' },
        })
      }
      if (url.endsWith('/messages')) {
        return jsonResponse({
          revision: 11,
          event: { type: 'messages.replaced', revision: 11, resource: 'chat' },
        })
      }
      if (url.startsWith('/api/v1/commands/chats/')) {
        return jsonResponse({
          revision: 11,
          event: { type: 'chat.updated', revision: 11, resource: 'chat' },
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

function seedDatabase(messages: unknown[] = []): void {
  selectedCharID.set(0)
  DBState.db = {
    characters: [
      {
        chaId: 'char-a',
        name: 'Character',
        desc: '',
        chatPage: 0,
        chats: [
          {
            id: 'chat-1',
            message: messages,
            note: '',
            name: 'main',
            localLore: [],
            scriptstate: {},
          },
        ],
        triggerscript: [],
        defaultVariables: '',
        globalLore: [],
        type: 'character',
      },
    ],
    characterOrder: [],
    customscript: [],
  } as any
}

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).safeStructuredClone = safeStructuredClone
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  seedDatabase()
  setDatabaseSpy.count = 0
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('slash-command durable writes under the projection guard', () => {
  it('baseline: a raw projection write throws while the guard is active', () => {
    setServerProjectionWriteGuardEnabled(true)
    expect(() => {
      DBState.db.characters[0].chats[0].message.push({ role: 'user', data: 'raw' })
    }).toThrow(/read-only server projection/)
  })

  it('/send appends a message without throwing and replaces messages via command', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    await expect(processMultiCommand('/send hello world')).resolves.not.toBe(false)

    const cmd = await waitForCommand(
      calls,
      (call) => call.url === '/api/v1/commands/chats/chat-1/messages' && call.method === 'PUT',
    )
    const lastMessage = cmd.body.messages[cmd.body.messages.length - 1]
    expect(lastMessage).toMatchObject({ role: 'user', data: 'hello world' })
  })

  it('/setvar updates chat scriptstate via the scriptstate command', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    await expect(processMultiCommand('/setvar key=hp 100')).resolves.not.toThrow()

    const cmd = await waitForCommand(
      calls,
      (call) =>
        call.url === '/api/v1/commands/chats/chat-1/scriptstate' && call.method === 'PATCH',
    )
    expect(cmd.body.patch['$hp']).toBe('100')
  })

  it('M12: /setvar persists scriptstate without re-running the setDatabase normalizer', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    await expect(processMultiCommand('/setvar key=hp 100')).resolves.not.toThrow()

    // The in-place write landed and the scoped command dispatched...
    expect(DBState.db.characters[0].chats[0].scriptstate?.['$hp']).toBe('100')
    const cmd = await waitForCommand(
      calls,
      (call) =>
        call.url === '/api/v1/commands/chats/chat-1/scriptstate' && call.method === 'PATCH',
    )
    expect(cmd.body.patch['$hp']).toBe('100')
    // ...without the ~680-line normalizer (and its non-English language-pack
    // deep clone) running once per var write.
    expect(setDatabaseSpy.count).toBe(0)
  })

  it('M12: /addvar persists the incremented value without the setDatabase normalizer', async () => {
    seedDatabase()
    DBState.db.characters[0].chats[0].scriptstate = { $damage: '5' }
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    await expect(processMultiCommand('/addvar key=damage 10')).resolves.not.toThrow()

    expect(DBState.db.characters[0].chats[0].scriptstate?.['$damage']).toBe('15')
    const cmd = await waitForCommand(
      calls,
      (call) =>
        call.url === '/api/v1/commands/chats/chat-1/scriptstate' && call.method === 'PATCH',
    )
    expect(cmd.body.patch['$damage']).toBe('15')
    expect(setDatabaseSpy.count).toBe(0)
  })

  it('M12 boundary: /send still runs setDatabase (message mutation is not lumped in)', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    await expect(processMultiCommand('/send hello world')).resolves.not.toBe(false)
    await waitForCommand(
      calls,
      (call) => call.url === '/api/v1/commands/chats/chat-1/messages' && call.method === 'PUT',
    )

    expect(setDatabaseSpy.count).toBeGreaterThan(0)
  })

  it('/del truncates message history without throwing', async () => {
    seedDatabase([
      { role: 'user', data: 'one', chatId: 'm1' },
      { role: 'char', data: 'two', chatId: 'm2' },
    ])
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    await expect(processMultiCommand('/del 1')).resolves.not.toThrow()

    const cmd = await waitForCommand(
      calls,
      (call) => call.url === '/api/v1/commands/chats/chat-1/messages' && call.method === 'PUT',
    )
    expect(cmd.body.messages.length).toBe(1)
  })

  it('L37: command processing logs nothing to console.log on the warm path', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)
    const logSpy = vi.spyOn(console, 'log')

    try {
      // A piped multi-command exercises both former log sites: the parsed
      // `splited` dump and the per-step `pipe` dump.
      await expect(processMultiCommand('/setvar key=hp 100|/getvar key=hp')).resolves.toBe('100')
      await waitForCommand(
        calls,
        (call) =>
          call.url === '/api/v1/commands/chats/chat-1/scriptstate' && call.method === 'PATCH',
      )
      expect(logSpy).not.toHaveBeenCalled()
    } finally {
      logSpy.mockRestore()
    }
  })
})
