import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Chat, Database, character } from '../../../src/ts/storage/database.svelte'
import { openDatabase } from '../src/db.js'
import {
  createMemoryChunk,
  createMemoryEmbedding,
  createMemorySummary,
  listMemoryJobs,
} from '../src/memoryRepository.js'
import { EntityNotFoundError } from '../src/repository.js'
import {
  assemblePrompt,
  beginAssembly,
  createEmptyUnformatedSlots,
  fillHistoryAndBias,
  fillLorebookSlots,
  fillMemoryAndPostHistory,
  fillStaticSlots,
  renderAndBudget,
  type AssembleDeps,
  type AssembleInput,
} from '../src/prompt/assemble.js'
import { bootPromptVariables } from '../src/prompt/promptVariablesBoot.js'

beforeAll(() => {
  bootPromptVariables()
})

const dataDirs: string[] = []

function makeDataDir(): string {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-assemble-'))
  dataDirs.push(dataDir)
  return dataDir
}

afterEach(() => {
  for (const dataDir of dataDirs.splice(0)) {
    rmSync(dataDir, { recursive: true, force: true })
  }
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

function depsFor(
  db: Database | null,
  overrides: Partial<Omit<AssembleDeps, 'loadDatabase'>> = {},
): AssembleDeps {
  return { loadDatabase: () => db, ...overrides }
}

const baseInput = (overrides: Partial<AssembleInput> = {}): AssembleInput => ({
  chatId: 'chat-1',
  characterId: 'char-tess',
  mode: 'send',
  userMessage: 'hi',
  ...overrides,
})

const startTrigger = (effect: unknown[]): never =>
  ({ comment: '', type: 'start', conditions: [], effect }) as never

function memoryEnabledDatabase(overrides: Partial<Database> = {}): Database {
  const message = [
    { role: 'user', data: 'hello', chatId: 'chat-1' },
    { role: 'char', data: 'hi there', chatId: 'chat-1' },
  ] as never
  return makeDatabase({
    maxResponse: 10,
    maxContext: 100_000,
    hypaV3: true,
    hypaModel: 'embedding-model' as never,
    hypaV3Presets: [
      {
        name: 'Test',
        settings: {
          summarizationModel: 'summary-model',
          memoryTokensRatio: 0.2,
          recentMemoryRatio: 0,
          similarMemoryRatio: 1,
        },
      },
    ] as never,
    hypaV3PresetId: 0,
    characters: [
      makeCharacter({
        supaMemory: true,
        firstMessage: 'Greetings.',
        chats: [makeChat({ id: 'chat-1', message })],
      } as Partial<character>),
    ],
    ...overrides,
  } as Partial<Database>)
}

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

    const state = beginAssembly(baseInput({ characterId: 'char-b', chatId: 'b1' }), depsFor(db))
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
        makeCharacter({
          chaId: 'char-b',
          chatPage: 1,
          chats: [makeChat({ id: 'b0' }), makeChat({ id: 'b1' })],
        }),
      ],
    } as Partial<Database>)

    const state = beginAssembly(baseInput({ characterId: 'char-b', chatId: 'b1' }), depsFor(db))
    // The resolved indices match the active pointers.
    expect(state.selectedCharID).toBe(db.currentChar)
    expect(state.chatPage).toBe(state.currentChar.chatPage)
  })
})

function seedPromptMemory(
  db: ReturnType<typeof openDatabase>,
  input: { summaryId: string; chunkId: string; text: string },
): void {
  createMemoryChunk(db, {
    id: input.chunkId,
    chatId: 'chat-1',
    rangeStartSeq: 0,
    rangeEndSeq: 1,
    text: input.text,
    status: 'summarized',
  })
  createMemorySummary(db, {
    id: input.summaryId,
    chatId: 'chat-1',
    chunkId: input.chunkId,
    model: 'summary-model',
    text: input.text,
    tokens: 5,
  })
  createMemoryEmbedding(db, {
    id: `embedding-${input.chunkId}`,
    chatId: 'chat-1',
    chunkId: input.chunkId,
    model: 'embedding-model',
    vector: [1, 0],
  })
}

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

