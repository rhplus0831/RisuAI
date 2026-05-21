import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {}, getModuleAssets: () => [] }
})

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

import {
  setDatabase,
  type Chat,
  type Database,
  type character,
} from '../../storage/database.svelte'
import { DBState } from '../../stores.svelte'
import type { ChatTokenizer } from '../../tokenizer'
import type { OpenAIChat } from '../index.svelte'
import {
  buildMemoryWindow,
  type BuildMemoryWindowResult,
} from '../promptAssembly/buildMemoryWindow'
import type { PromptItem } from '../prompt'

type NonStop = Exclude<BuildMemoryWindowResult, { stopSending: true }>

function assertNotStopped(
  result: BuildMemoryWindowResult,
): asserts result is NonStop {
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

beforeEach(() => {
  hypaState.next = null
  hypaState.throws = null
  hypaState.calls = 0
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
    expect(currentChat.hypaV3Data).toEqual(memory)
    expect(DBState.db.characters[0].chats[0].hypaV3Data).toEqual(memory)
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
    expect(currentChat.hypaV3Data).toEqual(memory)
    expect(DBState.db.characters[0].chats[0].hypaV3Data).toEqual(memory)
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
    expect(currentChat.lastMemory).toBe('leadingMemo')
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
    expect(currentChat.lastMemory).toBe('middle')
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
    expect(result.memories).toEqual([
      { role: 'system', content: 'past-summary', memo: 'hypaMemory' },
    ])
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
    expect(unformated.chats[0].content).toBe(
      '<Previous Conversation>past-summary</Previous Conversation>',
    )
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
