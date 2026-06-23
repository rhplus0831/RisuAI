import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Database, character } from '../../../src/ts/storage/database.svelte'
import type { PromptItem } from '../../../src/ts/process/prompt'
import type { OpenAIChat } from '../../../src/ts/process/index.svelte'
import {
  buildFormatOrder,
  coalesceRows,
  createStableCardRenderCache,
  normalizeTemplate,
  renderByFormatOrder,
  renderByTemplate,
  renderFinalPrompt,
  type FormatOrderKey,
  type UnformatedPromptSlots,
} from '../src/prompt/templates.js'
import { bootPromptVariables } from '../src/prompt/promptVariablesBoot.js'
import { preflightTemplateTokens } from '../src/prompt/preflight.js'
import type { ExpandContext } from '../src/prompt/variables.js'
import * as promptVariables from '../src/prompt/variables.js'

beforeAll(() => {
  bootPromptVariables()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function ctxFor(db: Database): ExpandContext {
  return { database: db }
}

function makeDatabase(overrides: Partial<Database> = {}): Database {
  return {
    aiModel: 'gpt4',
    currentChar: 0,
    characters: [makeCharacter()],
    formatingOrder: [
      'main',
      'description',
      'personaPrompt',
      'chats',
      'lastChat',
      'jailbreak',
      'lorebook',
      'globalNote',
      'authorNote',
    ],
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
    chaId: 'char-tess',
    utilityBot: false,
    ...overrides,
  } as unknown as character
}

function makeSlots(overrides: Partial<UnformatedPromptSlots> = {}): UnformatedPromptSlots {
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

const row = (overrides: Partial<OpenAIChat>): OpenAIChat =>
  ({ role: 'system', content: 'x', ...overrides }) as OpenAIChat

describe('Phase 7-10a normalizeTemplate', () => {
  it('returns null / false when no template is set', () => {
    const db = makeDatabase({ promptTemplate: undefined })
    const result = normalizeTemplate(db, makeCharacter())
    expect(result.promptTemplate).toBeNull()
    expect(result.usingPromptTemplate).toBe(false)
  })

  it('appends an implicit postEverything and leaves the source unmutated', () => {
    const source: PromptItem[] = [{ type: 'description' }]
    const db = makeDatabase({ promptTemplate: source })
    const result = normalizeTemplate(db, makeCharacter())
    expect(result.usingPromptTemplate).toBe(true)
    expect(result.promptTemplate?.map((c) => c.type)).toEqual(['description', 'postEverything'])
    // The stored template is cloned, not mutated.
    expect(source).toHaveLength(1)
  })

  it('does not double-append when postEverything already exists', () => {
    const db = makeDatabase({
      promptTemplate: [{ type: 'description' }, { type: 'postEverything' }],
    })
    const result = normalizeTemplate(db, makeCharacter())
    expect(result.promptTemplate?.filter((c) => c.type === 'postEverything')).toHaveLength(1)
  })

  it('swaps in the utility-bot forced template when not overridden', () => {
    const db = makeDatabase({ promptTemplate: [{ type: 'description' }] })
    const result = normalizeTemplate(db, makeCharacter({ utilityBot: true }))
    expect(result.usingPromptTemplate).toBe(true)
    expect(result.promptTemplate?.map((c) => c.type)).toEqual([
      'plain',
      'description',
      'lorebook',
      'chat',
      'plain',
      'postEverything',
    ])
  })

  it('keeps the user template for a utility bot when utilOverride is set', () => {
    const db = makeDatabase({
      promptTemplate: [{ type: 'description' }],
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: '',
        sendChatAsSystem: false,
        sendName: false,
        utilOverride: true,
        customChainOfThought: false,
        maxThoughtTagDepth: -1,
        trimStartNewChat: false,
      },
    } as Partial<Database>)
    const result = normalizeTemplate(db, makeCharacter({ utilityBot: true }))
    expect(result.promptTemplate?.map((c) => c.type)).toEqual(['description', 'postEverything'])
  })

  it('uses the selected global prompt preset instead of stale top-level or legacy bot preset templates', () => {
    const db = makeDatabase({
      promptTemplate: [{ type: 'plain', text: 'stale top-level', role: 'system', type2: 'main' }],
      promptPresets: [
        {
          id: 'modern-prompt',
          name: 'Modern Prompt',
          promptTemplate: [{ type: 'description' }],
        },
      ],
      promptPresetsId: 0,
      botPresets: [
        {
          id: 'legacy-bot',
          name: 'Legacy Bot',
          promptTemplate: [{ type: 'lorebook' }],
        },
      ],
      botPresetsId: 0,
    } as Partial<Database>)

    const result = normalizeTemplate(db, makeCharacter())

    expect(result.usingPromptTemplate).toBe(true)
    expect(result.promptTemplate?.map((c) => c.type)).toEqual(['description', 'postEverything'])
  })

  it('treats a selected global prompt preset without promptTemplate as disabled instead of falling back', () => {
    const db = makeDatabase({
      promptTemplate: [{ type: 'description' }],
      promptPresets: [{ id: 'plain-prompt', name: 'Plain Prompt' }],
      promptPresetsId: 0,
    } as Partial<Database>)

    const result = normalizeTemplate(db, makeCharacter())

    expect(result.promptTemplate).toBeNull()
    expect(result.usingPromptTemplate).toBe(false)
  })

  it('uses the chat-scoped prompt preset before global prompt preset and stale top-level templates', () => {
    const db = makeDatabase({
      promptTemplate: [{ type: 'plain', text: 'stale top-level', role: 'system', type2: 'main' }],
      promptPresets: [
        {
          id: 'global-prompt',
          name: 'Global Prompt',
          promptTemplate: [{ type: 'description' }],
        },
        {
          id: 'chat-prompt',
          name: 'Chat Prompt',
          promptTemplate: [{ type: 'lorebook' }],
        },
      ],
      promptPresetsId: 0,
    } as Partial<Database>)

    const result = normalizeTemplate(db, makeCharacter(), { chatPromptPresetId: 'chat-prompt' })

    expect(result.usingPromptTemplate).toBe(true)
    expect(result.promptTemplate?.map((c) => c.type)).toEqual(['lorebook', 'postEverything'])
  })

  it('does not fall back when a chat-scoped prompt preset resolves without promptTemplate', () => {
    const db = makeDatabase({
      promptTemplate: [{ type: 'description' }],
      promptPresets: [
        {
          id: 'global-prompt',
          name: 'Global Prompt',
          promptTemplate: [{ type: 'lorebook' }],
        },
        { id: 'chat-prompt', name: 'Chat Prompt' },
      ],
      promptPresetsId: 0,
    } as Partial<Database>)

    const result = normalizeTemplate(db, makeCharacter(), { chatPromptPresetId: 'chat-prompt' })

    expect(result.promptTemplate).toBeNull()
    expect(result.usingPromptTemplate).toBe(false)
  })

  it('does not mutate preset-owned promptTemplate when adding implicit postEverything', () => {
    const presetTemplate: PromptItem[] = [{ type: 'description' }]
    const db = makeDatabase({
      promptPresets: [
        {
          id: 'modern-prompt',
          name: 'Modern Prompt',
          promptTemplate: presetTemplate,
        },
      ],
      promptPresetsId: 0,
    } as Partial<Database>)

    const result = normalizeTemplate(db, makeCharacter())

    expect(result.promptTemplate?.map((c) => c.type)).toEqual(['description', 'postEverything'])
    expect(db.promptPresets[0].promptTemplate).toEqual([{ type: 'description' }])
  })
})

describe('Phase 7-10a buildFormatOrder', () => {
  it('clones formatingOrder and appends postEverything without mutating the source', () => {
    const db = makeDatabase()
    const before = [...(db.formatingOrder as FormatOrderKey[])]
    const order = buildFormatOrder(db)
    expect(order).toEqual([...before, 'postEverything'])
    expect(db.formatingOrder).toEqual(before)
  })
})

describe('Phase 7-10a coalesceRows', () => {
  it('drops empty / whitespace rows but keeps a multimodal row with empty content', () => {
    const out: OpenAIChat[] = []
    coalesceRows(
      out,
      [
        row({ content: '   ' }),
        row({ role: 'user', content: 'hi' }),
        row({ content: '', multimodals: [{ type: 'image' }] as never }),
      ],
      'gpt4',
    )
    expect(out.map((r) => r.content)).toEqual(['hi', ''])
  })

  it('merges consecutive same-memo/name system rows on a coalescing model', () => {
    const out: OpenAIChat[] = []
    coalesceRows(
      out,
      [
        row({ content: 'a', memo: 'm', name: 'n' }),
        row({ content: 'b', memo: 'm', name: 'n' }),
        row({ content: 'c', memo: 'other' }),
      ],
      'gpt4',
    )
    expect(out).toHaveLength(2)
    expect(out[0].content).toBe('a\n\nb')
    expect(out[1].content).toBe('c')
  })

  it('does not merge a non-system row between two system rows', () => {
    const out: OpenAIChat[] = []
    coalesceRows(
      out,
      [row({ content: 'a', memo: 'm' }), row({ role: 'user', content: 'u' }), row({ content: 'b', memo: 'm' })],
      'gpt4',
    )
    expect(out.map((r) => r.content)).toEqual(['a', 'u', 'b'])
  })

  it('pushes every row verbatim on a non-coalescing model', () => {
    const out: OpenAIChat[] = []
    coalesceRows(out, [row({ content: 'a', memo: 'm' }), row({ content: 'b', memo: 'm' })], 'ollama')
    expect(out.map((r) => r.content)).toEqual(['a', 'b'])
  })
})

describe('Phase 7-10a renderByFormatOrder', () => {
  it('walks the format order and coalesces each slot in order', () => {
    const unformated = makeSlots({
      main: [row({ content: 'main', memo: 'main' })],
      description: [row({ content: 'desc', memo: 'desc' })],
      chats: [row({ role: 'user', content: 'hello' })],
      postEverything: [row({ content: 'post', memo: 'post' })],
    })
    const order: FormatOrderKey[] = ['main', 'description', 'chats', 'postEverything']
    const out = renderByFormatOrder(unformated, order, 'gpt4')
    expect(out.map((r) => r.content)).toEqual(['main', 'desc', 'hello', 'post'])
  })
})

describe('Phase 7-10b content cards (renderByTemplate)', () => {
  const tpl = (cards: PromptItem[]): PromptItem[] => cards

  it('wraps description / persona rows via innerFormat {{slot}}', () => {
    const db = makeDatabase()
    const unformated = makeSlots({
      description: [row({ role: 'system', content: 'hello' })],
    })
    const { formated: out } = renderByTemplate(
      ctxFor(db),
      makeCharacter(),
      unformated,
      tpl([{ type: 'description', innerFormat: 'Desc: {{slot}}' }]),
      true,
    )
    expect(out.map((r) => r.content)).toEqual(['Desc: hello'])
  })

  it('falls back to authornote defaultText when the slot is empty', () => {
    const db = makeDatabase()
    const unformated = makeSlots({
      authorNote: [row({ role: 'system', content: '' })],
    })
    const { formated: out } = renderByTemplate(
      ctxFor(db),
      makeCharacter(),
      unformated,
      tpl([{ type: 'authornote', innerFormat: 'AN: {{slot}}', defaultText: 'fallback' }]),
      true,
    )
    expect(out.map((r) => r.content)).toEqual(['AN: fallback'])
  })

  it('renders a plain/main card and maps bot role to assistant', () => {
    const db = makeDatabase()
    const { formated: out } = renderByTemplate(
      ctxFor(db),
      makeCharacter(),
      makeSlots(),
      tpl([{ type: 'plain', type2: 'main', text: 'system line', role: 'system' }]),
      true,
    )
    expect(out).toEqual([{ role: 'system', content: 'system line' }])

    const { formated: botOut } = renderByTemplate(
      ctxFor(db),
      makeCharacter(),
      makeSlots(),
      tpl([{ type: 'plain', type2: 'normal', text: 'bot line', role: 'bot' }]),
      true,
    )
    expect(botOut[0].role).toBe('assistant')
  })

  it('applies replaceGlobalNote ({{original}}) on a globalNote card', () => {
    const db = makeDatabase()
    const { formated: out } = renderByTemplate(
      ctxFor(db),
      makeCharacter({ replaceGlobalNote: '[[{{original}}]]' }),
      makeSlots(),
      tpl([{ type: 'plain', type2: 'globalNote', text: 'note', role: 'system' }]),
      true,
    )
    expect(out[0].content).toBe('[[note]]')
  })

  it('appends prebuiltAssetCommand on a globalNote card when the char opts in', () => {
    const db = makeDatabase()
    const { formated: out } = renderByTemplate(
      ctxFor(db),
      makeCharacter({ prebuiltAssetCommand: true } as Partial<character>),
      makeSlots(),
      tpl([{ type: 'plain', type2: 'globalNote', text: 'note', role: 'system' }]),
      true,
    )
    expect(out[0].content).toContain('note')
    expect(out[0].content).toContain('Image Tag Instruction')
  })

  it('drops jailbreak / cot cards unless their db toggles are on', () => {
    const off = makeDatabase({ jailbreakToggle: false, chainOfThought: false } as Partial<Database>)
    const cards = tpl([
      { type: 'jailbreak', type2: 'normal', text: 'jb', role: 'system' },
      { type: 'cot', type2: 'normal', text: 'cot', role: 'system' },
    ])
    expect(renderByTemplate(ctxFor(off), makeCharacter(), makeSlots(), cards, true).formated).toEqual([])

    const on = makeDatabase({ jailbreakToggle: true, chainOfThought: true } as Partial<Database>)
    const { formated: out } = renderByTemplate(ctxFor(on), makeCharacter(), makeSlots(), cards, true)
    // Two consecutive memo-less system rows coalesce on gpt4.
    expect(out).toHaveLength(1)
    expect(out[0].content).toBe('jb\n\ncot')
  })

  it('pushes the lorebook slot and appends postEndInnerFormat on postEverything', () => {
    const db = makeDatabase({
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: 'END',
        sendChatAsSystem: false,
        sendName: false,
        utilOverride: false,
        customChainOfThought: false,
        maxThoughtTagDepth: -1,
        trimStartNewChat: false,
      },
    } as Partial<Database>)
    const unformated = makeSlots({
      lorebook: [row({ role: 'system', content: 'lore', memo: 'l' })],
      postEverything: [row({ role: 'system', content: 'post', memo: 'p' })],
    })
    const { formated: out } = renderByTemplate(
      ctxFor(db),
      makeCharacter(),
      unformated,
      tpl([{ type: 'lorebook' }, { type: 'postEverything' }]),
      true,
    )
    expect(out.map((r) => r.content)).toEqual(['lore', 'post', 'END'])
  })

  it('splits a chatML card into role-tagged rows', () => {
    const db = makeDatabase()
    const { formated: out } = renderByTemplate(
      ctxFor(db),
      makeCharacter(),
      makeSlots(),
      tpl([
        {
          type: 'chatML',
          text: '<|im_start|>system<|im_sep|>sys<|im_end|><|im_start|>user<|im_sep|>hi<|im_end|>',
        },
      ]),
      true,
    )
    expect(out.map((r) => ({ role: r.role, content: r.content }))).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ])
  })

  it('applies the injected positionParser to card text', () => {
    const db = makeDatabase()
    const { formated: out } = renderByTemplate(
      ctxFor(db),
      makeCharacter(),
      makeSlots(),
      tpl([{ type: 'plain', type2: 'main', text: 'abc', role: 'system' }]),
      true,
      (text) => text.toUpperCase(),
    )
    expect(out[0].content).toBe('ABC')
  })
})

