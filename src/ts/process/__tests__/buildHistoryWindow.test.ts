import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {}, getModuleAssets: () => [] }
})

vi.mock('../files/inlays', () => ({
  getInlayAsset: async () => null,
  getInlayAssetBlob: async () => null,
  supportsInlayImage: () => true,
}))

// runTrigger gets called inside buildHistoryWindow; we control its return
// value via a hoisted holder so the value can be mutated from beforeEach.
const triggerState = vi.hoisted(() => ({ next: null as unknown }))
vi.mock('../triggers', () => ({
  runTrigger: async () => triggerState.next,
}))

import { setDatabase, type Chat, type Database, type Message, type character } from '../../storage/database.svelte'
import { selectedCharID } from '../../stores.svelte'
import { ChatTokenizer } from '../../tokenizer'
import {
  buildHistoryWindow as buildHistoryWindowWithModel,
  type BuildHistoryWindowArgs,
  type BuildHistoryWindowResult,
} from '../promptAssembly/buildHistoryWindow'

type NonStop = Exclude<BuildHistoryWindowResult, { stopSending: true }>

function assertNotStopped(result: BuildHistoryWindowResult): asserts result is NonStop {
  if (result.stopSending) throw new Error('expected non-stop result')
}

class FakeTokenizer {
  /** Returns content-length so token math is predictable. */
  async tokenizeChat(chat: { content?: string }): Promise<number> {
    return (chat.content ?? '').length
  }
}

function makeChar(overrides: Partial<character> = {}): character {
  return {
    type: 'character',
    name: 'Tess',
    chaId: 'cha-1',
    desc: '',
    personality: '',
    scenario: '',
    additionalText: '',
    systemPrompt: '',
    replaceGlobalNote: '',
    chatPage: 0,
    image: '',
    emotionImages: [],
    bias: [],
    viewScreen: 'none',
    globalLore: [],
    firstMessage: 'first message body',
    alternateGreetings: [],
    notes: '',
    utilityBot: false,
    customscript: [],
    triggerscript: [],
    additionalAssets: [],
    chats: [],
    exampleMessage: '',
    ...overrides,
  } as unknown as character
}

function makeChat(messages: Message[], fmIndex: number = -1): Chat {
  return {
    name: 'main',
    note: '',
    localLore: [],
    scriptstate: {},
    fmIndex,
    message: messages,
  } as unknown as Chat
}

let seededDatabase: Database

function seedDb(extra: Partial<Database> = {}) {
  seededDatabase = {
    aiModel: 'gpt-4o',
    subModel: 'gpt-4o',
    characters: [makeChar()],
    ...extra,
  } as unknown as Database
  setDatabase(seededDatabase)
  selectedCharID.set(0)
}

const noCache = () => makeChar({ name: 'Cached' })

function buildHistoryWindow(
  args: Omit<BuildHistoryWindowArgs, 'modelId' | 'database'>,
): Promise<BuildHistoryWindowResult> {
  return buildHistoryWindowWithModel({
    ...args,
    database: seededDatabase,
    modelId: seededDatabase.aiModel,
  })
}

describe('buildHistoryWindow - happy path', () => {
  beforeEach(() => {
    seedDb()
    triggerState.next = null
  })

  it('emits examples + start-new-chat marker + first message + history when no trigger fires', async () => {
    const chat = makeChat([{ role: 'user', data: 'hi', chatId: 'm-1', time: 0 } as Message])
    const result = await buildHistoryWindow({
      currentChar: makeChar(),
      currentChat: chat,
      usingPromptTemplate: false,
      tokenizer: new FakeTokenizer() as unknown as ChatTokenizer,
      findCharacterbyIdwithCache: noCache,
      depthPrompts: [],
      resolvePosition: (text) => text,
    })
    assertNotStopped(result)
    // examples=0 (default empty), 1 start marker (content="[Start a new chat]"),
    // 1 first message ("first message body"), 1 user message ("hi")
    expect(result.chats.length).toBeGreaterThanOrEqual(3)
    expect(result.chats.some((c) => c.content === '[Start a new chat]')).toBe(true)
    expect(result.chats.some((c) => c.content === 'first message body')).toBe(true)
    expect(result.chats.some((c) => c.content === 'hi')).toBe(true)
    expect(result.triggerResult).toBeNull()
    expect(result.currentChat).toBe(chat)
  })
})

