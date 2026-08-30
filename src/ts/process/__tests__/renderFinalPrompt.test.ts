import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {} }
})

// runLuaEditTrigger is invoked twice (formated, then promptText when capture
// is on). A hoisted holder lets each test stage either a pass-through or a
// mutation; the mode is stored so tests can confirm dispatch order.
const triggerState = vi.hoisted(() => ({
  mutate: false as boolean,
  calls: [] as { mode: string; length: number }[],
}))
vi.mock('../scriptings', () => ({
  runLuaEditTrigger: async (_char: unknown, mode: string, content: unknown): Promise<unknown> => {
    triggerState.calls.push({
      mode,
      length: Array.isArray(content) ? content.length : -1,
    })
    if (!triggerState.mutate) return content
    if (Array.isArray(content)) {
      return [...content, { role: 'system', content: '__trigger__' }]
    }
    return content
  },
}))

import { setDatabase, type Database, type character } from '../../storage/database.svelte'
import { getResourceDatabase, replaceResourceDatabase } from '../../server/resourceState.svelte'
import { resolveModelProfile } from '../../model/modelProfileResolver'
import type { OpenAIChat } from '../index.svelte'
import type { PromptItem } from '../prompt'
import {
  renderFinalPrompt as renderFinalPromptWithModel,
  type FormatOrderKey,
  type RenderFinalPromptArgs,
  type UnformatedPromptSlots,
} from '../promptAssembly/renderFinalPrompt'

