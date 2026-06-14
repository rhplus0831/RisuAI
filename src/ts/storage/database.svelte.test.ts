import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'preset-rollback-token',
}))

vi.mock('../process/modules', async (importActual) => {
  const actual = await importActual<typeof import('../process/modules')>()
  return { ...actual, getModuleTriggers: () => [], moduleUpdate: () => {} }
})

import { DBState } from '../stores.svelte'
import { clearCachedServerCommandRevision, setCachedServerCommandRevision } from '../server/commands'
import {
  changeToPreset,
  copyPreset,
  createPreset,
  deletePreset,
  ensureBotPresetHydrated,
  mergeServerProjectionCharacterRow,
  normalizePromptTemplateIds,
  presetTemplate,
  promptTemplateIdsNeedNormalization,
  reorderPresets,
  saveCurrentPreset,
  setServerProjectionWriteGuardEnabled,
  updatePreset,
  type botPreset,
  type Database,
} from './database.svelte'

interface CapturedFetch {
  url: string
  method: string
  body: any
}

function seedDatabase(characters: Array<Record<string, unknown>>) {
  DBState.db = {
    characters,
    modules: [],
    personas: [],
    language: 'en',
  } as unknown as Database
}

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubFailedPresetCommand(onCommand?: (call: CapturedFetch) => void): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      const call = {
        url,
        method: init.method ?? 'GET',
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      }
      calls.push(call)
      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 100 })
      if (url.startsWith('/api/v1/commands/presets')) {
        onCommand?.(call)
        return jsonResponse({ error: 'forced preset failure' }, 500)
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

async function waitForPresetCommand(calls: CapturedFetch[], path: string): Promise<CapturedFetch> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const match = calls.find((call) => call.url === `/api/v1/commands${path}`)
    if (match) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      return match
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`preset command ${path} not dispatched; saw: ${JSON.stringify(calls)}`)
}

async function waitForState(assertion: () => void): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  throw lastError
}

function makePreset(id: string, name: string, patch: Partial<botPreset> = {}): botPreset {
  return {
    ...clonePlain(presetTemplate),
    id,
    name,
    mainPrompt: `${name} prompt`,
    jailbreak: `${name} jailbreak`,
    globalNote: `${name} note`,
    temperature: patch.temperature ?? 30,
    promptTemplate: [
      {
        id: `${id}-prompt`,
        type: 'plain',
        text: `${name} prompt item`,
      },
    ] as any,
    NAISettings: { cfg_scale: 4, mirostat_tau: 5, mirostat_lr: 6 } as any,
    promptSettings: {
      assistantPrefill: `${name} prefill`,
      postEndInnerFormat: '',
      sendChatAsSystem: false,
      sendName: false,
      utilOverride: false,
      customChainOfThought: false,
      maxThoughtTagDepth: 3,
    },
    ...patch,
  }
}

describe('promptTemplateIdsNeedNormalization', () => {
  it('skips already-normalized prompt templates', () => {
    const data = {
      promptTemplate: [
        { id: 'prompt-a', type: 'plain', text: 'A' },
        { id: 'prompt-b', type: 'plain', text: 'B' },
      ],
    } as unknown as Pick<Database, 'promptTemplate'>

    expect(promptTemplateIdsNeedNormalization(data)).toBe(false)
  })

  it('detects missing, blank, and duplicate prompt template ids', () => {
    expect(
      promptTemplateIdsNeedNormalization({
        promptTemplate: [{ type: 'plain', text: 'A' }],
      } as unknown as Pick<Database, 'promptTemplate'>),
    ).toBe(true)
    expect(
      promptTemplateIdsNeedNormalization({
        promptTemplate: [{ id: ' ', type: 'plain', text: 'A' }],
      } as unknown as Pick<Database, 'promptTemplate'>),
    ).toBe(true)
    expect(
      promptTemplateIdsNeedNormalization({
        promptTemplate: [
          { id: 'prompt-a', type: 'plain', text: 'A' },
          { id: 'prompt-a', type: 'plain', text: 'B' },
        ],
      } as unknown as Pick<Database, 'promptTemplate'>),
    ).toBe(true)
  })

  it('returns false after normalization repairs prompt template ids', () => {
    const data = {
      promptTemplate: [
        { id: 'prompt-a', type: 'plain', text: 'A' },
        { id: 'prompt-a', type: 'plain', text: 'B' },
        { type: 'plain', text: 'C' },
      ],
    } as unknown as Pick<Database, 'promptTemplate'>

    normalizePromptTemplateIds(data)

    expect(promptTemplateIdsNeedNormalization(data)).toBe(false)
    expect(new Set(data.promptTemplate?.map((item) => item.id)).size).toBe(data.promptTemplate?.length ?? 0)
  })
})