describe('Phase 7-10c chat cards', () => {
  const chatSlots = (): UnformatedPromptSlots =>
    makeSlots({
      chats: [
        row({ role: 'user', content: 'u0', memo: '0' }),
        row({ role: 'assistant', content: 'a1', memo: '1' }),
        row({ role: 'user', content: 'u2', memo: '2' }),
      ],
    })

  const renderChat = (db: Database, card: PromptItem, unformated = chatSlots(), char = makeCharacter()): OpenAIChat[] =>
    renderByTemplate(ctxFor(db), char, unformated, [card], true).formated

  it('emits the full chat for rangeEnd "end"', () => {
    const out = renderChat(makeDatabase(), { type: 'chat', rangeStart: 0, rangeEnd: 'end' })
    expect(out.map((r) => r.content)).toEqual(['u0', 'a1', 'u2'])
  })

  it('slices an explicit numeric range', () => {
    const out = renderChat(makeDatabase(), { type: 'chat', rangeStart: 1, rangeEnd: 2 })
    expect(out.map((r) => r.content)).toEqual(['a1'])
  })

  it('treats the -1000 sentinel as the whole chat', () => {
    const out = renderChat(makeDatabase(), { type: 'chat', rangeStart: -1000, rangeEnd: 0 })
    expect(out.map((r) => r.content)).toEqual(['u0', 'a1', 'u2'])
  })

  it('resolves negative offsets from the end', () => {
    const out = renderChat(makeDatabase(), { type: 'chat', rangeStart: -2, rangeEnd: 'end' })
    expect(out.map((r) => r.content)).toEqual(['a1', 'u2'])
  })

  it('emits nothing when start >= end', () => {
    const out = renderChat(makeDatabase(), { type: 'chat', rangeStart: 2, rangeEnd: 1 })
    expect(out).toEqual([])
  })

  it('systemizes chat rows when sendChatAsSystem is on', () => {
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
      },
    } as Partial<Database>)
    const out = renderChat(db, { type: 'chat', rangeStart: 0, rangeEnd: 'end' })
    // user/assistant rows folded into system rows, then coalesced.
    expect(out).toHaveLength(1)
    expect(out[0].role).toBe('system')
    expect(out[0].content).toBe('user: u0\n\nassistant: a1\n\nuser: u2')
  })

  it('honors chatAsOriginalOnSystem (no systemizing)', () => {
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
      },
    } as Partial<Database>)
    const out = renderChat(db, {
      type: 'chat',
      rangeStart: 0,
      rangeEnd: 'end',
      chatAsOriginalOnSystem: true,
    })
    expect(out.map((r) => r.role)).toEqual(['user', 'assistant', 'user'])
  })

  it('folds example_ names instead of the role when systemizing', () => {
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
      },
    } as Partial<Database>)
    const unformated = makeSlots({
      chats: [row({ role: 'user', content: 'hi', name: 'example_user', memo: 'e' })],
    })
    const out = renderChat(db, { type: 'chat', rangeStart: 0, rangeEnd: 'end' }, unformated)
    expect(out[0].content).toBe('example_user: hi')
  })

  it('does not mutate the source chats when systemizing (clone divergence)', () => {
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
      },
    } as Partial<Database>)
    const unformated = chatSlots()
    renderChat(db, { type: 'chat', rangeStart: 0, rangeEnd: 'end' }, unformated)
    expect(unformated.chats.map((r) => r.role)).toEqual(['user', 'assistant', 'user'])
    expect(unformated.chats[0].content).toBe('u0')
  })
})

