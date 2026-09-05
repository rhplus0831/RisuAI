import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import type { DatabaseSync, SQLInputValue, SQLOutputValue } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../src/db.js'
import { assemblePrompt, type AssembleInput } from '../src/prompt/assemble.js'
import { buildEffectiveGenerationConfig } from '../src/prompt/effectiveGenerationConfig.js'
import { bootPromptVariables } from '../src/prompt/promptVariablesBoot.js'
import type { FastifyCharacter, FastifyChat, FastifyDatabase } from '../src/prompt/serverTypes.js'
import { insertAssetMetadataBatch, loadPersistedForAssembly, writePersistedWithMessages } from '../src/repository.js'
import { preflightGenerationOperationSettings } from '../src/routes/generationChat.js'

// Deterministic work counters, not a latency benchmark. These probes deliberately
// assert semantics instead of pinning the inefficient baseline as desired work.
// Phase 3 can add the recorded scope budgets to the same fixtures after cutover.
const unrelatedSizes = [0, 12, 48]
const historySizes = [4, 40, 160]
const payload = 'unrelated synthetic payload '.repeat(80)
const reportRows: unknown[] = []
const reportPath = fileURLToPath(
  new URL('../../../fast-bootstrap-results/maintainability/generation-costs.json', import.meta.url),
)
const input: AssembleInput = {
  characterId: 'target-character',
  chatId: 'target-chat',
  mode: 'preview_prompt',
}

afterAll(() => {
  mkdirSync(path.dirname(reportPath), { recursive: true })
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        runtime: process.version,
        architecture: process.arch,
        logicalCpus: cpus().length,
        cpu: cpus()[0]?.model,
        samples: reportRows,
      },
      null,
      2,
    ) + '\n',
  )
})

interface ReadCost {
  calls: number
  rows: number
  returnedBytes: number
  jsonColumnBytes: number
}

interface PhaseCost {
  cloneCalls: number
  cloneBytes: number
  reads: Record<string, ReadCost>
}

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? '')
}

function newChat(id: string, history: number, note = ''): FastifyChat {
  return {
    id,
    name: id,
    note,
    localLore: [],
    message: Array.from({ length: history }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'char',
      data: `Stored message ${index}: fixed target history text.`,
      chatId: `${id}-message-${index}`,
      time: 1_700_000_000_000 + index,
    })),
    generationSettings: {
      configured: true,
      personaId: 'selected-persona',
      modelPresetId: 'selected-model',
      promptPresetId: 'selected-prompt',
      jailbreakToggle: false,
      sidebarToggles: {},
    },
  }
}

function newCharacter(id: string, chats: FastifyChat[], desc: string): FastifyCharacter {
  return {
    type: 'character',
    chaId: id,
    name: id === input.characterId ? 'Tess' : id,
    firstMessage: 'Hello.',
    desc,
    notes: '',
    chats,
    chatFolders: [],
    chatPage: 0,
    viewScreen: 'none',
    bias: [],
    emotionImages: [],
    globalLore: [],
    sdData: [],
    customscript: [],
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
    firstMsgIndex: 0,
    replaceGlobalNote: '',
    additionalText: '',
    triggerscript: [],
  }
}