function seedPresetDatabase(patch: Partial<Database> = {}): void {
  DBState.db = {
    characters: [],
    modules: [],
    personas: [],
    language: 'en',
    botPresets: [
      makePreset('preset-a', 'Alpha', { temperature: 11 }),
      makePreset('preset-b', 'Beta', { temperature: 22 }),
    ],
    botPresetsId: 0,
    apiType: 'live-api',
    openAIKey: '',
    proxyKey: 'live-proxy-key',
    mainPrompt: 'live main',
    jailbreak: 'live jailbreak',
    globalNote: 'live note',
    temperature: 44,
    maxContext: 4096,
    maxResponse: 512,
    frequencyPenalty: 10,
    PresensePenalty: 12,
    formatingOrder: ['main'] as any,
    aiModel: 'live-model',
    subModel: 'live-submodel',
    currentPluginProvider: 'live-provider',
    textgenWebUIStreamURL: 'wss://live',
    textgenWebUIBlockingURL: 'https://live',
    forceReplaceUrl: 'live-force',
    promptPreprocess: false,
    bias: [['token', 1]],
    koboldURL: 'https://kobold',
    ooba: {} as any,
    ainconfig: {} as any,
    openrouterRequestModel: 'live-openrouter',
    proxyRequestModel: 'live-proxy-model',
    NAIsettings: { cfg_scale: 7, mirostat_tau: 8, mirostat_lr: 9 } as any,
    autoSuggestPrompt: 'live autosuggest',
    autoSuggestPrefix: 'live prefix',
    autoSuggestClean: true,
    promptTemplate: [{ id: 'live-prompt', type: 'plain', text: 'live prompt row' }] as any,
    NAIadventure: false,
    NAIappendName: true,
    localStopStrings: ['live stop'],
    customProxyRequestModel: 'live-custom-proxy',
    reverseProxyOobaArgs: { mode: 'instruct' } as any,
    top_p: 0.8,
    promptSettings: {
      assistantPrefill: 'live prefill',
      postEndInnerFormat: '',
      sendChatAsSystem: false,
      sendName: false,
      utilOverride: false,
      customChainOfThought: false,
      maxThoughtTagDepth: 7,
    },
    repetition_penalty: 1.1,
    min_p: 0.2,
    top_a: 0.3,
    openrouterProvider: { order: ['provider-a'], only: [], ignore: [] },
    useInstructPrompt: true,
    customPromptTemplateToggle: 'live-toggle',
    templateDefaultVariables: 'live vars',
    moduleIntergration: 'live-module',
    top_k: 40,
    instructChatTemplate: 'live-template',
    JinjaTemplate: 'live-jinja',
    jsonSchemaEnabled: true,
    jsonSchema: '{"type":"object"}',
    strictJsonSchema: true,
    extractJson: 'live-json',
    seperateParametersEnabled: true,
    customAPIFormat: 'openai' as any,
    systemContentReplacement: 'system: {{slot}}',
    systemRoleReplacement: 'user',
    customFlags: [],
    enableCustomFlags: false,
    presetRegex: [],
    reasoningEffort: 4,
    thinkingTokens: 128,
    thinkingType: 'budget',
    deepseekThinkingType: 'off',
    adaptiveThinkingEffort: 'high',
    deepseekReasoningEffort: 'high',
    outputImageModal: false,
    doNotChangeSeperateModels: false,
    seperateModelsForAxModels: true,
    seperateModels: { memory: 'm', emotion: 'e', translate: 't', otherAx: 'o' },
    doNotChangeFallbackModels: false,
    fallbackModels: {
      memory: ['m1'],
      emotion: ['e1'],
      translate: ['t1'],
      otherAx: ['o1'],
      model: ['x1'],
    },
    fallbackWhenBlankResponse: true,
    disableSeperateParameterChangeOnPresetChange: false,
    seperateParameters: { memory: {}, emotion: {}, translate: {}, otherAx: {}, overrides: {} },
    modelTools: ['tool-a'],
    verbosity: 2,
    dynamicOutput: null,
    customBackground: 'live background',
    ...patch,
  } as unknown as Database
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  DBState.db = {
    characters: [],
    modules: [],
    personas: [],
    language: 'en',
  } as unknown as Database
  vi.unstubAllGlobals()
})

