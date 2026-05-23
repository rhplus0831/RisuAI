import { beforeAll, describe, expect, it } from 'vitest'
import type {
  Database,
  character,
} from '../../../src/ts/storage/database.svelte'
import type { PromptItem } from '../../../src/ts/process/prompt'
import type { OpenAIChat } from '../../../src/ts/process/index.svelte'
import {
  buildFormatOrder,
  coalesceRows,
  normalizeTemplate,
  renderByFormatOrder,
  renderByTemplate,
  type FormatOrderKey,
  type UnformatedPromptSlots,
} from '../src/prompt/templates.js'
import { bootPromptVariables } from '../src/prompt/promptVariablesBoot.js'
import type { ExpandContext } from '../src/prompt/variables.js'

beforeAll(() => {
  bootPromptVariables()
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
      [
        row({ content: 'a', memo: 'm' }),
        row({ role: 'user', content: 'u' }),
        row({ content: 'b', memo: 'm' }),
      ],
      'gpt4',
    )
    expect(out.map((r) => r.content)).toEqual(['a', 'u', 'b'])
  })

  it('pushes every row verbatim on a non-coalescing model', () => {
    const out: OpenAIChat[] = []
    coalesceRows(
      out,
      [row({ content: 'a', memo: 'm' }), row({ content: 'b', memo: 'm' })],
      'ollama',
    )
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
    const out = renderByTemplate(
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
    const out = renderByTemplate(
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
    const out = renderByTemplate(
      ctxFor(db),
      makeCharacter(),
      makeSlots(),
      tpl([{ type: 'plain', type2: 'main', text: 'system line', role: 'system' }]),
      true,
    )
    expect(out).toEqual([{ role: 'system', content: 'system line' }])

    const botOut = renderByTemplate(
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
    const out = renderByTemplate(
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
    const out = renderByTemplate(
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
    expect(renderByTemplate(ctxFor(off), makeCharacter(), makeSlots(), cards, true)).toEqual([])

    const on = makeDatabase({ jailbreakToggle: true, chainOfThought: true } as Partial<Database>)
    const out = renderByTemplate(ctxFor(on), makeCharacter(), makeSlots(), cards, true)
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
    const out = renderByTemplate(
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
    const out = renderByTemplate(
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

  it('skips memory / cache cards (deferred to 7-10d)', () => {
    const db = makeDatabase()
    const unformated = makeSlots({
      description: [row({ role: 'system', content: 'desc' })],
    })
    const out = renderByTemplate(
      ctxFor(db),
      makeCharacter(),
      unformated,
      tpl([
        { type: 'memory' },
        { type: 'cache', name: 'c', depth: 1, role: 'all' },
        { type: 'description' },
      ]),
      true,
    )
    expect(out.map((r) => r.content)).toEqual(['desc'])
  })

  it('applies the injected positionParser to card text', () => {
    const db = makeDatabase()
    const out = renderByTemplate(
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

  const renderChat = (
    db: Database,
    card: PromptItem,
    unformated = chatSlots(),
    char = makeCharacter(),
  ): OpenAIChat[] => renderByTemplate(ctxFor(db), char, unformated, [card], true)

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
