import { beforeAll, describe, expect, it } from 'vitest'
import type {
  Chat,
  Database,
  character,
} from '../../../src/ts/storage/database.svelte'
import { EntityNotFoundError } from '../src/repository.js'
import {
  assemblePrompt,
  beginAssembly,
  createEmptyUnformatedSlots,
  fillLorebookSlots,
  fillStaticSlots,
  type AssembleDeps,
  type AssembleInput,
} from '../src/prompt/assemble.js'
import { bootPromptVariables } from '../src/prompt/promptVariablesBoot.js'

beforeAll(() => {
  bootPromptVariables()
})

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1',
    message: [],
    note: '',
    name: 'Chat',
    localLore: [],
    ...overrides,
  } as unknown as Chat
}

function makeCharacter(overrides: Partial<character> = {}): character {
  return {
    type: 'character',
    name: 'Tess',
    chaId: 'char-tess',
    utilityBot: false,
    chatPage: 0,
    chats: [makeChat()],
    ...overrides,
  } as unknown as character
}

function makeDatabase(overrides: Partial<Database> = {}): Database {
  return {
    currentChar: 0,
    characters: [makeCharacter()],
    formatingOrder: ['main', 'description', 'chats'],
    promptSettings: {
      assistantPrefill: '',
      postEndInnerFormat: '',
      sendChatAsSystem: false,
      sendName: false,
      utilOverride: false,
    },
    ...overrides,
  } as unknown as Database
}

function depsFor(db: Database | null): AssembleDeps {
  return { loadDatabase: () => db }
}

const baseInput = (overrides: Partial<AssembleInput> = {}): AssembleInput => ({
  chatId: 'chat-1',
  characterId: 'char-tess',
  mode: 'send',
  userMessage: 'hi',
  ...overrides,
})

describe('Phase 7-11a resolveScope (via beginAssembly)', () => {
  it('throws EntityNotFoundError when the database is missing', () => {
    expect(() => beginAssembly(baseInput(), depsFor(null))).toThrow(EntityNotFoundError)
  })

  it('throws EntityNotFoundError for an unknown characterId', () => {
    const db = makeDatabase()
    expect(() => beginAssembly(baseInput({ characterId: 'nope' }), depsFor(db))).toThrow(
      EntityNotFoundError,
    )
  })

  it('throws EntityNotFoundError for an unknown chatId', () => {
    const db = makeDatabase()
    expect(() => beginAssembly(baseInput({ chatId: 'nope' }), depsFor(db))).toThrow(
      EntityNotFoundError,
    )
  })

  it('resolves explicit character / chat IDs to their indices', () => {
    const db = makeDatabase({
      currentChar: 0,
      characters: [
        makeCharacter({ chaId: 'char-a', chats: [makeChat({ id: 'a0' })] }),
        makeCharacter({
          chaId: 'char-b',
          chatPage: 0,
          chats: [makeChat({ id: 'b0' }), makeChat({ id: 'b1', name: 'second' })],
        }),
      ],
    } as Partial<Database>)

    const state = beginAssembly(
      baseInput({ characterId: 'char-b', chatId: 'b1' }),
      depsFor(db),
    )
    expect(state.selectedCharID).toBe(1)
    expect(state.chatPage).toBe(1)
    expect(state.currentChar.chaId).toBe('char-b')
    expect(state.currentChat.id).toBe('b1')
  })

  it('resolves an active character / chat (default-active consistency)', () => {
    const db = makeDatabase({
      currentChar: 1,
      characters: [
        makeCharacter({ chaId: 'char-a', chats: [makeChat({ id: 'a0' })] }),
        makeCharacter({ chaId: 'char-b', chatPage: 1, chats: [makeChat({ id: 'b0' }), makeChat({ id: 'b1' })] }),
      ],
    } as Partial<Database>)

    const state = beginAssembly(
      baseInput({ characterId: 'char-b', chatId: 'b1' }),
      depsFor(db),
    )
    // The resolved indices match the active pointers.
    expect(state.selectedCharID).toBe(db.currentChar)
    expect(state.chatPage).toBe(state.currentChar.chatPage)
  })
})