describe('Phase 7-11d fillHistoryAndBias', () => {
  // A `start` trigger whose first effect aborts the send.
  const stopTrigger = [
    { comment: '', type: 'start', conditions: [], effect: [{ type: 'stop' }] },
  ] as never

  const run = async (db: Database) => {
    const state = beginAssembly(baseInput(), depsFor(db))
    fillStaticSlots(state)
    fillLorebookSlots(state)
    await fillHistoryAndBias(state)
    return state
  }

  it('captures history rows and threads tokens / chat / trigger result', async () => {
    const db = makeDatabase({
      maxResponse: 100,
      characters: [
        makeCharacter({
          chaId: 'char-tess',
          firstMessage: 'Hello there.',
          chats: [makeChat({ id: 'chat-1' })],
        } as Partial<character>),
      ],
    } as Partial<Database>)

    const state = beginAssembly(baseInput(), depsFor(db))
    fillStaticSlots(state)
    fillLorebookSlots(state)
    const beforeTokens = state.currentTokens ?? 0
    await fillHistoryAndBias(state)

    expect(state.stopSending).toBe(false)
    // The marker + first message are always emitted, so rows + tokens grow.
    expect(state.historyMessages?.length).toBeGreaterThan(0)
    expect(state.currentTokens ?? 0).toBeGreaterThan(beforeTokens)
    // No triggers declared → null result, unchanged chat, no var write.
    expect(state.triggerResult).toBeNull()
    expect(state.varChanged).toBe(false)
    expect(state.currentChat.id).toBe('chat-1')
  })

  it('parses bias rows: unescape + variable-expand, weights preserved', async () => {
    const db = makeDatabase({
      bias: [['line1\\nline2', 10]],
      characters: [
        makeCharacter({
          chaId: 'char-tess',
          name: 'Tess',
          bias: [['{{char}}-bias', 2]],
          chats: [makeChat({ id: 'chat-1' })],
        } as Partial<character>),
      ],
    } as Partial<Database>)

    const state = await run(db)
    // db.bias first, then per-character bias; `\n` unescaped, `{{char}}` expanded.
    expect(state.biases).toEqual([
      ['line1\nline2', 10],
      ['Tess-bias', 2],
    ])
  })

  it('short-circuits on a stopSending start trigger', async () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          chaId: 'char-tess',
          firstMessage: 'Hi.',
          triggerscript: stopTrigger,
          chats: [makeChat({ id: 'chat-1' })],
        } as Partial<character>),
      ],
    } as Partial<Database>)

    const state = await run(db)
    expect(state.stopSending).toBe(true)
    // Incomplete history + bias are not captured on abort.
    expect(state.historyMessages).toBeUndefined()
    expect(state.biases).toBeUndefined()
    // The trigger still ran, so its result is threaded out.
    expect(state.triggerResult).not.toBeNull()
    expect(state.triggerResult?.stopSending).toBe(true)
  })
})