describe('buildHistoryWindow - start-new-chat marker gating', () => {
  beforeEach(() => {
    triggerState.next = null
  })

  it('omits the marker when aiModel starts with "novelai"', async () => {
    seedDb({ aiModel: 'novelai:something' })
    const chat = makeChat([])
    const result = await buildHistoryWindow({
      currentChar: makeChar(),
      currentChat: chat,
      usingPromptTemplate: false,
      tokenizer: new FakeTokenizer() as unknown as ChatTokenizer,
      findCharacterbyIdwithCache: noCache,
      depthPrompts: [],
      resolvePosition: (text) => text,
    })
    assertNotStopped(result)
    expect(result.chats.some((c) => c.content === '[Start a new chat]')).toBe(false)
  })

  it('uses the request-scoped resolved model instead of the flat database model', async () => {
    seedDb({ aiModel: 'gpt-4o' })
    const result = await buildHistoryWindowWithModel({
      database: seededDatabase,
      currentChar: makeChar(),
      currentChat: makeChat([]),
      modelId: 'novelai:something',
      usingPromptTemplate: false,
      tokenizer: new FakeTokenizer() as unknown as ChatTokenizer,
      findCharacterbyIdwithCache: noCache,
      depthPrompts: [],
      resolvePosition: (text) => text,
    })
    assertNotStopped(result)
    expect(result.chats.some((chat) => chat.content === '[Start a new chat]')).toBe(false)
  })

  it('omits the marker when promptSettings.trimStartNewChat is true', async () => {
    seedDb({
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: '',
        sendChatAsSystem: false,
        sendName: false,
        utilOverride: false,
        customChainOfThought: false,
        maxThoughtTagDepth: -1,
        trimStartNewChat: true,
      },
    })
    const chat = makeChat([])
    const result = await buildHistoryWindow({
      currentChar: makeChar(),
      currentChat: chat,
      usingPromptTemplate: false,
      tokenizer: new FakeTokenizer() as unknown as ChatTokenizer,
      findCharacterbyIdwithCache: noCache,
      depthPrompts: [],
      resolvePosition: (text) => text,
    })
    assertNotStopped(result)
    expect(result.chats.some((c) => c.content === '[Start a new chat]')).toBe(false)
  })
})

describe('buildHistoryWindow - makeMs filtering', () => {
  beforeEach(() => {
    seedDb()
    triggerState.next = null
  })

  it('skips messages flagged disabled: true', async () => {
    const chat = makeChat([
      { role: 'user', data: 'one', chatId: 'm1', time: 0 } as Message,
      { role: 'user', data: 'dropped', chatId: 'm2', time: 0, disabled: true } as Message,
      { role: 'user', data: 'two', chatId: 'm3', time: 0 } as Message,
    ])
    const result = await buildHistoryWindow({
      currentChar: makeChar(),
      currentChat: chat,
      usingPromptTemplate: false,
      tokenizer: new FakeTokenizer() as unknown as ChatTokenizer,
      findCharacterbyIdwithCache: noCache,
      depthPrompts: [],
      resolvePosition: (text) => text,
    })
    assertNotStopped(result)
    expect(result.chats.some((c) => c.content === 'dropped')).toBe(false)
    expect(result.chats.some((c) => c.content === 'one')).toBe(true)
    expect(result.chats.some((c) => c.content === 'two')).toBe(true)
  })

  it('treats disabled: "allBefore" as a reset and suppresses the first message', async () => {
    const chat = makeChat([
      { role: 'user', data: 'before', chatId: 'm1', time: 0 } as Message,
      {
        role: 'user',
        data: 'cutoff',
        chatId: 'm2',
        time: 0,
        disabled: 'allBefore',
      } as Message,
      { role: 'user', data: 'after', chatId: 'm3', time: 0 } as Message,
    ])
    const result = await buildHistoryWindow({
      currentChar: makeChar(),
      currentChat: chat,
      usingPromptTemplate: false,
      tokenizer: new FakeTokenizer() as unknown as ChatTokenizer,
      findCharacterbyIdwithCache: noCache,
      depthPrompts: [],
      resolvePosition: (text) => text,
    })
    assertNotStopped(result)
    // first message suppressed under msReseted
    expect(result.chats.some((c) => c.content === 'first message body')).toBe(false)
    // only messages strictly after the allBefore marker land in chats
    expect(result.chats.some((c) => c.content === 'before')).toBe(false)
    expect(result.chats.some((c) => c.content === 'cutoff')).toBe(false)
    expect(result.chats.some((c) => c.content === 'after')).toBe(true)
  })
})