describe('Phase 7-10d memory cards', () => {
  const mem = (): OpenAIChat[] => [row({ role: 'assistant', content: 'm0' }), row({ role: 'assistant', content: 'm1' })]

  it('clones the injected memories and passes them through unwrapped', () => {
    const { formated: out } = renderByTemplate(
      ctxFor(makeDatabase()),
      makeCharacter(),
      makeSlots(),
      [{ type: 'memory' }],
      true,
      undefined,
      mem(),
    )
    expect(out.map((r) => r.content)).toEqual(['m0', 'm1'])
  })

  it('wraps each memory row via innerFormat {{slot}}', () => {
    const { formated: out } = renderByTemplate(
      ctxFor(makeDatabase()),
      makeCharacter(),
      makeSlots(),
      [{ type: 'memory', innerFormat: 'Mem: {{slot}}' }],
      true,
      undefined,
      mem(),
    )
    expect(out.map((r) => r.content)).toEqual(['Mem: m0', 'Mem: m1'])
  })

  it('does NOT run positionParser on the memory innerFormat', () => {
    const { formated: out } = renderByTemplate(
      ctxFor(makeDatabase()),
      makeCharacter(),
      makeSlots(),
      [{ type: 'memory', innerFormat: 'mem: {{slot}}' }],
      true,
      (text) => text.toUpperCase(),
      mem(),
    )
    // positionParser would have uppercased the wrapper to "MEM:".
    expect(out.map((r) => r.content)).toEqual(['mem: m0', 'mem: m1'])
  })

  it('does not mutate the injected memories source', () => {
    const memories = mem()
    renderByTemplate(
      ctxFor(makeDatabase()),
      makeCharacter(),
      makeSlots(),
      [{ type: 'memory', innerFormat: 'Mem: {{slot}}' }],
      true,
      undefined,
      memories,
    )
    expect(memories.map((r) => r.content)).toEqual(['m0', 'm1'])
  })

  it('emits nothing for a memory card with no injected memories', () => {
    const { formated: out } = renderByTemplate(
      ctxFor(makeDatabase()),
      makeCharacter(),
      makeSlots(),
      [{ type: 'memory', innerFormat: 'Mem: {{slot}}' }],
      true,
    )
    expect(out).toEqual([])
  })
})