function fixtureDatabase(unrelated: number, targetHistory: number) {
  const extra = Array.from({ length: unrelated }, (_, index) => ({
    id: `unused-${index}`,
    name: `Unused ${index}`,
  }))
  return {
    currentChar: 0,
    characters: [
      newCharacter(input.characterId, [newChat(input.chatId, targetHistory)], 'Fixed selected character.'),
      ...extra.map(({ id }) =>
        newCharacter(
          id,
          Array.from({ length: 3 }, (_, index) => newChat(`${id}-chat-${index}`, 8, payload)),
          payload,
        ),
      ),
    ],
    personas: [
      { id: 'selected-persona', name: 'User', icon: '', personaPrompt: 'Fixed persona.', note: '' },
      ...extra.map((record) => ({ ...record, icon: '', personaPrompt: payload, note: payload })),
    ],
    selectedPersona: 0,
    selectedPersonaId: 'selected-persona',
    modelPresetsId: 0,
    promptPresetsId: 0,
    modelPresets: [
      { id: 'selected-model', name: 'Selected model', aiModel: 'gpt-4o-mini', maxContext: 32000, maxResponse: 256 },
      ...extra.map((record) => ({ ...record, aiModel: 'gpt-4o-mini', customFlags: [payload] })),
    ],
    promptPresets: [
      {
        id: 'selected-prompt',
        name: 'Selected prompt',
        mainPrompt: 'Fixed system prompt.',
        formatingOrder: ['main', 'description', 'personaPrompt', 'chats'],
      },
      ...extra.map((record) => ({ ...record, mainPrompt: payload })),
    ],
    modules: extra.map((record) => ({ ...record, lorebook: [{ content: payload }], regex: [], trigger: [] })),
    enabledModules: [],
    globalChatVariables: {},
    jailbreakToggle: false,
    aiModel: 'gpt-4o-mini',
    maxContext: 32000,
    maxResponse: 256,
    promptSettings: {
      assistantPrefill: '',
      postEndInnerFormat: '',
      sendChatAsSystem: false,
      sendName: false,
      utilOverride: false,
    },
  }
}

async function measure<T>(db: DatabaseSync, run: () => T | Promise<T>): Promise<{ result: T; cost: PhaseCost }> {
  const cost: PhaseCost = { cloneCalls: 0, cloneBytes: 0, reads: {} }
  const clone = globalThis.structuredClone
  const cloneSpy = vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
    cost.cloneCalls += 1
    cost.cloneBytes += bytes(value)
    return clone(value, options)
  })
  const prepare = db.prepare.bind(db)
  const prepareSpy = vi.spyOn(db, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql)
    const table = /\bFROM\s+([a-z_]+)/i.exec(sql)?.[1] ?? 'other'
    function capture(value: Record<string, SQLOutputValue> | Record<string, SQLOutputValue>[] | undefined) {
      const rows = Array.isArray(value) ? value : value ? [value] : []
      const read = (cost.reads[table] ??= { calls: 0, rows: 0, returnedBytes: 0, jsonColumnBytes: 0 })
      read.calls += 1
      read.rows += rows.length
      read.returnedBytes += bytes(value)
      for (const row of rows) {
        for (const [key, item] of Object.entries(row)) {
          if (key.endsWith('_json') && typeof item === 'string') read.jsonColumnBytes += Buffer.byteLength(item)
        }
      }
    }
    const all = statement.all.bind(statement)
    const get = statement.get.bind(statement)
    statement.all = (...parameters: Array<SQLInputValue | Record<string, SQLInputValue>>) => {
      const value: ReturnType<typeof all> = Reflect.apply(all, statement, parameters)
      capture(value)
      return value
    }
    statement.get = (...parameters: Array<SQLInputValue | Record<string, SQLInputValue>>) => {
      const value: ReturnType<typeof get> = Reflect.apply(get, statement, parameters)
      capture(value)
      return value
    }
    return statement
  })
  try {
    return { result: await run(), cost }
  } finally {
    cloneSpy.mockRestore()
    prepareSpy.mockRestore()
  }
}

async function timings(db: DatabaseSync, dataDir: string) {
  if (process.env.RISU_GENERATION_COST_TIMING !== '1') return undefined
  // Keep these runs separate from SQL/clone spies: their JSON serialization
  // deliberately adds work and would otherwise distort the timing comparison.
  const samples = { warmup: 1, repetitions: 3, preflightMs: [] as number[], assemblyMs: [] as number[] }
  for (let repetition = -samples.warmup; repetition < samples.repetitions; repetition += 1) {
    let started = performance.now()
    preflightGenerationOperationSettings(input, dataDir, db)
    const preflightMs = performance.now() - started
    started = performance.now()
    const result = await assemblePrompt(input, {
      loadDatabase: () => loadPersistedForAssembly(db, dataDir, input.chatId).database,
    })
    const assemblyMs = performance.now() - started
    expect(result.stopSending).toBe(false)
    if (repetition >= 0) {
      samples.preflightMs.push(preflightMs)
      samples.assemblyMs.push(assemblyMs)
    }
  }
  return samples
}