describe('buildHistoryWindow - first message selection', () => {
  beforeEach(() => {
    seedDb()
    triggerState.next = null
  })

  it('uses alternateGreetings[fmIndex] when fmIndex !== -1', async () => {
    const char = makeChar({
      firstMessage: 'default greeting',
      alternateGreetings: ['alt-0', 'alt-1', 'alt-2'],
    })
    const chat = makeChat([], 1)
    const result = await buildHistoryWindow({
      currentChar: char,
      currentChat: chat,
      usingPromptTemplate: false,
      tokenizer: new FakeTokenizer() as unknown as ChatTokenizer,
      findCharacterbyIdwithCache: noCache,
      depthPrompts: [],
      resolvePosition: (text) => text,
    })
    assertNotStopped(result)
    expect(result.chats.some((c) => c.content === 'alt-1')).toBe(true)
    expect(result.chats.some((c) => c.content === 'default greeting')).toBe(false)
  })

  it('prefixes the first message with "${charName}: " under usingPromptTemplate + sendName', async () => {
    seedDb({
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: '',
        sendChatAsSystem: false,
        sendName: true,
        utilOverride: false,
        customChainOfThought: false,
        maxThoughtTagDepth: -1,
      },
    })
    const char = makeChar({ firstMessage: 'greeting', name: 'Lyra' })
    const chat = makeChat([])
    const result = await buildHistoryWindow({
      currentChar: char,
      currentChat: chat,
      usingPromptTemplate: true,
      tokenizer: new FakeTokenizer() as unknown as ChatTokenizer,
      findCharacterbyIdwithCache: noCache,
      depthPrompts: [],
      resolvePosition: (text) => text,
    })
    assertNotStopped(result)
    const first = result.chats.find((c) => c.content?.startsWith('Lyra: '))
    expect(first).toBeDefined()
    expect(first?.attr).toEqual(['nameAdded'])
  })
})

describe('buildHistoryWindow - start trigger', () => {
  beforeEach(() => {
    seedDb()
  })

  it('returns { stopSending: true } when the trigger asks to stop', async () => {
    triggerState.next = {
      additonalSysPrompt: { start: '', historyend: '', promptend: '' },
      chat: makeChat([]),
      tokens: 0,
      stopSending: true,
      sendAIprompt: false,
    }
    const result = await buildHistoryWindow({
      currentChar: makeChar(),
      currentChat: makeChat([]),
      usingPromptTemplate: false,
      tokenizer: new FakeTokenizer() as unknown as ChatTokenizer,
      findCharacterbyIdwithCache: noCache,
      depthPrompts: [],
      resolvePosition: (text) => text,
    })
    expect(result).toEqual({ stopSending: true })
  })

  it('forwards a non-stop trigger result and adds its tokens to addedTokens', async () => {
    const triggerChat = makeChat([{ role: 'user', data: 'inserted', chatId: 't-1', time: 0 } as Message])
    triggerState.next = {
      additonalSysPrompt: { start: '', historyend: '', promptend: '' },
      chat: triggerChat,
      tokens: 42,
      stopSending: false,
      sendAIprompt: false,
    }
    const result = await buildHistoryWindow({
      currentChar: makeChar(),
      currentChat: makeChat([]),
      usingPromptTemplate: false,
      tokenizer: new FakeTokenizer() as unknown as ChatTokenizer,
      findCharacterbyIdwithCache: noCache,
      depthPrompts: [],
      resolvePosition: (text) => text,
    })
    assertNotStopped(result)
    expect(result.triggerResult?.tokens).toBe(42)
    expect(result.currentChat).toBe(triggerChat)
    // The injected "inserted" message must reach the formatted chats array.
    expect(result.chats.some((c) => c.content === 'inserted')).toBe(true)
    // addedTokens includes the 42 plus the contributions of marker + first
    // message + the trigger-injected message ("inserted" => 8 tokens).
    expect(result.addedTokens).toBeGreaterThanOrEqual(42 + 'inserted'.length)
  })
})

describe('buildHistoryWindow - depth prompts', () => {
  beforeEach(() => {
    seedDb()
    triggerState.next = null
  })

  it('accumulates depth-prompt tokens into addedTokens without pushing them onto chats', async () => {
    const chat = makeChat([])
    const result = await buildHistoryWindow({
      currentChar: makeChar(),
      currentChat: chat,
      usingPromptTemplate: false,
      tokenizer: new FakeTokenizer() as unknown as ChatTokenizer,
      findCharacterbyIdwithCache: noCache,
      depthPrompts: [
        {
          depth: 1,
          pos: 'depth',
          prompt: 'dp-token-source',
          role: 'system',
          order: 0,
          tokens: 0,
          priority: 0,
          source: 'test',
          inject: null,
        },
      ],
      resolvePosition: (text) => text,
    })
    assertNotStopped(result)
    // The depth prompt's content must NOT appear in chats (it's tokens-only).
    expect(result.chats.some((c) => c.content === 'dp-token-source')).toBe(false)
    // But its character count must be folded into addedTokens.
    expect(result.addedTokens).toBeGreaterThanOrEqual('dp-token-source'.length)
  })
})
