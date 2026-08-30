import { beforeAll, describe, expect, it } from 'vitest'
import type {
  FastifyChat as Chat,
  FastifyCharacter as character,
  FastifyDatabase as Database,
} from '../src/prompt/serverTypes.js'
import {
  buildAuthorNote,
  buildCotInstruction,
  buildDescription,
  buildInlayViewInstruction,
  buildPersona,
} from '../src/prompt/staticSections.js'
import { bootPromptVariables } from '../src/prompt/promptVariablesBoot.js'
import type { ExpandContext } from '../src/prompt/variables.js'

const COT_TEXT =
  '<instruction> - before respond everything, Think step by step as a ai assistant how would you respond inside <Thoughts> xml tag. this must be less than 5 paragraphs.</instruction>'

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
    desc: 'A friendly assistant.',
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
    promptPreprocess: false,
    descriptionPrefix: '',
    chainOfThought: false,
    promptTemplate: null,
    ...overrides,
  } as unknown as Database
}

function ctxFor(db: Database): ExpandContext {
  return { database: db }
}

describe('buildDescription', () => {
  it('emits only the desc when personality and scenario are empty', () => {
    const db = makeDatabase()
    const out = buildDescription(ctxFor(db), db.characters[0])
    expect(out).toEqual([{ role: 'system', content: 'A friendly assistant.' }])
  })

  it('appends personality and scenario when set, with the SPA header text', () => {
    const db = makeDatabase({
      characters: [makeCharacter({ personality: 'cheerful', scenario: 'A library.' })],
    })
    const [chat] = buildDescription(ctxFor(db), db.characters[0])
    expect(chat.content).toBe(
      [
        'A friendly assistant.',
        '\n\nDescription of Tess: cheerful',
        '\n\nCircumstances and context of the dialogue: A library.',
      ].join(''),
    )
  })

  it('expands {{user}} / {{char}} inside personality and scenario', () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          personality: 'loves {{user}}',
          scenario: '{{char}} in the park',
        }),
      ],
    })
    const [chat] = buildDescription(ctxFor(db), db.characters[0])
    expect(chat.content).toContain('Description of Tess: loves Alex')
    expect(chat.content).toContain('Circumstances and context of the dialogue: Tess in the park')
  })

  it('prepends descriptionPrefix when promptPreprocess is true', () => {
    const db = makeDatabase({
      promptPreprocess: true,
      descriptionPrefix: 'NSFW. ',
    })
    const [chat] = buildDescription(ctxFor(db), db.characters[0])
    expect(chat.content.startsWith('NSFW. A friendly assistant.')).toBe(true)
  })

  it('skips the descriptionPrefix when promptPreprocess is false', () => {
    const db = makeDatabase({
      promptPreprocess: false,
      descriptionPrefix: 'NSFW. ',
    })
    const [chat] = buildDescription(ctxFor(db), db.characters[0])
    expect(chat.content).toBe('A friendly assistant.')
  })
})

describe('buildAuthorNote', () => {
  it('returns the expanded chat.note when set', () => {
    const db = makeDatabase()
    const chat = makeChat({ note: 'Note for {{user}}' })
    const out = buildAuthorNote(ctxFor(db), chat)
    expect(out).toEqual([{ role: 'system', content: 'Note for Alex' }])
  })

  it('falls back to db.promptTemplate authornote.defaultText when chat.note is empty', () => {
    const db = makeDatabase({
      promptTemplate: [
        { type: 'plain' },
        { type: 'authornote', defaultText: 'Default note for {{char}}' },
      ] as unknown as Database['promptTemplate'],
    })
    const chat = makeChat({ note: '' })
    const out = buildAuthorNote(ctxFor(db), chat)
    expect(out).toEqual([{ role: 'system', content: 'Default note for Tess' }])
  })

  it('uses the chat-scoped prompt preset author note instead of stale top-level or global defaults', () => {
    const db = makeDatabase({
      promptTemplate: [{ type: 'authornote', defaultText: 'Stale top-level note' }],
      promptPresets: [
        {
          id: 'global-prompt',
          name: 'Global Prompt',
          promptTemplate: [{ type: 'authornote', defaultText: 'Stale global note' }],
        },
        {
          id: 'chat-prompt',
          name: 'Chat Prompt',
          promptTemplate: [{ type: 'authornote', defaultText: 'Chat note for {{char}}' }],
        },
      ],
      promptPresetsId: 0,
    } as unknown as Partial<Database>)
    const chat = makeChat({
      note: '',
      generationSettings: { promptPresetId: 'chat-prompt' } as Chat['generationSettings'],
    })

    expect(buildAuthorNote(ctxFor(db), chat)).toEqual([{ role: 'system', content: 'Chat note for Tess' }])
  })

  it('returns [] when the chat-scoped prompt preset has no promptTemplate instead of stale defaults', () => {
    const db = makeDatabase({
      promptTemplate: [{ type: 'authornote', defaultText: 'Stale top-level note' }],
      promptPresets: [
        {
          id: 'global-prompt',
          name: 'Global Prompt',
          promptTemplate: [{ type: 'authornote', defaultText: 'Stale global note' }],
        },
        {
          id: 'chat-prompt',
          name: 'Chat Prompt',
        },
      ],
      promptPresetsId: 0,
    } as unknown as Partial<Database>)
    const chat = makeChat({
      note: '',
      generationSettings: { promptPresetId: 'chat-prompt' } as Chat['generationSettings'],
    })

    expect(buildAuthorNote(ctxFor(db), chat)).toEqual([])
  })

  it('returns [] when both chat.note and authornote.defaultText are empty', () => {
    const db = makeDatabase({
      promptTemplate: [{ type: 'authornote', defaultText: '' }] as unknown as Database['promptTemplate'],
    })
    expect(buildAuthorNote(ctxFor(db), makeChat({ note: '' }))).toEqual([])
  })

  it('returns [] when promptTemplate is null and chat.note is empty', () => {
    const db = makeDatabase({ promptTemplate: undefined })
    expect(buildAuthorNote(ctxFor(db), makeChat({ note: '' }))).toEqual([])
  })
})