describe('mergeServerProjectionCharacterRow', () => {
  it('L35: preserves hydrated hypaV3Data on message-empty chat stubs', () => {
    const hypaV3Data = {
      memories: [{ id: 'memory-1', text: 'remember this' }],
    }
    seedDatabase([
      {
        chaId: 'char-a',
        name: 'Ada',
        chats: [{ id: 'chat-a', message: [], hypaV3Data }],
      },
    ])

    const applied = mergeServerProjectionCharacterRow({
      chaId: 'char-a',
      name: 'Ada Lovelace',
      chats: [{ id: 'chat-a', message: [] }],
    })

    expect(applied).toBe(true)
    expect(DBState.db.characters[0].name).toBe('Ada Lovelace')
    expect(DBState.db.characters[0].chats[0].message).toEqual([])
    expect(DBState.db.characters[0].chats[0].hypaV3Data).toEqual(hypaV3Data)
  })

  it('keeps non-empty hydrated messages on incoming chat stubs', () => {
    const priorMessages = [{ role: 'user' as const, data: 'hi' }]
    seedDatabase([
      {
        chaId: 'char-a',
        name: 'Ada',
        chats: [{ id: 'chat-a', message: priorMessages }],
      },
    ])

    const applied = mergeServerProjectionCharacterRow({
      chaId: 'char-a',
      name: 'Ada Lovelace',
      chats: [{ id: 'chat-a', message: [] }],
    })

    expect(applied).toBe(true)
    expect(DBState.db.characters[0].name).toBe('Ada Lovelace')
    expect(DBState.db.characters[0].chats[0].message).toEqual(priorMessages)
    expect(DBState.db.characters[0].chats[0].hypaV3Data).toBeUndefined()
  })

  it('clears the bootstrap shell marker when a full character row hydrates', () => {
    seedDatabase([
      {
        __serverCharacterShell: true,
        chaId: 'char-a',
        name: 'Ada shell',
        chats: [{ id: 'chat-a', message: [] }],
      },
    ])

    const applied = mergeServerProjectionCharacterRow({
      __serverCharacterShell: true,
      chaId: 'char-a',
      name: 'Ada full',
      desc: 'Hydrated description',
      chats: [{ id: 'chat-a', message: [] }],
    })

    expect(applied).toBe(true)
    expect(DBState.db.characters[0]).toMatchObject({
      chaId: 'char-a',
      name: 'Ada full',
      desc: 'Hydrated description',
    })
    expect(DBState.db.characters[0]).not.toHaveProperty('__serverCharacterShell')
  })

  it('returns false for unknown characters without mutating the corpus', () => {
    seedDatabase([
      {
        chaId: 'char-a',
        name: 'Ada',
        chats: [{ id: 'chat-a', message: [] }],
      },
    ])
    const characters = DBState.db.characters
    const before = JSON.stringify(characters)

    const applied = mergeServerProjectionCharacterRow({
      chaId: 'char-missing',
      name: 'Missing',
      chats: [{ id: 'chat-missing', message: [] }],
    })

    expect(applied).toBe(false)
    expect(DBState.db.characters).toBe(characters)
    expect(JSON.stringify(DBState.db.characters)).toBe(before)
  })
})

