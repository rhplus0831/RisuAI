import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {} }
})

import { getDatabase, setDatabase, type Database, type character } from '../../storage/database.svelte'
import type { OpenAIChat } from '../index.svelte'
import type { PromptItem } from '../prompt'
import {
  preflightTemplateTokens as preflightTemplateTokensWithDatabase,
  type PromptUnformatedSlots,
} from '../promptBudget/preflightTemplateTokens'

function preflightTemplateTokens(
  promptTemplate: Parameters<typeof preflightTemplateTokensWithDatabase>[0],
  usingPromptTemplate: boolean,
  unformated: PromptUnformatedSlots,
  tokenizer: Parameters<typeof preflightTemplateTokensWithDatabase>[3],
  currentChar: character,
  positionParser: (text: string, loc: string) => string,
  descriptionBaseIndex?: number,
) {
  return preflightTemplateTokensWithDatabase(
    promptTemplate,
    usingPromptTemplate,
    unformated,
    tokenizer,
    currentChar,
    positionParser,
    getDatabase(),
    descriptionBaseIndex,
  )
}

class FakeTokenizer {
  /** Returns the content-length of the message so token math is predictable. */
  async tokenizeChat(chat: OpenAIChat): Promise<number> {
    return (chat.content ?? '').length
  }
}

function makeChar(overrides: Partial<character> = {}): character {
  return {
    type: 'character',
    name: 'Test',
    chaId: 'cha-1',
    desc: '',
    personality: '',
    scenario: '',
    additionalText: '',
    systemPrompt: '',
    replaceGlobalNote: '',
    chats: [],
    chatPage: 0,
    image: '',
    emotionImages: [],
    bias: [],
    viewScreen: 'none',
    globalLore: [],
    firstMessage: '',
    notes: '',
    utilityBot: false,
    ...overrides,
  } as unknown as character
}

function seedDb(extra: Partial<Database> = {}) {
  setDatabase({
    aiModel: 'gpt-4o',
    subModel: 'gpt-4o',
    characters: [makeChar()],
    ...extra,
  } as unknown as Database)
}

function emptyUnformated(): PromptUnformatedSlots {
  return {
    main: [],
    jailbreak: [],
    chats: [],
    lorebook: [],
    globalNote: [],
    authorNote: [],
    lastChat: [],
    description: [],
    postEverything: [],
    personaPrompt: [],
  }
}

const passThroughPositionParser = (text: string) => text

describe('preflightTemplateTokens - no template path', () => {
  beforeEach(() => {
    seedDb()
  })

  it('tokenizes every slot when promptTemplate is null', async () => {
    const unformated = emptyUnformated()
    unformated.main.push({ role: 'system', content: 'abc' }) // 3
    unformated.lorebook.push({ role: 'system', content: 'lore' }) // 4
    unformated.chats.push({ role: 'user', content: 'hello' }) // 5
    unformated.postEverything.push({ role: 'system', content: 'pe' }) // 2
    const result = await preflightTemplateTokens(
      null,
      false,
      unformated,
      new FakeTokenizer() as never,
      makeChar(),
      passThroughPositionParser,
    )
    expect(result.addedTokens).toBe(14)
    expect(result.memoryCardUsed).toBe(false)
    expect(result.hasCachePoint).toBe(false)
  })

  it('returns 0 tokens for an empty unformated', async () => {
    const result = await preflightTemplateTokens(
      null,
      false,
      emptyUnformated(),
      new FakeTokenizer() as never,
      makeChar(),
      passThroughPositionParser,
    )
    expect(result.addedTokens).toBe(0)
  })

  it('budgets the character depth prompt that final rendering inserts', async () => {
    const result = await preflightTemplateTokens(
      null,
      false,
      emptyUnformated(),
      new FakeTokenizer() as never,
      makeChar({ depth_prompt: { depth: 1, prompt: 'Depth {{char}}' } }),
      passThroughPositionParser,
    )
    expect(result.addedTokens).toBe('Depth Test'.length)
  })
})