const testDatabaseState = {
  get db() {
    return getResourceDatabase()
  },
  set db(value: ReturnType<typeof getResourceDatabase>) {
    replaceResourceDatabase(value)
  },
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
    customscript: [],
    triggerscript: [],
    additionalAssets: [],
    exampleMessage: '',
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

function emptyUnformated(): UnformatedPromptSlots {
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

const passThrough = (text: string) => text

function renderFinalPrompt(args: Omit<RenderFinalPromptArgs, 'modelId'>) {
  return renderFinalPromptWithModel({
    ...args,
    modelId: resolveModelProfile({ database: testDatabaseState.db, role: 'chatMain' }).modelId,
  })
}

const DEFAULT_FORMAT_ORDER: FormatOrderKey[] = [
  'main',
  'description',
  'personaPrompt',
  'chats',
  'lastChat',
  'jailbreak',
  'lorebook',
  'globalNote',
  'authorNote',
  'postEverything',
]

beforeEach(() => {
  triggerState.mutate = false
  triggerState.calls = []
})

describe('renderFinalPrompt - non-template formatOrder path', () => {
  it('walks formatOrder slots in order and coalesces consecutive systems under gpt', async () => {
    seedDb()
    const unformated = emptyUnformated()
    unformated.main.push({ role: 'system', content: 'MAIN' })
    unformated.description.push({ role: 'system', content: 'DESC' })
    unformated.chats.push({ role: 'user', content: 'hi' })

    const result = await renderFinalPrompt({
      currentChar: makeChar(),
      unformated,
      promptTemplate: null,
      usingPromptTemplate: false,
      formatOrder: DEFAULT_FORMAT_ORDER,
      memories: [],
      positionParser: passThrough,
      hasCachePoint: false,
      isContinue: false,
    })

    // System rows from main + description merge; user row stays separate.
    expect(result.formated.map((c) => `${c.role}:${c.content}`)).toEqual(['system:MAIN\n\nDESC', 'user:hi'])
  })

  it('does not coalesce systems on non-gpt/claude models', async () => {
    seedDb({ aiModel: 'novelai:something' })
    const unformated = emptyUnformated()
    unformated.main.push({ role: 'system', content: 'MAIN' })
    unformated.description.push({ role: 'system', content: 'DESC' })

    const result = await renderFinalPrompt({
      currentChar: makeChar(),
      unformated,
      promptTemplate: null,
      usingPromptTemplate: false,
      formatOrder: DEFAULT_FORMAT_ORDER,
      memories: [],
      positionParser: passThrough,
      hasCachePoint: false,
      isContinue: false,
    })

    expect(result.formated.map((c) => c.content)).toEqual(['MAIN', 'DESC'])
  })

  it('uses the request-scoped resolved model instead of the flat database model', async () => {
    seedDb({ aiModel: 'novelai:something' })
    const unformated = emptyUnformated()
    unformated.main.push({ role: 'system', content: 'MAIN' })
    unformated.description.push({ role: 'system', content: 'DESC' })

    const result = await renderFinalPromptWithModel({
      currentChar: makeChar(),
      modelId: 'gpt-4o',
      unformated,
      promptTemplate: null,
      usingPromptTemplate: false,
      formatOrder: DEFAULT_FORMAT_ORDER,
      memories: [],
      positionParser: passThrough,
      hasCachePoint: false,
      isContinue: false,
    })

    expect(result.formated.map((chat) => chat.content)).toEqual(['MAIN\n\nDESC'])
  })
})

describe('renderFinalPrompt - continue marker', () => {
  it('pushes [Continue the last response] under gpt when isContinue=true', async () => {
    seedDb()
    const unformated = emptyUnformated()
    unformated.main.push({ role: 'system', content: 'M' })

    const result = await renderFinalPrompt({
      currentChar: makeChar(),
      unformated,
      promptTemplate: null,
      usingPromptTemplate: false,
      formatOrder: DEFAULT_FORMAT_ORDER,
      memories: [],
      positionParser: passThrough,
      hasCachePoint: false,
      isContinue: true,
    })

    // The continue marker lands on postEverything, last in the format walk.
    expect(result.formated.map((c) => c.content)).toEqual(['M\n\n[Continue the last response]'])
  })

  it('omits the continue marker on novelai', async () => {
    seedDb({ aiModel: 'novelai:something' })
    const unformated = emptyUnformated()

    await renderFinalPrompt({
      currentChar: makeChar(),
      unformated,
      promptTemplate: null,
      usingPromptTemplate: false,
      formatOrder: DEFAULT_FORMAT_ORDER,
      memories: [],
      positionParser: passThrough,
      hasCachePoint: false,
      isContinue: true,
    })

    expect(unformated.postEverything).toEqual([])
  })
})

describe('renderFinalPrompt - template walker basics', () => {
  it('applies role2 to browser persona, author-note, and memory rows', async () => {
    seedDb()
    const unformated = emptyUnformated()
    unformated.personaPrompt.push({ role: 'system', content: 'persona' })
    unformated.authorNote.push({ role: 'system', content: 'note' })

    const result = await renderFinalPrompt({
      currentChar: makeChar(),
      unformated,
      promptTemplate: [
        { type: 'persona', role2: 'bot' },
        { type: 'authornote', role2: 'user' },
        { type: 'memory', role2: 'bot' },
      ],
      usingPromptTemplate: true,
      formatOrder: DEFAULT_FORMAT_ORDER,
      memories: [{ role: 'system', content: 'memory' }],
      positionParser: passThrough,
      hasCachePoint: false,
      isContinue: false,
    })

    expect(result.formated).toEqual([
      { role: 'assistant', content: 'persona' },
      { role: 'user', content: 'note' },
      { role: 'assistant', content: 'memory' },
    ])
  })

  it('applies description role2 only to the browser base-description row', async () => {
    seedDb()
    const unformated = emptyUnformated()
    unformated.description.push(
      { role: 'system', content: 'before lore' },
      { role: 'system', content: 'base description' },
      { role: 'system', content: 'after lore' },
    )

    const result = await renderFinalPrompt({
      currentChar: makeChar(),
      unformated,
      promptTemplate: [{ type: 'description', role2: 'user' }],
      usingPromptTemplate: true,
      formatOrder: DEFAULT_FORMAT_ORDER,
      memories: [],
      positionParser: passThrough,
      hasCachePoint: false,
      isContinue: false,
      descriptionBaseIndex: 1,
    })

    expect(result.formated).toEqual([
      { role: 'system', content: 'before lore' },
      { role: 'user', content: 'base description' },
      { role: 'system', content: 'after lore' },
    ])
  })

  it('persona + description + authornote innerFormat substitution', async () => {
    seedDb()
    const unformated = emptyUnformated()
    unformated.personaPrompt.push({ role: 'system', content: 'I am curious.' })
    unformated.description.push({ role: 'system', content: 'A bot.' })
    unformated.authorNote.push({ role: 'system', content: '' })

    const template: PromptItem[] = [
      { type: 'persona', innerFormat: 'Persona: {{slot}}' },
      { type: 'description', innerFormat: 'Desc: {{slot}}' },
      { type: 'authornote', innerFormat: 'Note: {{slot}}', defaultText: 'none' },
    ]

    const result = await renderFinalPrompt({
      currentChar: makeChar(),
      unformated,
      promptTemplate: template,
      usingPromptTemplate: true,
      formatOrder: DEFAULT_FORMAT_ORDER,
      memories: [],
      positionParser: passThrough,
      hasCachePoint: false,
      isContinue: false,
    })

    expect(result.formated.map((c) => c.content)).toEqual(['Persona: I am curious.\n\nDesc: A bot.\n\nNote: none'])
  })

  it('plain card converts role: bot -> assistant and renders chatML', async () => {
    seedDb()
    const unformated = emptyUnformated()
    const template: PromptItem[] = [
      { type: 'plain', text: 'plain-text', role: 'bot', type2: 'normal' },
      {
        type: 'chatML',
        text: '<|im_start|>system\nA<|im_end|><|im_start|>user\nB<|im_end|><|im_start|>assistant\nC<|im_end|>',
      },
    ]

    const result = await renderFinalPrompt({
      currentChar: makeChar(),
      unformated,
      promptTemplate: template,
      usingPromptTemplate: true,
      formatOrder: DEFAULT_FORMAT_ORDER,
      memories: [],
      positionParser: passThrough,
      hasCachePoint: false,
      isContinue: false,
    })

    expect(result.formated.map((c) => `${c.role}:${c.content}`)).toEqual([
      'assistant:plain-text',
      'system:A',
      'user:B',
      'assistant:C',
    ])
  })

  it('jailbreak card is suppressed when jailbreakToggle is off', async () => {
    seedDb({ jailbreakToggle: false })
    const unformated = emptyUnformated()
    const template: PromptItem[] = [
      { type: 'jailbreak', text: 'JB', role: 'system', type2: 'normal' },
      { type: 'plain', text: 'OK', role: 'system', type2: 'normal' },
    ]

    const result = await renderFinalPrompt({
      currentChar: makeChar(),
      unformated,
      promptTemplate: template,
      usingPromptTemplate: true,
      formatOrder: DEFAULT_FORMAT_ORDER,
      memories: [],
      positionParser: passThrough,
      hasCachePoint: false,
      isContinue: false,
    })

    expect(result.formated.map((c) => c.content)).toEqual(['OK'])
  })

  it('cot card is suppressed when chainOfThought is off', async () => {
    seedDb({ chainOfThought: false })
    const unformated = emptyUnformated()
    const template: PromptItem[] = [
      { type: 'cot', text: 'COT', role: 'system', type2: 'normal' },
      { type: 'plain', text: 'OK', role: 'system', type2: 'normal' },
    ]

    const result = await renderFinalPrompt({
      currentChar: makeChar(),
      unformated,
      promptTemplate: template,
      usingPromptTemplate: true,
      formatOrder: DEFAULT_FORMAT_ORDER,
      memories: [],
      positionParser: passThrough,
      hasCachePoint: false,
      isContinue: false,
    })

    expect(result.formated.map((c) => c.content)).toEqual(['OK'])
  })

  it('memory card uses innerFormat to wrap returned memories[]', async () => {
    seedDb()
    const unformated = emptyUnformated()
    const memories: OpenAIChat[] = [{ role: 'system', content: 'summary-a', memo: 'hypaMemory' }]
    const template: PromptItem[] = [{ type: 'memory', innerFormat: 'Memory: {{slot}}' }]

    const result = await renderFinalPrompt({
      currentChar: makeChar(),
      unformated,
      promptTemplate: template,
      usingPromptTemplate: true,
      formatOrder: DEFAULT_FORMAT_ORDER,
      memories,
      positionParser: passThrough,
      hasCachePoint: false,
      isContinue: false,
    })

    expect(result.formated.map((c) => c.content)).toEqual(['Memory: summary-a'])
  })
})

describe('renderFinalPrompt - chat card slice math', () => {
  it('full range when rangeStart=-1000', async () => {
    seedDb()
    const unformated = emptyUnformated()
    unformated.chats = [
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
      { role: 'user', content: 'three' },
    ]
    const template: PromptItem[] = [{ type: 'chat', rangeStart: -1000, rangeEnd: 0 }]

    const result = await renderFinalPrompt({
      currentChar: makeChar(),
      unformated,
      promptTemplate: template,
      usingPromptTemplate: true,
      formatOrder: DEFAULT_FORMAT_ORDER,
      memories: [],
      positionParser: passThrough,
      hasCachePoint: false,
      isContinue: false,
    })

    expect(result.formated.map((c) => c.content)).toEqual(['one', 'two', 'three'])
  })

  it('negative-end-relative range', async () => {
    seedDb()
    const unformated = emptyUnformated()
    unformated.chats = [
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
      { role: 'user', content: 'c' },
      { role: 'user', content: 'd' },
    ]
    const template: PromptItem[] = [{ type: 'chat', rangeStart: 1, rangeEnd: -1 }]

    const result = await renderFinalPrompt({
      currentChar: makeChar(),
      unformated,
      promptTemplate: template,
      usingPromptTemplate: true,
      formatOrder: DEFAULT_FORMAT_ORDER,
      memories: [],
      positionParser: passThrough,
      hasCachePoint: false,
      isContinue: false,
    })

    // slice(1, 3) -> 'b','c'
    expect(result.formated.map((c) => c.content)).toEqual(['b', 'c'])
  })

  it('start >= end short-circuits to nothing', async () => {
    seedDb()
    const unformated = emptyUnformated()
    unformated.chats = [{ role: 'user', content: 'only' }]
    const template: PromptItem[] = [{ type: 'chat', rangeStart: 5, rangeEnd: 2 }]

    const result = await renderFinalPrompt({
      currentChar: makeChar(),
      unformated,
      promptTemplate: template,
      usingPromptTemplate: true,
      formatOrder: DEFAULT_FORMAT_ORDER,
      memories: [],
      positionParser: passThrough,
      hasCachePoint: false,
      isContinue: false,
    })

    expect(result.formated).toEqual([])
  })
})

describe('renderFinalPrompt - cache points', () => {
  it('automatic walk-back marks last 3 user rows when hasCachePoint=false', async () => {
    seedDb({ automaticCachePoint: true })
    const unformated = emptyUnformated()
    unformated.chats = [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'u3' },
      { role: 'user', content: 'u4' },
    ]
    const template: PromptItem[] = [{ type: 'chat', rangeStart: 0, rangeEnd: 'end' }]

    const result = await renderFinalPrompt({
      currentChar: makeChar(),
      unformated,
      promptTemplate: template,
      usingPromptTemplate: true,
      formatOrder: DEFAULT_FORMAT_ORDER,
      memories: [],
      positionParser: passThrough,
      hasCachePoint: false,
      isContinue: false,
    })

    const cachePointed = result.formated.filter((c) => c.cachePoint === true).map((c) => c.content)
    // Walks back 3 user-role rows; .filter preserves original array order.
    expect(cachePointed).toEqual(['u2', 'u3', 'u4'])
  })

  it('automatic walk-back is suppressed when hasCachePoint=true', async () => {
    seedDb({ automaticCachePoint: true })
    const unformated = emptyUnformated()
    unformated.chats = [
      { role: 'user', content: 'u1' },
      { role: 'user', content: 'u2' },
    ]
    const template: PromptItem[] = [{ type: 'chat', rangeStart: 0, rangeEnd: 'end' }]

    const result = await renderFinalPrompt({
      currentChar: makeChar(),
      unformated,
      promptTemplate: template,
      usingPromptTemplate: true,
      formatOrder: DEFAULT_FORMAT_ORDER,
      memories: [],
      positionParser: passThrough,
      hasCachePoint: true,
      isContinue: false,
    })

    expect(result.formated.every((c) => c.cachePoint === undefined)).toBe(true)
  })

  it('explicit cache card with role=all walks back depth across all roles', async () => {
    seedDb()
    const unformated = emptyUnformated()
    unformated.chats = [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
    ]
    const template: PromptItem[] = [
      { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
      { type: 'cache', name: 'all2', depth: 2, role: 'all' },
    ]

    const result = await renderFinalPrompt({
      currentChar: makeChar(),
      unformated,
      promptTemplate: template,
      usingPromptTemplate: true,
      formatOrder: DEFAULT_FORMAT_ORDER,
      memories: [],
      positionParser: passThrough,
      hasCachePoint: true,
      isContinue: false,
    })

    const cachePointed = result.formated.filter((c) => c.cachePoint === true).map((c) => c.content)
    // depth=2 walks back 2 entries (a1, u2 from the tail); .filter preserves array order.
    expect(cachePointed).toEqual(['a1', 'u2'])
  })
})

describe('renderFinalPrompt - depth_prompt splice', () => {
  it('splices a system row at length - depth', async () => {
    seedDb()
    const unformated = emptyUnformated()
    unformated.chats = [
      { role: 'user', content: 'u1' },
      { role: 'user', content: 'u2' },
      { role: 'user', content: 'u3' },
    ]
    const char = makeChar({
      depth_prompt: { depth: 1, prompt: 'inserted' },
    } as Partial<character>)
    const template: PromptItem[] = [{ type: 'chat', rangeStart: 0, rangeEnd: 'end' }]

    const result = await renderFinalPrompt({
      currentChar: char,
      unformated,
      promptTemplate: template,
      usingPromptTemplate: true,
      formatOrder: DEFAULT_FORMAT_ORDER,
      memories: [],
      positionParser: passThrough,
      hasCachePoint: false,
      isContinue: false,
    })

    // Spliced at length - 1 (between u2 and u3).
    expect(result.formated.map((c) => c.content)).toEqual(['u1', 'u2', 'inserted', 'u3'])
  })
})

describe('renderFinalPrompt - editRequest trigger', () => {
  it('pass-through preserves the formated array', async () => {
    seedDb()
    triggerState.mutate = false
    const unformated = emptyUnformated()
    unformated.main.push({ role: 'system', content: 'M' })

    const result = await renderFinalPrompt({
      currentChar: makeChar(),
      unformated,
      promptTemplate: null,
      usingPromptTemplate: false,
      formatOrder: DEFAULT_FORMAT_ORDER,
      memories: [],
      positionParser: passThrough,
      hasCachePoint: false,
      isContinue: false,
    })

    expect(result.formated.map((c) => c.content)).toEqual(['M'])
    // Without info capture, only the formated array goes through.
    expect(triggerState.calls).toEqual([{ mode: 'editRequest', length: 1 }])
  })

  it('mutation reaches the returned formated', async () => {
    seedDb()
    triggerState.mutate = true
    const unformated = emptyUnformated()
    unformated.main.push({ role: 'system', content: 'M' })

    const result = await renderFinalPrompt({
      currentChar: makeChar(),
      unformated,
      promptTemplate: null,
      usingPromptTemplate: false,
      formatOrder: DEFAULT_FORMAT_ORDER,
      memories: [],
      positionParser: passThrough,
      hasCachePoint: false,
      isContinue: false,
    })

    expect(result.formated.map((c) => c.content)).toEqual(['M', '__trigger__'])
  })
})

describe('renderFinalPrompt - prompt-info text capture', () => {
  it('captures innerFormat for persona/description/authornote and rendered text for plain', async () => {
    seedDb({ promptInfoInsideChat: true, promptTextInfoInsideChat: true })
    testDatabaseState.db.promptInfoInsideChat = true
    testDatabaseState.db.promptTextInfoInsideChat = true

    const unformated = emptyUnformated()
    unformated.personaPrompt.push({ role: 'system', content: 'I am curious.' })
    unformated.description.push({ role: 'system', content: 'A bot.' })
    unformated.authorNote.push({ role: 'system', content: '' })

    const template: PromptItem[] = [
      { type: 'persona', innerFormat: 'Persona: {{slot}}' },
      { type: 'description', innerFormat: 'Desc: {{slot}}' },
      { type: 'authornote', innerFormat: 'Note: {{slot}}', defaultText: 'none' },
      { type: 'plain', text: 'Be concise.', role: 'system', type2: 'normal' },
    ]

    const result = await renderFinalPrompt({
      currentChar: makeChar(),
      unformated,
      promptTemplate: template,
      usingPromptTemplate: true,
      formatOrder: DEFAULT_FORMAT_ORDER,
      memories: [],
      positionParser: passThrough,
      hasCachePoint: false,
      isContinue: false,
    })

    expect(result.promptText).toBeDefined()
    expect(result.promptText!.map((c) => c.content)).toEqual([
      'Persona: {{slot}}',
      'Desc: {{slot}}',
      'Note: {{slot}}',
      'Be concise.',
    ])
    // Both `formated` and `promptText` go through editRequest.
    expect(triggerState.calls).toHaveLength(2)
    expect(triggerState.calls[0].mode).toBe('editRequest')
    expect(triggerState.calls[1].mode).toBe('editRequest')
  })

  it('does not set promptText when either flag is off', async () => {
    seedDb({ promptInfoInsideChat: true, promptTextInfoInsideChat: false })
    testDatabaseState.db.promptInfoInsideChat = true
    testDatabaseState.db.promptTextInfoInsideChat = false

    const unformated = emptyUnformated()
    unformated.personaPrompt.push({ role: 'system', content: 'I am curious.' })
    const template: PromptItem[] = [{ type: 'persona', innerFormat: 'Persona: {{slot}}' }]

    const result = await renderFinalPrompt({
      currentChar: makeChar(),
      unformated,
      promptTemplate: template,
      usingPromptTemplate: true,
      formatOrder: DEFAULT_FORMAT_ORDER,
      memories: [],
      positionParser: passThrough,
      hasCachePoint: false,
      isContinue: false,
    })

    expect(result.promptText).toBeUndefined()
    // Only formated goes through editRequest.
    expect(triggerState.calls).toEqual([{ mode: 'editRequest', length: 1 }])
  })

  it('plain card with type2=globalNote does NOT push into promptText', async () => {
    seedDb({ promptInfoInsideChat: true, promptTextInfoInsideChat: true })
    testDatabaseState.db.promptInfoInsideChat = true
    testDatabaseState.db.promptTextInfoInsideChat = true

    const unformated = emptyUnformated()
    const template: PromptItem[] = [
      { type: 'plain', text: 'GLOBAL', role: 'system', type2: 'globalNote' },
      { type: 'plain', text: 'NORMAL', role: 'system', type2: 'normal' },
    ]

    const result = await renderFinalPrompt({
      currentChar: makeChar(),
      unformated,
      promptTemplate: template,
      usingPromptTemplate: true,
      formatOrder: DEFAULT_FORMAT_ORDER,
      memories: [],
      positionParser: passThrough,
      hasCachePoint: false,
      isContinue: false,
    })

    expect(result.promptText!.map((c) => c.content)).toEqual(['NORMAL'])
  })
})
