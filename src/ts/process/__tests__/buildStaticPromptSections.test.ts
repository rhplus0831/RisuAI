import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {} }
})

import { setDatabase, type Chat, type Database, type character } from '../../storage/database.svelte'
import {
  buildAuthorNote,
  buildCotInstruction as buildCotInstructionWithDatabase,
  buildInlayViewInstruction,
  buildPersona,
} from '../promptAssembly/buildStaticPromptSections'
import { getDatabase } from 'src/ts/__tests__/resourceDatabaseState'

function buildCotInstruction(usingPromptTemplate: boolean) {
  return buildCotInstructionWithDatabase(usingPromptTemplate, getDatabase())
}

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

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    name: 'main',
    note: '',
    localLore: [],
    scriptstate: {},
    fmIndex: -1,
    message: [],
    ...overrides,
  } as unknown as Chat
}

function seedDb(extra: Partial<Database> = {}) {
  setDatabase({
    characters: [makeChar()],
    ...extra,
  } as unknown as Database)
}

const COT_TEXT =
  '<instruction> - before respond everything, Think step by step as a ai assistant how would you respond inside <Thoughts> xml tag. this must be less than 5 paragraphs.</instruction>'

describe('buildAuthorNote', () => {
  beforeEach(() => {
    seedDb()
  })

  it('returns the chat note when set', () => {
    const result = buildAuthorNote(makeChar(), makeChat({ note: 'Stay in character.' }))
    expect(result).toEqual([{ role: 'system', content: 'Stay in character.' }])
  })

  it('falls back to the template default author note when chat note is empty', () => {
    seedDb({
      promptTemplate: [{ type: 'authornote', defaultText: 'Default note.' }] as Database['promptTemplate'],
    })
    const result = buildAuthorNote(makeChar(), makeChat({ note: '' }))
    expect(result).toEqual([{ role: 'system', content: 'Default note.' }])
  })

  it('returns empty when neither chat note nor template default is set', () => {
    const result = buildAuthorNote(makeChar(), makeChat({ note: '' }))
    expect(result).toEqual([])
  })

  it('prefers chat note over template default when both are set', () => {
    seedDb({
      promptTemplate: [{ type: 'authornote', defaultText: 'Default note.' }] as Database['promptTemplate'],
    })
    const result = buildAuthorNote(makeChar(), makeChat({ note: 'Chat note.' }))
    expect(result).toEqual([{ role: 'system', content: 'Chat note.' }])
  })
})

describe('buildCotInstruction', () => {
  beforeEach(() => {
    seedDb()
  })

  it('returns empty when chainOfThought is off', () => {
    seedDb({ chainOfThought: false })
    expect(buildCotInstruction(false)).toEqual([])
  })

  it('returns the cot system entry when chainOfThought is on and no template is in use', () => {
    seedDb({ chainOfThought: true })
    expect(buildCotInstruction(false)).toEqual([{ role: 'system', content: COT_TEXT }])
  })

  it('returns the cot entry when a template is in use but customChainOfThought is off', () => {
    seedDb({ chainOfThought: true })
    expect(buildCotInstruction(true)).toEqual([{ role: 'system', content: COT_TEXT }])
  })

  it('suppresses the cot entry when a template is in use and customChainOfThought is on', () => {
    seedDb({
      chainOfThought: true,
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: '',
        sendChatAsSystem: false,
        sendName: false,
        utilOverride: false,
        customChainOfThought: true,
        maxThoughtTagDepth: -1,
      },
    })
    expect(buildCotInstruction(true)).toEqual([])
  })

  it('still emits the cot entry when customChainOfThought is on but no template is in use', () => {
    seedDb({
      chainOfThought: true,
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: '',
        sendChatAsSystem: false,
        sendName: false,
        utilOverride: false,
        customChainOfThought: true,
        maxThoughtTagDepth: -1,
      },
    })
    expect(buildCotInstruction(false)).toEqual([{ role: 'system', content: COT_TEXT }])
  })
})

describe('buildPersona', () => {
  beforeEach(() => {
    seedDb()
  })

  it('returns the persona prompt when db.personaPrompt is set', () => {
    seedDb({ personaPrompt: 'Curious user persona.', personas: [] })
    expect(buildPersona(makeChar())).toEqual([{ role: 'system', content: 'Curious user persona.' }])
  })

  it('returns empty when db.personaPrompt is empty', () => {
    seedDb({ personaPrompt: '', personas: [] })
    expect(buildPersona(makeChar())).toEqual([])
  })
})

describe('buildInlayViewInstruction', () => {
  beforeEach(() => {
    seedDb()
  })

  it('returns empty when inlayViewScreen is false', () => {
    const char = makeChar({
      inlayViewScreen: false,
      viewScreen: 'emotion',
      newGenData: {
        prompt: '',
        negative: '',
        instructions: '',
        emotionInstructions: 'Pick from: {{slot}}',
      },
      emotionImages: [['happy', 'h.png']],
    } as Partial<character>)
    expect(buildInlayViewInstruction(char)).toEqual([])
  })

  it('emits the emotion instruction with {{slot}} replaced by the joined emotion names', () => {
    const char = makeChar({
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
    } as Partial<character>)
    expect(buildInlayViewInstruction(char)).toEqual([{ role: 'system', content: 'Pick from: happy, sad' }])
  })

  it('emits the emotion instruction with an empty {{slot}} when emotionImages is empty', () => {
    const char = makeChar({
      inlayViewScreen: true,
      viewScreen: 'emotion',
      newGenData: {
        prompt: '',
        negative: '',
        instructions: '',
        emotionInstructions: 'Pick from: {{slot}}',
      },
      emotionImages: [],
    } as Partial<character>)
    expect(buildInlayViewInstruction(char)).toEqual([{ role: 'system', content: 'Pick from: ' }])
  })

  it('emits the imggen instruction verbatim', () => {
    const char = makeChar({
      inlayViewScreen: true,
      viewScreen: 'imggen',
      newGenData: {
        prompt: '',
        negative: '',
        instructions: 'Draw the scene.',
        emotionInstructions: '',
      },
    } as Partial<character>)
    expect(buildInlayViewInstruction(char)).toEqual([{ role: 'system', content: 'Draw the scene.' }])
  })

  it('returns empty when inlayViewScreen is on but viewScreen is none', () => {
    const char = makeChar({
      inlayViewScreen: true,
      viewScreen: 'none',
    } as Partial<character>)
    expect(buildInlayViewInstruction(char)).toEqual([])
  })
})