describe('Phase 7-11e fillMemoryAndPostHistory', () => {
  const msg = (role: string, data: string, chatId: string) => ({ role, data, chatId }) as never

  const historyChar = (overrides: Partial<character> = {}): character =>
    makeCharacter({
      chaId: 'char-tess',
      firstMessage: 'Greetings.',
      chats: [
        makeChat({
          id: 'chat-1',
          message: [msg('user', 'hello'), msg('char', 'hi there')] as never,
        }),
      ],
      ...overrides,
    } as Partial<character>)

  const runAll = async (db: Database) => {
    const state = beginAssembly(baseInput(), depsFor(db))
    fillStaticSlots(state)
    fillLorebookSlots(state)
    await fillHistoryAndBias(state)
    fillMemoryAndPostHistory(state)
    return state
  }

  it('fills chats + promotes the trailing row to lastChat (non-template)', async () => {
    const db = makeDatabase({
      maxResponse: 10,
      maxContext: 100_000,
      characters: [historyChar()],
    } as Partial<Database>)

    const state = await runAll(db)
    expect(state.stopSending).toBe(false)
    expect(state.unformated.chats.length).toBeGreaterThan(0)
    expect(state.unformated.lastChat.length).toBe(1)
    // Non-memory rows are flagged removable for the 7-11f budget pass.
    expect(state.unformated.chats.every((r) => r.removable === true)).toBe(true)
    // No Hypa on the server yet, so no memory cards are split out.
    expect(state.memories).toEqual([])
  })

  it('captures assembled Hypa memory rows into template memory cards', async () => {
    const memoryDb = openDatabase(makeDataDir())
    try {
      seedPromptMemory(memoryDb, {
        summaryId: 'summary-a',
        chunkId: 'chunk-a',
        text: 'selected summary',
      })
      const db = memoryEnabledDatabase({
        promptTemplate: [{ type: 'memory', innerFormat: 'Mem: {{slot}}' }],
      } as Partial<Database>)

      const state = beginAssembly(
        baseInput(),
        depsFor(db, {
          loadMemoryDatabase: () => memoryDb,
          loadPromptMemoryQueryVectors: () => [[1, 0]],
        }),
      )
      fillStaticSlots(state)
      fillLorebookSlots(state)
      await fillHistoryAndBias(state)
      fillMemoryAndPostHistory(state)

      expect(state.stopSending).toBe(false)
      expect(state.promptMemoryRows).toEqual([
        { role: 'system', content: 'selected summary', memo: 'hypaMemory' },
      ])
      expect(state.memories?.map((row) => row.content)).toEqual(['selected summary'])
      expect(state.unformated.chats.some((row) => row.memo === 'hypaMemory')).toBe(false)
      expect(state.unformated.main).toEqual([])
      expect(state.promptMemorySelectionDiagnostics?.hotPathWork).toEqual({
        generatedQueryEmbeddings: false,
        calledProviders: false,
        generatedSummaries: false,
        enqueuedJobs: false,
        assembledPromptRows: false,
      })
      expect(state.promptMemoryRowAssemblyDiagnostics?.hotPathWork).toEqual({
        generatedQueryEmbeddings: false,
        calledProviders: false,
        generatedSummaries: false,
        enqueuedJobs: false,
        assembledPromptRows: true,
      })
    } finally {
      memoryDb.close()
    }
  })

  it('wraps assembled Hypa memory rows inline when no memory card consumes them', async () => {
    const memoryDb = openDatabase(makeDataDir())
    try {
      seedPromptMemory(memoryDb, {
        summaryId: 'summary-a',
        chunkId: 'chunk-a',
        text: 'selected summary',
      })
      const db = memoryEnabledDatabase()

      const state = beginAssembly(
        baseInput(),
        depsFor(db, {
          loadMemoryDatabase: () => memoryDb,
          loadPromptMemoryQueryVectors: () => [[1, 0]],
        }),
      )
      fillStaticSlots(state)
      fillLorebookSlots(state)
      await fillHistoryAndBias(state)
      fillMemoryAndPostHistory(state)

      expect(state.stopSending).toBe(false)
      expect(state.memories).toEqual([])
      expect(state.unformated.chats[0]).toMatchObject({
        role: 'system',
        memo: 'hypaMemory',
        content: '<Previous Conversation>selected summary</Previous Conversation>',
      })
      expect(state.unformated.lastChat.at(-1)?.content).toBe('hi there')
    } finally {
      memoryDb.close()
    }
  })

  it('enqueues missing Hypa memory summarize and embed follow-up jobs idempotently', async () => {
    const memoryDb = openDatabase(makeDataDir())
    try {
      createMemoryChunk(memoryDb, {
        id: 'chunk-needs-embed',
        chatId: 'chat-1',
        rangeStartSeq: 0,
        rangeEndSeq: 1,
        text: 'summary without embedding',
        status: 'summarized',
      })
      createMemorySummary(memoryDb, {
        id: 'summary-needs-embed',
        chatId: 'chat-1',
        chunkId: 'chunk-needs-embed',
        model: 'summary-model',
        text: 'summary without embedding',
        tokens: 5,
      })
      createMemoryChunk(memoryDb, {
        id: 'chunk-needs-summary',
        chatId: 'chat-1',
        messageId: 'memo-b',
        rangeStartSeq: 2,
        rangeEndSeq: 3,
        text: 'embedding without summary',
        status: 'pending',
      })
      createMemoryEmbedding(memoryDb, {
        id: 'embedding-needs-summary',
        chatId: 'chat-1',
        chunkId: 'chunk-needs-summary',
        model: 'embedding-model',
        vector: [1, 0],
      })
      const db = memoryEnabledDatabase()

      const first = beginAssembly(
        baseInput(),
        depsFor(db, {
          loadMemoryDatabase: () => memoryDb,
          loadPromptMemoryQueryVectors: () => [[1, 0]],
        }),
      )
      fillStaticSlots(first)
      fillLorebookSlots(first)
      await fillHistoryAndBias(first)
      fillMemoryAndPostHistory(first)

      expect(first.promptMemoryFollowUpDiagnostics).toMatchObject({
        attempted: true,
        jobsCreated: 2,
        existingJobs: 0,
        summarizeChunkIds: ['chunk-needs-summary'],
        embedChunkIds: ['chunk-needs-embed'],
        errors: [],
      })
      expect(listMemoryJobs(memoryDb, { chatId: 'chat-1' }).map((job) => job.kind).sort()).toEqual(
        ['embed', 'summarize'],
      )

      const second = beginAssembly(
        baseInput(),
        depsFor(db, {
          loadMemoryDatabase: () => memoryDb,
          loadPromptMemoryQueryVectors: () => [[1, 0]],
        }),
      )
      fillStaticSlots(second)
      fillLorebookSlots(second)
      await fillHistoryAndBias(second)
      fillMemoryAndPostHistory(second)

      expect(second.promptMemoryFollowUpDiagnostics).toMatchObject({
        attempted: true,
        jobsCreated: 0,
        existingJobs: 2,
        errors: [],
      })
      expect(listMemoryJobs(memoryDb, { chatId: 'chat-1' })).toHaveLength(2)
    } finally {
      memoryDb.close()
    }
  })

  it('does not enqueue Hypa memory follow-up jobs when diagnostics are clean', async () => {
    const memoryDb = openDatabase(makeDataDir())
    try {
      seedPromptMemory(memoryDb, {
        summaryId: 'summary-a',
        chunkId: 'chunk-a',
        text: 'selected summary',
      })
      const db = memoryEnabledDatabase()

      const state = beginAssembly(
        baseInput(),
        depsFor(db, {
          loadMemoryDatabase: () => memoryDb,
          loadPromptMemoryQueryVectors: () => [[1, 0]],
        }),
      )
      fillStaticSlots(state)
      fillLorebookSlots(state)
      await fillHistoryAndBias(state)
      fillMemoryAndPostHistory(state)

      expect(state.promptMemoryFollowUpDiagnostics).toMatchObject({
        attempted: false,
        jobsCreated: 0,
        existingJobs: 0,
        errors: [],
      })
      expect(listMemoryJobs(memoryDb, { chatId: 'chat-1' })).toEqual([])
    } finally {
      memoryDb.close()
    }
  })

  it('isolates Hypa memory follow-up enqueue failures from prompt assembly', async () => {
    const memoryDb = openDatabase(makeDataDir())
    try {
      createMemoryChunk(memoryDb, {
        id: 'chunk-needs-embed',
        chatId: 'chat-1',
        rangeStartSeq: 0,
        rangeEndSeq: 1,
        text: 'summary without embedding',
        status: 'summarized',
      })
      createMemorySummary(memoryDb, {
        id: 'summary-needs-embed',
        chatId: 'chat-1',
        chunkId: 'chunk-needs-embed',
        model: 'summary-model',
        text: 'summary without embedding',
        tokens: 5,
      })
      const db = memoryEnabledDatabase()

      const state = beginAssembly(
        baseInput(),
        depsFor(db, {
          loadMemoryDatabase: () => memoryDb,
          loadPromptMemoryQueryVectors: () => [[1, 0]],
          enqueuePromptMemoryFollowUpJob: () => {
            throw new Error('queue offline')
          },
        }),
      )
      fillStaticSlots(state)
      fillLorebookSlots(state)
      await fillHistoryAndBias(state)
      expect(() => fillMemoryAndPostHistory(state)).not.toThrow()

      expect(state.stopSending).toBe(false)
      expect(state.promptMemoryFollowUpDiagnostics).toMatchObject({
        attempted: true,
        jobsCreated: 0,
        existingJobs: 0,
        embedChunkIds: ['chunk-needs-embed'],
        errors: ['queue offline'],
      })
      expect(state.unformated.lastChat.at(-1)?.content).toBe('hi there')
    } finally {
      memoryDb.close()
    }
  })

  it('does not promote lastChat when a prompt template is in use', async () => {
    const db = makeDatabase({
      maxContext: 100_000,
      promptTemplate: [{ type: 'chat', rangeStart: 0, rangeEnd: 'end' }],
      characters: [historyChar()],
    } as Partial<Database>)

    const state = await runAll(db)
    expect(state.stopSending).toBe(false)
    expect(state.unformated.lastChat).toEqual([])
    expect(state.unformated.chats.length).toBeGreaterThan(0)
  })

  it('stops sending when the history cannot fit the context budget', async () => {
    const db = makeDatabase({
      maxResponse: 100,
      maxContext: 1,
      characters: [historyChar()],
    } as Partial<Database>)

    const state = await runAll(db)
    expect(state.stopSending).toBe(true)
    // The slots are left for the root to discard on abort.
    expect(state.unformated.chats).toEqual([])
  })

  it('places the start trigger additonalSysPrompt into postEverything / lastChat', async () => {
    const db = makeDatabase({
      maxContext: 100_000,
      characters: [historyChar()],
    } as Partial<Database>)

    const state = beginAssembly(baseInput(), depsFor(db))
    fillStaticSlots(state)
    fillLorebookSlots(state)
    await fillHistoryAndBias(state)
    // Inject a trigger result; the placement logic only reads
    // `additonalSysPrompt`.
    state.triggerResult = {
      additonalSysPrompt: { start: 'S', historyend: 'H', promptend: 'P' },
    } as never
    fillMemoryAndPostHistory(state)

    expect(state.unformated.postEverything.map((r) => r.content)).toContain('P')
    // `start` unshifts to the front, `historyend` pushes to the back.
    expect(state.unformated.lastChat[0].content).toBe('S')
    expect(state.unformated.lastChat.at(-1)?.content).toBe('H')
  })

  it('short-circuits when a prior step already set stopSending', async () => {
    const db = makeDatabase({
      maxContext: 100_000,
      characters: [historyChar()],
    } as Partial<Database>)

    const state = beginAssembly(baseInput(), depsFor(db))
    fillStaticSlots(state)
    fillLorebookSlots(state)
    await fillHistoryAndBias(state)
    state.stopSending = true
    fillMemoryAndPostHistory(state)

    // The memory window never ran, so chats stay empty.
    expect(state.unformated.chats).toEqual([])
    expect(state.memories).toBeUndefined()
  })
})

