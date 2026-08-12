import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {} }
})

import { setDatabase, type Database, type character } from '../../storage/database.svelte'
import { buildPlainPromptSections } from '../promptAssembly/buildPlainPromptSections'

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
    mainPrompt: 'MAIN',
    additionalPrompt: '',
    promptPreprocess: false,
    jailbreak: 'JAIL',
    jailbreakToggle: false,
    globalNote: 'GLOBAL',
    ...extra,
  } as unknown as Database)
}

describe('buildPlainPromptSections', () => {
  beforeEach(() => {
    seedDb()
  })

  it('emits a single system entry from db.mainPrompt when nothing else is set', () => {
    const sections = buildPlainPromptSections(makeChar())
    expect(sections.main).toEqual([{ role: 'system', content: 'MAIN' }])
    expect(sections.jailbreak).toEqual([])
    expect(sections.globalNote).toEqual([{ role: 'system', content: 'GLOBAL' }])
  })

  it('interpolates {{original}} in currentChar.systemPrompt against db.mainPrompt', () => {
    const char = makeChar({ systemPrompt: 'PREFIX {{original}} SUFFIX' })
    const sections = buildPlainPromptSections(char)
    expect(sections.main).toEqual([{ role: 'system', content: 'PREFIX MAIN SUFFIX' }])
  })

  it('uses currentChar.systemPrompt verbatim when no {{original}} is present', () => {
    const char = makeChar({ systemPrompt: 'CUSTOM-ONLY' })
    const sections = buildPlainPromptSections(char)
    expect(sections.main).toEqual([{ role: 'system', content: 'CUSTOM-ONLY' }])
  })

  it('appends additionalPrompt with a leading newline when promptPreprocess is true', () => {
    seedDb({ additionalPrompt: 'EXTRA', promptPreprocess: true })
    const sections = buildPlainPromptSections(makeChar())
    expect(sections.main).toEqual([{ role: 'system', content: 'MAIN\nEXTRA' }])
  })

  it('skips additionalPrompt when promptPreprocess is false', () => {
    seedDb({ additionalPrompt: 'EXTRA', promptPreprocess: false })
    const sections = buildPlainPromptSections(makeChar())
    expect(sections.main).toEqual([{ role: 'system', content: 'MAIN' }])
  })

  it('skips additionalPrompt when its value is the empty string', () => {
    seedDb({ additionalPrompt: '', promptPreprocess: true })
    const sections = buildPlainPromptSections(makeChar())
    expect(sections.main).toEqual([{ role: 'system', content: 'MAIN' }])
  })

  it('parses jailbreak through formatPrompt when jailbreakToggle is true', () => {
    seedDb({ jailbreakToggle: true, jailbreak: 'JAIL' })
    const sections = buildPlainPromptSections(makeChar())
    expect(sections.jailbreak).toEqual([{ role: 'system', content: 'JAIL' }])
  })

  it('interpolates {{original}} in replaceGlobalNote against db.globalNote', () => {
    const char = makeChar({ replaceGlobalNote: 'PRE {{original}} POST' })
    const sections = buildPlainPromptSections(char)
    expect(sections.globalNote).toEqual([{ role: 'system', content: 'PRE GLOBAL POST' }])
  })

  it('formatPrompt splits @@role markers into multiple OpenAIChat entries', () => {
    seedDb({ mainPrompt: '@@user\nhello\n@@assistant\nhi there\n@@system\nrules' })
    const sections = buildPlainPromptSections(makeChar())
    expect(sections.main).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'system', content: 'rules' },
    ])
  })

  it('formatPrompt accepts the triple-@ alias', () => {
    seedDb({ mainPrompt: '@@@assistant\nshort reply' })
    const sections = buildPlainPromptSections(makeChar())
    expect(sections.main).toEqual([{ role: 'assistant', content: 'short reply' }])
  })

  it('formatPrompt prepends an implicit @@system marker when input has no leading @@', () => {
    seedDb({ mainPrompt: 'plain text\n@@user\nbut later' })
    const sections = buildPlainPromptSections(makeChar())
    expect(sections.main).toEqual([
      { role: 'system', content: 'plain text' },
      { role: 'user', content: 'but later' },
    ])
  })
})