describe('Phase 7-10d cache markers', () => {
  const slotsWithChat = (): UnformatedPromptSlots =>
    makeSlots({
      chats: [
        row({ role: 'user', content: 'u0' }),
        row({ role: 'assistant', content: 'a1' }),
        row({ role: 'user', content: 'u2' }),
        row({ role: 'assistant', content: 'a3' }),
        row({ role: 'user', content: 'u4' }),
      ],
    })

  const chatCard: PromptItem = { type: 'chat', rangeStart: 0, rangeEnd: 'end' }

  const cachePoints = (out: OpenAIChat[]): string[] => out.filter((r) => r.cachePoint).map((r) => r.content)

  it('marks up to `depth` rows whose role matches the cache card', () => {
    const { formated: out } = renderByTemplate(
      ctxFor(makeDatabase()),
      makeCharacter(),
      slotsWithChat(),
      [chatCard, { type: 'cache', name: 'c', depth: 2, role: 'user' }],
      true,
    )
    // Walks from the end: u4, u2 are the last two user rows.
    expect(cachePoints(out)).toEqual(['u2', 'u4'])
  })

  it('treats role "all" as any role and stops at `depth`', () => {
    const { formated: out } = renderByTemplate(
      ctxFor(makeDatabase()),
      makeCharacter(),
      slotsWithChat(),
      [chatCard, { type: 'cache', name: 'c', depth: 3, role: 'all' }],
      true,
    )
    expect(cachePoints(out)).toEqual(['u2', 'a3', 'u4'])
  })

  it('automatic cache point marks the last 3 user rows after a chat card', () => {
    const { formated: out } = renderByTemplate(
      ctxFor(makeDatabase({ automaticCachePoint: true } as Partial<Database>)),
      makeCharacter(),
      slotsWithChat(),
      [chatCard],
      true,
    )
    expect(cachePoints(out)).toEqual(['u0', 'u2', 'u4'])
  })

  it('does not auto-mark when automaticCachePoint is off', () => {
    const { formated: out } = renderByTemplate(
      ctxFor(makeDatabase()),
      makeCharacter(),
      slotsWithChat(),
      [chatCard],
      true,
    )
    expect(cachePoints(out)).toEqual([])
  })

  it('suppresses the automatic walk-back when an explicit cache card is present', () => {
    const { formated: out } = renderByTemplate(
      ctxFor(makeDatabase({ automaticCachePoint: true } as Partial<Database>)),
      makeCharacter(),
      slotsWithChat(),
      [chatCard, { type: 'cache', name: 'c', depth: 1, role: 'user' }],
      true,
    )
    // Only the explicit cache card fires (last user row), not the 3-deep walk-back.
    expect(cachePoints(out)).toEqual(['u4'])
  })
})

