import { beforeAll, describe, expect, it } from 'vitest'
import type {
  Database,
  character,
} from '../../../src/ts/storage/database.svelte'
import type {
  PromptItem,
  PromptItemAuthorNote,
  PromptItemCache,
  PromptItemChat,
  PromptItemChatML,
  PromptItemPlain,
  PromptItemTyped,
} from '../../../src/ts/process/prompt'
import type { OpenAIChat } from '../../../src/ts/process/index.svelte'
import {
  preflightTemplateTokens,
  type PromptUnformatedSlots,
} from '../src/prompt/preflight.js'
import { bootPromptVariables } from '../src/prompt/promptVariablesBoot.js'
import type { ExpandContext } from '../src/prompt/variables.js'

beforeAll(() => {
  bootPromptVariables()
})

function makeDatabase(overrides: Partial<Database> = {}): Database {
  return {
    aiModel: 'gpt4',
    jailbreakToggle: false,
    chainOfThought: false,
    currentChar: 0,
    characters: [makeCharacter()],
    globalChatVariables: {},
    promptSettings: {
      assistantPrefill: '',
      postEndInnerFormat: '',
      sendChatAsSystem: false,
      sendName: false,
      utilOverride: false,
      customChainOfThought: false,
      maxThoughtTagDepth: -1,
      trimStartNewChat: false,
    },
    ...overrides,
  } as unknown as Database
}

function makeCharacter(overrides: Partial<character> = {}): character {
  return {
    type: 'character',
    name: 'Tess',
    firstMessage: '',
    desc: '',
    notes: '',
    chatPage: 0,
    viewScreen: 'none',
    bias: [],
    emotionImages: [],
    globalLore: [],
    chaId: 'char-tess',
    sdData: [],
    customscript: [],
    triggerscript: [],
    utilityBot: false,
    exampleMessage: '',
    creatorNotes: '',
    systemPrompt: '',
    postHistoryInstructions: '',
    alternateGreetings: [],
    tags: [],
    creator: '',
    characterVersion: '',
    personality: '',
    scenario: '',
    firstMsgIndex: -1,
    replaceGlobalNote: '',
    chats: [],
    chatFolders: [],
    ...overrides,
  } as unknown as character
}

function makeSlots(overrides: Partial<PromptUnformatedSlots> = {}): PromptUnformatedSlots {
  const empty = (): OpenAIChat[] => []
  return {
    main: empty(),
    jailbreak: empty(),
    chats: empty(),
    lorebook: empty(),
    globalNote: empty(),
    authorNote: empty(),
    lastChat: empty(),
    description: empty(),
    postEverything: empty(),
    personaPrompt: empty(),
    ...overrides,
  }
}

function ctxFor(db: Database): ExpandContext {
  return { database: db }
}

const PREBUILT_ASSET_COMMAND_LENGTH = 113 // cl100k_base tokens for the inlined constant.

describe('Phase 7-8b preflightTemplateTokens — null template fallback', () => {
  it('returns zeros for an empty template and empty slots', () => {
    const db = makeDatabase()
    const result = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter(),
      unformated: makeSlots(),
      promptTemplate: [],
      usingPromptTemplate: false,
    })
    expect(result).toEqual({ addedTokens: 0, memoryCardUsed: false, hasCachePoint: false })
  })

  it('tokenizes every slot once when promptTemplate is null', () => {
    const db = makeDatabase()
    const result = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter(),
      unformated: makeSlots({
        description: [{ role: 'system', content: 'hello' }],
        lorebook: [{ role: 'system', content: 'hello' }],
      }),
      promptTemplate: null,
      usingPromptTemplate: false,
    })
    // gpt4 → overhead 5, noName. Two rows × (1 content + 5 overhead).
    expect(result.addedTokens).toBe(12)
    expect(result.memoryCardUsed).toBe(false)
    expect(result.hasCachePoint).toBe(false)
  })
})

describe('Phase 7-8b preflightTemplateTokens — flag cards', () => {
  it('memory card flips memoryCardUsed without adding tokens', () => {
    const db = makeDatabase()
    const card = { type: 'memory' } as PromptItemTyped
    const result = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter(),
      unformated: makeSlots({
        description: [{ role: 'system', content: 'hello' }],
      }),
      promptTemplate: [card],
      usingPromptTemplate: false,
    })
    expect(result.memoryCardUsed).toBe(true)
    expect(result.addedTokens).toBe(0)
  })

  it('cache card flips hasCachePoint without adding tokens', () => {
    const db = makeDatabase()
    const card = { type: 'cache', name: 'c', depth: 0, role: 'all' } as PromptItemCache
    const result = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter(),
      unformated: makeSlots(),
      promptTemplate: [card],
      usingPromptTemplate: false,
    })
    expect(result.hasCachePoint).toBe(true)
    expect(result.addedTokens).toBe(0)
  })
})