describe('preflightTemplateTokens - flag setters', () => {
  beforeEach(() => {
    seedDb()
  })

  it('sets memoryCardUsed when a memory card is in the template', async () => {
    const template: PromptItem[] = [{ type: 'memory' }]
    const result = await preflightTemplateTokens(
      template,
      true,
      emptyUnformated(),
      new FakeTokenizer() as never,
      makeChar(),
      passThroughPositionParser,
    )
    expect(result.memoryCardUsed).toBe(true)
    expect(result.hasCachePoint).toBe(false)
    expect(result.addedTokens).toBe(0)
  })

  it('sets hasCachePoint when a cache card is in the template', async () => {
    const template: PromptItem[] = [{ type: 'cache', name: 'c', depth: 1, role: 'user' }]
    const result = await preflightTemplateTokens(
      template,
      true,
      emptyUnformated(),
      new FakeTokenizer() as never,
      makeChar(),
      passThroughPositionParser,
    )
    expect(result.hasCachePoint).toBe(true)
    expect(result.memoryCardUsed).toBe(false)
  })
})

describe('preflightTemplateTokens - per-card branches', () => {
  beforeEach(() => {
    seedDb()
  })

  it('skips a jailbreak card when db.jailbreakToggle is false', async () => {
    seedDb({ jailbreakToggle: false })
    const template: PromptItem[] = [{ type: 'jailbreak', type2: 'normal', text: 'jb-content', role: 'system' }]
    const result = await preflightTemplateTokens(
      template,
      true,
      emptyUnformated(),
      new FakeTokenizer() as never,
      makeChar(),
      passThroughPositionParser,
    )
    expect(result.addedTokens).toBe(0)
  })

  it('tokenizes a jailbreak card when db.jailbreakToggle is true', async () => {
    seedDb({ jailbreakToggle: true })
    const template: PromptItem[] = [{ type: 'jailbreak', type2: 'normal', text: 'jb-content', role: 'system' }]
    const result = await preflightTemplateTokens(
      template,
      true,
      emptyUnformated(),
      new FakeTokenizer() as never,
      makeChar(),
      passThroughPositionParser,
    )
    expect(result.addedTokens).toBe('jb-content'.length)
  })

  it('skips a cot card when db.chainOfThought is false', async () => {
    seedDb({ chainOfThought: false })
    const template: PromptItem[] = [{ type: 'cot', type2: 'normal', text: 'cot-content', role: 'system' }]
    const result = await preflightTemplateTokens(
      template,
      true,
      emptyUnformated(),
      new FakeTokenizer() as never,
      makeChar(),
      passThroughPositionParser,
    )
    expect(result.addedTokens).toBe(0)
  })

  it('tokenizes a postEverything card and appends postEndInnerFormat when set', async () => {
    seedDb({
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: 'TRAILING',
        sendChatAsSystem: false,
        sendName: false,
        utilOverride: false,
        customChainOfThought: false,
        maxThoughtTagDepth: -1,
      },
    })
    const unformated = emptyUnformated()
    unformated.postEverything.push({ role: 'system', content: 'post' }) // 4
    const template: PromptItem[] = [{ type: 'postEverything' }]
    const result = await preflightTemplateTokens(
      template,
      true,
      unformated,
      new FakeTokenizer() as never,
      makeChar(),
      passThroughPositionParser,
    )
    expect(result.addedTokens).toBe('post'.length + 'TRAILING'.length)
  })

  it('does not append postEndInnerFormat when usingPromptTemplate is false', async () => {
    seedDb({
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: 'TRAILING',
        sendChatAsSystem: false,
        sendName: false,
        utilOverride: false,
        customChainOfThought: false,
        maxThoughtTagDepth: -1,
      },
    })
    const unformated = emptyUnformated()
    unformated.postEverything.push({ role: 'system', content: 'post' }) // 4
    const template: PromptItem[] = [{ type: 'postEverything' }]
    const result = await preflightTemplateTokens(
      template,
      false,
      unformated,
      new FakeTokenizer() as never,
      makeChar(),
      passThroughPositionParser,
    )
    expect(result.addedTokens).toBe('post'.length)
  })
})

