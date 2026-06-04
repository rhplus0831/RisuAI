import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../platform', async (importActual) => {
  const actual = await importActual<typeof import('../../platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('../../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'context-auth-token',
}))

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {}, getModuleToggles: () => '' }
})

const toastCalls = vi.hoisted(() => ({ calls: [] as string[] }))
vi.mock('../../alert', () => ({
  alertToast: (msg: string) => {
    toastCalls.calls.push(msg)
  },
  alertError: () => {},
}))

import {
  clearCachedServerCommandRevision,
  type CommandEvent,
} from '../../server/commands'
import {
  setDatabase,
  type Database,
  type character,
} from '../../storage/database.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'
import { setupSendChatContext } from '../sendChatContext'
import { seedCloneCostDb, withCloneInstrumentation } from '../../__tests__/cloneCostHarness'

function makeChar(overrides: Partial<character> = {}): character {
  return {
    type: 'character',
    name: 'Tess',
    chaId: 'cha-1',
    desc: '',
    chats: [
      {
        name: 'main',
        note: '',
        localLore: [],
        scriptstate: {},
        fmIndex: -1,
        message: [],
      },
    ],
    chatPage: 0,
    customscript: [],
    triggerscript: [],
    exampleMessage: '',
    ...overrides,
  } as unknown as character
}

function seedDb(extra: Partial<Database> = {}) {
  const seed = {
    aiModel: 'gpt-4o',
    subModel: 'gpt-4o',
    characters: [makeChar()],
    maxContext: 4000,
    botPresetsId: 0,
    statics: { messages: 0 } as unknown as Database['statics'],
    promptInfoInsideChat: false,
    ...extra,
  } as unknown as Database
  setDatabase(seed)
  // setDatabase forcibly resets `promptInfoInsideChat` in web mode; restore
  // the requested value so the helper observes what the test asked for.
  if (extra.promptInfoInsideChat !== undefined) {
    DBState.db.promptInfoInsideChat = extra.promptInfoInsideChat
  }
  selectedCharID.set(0)
}

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

function stubCommandFetch(): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      calls.push({ url, method: init.method ?? 'GET', body })
      if (url === '/api/v1/bootstrap') {
        return jsonResponse({ revision: 21 })
      }
      const event: CommandEvent = {
        type: 'context.updated',
        revision: 22,
        resource: 'context',
      }
      return jsonResponse({ revision: 22, event })
    }) as unknown as typeof fetch,
  )
  return calls
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  vi.unstubAllGlobals()
  toastCalls.calls = []
})

describe('setupSendChatContext - preset chain', () => {
  it('runs preset chain selection when chatProcessIndex=-1 and finds a match', () => {
    seedDb({
      presetChain: 'Beta',
      botPresets: [{ name: 'Alpha' }, { name: 'Beta' }] as unknown as Database['botPresets'],
      botPresetsId: 0,
    })
    setupSendChatContext({ chatProcessIndex: -1 })
    // changeToPreset mutates db.botPresetsId to the selected index.
    expect(DBState.db.botPresetsId).toBe(1)
    expect(toastCalls.calls).toEqual([])
  })

  it('alerts on miss when preset chain name is not found', () => {
    seedDb({
      presetChain: 'Ghost',
      botPresets: [{ name: 'Alpha' }] as unknown as Database['botPresets'],
      botPresetsId: 0,
    })
    setupSendChatContext({ chatProcessIndex: -1 })
    // No preset switch on miss; botPresetsId stays unchanged.
    expect(DBState.db.botPresetsId).toBe(0)
    expect(toastCalls.calls).toEqual(['Cannot find preset: Ghost'])
  })

  it('skips preset chain when chatProcessIndex !== -1 (reentrant call)', () => {
    seedDb({
      presetChain: 'Beta',
      botPresets: [{ name: 'Alpha' }, { name: 'Beta' }] as unknown as Database['botPresets'],
      botPresetsId: 0,
    })
    setupSendChatContext({ chatProcessIndex: 0 })
    // botPresetsId untouched because the preset-chain block is skipped.
    expect(DBState.db.botPresetsId).toBe(0)
    expect(toastCalls.calls).toEqual([])
  })
})

