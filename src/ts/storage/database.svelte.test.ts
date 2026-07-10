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
import { captureDestructiveRefreshEpoch, hasDestructiveRefreshEpochChanged } from '../server/staleStateGuards'
import {
  applyModelPresetFieldsToDatabase,
  applyPromptPresetFieldsToDatabase,
  applyServerProjectionDatabase,
  botPresetIdsNeedNormalization,
  changeToPreset,
  copyPreset,
  createPreset,
  createPromptPreset,
  deleteModelPreset,
  deletePreset,
  ensureBotPresetHydrated,
  extractLegacyBotPresetByIndex,
  mergeServerProjectionCharacterRow,
  mergeServerProjectionFields,
  normalizePromptTemplateIds,
  presetTemplate,
  promptTemplateIdsNeedNormalization,
  reorderPromptPresets,
  reorderPresets,
  saveCurrentPreset,
  setDatabase,
  setPreset,
  setServerProjectionWriteGuardEnabled,
  selectModelPreset,
  selectPromptPreset,
  updatePreset,
  updateModelPreset,
  updatePromptPreset,
  type botPreset,
  type Database,
  type ModelPreset,
  type PromptPreset,
} from './database.svelte'
import { MODEL_ROLES } from '../model/modelRoles'
import { LLMFlags, LLMFormat, LLMTokenizer } from '../model/types'
import { changeLanguage, language as activeLanguage } from '../../lang'

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

function normalizedModelRoleProfiles(overrides: Record<string, Record<string, unknown>> = {}) {
  return {
    ...Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])),
    ...overrides,
  }
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
      if (
        url.startsWith('/api/v1/commands/presets') ||
        url.startsWith('/api/v1/commands/legacy-bot-presets') ||
        url.startsWith('/api/v1/commands/model-presets') ||
        url.startsWith('/api/v1/commands/prompt-presets')
      ) {
        onCommand?.(call)
        return jsonResponse({ error: 'forced preset failure' }, 500)
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

function stubModelPresetRenameRace(): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  let modelPresetCommandCount = 0
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
      if (url.startsWith('/api/v1/commands/model-presets/')) {
        modelPresetCommandCount += 1
        if (modelPresetCommandCount === 1) {
          return jsonResponse({ error: 'forced stale rename failure' }, 500)
        }
        return jsonResponse({
          revision: 101,
          event: { type: 'modelPreset.updated', revision: 101, resource: 'preset', id: 'model-a' },
          modelPresetId: 'model-a',
        })
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

describe('settings database normalization', () => {
  it('falls back retired PIP session keepalive to sound through setDatabase', () => {
    seedPresetDatabase({
      keepSessionAlive: 'pip' as any,
    })
    const data = clonePlain(DBState.db)

    setDatabase(data)

    expect(DBState.db.keepSessionAlive).toBe('sound')
  })
})

describe('model profile database normalization', () => {
  it('normalizes durable profile scaffold fields through setDatabase', () => {
    seedPresetDatabase({
      modelProfiles: [
        {
          id: ' profile-a ',
          name: ' Primary ',
          providerId: ' openai ',
          modelId: ' gpt-5 ',
          providerOptions: {
            requestModel: ' wire-model ',
            baseUrl: ' https://profile.example.com/v1 ',
            apiKey: ' profile-secret ',
            extraHeaders: { 'X-Test': ' yes ' },
            additionalParams: [[' header::X-Test ', ' true ']],
            openAIKey: 'must-drop',
            openrouter: {
              fallback: false,
              middleOut: true,
              provider: { order: [' ProfileProvider '], only: [' profile-only '], ignore: [''] },
            },
            nanogpt: { providerHint: ' profile-nano ', useSubscriptionEndpoint: true },
            ollama: { url: ' http://localhost:11434 ', requestFormat: LLMFormat.OpenAIResponseAPI },
            vertex: {
              projectId: ' project-a ',
              region: ' us-central1 ',
              clientEmail: ' svc@example.iam.gserviceaccount.com ',
              privateKey: ' private-key ',
            },
            customApi: { tokenizer: LLMTokenizer.Mistral, flags: [LLMFlags.hasStreaming] },
          },
        } as any,
        { id: 'profile-a', name: 'Duplicate' },
        { id: 'profile-b', name: 'Identity Only', modelId: '   ' } as any,
        { id: 'profile-c' } as any,
      ],
      modelRoleProfiles: {
        memory: { mode: 'profile', profileId: 'profile-a' },
        translate: { mode: 'legacy' },
      } as any,
      modelRuntimeDefaults: {
        maxContext: 8192,
        temperature: 55,
        modelTools: [' tool-a ', ''],
        customFlags: [LLMFlags.hasImageInput],
        unsupportedRuntimeField: true,
      } as any,
    })
    const data = clonePlain(DBState.db)

    setDatabase(data)

    expect(DBState.db.modelProfiles).toEqual([
      {
        id: 'profile-a',
        name: 'Primary',
        providerId: 'openai',
        modelId: 'gpt-5',
        providerOptions: {
          requestModel: 'wire-model',
          baseUrl: 'https://profile.example.com/v1',
          apiKey: 'profile-secret',
          extraHeaders: { 'X-Test': 'yes' },
          additionalParams: [['header::X-Test', 'true']],
          openrouter: {
            fallback: false,
            middleOut: true,
            provider: { order: ['ProfileProvider'], only: ['profile-only'] },
          },
          nanogpt: { providerHint: 'profile-nano', useSubscriptionEndpoint: true },
          ollama: { url: 'http://localhost:11434', requestFormat: LLMFormat.OpenAIResponseAPI },
          vertex: {
            projectId: 'project-a',
            region: 'us-central1',
            clientEmail: 'svc@example.iam.gserviceaccount.com',
            privateKey: 'private-key',
          },
          customApi: { tokenizer: LLMTokenizer.Mistral, flags: [LLMFlags.hasStreaming] },
        },
      },
      { id: 'profile-b', name: 'Identity Only' },
      { id: 'profile-c', name: 'profile-c' },
    ])
    expect(DBState.db.modelRoleProfiles).toEqual({
      ...Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])),
      memory: { mode: 'profile', profileId: 'profile-a' },
    })
    expect(DBState.db.modelRuntimeDefaults).toEqual({
      maxContext: 8192,
      temperature: 55,
      modelTools: ['tool-a'],
      customFlags: [LLMFlags.hasImageInput],
    })
  })

  it('saves durable profile fields into legacy bot preset snapshots', async () => {
    seedPresetDatabase({
      modelProfiles: [
        { id: 'profile-a', name: 'Profile A', modelId: 'gpt-5', providerOptions: { requestModel: 'wire-model' } },
      ],
      modelRoleProfiles: normalizedModelRoleProfiles({
        memory: { mode: 'profile', profileId: 'profile-a' },
      }) as Database['modelRoleProfiles'],
      modelRuntimeDefaults: { maxContext: 8192, temperature: 55 },
      agentPresets: [{ id: 'agent-preset-a', name: 'Agent A', enabled: true, version: 1, steps: [] }],
      agentPresetDefaultId: 'agent-preset-a',
    })
    const calls = stubFailedPresetCommand()

    saveCurrentPreset()

    const command = await waitForPresetCommand(calls, '/presets/preset-a')
    expect(command.body.patch).toMatchObject({
      id: 'preset-a',
      modelProfiles: [
        { id: 'profile-a', name: 'Profile A', modelId: 'gpt-5', providerOptions: { requestModel: 'wire-model' } },
      ],
      modelRoleProfiles: expect.objectContaining({
        memory: { mode: 'profile', profileId: 'profile-a' },
      }),
      modelRuntimeDefaults: { maxContext: 8192, temperature: 55 },
      agentPresets: [{ id: 'agent-preset-a', name: 'Agent A', enabled: true, version: 1, steps: [] }],
      agentPresetDefaultId: 'agent-preset-a',
    })
  })

  it('applies durable profile fields from legacy bot presets with normalization', () => {
    seedPresetDatabase({
      modelProfiles: [{ id: 'base-profile', name: 'Base Profile' }],
      modelRoleProfiles: normalizedModelRoleProfiles({
        memory: { mode: 'profile', profileId: 'base-profile' },
      }) as Database['modelRoleProfiles'],
      modelRuntimeDefaults: { maxContext: 4096 },
    })

    setPreset(
      DBState.db,
      makePreset('preset-c', 'Gamma', {
        modelProfiles: [
          {
            id: ' target-profile ',
            name: ' Target Profile ',
            modelId: ' target-model ',
            providerOptions: { requestModel: ' target-wire ' },
          } as never,
          { id: 'target-profile', name: 'Duplicate' } as never,
        ],
        modelRoleProfiles: {
          memory: { mode: 'profile', profileId: ' target-profile ' },
          translate: { mode: 'legacy' },
        } as never,
        modelRuntimeDefaults: {
          temperature: 66,
          modelTools: [' preset-tool ', ''],
        } as never,
        agentPresets: [
          { id: ' agent-target ', name: ' Target Agent ', enabled: true, steps: [] },
          { id: 'agent-target', name: 'Duplicate Agent', enabled: true, steps: [] },
        ] as never,
        agentPresetDefaultId: 'agent-target',
      }),
    )

    expect(DBState.db.modelProfiles).toEqual([
      {
        id: 'target-profile',
        name: 'Target Profile',
        modelId: 'target-model',
        providerOptions: { requestModel: 'target-wire' },
      },
    ])
    expect(DBState.db.modelRoleProfiles).toEqual(
      normalizedModelRoleProfiles({
        memory: { mode: 'profile', profileId: 'target-profile' },
      }),
    )
    expect(DBState.db.modelRuntimeDefaults).toEqual({
      temperature: 66,
      modelTools: ['preset-tool'],
    })
    expect(DBState.db.agentPresets).toEqual([
      { id: 'agent-target', name: 'Target Agent', enabled: true, version: 1, steps: [] },
    ])
    expect(DBState.db.agentPresetDefaultId).toBe('agent-target')
  })

  it('does not apply legacy bot preset promptTemplate into top-level promptTemplate', () => {
    seedPresetDatabase()
    const beforePromptTemplate = clonePlain(DBState.db.promptTemplate)

    setPreset(
      DBState.db,
      makePreset('preset-c', 'Gamma', {
        promptTemplate: [{ id: 'gamma-prompt', type: 'plain', text: 'gamma prompt item' }] as any,
      }),
    )

    expect(DBState.db.mainPrompt).toBe('Gamma prompt')
    expect(DBState.db.promptTemplate).toEqual(beforePromptTemplate)
  })
})