async function probe(unrelated: number, targetHistory: number) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-generation-costs-'))
  const db = openDatabase(dataDir)
  try {
    writePersistedWithMessages(db, dataDir, {
      _version: 1,
      database: fixtureDatabase(unrelated, targetHistory),
      assets: [],
    })
    insertAssetMetadataBatch(
      db,
      Array.from({ length: unrelated * 8 }, (_, index) => ({
        id: index.toString(16).padStart(64, '0'),
        ext: 'png',
        size: 4096,
        contentType: 'image/png',
      })),
    )

    const preflight = await measure(db, () => preflightGenerationOperationSettings(input, dataDir, db))
    expect(preflight.result).toEqual({ status: 'ready' })
    const load = await measure(db, () => loadPersistedForAssembly(db, dataDir, input.chatId))
    const database: FastifyDatabase = load.result.database
    const currentChar: FastifyCharacter = database.characters.find(
      (character: FastifyCharacter) => character.chaId === input.characterId,
    )
    const currentChat = currentChar.chats.find((chat) => chat.id === input.chatId)!
    expect(currentChat.message).toHaveLength(targetHistory)
    const originalTarget = JSON.stringify(currentChat)
    const effective = await measure(db, () =>
      buildEffectiveGenerationConfig({
        database,
        currentChar,
        currentChat,
        selectedCharID: database.characters.indexOf(currentChar),
        chatPage: currentChar.chats.indexOf(currentChat),
      }),
    )
    expect(effective.result.currentChat).not.toBe(currentChat)
    const assembly = await measure(db, () =>
      assemblePrompt(input, {
        loadDatabase: () => loadPersistedForAssembly(db, dataDir, input.chatId).database,
      }),
    )
    expect(assembly.result.stopSending).toBe(false)
    expect(assembly.result.formated?.length).toBeGreaterThan(0)
    expect(JSON.stringify(currentChat)).toBe(originalTarget)

    return {
      dimensions: {
        unrelatedCharacters: unrelated,
        unrelatedChats: unrelated * 3,
        unrelatedHistoryRows: unrelated * 24,
        unusedRowsPerCollection: unrelated,
        unrelatedAssets: unrelated * 8,
        targetHistory,
      },
      snapshotBytes: bytes(load.result.database),
      assetSnapshotBytes: bytes(load.result.assets),
      preflight: preflight.cost,
      load: load.cost,
      effective: effective.cost,
      assembly: assembly.cost,
      timing: await timings(db, dataDir),
      prompt: assembly.result.formated,
    }
  } finally {
    db.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
}

describe('generation preparation work counters', () => {
  it('keeps selected prompt bytes stable while reporting unrelated corpus work', async () => {
    bootPromptVariables()
    const results = []
    for (const unrelated of unrelatedSizes) results.push(await probe(unrelated, 4))
    for (const result of results) {
      expect(result.prompt).toEqual(results[0].prompt)
      reportRows.push({ axis: 'unrelated', ...result, prompt: undefined })
    }
  })

  it('reports necessary target-history work separately from unrelated corpus work', async () => {
    bootPromptVariables()
    const results = []
    for (const history of historySizes) results.push(await probe(0, history))
    expect(results[2].snapshotBytes).toBeGreaterThan(results[0].snapshotBytes)
    expect(bytes(results[2].prompt)).toBeGreaterThan(bytes(results[0].prompt))
    for (const result of results) {
      reportRows.push({ axis: 'history', ...result, prompt: undefined })
    }
  })
})
