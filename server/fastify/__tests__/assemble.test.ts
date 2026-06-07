import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type {
  Chat,
  Database,
  Message,
  character,
  loreBook,
} from '../../../src/ts/storage/database.svelte'
import type { OpenAIChat } from '../../../src/ts/process/index.svelte'
import { openDatabase } from '../src/db.js'
import {
  createMemoryChunk,
  createMemoryEmbedding,
  createMemorySummary,
  listMemoryChunks,
  listMemoryJobs,
  listMemorySummaries,
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
  buildRestorationPayload,
  getAssemblyMessageCaptureInstrumentation,
  isRunVarParserFixedPoint,
  renderAndBudget,
  resetAssemblyMessageCaptureInstrumentation,
  type AssembleDeps,
  type AssembleInput,
} from '../src/prompt/assemble.js'
import { applyDepthPrompts, buildHistoryWindow } from '../src/prompt/history.js'
import { buildAssetLookup } from '../src/prompt/assetLookup.js'
import { createRequestScopedStoredAssetResolver } from '../src/routes/generationChat.js'
import type { LoreEntryActive, LorebookActivationReport } from '../src/prompt/lorebook.js'
import { bootPromptVariables } from '../src/prompt/promptVariablesBoot.js'
import * as promptVariables from '../src/prompt/variables.js'
import {
  bumpAssemblyCbsHistoryGeneration,
  getAssemblyCbsCallbackMemoInstrumentation,
  resetAssemblyCbsCallbackMemoInstrumentation,
} from '../src/prompt/cbsCallbackMemo.js'
import {
  getChatDispatchReformatInstrumentation,
  reformatMessages,
  resetChatDispatchReformatInstrumentation,
} from '../src/prompt/chatDispatch.js'
import {
  getHypaV3PrefixTokenMemoStatsForTests,
  resetHypaV3PrefixTokenMemoForTests,
} from '../src/prompt/prefixTokenMemo.js'
import { LLMFlags } from '../../../src/ts/model/types'

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
  vi.restoreAllMocks()
  resetHypaV3PrefixTokenMemoForTests()
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

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      freezeDeep(nested)
    }
    Object.freeze(value)
  }
  return value
}

const baseInput = (overrides: Partial<AssembleInput> = {}): AssembleInput => ({
  chatId: 'chat-1',
  characterId: 'char-tess',
  mode: 'send',
  userMessage: 'hi',
  ...overrides,
})

describe('Phase 7 L1 async asset reads', () => {
  it('L1: repeated asset prompt refs share one async stored-asset read during assembly', async () => {
    const assetId = 'c'.repeat(64)
    const reads: string[] = []
    const resolveStoredAsset = createRequestScopedStoredAssetResolver(
      null as never,
      '/data',
      async (_db, _dataDir, id, purpose) => {
        await Promise.resolve()
        reads.push(`${purpose}:${id}`)
        return { type: 'image', base64: `data:${purpose}:${id}` }
      },
    )
    const db = makeDatabase({
      maxContext: 100_000,
      maxResponse: 50,
      characters: [
        makeCharacter({
          firstMessage: '',
          additionalAssets: [['hero', assetId, '']],
          chats: [
            makeChat({
              id: 'chat-1',
              message: [
                {
                  role: 'user',
                  data: 'show {{asset_prompt::hero}} and {{asset_prompt::hero}}',
                  chatId: 'repeated-asset-row',
                } as Message,
              ],
            }),
          ],
        } as Partial<character>),
      ],
    } as Partial<Database>)

    const currentChar = db.characters[0]
    const currentChat = currentChar.chats[0]
    const history = await buildHistoryWindow(
      { database: db },
      currentChar,
      currentChat,
      false,
      buildAssetLookup({
        database: db,
        currentChar,
        currentChat,
        inlayAssets: undefined,
        resolveStoredAsset,
      }),
    )

    const row = history.messages.find((entry) => entry.memo === 'repeated-asset-row')
    expect(row?.content).toBe('show  and ')
    expect(row?.multimodals).toEqual([
      { type: 'image', base64: `data:asset_prompt:${assetId}` },
      { type: 'image', base64: `data:asset_prompt:${assetId}` },
    ])
    expect(reads).toEqual([`asset_prompt:${assetId}`])
  })
})

describe('Phase 7 L3/K3 dispatch and restoration clone narrowing', () => {
  it('L3: returns default OpenAI-flag rows by reference without mutation or prompt clones', () => {
    resetChatDispatchReformatInstrumentation()
    const rows = freezeDeep([
      {
        role: 'system',
        content: 'system row',
        multimodals: [{ type: 'image', base64: 'data:image/png;base64,AAAA' }],
      },
      { role: 'user', content: 'hello' },
    ] satisfies OpenAIChat[]) as OpenAIChat[]
    const before = JSON.stringify(rows)

    const result = reformatMessages(makeDatabase(), rows, [
      LLMFlags.hasFullSystemPrompt,
      LLMFlags.hasStreaming,
    ])

    expect(result).toBe(rows)
    expect(JSON.stringify(rows)).toBe(before)
    expect(getChatDispatchReformatInstrumentation().fullPromptClones).toBe(0)
  })

  it.each([
    {
      name: 'system role replacement',
      db: makeDatabase(),
      flags: [],
      rows: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ] satisfies OpenAIChat[],
      expected: [
        { role: 'user', content: 'system: sys' },
        { role: 'user', content: 'hi' },
      ],
    },
    {
      name: 'first system hoist',
      db: makeDatabase(),
      flags: [LLMFlags.hasFirstSystemPrompt],
      rows: [
        { role: 'system', content: 'sys one' },
        { role: 'system', content: 'sys two' },
        { role: 'user', content: 'hi' },
        { role: 'system', content: 'inner' },
      ] satisfies OpenAIChat[],
      expected: [
        { role: 'system', content: 'sys one\n\nsys two' },
        { role: 'user', content: 'hi' },
        { role: 'user', content: 'system: inner' },
      ],
    },
    {
      name: 'alternate role merge',
      db: makeDatabase(),
      flags: [LLMFlags.hasFullSystemPrompt, LLMFlags.requiresAlternateRole],
      rows: [
        {
          role: 'user',
          content: 'one',
          multimodals: [{ type: 'image', base64: 'one' }],
          cachePoint: true,
        },
        {
          role: 'user',
          content: 'two',
          multimodals: [{ type: 'image', base64: 'two' }],
          thoughts: ['think'],
        },
        { role: 'assistant', content: 'reply' },
      ] satisfies OpenAIChat[],
      expected: [
        {
          role: 'user',
          content: 'one\ntwo',
          multimodals: [
            { type: 'image', base64: 'one' },
            { type: 'image', base64: 'two' },
          ],
          cachePoint: true,
          thoughts: ['think'],
        },
        { role: 'assistant', content: 'reply' },
      ],
    },
    {
      name: 'must start with user',
      db: makeDatabase(),
      flags: [LLMFlags.hasFullSystemPrompt, LLMFlags.mustStartWithUserInput],
      rows: [{ role: 'assistant', content: 'prefill' }] satisfies OpenAIChat[],
      expected: [
        { role: 'user', content: ' ' },
        { role: 'assistant', content: 'prefill' },
      ],
    },
  ])('L3: preserves byte-identical output and isolation for $name', ({ db, flags, rows, expected }) => {
    resetChatDispatchReformatInstrumentation()
    const sourceRows = rows as OpenAIChat[]
    const originalRows = structuredClone(sourceRows)

    const result = reformatMessages(db, sourceRows, flags)

    expect(result).not.toBe(sourceRows)
    expect(JSON.stringify(result)).toBe(JSON.stringify(expected))
    expect(sourceRows).toEqual(originalRows)
    expect(result.some((row) => sourceRows.includes(row))).toBe(false)
    expect(getChatDispatchReformatInstrumentation().fullPromptClones).toBe(1)
  })

  it('K3: returns immutable initial restoration messages by reference and clones scriptstate', () => {
    const initialMessages = freezeDeep([
      { role: 'user', data: 'before', chatId: 'msg-1' },
    ] satisfies Message[]) as Message[]
    const initialScriptstate = { $mood: 'calm' }
    const state = {
      input: baseInput(),
      selectedCharID: 0,
      chatPage: 0,
      initialMessages,
      initialScriptstate,
    } as unknown as ReturnType<typeof beginAssembly>

    const restoration = buildRestorationPayload(state)

    expect(restoration.messages).toBe(initialMessages)
    expect(restoration.messages).toEqual([{ role: 'user', data: 'before', chatId: 'msg-1' }])
    expect(restoration.scriptstate).toEqual(initialScriptstate)
    expect(restoration.scriptstate).not.toBe(initialScriptstate)
    expect(() => restoration.messages.push({ role: 'char', data: 'mutate' } as Message)).toThrow()
  })
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
    expect(state.selectedCharID).toBe((db as any).currentChar)
    expect(state.chatPage).toBe(state.currentChar.chatPage)
  })
})

