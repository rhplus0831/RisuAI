import { describe, expect, it } from 'vitest'
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
  type AssembleDeps,
  type AssembleInput,
} from '../src/prompt/assemble.js'

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