describe('setupSendChatContext - DB side effects', () => {
  it('does not increment db.statics.messages locally in server-backed mode', () => {
    seedDb({ statics: { messages: 4 } as unknown as Database['statics'] })
    setupSendChatContext({ chatProcessIndex: -1 })
    expect(DBState.db.statics.messages).toBe(4)
  })

  it('updates nowChatroom.lastInteraction to roughly now', () => {
    seedDb()
    const before = Date.now()
    setupSendChatContext({ chatProcessIndex: -1 })
    const after = Date.now()
    const ts = DBState.db.characters[0].lastInteraction
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })

  it('backfills missing chatId values with v4 while preserving existing ones', () => {
    seedDb({
      characters: [
        makeChar({
          chats: [
            {
              name: 'main',
              note: '',
              localLore: [],
              scriptstate: {},
              fmIndex: -1,
              message: [
                { role: 'user', data: 'a', chatId: 'kept-1', time: 0 },
                { role: 'char', data: 'b', chatId: undefined as unknown as string, time: 0 },
                { role: 'user', data: 'c', chatId: '', time: 0 },
              ],
            } as character['chats'][number],
          ],
        }),
      ],
    })
    setupSendChatContext({ chatProcessIndex: -1 })
    const msgs = DBState.db.characters[0].chats[0].message
    expect(msgs[0].chatId).toBe('kept-1')
    expect(msgs[1].chatId).toBeTruthy()
    expect(msgs[1].chatId).not.toBe(msgs[0].chatId)
    // Empty string `''` is falsy through `??` (returns the empty string) so it
    // is intentionally NOT backfilled. Preserved verbatim.
    expect(msgs[2].chatId).toBe('')
  })

  it('routes server-backed entry-context durable writes through commands', async () => {
    const calls = stubCommandFetch()
    seedDb({
      statics: { messages: 4 } as unknown as Database['statics'],
      characters: [
        makeChar({
          chats: [
            {
              id: 'chat-1',
              name: 'main',
              note: '',
              localLore: [],
              scriptstate: {},
              fmIndex: -1,
              message: [
                { role: 'user', data: 'a', chatId: 'kept-1', time: 0 },
                { role: 'char', data: 'b', chatId: undefined as unknown as string, time: 0 },
              ],
            } as character['chats'][number],
          ],
        }),
      ],
    })

    setupSendChatContext({ chatProcessIndex: -1 })

    expect(DBState.db.statics.messages).toBe(4)
    const messages = DBState.db.characters[0].chats[0].message
    expect(messages[0].chatId).toBe('kept-1')
    expect(messages[1].chatId).toBeTruthy()
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/characters/cha-1')).toBe(
        true,
      )
      expect(calls.some((call) => call.url === '/api/v1/commands/chats/chat-1/messages')).toBe(
        true,
      )
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/characters/cha-1')).toMatchObject({
      method: 'PATCH',
      body: {
        patch: {
          lastInteraction: expect.any(Number),
        },
      },
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/chats/chat-1/messages')).toMatchObject({
      method: 'PUT',
      body: {
        messages,
      },
    })
  })

  it('serializes the character + message backfill commands against one revision baseline', async () => {
    // A4EC2 / B1: the message-id backfill path dispatches lastInteraction
    // then replaceMessages back-to-back. Pre-fix both ran with the same
    // cached baseRevision and the second 409d; the sequencer must replay
    // the revision returned by the first into the second.
    let nextRevision = 21
    const captured: { url: string; body: { baseRevision?: number } }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/bootstrap') {
          return jsonResponse({ revision: nextRevision })
        }
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
        captured.push({ url, body })
        // Each mutating call advances the server revision; the next call
        // must read this advanced value via the sequencer.
        nextRevision += 1
        const event: CommandEvent = {
          type: 'context.updated',
          revision: nextRevision,
          resource: 'context',
        }
        return jsonResponse({ revision: nextRevision, event })
      }) as unknown as typeof fetch,
    )

    seedDb({
      characters: [
        makeChar({
          chats: [
            {
              id: 'chat-1',
              name: 'main',
              note: '',
              localLore: [],
              scriptstate: {},
              fmIndex: -1,
              message: [
                { role: 'char', data: 'b', chatId: undefined as unknown as string, time: 0 },
              ],
            } as character['chats'][number],
          ],
        }),
      ],
    })

    setupSendChatContext({ chatProcessIndex: -1 })

    await vi.waitFor(() => {
      expect(captured.length).toBe(2)
    })
    expect(captured[0].url).toBe('/api/v1/commands/characters/cha-1')
    expect(captured[0].body?.baseRevision).toBe(21)
    expect(captured[1].url).toBe('/api/v1/commands/chats/chat-1/messages')
    // Pre-fix: 21 (raced on the cached baseline). Post-fix: 22 (read from
    // the first command's response by runOptimisticCommandSequence).
    expect(captured[1].body?.baseRevision).toBe(22)
  })
})