function seedPromptMemory(
  db: ReturnType<typeof openDatabase>,
  input: {
    summaryId: string
    chunkId: string
    text: string
    embeddingModel?: string
    rangeStartSeq?: number
    tokens?: number
    vector?: number[]
  },
): void {
  const rangeStartSeq = input.rangeStartSeq ?? 0
  createMemoryChunk(db, {
    id: input.chunkId,
    chatId: 'chat-1',
    rangeStartSeq,
    rangeEndSeq: rangeStartSeq + 1,
    text: input.text,
    status: 'summarized',
  })
  createMemorySummary(db, {
    id: input.summaryId,
    chatId: 'chat-1',
    chunkId: input.chunkId,
    model: 'summary-model',
    text: input.text,
    tokens: input.tokens ?? 5,
  })
  createMemoryEmbedding(db, {
    id: `embedding-${input.chunkId}`,
    chatId: 'chat-1',
    chunkId: input.chunkId,
    model: input.embeddingModel ?? 'embedding-model',
    vector: input.vector ?? [1, 0],
  })
}

function chunkPlanningHistory(): OpenAIChat[] {
  return [
    {
      role: 'user',
      content: 'alpha '.repeat(80),
      memo: 'memo-a',
    },
    {
      role: 'assistant',
      content: 'bravo '.repeat(80),
      memo: 'memo-b',
    },
    {
      role: 'user',
      content: 'charlie '.repeat(80),
      memo: 'memo-c',
    },
  ]
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
    expect(state.ctx).toMatchObject({ database: db, selectedCharID: 0, chatPage: 0 })
    expect(state.ctx.cbsCallbackMemo).toBe(state.cbsCallbackMemo)
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

  it('does not emit unsupported logit-bias rows', async () => {
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
    expect('biases' in state).toBe(false)
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
    // Incomplete history is not captured on abort.
    expect(state.historyMessages).toBeUndefined()
    expect('biases' in state).toBe(false)
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
          message: [msg('user', 'hello', 'msg-1'), msg('char', 'hi there', 'msg-2')] as never,
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

  it('L20: selects retained memory from the shared post-cleanup summary snapshot', async () => {
    const memoryDb = openDatabase(makeDataDir())
    try {
      createMemoryChunk(memoryDb, {
        id: 'chunk-keep',
        chatId: 'chat-1',
        rangeStartSeq: 0,
        rangeEndSeq: 1,
        text: 'selected summary',
        status: 'summarized',
      })
      createMemoryChunk(memoryDb, {
        id: 'chunk-orphan',
        chatId: 'chat-1',
        rangeStartSeq: 2,
        rangeEndSeq: 3,
        text: 'orphan summary',
        status: 'summarized',
      })
      createMemorySummary(memoryDb, {
        id: 'summary-keep',
        chatId: 'chat-1',
        chunkId: 'chunk-keep',
        model: 'summary-model',
        text: 'selected summary',
        metadata: { chatMemos: ['chat-1'] },
        tokens: 5,
      })
      createMemorySummary(memoryDb, {
        id: 'summary-orphan',
        chatId: 'chat-1',
        chunkId: 'chunk-orphan',
        model: 'summary-model',
        text: 'orphan summary',
        metadata: { chatMemos: ['removed-memo'] },
        tokens: 5,
      })
      createMemoryEmbedding(memoryDb, {
        id: 'embedding-keep',
        chatId: 'chat-1',
        chunkId: 'chunk-keep',
        model: 'embedding-model',
        vector: [1, 0],
      })
      createMemoryEmbedding(memoryDb, {
        id: 'embedding-orphan',
        chatId: 'chat-1',
        chunkId: 'chunk-orphan',
        model: 'embedding-model',
        vector: [1, 0],
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

      expect(state.promptMemoryChunkPlanningDiagnostics?.cleanup).toEqual({
        summariesDeleted: 1,
        chunksDeleted: 1,
      })
      expect(state.promptMemoryRows).toEqual([
        { role: 'system', content: 'selected summary', memo: 'hypaMemory' },
      ])
      expect(
        listMemorySummaries(memoryDb, { chatId: 'chat-1' }).map((summary) => summary.id),
      ).toEqual(['summary-keep'])
      expect(listMemoryChunks(memoryDb, { chatId: 'chat-1' }).map((chunk) => chunk.id)).toEqual([
        'chunk-keep',
      ])
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

  it('selects prompt memory with the stable custom embedding model key', async () => {
    const memoryDb = openDatabase(makeDataDir())
    try {
      seedPromptMemory(memoryDb, {
        summaryId: 'summary-custom',
        chunkId: 'chunk-custom',
        text: 'selected custom summary',
        embeddingModel: 'custom',
      })
      const db = memoryEnabledDatabase({
        hypaModel: 'custom',
        hypaCustomSettings: {
          url: 'https://embeddings.example.test/v1',
          key: 'custom-key',
          model: 'custom-wire-model',
        },
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

      expect(state.promptMemoryRows).toEqual([
        {
          role: 'system',
          content: '<Previous Conversation>selected custom summary</Previous Conversation>',
          memo: 'hypaMemory',
        },
      ])
      expect(state.promptMemorySelectionDiagnostics?.missingMemory).toMatchObject({
        hasMissingMemory: false,
        chunkIdsMissingEmbeddings: [],
      })
      expect(state.promptMemoryFollowUpDiagnostics).toMatchObject({
        attempted: false,
        jobsCreated: 0,
      })
    } finally {
      memoryDb.close()
    }
  })

  it('plans missing Hypa chunks and summarize jobs before prompt memory selection', async () => {
    const memoryDb = openDatabase(makeDataDir())
    try {
      const db = memoryEnabledDatabase({
        maxContext: 100,
        maxResponse: 0,
        hypaV3Presets: [
          {
            name: 'Test',
            settings: {
              summarizationModel: 'summary-model',
              memoryTokensRatio: 0.2,
              recentMemoryRatio: 0,
              similarMemoryRatio: 1,
              maxChatsPerSummary: 2,
              queryChatCount: 1,
            },
          },
        ] as never,
      })
      const history = chunkPlanningHistory()

      const first = beginAssembly(
        baseInput(),
        depsFor(db, {
          loadMemoryDatabase: () => memoryDb,
          loadPromptMemoryQueryVectors: () => [],
        }),
      )
      first.historyMessages = structuredClone(history)
      first.currentTokens = 99
      fillMemoryAndPostHistory(first)

      expect(first.stopSending).not.toBe(true)
      expect(first.promptMemoryChunkPlanningDiagnostics).toMatchObject({
        attempted: true,
        chunksCreated: 1,
        jobsCreated: 1,
        plannedWindows: 1,
        plannerErrors: [],
        errors: [],
      })
      const chunks = listMemoryChunks(memoryDb, { chatId: 'chat-1' })
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toMatchObject({
        chatId: 'chat-1',
        messageId: 'memo-b',
        rangeStartSeq: 0,
        rangeEndSeq: 1,
        status: 'pending',
      })
      expect(chunks[0].text).toContain('user: alpha')
      expect(chunks[0].text).toContain('assistant: bravo')

      const jobs = listMemoryJobs(memoryDb, { chatId: 'chat-1', kind: 'summarize' })
      expect(jobs).toHaveLength(1)
      expect(jobs[0]).toMatchObject({
        chatId: 'chat-1',
        kind: 'summarize',
        status: 'pending',
        payload: {
          chunkId: chunks[0].id,
          model: 'summary-model',
          rangeStartSeq: 0,
          rangeEndSeq: 1,
          messageIndexes: [0, 1],
          chatMemos: ['memo-a', 'memo-b'],
        },
      })

      const second = beginAssembly(
        baseInput(),
        depsFor(db, {
          loadMemoryDatabase: () => memoryDb,
          loadPromptMemoryQueryVectors: () => [],
        }),
      )
      second.historyMessages = structuredClone(history)
      second.currentTokens = 99
      fillMemoryAndPostHistory(second)

      expect(second.promptMemoryChunkPlanningDiagnostics).toMatchObject({
        attempted: true,
        chunksCreated: 0,
        jobsCreated: 0,
        plannedWindows: 1,
        errors: [],
      })
      expect(listMemoryChunks(memoryDb, { chatId: 'chat-1' })).toHaveLength(1)
      expect(listMemoryJobs(memoryDb, { chatId: 'chat-1', kind: 'summarize' })).toHaveLength(1)
    } finally {
      memoryDb.close()
    }
  })

  it('L15: memoizes unchanged summarized-prefix token counts across assembly planning passes', () => {
    const memoryDb = openDatabase(makeDataDir())
    try {
      createMemoryChunk(memoryDb, {
        id: 'prefix-chunk',
        chatId: 'chat-1',
        rangeStartSeq: 0,
        rangeEndSeq: 1,
        text: 'already summarized prefix',
        status: 'summarized',
      })
      createMemorySummary(memoryDb, {
        id: 'prefix-summary',
        chatId: 'chat-1',
        chunkId: 'prefix-chunk',
        model: 'summary-model',
        text: 'already summarized prefix',
        metadata: { chatMemos: ['memo-a', 'memo-b'] },
        tokens: 5,
      })
      const db = memoryEnabledDatabase({
        maxContext: 1000,
        maxResponse: 0,
        hypaV3Presets: [
          {
            name: 'Test',
            settings: {
              summarizationModel: 'summary-model',
              memoryTokensRatio: 0.2,
              recentMemoryRatio: 0,
              similarMemoryRatio: 1,
              maxChatsPerSummary: 2,
              queryChatCount: 1,
            },
          },
        ] as never,
      })
      const history = chunkPlanningHistory()
      const runAssemblyPlanning = () => {
        const state = beginAssembly(
          baseInput(),
          depsFor(db, {
            loadMemoryDatabase: () => memoryDb,
            loadPromptMemoryQueryVectors: () => [],
          }),
        )
        state.historyMessages = structuredClone(history)
        state.currentTokens = 300
        fillMemoryAndPostHistory(state)
        return state
      }

      resetHypaV3PrefixTokenMemoForTests()
      const first = runAssemblyPlanning()
      const firstStats = getHypaV3PrefixTokenMemoStatsForTests()
      const second = runAssemblyPlanning()
      const secondStats = getHypaV3PrefixTokenMemoStatsForTests()

      expect(first.promptMemoryChunkPlanningDiagnostics).toMatchObject({
        attempted: true,
        plannedWindows: 0,
        plannerErrors: [],
        errors: [],
      })
      expect(second.promptMemoryChunkPlanningDiagnostics).toEqual(
        first.promptMemoryChunkPlanningDiagnostics,
      )
      expect(firstStats).toMatchObject({ entries: 2, hits: 0, misses: 2 })
      expect(secondStats.misses).toBe(firstStats.misses)
      expect(secondStats.hits - firstStats.hits).toBe(2)
    } finally {
      memoryDb.close()
    }
  })

  it('M2: budgets tokens:0 prompt summaries with memory and category ratios', async () => {
    const memoryDb = openDatabase(makeDataDir())
    try {
      const texts = ['one', 'two', 'three', 'four'].map((label) => `${label} memory `.repeat(8))
      for (const [index, text] of texts.entries()) {
        seedPromptMemory(memoryDb, {
          summaryId: `summary-${index + 1}`,
          chunkId: `chunk-${index + 1}`,
          text,
          rangeStartSeq: index * 2,
          tokens: 0,
          vector: index === 0 ? [1, 0] : [0, 1],
        })
      }
      const dbFor = (memoryTokensRatio: number): Database =>
        memoryEnabledDatabase({
          maxContext: 100,
          maxResponse: 0,
          promptTemplate: [{ type: 'memory', innerFormat: 'Mem: {{slot}}' }],
          hypaV3Presets: [
            {
              name: 'Test',
              settings: {
                summarizationModel: 'summary-model',
                memoryTokensRatio,
                recentMemoryRatio: 0.5,
                similarMemoryRatio: 0.5,
                maxChatsPerSummary: 2,
                queryChatCount: 1,
              },
            },
          ] as never,
        })
      const selectMemory = async (db: Database) => {
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
        return state
      }

      const bounded = await selectMemory(dbFor(0.5))

      expect(bounded.promptMemoryRows?.map((row) => row.content)).toEqual([
        texts[0].trim(),
        texts[3].trim(),
      ])
      const boundedAllocation = bounded.promptMemorySelectionDiagnostics?.selection?.allocation
      expect(boundedAllocation).toMatchObject({
        availableTokens: 50,
        consumedTokens: 34,
        recentMemoryRatio: 0.5,
        similarMemoryRatio: 0.5,
      })
      expect(boundedAllocation?.categories.recent).toMatchObject({
        reservedTokens: 25,
        consumedTokens: 17,
        selectedCount: 1,
        skippedForBudget: [{ summaryId: 'summary-3', tokens: 17 }],
      })
      expect(boundedAllocation?.categories.similar).toMatchObject({
        reservedTokens: 33,
        consumedTokens: 17,
        selectedCount: 1,
        skippedForBudget: [{ summaryId: 'summary-2', tokens: 17 }],
      })

      const tighter = await selectMemory(dbFor(0.15))

      expect(tighter.promptMemoryRows).toEqual([])
      expect(tighter.promptMemorySelectionDiagnostics?.selection?.allocation).toMatchObject({
        availableTokens: 15,
        consumedTokens: 0,
        remainingTokens: 15,
      })
      expect(
        tighter.promptMemorySelectionDiagnostics?.selection?.allocation.categories.similar
          .skippedForBudget,
      ).toEqual([{ summaryId: 'summary-1', tokens: 17 }])
    } finally {
      memoryDb.close()
    }
  })

  it('M2: caps tokens:0 Hypa memory before final budgeting so old summaries do not overflow', async () => {
    const memoryDb = openDatabase(makeDataDir())
    try {
      const labels = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']
      for (const [index, label] of labels.entries()) {
        seedPromptMemory(memoryDb, {
          summaryId: `overflow-summary-${index + 1}`,
          chunkId: `overflow-chunk-${index + 1}`,
          text: `${label} memory `.repeat(8),
          rangeStartSeq: index * 2,
          tokens: 0,
          vector: [1, 0],
        })
      }
      const db = memoryEnabledDatabase({
        maxContext: 90,
        maxResponse: 0,
        hypaV3Presets: [
          {
            name: 'Test',
            settings: {
              summarizationModel: 'summary-model',
              memoryTokensRatio: 0.3,
              recentMemoryRatio: 1,
              similarMemoryRatio: 0,
              maxChatsPerSummary: 2,
              queryChatCount: 1,
            },
          },
        ] as never,
      })
      const state = beginAssembly(
        baseInput(),
        depsFor(db, {
          loadMemoryDatabase: () => memoryDb,
          loadPromptMemoryQueryVectors: () => [],
        }),
      )
      fillStaticSlots(state)
      fillLorebookSlots(state)
      await fillHistoryAndBias(state)
      fillMemoryAndPostHistory(state)

      expect(state.promptMemoryRows).toHaveLength(1)
      expect(
        state.promptMemorySelectionDiagnostics?.selection?.allocation.categories.recent
          .skippedForBudget,
      ).toEqual([{ summaryId: 'overflow-summary-7', tokens: 17 }])

      await renderAndBudget(state)

      expect(state.stopSending).toBe(false)
      expect(state.abortReason).toBeUndefined()
      expect(state.formated?.filter((row) => row.memo === 'hypaMemory')).toHaveLength(1)
      expect(state.inputTokens).toBeLessThanOrEqual(db.maxContext)
    } finally {
      memoryDb.close()
    }
  })

  it('keeps prompt assembly running when chunk planning reports validation errors', async () => {
    const memoryDb = openDatabase(makeDataDir())
    try {
      const db = memoryEnabledDatabase({
        maxContext: 100,
        maxResponse: 0,
        hypaV3Presets: [
          {
            name: 'Invalid',
            settings: {
              summarizationModel: 'summary-model',
              memoryTokensRatio: 0.2,
              recentMemoryRatio: 0,
              similarMemoryRatio: 1,
              maxChatsPerSummary: 0,
              queryChatCount: 1,
            },
          },
        ] as never,
      })
      const state = beginAssembly(
        baseInput(),
        depsFor(db, {
          loadMemoryDatabase: () => memoryDb,
          loadPromptMemoryQueryVectors: () => [],
        }),
      )
      state.historyMessages = chunkPlanningHistory()
      state.currentTokens = 99

      fillMemoryAndPostHistory(state)

      expect(state.stopSending).not.toBe(true)
      expect(state.promptMemoryChunkPlanningDiagnostics).toMatchObject({
        attempted: true,
        chunksCreated: 0,
        jobsCreated: 0,
        plannedWindows: 0,
        errors: [],
      })
      expect(state.promptMemoryChunkPlanningDiagnostics?.plannerErrors).toEqual([
        'maxChatsPerSummary must be a positive integer.',
      ])
      expect(listMemoryChunks(memoryDb, { chatId: 'chat-1' })).toEqual([])
      expect(listMemoryJobs(memoryDb, { chatId: 'chat-1' })).toEqual([])
      expect(state.unformated.lastChat.at(-1)?.content).toBe('charlie '.repeat(80))
    } finally {
      memoryDb.close()
    }
  })

  it('enqueues custom embedding follow-ups with the stable model key', async () => {
    const memoryDb = openDatabase(makeDataDir())
    try {
      createMemoryChunk(memoryDb, {
        id: 'chunk-needs-custom-embed',
        chatId: 'chat-1',
        rangeStartSeq: 0,
        rangeEndSeq: 1,
        text: 'summary without custom embedding',
        status: 'summarized',
      })
      createMemorySummary(memoryDb, {
        id: 'summary-needs-custom-embed',
        chatId: 'chat-1',
        chunkId: 'chunk-needs-custom-embed',
        model: 'summary-model',
        text: 'summary without custom embedding',
        tokens: 5,
      })
      const db = memoryEnabledDatabase({
        hypaModel: 'custom',
        hypaCustomSettings: {
          url: 'https://embeddings.example.test/v1',
          key: 'custom-key',
          model: 'custom-wire-model',
        },
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

      expect(state.promptMemorySelectionDiagnostics?.missingMemory).toMatchObject({
        hasMissingMemory: true,
        summaryIdsMissingEmbeddings: ['summary-needs-custom-embed'],
        chunkIdsMissingEmbeddings: ['chunk-needs-custom-embed'],
      })
      expect(state.promptMemoryFollowUpDiagnostics).toMatchObject({
        attempted: true,
        jobsCreated: 1,
        embedChunkIds: ['chunk-needs-custom-embed'],
        errors: [],
      })
      expect(listMemoryJobs(memoryDb, { chatId: 'chat-1', kind: 'embed' })).toMatchObject([
        {
          payload: {
            schemaVersion: 1,
            chunkId: 'chunk-needs-custom-embed',
            model: 'custom',
          },
        },
      ])
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
      createMemoryChunk(memoryDb, {
        id: 'chunk-needs-summary-without-embedding',
        chatId: 'chat-1',
        messageId: 'memo-c',
        rangeStartSeq: 4,
        rangeEndSeq: 5,
        text: 'chunk without summary or embedding',
        status: 'pending',
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

      expect(first.promptMemorySelectionDiagnostics?.missingMemory).toEqual({
        emptySelection: true,
        hasMissingMemory: true,
        summaryIdsMissingChunks: [],
        summaryIdsMissingEmbeddings: ['summary-needs-embed'],
        chunkIdsMissingEmbeddings: ['chunk-needs-embed'],
        chunkIdsMissingSummaries: ['chunk-needs-summary', 'chunk-needs-summary-without-embedding'],
        followUpEligible: true,
      })
      expect(first.promptMemoryFollowUpDiagnostics).toMatchObject({
        attempted: true,
        jobsCreated: 3,
        existingJobs: 0,
        summarizeChunkIds: ['chunk-needs-summary', 'chunk-needs-summary-without-embedding'],
        embedChunkIds: ['chunk-needs-embed'],
        errors: [],
      })
      expect(
        listMemoryJobs(memoryDb, { chatId: 'chat-1' })
          .map((job) => job.kind)
          .sort(),
      ).toEqual(['embed', 'summarize', 'summarize'])

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
        existingJobs: 3,
        errors: [],
      })
      expect(listMemoryJobs(memoryDb, { chatId: 'chat-1' })).toHaveLength(3)
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
              message: [msg('user', 'hello', 'msg-1'), msg('char', 'hi there', 'msg-2')] as never,
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
    expect('biases' in result).toBe(false)
    expect('biases' in result.prompt!).toBe(false)
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

  it('truncates the latest assistant message before regenerate assembly', async () => {
    const db = fullDb({
      characters: [
        makeCharacter({
          chaId: 'char-tess',
          desc: 'DESC',
          firstMessage: 'Greetings.',
          chats: [
            makeChat({
              id: 'chat-1',
              message: [
                msg('user', 'first prompt', 'msg-user-1'),
                { ...(msg('char', 'old reply', 'msg-char-1') as any), saying: 'char-tess' },
              ] as never,
            }),
          ],
        } as Partial<character>),
      ],
    } as Partial<Database>)

    const result = await assemblePrompt(
      baseInput({
        mode: 'regenerate',
        userMessage: undefined,
        regenerateMessageId: 'msg-char-1',
      }),
      depsFor(db),
    )

    expect(result.stopSending).toBe(false)
    expect(result.formated?.some((row) => row.content === 'old reply')).toBe(false)
    expect(result.mutations?.messageMutations).toEqual([
      {
        type: 'replace_all',
        source: 'regenerate',
        beforeLength: 2,
        afterLength: 1,
        messages: [msg('user', 'first prompt', 'msg-user-1')],
      },
    ])
  })

  it('rejects regenerate targets that are not the latest assistant message', async () => {
    const db = fullDb({
      characters: [
        makeCharacter({
          chaId: 'char-tess',
          chats: [
            makeChat({
              id: 'chat-1',
              message: [
                msg('user', 'first prompt', 'msg-user-1'),
                msg('char', 'older reply', 'msg-char-1'),
                msg('user', 'new prompt', 'msg-user-2'),
              ] as never,
            }),
          ],
        } as Partial<character>),
      ],
    } as Partial<Database>)

    await expect(
      assemblePrompt(
        baseInput({
          mode: 'regenerate',
          userMessage: undefined,
          regenerateMessageId: 'msg-char-1',
        }),
        depsFor(db),
      ),
    ).rejects.toThrow(/latest assistant message/)
  })

  it('accepts an already-truncated regenerate transcript from the browser command race', async () => {
    const db = fullDb({
      characters: [
        makeCharacter({
          chaId: 'char-tess',
          chats: [
            makeChat({
              id: 'chat-1',
              message: [msg('user', 'first prompt', 'msg-user-1')] as never,
            }),
          ],
        } as Partial<character>),
      ],
    } as Partial<Database>)

    const result = await assemblePrompt(
      baseInput({
        mode: 'regenerate',
        userMessage: undefined,
        regenerateMessageId: 'msg-char-1',
      }),
      depsFor(db),
    )

    expect(result.stopSending).toBe(false)
    expect(result.mutations?.messageMutations).toEqual([])
    expect(result.formated?.some((row) => row.content === 'old reply')).toBe(false)
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

describe('Phase 3 M1 assembly message capture dirty flags', () => {
  const msg = (role: string, data: string, chatId: string) => ({ role, data, chatId }) as never

  const m1Db = (
    messages: Message[] = [],
    overrides: { db?: Partial<Database>; char?: Partial<character>; chat?: Partial<Chat> } = {},
  ): Database =>
    makeDatabase({
      maxContext: 100_000,
      maxResponse: 50,
      mainPrompt: 'MAIN',
      characters: [
        makeCharacter({
          chaId: 'char-tess',
          name: 'Tess',
          desc: 'DESC',
          firstMessage: 'Greetings.',
          chats: [
            makeChat({
              id: 'chat-1',
              message: messages as never,
              ...overrides.chat,
            }),
          ],
          ...overrides.char,
        } as Partial<character>),
      ],
      ...overrides.db,
    } as Partial<Database>)

  const captureCount = (
    source: keyof ReturnType<
      typeof getAssemblyMessageCaptureInstrumentation
    >['messageReplacementCaptures'],
  ): number => getAssemblyMessageCaptureInstrumentation().messageReplacementCaptures[source] ?? 0

  function expectNoFullTranscriptStringify(): void {
    expect(getAssemblyMessageCaptureInstrumentation().fullTranscriptStringifies).toBe(0)
  }

  it('does not clone or stringify unchanged capture stages for a plain send', async () => {
    resetAssemblyMessageCaptureInstrumentation()

    const result = await assemblePrompt(
      baseInput({ userMessage: 'plain user text' }),
      depsFor(m1Db([msg('user', 'plain history text', 'msg-1')])),
    )

    expect(result.stopSending).toBe(false)
    expect(result.mutations?.messageMutations.map((mutation) => mutation.source)).toEqual([
      'user_message',
    ])
    const metrics = getAssemblyMessageCaptureInstrumentation()
    expect(metrics.fullTranscriptClones.messageReplacement).toBe(0)
    expect(metrics.fullTranscriptClones.submitTranscript).toBe(0)
    expect(metrics.messageReplacementComparisons).toBe(0)
    expect(metrics.messageReplacementCaptures).toEqual({})
    expectNoFullTranscriptStringify()
  })

  it('keeps run-var fixed-point rows out of message capture but captures a real rewrite once', async () => {
    resetAssemblyMessageCaptureInstrumentation()
    const fixed = await assemblePrompt(
      baseInput({ mode: 'preview', userMessage: undefined }),
      depsFor(m1Db([msg('user', 'marker-free history', 'msg-1')])),
    )

    expect(fixed.stopSending).toBe(false)
    expect(fixed.mutations?.messageMutations).toEqual([])
    expect(captureCount('run_var')).toBe(0)
    expect(getAssemblyMessageCaptureInstrumentation().fullTranscriptClones.messageReplacement).toBe(
      0,
    )
    expectNoFullTranscriptStringify()

    resetAssemblyMessageCaptureInstrumentation()
    const rewritten = await assemblePrompt(
      baseInput({ mode: 'preview', userMessage: undefined }),
      depsFor(m1Db([msg('char', 'I am <bot>. {{setvar::mood::bright}}', 'msg-1')])),
    )

    expect(rewritten.stopSending).toBe(false)
    expect(captureCount('run_var')).toBe(1)
    expect(getAssemblyMessageCaptureInstrumentation().fullTranscriptClones.messageReplacement).toBe(
      1,
    )
    const runVarPatch = rewritten.mutations?.messageMutations.find(
      (mutation) => mutation.source === 'run_var',
    )
    expect(runVarPatch).toMatchObject({
      type: 'replace_all',
      source: 'run_var',
      beforeLength: 1,
      afterLength: 1,
      messages: [{ role: 'char', data: 'I am Tess. ', chatId: 'msg-1' }],
    })
    expect(rewritten.mutations?.chatVarMutations).toEqual([
      { key: '$mood', before: null, after: 'bright' },
    ])
    expectNoFullTranscriptStringify()
  })

  it('persists chat-var-only dirty state without forcing a message replacement capture', async () => {
    resetAssemblyMessageCaptureInstrumentation()

    const result = await assemblePrompt(
      baseInput({ userMessage: 'new user' }),
      depsFor(
        m1Db([], {
          char: {
            triggerscript: [
              startTrigger([{ type: 'setvar', operator: '=', var: 'score', value: '9' }]),
            ] as never,
          },
        }),
      ),
    )

    expect(result.stopSending).toBe(false)
    expect(result.mutations?.varChanged).toBe(true)
    expect(result.mutations?.chatVarMutations).toEqual([
      { key: '$score', before: null, after: '9' },
    ])
    expect(result.mutations?.messageMutations.map((mutation) => mutation.source)).toEqual([
      'user_message',
    ])
    expect(getAssemblyMessageCaptureInstrumentation().fullTranscriptClones.messageReplacement).toBe(
      0,
    )
    expect(captureCount('start_trigger')).toBe(0)
    expectNoFullTranscriptStringify()
  })

  it('captures input-trigger transcript rewrites once and keeps restoration at the original transcript', async () => {
    resetAssemblyMessageCaptureInstrumentation()

    const result = await assemblePrompt(
      baseInput({ userMessage: 'new user' }),
      depsFor(
        m1Db([], {
          char: {
            triggerscript: [
              {
                comment: '',
                type: 'input',
                conditions: [],
                effect: [{ type: 'impersonate', role: 'char', value: 'input row' }],
              },
            ] as never,
          },
        }),
      ),
    )

    expect(result.stopSending).toBe(false)
    expect(result.mutations?.messageMutations.map((mutation) => mutation.source)).toEqual([
      'input_trigger',
      'user_message',
    ])
    expect(captureCount('input_trigger')).toBe(1)
    expect(getAssemblyMessageCaptureInstrumentation().fullTranscriptClones.messageReplacement).toBe(
      1,
    )
    expect(getAssemblyMessageCaptureInstrumentation().fullTranscriptClones.submitTranscript).toBe(1)
    expect(result.submitTranscriptChanged).toBe(true)
    expect(
      result.submitMessages?.map((message) => ({ role: message.role, data: message.data })),
    ).toEqual([
      { role: 'char', data: 'input row' },
      { role: 'user', data: 'new user' },
    ])
    expect(result.restoration?.messages).toEqual([])
    expectNoFullTranscriptStringify()
  })

  it('captures editinput rewrites once after the appended user checkpoint', async () => {
    resetAssemblyMessageCaptureInstrumentation()

    const result = await assemblePrompt(
      baseInput({ userMessage: 'hi' }),
      depsFor(
        m1Db([], {
          char: {
            customscript: [
              { in: 'hi', out: 'HELLO', type: 'editinput', flag: '', ableFlag: false },
            ] as never,
          },
        }),
      ),
    )

    expect(result.stopSending).toBe(false)
    expect(result.mutations?.messageMutations.map((mutation) => mutation.source)).toEqual([
      'user_message',
      'editinput',
    ])
    expect(captureCount('editinput')).toBe(1)
    expect(getAssemblyMessageCaptureInstrumentation().fullTranscriptClones.messageReplacement).toBe(
      1,
    )
    expect(getAssemblyMessageCaptureInstrumentation().fullTranscriptClones.submitTranscript).toBe(1)
    expect(
      result.submitMessages?.map((message) => ({ role: message.role, data: message.data })),
    ).toEqual([{ role: 'user', data: 'HELLO' }])
    expect(result.restoration?.messages).toEqual([])
    expectNoFullTranscriptStringify()
  })

  it('captures start-trigger chat edits once and preserves stop/error restoration baseline', async () => {
    resetAssemblyMessageCaptureInstrumentation()

    const result = await assemblePrompt(
      baseInput({ userMessage: 'new user' }),
      depsFor(
        m1Db([msg('user', 'before start trigger', 'msg-1')], {
          char: {
            triggerscript: [
              startTrigger([
                { type: 'modifychat', index: '0', value: 'edited by trigger' },
                { type: 'impersonate', role: 'char', value: 'added by trigger' },
              ]),
            ] as never,
          },
        }),
      ),
    )

    expect(result.stopSending).toBe(false)
    expect(result.mutations?.messageMutations.map((mutation) => mutation.source)).toEqual([
      'user_message',
      'start_trigger',
    ])
    expect(captureCount('start_trigger')).toBe(1)
    expect(getAssemblyMessageCaptureInstrumentation().fullTranscriptClones.messageReplacement).toBe(
      1,
    )
    const startPatch = result.mutations?.messageMutations.find(
      (mutation) => mutation.source === 'start_trigger',
    )
    expect(startPatch).toMatchObject({
      type: 'replace_all',
      source: 'start_trigger',
      beforeLength: 2,
      afterLength: 3,
      messages: [
        { role: 'user', data: 'edited by trigger', chatId: 'msg-1' },
        { role: 'user', data: 'new user' },
        { role: 'char', data: 'added by trigger' },
      ],
    })
    expect(result.restoration?.messages).toEqual([
      { role: 'user', data: 'before start trigger', chatId: 'msg-1' },
    ])
    expectNoFullTranscriptStringify()
  })

  it('captures regenerate truncation once and leaves the restoration transcript intact', async () => {
    resetAssemblyMessageCaptureInstrumentation()

    const result = await assemblePrompt(
      baseInput({
        mode: 'regenerate',
        userMessage: undefined,
        regenerateMessageId: 'msg-char-1',
      }),
      depsFor(
        m1Db([
          msg('user', 'try again', 'msg-user-1'),
          { ...(msg('char', 'old reply', 'msg-char-1') as any), saying: 'char-tess' } as never,
        ]),
      ),
    )

    expect(result.stopSending).toBe(false)
    expect(result.mutations?.messageMutations).toEqual([
      {
        type: 'replace_all',
        source: 'regenerate',
        beforeLength: 2,
        afterLength: 1,
        messages: [msg('user', 'try again', 'msg-user-1')],
      },
    ])
    expect(captureCount('regenerate')).toBe(1)
    expect(getAssemblyMessageCaptureInstrumentation().fullTranscriptClones.messageReplacement).toBe(
      1,
    )
    expect(result.restoration?.messages).toEqual([
      { role: 'user', data: 'try again', chatId: 'msg-user-1' },
      { role: 'char', data: 'old reply', chatId: 'msg-char-1', saying: 'char-tess' },
    ])
    expectNoFullTranscriptStringify()
  })
})

describe('Phase 2 L2 run-var fixed-point skip', () => {
  const msg = (role: string, data: string, chatId: string) => ({ role, data, chatId }) as never

  it('only skips bodies risuChatParser provably returns unchanged (ground truth)', async () => {
    const { risuChatParser } = await import('../../../src/ts/parser/risuChatParser')
    const db = makeDatabase({ maxContext: 100_000, maxResponse: 50 } as Partial<Database>)

    // Marker-free prose — including bare `}` / `#}` / `<` text the parser
    // passes through — is a fixed point: skippable AND byte-identical.
    const fixedPoints = [
      '',
      'plain prose with punctuation. And a second sentence!',
      'closing brace } alone and even a #} pair',
      'angle brackets <notatag> <users> <charset> stay untouched',
      'unicode 한국어 텍스트 with emoji 🙂 and newline\nsecond line',
    ]
    for (const text of fixedPoints) {
      expect(isRunVarParserFixedPoint(text), `should skip: ${JSON.stringify(text)}`).toBe(true)
      expect(risuChatParser(text, { db, runVar: true })).toBe(text)
    }

    // Anything the parser can rewrite must NOT be skipped.
    const expandable = [
      '{{user}}',
      'before {{setvar::mood::bright}}after',
      'legacy {#if block',
      'a lone { opener is conservatively kept',
      'tag <bot> expands',
      'tag <USER> expands case-insensitively',
      '<Char> too',
    ]
    for (const text of expandable) {
      expect(isRunVarParserFixedPoint(text), `must not skip: ${JSON.stringify(text)}`).toBe(false)
    }
  })

  it('keeps marker-free rows byte-identical while marker rows still expand', async () => {
    const prose = 'Marker-free prose row. } and #} and <notatag> included.'
    const db = makeDatabase({
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
              message: [
                msg('user', prose, 'msg-1'),
                msg('char', 'I am <bot>. {{setvar::mood::bright}}', 'msg-2'),
              ],
            }),
          ],
        } as Partial<character>),
      ],
    } as Partial<Database>)

    const result = await assemblePrompt(baseInput({ userMessage: 'new user' }), depsFor(db))
    expect(result.stopSending).toBe(false)

    const runVarPatch = result.mutations!.messageMutations.find((m) => m.source === 'run_var')
    expect(runVarPatch).toMatchObject({ type: 'replace_all', source: 'run_var' })
    const rows = (runVarPatch as { messages: Array<{ data: string }> }).messages
    // The skipped row is byte-identical; the marker row expanded its tag and
    // stripped the var write, which still landed in the chat-var delta.
    expect(rows[0].data).toBe(prose)
    expect(rows[1].data).toBe('I am Tess. ')
    expect(result.mutations!.chatVarMutations).toEqual([
      { key: '$mood', before: null, after: 'bright' },
    ])
  })
})

describe('Phase 3 M2/L8/L9 history expansion cost', () => {
  const msg = (role: Message['role'], data: string, chatId: string): Message =>
    ({ role, data, chatId }) as Message

  const active = (overrides: Partial<LoreEntryActive> = {}): LoreEntryActive => ({
    depth: 0,
    pos: '',
    prompt: '',
    role: 'system',
    order: 100,
    priority: 100,
    tokens: 0,
    source: '',
    inject: null,
    ...overrides,
  })

  const report = (actives: LoreEntryActive[]): LorebookActivationReport => ({
    actives,
    disabledUIPrompts: [],
    matchLog: [],
  })

  it('skips expandVariables for marker-free history rows but expands markers and legacy tags', async () => {
    const prose = 'Marker-free prose row. } #} <notatag> stay byte-identical.'
    const db = makeDatabase({
      username: 'Alex',
      aiModel: 'gpt4',
      characters: [
        makeCharacter({
          name: 'Lyra',
          firstMessage: '',
          chats: [
            makeChat({
              message: [
                msg('user', prose, 'plain-row'),
                msg('user', 'hello {{user}}', 'macro-row'),
                msg('char', '<bot> answers <user>', 'tag-row'),
              ],
            }),
          ],
        }),
      ],
    } as Partial<Database>)
    const spy = vi.spyOn(promptVariables, 'expandVariables')

    const result = await buildHistoryWindow(
      { database: db },
      db.characters[0],
      db.characters[0].chats[0],
    )

    expect(result.messages.find((m) => m.memo === 'plain-row')?.content).toBe(prose)
    expect(result.messages.find((m) => m.memo === 'macro-row')?.content).toBe('hello Alex')
    expect(result.messages.find((m) => m.memo === 'tag-row')?.content).toBe('Lyra answers Alex')
    expect(spy.mock.calls.filter(([input]) => input === prose)).toHaveLength(0)
    expect(spy.mock.calls.filter(([input]) => input === 'hello {{user}}')).toHaveLength(1)
    expect(spy.mock.calls.filter(([input]) => input === '<bot> answers <user>')).toHaveLength(1)
  })

  it('expands SEND_NAME_WRAPPER once per history window and reuses it for rows', async () => {
    const db = makeDatabase({
      aiModel: 'gpt4',
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: '',
        sendChatAsSystem: false,
        sendName: true,
        utilOverride: false,
      },
      characters: [
        makeCharacter({
          name: 'Lyra',
          firstMessage: '',
          chats: [
            makeChat({
              message: [
                msg('user', 'one', 'one'),
                msg('char', 'two', 'two'),
                msg('user', 'three', 'three'),
              ],
            }),
          ],
        }),
      ],
    } as Partial<Database>)
    const spy = vi.spyOn(promptVariables, 'expandVariables')

    const result = await buildHistoryWindow(
      { database: db },
      db.characters[0],
      db.characters[0].chats[0],
      true,
    )

    expect(result.messages.find((m) => m.memo === 'one')?.content).toBe(
      "<Lyra's Message>\none\n</Lyra's Message>",
    )
    expect(result.messages.find((m) => m.memo === 'two')?.content).toBe(
      "<Lyra's Message>\ntwo\n</Lyra's Message>",
    )
    expect(result.messages.find((m) => m.memo === 'three')?.content).toBe(
      "<Lyra's Message>\nthree\n</Lyra's Message>",
    )
    expect(
      spy.mock.calls.filter(([input]) =>
        String(input).startsWith("<{{char}}'s Message>\n{{slot}}"),
      ),
    ).toHaveLength(1)
  })

  it('expands depth-prompt bodies once for preflight and reuses them for final splice', async () => {
    const db = makeDatabase({
      username: 'Alex',
      aiModel: 'gpt4',
      characters: [makeCharacter({ firstMessage: '' })],
    } as Partial<Database>)
    const activationReport = report([
      active({
        pos: 'reverse_depth',
        depth: 1,
        prompt: 'tail says {{user}}',
        source: 'reverse-depth-cbs',
      }),
      active({
        pos: 'depth',
        depth: 1,
        prompt: 'depth says {{user}}',
        source: 'depth-cbs',
      }),
    ])
    const spy = vi.spyOn(promptVariables, 'expandVariables')

    const history = await buildHistoryWindow(
      { database: db },
      db.characters[0],
      db.characters[0].chats[0],
      false,
      undefined,
      activationReport,
    )
    expect(spy.mock.calls.filter(([input]) => input === 'depth says {{user}}')).toHaveLength(1)
    expect(spy.mock.calls.filter(([input]) => input === 'tail says {{user}}')).toHaveLength(1)

    const messages: OpenAIChat[] = [
      { role: 'system', content: 'NewChat' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
    ]
    applyDepthPrompts(
      messages,
      { database: db },
      db.characters[0],
      activationReport,
      history.preparedDepthPrompts,
    )

    expect(messages.map((m) => m.content)).toEqual([
      'NewChat',
      'depth says Alex',
      'first',
      'tail says Alex',
      'reply',
    ])
    expect(spy.mock.calls.filter(([input]) => input === 'depth says {{user}}')).toHaveLength(1)
    expect(spy.mock.calls.filter(([input]) => input === 'tail says {{user}}')).toHaveLength(1)
  })
})

describe('Phase 3 M3 stable card cache', () => {
  it('persists stable-card setvar once through assembly mutations', async () => {
    const db = makeDatabase({
      aiModel: 'gpt4',
      maxContext: 100_000,
      maxResponse: 50,
      promptTemplate: [
        {
          type: 'plain',
          type2: 'main',
          text: 'stable {{setvar::score::9}}body',
          role: 'system',
        },
      ],
      characters: [
        makeCharacter({
          firstMessage: '',
          chats: [makeChat({ id: 'chat-1', message: [] })],
        }),
      ],
    } as Partial<Database>)
    const spy = vi.spyOn(promptVariables, 'expandVariables')

    const result = await assemblePrompt(baseInput({ userMessage: 'new user' }), depsFor(db))

    expect(result.stopSending).toBe(false)
    expect(result.formated?.map((r) => r.content)).toContain('stable body')
    expect(result.mutations?.chatVarMutations).toEqual([
      { key: '$score', before: null, after: '9' },
    ])
    expect(
      spy.mock.calls.filter(
        ([input, expandCtx]) =>
          input === 'stable {{setvar::score::9}}body' &&
          (expandCtx as { runVar?: boolean } | undefined)?.runVar === true,
      ),
    ).toHaveLength(1)
  })
})

describe('Phase 3 L4 lorebook sticky chat-var persistence', () => {
  const stickyLore = (content: string): loreBook =>
    ({
      id: 'lore-dont',
      key: 'cat',
      secondkey: '',
      insertorder: 100,
      comment: 'One-shot',
      content,
      mode: 'normal',
      alwaysActive: false,
      selective: false,
    }) as loreBook

  const stickyDb = (): Database =>
    makeDatabase({
      aiModel: 'gpt4',
      maxContext: 100_000,
      maxResponse: 50,
      mainPrompt: 'MAIN',
      characters: [
        makeCharacter({
          firstMessage: '',
          globalLore: [stickyLore('@@dont_activate_after_match\nOne-shot lore.')],
          chats: [makeChat({ id: 'chat-1', message: [] })],
        }),
      ],
    } as Partial<Database>)

  it('persists @@dont_activate_after_match through assembly mutations and suppresses the next send', async () => {
    const db = stickyDb()

    const first = await assemblePrompt(baseInput({ userMessage: 'cat' }), depsFor(db))

    expect(first.stopSending).toBe(false)
    const firstLorebookActivation = first.prompt?.lorebookActivation as
      | LorebookActivationReport
      | undefined
    expect(firstLorebookActivation?.actives.map((a) => a.prompt)).toContain('One-shot lore.')
    expect(first.mutations?.varChanged).toBe(true)
    expect(first.mutations?.chatVarMutations).toEqual([
      { key: '$__internal_da_lore-dont', before: null, after: 'true' },
    ])
    expect(db.characters[0].chats[0].scriptstate).toEqual({
      '$__internal_da_lore-dont': 'true',
    })
    expect(first.state?.currentChat.scriptstate).toBe(db.characters[0].chats[0].scriptstate)

    const second = await assemblePrompt(baseInput({ userMessage: 'cat' }), depsFor(db))

    expect(second.stopSending).toBe(false)
    const secondLorebookActivation = second.prompt?.lorebookActivation as
      | LorebookActivationReport
      | undefined
    expect(secondLorebookActivation?.actives.map((a) => a.prompt)).not.toContain('One-shot lore.')
    expect(second.mutations?.chatVarMutations).toEqual([])
  })
})

describe('Phase 3 M4 CBS callback memo', () => {
  const msg = (role: Message['role'], data: string, chatId: string): Message =>
    ({ role, data, chatId }) as Message

  const lore = (overrides: Partial<loreBook> = {}): loreBook =>
    ({
      key: '',
      secondkey: '',
      insertorder: 100,
      comment: 'Lore',
      content: 'Lore body',
      mode: 'normal',
      alwaysActive: true,
      selective: false,
      ...overrides,
    }) as loreBook

  const payload = (content: string, label: string): string => {
    const line = content.split('\n').find((candidate) => candidate.startsWith(label))
    expect(line, `missing ${label}`).toBeDefined()
    return line!.slice(label.length)
  }

  it('evaluates repeated charhistory, userhistory, and lorebook callbacks once per assembly signature', async () => {
    resetAssemblyCbsCallbackMemoInstrumentation()
    const db = makeDatabase({
      username: 'Alex',
      aiModel: 'gpt4',
      maxContext: 100_000,
      maxResponse: 50,
      promptTemplate: [
        {
          type: 'plain',
          type2: 'main',
          role: 'system',
          text: [
            'U1 {{userhistory}}',
            'U2 {{usermessages}}',
            'C1 {{charhistory}}',
            'C2 {{charmessages}}',
            'L1 {{lorebook}}',
            'L2 {{worldinfo}}',
          ].join('\n'),
        },
      ],
      characters: [
        makeCharacter({
          name: 'Tess',
          chaId: 'char-tess',
          firstMessage: '',
          globalLore: [lore({ id: 'global-lore', content: 'Global lore' })],
          chats: [
            makeChat({
              id: 'chat-1',
              localLore: [lore({ id: 'local-lore', content: 'Local lore' })],
              message: [
                msg('user', 'user sees {{user}}', 'msg-user'),
                msg('char', 'char sees {{char}}', 'msg-char'),
              ],
            }),
          ],
        }),
      ],
    } as Partial<Database>)

    const result = await assemblePrompt(
      baseInput({ mode: 'preview', userMessage: undefined }),
      depsFor(db),
    )

    expect(result.stopSending).toBe(false)
    const content = result.formated?.find((row) => row.content.includes('U1 '))?.content ?? ''
    expect(payload(content, 'U1 ')).toBe(payload(content, 'U2 '))
    expect(payload(content, 'C1 ')).toBe(payload(content, 'C2 '))
    expect(payload(content, 'L1 ')).toBe(payload(content, 'L2 '))
    expect(payload(content, 'U1 ')).toContain('user sees Alex')
    expect(payload(content, 'C1 ')).toContain('char sees Tess')
    expect(payload(content, 'L1 ')).toContain('Global lore')
    expect(payload(content, 'L1 ')).toContain('Local lore')
    expect(getAssemblyCbsCallbackMemoInstrumentation().callbackMisses).toEqual({
      userhistory: 1,
      charhistory: 1,
      lorebook: 1,
    })
  })

  it('does not return stale history output after the assembly history generation changes', () => {
    resetAssemblyCbsCallbackMemoInstrumentation()
    const db = makeDatabase({
      username: 'Alex',
      characters: [
        makeCharacter({
          chats: [
            makeChat({
              id: 'chat-1',
              message: [msg('user', 'first {{user}}', 'msg-1')],
            }),
          ],
        }),
      ],
    } as Partial<Database>)
    const state = beginAssembly(baseInput({ mode: 'preview', userMessage: undefined }), depsFor(db))
    const read = () =>
      promptVariables.expandVariables('{{userhistory}}\n{{userhistory}}', {
        ...state.ctx,
        chara: state.currentChar,
      }).text

    const first = read()
    expect(first).toContain('first Alex')
    expect(getAssemblyCbsCallbackMemoInstrumentation().callbackMisses.userhistory).toBe(1)

    db.characters[0].chats[0].message.push(msg('user', 'second {{user}}', 'msg-2'))
    bumpAssemblyCbsHistoryGeneration(state.cbsCallbackMemo)

    const second = read()
    expect(second).toContain('first Alex')
    expect(second).toContain('second Alex')
    expect(getAssemblyCbsCallbackMemoInstrumentation().callbackMisses.userhistory).toBe(2)
  })

  it('does not return stale lorebook output after lore identities change', () => {
    resetAssemblyCbsCallbackMemoInstrumentation()
    const db = makeDatabase({
      characters: [
        makeCharacter({
          globalLore: [lore({ id: 'global-one', content: 'Global one' })],
          chats: [
            makeChat({
              id: 'chat-1',
              localLore: [lore({ id: 'local-one', content: 'Local one' })],
            }),
          ],
        }),
      ],
    } as Partial<Database>)
    const state = beginAssembly(baseInput({ mode: 'preview', userMessage: undefined }), depsFor(db))
    const read = () =>
      promptVariables.expandVariables('{{lorebook}}\n{{worldinfo}}', {
        ...state.ctx,
        chara: state.currentChar,
      }).text

    const first = read()
    expect(first).toContain('Global one')
    expect(first).toContain('Local one')
    expect(getAssemblyCbsCallbackMemoInstrumentation().callbackMisses.lorebook).toBe(1)

    db.characters[0].globalLore.push(lore({ id: 'global-two', content: 'Global two' }))
    db.characters[0].chats[0].localLore.push(lore({ id: 'local-two', content: 'Local two' }))

    const second = read()
    expect(second).toContain('Global one')
    expect(second).toContain('Global two')
    expect(second).toContain('Local one')
    expect(second).toContain('Local two')
    expect(getAssemblyCbsCallbackMemoInstrumentation().callbackMisses.lorebook).toBe(2)
  })
})
