import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../platform', async (importActual) => {
  const actual = await importActual<typeof import('../../platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {}, getModuleAssets: () => [] }
})

vi.mock('../../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'build-memory-window-token',
}))

// hypaMemoryV3 is invoked only on the (supaMemory && hypaV3) branch. The
// hoisted holder lets each test stage a return value (or fallthrough error).
const hypaState = vi.hoisted(() => ({
  next: null as unknown,
  throws: null as unknown,
  calls: 0,
}))
vi.mock('../memory/hypav3', async (importActual) => {
  const actual = await importActual<typeof import('../memory/hypav3')>()
  return {
    ...actual,
    hypaMemoryV3: async (..._args: unknown[]) => {
      hypaState.calls++
      if (hypaState.throws) throw hypaState.throws
      return hypaState.next
    },
  }
})

import { setDatabase, type Chat, type Database, type character } from '../../storage/database.svelte'
import { clearCachedServerCommandRevision } from '../../server/commands'
import { DBState } from '../../stores.svelte'
import type { ChatTokenizer } from '../../tokenizer'
import type { OpenAIChat } from '../index.svelte'
import { buildMemoryWindow, type BuildMemoryWindowResult } from '../promptAssembly/buildMemoryWindow'
import type { PromptItem } from '../prompt'

type NonStop = Exclude<BuildMemoryWindowResult, { stopSending: true }>
interface CapturedFetch {
  url: string
  method: string
  body: unknown
}

function assertNotStopped(result: BuildMemoryWindowResult): asserts result is NonStop {
  if (result.stopSending) throw new Error('expected non-stop result')
}

class FakeTokenizer {
  async tokenizeChat(chat: { content?: string }): Promise<number> {
    return (chat.content ?? '').length
  }
}

function makeChar(overrides: Partial<character> = {}): character {
  return {
    type: 'character',
    name: 'Tess',
    chaId: 'cha-1',
    supaMemory: false,
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
    ...overrides,
  } as unknown as character
}

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    name: 'main',
    note: '',
    localLore: [],
    scriptstate: {},
    fmIndex: -1,
    message: [],
    ...overrides,
  } as unknown as Chat
}

function seedDb(extra: Partial<Database> = {}) {
  setDatabase({
    aiModel: 'gpt-4o',
    subModel: 'gpt-4o',
    characters: [makeChar()],
    hypaV3: false,
    ...extra,
  } as unknown as Database)
}

function makeStageTimings(stage1Start = 100) {
  return {
    stage1Start,
    stage1Duration: 0,
    stage2Start: 0,
    stage2Duration: 0,
  }
}

function makeUnformated() {
  return {
    lastChat: [] as OpenAIChat[],
    chats: [] as OpenAIChat[],
  }
}

function makeRecorder() {
  const stages: number[] = []
  const errors: string[] = []
  return {
    stages,
    errors,
    setProcessStage: (s: number) => stages.push(s),
    throwError: (m: string) => errors.push(m),
  }
}