describe('Phase 7-8b preflightTemplateTokens — slot wrap cards', () => {
  it('persona innerFormat wraps each row via {{slot}} before tokenizing', () => {
    const db = makeDatabase()
    const card: PromptItemTyped = {
      type: 'persona',
      innerFormat: 'WRAP: {{slot}}',
    }
    const result = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter(),
      unformated: makeSlots({
        personaPrompt: [{ role: 'system', content: 'hello' }],
      }),
      promptTemplate: [card],
      usingPromptTemplate: false,
    })
    // 'WRAP: hello' = 4 tokens + 5 overhead.
    expect(result.addedTokens).toBe(4 + 5)
  })

  it('description without innerFormat tokenizes the slot as-is', () => {
    const db = makeDatabase()
    const card: PromptItemTyped = { type: 'description' }
    const result = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter(),
      unformated: makeSlots({
        description: [{ role: 'system', content: 'description body' }],
      }),
      promptTemplate: [card],
      usingPromptTemplate: false,
    })
    // 'description body' = 2 tokens + 5 overhead.
    expect(result.addedTokens).toBe(2 + 5)
  })

  it('authornote falls back to card.defaultText when the slot row is empty', () => {
    const db = makeDatabase()
    const card: PromptItemAuthorNote = {
      type: 'authornote',
      innerFormat: 'WRAP: {{slot}}',
      defaultText: 'hello',
    }
    const result = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter(),
      unformated: makeSlots({
        authorNote: [{ role: 'system', content: '' }],
      }),
      promptTemplate: [card],
      usingPromptTemplate: false,
    })
    // Wrap fills {{slot}} with the defaultText → 'WRAP: hello' = 4 + 5.
    expect(result.addedTokens).toBe(4 + 5)
  })

  it('lorebook tokenizes the slot as-is', () => {
    const db = makeDatabase()
    const card: PromptItemTyped = { type: 'lorebook' }
    const result = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter(),
      unformated: makeSlots({
        lorebook: [
          { role: 'system', content: 'hello' },
          { role: 'system', content: 'hello' },
        ],
      }),
      promptTemplate: [card],
      usingPromptTemplate: false,
    })
    expect(result.addedTokens).toBe(2 * (1 + 5))
  })
})

describe('Phase 7-8b preflightTemplateTokens — plain / jailbreak / cot', () => {
  it('skips jailbreak card when db.jailbreakToggle is false', () => {
    const db = makeDatabase({ jailbreakToggle: false } as Partial<Database>)
    const card: PromptItemPlain = {
      type: 'jailbreak',
      type2: 'normal',
      text: 'jailbreak body',
      role: 'system',
    }
    const result = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter(),
      unformated: makeSlots(),
      promptTemplate: [card],
      usingPromptTemplate: false,
    })
    expect(result.addedTokens).toBe(0)
  })

  it('emits jailbreak card when db.jailbreakToggle is true', () => {
    const db = makeDatabase({ jailbreakToggle: true } as Partial<Database>)
    const card: PromptItemPlain = {
      type: 'jailbreak',
      type2: 'normal',
      text: 'jailbreak body',
      role: 'system',
    }
    const result = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter(),
      unformated: makeSlots(),
      promptTemplate: [card],
      usingPromptTemplate: false,
    })
    expect(result.addedTokens).toBe(4 + 5)
  })

  it('skips cot card when db.chainOfThought is false', () => {
    const db = makeDatabase({ chainOfThought: false } as Partial<Database>)
    const card: PromptItemPlain = {
      type: 'cot',
      type2: 'normal',
      text: 'cot body',
      role: 'system',
    }
    const result = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter(),
      unformated: makeSlots(),
      promptTemplate: [card],
      usingPromptTemplate: false,
    })
    expect(result.addedTokens).toBe(0)
  })

  it('plain card tokenizes its text + overhead', () => {
    const db = makeDatabase()
    const card: PromptItemPlain = {
      type: 'plain',
      type2: 'normal',
      text: 'plain body',
      role: 'system',
    }
    const result = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter(),
      unformated: makeSlots(),
      promptTemplate: [card],
      usingPromptTemplate: false,
    })
    expect(result.addedTokens).toBe(2 + 5)
  })

  it('globalNote appends prebuiltAssetCommand when char.prebuiltAssetCommand is set', () => {
    const db = makeDatabase()
    const card: PromptItemPlain = {
      type: 'plain',
      type2: 'globalNote',
      text: 'globalNote body',
      role: 'system',
    }
    const withAssetCmd = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter({
        prebuiltAssetCommand: true,
      } as Partial<character>),
      unformated: makeSlots(),
      promptTemplate: [card],
      usingPromptTemplate: false,
    })
    const withoutAssetCmd = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter({
        prebuiltAssetCommand: false,
      } as Partial<character>),
      unformated: makeSlots(),
      promptTemplate: [card],
      usingPromptTemplate: false,
    })
    // The flag should add more than a token or two — the constant is
    // ~100 tokens after CBS expansion. Exact count depends on how
    // `expandVariables` resolves the `{{join::…}}` / `{{ele::…}}`
    // helpers, which we don't lock here.
    expect(withAssetCmd.addedTokens).toBeGreaterThan(withoutAssetCmd.addedTokens + 50)
  })

  it('globalNote suppresses prebuiltAssetCommand when the magic comment is present', () => {
    const db = makeDatabase()
    const card: PromptItemPlain = {
      type: 'plain',
      type2: 'globalNote',
      text: 'globalNote body {{//@customimageinstruction}}',
      role: 'system',
    }
    const result = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter({
        prebuiltAssetCommand: true,
      } as Partial<character>),
      unformated: makeSlots(),
      promptTemplate: [card],
      usingPromptTemplate: false,
    })
    // The `{{//@customimageinstruction}}` comment is stripped by
    // expandVariables (CBS comment form), so the tokenized content is
    // just 'globalNote body ' + trailing whitespace. The PREBUILT path
    // is suppressed; the count should be far smaller than the 116-byte
    // PREBUILT total above.
    expect(result.addedTokens).toBeLessThan(50)
  })
})