describe('Phase 7-11f renderAndBudget + assemblePrompt', () => {
  const msg = (role: string, data: string, chatId: string) => ({ role, data, chatId }) as never

  const fullDb = (overrides: Partial<Database> = {}): Database =>
    makeDatabase({
      maxContext: 100_000,
      maxResponse: 50,
      mainPrompt: 'MAIN',
      characters: [
        makeCharacter({
          chaId: 'char-tess',
          desc: 'DESC',
          firstMessage: 'Greetings.',
          chats: [
            makeChat({
              id: 'chat-1',
              message: [msg('user', 'hello'), msg('char', 'hi there')] as never,
            }),
          ],
        } as Partial<character>),
      ],
      ...overrides,
    } as Partial<Database>)

  it('assembles a prompt payload end-to-end (non-template)', async () => {
    const result = await assemblePrompt(baseInput(), depsFor(fullDb()))

    expect(result.stopSending).toBe(false)
    expect(result.prompt?.messages.length).toBeGreaterThan(0)
    expect(typeof result.inputTokens).toBe('number')
    expect(typeof result.outputTokens).toBe('number')
    expect(result.formated?.length).toBeGreaterThan(0)
    expect(Array.isArray(result.biases)).toBe(true)
    // The lorebook activation report rides along on the prompt event.
    expect(result.prompt?.lorebookActivation).toBeDefined()
  })

  it('captures template-path prompt-info (promptText) when the capture flags are on', async () => {
    // `promptText` is only populated when both prompt-info-inside-chat
    // flags are set; a `description` card then contributes a row.
    const db = fullDb({
      promptInfoInsideChat: true,
      promptTextInfoInsideChat: true,
      promptTemplate: [{ type: 'description' }, { type: 'chat', rangeStart: 0, rangeEnd: 'end' }],
    } as Partial<Database>)
    const result = await assemblePrompt(baseInput(), depsFor(db))

    expect(result.stopSending).toBe(false)
    expect(result.prompt?.promptInfo?.promptText).toBeDefined()
  })

  it('pushes the continue marker when mode is continue under a continue-marker model', async () => {
    const db = fullDb({ aiModel: 'gpt-4' } as Partial<Database>)
    const result = await assemblePrompt(baseInput({ mode: 'continue' }), depsFor(db))

    expect(result.stopSending).toBe(false)
    expect(result.formated?.some((r) => r.content === '[Continue the last response]')).toBe(true)
  })

  it('returns stopSending without a prompt when a start trigger aborts', async () => {
    const db = fullDb({
      characters: [
        makeCharacter({
          chaId: 'char-tess',
          firstMessage: 'Hi.',
          triggerscript: [
            { comment: '', type: 'start', conditions: [], effect: [{ type: 'stop' }] },
          ] as never,
          chats: [makeChat({ id: 'chat-1' })],
        } as Partial<character>),
      ],
    } as Partial<Database>)
    const result = await assemblePrompt(baseInput(), depsFor(db))

    expect(result).toMatchObject({ stopSending: true, abortReason: 'stopSending' })
    expect(result.mutations?.messageMutations[0]).toMatchObject({
      type: 'append',
      source: 'user_message',
      message: { role: 'user', data: 'hi' },
    })
  })

  it('renderAndBudget aborts with overflow when pinned rows exceed maxContext', async () => {
    // Tiny budget + a non-removable (pinned) description row → finalize
    // cannot trim it, so the budget recheck overflows.
    const state = beginAssembly(
      baseInput(),
      depsFor(makeDatabase({ maxContext: 1 } as Partial<Database>)),
    )
    state.unformated.description.push({ role: 'system', content: 'a pinned description row' })
    await renderAndBudget(state)

    expect(state.stopSending).toBe(true)
    expect(state.abortReason).toBe('overflow')
    expect(state.formated).toBeUndefined()
  })

  it('renderAndBudget short-circuits when a prior step set stopSending', async () => {
    const state = beginAssembly(baseInput(), depsFor(fullDb()))
    state.stopSending = true
    await renderAndBudget(state)

    expect(state.formated).toBeUndefined()
    expect(state.inputTokens).toBeUndefined()
  })
})