function fakeTokenizer(): ChatTokenizer {
  return new FakeTokenizer() as unknown as ChatTokenizer
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

beforeEach(() => {
  clearCachedServerCommandRevision()
  hypaState.next = null
  hypaState.throws = null
  hypaState.calls = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildMemoryWindow - HypaV3 branch', () => {
  it('replaces chats/tokens, writes memory back to DB, and transitions stage 2 → 1', async () => {
    seedDb({ hypaV3: true })
    const rec = makeRecorder()
    const stageTimings = makeStageTimings()
    const original: OpenAIChat[] = [{ role: 'user', content: 'old' }]
    const newChats: OpenAIChat[] = [{ role: 'user', content: 'replaced' }]
    const memory = { summaries: ['s'] } as unknown
    hypaState.next = { chats: newChats, currentTokens: 11, memory }

    const currentChat = makeChat()
    DBState.db.characters[0].chats[0] = currentChat

    const result = await buildMemoryWindow({
      chats: original,
      currentTokens: 200,
      maxContextTokens: 100,
      currentChat,
      nowChatroom: makeChar({ supaMemory: true }),
      tokenizer: fakeTokenizer(),
      selectedChar: 0,
      selectedChat: 0,
      memoryCardUsed: false,
      promptTemplate: null,
      unformated: makeUnformated(),
      stageTimings,
      throwError: rec.throwError,
      setProcessStage: rec.setProcessStage,
    })

    assertNotStopped(result)
    expect(hypaState.calls).toBe(1)
    expect(result.currentTokens).toBe(11)
    expect(rec.stages).toEqual([2, 1])
    expect(currentChat.hypaV3Data).toBeUndefined()
    expect(DBState.db.characters[0].chats[0].hypaV3Data).toBeUndefined()
    expect(stageTimings.stage1Duration).toBeGreaterThanOrEqual(0)
    expect(stageTimings.stage2Start).toBeGreaterThan(0)
    expect(stageTimings.stage2Duration).toBeGreaterThanOrEqual(0)
  })

  it('on hypa error with memory: writes back, calls throwError, and returns stopSending', async () => {
    seedDb({ hypaV3: true })
    const rec = makeRecorder()
    const memory = { summaries: ['partial'] } as unknown
    hypaState.next = {
      chats: [{ role: 'user', content: 'x' }],
      currentTokens: 5,
      memory,
      error: 'hypa boom',
    }

    const currentChat = makeChat()
    DBState.db.characters[0].chats[0] = currentChat

    const result = await buildMemoryWindow({
      chats: [{ role: 'user', content: 'hi' }],
      currentTokens: 50,
      maxContextTokens: 1000,
      currentChat,
      nowChatroom: makeChar({ supaMemory: true }),
      tokenizer: fakeTokenizer(),
      selectedChar: 0,
      selectedChat: 0,
      memoryCardUsed: false,
      promptTemplate: null,
      unformated: makeUnformated(),
      stageTimings: makeStageTimings(),
      throwError: rec.throwError,
      setProcessStage: rec.setProcessStage,
    })

    expect(result.stopSending).toBe(true)
    expect(rec.errors).toEqual(['hypa boom'])
    expect(currentChat.hypaV3Data).toBeUndefined()
    expect(DBState.db.characters[0].chats[0].hypaV3Data).toBeUndefined()
    // We stopped before the stage-1 set on the happy path.
    expect(rec.stages).toEqual([2])
  })

  it('on hypa error without memory: leaves currentChat.hypaV3Data alone and stops', async () => {
    seedDb({ hypaV3: true })
    const rec = makeRecorder()
    hypaState.next = {
      chats: [{ role: 'user', content: 'x' }],
      currentTokens: 5,
      error: 'cold start failure',
    }

    const currentChat = makeChat({ hypaV3Data: undefined })
    DBState.db.characters[0].chats[0] = currentChat

    const result = await buildMemoryWindow({
      chats: [{ role: 'user', content: 'hi' }],
      currentTokens: 50,
      maxContextTokens: 1000,
      currentChat,
      nowChatroom: makeChar({ supaMemory: true }),
      tokenizer: fakeTokenizer(),
      selectedChar: 0,
      selectedChat: 0,
      memoryCardUsed: false,
      promptTemplate: null,
      unformated: makeUnformated(),
      stageTimings: makeStageTimings(),
      throwError: rec.throwError,
      setProcessStage: rec.setProcessStage,
    })

    expect(result.stopSending).toBe(true)
    expect(rec.errors).toEqual(['cold start failure'])
    expect(currentChat.hypaV3Data).toBeUndefined()
  })

  it('does not write legacy hypaV3Data into DBState in server-backed web mode', async () => {
    seedDb({ hypaV3: true })
    const rec = makeRecorder()
    const memory = { summaries: ['server-owned'] } as unknown
    hypaState.next = {
      chats: [{ role: 'user', content: 'server memory rows' }],
      currentTokens: 9,
      memory,
    }

    const currentChat = makeChat()
    DBState.db.characters[0].chats[0] = currentChat

    const result = await buildMemoryWindow({
      chats: [{ role: 'user', content: 'hi' }],
      currentTokens: 50,
      maxContextTokens: 1000,
      currentChat,
      nowChatroom: makeChar({ supaMemory: true }),
      tokenizer: fakeTokenizer(),
      selectedChar: 0,
      selectedChat: 0,
      memoryCardUsed: false,
      promptTemplate: [{ type: 'description' }] as PromptItem[],
      unformated: makeUnformated(),
      stageTimings: makeStageTimings(),
      throwError: rec.throwError,
      setProcessStage: rec.setProcessStage,
    })

    assertNotStopped(result)
    expect(result.currentTokens).toBe(9)
    expect(currentChat.hypaV3Data).toBeUndefined()
    expect(DBState.db.characters[0].chats[0].hypaV3Data).toBeUndefined()
    expect(rec.stages).toEqual([2, 1])
  })

  it('skips hypa branch when chatroom.supaMemory is false', async () => {
    seedDb({ hypaV3: true })
    const rec = makeRecorder()
    const currentChat = makeChat()

    const result = await buildMemoryWindow({
      chats: [{ role: 'user', content: 'hi', memo: 'NewChat' }],
      currentTokens: 2,
      maxContextTokens: 1000,
      currentChat,
      nowChatroom: makeChar({ supaMemory: false }),
      tokenizer: fakeTokenizer(),
      selectedChar: 0,
      selectedChat: 0,
      memoryCardUsed: false,
      promptTemplate: [{ type: 'description' }] as PromptItem[],
      unformated: makeUnformated(),
      stageTimings: makeStageTimings(),
      throwError: rec.throwError,
      setProcessStage: rec.setProcessStage,
    })

    assertNotStopped(result)
    expect(hypaState.calls).toBe(0)
    expect(rec.stages).toEqual([])
  })
})

describe('buildMemoryWindow - fallback budget trim', () => {
  it('writes lastMemory through DBState and dispatches a chat patch when server command mode has a chat id', async () => {
    seedDb()
    const calls = stubCommandFetch()
    const rec = makeRecorder()
    const currentChat = makeChat({ id: 'chat-1' })
    DBState.db.characters[0].chats[0] = currentChat
    const chats: OpenAIChat[] = [
      { role: 'user', content: 'keep', memo: 'leadingMemo' },
      { role: 'assistant', content: 'reply' },
    ]

    const result = await buildMemoryWindow({
      chats,
      currentTokens: 50,
      maxContextTokens: 1000,
      currentChat,
      nowChatroom: makeChar({ supaMemory: false }),
      tokenizer: fakeTokenizer(),
      selectedChar: 0,
      selectedChat: 0,
      memoryCardUsed: false,
      promptTemplate: [{ type: 'description' }] as PromptItem[],
      unformated: makeUnformated(),
      stageTimings: makeStageTimings(),
      throwError: rec.throwError,
      setProcessStage: rec.setProcessStage,
    })

    assertNotStopped(result)
    expect(DBState.db.characters[0].chats[0].lastMemory).toBe('leadingMemo')
    expect(result.currentChat).toBe(DBState.db.characters[0].chats[0])
    expect(result.currentChat.lastMemory).toBe('leadingMemo')

    const command = await waitForCommand(
      calls,
      (call) => call.url === '/api/v1/commands/chats/chat-1' && call.method === 'PATCH',
    )
    expect(command.body).toMatchObject({
      baseRevision: 10,
      patch: { lastMemory: 'leadingMemo' },
    })
  })

  it('keeps lastMemory request-local when server command mode has no chat id', async () => {
    seedDb()
    const calls = stubCommandFetch()
    const rec = makeRecorder()
    const currentChat = makeChat({ lastMemory: 'request-original' })
    DBState.db.characters[0].chats[0] = makeChat({ lastMemory: 'server-original' })
    const chats: OpenAIChat[] = [
      { role: 'user', content: 'keep', memo: 'requestMemo' },
      { role: 'assistant', content: 'reply' },
    ]

    const result = await buildMemoryWindow({
      chats,
      currentTokens: 50,
      maxContextTokens: 1000,
      currentChat,
      nowChatroom: makeChar({ supaMemory: false }),
      tokenizer: fakeTokenizer(),
      selectedChar: 0,
      selectedChat: 0,
      memoryCardUsed: false,
      promptTemplate: [{ type: 'description' }] as PromptItem[],
      unformated: makeUnformated(),
      stageTimings: makeStageTimings(),
      throwError: rec.throwError,
      setProcessStage: rec.setProcessStage,
    })

    assertNotStopped(result)
    expect(DBState.db.characters[0].chats[0].lastMemory).toBe('server-original')
    expect(result.currentChat).not.toBe(DBState.db.characters[0].chats[0])
    expect(result.currentChat.lastMemory).toBe('requestMemo')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls.filter((call) => call.url.startsWith('/api/v1/commands/chats/'))).toEqual([])
  })

  it('is a no-op when already within budget and captures lastMemory', async () => {
    seedDb()
    const rec = makeRecorder()
    const currentChat = makeChat()
    const chats: OpenAIChat[] = [
      { role: 'user', content: 'keep', memo: 'leadingMemo' },
      { role: 'assistant', content: 'reply' },
    ]

    const result = await buildMemoryWindow({
      chats,
      currentTokens: 50,
      maxContextTokens: 1000,
      currentChat,
      nowChatroom: makeChar({ supaMemory: false }),
      tokenizer: fakeTokenizer(),
      selectedChar: 0,
      selectedChat: 0,
      memoryCardUsed: false,
      promptTemplate: [{ type: 'description' }] as PromptItem[],
      unformated: makeUnformated(),
      stageTimings: makeStageTimings(),
      throwError: rec.throwError,
      setProcessStage: rec.setProcessStage,
    })

    assertNotStopped(result)
    expect(result.chats.length).toBe(2)
    expect(result.currentChat.lastMemory).toBe('leadingMemo')
    expect(DBState.db.characters[0].chats[0].lastMemory).toBeUndefined()
    expect(result.currentTokens).toBe(50)
  })

  it('drops the oldest chat until under budget and captures the new leading memo', async () => {
    seedDb()
    const rec = makeRecorder()
    const currentChat = makeChat()
    const chats: OpenAIChat[] = [
      // 'a'.repeat(40) tokens with FakeTokenizer = 40
      { role: 'user', content: 'a'.repeat(40), memo: 'oldest' },
      { role: 'user', content: 'b'.repeat(10), memo: 'middle' },
      { role: 'user', content: 'c'.repeat(5) },
    ]

    const result = await buildMemoryWindow({
      chats,
      currentTokens: 55, // exceeds budget by 5
      maxContextTokens: 30,
      currentChat,
      nowChatroom: makeChar({ supaMemory: false }),
      tokenizer: fakeTokenizer(),
      selectedChar: 0,
      selectedChat: 0,
      memoryCardUsed: false,
      promptTemplate: [{ type: 'description' }] as PromptItem[],
      unformated: makeUnformated(),
      stageTimings: makeStageTimings(),
      throwError: rec.throwError,
      setProcessStage: rec.setProcessStage,
    })

    assertNotStopped(result)
    // First-shift trims 40 tokens, leaving 15 (under 30).
    expect(result.currentTokens).toBe(15)
    expect(result.chats.length).toBe(2)
    expect(result.currentChat.lastMemory).toBe('middle')
    expect(DBState.db.characters[0].chats[0].lastMemory).toBeUndefined()
  })

  it('returns stopSending and throws toomuchtoken when chats cannot shrink to fit', async () => {
    seedDb()
    const rec = makeRecorder()
    const currentChat = makeChat()
    const chats: OpenAIChat[] = [{ role: 'user', content: 'huge'.repeat(50) }]

    const result = await buildMemoryWindow({
      chats,
      currentTokens: 9999,
      maxContextTokens: 10,
      currentChat,
      nowChatroom: makeChar({ supaMemory: false }),
      tokenizer: fakeTokenizer(),
      selectedChar: 0,
      selectedChat: 0,
      memoryCardUsed: false,
      promptTemplate: [{ type: 'description' }] as PromptItem[],
      unformated: makeUnformated(),
      stageTimings: makeStageTimings(),
      throwError: rec.throwError,
      setProcessStage: rec.setProcessStage,
    })

    expect(result.stopSending).toBe(true)
    expect(rec.errors).toHaveLength(1)
    expect(rec.errors[0]).toContain('Required Tokens: 9999')
  })
})

