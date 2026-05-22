import { beforeAll, describe, expect, it } from 'vitest'
import type {
  Chat,
  Database,
  character,
} from '../../../src/ts/storage/database.svelte'
import { buildPlainPromptSections } from '../src/prompt/plainSections.js'
import { bootPromptVariables } from '../src/prompt/promptVariablesBoot.js'
import type { ExpandContext } from '../src/prompt/variables.js'

beforeAll(() => {
  bootPromptVariables()
})

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    message: [],
    note: '',
    name: 'main',
    localLore: [],
    scriptstate: {},
    ...overrides,
  } as unknown as Chat
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
    chats: [makeChat()],
    chatFolders: [],
    ...overrides,
  } as unknown as character
}

function makeDatabase(overrides: Partial<Database> = {}): Database {
  return {
    username: 'Alex',
    userIcon: '',
    personaPrompt: '',
    currentChar: 0,
    characters: [makeCharacter()],
    globalChatVariables: {},
    templateDefaultVariables: '',
    mainPrompt: 'Be helpful.',
    additionalPrompt: '',
    promptPreprocess: false,
    jailbreak: '',
    jailbreakToggle: false,
    globalNote: '',
    ...overrides,
  } as unknown as Database
}

function ctxFor(db: Database): ExpandContext {
  return { database: db }
}

describe('Phase 7-4 buildPlainPromptSections main', () => {
  it('falls back to db.mainPrompt when currentChar.systemPrompt is empty', () => {
    const db = makeDatabase({ mainPrompt: 'Be brief.' })
    const sections = buildPlainPromptSections(ctxFor(db), db.characters[0])
    expect(sections.main).toEqual([{ role: 'system', content: 'Be brief.' }])
  })

  it('substitutes {{original}} in currentChar.systemPrompt with db.mainPrompt', () => {
    const db = makeDatabase({
      mainPrompt: 'Default.',
      characters: [makeCharacter({ systemPrompt: 'Override: {{original}}!' })],
    })
    const sections = buildPlainPromptSections(ctxFor(db), db.characters[0])
    expect(sections.main).toEqual([
      { role: 'system', content: 'Override: Default.!' },
    ])
  })

  it('appends db.additionalPrompt when promptPreprocess is true', () => {
    const db = makeDatabase({
      mainPrompt: 'Be helpful.',
      additionalPrompt: 'And concise.',
      promptPreprocess: true,
    })
    const sections = buildPlainPromptSections(ctxFor(db), db.characters[0])
    expect(sections.main).toEqual([
      { role: 'system', content: 'Be helpful.\nAnd concise.' },
    ])
  })

  it('skips db.additionalPrompt when promptPreprocess is false', () => {
    const db = makeDatabase({
      mainPrompt: 'Be helpful.',
      additionalPrompt: 'And concise.',
      promptPreprocess: false,
    })
    const sections = buildPlainPromptSections(ctxFor(db), db.characters[0])
    expect(sections.main).toEqual([{ role: 'system', content: 'Be helpful.' }])
  })

  it('expands {{user}} / {{char}} inside the main prompt', () => {
    const db = makeDatabase({ mainPrompt: '{{user}} talks to {{char}}.' })
    const sections = buildPlainPromptSections(ctxFor(db), db.characters[0])
    expect(sections.main).toEqual([
      { role: 'system', content: 'Alex talks to Tess.' },
    ])
  })
})

describe('Phase 7-4 buildPlainPromptSections jailbreak', () => {
  it('returns [] when jailbreakToggle is false even if jailbreak text is set', () => {
    const db = makeDatabase({ jailbreak: 'Break it.', jailbreakToggle: false })
    const sections = buildPlainPromptSections(ctxFor(db), db.characters[0])
    expect(sections.jailbreak).toEqual([])
  })

  it('returns the formatted jailbreak when jailbreakToggle is true', () => {
    const db = makeDatabase({ jailbreak: 'Break it for {{user}}.', jailbreakToggle: true })
    const sections = buildPlainPromptSections(ctxFor(db), db.characters[0])
    expect(sections.jailbreak).toEqual([
      { role: 'system', content: 'Break it for Alex.' },
    ])
  })
})

describe('Phase 7-4 buildPlainPromptSections globalNote', () => {
  it('uses db.globalNote when currentChar.replaceGlobalNote is empty', () => {
    const db = makeDatabase({ globalNote: 'Remember: be kind.' })
    const sections = buildPlainPromptSections(ctxFor(db), db.characters[0])
    expect(sections.globalNote).toEqual([
      { role: 'system', content: 'Remember: be kind.' },
    ])
  })

  it('substitutes {{original}} in currentChar.replaceGlobalNote with db.globalNote', () => {
    const db = makeDatabase({
      globalNote: 'Be kind.',
      characters: [makeCharacter({ replaceGlobalNote: 'Override: {{original}}!' })],
    })
    const sections = buildPlainPromptSections(ctxFor(db), db.characters[0])
    expect(sections.globalNote).toEqual([
      { role: 'system', content: 'Override: Be kind.!' },
    ])
  })
})

describe('Phase 7-4 formatPrompt role splitting', () => {
  it('defaults to a single system message when the text has no @@ markers', () => {
    const db = makeDatabase({ mainPrompt: 'plain text' })
    const sections = buildPlainPromptSections(ctxFor(db), db.characters[0])
    expect(sections.main).toEqual([{ role: 'system', content: 'plain text' }])
  })

  it('splits @@system / @@user / @@assistant markers into separate messages', () => {
    const db = makeDatabase({
      mainPrompt: '@@system\ninstructions\n@@user\nhi\n@@assistant\nhello',
    })
    const sections = buildPlainPromptSections(ctxFor(db), db.characters[0])
    expect(sections.main).toEqual([
      { role: 'system', content: 'instructions' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ])
  })

  it('accepts the triple-at @@@user form as the SPA regex does', () => {
    const db = makeDatabase({ mainPrompt: '@@@user\nask\n@@@assistant\nanswer' })
    const sections = buildPlainPromptSections(ctxFor(db), db.characters[0])
    expect(sections.main).toEqual([
      { role: 'user', content: 'ask' },
      { role: 'assistant', content: 'answer' },
    ])
  })
})