describe('Phase 7-12d-i assemble mutation contract', () => {
  const msg = (role: string, data: string, chatId: string) => ({ role, data, chatId }) as never

  const mutationDb = (overrides: Partial<Database> = {}): Database =>
    makeDatabase({
      maxContext: 100_000,
      maxResponse: 50,
      mainPrompt: 'MAIN',
      characters: [
        makeCharacter({
          chaId: 'char-tess',
          desc: 'DESC',
          firstMessage: 'Greetings.',
          triggerscript: [
            startTrigger([
              { type: 'modifychat', index: '0', value: 'edited by trigger' },
              { type: 'impersonate', role: 'char', value: 'added by trigger' },
              { type: 'setvar', operator: '=', var: 'score', value: '9' },
              { type: 'systemprompt', location: 'start', value: 'SYS' },
            ]),
          ],
          chats: [
            makeChat({
              id: 'chat-1',
              scriptstate: { $old: '1' },
              message: [msg('user', 'before {{setvar::mood::bright}}after', 'msg-1')],
            }),
          ],
        } as Partial<character>),
      ],
      ...overrides,
    } as Partial<Database>)

  it('captures user append, run-var deltas, start-trigger edits, and system prompt rows', async () => {
    const db = mutationDb()
    const result = await assemblePrompt(baseInput({ userMessage: 'new user' }), depsFor(db))

    expect(result.stopSending).toBe(false)
    expect(result.mutations).toBeDefined()
    expect(result.mutations).toMatchObject({
      chatId: 'chat-1',
      characterId: 'char-tess',
      selectedCharID: 0,
      chatPage: 0,
      varChanged: true,
    })

    const mutations = result.mutations!
    expect(mutations.messageMutations[0]).toMatchObject({
      type: 'append',
      source: 'user_message',
      index: 1,
      message: { role: 'user', data: 'new user' },
    })
    expect(
      typeof (mutations.messageMutations[0] as { message: { chatId: unknown } }).message.chatId,
    ).toBe('string')
    expect(
      typeof (mutations.messageMutations[0] as { message: { time: unknown } }).message.time,
    ).toBe('number')

    const runVarPatch = mutations.messageMutations.find((m) => m.source === 'run_var')
    expect(runVarPatch).toMatchObject({
      type: 'replace_all',
      source: 'run_var',
      beforeLength: 2,
      afterLength: 2,
    })
    expect((runVarPatch as { messages: Array<{ data: string }> }).messages[0].data).toBe(
      'before after',
    )

    const startPatch = mutations.messageMutations.find((m) => m.source === 'start_trigger')
    expect(startPatch).toMatchObject({
      type: 'replace_all',
      source: 'start_trigger',
      afterLength: 3,
    })
    expect(
      (startPatch as { messages: Array<{ data: string }> }).messages.map((m) => m.data),
    ).toEqual(['edited by trigger', 'new user', 'added by trigger'])

    expect(mutations.chatVarMutations).toEqual([
      { key: '$mood', before: null, after: 'bright' },
      { key: '$score', before: null, after: '9' },
    ])
    expect(mutations.additionalSystemPrompt).toEqual([
      {
        type: 'insert_prompt_row',
        source: 'additional_sys_prompt',
        origin: 'start',
        slot: 'lastChat',
        placement: 'unshift',
        row: { role: 'system', content: 'SYS\n\n' },
      },
    ])
  })

  it('returns mutations even when a start trigger stops prompt assembly', async () => {
    const db = mutationDb({
      characters: [
        makeCharacter({
          chaId: 'char-tess',
          firstMessage: 'Hi.',
          triggerscript: [
            startTrigger([
              { type: 'setvar', operator: '=', var: 'halted', value: 'yes' },
              { type: 'stop' },
            ]),
          ],
          chats: [makeChat({ id: 'chat-1' })],
        } as Partial<character>),
      ],
    } as Partial<Database>)

    const result = await assemblePrompt(baseInput(), depsFor(db))

    expect(result.stopSending).toBe(true)
    expect(result.prompt).toBeUndefined()
    expect(result.mutations?.varChanged).toBe(true)
    expect(result.mutations?.chatVarMutations).toEqual([
      { key: '$halted', before: null, after: 'yes' },
    ])
  })

  it('does not duplicate a user message that the persisted chat already contains', async () => {
    const db = mutationDb({
      characters: [
        makeCharacter({
          chaId: 'char-tess',
          firstMessage: 'Hi.',
          chats: [
            makeChat({
              id: 'chat-1',
              message: [msg('user', 'new user', 'msg-1')],
            }),
          ],
        } as Partial<character>),
      ],
    } as Partial<Database>)

    const result = await assemblePrompt(baseInput({ userMessage: 'new user' }), depsFor(db))

    expect(result.stopSending).toBe(false)
    expect(result.mutations?.messageMutations).toHaveLength(1)
    expect(result.mutations?.messageMutations[0]).toMatchObject({
      type: 'append',
      source: 'user_message',
      index: 0,
      message: { role: 'user', data: 'new user', chatId: 'msg-1' },
    })
  })
})