describe('Phase 7-8b preflightTemplateTokens — chatML', () => {
  it('parses <|im_start|>system|sep|hello<|im_end|> rows', () => {
    const db = makeDatabase()
    const card: PromptItemChatML = {
      type: 'chatML',
      text: '<|im_start|>system<|im_sep|>hello<|im_end|>',
    }
    const result = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter(),
      unformated: makeSlots(),
      promptTemplate: [card],
      usingPromptTemplate: false,
    })
    // Single row 'hello' = 1 + 5 overhead.
    expect(result.addedTokens).toBe(1 + 5)
  })

  it('returns 0 when text does not start with the chatML starter', () => {
    const db = makeDatabase()
    const card: PromptItemChatML = { type: 'chatML', text: 'plain text' }
    const result = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter(),
      unformated: makeSlots(),
      promptTemplate: [card],
      usingPromptTemplate: false,
    })
    expect(result.addedTokens).toBe(0)
  })
})

describe('Phase 7-8b preflightTemplateTokens — chat range card', () => {
  const slots = (): PromptUnformatedSlots =>
    makeSlots({
      chats: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' },
        { role: 'user', content: 'third' },
        { role: 'assistant', content: 'fourth' },
      ],
    })

  it('positive range tokenizes the slice', () => {
    const db = makeDatabase()
    const card: PromptItemChat = { type: 'chat', rangeStart: 1, rangeEnd: 3 }
    const result = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter(),
      unformated: slots(),
      promptTemplate: [card],
      usingPromptTemplate: false,
    })
    // 'second' (1) + 'third' (1) → 2 rows × (1 + 5).
    expect(result.addedTokens).toBe(2 * (1 + 5))
  })

  it("rangeEnd === 'end' picks up through the tail", () => {
    const db = makeDatabase()
    const card: PromptItemChat = { type: 'chat', rangeStart: 2, rangeEnd: 'end' }
    const result = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter(),
      unformated: slots(),
      promptTemplate: [card],
      usingPromptTemplate: false,
    })
    // 'third' (1) + 'fourth' (2) → (1+5)+(2+5).
    expect(result.addedTokens).toBe(1 + 5 + 2 + 5)
  })

  it('rangeStart === -1000 selects the full chats array', () => {
    const db = makeDatabase()
    const card: PromptItemChat = { type: 'chat', rangeStart: -1000, rangeEnd: 0 }
    const result = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter(),
      unformated: slots(),
      promptTemplate: [card],
      usingPromptTemplate: false,
    })
    // 1+1+1+2 = 5 content tokens + 4 × 5 overhead = 25.
    expect(result.addedTokens).toBe(5 + 20)
  })

  it('negative rangeStart resolves from the tail', () => {
    const db = makeDatabase()
    const card: PromptItemChat = { type: 'chat', rangeStart: -2, rangeEnd: 'end' }
    const result = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter(),
      unformated: slots(),
      promptTemplate: [card],
      usingPromptTemplate: false,
    })
    // 'third' (1) + 'fourth' (2).
    expect(result.addedTokens).toBe(1 + 5 + 2 + 5)
  })

  it('start >= end results in no tokens added', () => {
    const db = makeDatabase()
    const card: PromptItemChat = { type: 'chat', rangeStart: 3, rangeEnd: 1 }
    const result = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter(),
      unformated: slots(),
      promptTemplate: [card],
      usingPromptTemplate: false,
    })
    expect(result.addedTokens).toBe(0)
  })

  it('sendChatAsSystem folds role prefix into the content', () => {
    const db = makeDatabase({
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: '',
        sendChatAsSystem: true,
        sendName: false,
        utilOverride: false,
        customChainOfThought: false,
        maxThoughtTagDepth: -1,
        trimStartNewChat: false,
      } as Database['promptSettings'],
    })
    const card: PromptItemChat = { type: 'chat', rangeStart: 0, rangeEnd: 'end' }
    const slotsWithTwo = makeSlots({
      chats: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
    })
    const systemized = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter(),
      unformated: slotsWithTwo,
      promptTemplate: [card],
      usingPromptTemplate: true,
    })
    // 'user: hi' (3) + 'assistant: hello' (3) + 2 × 5 overhead = 16.
    expect(systemized.addedTokens).toBe(3 + 3 + 10)
  })

  it('does NOT mutate the caller-supplied chats slot when systemizing', () => {
    const db = makeDatabase({
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: '',
        sendChatAsSystem: true,
        sendName: false,
        utilOverride: false,
        customChainOfThought: false,
        maxThoughtTagDepth: -1,
        trimStartNewChat: false,
      } as Database['promptSettings'],
    })
    const card: PromptItemChat = { type: 'chat', rangeStart: 0, rangeEnd: 'end' }
    const original: OpenAIChat[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]
    const slotsObj = makeSlots({ chats: original })
    preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter(),
      unformated: slotsObj,
      promptTemplate: [card],
      usingPromptTemplate: true,
    })
    expect(original[0]).toEqual({ role: 'user', content: 'hi' })
    expect(original[1]).toEqual({ role: 'assistant', content: 'hello' })
  })
})