describe('preflightTemplateTokens - chat card range math', () => {
  beforeEach(() => {
    seedDb()
  })

  function unformatedWithChats(count: number): PromptUnformatedSlots {
    const u = emptyUnformated()
    for (let i = 0; i < count; i++) {
      u.chats.push({ role: 'user', content: 'X' }) // 1 token each
    }
    return u
  }

  it('returns 0 tokens when start >= end after normalization', async () => {
    const template: PromptItem[] = [{ type: 'chat', rangeStart: 5, rangeEnd: 5 }]
    const result = await preflightTemplateTokens(
      template,
      true,
      unformatedWithChats(10),
      new FakeTokenizer() as never,
      makeChar(),
      passThroughPositionParser,
    )
    expect(result.addedTokens).toBe(0)
  })

  it('treats rangeEnd: "end" as unformated.chats.length', async () => {
    const template: PromptItem[] = [{ type: 'chat', rangeStart: 0, rangeEnd: 'end' }]
    const result = await preflightTemplateTokens(
      template,
      true,
      unformatedWithChats(3),
      new FakeTokenizer() as never,
      makeChar(),
      passThroughPositionParser,
    )
    expect(result.addedTokens).toBe(3)
  })

  it('treats rangeStart: -1000 as the full chat array', async () => {
    const template: PromptItem[] = [{ type: 'chat', rangeStart: -1000, rangeEnd: 0 }]
    const result = await preflightTemplateTokens(
      template,
      true,
      unformatedWithChats(4),
      new FakeTokenizer() as never,
      makeChar(),
      passThroughPositionParser,
    )
    expect(result.addedTokens).toBe(4)
  })

  it('resolves negative rangeStart relative to chats.length', async () => {
    const template: PromptItem[] = [{ type: 'chat', rangeStart: -2, rangeEnd: 'end' }]
    const result = await preflightTemplateTokens(
      template,
      true,
      unformatedWithChats(5),
      new FakeTokenizer() as never,
      makeChar(),
      passThroughPositionParser,
    )
    expect(result.addedTokens).toBe(2)
  })

  it('clamps negative rangeStart to 0 when it underflows past 0', async () => {
    const template: PromptItem[] = [{ type: 'chat', rangeStart: -10, rangeEnd: 'end' }]
    const result = await preflightTemplateTokens(
      template,
      true,
      unformatedWithChats(3),
      new FakeTokenizer() as never,
      makeChar(),
      passThroughPositionParser,
    )
    expect(result.addedTokens).toBe(3)
  })

  it('runs chats through systemizeChat when sendChatAsSystem is true and the card does not opt out', async () => {
    seedDb({
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: '',
        sendChatAsSystem: true,
        sendName: false,
        utilOverride: false,
        customChainOfThought: false,
        maxThoughtTagDepth: -1,
      },
    })
    const unformated = emptyUnformated()
    unformated.chats.push({ role: 'user', content: 'hi' }) // becomes 'user: hi' (8 tokens)
    const template: PromptItem[] = [{ type: 'chat', rangeStart: 0, rangeEnd: 'end' }]
    const result = await preflightTemplateTokens(
      template,
      true,
      unformated,
      new FakeTokenizer() as never,
      makeChar(),
      passThroughPositionParser,
    )
    expect(result.addedTokens).toBe('user: hi'.length)
  })

  it('preserves original role when chatAsOriginalOnSystem is set', async () => {
    seedDb({
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: '',
        sendChatAsSystem: true,
        sendName: false,
        utilOverride: false,
        customChainOfThought: false,
        maxThoughtTagDepth: -1,
      },
    })
    const unformated = emptyUnformated()
    unformated.chats.push({ role: 'user', content: 'hi' })
    const template: PromptItem[] = [{ type: 'chat', rangeStart: 0, rangeEnd: 'end', chatAsOriginalOnSystem: true }]
    const result = await preflightTemplateTokens(
      template,
      true,
      unformated,
      new FakeTokenizer() as never,
      makeChar(),
      passThroughPositionParser,
    )
    expect(result.addedTokens).toBe('hi'.length)
  })
})