describe('Phase 7-11a createEmptyUnformatedSlots', () => {
  it('returns all ten slot keys as empty arrays', () => {
    const slots = createEmptyUnformatedSlots()
    expect(Object.keys(slots).sort()).toEqual(
      [
        'authorNote',
        'chats',
        'description',
        'globalNote',
        'jailbreak',
        'lastChat',
        'lorebook',
        'main',
        'personaPrompt',
        'postEverything',
      ].sort(),
    )
    for (const value of Object.values(slots)) {
      expect(value).toEqual([])
    }
  })
})

describe('Phase 7-11a beginAssembly context + template normalization', () => {
  it('builds the ExpandContext and empty slots', () => {
    const db = makeDatabase()
    const state = beginAssembly(baseInput(), depsFor(db))
    expect(state.ctx).toEqual({ database: db, selectedCharID: 0, chatPage: 0 })
    expect(state.unformated.chats).toEqual([])
    expect(state.unformated.description).toEqual([])
  })

  it('records the preset / loadout identity', () => {
    const db = makeDatabase()
    const state = beginAssembly(
      baseInput({ presetId: 'preset-x', loadoutId: 'loadout-y' }),
      depsFor(db),
    )
    expect(state.presetId).toBe('preset-x')
    expect(state.loadoutId).toBe('loadout-y')
  })

  it('normalizes a set prompt template and appends postEverything', () => {
    const db = makeDatabase({ promptTemplate: [{ type: 'description' }] } as Partial<Database>)
    const state = beginAssembly(baseInput(), depsFor(db))
    expect(state.usingPromptTemplate).toBe(true)
    expect(state.promptTemplate?.at(-1)).toEqual({ type: 'postEverything' })
  })

  it('leaves promptTemplate null when none is set', () => {
    const db = makeDatabase({ promptTemplate: undefined } as Partial<Database>)
    const state = beginAssembly(baseInput(), depsFor(db))
    expect(state.promptTemplate).toBeNull()
    expect(state.usingPromptTemplate).toBe(false)
  })

  it('builds the format order with postEverything appended', () => {
    const db = makeDatabase()
    const state = beginAssembly(baseInput(), depsFor(db))
    expect(state.formatOrder).toEqual(['main', 'description', 'chats', 'postEverything'])
  })
})

describe('Phase 7-11a assemblePrompt', () => {
  it('still throws past scope resolution (route not wired)', async () => {
    const db = makeDatabase()
    await expect(assemblePrompt(baseInput(), depsFor(db))).rejects.toThrow(/not yet implemented/)
  })

  it('surfaces bad-ID errors early', async () => {
    const db = makeDatabase()
    await expect(assemblePrompt(baseInput({ characterId: 'nope' }), depsFor(db))).rejects.toThrow(
      EntityNotFoundError,
    )
  })
})