describe('agent preset database normalization', () => {
  it('normalizes Agent Preset records and clears stale defaults through setDatabase', () => {
    seedPresetDatabase({
      agentPresets: [
        {
          id: ' ap_research ',
          name: ' Research ',
          enabled: true,
          steps: [{ id: ' aps_context ', outputKey: ' context ' }],
        } as any,
      ],
      agentPresetDefaultId: 'missing-agent-preset',
    })
    const data = clonePlain(DBState.db)

    setDatabase(data)

    expect(DBState.db.agentPresets).toEqual([
      {
        id: 'ap_research',
        name: 'Research',
        enabled: true,
        version: 1,
        steps: [
          {
            id: 'aps_context',
            name: 'aps_context',
            enabled: true,
            phase: 'beforeMain',
            dependencies: [],
            instruction: '',
            model: { mode: 'inheritMain' },
            runtime: {},
            inputScopes: [],
            outputKey: 'context',
            outputFormat: 'text',
            destination: 'promptOutput',
            failurePolicy: { mode: 'required' },
          },
        ],
      },
    ])
    expect(DBState.db.agentPresetDefaultId).toBeUndefined()
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
    modelRoles: {
      chatMain: '',
      chatAux: '',
      memory: '',
      emotion: '',
      translate: '',
      otherAx: '',
      scriptMain: '',
      scriptAux: '',
    },
    seperateModelsForAxModels: true,
    seperateModels: { memory: 'm', emotion: 'e', translate: 't', otherAx: 'o', scriptMain: '', scriptAux: '' },
    doNotChangeFallbackModels: false,
    fallbackModels: {
      memory: ['m1'],
      emotion: ['e1'],
      translate: ['t1'],
      otherAx: ['o1'],
      model: ['x1'],
      scriptMain: [],
      scriptAux: [],
    },
    fallbackWhenBlankResponse: true,
    disableSeperateParameterChangeOnPresetChange: false,
    seperateParameters: {
      memory: {},
      emotion: {},
      translate: {},
      otherAx: {},
      scriptMain: {},
      scriptAux: {},
      overrides: {},
    },
    modelTools: ['tool-a'],
    verbosity: 2,
    dynamicOutput: null,
    customBackground: 'live background',
    ...patch,
  } as unknown as Database
}

beforeEach(() => {
  vi.stubGlobal('safeStructuredClone', (value: unknown) => JSON.parse(JSON.stringify(value)))
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
  it('advances destructive refresh epoch for full database replacement but not partial merges', () => {
    seedDatabase([])
    const beforeFullReplace = captureDestructiveRefreshEpoch()

    applyServerProjectionDatabase({
      characters: [],
      modules: [],
      personas: [],
      language: 'ko',
    } as unknown as Database)

    expect(hasDestructiveRefreshEpochChanged(beforeFullReplace)).toBe(true)
    expect(DBState.db.language).toBe('ko')

    const afterFullReplace = captureDestructiveRefreshEpoch()
    mergeServerProjectionFields({ language: 'en' } as Partial<Database>)

    expect(DBState.db.language).toBe('en')
    expect(captureDestructiveRefreshEpoch()).toBe(afterFullReplace)
  })

  it('applies the runtime language side effect when a targeted projection merges language', () => {
    seedDatabase([])
    changeLanguage('en')
    expect(activeLanguage.showHelp).toBe('Show Help')

    mergeServerProjectionFields({ language: 'ko' } as Partial<Database>)

    expect(DBState.db.language).toBe('ko')
    expect(activeLanguage.showHelp).toBe('도움말 보기')
  })

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
  it('applies a prompt preset legacy regex alias when presetRegex is empty', async () => {
    const liveRegex = [{ id: 'live-regex', in: 'hi', out: 'LIVE', type: 'editinput' }]
    const selectedRegex = [{ id: 'selected-regex', in: 'hi', out: 'SELECTED', type: 'editinput' }]
    seedPresetDatabase({
      presetRegex: liveRegex as any,
      promptPresets: [
        { id: 'prompt-a', name: 'Prompt A', presetRegex: liveRegex },
        { id: 'prompt-b', name: 'Prompt B', regex: selectedRegex, presetRegex: [] },
      ] as any,
      promptPresetsId: 0,
    })
    setCachedServerCommandRevision(100)
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      expect(String(input)).toBe('/api/v1/commands/prompt-presets/select')
      expect(init.method).toBe('POST')
      return jsonResponse({
        revision: 101,
        event: {
          type: 'promptPreset.selected',
          revision: 101,
          resource: 'preset',
          id: 'prompt-b',
        },
        promptPresetId: 'prompt-b',
      })
    })
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)

    selectPromptPreset(1)

    expect(DBState.db.promptPresetsId).toBe(1)
    expect(DBState.db.presetRegex).toEqual(selectedRegex)
    await waitForState(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
  })

  it('clears stale legacy regex when updating canonical prompt preset regex', async () => {
    const staleRegex = [{ id: 'stale-regex', in: 'hi', out: 'STALE', type: 'editinput' }]
    seedPresetDatabase({
      presetRegex: staleRegex as any,
      promptPresets: [{ id: 'prompt-a', name: 'Prompt A', regex: staleRegex, presetRegex: [] }] as any,
      promptPresetsId: 0,
    })
    setCachedServerCommandRevision(100)
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      expect(String(input)).toBe('/api/v1/commands/prompt-presets/prompt-a')
      expect(init.method).toBe('PATCH')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body.patch).toMatchObject({ presetRegex: [], regex: [] })
      return jsonResponse({
        revision: 101,
        event: {
          type: 'promptPreset.updated',
          revision: 101,
          resource: 'preset',
          id: 'prompt-a',
        },
        promptPresetId: 'prompt-a',
      })
    })
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)

    updatePromptPreset(0, { presetRegex: [] } as any)

    expect(DBState.db.promptPresets[0]).toMatchObject({ regex: [], presetRegex: [] })
    expect(DBState.db.presetRegex).toEqual([])
    await waitForState(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
  })

  it('skips projection refreeze when hydrated bot preset ids are already normalized', async () => {
    const preset = makePreset('preset-a', 'Alpha')
    delete preset.promptTemplate
    seedPresetDatabase({
      botPresets: [preset],
      botPresetsId: 0,
    })
    setServerProjectionWriteGuardEnabled(true)
    const before = DBState.db

    expect(botPresetIdsNeedNormalization(DBState.db)).toBe(false)
    await expect(ensureBotPresetHydrated(0)).resolves.toBe(true)

    expect(DBState.db).toBe(before)
  })

  it('fails closed without repairing, refreezing, or fetching when projected preset ids are invalid', async () => {
    const cases: Array<{ name: string; botPresets: botPreset[] }> = [
      {
        name: 'missing id',
        botPresets: [{ name: 'Alpha', promptTemplate: [] } as botPreset],
      },
      {
        name: 'duplicate id',
        botPresets: [
          { id: 'preset-dupe', name: 'Alpha', image: 'img' } as botPreset,
          { id: 'preset-dupe', name: 'Beta', image: 'img' } as botPreset,
        ],
      },
    ]

    for (const scenario of cases) {
      seedPresetDatabase({
        botPresets: scenario.botPresets,
        botPresetsId: 0,
      })
      setServerProjectionWriteGuardEnabled(true)
      const fetchSpy = vi.fn(async () => {
        throw new Error(`unexpected preset hydration fetch for ${scenario.name}`)
      })
      vi.stubGlobal('fetch', fetchSpy)
      const before = DBState.db
      const beforeJson = JSON.stringify(DBState.db)

      expect(botPresetIdsNeedNormalization(DBState.db)).toBe(true)
      await expect(ensureBotPresetHydrated(0)).resolves.toBe(false)

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(DBState.db).toBe(before)
      expect(JSON.stringify(DBState.db)).toBe(beforeJson)

      setServerProjectionWriteGuardEnabled(false)
      vi.unstubAllGlobals()
    }
  })

  it('fails closed without fetching when preset hydration is asked for an invalid index', async () => {
    seedPresetDatabase({
      botPresets: [{ id: 'preset-stub', name: 'Stub', image: 'img' } as botPreset],
      botPresetsId: 0,
    })
    setServerProjectionWriteGuardEnabled(true)
    const fetchSpy = vi.fn(async () => {
      throw new Error('unexpected preset hydration fetch for invalid index')
    })
    vi.stubGlobal('fetch', fetchSpy)
    const before = DBState.db

    await expect(ensureBotPresetHydrated(-1)).resolves.toBe(false)
    await expect(ensureBotPresetHydrated(1)).resolves.toBe(false)
    await expect(ensureBotPresetHydrated(0.5)).resolves.toBe(false)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(DBState.db).toBe(before)
  })

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

  it('does not snapshot top-level promptTemplate into legacy bot presets', async () => {
    seedPresetDatabase({
      promptTemplate: [{ id: 'live-only-prompt', type: 'plain', text: 'live only prompt row' }] as any,
    })
    const beforePresetTemplate = clonePlain(DBState.db.botPresets[0].promptTemplate)
    setServerProjectionWriteGuardEnabled(true)
    const calls = stubFailedPresetCommand()

    saveCurrentPreset()

    const command = await waitForPresetCommand(calls, '/presets/preset-a')
    expect(command.body.patch).not.toHaveProperty('promptTemplate')
    expect(DBState.db.botPresets[0].promptTemplate).toEqual(beforePresetTemplate)
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
    const calls = stubFailedPresetCommand(() => {
      DBState.db.botPresets[0].name = 'Alpha edited after dispatch'
      DBState.db.botPresets.push(makePreset('preset-c', 'Gamma appended after dispatch'))
      DBState.db.botPresetsId = 1
    })

    saveCurrentPreset()

    expect(DBState.db.botPresets[0].temperature).toBe(91)
    await waitForPresetCommand(calls, '/presets/preset-a')
    await waitForState(() => {
      expect(DBState.db.botPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b', 'preset-c'])
      expect(DBState.db.botPresets[0]).toMatchObject({
        name: 'Alpha edited after dispatch',
        temperature: 11,
      })
      expect(DBState.db.botPresets[2]).toMatchObject({ name: 'Gamma appended after dispatch' })
      expect(DBState.db.botPresetsId).toBe(1)
      expect(DBState.db.temperature).toBe(91)
    })
  })

  it('keeps a newer model preset rename visible when an older rename request fails', async () => {
    seedPresetDatabase({
      modelPresets: [makePreset('model-a', 'Alpha') as unknown as ModelPreset],
      modelPresetsId: 0,
    })
    const calls = stubModelPresetRenameRace()

    updateModelPreset(0, { name: 'Alph' })
    updateModelPreset(0, { name: 'Alp' })

    expect(DBState.db.modelPresets[0].name).toBe('Alp')
    await waitForPresetCommand(calls, '/model-presets/model-a')
    await waitForState(() => {
      expect(calls.filter((call) => call.url === '/api/v1/commands/model-presets/model-a')).toHaveLength(2)
      expect(DBState.db.modelPresets[0].name).toBe('Alp')
    })
  })

  it('failed prompt create removes only the unchanged attempted row and preserves split siblings', async () => {
    seedPresetDatabase({
      modelPresets: [makePreset('model-a', 'Model A') as unknown as ModelPreset],
      modelPresetsId: 0,
      promptPresets: [
        makePreset('prompt-a', 'Prompt A') as unknown as PromptPreset,
        makePreset('prompt-b', 'Prompt B') as unknown as PromptPreset,
      ],
      promptPresetsId: 0,
    })
    const calls = stubFailedPresetCommand(() => {
      DBState.db.modelPresets[0] = {
        ...DBState.db.modelPresets[0],
        name: 'Model A edited after dispatch',
      }
      DBState.db.promptPresets[1] = {
        ...DBState.db.promptPresets[1],
        name: 'Prompt B edited after dispatch',
      }
    })

    createPromptPreset(makePreset('prompt-created', 'Prompt Created') as unknown as PromptPreset)

    expect(DBState.db.promptPresets.map((preset) => preset.id)).toEqual(['prompt-a', 'prompt-b', 'prompt-created'])
    await waitForPresetCommand(calls, '/prompt-presets')
    await waitForState(() => {
      expect(DBState.db.promptPresets.map((preset) => preset.id)).toEqual(['prompt-a', 'prompt-b'])
      expect(DBState.db.promptPresets[1]).toMatchObject({ name: 'Prompt B edited after dispatch' })
      expect(DBState.db.modelPresets).toEqual([
        expect.objectContaining({ id: 'model-a', name: 'Model A edited after dispatch' }),
      ])
    })
  })

  it('failed prompt create keeps the attempted row when it changed after dispatch', async () => {
    seedPresetDatabase({
      promptPresets: [makePreset('prompt-a', 'Prompt A') as unknown as PromptPreset],
      promptPresetsId: 0,
    })
    let createdId: string | undefined
    const calls = stubFailedPresetCommand(() => {
      const created = DBState.db.promptPresets.find((preset) => preset.name === 'Prompt Created')
      createdId = created?.id
      if (created) {
        created.name = 'Prompt Created edited after dispatch'
      }
    })

    createPromptPreset(makePreset('prompt-created', 'Prompt Created') as unknown as PromptPreset)

    await waitForPresetCommand(calls, '/prompt-presets')
    await waitForState(() => {
      expect(createdId).toBe('prompt-created')
      expect(DBState.db.promptPresets.map((preset) => preset.id)).toEqual(['prompt-a', 'prompt-created'])
      expect(DBState.db.promptPresets[1]).toMatchObject({ name: 'Prompt Created edited after dispatch' })
    })
  })

  it('failed model delete reinserts only missing rows and skips a newer same-id row', async () => {
    seedPresetDatabase({
      modelPresets: [
        makePreset('model-a', 'Model A') as unknown as ModelPreset,
        makePreset('model-b', 'Model B') as unknown as ModelPreset,
        makePreset('model-c', 'Model C') as unknown as ModelPreset,
      ],
      modelPresetsId: 0,
    })
    const calls = stubFailedPresetCommand(() => {
      DBState.db.modelPresets[0] = {
        ...DBState.db.modelPresets[0],
        name: 'Model A edited after dispatch',
      }
      DBState.db.modelPresets.push(makePreset('model-d', 'Model D appended after dispatch') as unknown as ModelPreset)
    })

    deleteModelPreset(1, 0)

    expect(DBState.db.modelPresets.map((preset) => preset.id)).toEqual(['model-a', 'model-c'])
    await waitForPresetCommand(calls, '/model-presets/model-b')
    await waitForState(() => {
      expect(DBState.db.modelPresets.map((preset) => preset.id)).toEqual(['model-a', 'model-b', 'model-c', 'model-d'])
      expect(DBState.db.modelPresets[0]).toMatchObject({ name: 'Model A edited after dispatch' })
      expect(DBState.db.modelPresets[1]).toMatchObject({ name: 'Model B' })
      expect(DBState.db.modelPresets[3]).toMatchObject({ name: 'Model D appended after dispatch' })
    })

    clearCachedServerCommandRevision()
    vi.unstubAllGlobals()
    seedPresetDatabase({
      modelPresets: [
        makePreset('model-a', 'Model A') as unknown as ModelPreset,
        makePreset('model-b', 'Model B') as unknown as ModelPreset,
        makePreset('model-c', 'Model C') as unknown as ModelPreset,
      ],
      modelPresetsId: 0,
    })
    const secondCalls = stubFailedPresetCommand(() => {
      DBState.db.modelPresets.push(makePreset('model-b', 'Model B newer same id') as unknown as ModelPreset)
    })

    deleteModelPreset(1, 0)

    await waitForPresetCommand(secondCalls, '/model-presets/model-b')
    await waitForState(() => {
      expect(DBState.db.modelPresets.map((preset) => preset.id)).toEqual(['model-a', 'model-c', 'model-b'])
      expect(DBState.db.modelPresets[2]).toMatchObject({ name: 'Model B newer same id' })
    })
  })

  it('failed prompt reorder restores only the prior id order and preserves row edits', async () => {
    seedPresetDatabase({
      promptPresets: [
        makePreset('prompt-a', 'Prompt A') as unknown as PromptPreset,
        makePreset('prompt-b', 'Prompt B') as unknown as PromptPreset,
        makePreset('prompt-c', 'Prompt C') as unknown as PromptPreset,
      ],
      promptPresetsId: 1,
    })
    const calls = stubFailedPresetCommand(() => {
      const promptC = DBState.db.promptPresets.find((preset) => preset.id === 'prompt-c')
      if (promptC) {
        promptC.name = 'Prompt C edited after dispatch'
      }
    })

    reorderPromptPresets(0, 3)

    expect(DBState.db.promptPresets.map((preset) => preset.id)).toEqual(['prompt-b', 'prompt-c', 'prompt-a'])
    expect(DBState.db.promptPresetsId).toBe(0)
    await waitForPresetCommand(calls, '/prompt-presets/reorder')
    await waitForState(() => {
      expect(DBState.db.promptPresets.map((preset) => preset.id)).toEqual(['prompt-a', 'prompt-b', 'prompt-c'])
      expect(DBState.db.promptPresets[2]).toMatchObject({ name: 'Prompt C edited after dispatch' })
      expect(DBState.db.promptPresetsId).toBe(1)
    })
  })

  it('failed older prompt reorder skips rollback when a newer order changed live ids', async () => {
    seedPresetDatabase({
      promptPresets: [
        makePreset('prompt-a', 'Prompt A') as unknown as PromptPreset,
        makePreset('prompt-b', 'Prompt B') as unknown as PromptPreset,
        makePreset('prompt-c', 'Prompt C') as unknown as PromptPreset,
      ],
      promptPresetsId: 1,
    })
    const calls = stubFailedPresetCommand(() => {
      DBState.db.promptPresets = [DBState.db.promptPresets[1], DBState.db.promptPresets[2], DBState.db.promptPresets[0]]
      DBState.db.promptPresetsId = 0
    })

    reorderPromptPresets(0, 3)

    await waitForPresetCommand(calls, '/prompt-presets/reorder')
    await waitForState(() => {
      expect(DBState.db.promptPresets.map((preset) => preset.id)).toEqual(['prompt-c', 'prompt-a', 'prompt-b'])
      expect(DBState.db.promptPresetsId).toBe(0)
    })
  })

  it('failed model select restores only attempted-matching selection and settings', async () => {
    seedPresetDatabase({
      modelPresets: [
        makePreset('model-a', 'Model A', { aiModel: 'model-a-api', temperature: 11 }) as unknown as ModelPreset,
        makePreset('model-b', 'Model B', { aiModel: 'model-b-api', temperature: 22 }) as unknown as ModelPreset,
      ],
      modelPresetsId: 0,
    })
    const calls = stubFailedPresetCommand(() => {
      DBState.db.temperature = 123
    })

    selectModelPreset(1)

    expect(DBState.db.modelPresetsId).toBe(1)
    expect(DBState.db.aiModel).toBe('model-b-api')
    expect(DBState.db.temperature).toBe(22)
    await waitForPresetCommand(calls, '/model-presets/select')
    await waitForState(() => {
      expect(DBState.db.modelPresetsId).toBe(0)
      expect(DBState.db.aiModel).toBe('live-model')
      expect(DBState.db.temperature).toBe(123)
    })
  })

  it('failed prompt select restores only attempted-matching selection and settings', async () => {
    seedPresetDatabase({
      promptPresets: [
        makePreset('prompt-a', 'Prompt A') as unknown as PromptPreset,
        makePreset('prompt-b', 'Prompt B') as unknown as PromptPreset,
      ],
      promptPresetsId: 0,
    })
    const calls = stubFailedPresetCommand(() => {
      DBState.db.globalNote = 'newer note after dispatch'
    })

    selectPromptPreset(1)

    expect(DBState.db.promptPresetsId).toBe(1)
    expect(DBState.db.mainPrompt).toBe('Prompt B prompt')
    expect(DBState.db.globalNote).toBe('Prompt B note')
    await waitForPresetCommand(calls, '/prompt-presets/select')
    await waitForState(() => {
      expect(DBState.db.promptPresetsId).toBe(0)
      expect(DBState.db.mainPrompt).toBe('live main')
      expect(DBState.db.globalNote).toBe('newer note after dispatch')
    })
  })

  it('applies split presets as base, selected model preset, then selected prompt preset overrides', () => {
    const modelPreset = {
      id: 'model-a',
      name: 'Model A',
      aiModel: 'model-ai',
      subModel: 'model-sub',
      temperature: 31,
      modelRoles: { memory: 'model-memory', scriptAux: 'model-script-aux' },
      modelProfiles: [
        {
          id: ' model-profile ',
          name: ' Model Profile ',
          modelId: ' model-ai ',
          providerOptions: { requestModel: ' model-wire ', apiKey: ' model-secret ', openAIKey: 'must-drop' },
        },
      ],
      modelRoleProfiles: {
        memory: { mode: 'profile', profileId: ' model-profile ' },
      },
      modelRuntimeDefaults: {
        maxContext: 7777,
        modelTools: [' model-tool ', ''],
      },
      seperateModelsForAxModels: true,
      seperateModels: {
        memory: 'model-separate-memory',
        emotion: '',
        translate: '',
        otherAx: '',
        scriptMain: '',
        scriptAux: 'model-separate-script-aux',
      },
      fallbackModels: {
        model: ['model-fallback-main'],
        memory: ['model-fallback-memory'],
        emotion: [],
        translate: [],
        otherAx: [],
        scriptMain: [],
        scriptAux: ['model-fallback-script-aux'],
      },
    } as unknown as ModelPreset
    const promptPreset = {
      id: 'prompt-a',
      name: 'Prompt A',
      mainPrompt: 'prompt main',
      temperature: 88,
      overrideModelParameters: false,
      modelRoles: { memory: 'prompt-memory', scriptAux: 'prompt-script-aux' },
      modelProfiles: [{ id: 'prompt-profile', name: 'Prompt Profile' }],
      modelRoleProfiles: {
        memory: { mode: 'profile', profileId: 'prompt-profile' },
      },
      modelRuntimeDefaults: {
        maxContext: 9999,
      },
      seperateModelsForAxModels: true,
      seperateModels: {
        memory: 'prompt-separate-memory',
        emotion: '',
        translate: '',
        otherAx: '',
        scriptMain: '',
        scriptAux: 'prompt-separate-script-aux',
      },
      fallbackModels: {
        model: ['prompt-fallback-main'],
        memory: ['prompt-fallback-memory'],
        emotion: [],
        translate: [],
        otherAx: [],
        scriptMain: [],
        scriptAux: ['prompt-fallback-script-aux'],
      },
      fallbackWhenBlankResponse: true,
    } as unknown as PromptPreset

    seedPresetDatabase({
      aiModel: 'base-ai',
      subModel: 'base-sub',
      temperature: 12,
      modelRoles: { memory: 'base-memory', scriptAux: 'base-script-aux' } as Database['modelRoles'],
      modelProfiles: [{ id: 'base-profile', name: 'Base Profile', modelId: 'base-ai' }],
      modelRoleProfiles: normalizedModelRoleProfiles({
        memory: { mode: 'profile', profileId: 'base-profile' },
      }) as Database['modelRoleProfiles'],
      modelRuntimeDefaults: { maxContext: 1111 },
      seperateModelsForAxModels: false,
      seperateModels: {
        memory: 'base-separate-memory',
        emotion: '',
        translate: '',
        otherAx: '',
        scriptMain: '',
        scriptAux: 'base-separate-script-aux',
      },
      fallbackModels: {
        model: ['base-fallback-main'],
        memory: ['base-fallback-memory'],
        emotion: [],
        translate: [],
        otherAx: [],
        scriptMain: [],
        scriptAux: ['base-fallback-script-aux'],
      },
      modelPresets: [modelPreset],
      modelPresetsId: 0,
      promptPresets: [promptPreset],
      promptPresetsId: 0,
    })

    applyModelPresetFieldsToDatabase(DBState.db, DBState.db.modelPresets[0])

    expect(DBState.db.aiModel).toBe('model-ai')
    expect(DBState.db.subModel).toBe('model-sub')
    expect(DBState.db.temperature).toBe(31)
    expect(DBState.db.modelRoles).toMatchObject({
      memory: 'prompt-memory',
      scriptAux: 'prompt-script-aux',
    })
    expect(DBState.db.modelProfiles).toEqual([
      {
        id: 'model-profile',
        name: 'Model Profile',
        modelId: 'model-ai',
        providerOptions: { requestModel: 'model-wire', apiKey: 'model-secret' },
      },
    ])
    expect(DBState.db.modelRoleProfiles).toEqual(
      normalizedModelRoleProfiles({
        memory: { mode: 'profile', profileId: 'prompt-profile' },
      }),
    )
    expect(DBState.db.modelRuntimeDefaults).toEqual({
      maxContext: 7777,
      modelTools: ['model-tool'],
    })
    expect(DBState.db.seperateModelsForAxModels).toBe(true)
    expect(DBState.db.seperateModels).toMatchObject({
      memory: 'prompt-separate-memory',
      scriptAux: 'prompt-separate-script-aux',
    })
    expect(DBState.db.fallbackModels).toMatchObject({
      model: ['prompt-fallback-main'],
      memory: ['prompt-fallback-memory'],
      scriptAux: ['prompt-fallback-script-aux'],
    })
    expect(DBState.db.fallbackWhenBlankResponse).toBe(true)

    DBState.db.promptPresets[0] = {
      ...DBState.db.promptPresets[0],
      overrideModelParameters: true,
      temperature: 88,
    }
    applyPromptPresetFieldsToDatabase(DBState.db, DBState.db.promptPresets[0])

    expect(DBState.db.temperature).toBe(88)
  })

  it('L21: failed copy restores the original collection after save-current and generated copy id', async () => {
    seedPresetDatabase({ temperature: 88 })
    let generatedCopyId: string | undefined
    const calls = stubFailedPresetCommand(() => {
      generatedCopyId = DBState.db.botPresets.find((preset) => preset.name === 'Alpha Copy')?.id
      DBState.db.botPresets[0].name = 'Alpha source edited after dispatch'
      DBState.db.botPresets.push(makePreset('preset-c', 'Gamma appended after dispatch'))
    })

    copyPreset(0)

    expect(DBState.db.botPresets).toHaveLength(3)
    expect(DBState.db.botPresets[0].temperature).toBe(88)
    await waitForPresetCommand(calls, '/presets/preset-a/copy')
    await waitForState(() => {
      expect(generatedCopyId).toBeTruthy()
      expect(DBState.db.botPresets.some((preset) => preset.id === generatedCopyId)).toBe(false)
      expect(DBState.db.botPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b', 'preset-c'])
      expect(DBState.db.botPresets[0]).toMatchObject({
        name: 'Alpha source edited after dispatch',
        temperature: 11,
      })
      expect(DBState.db.botPresets[2]).toMatchObject({ name: 'Gamma appended after dispatch' })
      expect(DBState.db.botPresetsId).toBe(0)
    })
  })

  it('L21: shared preset boundary keeps copy as one rollback-safe command', async () => {
    seedPresetDatabase({ temperature: 77 })
    const beforeSourceTemperature = DBState.db.botPresets[0].temperature
    const beforeSelected = DBState.db.botPresetsId
    const calls = stubFailedPresetCommand()

    copyPreset(0)

    await waitForPresetCommand(calls, '/presets/preset-a/copy')
    await waitForState(() => {
      expect(DBState.db.botPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b'])
      expect(DBState.db.botPresets.some((preset) => preset.name === 'Alpha Copy')).toBe(false)
      expect(DBState.db.botPresets[0].temperature).toBe(beforeSourceTemperature)
      expect(DBState.db.botPresetsId).toBe(beforeSelected)
    })

    // Public preset operations currently stay one server command each; copy
    // folds save-current into the copy payload instead of dispatching fanout.
    const presetCommands = calls.filter((call) => call.url.startsWith('/api/v1/commands/presets'))
    expect(presetCommands).toHaveLength(1)
    expect(presetCommands[0].body).toMatchObject({
      baseRevision: 100,
      name: 'Alpha Copy',
      saveCurrent: true,
    })
    expect(presetCommands[0].body.newPresetId).toBeTruthy()
  })

  it('L21: failed create removes the optimistic preset and generated id', async () => {
    seedPresetDatabase()
    let optimisticPresetId: string | undefined
    const calls = stubFailedPresetCommand(() => {
      optimisticPresetId = DBState.db.botPresets.find((preset) => preset.name === 'Created')?.id
      DBState.db.botPresets[0].name = 'Alpha edited after dispatch'
      DBState.db.botPresets.push(makePreset('preset-c', 'Gamma appended after dispatch'))
      DBState.db.botPresetsId = 1
    })
    const newPreset = makePreset('preset-created', 'Created')
    delete newPreset.id

    createPreset(newPreset)

    const optimisticPreset = DBState.db.botPresets.find((preset) => preset.name === 'Created')
    expect(optimisticPreset?.id).toBeTruthy()
    await waitForPresetCommand(calls, '/presets')
    await waitForState(() => {
      expect(optimisticPresetId).toBe(optimisticPreset?.id)
      expect(DBState.db.botPresets.some((preset) => preset.id === optimisticPreset?.id)).toBe(false)
      expect(DBState.db.botPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b', 'preset-c'])
      expect(DBState.db.botPresets[0]).toMatchObject({ name: 'Alpha edited after dispatch' })
      expect(DBState.db.botPresets[2]).toMatchObject({ name: 'Gamma appended after dispatch' })
      expect(DBState.db.botPresetsId).toBe(1)
    })
  })

  it('L21: failed update restores the patched preset row', async () => {
    seedPresetDatabase()
    const calls = stubFailedPresetCommand(() => {
      DBState.db.botPresets[1].name = 'Newer Beta edit after dispatch'
      DBState.db.botPresets.push(makePreset('preset-c', 'Gamma appended after dispatch'))
    })

    updatePreset(1, { name: 'Broken Update', temperature: 99 })

    expect(DBState.db.botPresets[1]).toMatchObject({ name: 'Broken Update', temperature: 99 })
    await waitForPresetCommand(calls, '/presets/preset-b')
    await waitForState(() => {
      expect(DBState.db.botPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b', 'preset-c'])
      expect(DBState.db.botPresets[1]).toMatchObject({
        name: 'Newer Beta edit after dispatch',
        temperature: 22,
      })
      expect(DBState.db.botPresets[2]).toMatchObject({ name: 'Gamma appended after dispatch' })
      expect(DBState.db.botPresetsId).toBe(0)
    })
  })

  it('L21: failed delete restores collection, selection, and setPreset scalars', async () => {
    seedPresetDatabase()
    const calls = stubFailedPresetCommand(() => {
      DBState.db.botPresets.push(makePreset('preset-c', 'Gamma appended after dispatch'))
      DBState.db.botPresetsId = 1
      DBState.db.mainPrompt = 'newer prompt after dispatch'
    })

    deletePreset(0, 1, true)

    expect(DBState.db.botPresets.map((preset) => preset.id)).toEqual(['preset-b'])
    expect(DBState.db.botPresetsId).toBe(0)
    expect(DBState.db.mainPrompt).toBe('Beta prompt')
    await waitForPresetCommand(calls, '/presets/preset-a')
    await waitForState(() => {
      expect(DBState.db.botPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b', 'preset-c'])
      expect(DBState.db.botPresets[0]).toMatchObject({ name: 'Alpha' })
      expect(DBState.db.botPresets[2]).toMatchObject({ name: 'Gamma appended after dispatch' })
      expect(DBState.db.botPresetsId).toBe(2)
      expect(DBState.db.mainPrompt).toBe('newer prompt after dispatch')
    })
  })

  it('legacy delete with apply does not change top-level promptTemplate', async () => {
    seedPresetDatabase()
    const beforePromptTemplate = clonePlain(DBState.db.promptTemplate)
    const calls = stubFailedPresetCommand()

    deletePreset(0, 1, true)

    expect(DBState.db.botPresetsId).toBe(0)
    expect(DBState.db.mainPrompt).toBe('Beta prompt')
    expect(DBState.db.promptTemplate).toEqual(beforePromptTemplate)
    await waitForPresetCommand(calls, '/presets/preset-a')
  })

  it('L21: failed reorder restores collection order and selected index', async () => {
    seedPresetDatabase({
      botPresets: [makePreset('preset-a', 'Alpha'), makePreset('preset-b', 'Beta'), makePreset('preset-c', 'Gamma')],
      botPresetsId: 1,
    })
    const calls = stubFailedPresetCommand(() => {
      const gamma = DBState.db.botPresets.find((preset) => preset.id === 'preset-c')
      if (gamma) {
        gamma.name = 'Gamma edited after dispatch'
      }
    })

    reorderPresets(0, 3)

    expect(DBState.db.botPresets.map((preset) => preset.id)).toEqual(['preset-b', 'preset-c', 'preset-a'])
    expect(DBState.db.botPresetsId).toBe(0)
    await waitForPresetCommand(calls, '/presets/reorder')
    await waitForState(() => {
      expect(DBState.db.botPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b', 'preset-c'])
      expect(DBState.db.botPresets[2]).toMatchObject({ name: 'Gamma edited after dispatch' })
      expect(DBState.db.botPresetsId).toBe(1)
    })
  })

  it('failed older legacy reorder skips rollback after a newer reorder changes live ids', async () => {
    seedPresetDatabase({
      botPresets: [makePreset('preset-a', 'Alpha'), makePreset('preset-b', 'Beta'), makePreset('preset-c', 'Gamma')],
      botPresetsId: 1,
    })
    const calls = stubFailedPresetCommand(() => {
      DBState.db.botPresets = [DBState.db.botPresets[1], DBState.db.botPresets[2], DBState.db.botPresets[0]]
      DBState.db.botPresetsId = 0
    })

    reorderPresets(0, 3)

    await waitForPresetCommand(calls, '/presets/reorder')
    await waitForState(() => {
      expect(DBState.db.botPresets.map((preset) => preset.id)).toEqual(['preset-c', 'preset-a', 'preset-b'])
      expect(DBState.db.botPresetsId).toBe(0)
    })
  })

  it('L21: failed select restores setPreset scalars without overwriting unrelated fields', async () => {
    seedPresetDatabase()
    const beforePresets = clonePlain(DBState.db.botPresets)
    const beforePrompt = DBState.db.mainPrompt
    const beforePromptTemplate = clonePlain(DBState.db.promptTemplate)
    const beforeNaiSettings = clonePlain(DBState.db.NAIsettings)
    const calls = stubFailedPresetCommand(() => {
      DBState.db.temperature = 123
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
      expect(DBState.db.temperature).toBe(123)
      expect(DBState.db.promptTemplate).toEqual(beforePromptTemplate)
      expect(DBState.db.NAIsettings).toEqual(beforeNaiSettings)
      expect(DBState.db.customBackground).toBe('changed while preset command was in flight')
    })
  })

  it('legacy select does not change top-level promptTemplate', async () => {
    seedPresetDatabase()
    const beforePromptTemplate = clonePlain(DBState.db.promptTemplate)
    const calls = stubFailedPresetCommand()

    changeToPreset(1, false)

    expect(DBState.db.botPresetsId).toBe(1)
    expect(DBState.db.mainPrompt).toBe('Beta prompt')
    expect(DBState.db.promptTemplate).toEqual(beforePromptTemplate)
    await waitForPresetCommand(calls, '/presets/select')
  })

  it('failed legacy extract preserves split preset edits while removing unchanged generated rows', async () => {
    seedPresetDatabase({
      botPresets: [makePreset('preset-a', 'Alpha'), makePreset('preset-b', 'Beta')],
      botPresetsId: 0,
      modelPresets: [
        makePreset('model-existing', 'Existing Model', {
          aiModel: 'existing-model-api',
          temperature: 77,
        }) as unknown as ModelPreset,
      ],
      modelPresetsId: 0,
      promptPresets: [makePreset('prompt-existing', 'Existing Prompt') as unknown as PromptPreset],
      promptPresetsId: 0,
    })
    const calls = stubFailedPresetCommand(() => {
      DBState.db.modelPresets[0].name = 'Existing Model edited after dispatch'
      DBState.db.modelPresets.push(
        makePreset('model-newer', 'Newer Model appended after dispatch', {
          aiModel: 'newer-model-api',
        }) as unknown as ModelPreset,
      )
      DBState.db.promptPresets[0].name = 'Existing Prompt edited after dispatch'
      DBState.db.promptPresets.push(
        makePreset('prompt-newer', 'Newer Prompt appended after dispatch') as unknown as PromptPreset,
      )
    })

    extractLegacyBotPresetByIndex(0, 'all')

    expect(DBState.db.botPresets.map((preset) => preset.id)).toEqual(['preset-b'])
    expect(DBState.db.modelPresets.some((preset) => preset.name === 'Alpha Model')).toBe(true)
    expect(DBState.db.promptPresets.some((preset) => preset.name === 'Alpha Prompt')).toBe(true)
    expect(DBState.db.promptPresets.find((preset) => preset.name === 'Alpha Prompt')?.promptTemplate).toEqual([
      { id: 'preset-a-prompt', type: 'plain', text: 'Alpha prompt item' },
    ])
    await waitForPresetCommand(calls, '/legacy-bot-presets/preset-a/extract')
    await waitForState(() => {
      expect(DBState.db.botPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b'])
      expect(DBState.db.botPresetsId).toBe(0)
      expect(DBState.db.modelPresets.map((preset) => preset.id)).toEqual(['model-existing', 'model-newer'])
      expect(DBState.db.modelPresets[0]).toMatchObject({ name: 'Existing Model edited after dispatch' })
      expect(DBState.db.modelPresets[1]).toMatchObject({ name: 'Newer Model appended after dispatch' })
      expect(DBState.db.promptPresets.map((preset) => preset.id)).toEqual(['prompt-existing', 'prompt-newer'])
      expect(DBState.db.promptPresets[0]).toMatchObject({ name: 'Existing Prompt edited after dispatch' })
      expect(DBState.db.promptPresets[1]).toMatchObject({ name: 'Newer Prompt appended after dispatch' })
    })
  })
})
