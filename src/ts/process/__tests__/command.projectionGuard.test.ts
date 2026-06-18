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

const sendChatMock = vi.hoisted(() => vi.fn(async () => true))
vi.mock('../index.svelte', () => ({
  sendChat: sendChatMock,
}))

// Spy: count setDatabase normalizer runs without changing its behavior.
// `/setvar`/`/addvar` and send-family message mutations must not reach it: the
// trusted in-place write plus scoped dispatch persist the change without the
// whole-database normalizer and language refresh churn.
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
import {
  setServerProjectionWriteGuardEnabled,
  withTrustedServerProjectionWrite,
} from '../../server/projectionWriteGuard.svelte'
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

async function waitForMatchingCalls(
  calls: CapturedFetch[],
  predicate: (call: CapturedFetch) => boolean,
  expected: number,
): Promise<CapturedFetch[]> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const matches = calls.filter(predicate)
    if (matches.length >= expected) return matches
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`expected ${expected} matching commands; saw: ${JSON.stringify(calls)}`)
}

function commandMessages(call: CapturedFetch): Array<Record<string, unknown>> {
  const body = call.body as { messages?: Array<Record<string, unknown>> } | null
  return body?.messages ?? []
}

async function runMessageCommand(command: string, messages: unknown[]): Promise<Array<Record<string, unknown>>> {
  seedDatabase(messages)
  const calls = stubCommandFetch()
  setServerProjectionWriteGuardEnabled(true)

  await expect(processMultiCommand(command)).resolves.not.toBe(false)

  const cmd = await waitForCommand(
    calls,
    (call) => call.url === '/api/v1/commands/chats/chat-1/messages' && call.method === 'PUT',
  )
  return commandMessages(cmd)
}

async function withAsyncCloneInstrumentation<T>(fn: () => Promise<T>) {
  const originalStringify = JSON.stringify
  const originalStructuredClone = globalThis.structuredClone
  let jsonCloneCount = 0
  let structuredCloneCount = 0
  let maxClonedSize = 0

  const measure = (value: unknown): number => {
    try {
      return (originalStringify as (input: unknown) => string)(value)?.length ?? 0
    } catch {
      return 0
    }
  }

  const trackedStringify = function trackedStringify(
    this: unknown,
    value: unknown,
    replacer?: unknown,
    space?: unknown,
  ) {
    jsonCloneCount += 1
    const out = (originalStringify as (...args: unknown[]) => string).call(this, value, replacer, space)
    if (typeof out === 'string' && out.length > maxClonedSize) maxClonedSize = out.length
    return out
  } as unknown as typeof JSON.stringify

  const trackedStructuredClone = function trackedStructuredClone<V>(value: V): V {
    structuredCloneCount += 1
    const size = measure(value)
    if (size > maxClonedSize) maxClonedSize = size
    return (originalStructuredClone as (input: V) => V)(value)
  } as typeof structuredClone

  JSON.stringify = trackedStringify
  globalThis.structuredClone = trackedStructuredClone
  try {
    const result = await fn()
    return {
      result,
      jsonCloneCount,
      structuredCloneCount,
      totalCloneCount: jsonCloneCount + structuredCloneCount,
      maxClonedSize,
    }
  } finally {
    JSON.stringify = originalStringify
    globalThis.structuredClone = originalStructuredClone
  }
}

function seedDatabase(messages: unknown[] = [], options: { language?: string; includeSiblings?: boolean } = {}): void {
  selectedCharID.set(0)
  const activeChats = [
    {
      id: 'chat-1',
      message: messages,
      note: '',
      name: 'main',
      localLore: [],
      scriptstate: {},
    },
  ]
  if (options.includeSiblings) {
    activeChats.push({
      id: 'chat-active-sibling',
      message: [{ role: 'user', data: 'active sibling', chatId: 'm-active-sibling' }],
      note: '',
      name: 'active sibling',
      localLore: [],
      scriptstate: {},
    })
  }
  DBState.db = {
    language: options.language ?? 'en',
    characters: [
      {
        chaId: 'char-a',
        name: 'Character',
        desc: '',
        chatPage: 0,
        chats: activeChats,
        triggerscript: [],
        defaultVariables: '',
        globalLore: [],
        type: 'character',
      },
      ...(options.includeSiblings
        ? [
            {
              chaId: 'char-b',
              name: 'Sibling Character',
              desc: '',
              chatPage: 0,
              chats: [
                {
                  id: 'chat-sibling',
                  message: [{ role: 'user', data: 'sibling', chatId: 'm-sibling' }],
                  note: '',
                  name: 'sibling',
                  localLore: [],
                  scriptstate: {},
                },
              ],
              triggerscript: [],
              defaultVariables: '',
              globalLore: [],
              type: 'character',
            },
          ]
        : []),
    ],
    characterOrder: [],
    customscript: [],
  } as any
}