describe('Phase 7-11b fillStaticSlots', () => {
  // A database whose static/plain leaves all produce content.
  const staticDb = (
    overrides: Partial<Database> = {},
    charOverrides: Partial<character> = {},
  ): Database =>
    makeDatabase({
      mainPrompt: 'MAIN',
      jailbreak: 'JB',
      jailbreakToggle: true,
      globalNote: 'GN',
      chainOfThought: true,
      personaPrompt: 'PERSONA',
      characters: [
        makeCharacter({
          chaId: 'char-tess',
          desc: 'DESC',
          chats: [makeChat({ id: 'chat-1', note: 'NOTE' })],
          ...charOverrides,
        }),
      ],
      ...overrides,
    } as Partial<Database>)

  const fill = (db: Database, input = baseInput()) => {
    const state = beginAssembly(input, depsFor(db))
    fillStaticSlots(state)
    return state.unformated
  }

  it('fills plain + static slots on the non-utility, null-template path', () => {
    const u = fill(staticDb())
    expect(u.main.map((r) => r.content)).toEqual(['MAIN'])
    expect(u.jailbreak.map((r) => r.content)).toEqual(['JB'])
    expect(u.globalNote.map((r) => r.content)).toEqual(['GN'])
    expect(u.authorNote.map((r) => r.content)).toEqual(['NOTE'])
    expect(u.description.map((r) => r.content)).toEqual(['DESC'])
    expect(u.personaPrompt.map((r) => r.content)).toEqual(['PERSONA'])
    // chain-of-thought lands in postEverything as a single system row.
    expect(u.postEverything).toHaveLength(1)
    expect(u.postEverything[0].role).toBe('system')
  })

  it('skips plain sections for a utility bot but keeps the static four', () => {
    const u = fill(staticDb({}, { utilityBot: true }))
    expect(u.main).toEqual([])
    expect(u.jailbreak).toEqual([])
    expect(u.globalNote).toEqual([])
    expect(u.description.map((r) => r.content)).toEqual(['DESC'])
    expect(u.personaPrompt.map((r) => r.content)).toEqual(['PERSONA'])
    expect(u.authorNote.map((r) => r.content)).toEqual(['NOTE'])
  })

  it('skips plain sections when a prompt template is set', () => {
    const u = fill(staticDb({ promptTemplate: [{ type: 'description' }] } as Partial<Database>))
    expect(u.main).toEqual([])
    expect(u.jailbreak).toEqual([])
    expect(u.globalNote).toEqual([])
    expect(u.description.map((r) => r.content)).toEqual(['DESC'])
  })

  it('omits jailbreak when the toggle is off', () => {
    const u = fill(staticDb({ jailbreakToggle: false } as Partial<Database>))
    expect(u.jailbreak).toEqual([])
    expect(u.main.map((r) => r.content)).toEqual(['MAIN'])
  })

  it('omits the cot instruction when chainOfThought is off', () => {
    const u = fill(staticDb({ chainOfThought: false } as Partial<Database>))
    expect(u.postEverything).toEqual([])
  })

  it('omits persona when no personaPrompt is set', () => {
    const u = fill(staticDb({ personaPrompt: '' } as Partial<Database>))
    expect(u.personaPrompt).toEqual([])
  })

  it('omits author note when the chat note and default are empty', () => {
    const u = fill(staticDb({}, { chats: [makeChat({ id: 'chat-1', note: '' })] }))
    expect(u.authorNote).toEqual([])
  })
})

describe('Phase 7-11c fillLorebookSlots', () => {
  // An always-on (constant) lorebook entry — lands in the `lorebook` slot.
  const constLore = (content: string) =>
    ({
      key: '',
      secondkey: '',
      insertorder: 100,
      comment: '',
      content,
      mode: 'normal',
      alwaysActive: true,
      selective: false,
    }) as unknown

  const run = (db: Database) => {
    const state = beginAssembly(baseInput(), depsFor(db))
    fillStaticSlots(state)
    fillLorebookSlots(state)
    return state
  }

  it('activates the lorebook, distributes it, and sets the 7-11c state', () => {
    const db = makeDatabase({
      maxResponse: 100,
      characters: [
        makeCharacter({
          chaId: 'char-tess',
          desc: 'DESC',
          globalLore: [constLore('LOREBODY')],
          chats: [makeChat({ id: 'chat-1' })],
        } as Partial<character>),
      ],
    } as Partial<Database>)

    const state = run(db)
    expect(state.report).toBeDefined()
    expect(state.unformated.lorebook.map((r) => r.content)).toContain('LOREBODY')
    expect(typeof state.positionParser).toBe('function')
    expect(Array.isArray(state.depthPrompts)).toBe(true)
    // maxResponse (100) + 50 headroom + preflight tokens for the filled slots.
    expect(state.currentTokens).toBeGreaterThan(150)
    expect(state.memoryCardUsed).toBe(false)
    expect(state.hasCachePoint).toBe(false)
  })

  it('surfaces memoryCardUsed / hasCachePoint from the preflight', () => {
    const memState = run(
      makeDatabase({ promptTemplate: [{ type: 'memory' }] } as Partial<Database>),
    )
    expect(memState.memoryCardUsed).toBe(true)
    expect(memState.hasCachePoint).toBe(false)

    const cacheState = run(
      makeDatabase({
        promptTemplate: [{ type: 'cache', name: 'c', depth: 1, role: 'all' }],
      } as Partial<Database>),
    )
    expect(cacheState.hasCachePoint).toBe(true)
  })
})
