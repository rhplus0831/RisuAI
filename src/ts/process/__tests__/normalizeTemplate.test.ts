import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {} }
})

import { setDatabase, type Database, type character } from '../../storage/database.svelte'
import { testDatabaseState } from '../../__tests__/resourceDatabaseState'
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
      promptPresetsId: -1,
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
      promptPresetsId: -1,
      promptTemplate: [{ type: 'description' }, { type: 'postEverything' }] as PromptItem[],
    })
    const result = normalizeTemplate(makeChar())
    expect(result.promptTemplate).toEqual([{ type: 'description' }, { type: 'postEverything' }])
  })

  it('clones the db template so the result can be mutated without touching state', () => {
    const original: PromptItem[] = [{ type: 'description' }]
    seedDb({ promptPresetsId: -1, promptTemplate: original })
    const result = normalizeTemplate(makeChar())
    expect(result.promptTemplate).not.toBe(testDatabaseState.db.promptTemplate)
    // implicit postEverything must not leak back into db state
    expect(testDatabaseState.db.promptTemplate).toEqual([{ type: 'description' }])
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
      promptPresetsId: -1,
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
      promptPresetsId: -1,
      promptTemplate: [{ type: 'description' }, { type: 'postEverything' }] as PromptItem[],
    })
    const result = normalizeTemplate(makeChar({ utilityBot: false }))
    expect(result.usingPromptTemplate).toBe(true)
    expect(result.promptTemplate).toEqual([{ type: 'description' }, { type: 'postEverything' }])
  })

  it('uses the selected prompt preset instead of stale top-level or legacy bot preset templates', () => {
    seedDb({
      promptTemplate: [{ type: 'plain', text: 'stale top-level', role: 'system', type2: 'main' }] as PromptItem[],
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
      ] as Database['botPresets'],
      botPresetsId: 0,
    })

    const result = normalizeTemplate(makeChar())

    expect(result.usingPromptTemplate).toBe(true)
    expect(result.promptTemplate).toEqual([{ type: 'description' }, { type: 'postEverything' }])
  })

  it('treats a selected prompt preset without promptTemplate as disabled instead of falling back to top-level', () => {
    seedDb({
      promptTemplate: [{ type: 'description' }] as PromptItem[],
      promptPresets: [{ id: 'plain-prompt', name: 'Plain Prompt' }],
      promptPresetsId: 0,
    })

    const result = normalizeTemplate(makeChar())

    expect(result.promptTemplate).toBeNull()
    expect(result.usingPromptTemplate).toBe(false)
  })

  it('does not read legacy botPresetsId as a prompt template owner', () => {
    seedDb({
      promptPresetsId: -1,
      botPresets: [
        {
          id: 'legacy-bot',
          name: 'Legacy Bot',
          promptTemplate: [{ type: 'description' }],
        },
      ] as Database['botPresets'],
      botPresetsId: 0,
    })

    const result = normalizeTemplate(makeChar())

    expect(result.promptTemplate).toBeNull()
    expect(result.usingPromptTemplate).toBe(false)
  })

  it('uses chat-scoped prompt preset ids before global prompt preset and stale top-level templates', () => {
    seedDb({
      promptTemplate: [{ type: 'plain', text: 'stale top-level', role: 'system', type2: 'main' }] as PromptItem[],
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
    })

    const result = normalizeTemplate(makeChar(), { chatPromptPresetId: 'chat-prompt' })

    expect(result.usingPromptTemplate).toBe(true)
    expect(result.promptTemplate).toEqual([{ type: 'lorebook' }, { type: 'postEverything' }])
  })

  it('does not fall back when a chat-scoped prompt preset resolves without promptTemplate', () => {
    seedDb({
      promptTemplate: [{ type: 'description' }] as PromptItem[],
      promptPresets: [
        {
          id: 'global-prompt',
          name: 'Global Prompt',
          promptTemplate: [{ type: 'lorebook' }],
        },
        { id: 'chat-prompt', name: 'Chat Prompt' },
      ],
      promptPresetsId: 0,
    })

    const result = normalizeTemplate(makeChar(), { chatPromptPresetId: 'chat-prompt' })

    expect(result.promptTemplate).toBeNull()
    expect(result.usingPromptTemplate).toBe(false)
  })

  it('does not mutate preset-owned promptTemplate when adding implicit postEverything', () => {
    const presetTemplate: PromptItem[] = [{ type: 'description' }]
    seedDb({
      promptPresets: [
        {
          id: 'modern-prompt',
          name: 'Modern Prompt',
          promptTemplate: presetTemplate,
        },
      ],
      promptPresetsId: 0,
    })

    const result = normalizeTemplate(makeChar())

    expect(result.promptTemplate).toEqual([{ type: 'description' }, { type: 'postEverything' }])
    expect(testDatabaseState.db.promptPresets[0].promptTemplate).toEqual([{ type: 'description' }])
  })
})