describe('buildPersona', () => {
  it('returns [] when db.personaPrompt is empty', () => {
    expect(buildPersona(ctxFor(makeDatabase({ personaPrompt: '' })))).toEqual([])
  })

  it('returns the expanded personaPrompt when set', () => {
    const db = makeDatabase({ personaPrompt: 'Alex helps {{char}}.' })
    expect(buildPersona(ctxFor(db))).toEqual([{ role: 'system', content: 'Alex helps Tess.' }])
  })
})

describe('buildCotInstruction', () => {
  it('returns [] when db.chainOfThought is false', () => {
    const db = makeDatabase({ chainOfThought: false })
    expect(buildCotInstruction(ctxFor(db), false)).toEqual([])
  })

  it('returns the COT instruction when chainOfThought is true', () => {
    const db = makeDatabase({ chainOfThought: true })
    expect(buildCotInstruction(ctxFor(db), false)).toEqual([{ role: 'system', content: COT_TEXT }])
  })

  it('returns [] when usingPromptTemplate and customChainOfThought are both true', () => {
    const db = makeDatabase({
      chainOfThought: true,
      promptSettings: { customChainOfThought: true } as unknown as Database['promptSettings'],
    })
    expect(buildCotInstruction(ctxFor(db), true)).toEqual([])
  })

  it('still emits COT when usingPromptTemplate is true but customChainOfThought is false', () => {
    const db = makeDatabase({
      chainOfThought: true,
      promptSettings: { customChainOfThought: false } as unknown as Database['promptSettings'],
    })
    expect(buildCotInstruction(ctxFor(db), true)).toEqual([{ role: 'system', content: COT_TEXT }])
  })
})

// Byte-parity with the SPA's buildInlayViewInstruction. These mirror the browser
// unit cases exactly: no variable expansion, only the manual
// `{{slot}}` → emotionImages substitution.
describe('buildInlayViewInstruction', () => {
  it('returns [] when inlayViewScreen is false', () => {
    const char = makeCharacter({
      inlayViewScreen: false,
      viewScreen: 'emotion',
      newGenData: {
        prompt: '',
        negative: '',
        instructions: '',
        emotionInstructions: 'Pick from: {{slot}}',
      },
      emotionImages: [['happy', 'h.png']],
    } as unknown as Partial<character>)
    expect(buildInlayViewInstruction(char)).toEqual([])
  })

  it('emits the emotion instruction with {{slot}} replaced by the joined emotion names', () => {
    const char = makeCharacter({
      inlayViewScreen: true,
      viewScreen: 'emotion',
      newGenData: {
        prompt: '',
        negative: '',
        instructions: '',
        emotionInstructions: 'Pick from: {{slot}}',
      },
      emotionImages: [
        ['happy', 'h.png'],
        ['sad', 's.png'],
      ],
    } as unknown as Partial<character>)
    expect(buildInlayViewInstruction(char)).toEqual([{ role: 'system', content: 'Pick from: happy, sad' }])
  })

  it('emits the emotion instruction with an empty {{slot}} when emotionImages is empty', () => {
    const char = makeCharacter({
      inlayViewScreen: true,
      viewScreen: 'emotion',
      newGenData: {
        prompt: '',
        negative: '',
        instructions: '',
        emotionInstructions: 'Pick from: {{slot}}',
      },
      emotionImages: [],
    } as unknown as Partial<character>)
    expect(buildInlayViewInstruction(char)).toEqual([{ role: 'system', content: 'Pick from: ' }])
  })

  it('emits the imggen instruction verbatim', () => {
    const char = makeCharacter({
      inlayViewScreen: true,
      viewScreen: 'imggen',
      newGenData: {
        prompt: '',
        negative: '',
        instructions: 'Draw the scene.',
        emotionInstructions: '',
      },
    } as unknown as Partial<character>)
    expect(buildInlayViewInstruction(char)).toEqual([{ role: 'system', content: 'Draw the scene.' }])
  })

  it('returns [] when inlayViewScreen is on but viewScreen is none', () => {
    const char = makeCharacter({
      inlayViewScreen: true,
      viewScreen: 'none',
    } as unknown as Partial<character>)
    expect(buildInlayViewInstruction(char)).toEqual([])
  })
})