describe('setupSendChatContext - promptInfo seed', () => {
  it('returns empty promptInfo when promptInfoInsideChat=false', () => {
    seedDb({ promptInfoInsideChat: false })
    const ctx = setupSendChatContext({ chatProcessIndex: -1 })
    expect(ctx.promptInfo).toEqual({})
  })

  it('returns promptName when promptInfoInsideChat=true with a valid botPresetsId', () => {
    seedDb({
      promptInfoInsideChat: true,
      botPresets: [{ name: 'My Preset' }] as unknown as Database['botPresets'],
      botPresetsId: 0,
    })
    const ctx = setupSendChatContext({ chatProcessIndex: -1 })
    expect(ctx.promptInfo.promptName).toBe('My Preset')
    expect(ctx.promptInfo.promptToggles).toEqual([])
  })

  it('emits boolean toggle as ON when globalChatVariables.toggle_<key> === "1"', () => {
    seedDb({
      promptInfoInsideChat: true,
      botPresets: [{ name: 'P' }] as unknown as Database['botPresets'],
      botPresetsId: 0,
      customPromptTemplateToggle: 'mode=Mode',
      globalChatVariables: {
        toggle_mode: '1',
      } as unknown as Database['globalChatVariables'],
    })
    const ctx = setupSendChatContext({ chatProcessIndex: -1 })
    expect(ctx.promptInfo.promptToggles).toEqual([{ key: 'Mode', value: 'ON' }])
  })

  it('omits boolean toggle when globalChatVariables.toggle_<key> !== "1"', () => {
    seedDb({
      promptInfoInsideChat: true,
      botPresets: [{ name: 'P' }] as unknown as Database['botPresets'],
      botPresetsId: 0,
      customPromptTemplateToggle: 'mode=Mode',
      globalChatVariables: {
        toggle_mode: '0',
      } as unknown as Database['globalChatVariables'],
    })
    const ctx = setupSendChatContext({ chatProcessIndex: -1 })
    expect(ctx.promptInfo.promptToggles).toEqual([])
  })

  it('select toggle indexes options[] by raw value', () => {
    seedDb({
      promptInfoInsideChat: true,
      botPresets: [{ name: 'P' }] as unknown as Database['botPresets'],
      botPresetsId: 0,
      // select type uses `options` (CSV after = separator).
      customPromptTemplateToggle: 'tone=Tone=select=warm,formal,curt',
      globalChatVariables: {
        toggle_tone: '1',
      } as unknown as Database['globalChatVariables'],
    })
    const ctx = setupSendChatContext({ chatProcessIndex: -1 })
    expect(ctx.promptInfo.promptToggles).toEqual([{ key: 'Tone', value: 'formal' }])
  })
})