describe('Phase 7-10e prompt-info capture', () => {
  const captureDb = (): Database =>
    makeDatabase({
      promptInfoInsideChat: true,
      promptTextInfoInsideChat: true,
    } as Partial<Database>)

  it('captures the raw innerFormat per row for persona / description / authornote', () => {
    const unformated = makeSlots({
      description: [row({ role: 'system', content: 'hello' })],
      personaPrompt: [row({ role: 'user', content: 'p' })],
      authorNote: [row({ role: 'assistant', content: 'an' })],
    })
    const { formated, promptInfo } = renderByTemplate(
      ctxFor(captureDb()),
      makeCharacter(),
      unformated,
      [
        { type: 'description', innerFormat: 'D: {{slot}}' },
        { type: 'persona', innerFormat: 'P: {{slot}}' },
        { type: 'authornote', innerFormat: 'A: {{slot}}' },
      ],
      true,
    )
    // The rendered rows still expand `{{slot}}`...
    expect(formated.map((r) => r.content)).toEqual(['D: hello', 'P: p', 'A: an'])
    // ...while the info rows carry the raw innerFormat with the row's role.
    expect(promptInfo).toEqual([
      { role: 'system', content: 'D: {{slot}}' },
      { role: 'user', content: 'P: {{slot}}' },
      { role: 'assistant', content: 'A: {{slot}}' },
    ])
  })

  it('does not capture when a card has no innerFormat', () => {
    const unformated = makeSlots({
      description: [row({ role: 'system', content: 'hello' })],
    })
    const { promptInfo } = renderByTemplate(
      ctxFor(captureDb()),
      makeCharacter(),
      unformated,
      [{ type: 'description' }],
      true,
    )
    expect(promptInfo).toEqual([])
  })

  it('captures a plain card parsed content but excludes globalNote', () => {
    const { formated, promptInfo } = renderByTemplate(
      ctxFor(captureDb()),
      makeCharacter(),
      makeSlots(),
      [
        { type: 'plain', type2: 'main', text: 'hello-main', role: 'system' },
        { type: 'plain', type2: 'globalNote', text: 'gn', role: 'system' },
      ],
      true,
    )
    // Both rows render (the two system rows coalesce on a gpt model)...
    expect(formated.map((r) => r.content)).toEqual(['hello-main\n\ngn'])
    // ...but only the non-globalNote card is captured.
    expect(promptInfo).toEqual([{ role: 'system', content: 'hello-main' }])
  })

  it('captures the raw innerFormat per row for a memory card', () => {
    const { promptInfo } = renderByTemplate(
      ctxFor(captureDb()),
      makeCharacter(),
      makeSlots(),
      [{ type: 'memory', innerFormat: 'M: {{slot}}' }],
      true,
      undefined,
      [row({ role: 'assistant', content: 'm0' })],
    )
    expect(promptInfo).toEqual([{ role: 'assistant', content: 'M: {{slot}}' }])
  })

  it('skips an info row for a whitespace-only innerFormat', () => {
    const unformated = makeSlots({
      description: [row({ role: 'system', content: 'hello' })],
    })
    const { promptInfo } = renderByTemplate(
      ctxFor(captureDb()),
      makeCharacter(),
      unformated,
      [{ type: 'description', innerFormat: '   ' }],
      true,
    )
    expect(promptInfo).toEqual([])
  })

  it('leaves promptInfo undefined when the capture flags are off', () => {
    const unformated = makeSlots({
      description: [row({ role: 'system', content: 'hello' })],
    })
    const { promptInfo } = renderByTemplate(
      ctxFor(makeDatabase()),
      makeCharacter(),
      unformated,
      [{ type: 'description', innerFormat: 'D: {{slot}}' }],
      true,
    )
    expect(promptInfo).toBeUndefined()
  })
})