describe('Phase 7-8b preflightTemplateTokens — postEverything', () => {
  it('adds the postEndInnerFormat synthetic row when usingPromptTemplate', () => {
    const db = makeDatabase({
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: 'postEndInnerFormat content',
        sendChatAsSystem: false,
        sendName: false,
        utilOverride: false,
        customChainOfThought: false,
        maxThoughtTagDepth: -1,
        trimStartNewChat: false,
      } as Database['promptSettings'],
    })
    const card: PromptItemTyped = { type: 'postEverything' }
    const result = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter(),
      unformated: makeSlots({
        postEverything: [{ role: 'system', content: 'hello' }],
      }),
      promptTemplate: [card],
      usingPromptTemplate: true,
    })
    // Slot row 'hello' = 1 + 5, plus synthetic row
    // 'postEndInnerFormat content' = 5 + 5.
    expect(result.addedTokens).toBe(1 + 5 + 5 + 5)
  })

  it('does NOT add the postEndInnerFormat row when usingPromptTemplate is false', () => {
    const db = makeDatabase({
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: 'postEndInnerFormat content',
        sendChatAsSystem: false,
        sendName: false,
        utilOverride: false,
        customChainOfThought: false,
        maxThoughtTagDepth: -1,
        trimStartNewChat: false,
      } as Database['promptSettings'],
    })
    const card: PromptItemTyped = { type: 'postEverything' }
    const result = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter(),
      unformated: makeSlots({
        postEverything: [{ role: 'system', content: 'hello' }],
      }),
      promptTemplate: [card],
      usingPromptTemplate: false,
    })
    expect(result.addedTokens).toBe(1 + 5)
  })
})

describe('Phase 7-8b preflightTemplateTokens — tokenizer routing', () => {
  it('uses overhead 3 + name accounting for non-gpt models', () => {
    const db = makeDatabase({ aiModel: 'claude-3-5-sonnet' })
    const card: PromptItemTyped = { type: 'description' }
    const result = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter(),
      unformated: makeSlots({
        description: [{ role: 'system', content: 'hello', name: 'hello' }],
      }),
      promptTemplate: [card],
      usingPromptTemplate: false,
    })
    // claude → useName='name', overhead 3 → 1 content + 3 overhead + (1 name + 1 sep).
    expect(result.addedTokens).toBe(1 + 3 + 1 + 1)
  })

  it('routes through o200k_base for the gpt-4o family', () => {
    const db = makeDatabase({ aiModel: 'gpt-4o' })
    const card: PromptItemTyped = { type: 'description' }
    const result = preflightTemplateTokens({
      ctx: ctxFor(db),
      currentChar: makeCharacter(),
      unformated: makeSlots({
        description: [{ role: 'system', content: 'café résumé 漢字' }],
      }),
      promptTemplate: [card],
      usingPromptTemplate: false,
    })
    // o200k_base count for the test string = 6 + 5 overhead.
    expect(result.addedTokens).toBe(6 + 5)
  })
})