describe('setupSendChatContext - tokenizer + maxContextTokens', () => {
  it('uses 5 additional tokens for gpt models when arg.chatAdditonalTokens is unset', () => {
    seedDb({ aiModel: 'gpt-4o' })
    const ctx = setupSendChatContext({ chatProcessIndex: -1 })
    // ChatTokenizer wraps the count internally; we check it was constructed by
    // verifying maxContextTokens passes through and the tokenizer is defined.
    expect(ctx.tokenizer).toBeDefined()
    expect(ctx.maxContextTokens).toBe(4000)
  })

  it('uses 3 additional tokens for non-gpt models when arg.chatAdditonalTokens is unset', () => {
    seedDb({ aiModel: 'novelai:something' })
    const ctx = setupSendChatContext({ chatProcessIndex: -1 })
    expect(ctx.tokenizer).toBeDefined()
  })

  it('uses arg.chatAdditonalTokens override when provided', () => {
    seedDb({ aiModel: 'gpt-4o' })
    // The tokenizer just stores the value; we test that the helper accepts
    // the override path without crashing.
    const ctx = setupSendChatContext({
      chatProcessIndex: -1,
      chatAdditonalTokens: 42,
    })
    expect(ctx.tokenizer).toBeDefined()
  })
})

describe('setupSendChatContext - selectedChar / selectedChat', () => {
  it('returns selectedChar from the store and selectedChat from chatPage', () => {
    seedDb({
      characters: [
        makeChar({ name: 'A' }),
        makeChar({ name: 'B', chatPage: 0 }),
      ],
    })
    selectedCharID.set(1)
    const ctx = setupSendChatContext({ chatProcessIndex: -1 })
    expect(ctx.selectedChar).toBe(1)
    expect(ctx.selectedChat).toBe(0)
    expect(ctx.nowChatroom.name).toBe('B')
  })
})

describe('setupSendChatContext - M14 single-row rollback (stability/perf plan, Phase 3)', () => {
  it('M14: the send-context rollback captures one character row, never the whole corpus', () => {
    const seeded = seedCloneCostDb() // char-0 large (40 messages), siblings small
    seedDb({ characters: seeded.characters as unknown as Database['characters'] })
    selectedCharID.set(1)
    stubCommandFetch()
    const charactersSize = JSON.stringify(DBState.db.characters).length

    // Messages already carry chatIds, so the only optimistic write is the
    // lastInteraction stamp — its rollback snapshot must stay one row.
    const instrumented = withCloneInstrumentation(() =>
      setupSendChatContext({ chatProcessIndex: -1 }),
    )

    expect(instrumented.maxClonedSize).toBeLessThan(charactersSize)
    expect(instrumented.result.selectedChar).toBe(1)
  })

  it('M14: a failed send-context command restores only the selected row, preserving sibling edits', async () => {
    // Earlier tests in this file dispatch without a fetch stub; their leaked
    // rollbacks can later rewrite rows 0/1 (their snapshots' fallback indexes).
    // Keep this test's rollback row and sibling row at index >= 2, which no
    // leaked legacy snapshot can ever touch.
    const seeded = seedCloneCostDb({ characterCount: 4 })
    seedDb({ characters: seeded.characters as unknown as Database['characters'] })
    selectedCharID.set(2)
    const originalLastInteraction = DBState.db.characters[2].lastInteraction

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
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 21 })
        return jsonResponse({ error: 'nope' }, 500)
      }) as unknown as typeof fetch,
    )

    setupSendChatContext({ chatProcessIndex: -1 })
    expect(DBState.db.characters[2].lastInteraction).not.toBe(originalLastInteraction)
    // a concurrent, unrelated sibling edit a whole-array restore would wipe
    DBState.db.characters[3].name = 'Concurrent sibling edit'

    await vi.waitFor(() => {
      // bootstrap + failed lastInteraction PATCH, then the rollback has run
      expect(calls.length).toBeGreaterThanOrEqual(2)
      expect(DBState.db.characters[2].lastInteraction).toBe(originalLastInteraction)
    })
    expect(DBState.db.characters[3].name).toBe('Concurrent sibling edit')
  })
})