describe('Phase 7-10e content trim', () => {
  it('trims rendered row contents on the template path', () => {
    const { formated } = renderByTemplate(
      ctxFor(makeDatabase()),
      makeCharacter(),
      makeSlots(),
      [{ type: 'plain', type2: 'main', text: '  spaced  ', role: 'system' }],
      true,
    )
    expect(formated[0].content).toBe('spaced')
  })

  it('trims captured prompt-info row contents', () => {
    const unformated = makeSlots({
      description: [row({ role: 'system', content: 'hello' })],
    })
    const { promptInfo } = renderByTemplate(
      ctxFor(
        makeDatabase({
          promptInfoInsideChat: true,
          promptTextInfoInsideChat: true,
        } as Partial<Database>),
      ),
      makeCharacter(),
      unformated,
      [{ type: 'description', innerFormat: '  D: {{slot}}  ' }],
      true,
    )
    expect(promptInfo).toEqual([{ role: 'system', content: 'D: {{slot}}' }])
  })

  it('trims rendered row contents on the non-template path', () => {
    const out = renderByFormatOrder(makeSlots({ main: [row({ role: 'system', content: '  x  ' })] }), ['main'], 'gpt4')
    expect(out[0].content).toBe('x')
  })
})

describe('Phase 3 M3 stable template card cache', () => {
  const stableCards = (): PromptItem[] => [
    { type: 'plain', type2: 'main', text: 'plain {{user}}', role: 'system' },
    { type: 'jailbreak', type2: 'normal', text: 'jb {{user}}', role: 'system' },
    { type: 'cot', type2: 'normal', text: 'cot {{user}}', role: 'system' },
    {
      type: 'chatML',
      text: '<|im_start|>user<|im_sep|>ml {{user}}<|im_end|>',
    },
    { type: 'description', innerFormat: 'desc {{user}} {{slot}}' },
    { type: 'persona', innerFormat: 'persona {{user}} {{slot}}' },
    { type: 'authornote', innerFormat: 'author {{user}} {{slot}}' },
  ]

  const stableSlots = (): UnformatedPromptSlots =>
    makeSlots({
      description: [row({ role: 'system', content: 'DESC' })],
      personaPrompt: [row({ role: 'user', content: 'PERSONA' })],
      authorNote: [row({ role: 'assistant', content: 'NOTE' })],
    })

  const cacheDb = (overrides: Partial<Database> = {}): Database =>
    makeDatabase({
      username: 'Alex',
      jailbreakToggle: true,
      chainOfThought: true,
      ...overrides,
    } as Partial<Database>)

  it('renders stable template cards once across preflight and final render', () => {
    const db = cacheDb({
      promptInfoInsideChat: true,
      promptTextInfoInsideChat: true,
    } as Partial<Database>)
    const ctx = ctxFor(db)
    const currentChar = makeCharacter()
    const unformated = stableSlots()
    const template = stableCards()
    const stableCardCache = createStableCardRenderCache()
    const spy = vi.spyOn(promptVariables, 'expandVariables')

    preflightTemplateTokens({
      ctx,
      currentChar,
      unformated,
      promptTemplate: template,
      usingPromptTemplate: true,
      stableCardCache,
    })
    const rendered = renderByTemplate(
      ctx,
      currentChar,
      unformated,
      template,
      true,
      undefined,
      undefined,
      stableCardCache,
    )

    expect(rendered.formated.map((r) => r.content)).toEqual([
      'plain Alex\n\njb Alex\n\ncot Alex',
      'ml Alex',
      'desc Alex DESC',
      'persona Alex PERSONA',
      'author Alex NOTE',
    ])
    expect(rendered.promptInfo).toEqual([
      { role: 'system', content: 'plain Alex' },
      { role: 'system', content: 'jb Alex' },
      { role: 'system', content: 'cot Alex' },
      { role: 'system', content: 'desc Alex {{slot}}' },
      { role: 'user', content: 'persona Alex {{slot}}' },
      { role: 'assistant', content: 'author Alex {{slot}}' },
    ])

    const runVarCalls = (input: string): number =>
      spy.mock.calls.filter(
        ([value, expandCtx]) => value === input && (expandCtx as ExpandContext | undefined)?.runVar === true,
      ).length
    const promptInfoCalls = (input: string): number =>
      spy.mock.calls.filter(
        ([value, expandCtx]) => value === input && (expandCtx as ExpandContext | undefined)?.runVar !== true,
      ).length

    expect(runVarCalls('plain {{user}}')).toBe(1)
    expect(runVarCalls('jb {{user}}')).toBe(1)
    expect(runVarCalls('cot {{user}}')).toBe(1)
    expect(runVarCalls('ml {{user}}')).toBe(1)
    expect(runVarCalls('desc {{user}} {{slot}}')).toBe(1)
    expect(runVarCalls('persona {{user}} {{slot}}')).toBe(1)
    expect(runVarCalls('author {{user}} {{slot}}')).toBe(1)

    expect(promptInfoCalls('desc {{user}} {{slot}}')).toBe(1)
    expect(promptInfoCalls('persona {{user}} {{slot}}')).toBe(1)
    expect(promptInfoCalls('author {{user}} {{slot}}')).toBe(1)
  })

  it('keeps live chat, postEverything, memory, and cache cards outside the stable-card cache', () => {
    const db = cacheDb({ automaticCachePoint: true } as Partial<Database>)
    const ctx = ctxFor(db)
    const currentChar = makeCharacter()
    const unformated = makeSlots({
      postEverything: [row({ role: 'system', content: 'post-before' })],
    })
    const template: PromptItem[] = [
      { type: 'plain', type2: 'main', text: 'stable {{user}}', role: 'system' },
      { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
      { type: 'postEverything' },
      { type: 'memory', innerFormat: 'mem {{slot}}' },
      { type: 'cache', name: 'tail', depth: 1, role: 'assistant' },
    ]
    const stableCardCache = createStableCardRenderCache()

    preflightTemplateTokens({
      ctx,
      currentChar,
      unformated,
      promptTemplate: template,
      usingPromptTemplate: true,
      stableCardCache,
    })
    unformated.chats.push(row({ role: 'user', content: 'live-user' }))
    unformated.chats.push(row({ role: 'assistant', content: 'live-assistant' }))
    unformated.postEverything.push(row({ role: 'system', content: 'post-after' }))

    const { formated } = renderByTemplate(
      ctx,
      currentChar,
      unformated,
      template,
      true,
      undefined,
      [row({ role: 'assistant', content: 'live-memory' })],
      stableCardCache,
    )

    expect(formated.map((r) => r.content)).toEqual([
      'stable Alex',
      'live-user',
      'live-assistant',
      'post-before\n\npost-after',
      'mem live-memory',
    ])
    expect(formated.find((r) => r.content === 'mem live-memory')?.cachePoint).toBe(true)
  })

  it('clones cached rows before cache-card mutation', () => {
    const db = cacheDb()
    const ctx = ctxFor(db)
    const currentChar = makeCharacter()
    const stableCardCache = createStableCardRenderCache()
    const plain: PromptItem = {
      type: 'plain',
      type2: 'main',
      text: 'stable {{user}}',
      role: 'system',
    }

    const first = renderByTemplate(
      ctx,
      currentChar,
      makeSlots(),
      [plain, { type: 'cache', name: 'tail', depth: 1, role: 'system' }],
      true,
      undefined,
      undefined,
      stableCardCache,
    ).formated
    expect(first[0].cachePoint).toBe(true)

    const second = renderByTemplate(
      ctx,
      currentChar,
      makeSlots(),
      [plain],
      true,
      undefined,
      undefined,
      stableCardCache,
    ).formated
    expect(second).toEqual([{ role: 'system', content: 'stable Alex' }])
  })

  it('keeps prompt bytes identical with stable-card cache across template variants', async () => {
    const project = (result: Awaited<ReturnType<typeof renderFinalPrompt>>) => ({
      formated: result.formated,
      promptText: result.promptText,
    })

    const cases: Array<{
      name: string
      promptTemplate: PromptItem[] | null
      db: Partial<Database>
      formatOrder: FormatOrderKey[]
      slots: () => UnformatedPromptSlots
    }> = [
      {
        name: 'template automatic cache with jailbreak and cot',
        promptTemplate: [
          { type: 'plain', type2: 'main', text: 'main {{user}}', role: 'system' },
          { type: 'jailbreak', type2: 'normal', text: 'jb {{user}}', role: 'system' },
          { type: 'cot', type2: 'normal', text: 'cot {{user}}', role: 'system' },
          { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
        ],
        db: { automaticCachePoint: true, jailbreakToggle: true, chainOfThought: true },
        formatOrder: [],
        slots: () =>
          makeSlots({
            chats: [
              row({ role: 'user', content: 'u0' }),
              row({ role: 'assistant', content: 'a1' }),
              row({ role: 'user', content: 'u2' }),
            ],
          }),
      },
      {
        name: 'template explicit cache with prompt info',
        promptTemplate: [
          { type: 'plain', type2: 'main', text: 'main {{user}}', role: 'system' },
          { type: 'description', innerFormat: 'D {{user}} {{slot}}' },
          { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
          { type: 'cache', name: 'tail', depth: 1, role: 'user' },
        ],
        db: {
          automaticCachePoint: true,
          promptInfoInsideChat: true,
          promptTextInfoInsideChat: true,
        },
        formatOrder: [],
        slots: () =>
          makeSlots({
            description: [row({ role: 'system', content: 'DESC' })],
            chats: [row({ role: 'user', content: 'u0' }), row({ role: 'assistant', content: 'a1' })],
          }),
      },
      {
        name: 'template disabled jailbreak and cot',
        promptTemplate: [
          { type: 'jailbreak', type2: 'normal', text: 'jb {{user}}', role: 'system' },
          { type: 'cot', type2: 'normal', text: 'cot {{user}}', role: 'system' },
          { type: 'plain', type2: 'main', text: 'main {{user}}', role: 'system' },
        ],
        db: { jailbreakToggle: false, chainOfThought: false },
        formatOrder: [],
        slots: () => makeSlots(),
      },
      {
        name: 'non-template ignores stable cache',
        promptTemplate: null,
        db: {
          automaticCachePoint: true,
          promptInfoInsideChat: true,
          promptTextInfoInsideChat: true,
        },
        formatOrder: ['main', 'chats', 'postEverything'],
        slots: () =>
          makeSlots({
            main: [row({ role: 'system', content: 'main slot' })],
            chats: [row({ role: 'user', content: 'u0' })],
            postEverything: [row({ role: 'system', content: 'post' })],
          }),
      },
    ]

    for (const testCase of cases) {
      const render = async (withCache: boolean) => {
        const db = cacheDb(testCase.db)
        const ctx = ctxFor(db)
        const currentChar = makeCharacter()
        const unformated = testCase.slots()
        const stableCardCache = withCache ? createStableCardRenderCache() : undefined

        if (stableCardCache && testCase.promptTemplate) {
          preflightTemplateTokens({
            ctx,
            currentChar,
            unformated,
            promptTemplate: testCase.promptTemplate,
            usingPromptTemplate: true,
            stableCardCache,
          })
        }

        return renderFinalPrompt({
          ctx,
          currentChar,
          unformated,
          promptTemplate: testCase.promptTemplate,
          usingPromptTemplate: !!testCase.promptTemplate,
          formatOrder: testCase.formatOrder,
          stableCardCache,
        })
      }

      await expect(project(await render(true)), testCase.name).toEqual(project(await render(false)))
    }
  })
})

describe('Phase 7-10f renderFinalPrompt', () => {
  const chatTemplate: PromptItem[] = [{ type: 'chat', rangeStart: 0, rangeEnd: 'end' }]
  const chatRows = (): UnformatedPromptSlots =>
    makeSlots({
      chats: [
        row({ role: 'user', content: 'u0' }),
        row({ role: 'assistant', content: 'a1' }),
        row({ role: 'user', content: 'u2' }),
      ],
    })

  it('pushes [Continue the last response] on a supported model when isContinue', async () => {
    const { formated } = await renderFinalPrompt({
      ctx: ctxFor(makeDatabase({ aiModel: 'gpt4' } as Partial<Database>)),
      currentChar: makeCharacter(),
      unformated: makeSlots(),
      promptTemplate: [{ type: 'postEverything' }],
      usingPromptTemplate: true,
      formatOrder: [],
      isContinue: true,
    })
    expect(formated.map((r) => r.content)).toEqual(['[Continue the last response]'])
  })

  it('does not push the continue marker on an unsupported model', async () => {
    const { formated } = await renderFinalPrompt({
      ctx: ctxFor(makeDatabase({ aiModel: 'gemini' } as Partial<Database>)),
      currentChar: makeCharacter(),
      unformated: makeSlots(),
      promptTemplate: [{ type: 'postEverything' }],
      usingPromptTemplate: true,
      formatOrder: [],
      isContinue: true,
    })
    expect(formated).toEqual([])
  })

  it('does not push the continue marker when isContinue is false', async () => {
    const { formated } = await renderFinalPrompt({
      ctx: ctxFor(makeDatabase({ aiModel: 'gpt4' } as Partial<Database>)),
      currentChar: makeCharacter(),
      unformated: makeSlots(),
      promptTemplate: [{ type: 'postEverything' }],
      usingPromptTemplate: true,
      formatOrder: [],
    })
    expect(formated).toEqual([])
  })

  it('splices the character depth_prompt at length - depth', async () => {
    const { formated } = await renderFinalPrompt({
      ctx: ctxFor(makeDatabase()),
      currentChar: makeCharacter({ depth_prompt: { depth: 1, prompt: 'DP' } } as Partial<character>),
      unformated: chatRows(),
      promptTemplate: chatTemplate,
      usingPromptTemplate: true,
      formatOrder: [],
    })
    expect(formated.map((r) => r.content)).toEqual(['u0', 'a1', 'DP', 'u2'])
    expect(formated[2].role).toBe('system')
  })

  it('skips the depth_prompt splice when absent or empty', async () => {
    const noDepth = await renderFinalPrompt({
      ctx: ctxFor(makeDatabase()),
      currentChar: makeCharacter(),
      unformated: chatRows(),
      promptTemplate: chatTemplate,
      usingPromptTemplate: true,
      formatOrder: [],
    })
    expect(noDepth.formated.map((r) => r.content)).toEqual(['u0', 'a1', 'u2'])

    const emptyDepth = await renderFinalPrompt({
      ctx: ctxFor(makeDatabase()),
      currentChar: makeCharacter({ depth_prompt: { depth: 1, prompt: '' } } as Partial<character>),
      unformated: chatRows(),
      promptTemplate: chatTemplate,
      usingPromptTemplate: true,
      formatOrder: [],
    })
    expect(emptyDepth.formated.map((r) => r.content)).toEqual(['u0', 'a1', 'u2'])
  })

  it('applies the editRequest seam to both formated and promptText', async () => {
    const bang = (rows: OpenAIChat[]): OpenAIChat[] => rows.map((r) => ({ ...r, content: r.content + '!' }))
    const { formated, promptText } = await renderFinalPrompt({
      ctx: ctxFor(
        makeDatabase({
          promptInfoInsideChat: true,
          promptTextInfoInsideChat: true,
        } as Partial<Database>),
      ),
      currentChar: makeCharacter(),
      unformated: makeSlots({ description: [row({ role: 'system', content: 'hello' })] }),
      promptTemplate: [{ type: 'description', innerFormat: 'D: {{slot}}' }],
      usingPromptTemplate: true,
      formatOrder: [],
      editRequest: bang,
    })
    expect(formated).toEqual([{ role: 'system', content: 'D: hello!' }])
    expect(promptText).toEqual([{ role: 'system', content: 'D: {{slot}}!' }])
  })

  it('renders the non-template path with promptText undefined', async () => {
    const { formated, promptText } = await renderFinalPrompt({
      ctx: ctxFor(makeDatabase()),
      currentChar: makeCharacter({ depth_prompt: { depth: 1, prompt: 'DP' } } as Partial<character>),
      unformated: makeSlots({ main: [row({ role: 'system', content: 'm' })] }),
      promptTemplate: null,
      usingPromptTemplate: false,
      formatOrder: ['main'],
    })
    // depth_prompt still splices on the non-template path...
    expect(formated.map((r) => r.content)).toEqual(['DP', 'm'])
    // ...but there is no prompt-info capture there.
    expect(promptText).toBeUndefined()
  })
})