function seedLargeSiblingDatabase(): void {
  seedDatabase([{ role: 'user', data: 'seed', chatId: 'm-seed' }], {
    language: 'ko',
    includeSiblings: true,
  })
  DBState.db.characters[1].chats[0].message = Array.from({ length: 120 }, (_unused, index) => ({
    role: index % 2 === 0 ? 'user' : 'char',
    data: `${'x'.repeat(500)}-${index}`,
    chatId: `m-sibling-large-${index}`,
  }))
}

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).safeStructuredClone = safeStructuredClone
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  seedDatabase()
  setDatabaseSpy.count = 0
  sendChatMock.mockClear()
  sendChatMock.mockResolvedValue(true)
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

  it('L32: /send appends a user message without setDatabase or whole-db clone churn', async () => {
    seedLargeSiblingDatabase()
    const wholeCharactersSize = JSON.stringify(DBState.db.characters).length
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    const instrumented = await withAsyncCloneInstrumentation(() => processMultiCommand('/send hello world'))

    expect(instrumented.result).toBe('')
    expect(DBState.db.characters[0].chats[0].message.at(-1)).toMatchObject({
      role: 'user',
      data: 'hello world',
    })
    expect(setDatabaseSpy.count).toBe(0)
    expect(instrumented.maxClonedSize).toBeLessThan(wholeCharactersSize)
    expect(instrumented.structuredCloneCount).toBe(0)

    const cmd = await waitForCommand(
      calls,
      (call) => call.url === '/api/v1/commands/chats/chat-1/messages' && call.method === 'PUT',
    )
    const lastMessage = commandMessages(cmd).at(-1)
    expect(lastMessage).toMatchObject({ role: 'user', data: 'hello world' })
  })

  it('L32: /send preserves pipe return behavior while appending the piped text', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    await expect(processMultiCommand('/pass piped text|/send {{pipe}}')).resolves.toBe('piped text')

    const cmd = await waitForCommand(
      calls,
      (call) => call.url === '/api/v1/commands/chats/chat-1/messages' && call.method === 'PUT',
    )
    expect(commandMessages(cmd).at(-1)).toMatchObject({ role: 'user', data: 'piped text' })
    expect(setDatabaseSpy.count).toBe(0)
  })

  it('L32: /sendas appends a character message without setDatabase', async () => {
    const messages = await runMessageCommand('/sendas character line', [
      { role: 'user', data: 'seed', chatId: 'm-seed' },
    ])

    expect(messages).toHaveLength(2)
    expect(messages.at(-1)).toMatchObject({ role: 'char', data: 'character line' })
    expect(DBState.db.characters[0].chats[0].message.at(-1)).toMatchObject({
      role: 'char',
      data: 'character line',
    })
    expect(setDatabaseSpy.count).toBe(0)
  })

  it('L32: /comment appends the legacy comment block to the last message', async () => {
    const messages = await runMessageCommand('/comment side note', [{ role: 'char', data: 'base', chatId: 'm-base' }])

    expect(messages).toEqual([
      {
        role: 'char',
        data: 'base<Comment>\nside note\n</Comment>',
        chatId: 'm-base',
      },
    ])
    expect(setDatabaseSpy.count).toBe(0)
  })

  it('L32: /cut range keeps the legacy sliced transcript bytes', async () => {
    const messages = await runMessageCommand('/cut 1-3', [
      { role: 'user', data: 'zero', chatId: 'm0' },
      { role: 'char', data: 'one', chatId: 'm1' },
      { role: 'user', data: 'two', chatId: 'm2' },
      { role: 'char', data: 'three', chatId: 'm3' },
    ])

    expect(messages.map((message) => message.chatId)).toEqual(['m1', 'm2'])
    expect(setDatabaseSpy.count).toBe(0)
  })

  it('L32: /cut index keeps the legacy spliced row bytes', async () => {
    const messages = await runMessageCommand('/cut 1', [
      { role: 'user', data: 'zero', chatId: 'm0' },
      { role: 'char', data: 'one', chatId: 'm1' },
      { role: 'user', data: 'two', chatId: 'm2' },
    ])

    expect(messages).toEqual([{ role: 'char', data: 'one', chatId: 'm1' }])
    expect(setDatabaseSpy.count).toBe(0)
  })

  it('L32: /cut id removes the matching chatId without setDatabase', async () => {
    const messages = await runMessageCommand('/cut m2', [
      { role: 'user', data: 'zero', chatId: 'm0' },
      { role: 'char', data: 'one', chatId: 'm1' },
      { role: 'user', data: 'two', chatId: 'm2' },
    ])

    expect(messages.map((message) => message.chatId)).toEqual(['m0', 'm1'])
    expect(setDatabaseSpy.count).toBe(0)
  })

  it('L32: /del keeps the legacy last-N truncation without setDatabase', async () => {
    const messages = await runMessageCommand('/del 2', [
      { role: 'user', data: 'zero', chatId: 'm0' },
      { role: 'char', data: 'one', chatId: 'm1' },
      { role: 'user', data: 'two', chatId: 'm2' },
      { role: 'char', data: 'three', chatId: 'm3' },
    ])

    expect(messages.map((message) => message.chatId)).toEqual(['m2', 'm3'])
    expect(setDatabaseSpy.count).toBe(0)
  })

  it('L32: /multisend appends each segment in order and sends after each one', async () => {
    seedDatabase([{ role: 'char', data: 'base', chatId: 'm-base' }])
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    await expect(processMultiCommand('/multisend first|||second')).resolves.toBe('')

    const messageCommands = await waitForMatchingCalls(
      calls,
      (call) => call.url === '/api/v1/commands/chats/chat-1/messages' && call.method === 'PUT',
      2,
    )
    expect(messageCommands.map((call) => commandMessages(call).map((message) => message.data))).toEqual([
      ['base', 'first'],
      ['base', 'first', 'second'],
    ])
    expect(DBState.db.characters[0].chats[0].message.map((message: any) => message.data)).toEqual([
      'base',
      'first',
      'second',
    ])
    expect(sendChatMock).toHaveBeenCalledTimes(2)
    expect(sendChatMock).toHaveBeenNthCalledWith(1, -1)
    expect(sendChatMock).toHaveBeenNthCalledWith(2, -1)
    expect(setDatabaseSpy.count).toBe(0)
  })

  it('L32: /multisend stops after the active chat changes during the first send', async () => {
    seedDatabase([{ role: 'char', data: 'base', chatId: 'm-base' }], { includeSiblings: true })
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)
    sendChatMock.mockImplementationOnce(async () => {
      withTrustedServerProjectionWrite(() => {
        DBState.db.characters[0].chatPage = 1
      })
      return true
    })

    await expect(processMultiCommand('/multisend first|||second')).resolves.toBe('')

    await waitForMatchingCalls(
      calls,
      (call) => call.url === '/api/v1/commands/chats/chat-1/messages' && call.method === 'PUT',
      1,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    const messageCommands = calls.filter(
      (call) => call.url === '/api/v1/commands/chats/chat-1/messages' && call.method === 'PUT',
    )
    expect(messageCommands).toHaveLength(1)
    expect(commandMessages(messageCommands[0]).map((message) => message.data)).toEqual(['base', 'first'])
    expect(DBState.db.characters[0].chats[0].message.map((message: any) => message.data)).toEqual(['base', 'first'])
    expect(DBState.db.characters[0].chats[1].message.map((message: any) => message.data)).toEqual(['active sibling'])
    expect(sendChatMock).toHaveBeenCalledTimes(1)
    expect(sendChatMock).toHaveBeenCalledWith(-1)
    expect(setDatabaseSpy.count).toBe(0)
  })

  it('L32: /multisend clear resets before each segment and still sends each segment', async () => {
    seedDatabase([{ role: 'char', data: 'base', chatId: 'm-base' }])
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    await expect(processMultiCommand('/multisend clear|||first|||second')).resolves.toBe('')

    const messageCommands = await waitForMatchingCalls(
      calls,
      (call) => call.url === '/api/v1/commands/chats/chat-1/messages' && call.method === 'PUT',
      2,
    )
    expect(messageCommands.map((call) => commandMessages(call).map((message) => message.data))).toEqual([
      ['first'],
      ['second'],
    ])
    expect(DBState.db.characters[0].chats[0].message.map((message: any) => message.data)).toEqual(['second'])
    expect(sendChatMock).toHaveBeenCalledTimes(2)
    expect(sendChatMock).toHaveBeenNthCalledWith(1, -1)
    expect(sendChatMock).toHaveBeenNthCalledWith(2, -1)
    expect(setDatabaseSpy.count).toBe(0)
  })

  it('L32: forced message-command failure restores only the active chat', async () => {
    const calls: CapturedFetch[] = []
    let resolveMessageResponse: ((response: Response) => void) | undefined
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
        if (url === '/api/v1/commands/chats/chat-1/messages') {
          return new Promise<Response>((resolve) => {
            resolveMessageResponse = resolve
          })
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    seedDatabase([{ role: 'char', data: 'base', chatId: 'm-base' }], { includeSiblings: true })
    setServerProjectionWriteGuardEnabled(true)

    await expect(processMultiCommand('/send optimistic')).resolves.toBe('')
    await waitForCommand(
      calls,
      (call) => call.url === '/api/v1/commands/chats/chat-1/messages' && call.method === 'PUT',
    )
    expect(DBState.db.characters[0].chats[0].message.map((message: any) => message.data)).toEqual([
      'base',
      'optimistic',
    ])

    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[0].chats[1].name = 'active sibling edit'
      DBState.db.characters[1].name = 'sibling character edit'
      DBState.db.characters[1].chats[0].message.push({
        role: 'char',
        data: 'sibling message edit',
        chatId: 'm-sibling-edit',
      })
    })

    resolveMessageResponse?.(jsonResponse({ error: 'forced failure' }, 500))

    await vi.waitFor(() => {
      expect(DBState.db.characters[0].chats[0].message).toEqual([
        {
          role: 'char',
          data: 'base',
          chatId: 'm-base',
        },
      ])
    })
    expect(DBState.db.characters[0].chats[1].name).toBe('active sibling edit')
    expect(DBState.db.characters[1].name).toBe('sibling character edit')
    expect(DBState.db.characters[1].chats[0].message.map((message: any) => message.data)).toEqual([
      'sibling',
      'sibling message edit',
    ])
    expect(setDatabaseSpy.count).toBe(0)
  })

  it('/setvar updates chat scriptstate via the scriptstate command', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    await expect(processMultiCommand('/setvar key=hp 100')).resolves.not.toThrow()

    const cmd = await waitForCommand(
      calls,
      (call) => call.url === '/api/v1/commands/chats/chat-1/scriptstate' && call.method === 'PATCH',
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
      (call) => call.url === '/api/v1/commands/chats/chat-1/scriptstate' && call.method === 'PATCH',
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
      (call) => call.url === '/api/v1/commands/chats/chat-1/scriptstate' && call.method === 'PATCH',
    )
    expect(cmd.body.patch['$damage']).toBe('15')
    expect(setDatabaseSpy.count).toBe(0)
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
    expect(setDatabaseSpy.count).toBe(0)
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
        (call) => call.url === '/api/v1/commands/chats/chat-1/scriptstate' && call.method === 'PATCH',
      )
      expect(logSpy).not.toHaveBeenCalled()
    } finally {
      logSpy.mockRestore()
    }
  })
})