describe('buildMemoryWindow - memory-card split', () => {
  it('extracts supaMemory/hypaMemory rows into memories[] when memoryCardUsed=true and zeroes them in unformated.chats', async () => {
    seedDb()
    const rec = makeRecorder()
    const currentChat = makeChat()
    const unformated = makeUnformated()
    const chats: OpenAIChat[] = [
      { role: 'system', content: 'past-summary', memo: 'hypaMemory' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]

    const result = await buildMemoryWindow({
      chats,
      currentTokens: 10,
      maxContextTokens: 1000,
      currentChat,
      nowChatroom: makeChar({ supaMemory: false }),
      tokenizer: fakeTokenizer(),
      selectedChar: 0,
      selectedChat: 0,
      memoryCardUsed: true,
      promptTemplate: [{ type: 'description' }] as PromptItem[],
      unformated,
      stageTimings: makeStageTimings(),
      throwError: rec.throwError,
      setProcessStage: rec.setProcessStage,
    })

    assertNotStopped(result)
    expect(result.memories).toEqual([{ role: 'system', content: 'past-summary', memo: 'hypaMemory' }])
    // Memory placeholder filtered out (empty content), real chats kept.
    expect(unformated.chats.map((c) => c.content)).toEqual(['hi', 'hello'])
    // Non-memory rows are marked removable.
    expect(unformated.chats.every((c) => c.removable === true)).toBe(true)
  })

  it('wraps supaMemory/hypaMemory content with <Previous Conversation> when memoryCardUsed=false', async () => {
    seedDb()
    const rec = makeRecorder()
    const currentChat = makeChat()
    const unformated = makeUnformated()
    const chats: OpenAIChat[] = [
      { role: 'system', content: 'past-summary', memo: 'supaMemory' },
      { role: 'user', content: 'hi' },
    ]

    const result = await buildMemoryWindow({
      chats,
      currentTokens: 10,
      maxContextTokens: 1000,
      currentChat,
      nowChatroom: makeChar({ supaMemory: false }),
      tokenizer: fakeTokenizer(),
      selectedChar: 0,
      selectedChat: 0,
      memoryCardUsed: false,
      promptTemplate: [{ type: 'description' }] as PromptItem[],
      unformated,
      stageTimings: makeStageTimings(),
      throwError: rec.throwError,
      setProcessStage: rec.setProcessStage,
    })

    assertNotStopped(result)
    expect(result.memories).toEqual([])
    expect(unformated.chats[0].content).toBe('<Previous Conversation>past-summary</Previous Conversation>')
    // The supa/hypa row does not get removable=true (only non-memory rows do).
    expect(unformated.chats[0].removable).toBeUndefined()
    expect(unformated.chats[1].removable).toBe(true)
  })

  it('promotes the trailing chat into unformated.lastChat when promptTemplate is null', async () => {
    seedDb()
    const rec = makeRecorder()
    const currentChat = makeChat()
    const unformated = makeUnformated()
    const chats: OpenAIChat[] = [
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
      { role: 'user', content: 'three' },
    ]

    const result = await buildMemoryWindow({
      chats,
      currentTokens: 10,
      maxContextTokens: 1000,
      currentChat,
      nowChatroom: makeChar({ supaMemory: false }),
      tokenizer: fakeTokenizer(),
      selectedChar: 0,
      selectedChat: 0,
      memoryCardUsed: false,
      promptTemplate: null,
      unformated,
      stageTimings: makeStageTimings(),
      throwError: rec.throwError,
      setProcessStage: rec.setProcessStage,
    })

    assertNotStopped(result)
    expect(unformated.lastChat.map((c) => c.content)).toEqual(['three'])
    expect(unformated.chats.map((c) => c.content)).toEqual(['one', 'two'])
  })

  it('filters out empty-content rows with no multimodals', async () => {
    seedDb()
    const rec = makeRecorder()
    const currentChat = makeChat()
    const unformated = makeUnformated()
    const chats: OpenAIChat[] = [
      { role: 'system', content: '   ' },
      { role: 'user', content: '' },
      { role: 'user', content: 'kept' },
      {
        role: 'user',
        content: '',
        multimodals: [{ type: 'image', base64: 'x' }],
      },
    ]

    const result = await buildMemoryWindow({
      chats,
      currentTokens: 10,
      maxContextTokens: 1000,
      currentChat,
      nowChatroom: makeChar({ supaMemory: false }),
      tokenizer: fakeTokenizer(),
      selectedChar: 0,
      selectedChat: 0,
      memoryCardUsed: false,
      promptTemplate: [{ type: 'description' }] as PromptItem[],
      unformated,
      stageTimings: makeStageTimings(),
      throwError: rec.throwError,
      setProcessStage: rec.setProcessStage,
    })

    assertNotStopped(result)
    // Empty-string and whitespace-only rows filtered; multimodal row kept.
    expect(unformated.chats.map((c) => c.content)).toEqual(['kept', ''])
    expect(unformated.chats[1].multimodals?.length).toBe(1)
  })
})
