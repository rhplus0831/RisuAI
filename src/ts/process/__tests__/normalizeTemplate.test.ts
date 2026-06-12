import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {} }
})

import { setDatabase, type Database, type character } from '../../storage/database.svelte'
import { DBState } from '../../stores.svelte'
import type { PromptItem } from '../prompt'
import { normalizeTemplate } from '../promptAssembly/normalizeTemplate'

function makeChar(overrides: Partial<character> = {}): character {
  return {
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
    chaVer: 0,
    firstMessage: '',
    notes: '',
    utilityBot: false,
    ...overrides,
  } as unknown as character
}

function seedDb(extra: Partial<Database> = {}) {
  setDatabase({
    characters: [makeChar()],
    ...extra,
  } as unknown as Database)
}

const FORCED_UTILITY_TEMPLATE: PromptItem[] = [
  { type: 'plain', text: '', role: 'system', type2: 'main' },
  { type: 'description' },
  { type: 'lorebook' },
  { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
  { type: 'plain', text: '', role: 'system', type2: 'globalNote' },
  { type: 'postEverything' },
]

describe('normalizeTemplate', () => {
  beforeEach(() => {
    seedDb()
  })

  it('returns null and usingPromptTemplate=false when db.promptTemplate is unset', () => {
    const result = normalizeTemplate(makeChar())
    expect(result.promptTemplate).toBeNull()
    expect(result.usingPromptTemplate).toBe(false)
  })

  it('appends an implicit postEverything when the template lacks one', () => {
    seedDb({
      promptTemplate: [{ type: 'description' }, { type: 'chat', rangeStart: 0, rangeEnd: 'end' }] as PromptItem[],
    })
    const result = normalizeTemplate(makeChar())
    expect(result.usingPromptTemplate).toBe(true)
    expect(result.promptTemplate).toEqual([
      { type: 'description' },
      { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
      { type: 'postEverything' },
    ])
  })

  it('does not duplicate postEverything when the template already has one', () => {
    seedDb({
      promptTemplate: [{ type: 'description' }, { type: 'postEverything' }] as PromptItem[],
    })
    const result = normalizeTemplate(makeChar())
    expect(result.promptTemplate).toEqual([{ type: 'description' }, { type: 'postEverything' }])
  })

  it('clones the db template so the result can be mutated without touching state', () => {
    const original: PromptItem[] = [{ type: 'description' }]
    seedDb({ promptTemplate: original })
    const result = normalizeTemplate(makeChar())
    expect(result.promptTemplate).not.toBe(DBState.db.promptTemplate)
    // implicit postEverything must not leak back into db state
    expect(DBState.db.promptTemplate).toEqual([{ type: 'description' }])
  })

  it('forces the utility-bot template when utilityBot=true and utilOverride defaults to false', () => {
    const result = normalizeTemplate(makeChar({ utilityBot: true }))
    expect(result.promptTemplate).toEqual(FORCED_UTILITY_TEMPLATE)
    // usingPromptTemplate stays false: it reflects the *user's* original choice,
    // not the forced replacement.
    expect(result.usingPromptTemplate).toBe(false)
  })

  it('keeps the user template when utilityBot=true but utilOverride=true', () => {
    seedDb({
      promptTemplate: [{ type: 'description' }] as PromptItem[],
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: '',
        sendChatAsSystem: false,
        sendName: false,
        utilOverride: true,
        customChainOfThought: false,
        maxThoughtTagDepth: -1,
      },
    })
    const result = normalizeTemplate(makeChar({ utilityBot: true }))
    expect(result.usingPromptTemplate).toBe(true)
    expect(result.promptTemplate).toEqual([{ type: 'description' }, { type: 'postEverything' }])
  })

  it('forces the utility-bot template when utilOverride=true but the user has no template', () => {
    seedDb({
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: '',
        sendChatAsSystem: false,
        sendName: false,
        utilOverride: true,
        customChainOfThought: false,
        maxThoughtTagDepth: -1,
      },
    })
    const result = normalizeTemplate(makeChar({ utilityBot: true }))
    expect(result.promptTemplate).toEqual(FORCED_UTILITY_TEMPLATE)
  })

  it('passes through the user template untouched for non-utility characters', () => {
    seedDb({
      promptTemplate: [{ type: 'description' }, { type: 'postEverything' }] as PromptItem[],
    })
    const result = normalizeTemplate(makeChar({ utilityBot: false }))
    expect(result.usingPromptTemplate).toBe(true)
    expect(result.promptTemplate).toEqual([{ type: 'description' }, { type: 'postEverything' }])
  })
})
