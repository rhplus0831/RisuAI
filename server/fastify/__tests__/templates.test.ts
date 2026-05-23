import { describe, expect, it } from 'vitest'
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
  type FormatOrderKey,
  type UnformatedPromptSlots,
} from '../src/prompt/templates.js'

function makeDatabase(overrides: Partial<Database> = {}): Database {
  return {
    aiModel: 'gpt4',
    currentChar: 0,
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