describe('preset command rollback (L21)', () => {
  it('hydrates a stubbed preset from the server projection before full-preset consumers read it', async () => {
    seedPresetDatabase({
      botPresets: [{ id: 'preset-stub', name: 'Stub', image: 'img' } as botPreset],
      botPresetsId: 0,
    })
    setServerProjectionWriteGuardEnabled(true)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe('/api/v1/projection/preset?id=preset-stub')
        return jsonResponse({
          revision: 7,
          resource: 'preset',
          mode: 'preset',
          presetId: 'preset-stub',
          preset: makePreset('preset-stub', 'Hydrated', {
            promptTemplate: [{ id: 'hydrated-prompt', type: 'plain', text: 'hydrated prompt' }] as any,
          }),
        })
      }) as unknown as typeof fetch,
    )

    await expect(ensureBotPresetHydrated(0)).resolves.toBe(true)

    expect(DBState.db.botPresets[0]).toMatchObject({
      id: 'preset-stub',
      name: 'Hydrated',
      mainPrompt: 'Hydrated prompt',
      promptTemplate: [{ id: 'hydrated-prompt', type: 'plain', text: 'hydrated prompt' }],
    })
  })

  it('does not save an unloaded promptTemplate as null when snapshotting the current preset', async () => {
    seedPresetDatabase({
      botPresets: [{ id: 'preset-a', name: 'Alpha', image: 'img' } as botPreset],
      botPresetsId: 0,
    })
    delete (DBState.db as unknown as { promptTemplate?: unknown }).promptTemplate
    setServerProjectionWriteGuardEnabled(true)
    const calls = stubFailedPresetCommand()

    saveCurrentPreset()

    const command = await waitForPresetCommand(calls, '/presets/preset-a')
    expect(command.body.patch).toMatchObject({
      id: 'preset-a',
      name: 'Alpha',
      mainPrompt: 'live main',
    })
    expect(command.body.patch).not.toHaveProperty('promptTemplate')
  })

  it('ignores stale preset hydration responses older than the applied revision', async () => {
    seedPresetDatabase({
      botPresets: [{ id: 'preset-stub', name: 'Stub', image: 'img' } as botPreset],
      botPresetsId: 0,
    })
    setServerProjectionWriteGuardEnabled(true)
    setCachedServerCommandRevision(9)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe('/api/v1/projection/preset?id=preset-stub')
        return jsonResponse({
          revision: 8,
          resource: 'preset',
          mode: 'preset',
          presetId: 'preset-stub',
          preset: makePreset('preset-stub', 'Stale', {
            promptTemplate: [{ id: 'stale-prompt', type: 'plain', text: 'stale prompt' }] as any,
          }),
        })
      }) as unknown as typeof fetch,
    )

    await expect(ensureBotPresetHydrated(0)).resolves.toBe(false)

    expect(DBState.db.botPresets[0]).toEqual({ id: 'preset-stub', name: 'Stub', image: 'img' })
  })

  it('L21: failed save restores the saved preset collection and selected index', async () => {
    seedPresetDatabase({ temperature: 91 })
    const beforePresets = clonePlain(DBState.db.botPresets)
    const beforeSelected = DBState.db.botPresetsId
    const calls = stubFailedPresetCommand()

    saveCurrentPreset()

    expect(DBState.db.botPresets[0].temperature).toBe(91)
    await waitForPresetCommand(calls, '/presets/preset-a')
    await waitForState(() => {
      expect(DBState.db.botPresets).toEqual(beforePresets)
      expect(DBState.db.botPresetsId).toBe(beforeSelected)
      expect(DBState.db.temperature).toBe(91)
    })
  })

  it('L21: failed copy restores the original collection after save-current and generated copy id', async () => {
    seedPresetDatabase({ temperature: 88 })
    const beforePresets = clonePlain(DBState.db.botPresets)
    const beforeSelected = DBState.db.botPresetsId
    const calls = stubFailedPresetCommand()

    copyPreset(0)

    expect(DBState.db.botPresets).toHaveLength(3)
    expect(DBState.db.botPresets[0].temperature).toBe(88)
    await waitForPresetCommand(calls, '/presets/preset-a/copy')
    await waitForState(() => {
      expect(DBState.db.botPresets).toEqual(beforePresets)
      expect(DBState.db.botPresetsId).toBe(beforeSelected)
    })
  })

  it('L21: failed create removes the optimistic preset and generated id', async () => {
    seedPresetDatabase()
    const beforePresets = clonePlain(DBState.db.botPresets)
    const beforeSelected = DBState.db.botPresetsId
    const beforeIds = new Set(beforePresets.map((preset) => preset.id))
    const calls = stubFailedPresetCommand()
    const newPreset = makePreset('preset-created', 'Created')
    delete newPreset.id

    createPreset(newPreset)

    const optimisticPreset = DBState.db.botPresets.find((preset) => preset.name === 'Created')
    expect(optimisticPreset?.id).toBeTruthy()
    expect(beforeIds.has(optimisticPreset?.id)).toBe(false)
    await waitForPresetCommand(calls, '/presets')
    await waitForState(() => {
      expect(DBState.db.botPresets).toEqual(beforePresets)
      expect(DBState.db.botPresetsId).toBe(beforeSelected)
    })
  })

  it('L21: failed update restores the patched preset row', async () => {
    seedPresetDatabase()
    const beforePresets = clonePlain(DBState.db.botPresets)
    const calls = stubFailedPresetCommand()

    updatePreset(1, { name: 'Broken Update', temperature: 99 })

    expect(DBState.db.botPresets[1]).toMatchObject({ name: 'Broken Update', temperature: 99 })
    await waitForPresetCommand(calls, '/presets/preset-b')
    await waitForState(() => {
      expect(DBState.db.botPresets).toEqual(beforePresets)
      expect(DBState.db.botPresetsId).toBe(0)
    })
  })

  it('L21: failed delete restores collection, selection, and setPreset scalars', async () => {
    seedPresetDatabase()
    const beforePresets = clonePlain(DBState.db.botPresets)
    const beforePrompt = DBState.db.mainPrompt
    const beforeTemperature = DBState.db.temperature
    const beforePromptTemplate = clonePlain(DBState.db.promptTemplate)
    const calls = stubFailedPresetCommand()

    deletePreset(0, 1, true)

    expect(DBState.db.botPresets.map((preset) => preset.id)).toEqual(['preset-b'])
    expect(DBState.db.botPresetsId).toBe(0)
    expect(DBState.db.mainPrompt).toBe('Beta prompt')
    await waitForPresetCommand(calls, '/presets/preset-a')
    await waitForState(() => {
      expect(DBState.db.botPresets).toEqual(beforePresets)
      expect(DBState.db.botPresetsId).toBe(0)
      expect(DBState.db.mainPrompt).toBe(beforePrompt)
      expect(DBState.db.temperature).toBe(beforeTemperature)
      expect(DBState.db.promptTemplate).toEqual(beforePromptTemplate)
    })
  })

  it('L21: failed reorder restores collection order and selected index', async () => {
    seedPresetDatabase({
      botPresets: [makePreset('preset-a', 'Alpha'), makePreset('preset-b', 'Beta'), makePreset('preset-c', 'Gamma')],
      botPresetsId: 1,
    })
    const beforePresets = clonePlain(DBState.db.botPresets)
    const beforeSelected = DBState.db.botPresetsId
    const calls = stubFailedPresetCommand()

    reorderPresets(0, 3)

    expect(DBState.db.botPresets.map((preset) => preset.id)).toEqual(['preset-b', 'preset-c', 'preset-a'])
    expect(DBState.db.botPresetsId).toBe(0)
    await waitForPresetCommand(calls, '/presets/reorder')
    await waitForState(() => {
      expect(DBState.db.botPresets).toEqual(beforePresets)
      expect(DBState.db.botPresetsId).toBe(beforeSelected)
    })
  })

  it('L21: failed select restores setPreset scalars without overwriting unrelated fields', async () => {
    seedPresetDatabase()
    const beforePresets = clonePlain(DBState.db.botPresets)
    const beforePrompt = DBState.db.mainPrompt
    const beforeTemperature = DBState.db.temperature
    const beforePromptTemplate = clonePlain(DBState.db.promptTemplate)
    const beforeNaiSettings = clonePlain(DBState.db.NAIsettings)
    const calls = stubFailedPresetCommand(() => {
      DBState.db.customBackground = 'changed while preset command was in flight'
    })

    changeToPreset(1, false)

    expect(DBState.db.botPresetsId).toBe(1)
    expect(DBState.db.mainPrompt).toBe('Beta prompt')
    expect(DBState.db.temperature).toBe(22)
    await waitForPresetCommand(calls, '/presets/select')
    await waitForState(() => {
      expect(DBState.db.botPresets).toEqual(beforePresets)
      expect(DBState.db.botPresetsId).toBe(0)
      expect(DBState.db.mainPrompt).toBe(beforePrompt)
      expect(DBState.db.temperature).toBe(beforeTemperature)
      expect(DBState.db.promptTemplate).toEqual(beforePromptTemplate)
      expect(DBState.db.NAIsettings).toEqual(beforeNaiSettings)
      expect(DBState.db.customBackground).toBe('changed while preset command was in flight')
    })
  })
})
