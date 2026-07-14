import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'preset-rollback-token',
}))

vi.mock('../process/modules', async (importActual) => {
  const actual = await importActual<typeof import('../process/modules')>()
  return { ...actual, getModuleTriggers: () => [], moduleUpdate: () => {} }
})

import {
  clearCachedServerCommandRevision,
  setCachedServerCommandRevision,
  setServerCommandSuccessReconciler,
  type ServerCommandLocalEffect,
} from '../server/commands'
import { isCollectionAcknowledgementTainted, isSettingsAcknowledgementTainted } from '../server/resourceState.svelte'
import { captureDestructiveRefreshEpoch, hasDestructiveRefreshEpochChanged } from '../server/staleStateGuards'
import {
  applyModelPresetFieldsToDatabase,
  applyPromptPresetFieldsToDatabase,
  applyServerResourceDatabase,
  botPresetIdsNeedNormalization,
  changeToPreset,
  copyPreset,
  createPreset,
  createPromptPreset,
  deleteModelPreset,
  deletePreset,
  ensureBotPresetHydrated,
  extractLegacyBotPresetByIndex,
  flushPendingSplitPresetPatch,
  flushPendingSplitPresetPatches,
  getDatabase,
  mergeServerResourceCharacterRow,
  mergeServerResourceFields,
  normalizePromptTemplateIds,
  presetTemplate,
  promptTemplateIdsNeedNormalization,
  reorderModelPresets,
  reorderPromptPresets,
  reorderPresets,
  saveCurrentPreset,
  setDatabase,
  setDatabaseLite,
  setPreset,
  setResourceWriteGuardEnabled,
  selectModelPreset,
  selectPromptPreset,
  updatePreset,
  updateModelPreset,
  updatePromptPreset,
  withTrustedResourceWrite,
  type botPreset,
  type Database,
  type ModelPreset,
  type PromptPreset,
} from './database.svelte'
import { flushRegisteredPendingBridgePatches } from '../server/pendingBridgeFlushRegistry'
import { MODEL_ROLES } from '../model/modelRoles'
import { LLMFlags, LLMFormat, LLMTokenizer } from '../model/types'
import { changeLanguage, language as activeLanguage } from '../../lang'

interface CapturedFetch {
  url: string
  method: string
  body: any
  keepalive?: boolean
}

function seedDatabase(characters: Array<Record<string, unknown>>) {
  setDatabaseLite({
    characters,
    modules: [],
    personas: [],
    language: 'en',
  } as unknown as Database)
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
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

function stubSuccessfulSplitPresetCommands(): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  let revision = 100
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      const call = {
        url,
        method: init.method ?? 'GET',
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        keepalive: init.keepalive === true,
      }
      calls.push(call)
      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 100 })
      if (url.startsWith('/api/v1/commands/model-presets/')) {
        revision += 1
        const isSelection = url.endsWith('/select')
        const modelPresetId = isSelection
          ? call.body.modelPresetId
          : decodeURIComponent(url.slice('/api/v1/commands/model-presets/'.length))
        return jsonResponse({
          revision,
          event: {
            type: isSelection ? 'modelPreset.selected' : 'modelPreset.updated',
            revision,
            resource: 'preset',
            id: modelPresetId,
          },
          modelPresetId,
        })
      }
      if (url.startsWith('/api/v1/commands/prompt-presets/')) {
        revision += 1
        const isSelection = url.endsWith('/select')
        const promptPresetId = isSelection
          ? call.body.promptPresetId
          : decodeURIComponent(url.slice('/api/v1/commands/prompt-presets/'.length))
        return jsonResponse({
          revision,
          event: {
            type: isSelection ? 'promptPreset.selected' : 'promptPreset.updated',
            revision,
            resource: 'preset',
            id: promptPresetId,
          },
          promptPresetId,
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

function stubSuccessfulLegacyPresetCommands(
  canonicalReceipt: (call: CapturedFetch) => {
    canonicalValues?: Record<string, unknown>
    canonicalDeletedKeys?: string[]
  } = () => ({}),
): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  let revision = 100
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
      if (url.startsWith('/api/v1/commands/presets/')) {
        revision += 1
        const presetId = decodeURIComponent(url.slice('/api/v1/commands/presets/'.length))
        const receipt = canonicalReceipt(call)
        return jsonResponse({
          revision,
          event: { type: 'preset.updated', revision, resource: 'presetRow', id: presetId },
          presetId,
          acknowledgedKeys: Object.keys(call.body.patch),
          canonicalValues: receipt.canonicalValues ?? {},
          canonicalDeletedKeys: receipt.canonicalDeletedKeys ?? [],
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

async function captureFullLegacyPresetSavePayload(settings: Partial<Database> = {}): Promise<botPreset> {
  seedPresetDatabase({
    ...settings,
    botPresets: [{ id: 'preset-a', name: 'Alpha', image: 'img' } as botPreset],
    botPresetsId: 0,
  })
  setCachedServerCommandRevision(100)
  const calls = stubFailedPresetCommand()

  saveCurrentPreset()

  const command = await waitForPresetCommand(calls, '/presets/preset-a')
  return { ...clonePlain(command.body.patch), id: 'preset-a' } as botPreset
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
    const data = clonePlain(getDatabase())

    setDatabase(data)

    expect(getDatabase().keepSessionAlive).toBe('sound')
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
    const data = clonePlain(getDatabase())

    setDatabase(data)

    expect(getDatabase().modelProfiles).toEqual([
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
    expect(getDatabase().modelRoleProfiles).toEqual({
      ...Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])),
      memory: { mode: 'profile', profileId: 'profile-a' },
    })
    expect(getDatabase().modelRuntimeDefaults).toEqual({
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
      getDatabase(),
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

    expect(getDatabase().modelProfiles).toEqual([
      {
        id: 'target-profile',
        name: 'Target Profile',
        modelId: 'target-model',
        providerOptions: { requestModel: 'target-wire' },
      },
    ])
    expect(getDatabase().modelRoleProfiles).toEqual(
      normalizedModelRoleProfiles({
        memory: { mode: 'profile', profileId: 'target-profile' },
      }),
    )
    expect(getDatabase().modelRuntimeDefaults).toEqual({
      temperature: 66,
      modelTools: ['preset-tool'],
    })
    expect(getDatabase().agentPresets).toEqual([
      { id: 'agent-target', name: 'Target Agent', enabled: true, version: 1, steps: [] },
    ])
    expect(getDatabase().agentPresetDefaultId).toBe('agent-target')
  })

  it('does not apply legacy bot preset promptTemplate into top-level promptTemplate', () => {
    seedPresetDatabase()
    const beforePromptTemplate = clonePlain(getDatabase().promptTemplate)

    setPreset(
      getDatabase(),
      makePreset('preset-c', 'Gamma', {
        promptTemplate: [{ id: 'gamma-prompt', type: 'plain', text: 'gamma prompt item' }] as any,
      }),
    )

    expect(getDatabase().mainPrompt).toBe('Gamma prompt')
    expect(getDatabase().promptTemplate).toEqual(beforePromptTemplate)
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
    const data = clonePlain(getDatabase())

    setDatabase(data)

    expect(getDatabase().agentPresets).toEqual([
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
    expect(getDatabase().agentPresetDefaultId).toBeUndefined()
  })
})

function seedPresetDatabase(patch: Partial<Database> = {}): void {
  setDatabaseLite({
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
  } as unknown as Database)
}

beforeEach(() => {
  vi.stubGlobal('safeStructuredClone', (value: unknown) => JSON.parse(JSON.stringify(value)))
  clearCachedServerCommandRevision()
  setServerCommandSuccessReconciler(null)
  setResourceWriteGuardEnabled(false)
})

afterEach(() => {
  setResourceWriteGuardEnabled(false)
  setServerCommandSuccessReconciler(null)
  setDatabaseLite({
    characters: [],
    modules: [],
    personas: [],
    language: 'en',
  } as unknown as Database)
  vi.unstubAllGlobals()
})

describe('mergeServerResourceCharacterRow', () => {
  it('advances destructive refresh epoch for full database replacement but not partial merges', () => {
    seedDatabase([])
    const beforeFullReplace = captureDestructiveRefreshEpoch()

    applyServerResourceDatabase({
      characters: [],
      modules: [],
      personas: [],
      language: 'ko',
    } as unknown as Database)

    expect(hasDestructiveRefreshEpochChanged(beforeFullReplace)).toBe(true)
    expect(getDatabase().language).toBe('ko')

    const afterFullReplace = captureDestructiveRefreshEpoch()
    mergeServerResourceFields({ language: 'en' } as Partial<Database>)

    expect(getDatabase().language).toBe('en')
    expect(captureDestructiveRefreshEpoch()).toBe(afterFullReplace)
  })

  it('applies the runtime language side effect when a targeted projection merges language', () => {
    seedDatabase([])
    changeLanguage('en')
    expect(activeLanguage.showHelp).toBe('Show Help')

    mergeServerResourceFields({ language: 'ko' } as Partial<Database>)

    expect(getDatabase().language).toBe('ko')
    expect(activeLanguage.showHelp).toBe('도움말 보기')
  })

  it('applies null deletion sentinels without clearing unrelated projected fields', () => {
    seedPresetDatabase({
      agentPresetDefaultId: 'agent-old',
      promptTemplate: [{ id: 'prompt-live', type: 'plain', text: 'keep me' }] as any,
    })

    mergeServerResourceFields({ agentPresetDefaultId: null } as unknown as Partial<Database>)

    expect(getDatabase().agentPresetDefaultId).toBeUndefined()
    expect(getDatabase().promptTemplate).toEqual([{ id: 'prompt-live', type: 'plain', text: 'keep me' }])
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

    const applied = mergeServerResourceCharacterRow({
      chaId: 'char-a',
      name: 'Ada Lovelace',
      chats: [{ id: 'chat-a', message: [] }],
    })

    expect(applied).toBe(true)
    expect(getDatabase().characters[0].name).toBe('Ada Lovelace')
    expect(getDatabase().characters[0].chats[0].message).toEqual([])
    expect(getDatabase().characters[0].chats[0].hypaV3Data).toEqual(hypaV3Data)
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

    const applied = mergeServerResourceCharacterRow({
      chaId: 'char-a',
      name: 'Ada Lovelace',
      chats: [{ id: 'chat-a', message: [] }],
    })

    expect(applied).toBe(true)
    expect(getDatabase().characters[0].name).toBe('Ada Lovelace')
    expect(getDatabase().characters[0].chats[0].message).toEqual(priorMessages)
    expect(getDatabase().characters[0].chats[0].hypaV3Data).toBeUndefined()
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

    const applied = mergeServerResourceCharacterRow({
      __serverCharacterShell: true,
      chaId: 'char-a',
      name: 'Ada full',
      desc: 'Hydrated description',
      chats: [{ id: 'chat-a', message: [] }],
    })

    expect(applied).toBe(true)
    expect(getDatabase().characters[0]).toMatchObject({
      chaId: 'char-a',
      name: 'Ada full',
      desc: 'Hydrated description',
    })
    expect(getDatabase().characters[0]).not.toHaveProperty('__serverCharacterShell')
  })

  it('returns false for unknown characters without mutating the corpus', () => {
    seedDatabase([
      {
        chaId: 'char-a',
        name: 'Ada',
        chats: [{ id: 'chat-a', message: [] }],
      },
    ])
    const characters = getDatabase().characters
    const before = JSON.stringify(characters)

    const applied = mergeServerResourceCharacterRow({
      chaId: 'char-missing',
      name: 'Missing',
      chats: [{ id: 'chat-missing', message: [] }],
    })

    expect(applied).toBe(false)
    expect(getDatabase().characters).toBe(characters)
    expect(JSON.stringify(getDatabase().characters)).toBe(before)
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

    expect(getDatabase().promptPresetsId).toBe(1)
    expect(getDatabase().presetRegex).toEqual(selectedRegex)
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
      expect(body.patch).toEqual({ name: 'Prompt A final', regex: [] })
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

    updatePromptPreset(0, { name: 'Prompt A draft' })
    updatePromptPreset(0, { name: 'Prompt A final' })
    updatePromptPreset(0, { presetRegex: [] } as any)
    flushPendingSplitPresetPatches()

    expect(getDatabase().promptPresets[0]).toMatchObject({ regex: [], presetRegex: [] })
    expect(getDatabase().presetRegex).toEqual([])
    await waitForState(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
  })

  it('skips projection refreeze when hydrated bot preset ids are already normalized', async () => {
    const preset = makePreset('preset-a', 'Alpha')
    delete preset.promptTemplate
    seedPresetDatabase({
      botPresets: [preset],
      botPresetsId: 0,
    })
    setResourceWriteGuardEnabled(true)
    const before = getDatabase()

    expect(botPresetIdsNeedNormalization(getDatabase())).toBe(false)
    await expect(ensureBotPresetHydrated(0)).resolves.toBe(true)

    expect(getDatabase()).toBe(before)
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
      setResourceWriteGuardEnabled(true)
      const fetchSpy = vi.fn(async () => {
        throw new Error(`unexpected preset hydration fetch for ${scenario.name}`)
      })
      vi.stubGlobal('fetch', fetchSpy)
      const before = getDatabase()
      const beforeJson = JSON.stringify(getDatabase())

      expect(botPresetIdsNeedNormalization(getDatabase())).toBe(true)
      await expect(ensureBotPresetHydrated(0)).resolves.toBe(false)

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(getDatabase()).toBe(before)
      expect(JSON.stringify(getDatabase())).toBe(beforeJson)

      setResourceWriteGuardEnabled(false)
      vi.unstubAllGlobals()
    }
  })

  it('fails closed without fetching when preset hydration is asked for an invalid index', async () => {
    seedPresetDatabase({
      botPresets: [{ id: 'preset-stub', name: 'Stub', image: 'img' } as botPreset],
      botPresetsId: 0,
    })
    setResourceWriteGuardEnabled(true)
    const fetchSpy = vi.fn(async () => {
      throw new Error('unexpected preset hydration fetch for invalid index')
    })
    vi.stubGlobal('fetch', fetchSpy)
    const before = getDatabase()

    await expect(ensureBotPresetHydrated(-1)).resolves.toBe(false)
    await expect(ensureBotPresetHydrated(1)).resolves.toBe(false)
    await expect(ensureBotPresetHydrated(0.5)).resolves.toBe(false)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(getDatabase()).toBe(before)
  })

  it('hydrates a stubbed preset from the server projection before full-preset consumers read it', async () => {
    seedPresetDatabase({
      botPresets: [{ id: 'preset-stub', name: 'Stub', image: 'img' } as botPreset],
      botPresetsId: 0,
    })
    setResourceWriteGuardEnabled(true)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe('/api/v1/legacy-presets/preset-stub')
        return jsonResponse({
          revision: 7,
          preset: makePreset('preset-stub', 'Hydrated', {
            promptTemplate: [{ id: 'hydrated-prompt', type: 'plain', text: 'hydrated prompt' }] as any,
          }),
        })
      }) as unknown as typeof fetch,
    )

    await expect(ensureBotPresetHydrated(0)).resolves.toBe(true)

    expect(getDatabase().botPresets[0]).toMatchObject({
      id: 'preset-stub',
      name: 'Hydrated',
      mainPrompt: 'Hydrated prompt',
      promptTemplate: [{ id: 'hydrated-prompt', type: 'plain', text: 'hydrated prompt' }],
    })
  })

  it('does not refetch an authoritative legacy preset with no optional settings fields', async () => {
    seedPresetDatabase({
      botPresets: [{ id: 'preset-minimal', name: 'Minimal', image: 'minimal.png' } as botPreset],
      botPresetsId: 0,
    })
    setResourceWriteGuardEnabled(true)
    const fetchSpy = vi.fn(async () =>
      jsonResponse({
        revision: 7,
        preset: {
          id: 'preset-minimal',
          name: 'Minimal',
          image: 'minimal.png',
          localNetworkMode: false,
          localNetworkTimeoutSec: 600,
        },
      }),
    )
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)

    await expect(ensureBotPresetHydrated(0)).resolves.toBe(true)
    withTrustedResourceWrite(() => {
      getDatabase().botPresets[0] = clonePlain(getDatabase().botPresets[0])
    })
    await expect(ensureBotPresetHydrated(0)).resolves.toBe(true)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(getDatabase().botPresets[0]).toEqual({
      id: 'preset-minimal',
      name: 'Minimal',
      image: 'minimal.png',
      localNetworkMode: false,
      localNetworkTimeoutSec: 600,
    })
  })

  it('rejects a legacy hydration body that omits the requested stable id', async () => {
    seedPresetDatabase({
      botPresets: [{ id: 'preset-stub', name: 'Stub', image: 'img' } as botPreset],
      botPresetsId: 0,
    })
    setResourceWriteGuardEnabled(true)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          revision: 7,
          preset: { name: 'Malformed', mainPrompt: 'must not apply' },
        }),
      ) as unknown as typeof fetch,
    )

    await expect(ensureBotPresetHydrated(0)).resolves.toBe(false)
    expect(getDatabase().botPresets[0]).toEqual({ id: 'preset-stub', name: 'Stub', image: 'img' })
  })

  it('waits for stable-id hydration before selecting a legacy preset', async () => {
    const alpha = makePreset('preset-a', 'Alpha')
    const betaShell = { id: 'preset-b', name: 'Beta', image: 'beta.png' } as botPreset
    seedPresetDatabase({ botPresets: [alpha, betaShell], botPresetsId: 0 })
    setCachedServerCommandRevision(100)
    setResourceWriteGuardEnabled(true)
    const hydration = deferred<Response>()
    const command = deferred<Response>()
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
        const call = {
          url: String(input),
          method: init.method ?? 'GET',
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        }
        calls.push(call)
        return call.url === '/api/v1/legacy-presets/preset-b' ? hydration.promise : command.promise
      }) as unknown as typeof fetch,
    )

    changeToPreset(1, false)
    await vi.waitFor(() => expect(calls.map((call) => call.url)).toEqual(['/api/v1/legacy-presets/preset-b']))
    expect(getDatabase().botPresetsId).toBe(0)
    expect(getDatabase().mainPrompt).toBe('live main')

    mergeServerResourceFields({
      botPresets: [betaShell, alpha],
      botPresetsId: 1,
    } as Partial<Database>)
    hydration.resolve(jsonResponse({ revision: 100, preset: makePreset('preset-b', 'Beta') }))
    const selection = await waitForPresetCommand(calls, '/presets/select')

    expect(selection.body).toMatchObject({ presetId: 'preset-b', apply: true, saveCurrent: false })
    expect(getDatabase().botPresetsId).toBe(0)
    expect(getDatabase().mainPrompt).toBe('Beta prompt')
    command.resolve(
      jsonResponse({
        revision: 101,
        event: { type: 'preset.selected', revision: 101, resource: 'revisionOnly', id: 'preset-b' },
        presetId: 'preset-b',
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('waits for the stable-id replacement body before deleting and applying', async () => {
    const alpha = makePreset('preset-a', 'Alpha')
    const betaShell = { id: 'preset-b', name: 'Beta', image: 'beta.png' } as botPreset
    seedPresetDatabase({ botPresets: [alpha, betaShell], botPresetsId: 0 })
    setCachedServerCommandRevision(100)
    setResourceWriteGuardEnabled(true)
    const hydration = deferred<Response>()
    const command = deferred<Response>()
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
        const call = {
          url: String(input),
          method: init.method ?? 'GET',
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        }
        calls.push(call)
        return call.url === '/api/v1/legacy-presets/preset-b' ? hydration.promise : command.promise
      }) as unknown as typeof fetch,
    )

    deletePreset(0, 1, true)
    await vi.waitFor(() => expect(calls.map((call) => call.url)).toEqual(['/api/v1/legacy-presets/preset-b']))
    expect(getDatabase().botPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b'])
    expect(getDatabase().mainPrompt).toBe('live main')

    mergeServerResourceFields({
      botPresets: [betaShell, alpha],
      botPresetsId: 1,
    } as Partial<Database>)
    hydration.resolve(jsonResponse({ revision: 100, preset: makePreset('preset-b', 'Beta') }))
    const deletion = await waitForPresetCommand(calls, '/presets/preset-a')

    expect(deletion.body).toMatchObject({ presetId: 'preset-b', apply: true, saveCurrent: false })
    expect(getDatabase().botPresets.map((preset) => preset.id)).toEqual(['preset-b'])
    expect(getDatabase().mainPrompt).toBe('Beta prompt')
    command.resolve(jsonResponse({ error: 'finish pending delete' }, 500))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('hydrates and re-resolves a legacy extraction target by stable id', async () => {
    const alphaShell = { id: 'preset-a', name: 'Alpha', image: 'alpha.png' } as botPreset
    const beta = makePreset('preset-b', 'Beta')
    seedPresetDatabase({
      botPresets: [alphaShell, beta],
      botPresetsId: 0,
      modelPresets: [],
      promptPresets: [],
    })
    setCachedServerCommandRevision(100)
    setResourceWriteGuardEnabled(true)
    const hydration = deferred<Response>()
    const command = deferred<Response>()
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
        const call = {
          url: String(input),
          method: init.method ?? 'GET',
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        }
        calls.push(call)
        return call.url === '/api/v1/legacy-presets/preset-a' ? hydration.promise : command.promise
      }) as unknown as typeof fetch,
    )

    extractLegacyBotPresetByIndex(0, 'all')
    await vi.waitFor(() => expect(calls.map((call) => call.url)).toEqual(['/api/v1/legacy-presets/preset-a']))
    expect(getDatabase().botPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b'])
    expect(getDatabase().modelPresets).toEqual([])
    expect(getDatabase().promptPresets).toEqual([])

    mergeServerResourceFields({
      botPresets: [beta, alphaShell],
      botPresetsId: 1,
    } as Partial<Database>)
    hydration.resolve(jsonResponse({ revision: 100, preset: makePreset('preset-a', 'Alpha') }))
    await waitForPresetCommand(calls, '/legacy-bot-presets/preset-a/extract')

    expect(getDatabase().botPresets.map((preset) => preset.id)).toEqual(['preset-b'])
    expect(getDatabase().modelPresets.some((preset) => preset.name === 'Alpha Model')).toBe(true)
    expect(getDatabase().promptPresets.some((preset) => preset.name === 'Alpha Prompt')).toBe(true)
    command.resolve(jsonResponse({ error: 'finish pending extract' }, 500))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('hydrates a stubbed preset after an unrelated projection advances the known revision', async () => {
    seedPresetDatabase({
      botPresets: [{ id: 'preset-stub', name: 'Stub', image: 'img' } as botPreset],
      botPresetsId: 0,
    })
    setResourceWriteGuardEnabled(true)
    setCachedServerCommandRevision(5)
    const response = deferred<Response>()
    const fetchSpy = vi.fn((input: RequestInfo | URL) => {
      expect(String(input)).toBe('/api/v1/legacy-presets/preset-stub')
      return response.promise
    })
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)

    const pending = ensureBotPresetHydrated(0)
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    setCachedServerCommandRevision(6)
    mergeServerResourceFields({ language: 'ko' } as Partial<Database>)
    response.resolve(
      jsonResponse({
        revision: 5,
        preset: makePreset('preset-stub', 'Hydrated after settings'),
      }),
    )

    await expect(pending).resolves.toBe(true)

    expect(getDatabase().botPresets[0]).toMatchObject({
      id: 'preset-stub',
      name: 'Hydrated after settings',
      mainPrompt: 'Hydrated after settings prompt',
    })
    expect(getDatabase().language).toBe('ko')
  })

  it('rejects a preset hydration response after the target preset changes', async () => {
    seedPresetDatabase({
      botPresets: [{ id: 'preset-stub', name: 'Stub', image: 'img' } as botPreset],
      botPresetsId: 0,
    })
    setResourceWriteGuardEnabled(true)
    setCachedServerCommandRevision(5)
    const response = deferred<Response>()
    const fetchSpy = vi.fn(() => response.promise)
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)

    const pending = ensureBotPresetHydrated(0)
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    setCachedServerCommandRevision(6)
    mergeServerResourceFields({
      botPresets: [{ id: 'preset-stub', name: 'Newer projection', image: 'img' } as botPreset],
      botPresetsId: 0,
    } as Partial<Database>)
    response.resolve(
      jsonResponse({
        revision: 5,
        resource: 'preset',
        mode: 'preset',
        presetId: 'preset-stub',
        preset: makePreset('preset-stub', 'Stale hydration'),
      }),
    )

    await expect(pending).resolves.toBe(false)

    expect(getDatabase().botPresets[0]).toEqual({
      id: 'preset-stub',
      name: 'Newer projection',
      image: 'img',
    })
  })

  it('sends only changed fields when saving a large hydrated legacy preset', async () => {
    const modelProfiles = Array.from({ length: 80 }, (_, index) => ({
      id: `profile-${index}`,
      name: `Large unchanged profile ${index}`,
      modelId: `model-${index}`,
    }))
    const settings = { modelProfiles } as Partial<Database>
    const baseline = await captureFullLegacyPresetSavePayload(settings)
    seedPresetDatabase({
      ...settings,
      botPresets: [baseline, makePreset('preset-b', 'Beta')],
      botPresetsId: 0,
      temperature: 45,
    })
    setCachedServerCommandRevision(100)
    const calls = stubFailedPresetCommand()

    saveCurrentPreset()

    const command = await waitForPresetCommand(calls, '/presets/preset-a')
    expect(command.body.patch).toEqual({ temperature: 45 })
    expect(JSON.stringify(command.body)).not.toContain('Large unchanged profile')
  })

  it('attaches a client-only local acknowledgement to an exact legacy preset PATCH', async () => {
    seedPresetDatabase()
    setCachedServerCommandRevision(100)
    const calls = stubSuccessfulLegacyPresetCommands(() => ({ canonicalValues: { temperature: 43 } }))
    const observedEffects: ServerCommandLocalEffect[] = []
    setServerCommandSuccessReconciler((_event, _events, localEffects) => {
      observedEffects.push(...localEffects.values())
    })

    updatePreset(0, { temperature: 45 })

    const command = await waitForPresetCommand(calls, '/presets/preset-a')
    await waitForState(() => expect(observedEffects).toHaveLength(1))
    expect(command.body).toEqual({
      baseRevision: 100,
      patch: { temperature: 45 },
    })
    expect(command.body).not.toHaveProperty('optimisticAcknowledgement')
    expect(observedEffects).toEqual([
      {
        kind: 'legacyPresetPatch',
        presetId: 'preset-a',
        collectionProjectionEpoch: expect.any(Number),
        fields: {
          temperature: {
            attempted: { present: true, value: 45 },
            canonical: { present: true, value: 43 },
          },
        },
      },
    ])
  })

  it('attaches a local acknowledgement to an exact hydrated sparse current-preset save', async () => {
    const agentSettings = {
      agentPresets: [{ id: 'agent-a', name: 'Agent A', enabled: true, version: 1, steps: [] }],
      agentPresetDefaultId: 'agent-a',
    } as Partial<Database>
    const baseline = await captureFullLegacyPresetSavePayload(agentSettings)
    seedPresetDatabase({
      ...agentSettings,
      botPresets: [baseline, makePreset('preset-b', 'Beta')],
      botPresetsId: 0,
      temperature: 45,
    })
    setCachedServerCommandRevision(100)
    const calls = stubSuccessfulLegacyPresetCommands()
    const observedEffects: ServerCommandLocalEffect[] = []
    setServerCommandSuccessReconciler((_event, _events, localEffects) => {
      observedEffects.push(...localEffects.values())
    })

    saveCurrentPreset()

    const command = await waitForPresetCommand(calls, '/presets/preset-a')
    await waitForState(() => expect(observedEffects).toHaveLength(1))
    expect(command.body.patch).toEqual({ temperature: 45 })
    expect(observedEffects).toEqual([
      {
        kind: 'legacyPresetPatch',
        presetId: 'preset-a',
        collectionProjectionEpoch: expect.any(Number),
        fields: {},
      },
    ])
  })

  it('retains authoritative reconciliation for an unhydrated full current-preset save fallback', async () => {
    seedPresetDatabase({
      botPresets: [{ id: 'preset-a', name: 'Alpha', image: 'img' } as botPreset],
      botPresetsId: 0,
      temperature: 45,
    })
    setCachedServerCommandRevision(100)
    const calls = stubSuccessfulLegacyPresetCommands()
    const observedEffectCounts: number[] = []
    setServerCommandSuccessReconciler((_event, _events, localEffects) => {
      observedEffectCounts.push(localEffects.size)
    })

    saveCurrentPreset()

    const command = await waitForPresetCommand(calls, '/presets/preset-a')
    await waitForState(() => expect(observedEffectCounts).toEqual([0]))
    expect(Object.keys(command.body.patch).length).toBeGreaterThan(20)
  })

  it('retains authoritative reconciliation when a shell gains a hydration sentinel through updatePreset', async () => {
    seedPresetDatabase({
      botPresets: [{ id: 'preset-a', name: 'Alpha', image: 'img' } as botPreset],
      botPresetsId: 0,
    })
    setCachedServerCommandRevision(100)
    const calls = stubSuccessfulLegacyPresetCommands()
    const observedEffectCounts: number[] = []
    setServerCommandSuccessReconciler((_event, _events, localEffects) => {
      observedEffectCounts.push(localEffects.size)
    })

    updatePreset(0, { temperature: 45 })

    await waitForPresetCommand(calls, '/presets/preset-a')
    await waitForState(() => expect(observedEffectCounts).toEqual([0]))
  })

  it('retains authoritative reconciliation when legacy preset ids needed optimistic repair', async () => {
    const repaired = makePreset('temporary', 'Alpha')
    delete repaired.id
    seedPresetDatabase({ botPresets: [repaired], botPresetsId: 0 })
    setCachedServerCommandRevision(100)
    const calls = stubSuccessfulLegacyPresetCommands()
    const observedEffectCounts: number[] = []
    setServerCommandSuccessReconciler((_event, _events, localEffects) => {
      observedEffectCounts.push(localEffects.size)
    })

    updatePreset(0, { temperature: 45 })

    await waitForState(() => expect(calls.some((call) => call.url.startsWith('/api/v1/commands/presets/'))).toBe(true))
    await waitForState(() => expect(observedEffectCounts).toEqual([0]))
  })

  it.each([
    ['field update', () => updatePreset(0, { temperature: 45 })],
    ['current save', () => saveCurrentPreset()],
  ])('taints the legacy preset projection before rolling back a failed %s', async (_label, mutate) => {
    seedPresetDatabase({ temperature: 45 })
    setCachedServerCommandRevision(100)
    const calls = stubFailedPresetCommand()
    expect(isCollectionAcknowledgementTainted('botPresets')).toBe(false)

    mutate()

    await waitForState(() => expect(calls.some((call) => call.url.startsWith('/api/v1/commands/presets/'))).toBe(true))
    await waitForState(() => expect(isCollectionAcknowledgementTainted('botPresets')).toBe(true))
  })

  it('keeps legacy preset ids immutable across a mismatched-id update failure', async () => {
    seedPresetDatabase()
    setCachedServerCommandRevision(100)
    const calls = stubFailedPresetCommand()

    updatePreset(0, { id: 'renamed-on-client', temperature: 45 })

    expect(getDatabase().botPresets[0].id).toBe('preset-a')
    const command = await waitForPresetCommand(calls, '/presets/preset-a')
    expect(command.body.patch).toEqual({ temperature: 45 })
    await waitForState(() => {
      expect(getDatabase().botPresets[0]).toMatchObject({ id: 'preset-a', temperature: 11 })
    })
  })

  it('suppresses legacy preset updates whose mutable fields are unchanged', async () => {
    seedPresetDatabase()
    setCachedServerCommandRevision(100)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    updatePreset(0, { id: 'ignored-id', temperature: 11 })

    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getDatabase().botPresets[0]).toMatchObject({ id: 'preset-a', temperature: 11 })
    expect(isCollectionAcknowledgementTainted('botPresets')).toBe(false)
  })

  it('preserves explicit null, empty collection, and empty string clears in sparse save patches', async () => {
    const settings = {
      additionalParams: [['header::X-Legacy', 'enabled']],
      bias: [['token', 1]],
      customPromptTemplateToggle: 'enabled',
      dynamicOutput: { mode: 'legacy' } as any,
    } as Partial<Database>
    const baseline = await captureFullLegacyPresetSavePayload(settings)
    seedPresetDatabase({
      ...settings,
      botPresets: [baseline, makePreset('preset-b', 'Beta')],
      botPresetsId: 0,
    })
    getDatabase().additionalParams = []
    getDatabase().bias = []
    getDatabase().customPromptTemplateToggle = ''
    getDatabase().dynamicOutput = null
    setCachedServerCommandRevision(100)
    const calls = stubFailedPresetCommand()

    saveCurrentPreset()

    const command = await waitForPresetCommand(calls, '/presets/preset-a')
    expect(command.body.patch).toEqual({
      additionalParams: [],
      bias: [],
      customPromptTemplateToggle: '',
      dynamicOutput: null,
    })
  })

  it('suppresses an exact hydrated save no-op and preserves the local preset row', async () => {
    const baseline = await captureFullLegacyPresetSavePayload()
    seedPresetDatabase({
      botPresets: [baseline, makePreset('preset-b', 'Beta')],
      botPresetsId: 0,
    })
    setCachedServerCommandRevision(100)
    const calls = stubFailedPresetCommand()
    const before = getDatabase().botPresets[0]
    const beforeJson = JSON.stringify(before)

    saveCurrentPreset()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(calls).toHaveLength(0)
    expect(getDatabase().botPresets[0]).toBe(before)
    expect(JSON.stringify(getDatabase().botPresets[0])).toBe(beforeJson)
  })

  it('falls back to the full save payload for unhydrated and id-repaired baselines', async () => {
    const modelProfiles = [{ id: 'profile-large', name: 'Large unchanged fallback profile', modelId: 'model-a' }]
    const cases: Array<{ name: string; preset: botPreset }> = [
      {
        name: 'unhydrated',
        preset: { id: 'preset-a', name: 'Alpha', image: 'img' } as botPreset,
      },
      {
        name: 'id-repaired',
        preset: makePreset('temporary', 'Alpha', { modelProfiles }) as botPreset,
      },
    ]
    delete cases[1].preset.id

    for (const scenario of cases) {
      seedPresetDatabase({
        botPresets: [scenario.preset],
        botPresetsId: 0,
        modelProfiles,
      })
      setCachedServerCommandRevision(100)
      const calls = stubFailedPresetCommand()

      saveCurrentPreset()

      await waitForState(() =>
        expect(calls.some((call) => call.url.startsWith('/api/v1/commands/presets/'))).toBe(true),
      )
      const command = calls.find((call) => call.url.startsWith('/api/v1/commands/presets/'))!
      expect(command.body.patch.modelProfiles, scenario.name).toEqual(modelProfiles)
      expect(Object.keys(command.body.patch).length, scenario.name).toBeGreaterThan(20)
      expect(command.body.patch, scenario.name).not.toHaveProperty('id')

      vi.unstubAllGlobals()
    }
  })

  it('uses the historical full payload fallback when a hydrated baseline field is absent from the save snapshot', async () => {
    const modelProfiles = [{ id: 'profile-large', name: 'Large unchanged fallback profile', modelId: 'model-a' }]
    const settings = { modelProfiles } as Partial<Database>
    const baseline = await captureFullLegacyPresetSavePayload(settings)
    const baselineRecord = baseline as unknown as Record<string, unknown>
    baselineRecord.legacyOnlyField = 'cannot-delete-with-merge-patch'
    seedPresetDatabase({
      ...settings,
      botPresets: [baseline, makePreset('preset-b', 'Beta')],
      botPresetsId: 0,
    })
    setCachedServerCommandRevision(100)
    const calls = stubFailedPresetCommand()

    saveCurrentPreset()

    const command = await waitForPresetCommand(calls, '/presets/preset-a')
    expect(command.body.patch.modelProfiles).toEqual(modelProfiles)
    expect(command.body.patch).not.toHaveProperty('legacyOnlyField')
    expect(Object.keys(command.body.patch).length).toBeGreaterThan(20)
  })

  it('does not save an unloaded promptTemplate as null when snapshotting the current preset', async () => {
    seedPresetDatabase({
      botPresets: [{ id: 'preset-a', name: 'Alpha', image: 'img' } as botPreset],
      botPresetsId: 0,
    })
    delete (getDatabase() as unknown as { promptTemplate?: unknown }).promptTemplate
    setResourceWriteGuardEnabled(true)
    const calls = stubFailedPresetCommand()

    saveCurrentPreset()

    const command = await waitForPresetCommand(calls, '/presets/preset-a')
    expect(command.body.patch).toMatchObject({
      name: 'Alpha',
      mainPrompt: 'live main',
    })
    expect(command.body.patch).not.toHaveProperty('promptTemplate')
  })

  it('does not snapshot top-level promptTemplate into legacy bot presets', async () => {
    seedPresetDatabase({
      promptTemplate: [{ id: 'live-only-prompt', type: 'plain', text: 'live only prompt row' }] as any,
    })
    const beforePresetTemplate = clonePlain(getDatabase().botPresets[0].promptTemplate)
    setResourceWriteGuardEnabled(true)
    const calls = stubFailedPresetCommand()

    saveCurrentPreset()

    const command = await waitForPresetCommand(calls, '/presets/preset-a')
    expect(command.body.patch).not.toHaveProperty('promptTemplate')
    expect(getDatabase().botPresets[0].promptTemplate).toEqual(beforePresetTemplate)
  })

  it('ignores stale preset hydration responses older than the applied revision', async () => {
    seedPresetDatabase({
      botPresets: [{ id: 'preset-stub', name: 'Stub', image: 'img' } as botPreset],
      botPresetsId: 0,
    })
    setResourceWriteGuardEnabled(true)
    setCachedServerCommandRevision(9)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe('/api/v1/legacy-presets/preset-stub')
        return jsonResponse({
          revision: 8,
          preset: makePreset('preset-stub', 'Stale', {
            promptTemplate: [{ id: 'stale-prompt', type: 'plain', text: 'stale prompt' }] as any,
          }),
        })
      }) as unknown as typeof fetch,
    )

    await expect(ensureBotPresetHydrated(0)).resolves.toBe(false)

    expect(getDatabase().botPresets[0]).toEqual({ id: 'preset-stub', name: 'Stub', image: 'img' })
  })

  it('L21: failed save restores the saved preset collection and selected index', async () => {
    seedPresetDatabase({ temperature: 91 })
    const calls = stubFailedPresetCommand(() => {
      getDatabase().botPresets[0].name = 'Alpha edited after dispatch'
      getDatabase().botPresets.push(makePreset('preset-c', 'Gamma appended after dispatch'))
      getDatabase().botPresetsId = 1
    })

    saveCurrentPreset()

    expect(getDatabase().botPresets[0].temperature).toBe(91)
    await waitForPresetCommand(calls, '/presets/preset-a')
    await waitForState(() => {
      expect(getDatabase().botPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b', 'preset-c'])
      expect(getDatabase().botPresets[0]).toMatchObject({
        name: 'Alpha edited after dispatch',
        temperature: 11,
      })
      expect(getDatabase().botPresets[2]).toMatchObject({ name: 'Gamma appended after dispatch' })
      expect(getDatabase().botPresetsId).toBe(1)
      expect(getDatabase().temperature).toBe(91)
    })
  })

  it('coalesces same-owner rapid and disjoint field edits into one final sparse patch', async () => {
    seedPresetDatabase({
      modelPresets: [makePreset('model-a', 'Alpha', { temperature: 11 }) as unknown as ModelPreset],
      modelPresetsId: 0,
      temperature: 11,
    })
    setCachedServerCommandRevision(100)
    const calls = stubSuccessfulSplitPresetCommands()

    updateModelPreset(0, { name: 'Alph' })
    updateModelPreset(0, { temperature: 22 })
    updateModelPreset(0, { name: 'Alp' })

    expect(getDatabase().modelPresets[0].name).toBe('Alp')
    expect(getDatabase().modelPresets[0].temperature).toBe(22)
    expect(getDatabase().temperature).toBe(22)
    expect(calls).toHaveLength(0)

    flushPendingSplitPresetPatch('model', 'model-a')

    const command = await waitForPresetCommand(calls, '/model-presets/model-a')
    expect(command.body.patch).toEqual({ name: 'Alp', temperature: 22 })
    expect(command.body.patch).not.toHaveProperty('id')
    await waitForState(() => {
      expect(calls.filter((call) => call.url === '/api/v1/commands/model-presets/model-a')).toHaveLength(1)
      expect(getDatabase().modelPresets[0].name).toBe('Alp')
    })
  })

  it('suppresses baseline reverts and omits undefined values from local and server patches', async () => {
    seedPresetDatabase({
      modelPresets: [makePreset('model-a', 'Alpha') as unknown as ModelPreset],
      modelPresetsId: 0,
    })
    setCachedServerCommandRevision(100)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)

    updateModelPreset(0, { name: 'Alph' })
    updateModelPreset(0, { name: 'Alpha' })
    updateModelPreset(0, {
      optionalUnsetField: undefined,
      temperature: undefined,
    } as unknown as Partial<ModelPreset>)
    flushPendingSplitPresetPatches()
    await Promise.resolve()

    expect(getDatabase().modelPresets[0].name).toBe('Alpha')
    expect(getDatabase().modelPresets[0].temperature).toBe(30)
    expect(getDatabase().modelPresets[0]).not.toHaveProperty('optionalUnsetField')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('drops a reverted projected field while retaining a metadata-only collection patch', async () => {
    seedPresetDatabase({
      modelPresets: [makePreset('model-a', 'Alpha', { temperature: 11 }) as unknown as ModelPreset],
      modelPresetsId: 0,
      temperature: 11,
    })
    setCachedServerCommandRevision(100)
    const calls = stubSuccessfulSplitPresetCommands()

    updateModelPreset(0, { temperature: 22 })
    updateModelPreset(0, { temperature: 11, name: 'Alpha renamed' })
    flushPendingSplitPresetPatches()

    const command = await waitForPresetCommand(calls, '/model-presets/model-a')
    expect(command.body.patch).toEqual({ name: 'Alpha renamed' })
    expect(getDatabase().temperature).toBe(11)
  })

  it('keeps unrelated owners on independent debounce timers', async () => {
    vi.useFakeTimers()
    try {
      seedPresetDatabase({
        modelPresets: [
          makePreset('model-a', 'Alpha') as unknown as ModelPreset,
          makePreset('model-b', 'Beta') as unknown as ModelPreset,
        ],
        modelPresetsId: 0,
      })
      setCachedServerCommandRevision(100)
      const calls = stubSuccessfulSplitPresetCommands()

      updateModelPreset(0, { name: 'Alpha queued' })
      await vi.advanceTimersByTimeAsync(100)
      updateModelPreset(1, { name: 'Beta queued' })

      await vi.advanceTimersByTimeAsync(150)
      expect(calls.map((call) => call.url)).toEqual(['/api/v1/commands/model-presets/model-a'])

      await vi.advanceTimersByTimeAsync(100)
      expect(calls.map((call) => call.url)).toEqual([
        '/api/v1/commands/model-presets/model-a',
        '/api/v1/commands/model-presets/model-b',
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('rolls a failed coalesced patch back to the first baseline field by field', async () => {
    seedPresetDatabase({
      modelPresets: [makePreset('model-a', 'Alpha', { temperature: 11 }) as unknown as ModelPreset],
      modelPresetsId: 0,
    })
    setCachedServerCommandRevision(100)
    const calls = stubFailedPresetCommand(() => {
      getDatabase().modelPresets[0].temperature = 77
      getDatabase().temperature = 77
    })

    updateModelPreset(0, { name: 'Alph', temperature: 22 })
    updateModelPreset(0, { name: 'Alp', temperature: 33 })
    flushPendingSplitPresetPatches()

    const command = await waitForPresetCommand(calls, '/model-presets/model-a')
    expect(command.body.patch).toEqual({ name: 'Alp', temperature: 33 })
    await waitForState(() => {
      expect(getDatabase().modelPresets[0]).toMatchObject({ name: 'Alpha', temperature: 77 })
      expect(getDatabase().temperature).toBe(77)
    })
  })

  it('restores a selected preset projection when its deferred patch fails', async () => {
    seedPresetDatabase({
      modelPresets: [makePreset('model-a', 'Alpha', { temperature: 11 }) as unknown as ModelPreset],
      modelPresetsId: 0,
      temperature: 11,
    })
    setCachedServerCommandRevision(100)
    const calls = stubFailedPresetCommand()

    updateModelPreset(0, { temperature: 44 })
    expect(getDatabase().temperature).toBe(44)
    flushPendingSplitPresetPatches()

    await waitForPresetCommand(calls, '/model-presets/model-a')
    await waitForState(() => {
      expect(getDatabase().modelPresets[0].temperature).toBe(11)
      expect(getDatabase().temperature).toBe(11)
    })
  })

  it('does not roll a failed model projection over a newer prompt selection', async () => {
    seedPresetDatabase({
      modelPresets: [makePreset('model-a', 'Alpha', { temperature: 11 }) as unknown as ModelPreset],
      modelPresetsId: 0,
      promptPresets: [
        makePreset('prompt-a', 'Prompt A', { temperature: 11 }) as unknown as PromptPreset,
        {
          ...(makePreset('prompt-b', 'Prompt B', { temperature: 77 }) as unknown as PromptPreset),
          overrideModelParameters: true,
        },
      ],
      promptPresetsId: 0,
      temperature: 11,
    })
    setCachedServerCommandRevision(100)
    const calls = stubFailedPresetCommand(() => {
      getDatabase().promptPresetsId = 1
      applyPromptPresetFieldsToDatabase(getDatabase(), getDatabase().promptPresets[1])
    })

    updateModelPreset(0, { temperature: 44 })
    flushPendingSplitPresetPatches()

    await waitForPresetCommand(calls, '/model-presets/model-a')
    await waitForState(() => {
      expect(getDatabase().modelPresets[0].temperature).toBe(11)
      expect(getDatabase().promptPresetsId).toBe(1)
      expect(getDatabase().temperature).toBe(77)
    })
  })

  it('queues a pending owner patch before a structural selection command', async () => {
    seedPresetDatabase({
      modelPresets: [
        makePreset('model-a', 'Alpha') as unknown as ModelPreset,
        makePreset('model-b', 'Beta') as unknown as ModelPreset,
      ],
      modelPresetsId: 0,
      promptPresets: [makePreset('prompt-a', 'Prompt A') as unknown as PromptPreset],
      promptPresetsId: 0,
    })
    setCachedServerCommandRevision(100)
    const calls = stubSuccessfulSplitPresetCommands()

    updateModelPreset(0, { name: 'Alpha before select' })
    updatePromptPreset(0, { name: 'Prompt before model select' })
    selectModelPreset(1)

    await waitForState(() => expect(calls).toHaveLength(3))
    expect(calls.map((call) => call.url)).toEqual([
      '/api/v1/commands/model-presets/model-a',
      '/api/v1/commands/prompt-presets/prompt-a',
      '/api/v1/commands/model-presets/select',
    ])
    expect(calls[0].body.patch).toEqual({ name: 'Alpha before select' })
    expect(calls[1].body.patch).toEqual({ name: 'Prompt before model select' })
  })

  it('flushes pending split-preset patches through the central registry with keepalive', async () => {
    seedPresetDatabase({
      promptPresets: [makePreset('prompt-a', 'Prompt A') as unknown as PromptPreset],
      promptPresetsId: 0,
    })
    setCachedServerCommandRevision(100)
    const calls = stubSuccessfulSplitPresetCommands()

    updatePromptPreset(0, { name: 'Prompt before pagehide' })
    flushRegisteredPendingBridgePatches({ keepalive: true })

    const command = await waitForPresetCommand(calls, '/prompt-presets/prompt-a')
    expect(command.body.patch).toEqual({ name: 'Prompt before pagehide' })
    expect(command.keepalive).toBe(true)
  })

  it('rebases a later same-owner rollback after an unsettled earlier patch fails', async () => {
    vi.useFakeTimers()
    try {
      seedPresetDatabase({
        modelPresets: [makePreset('model-a', 'Alpha', { temperature: 30 }) as unknown as ModelPreset],
        modelPresetsId: 0,
        temperature: 30,
      })
      setCachedServerCommandRevision(100)
      const firstResponse = deferred<Response>()
      const calls: CapturedFetch[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
          calls.push({
            url: String(input),
            method: init.method ?? 'GET',
            body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
          })
          if (calls.length === 1) return firstResponse.promise
          return jsonResponse({ error: 'forced second patch failure' }, 500)
        }) as unknown as typeof fetch,
      )

      updateModelPreset(0, { temperature: 40 })
      await vi.advanceTimersByTimeAsync(250)
      expect(calls).toHaveLength(1)

      updateModelPreset(0, { temperature: 30 })
      await vi.advanceTimersByTimeAsync(250)
      expect(calls).toHaveLength(1)

      firstResponse.resolve(jsonResponse({ error: 'forced first patch failure' }, 500))
      await vi.runAllTimersAsync()
      for (let attempt = 0; attempt < 10 && calls.length < 2; attempt += 1) {
        await Promise.resolve()
      }

      expect(calls).toHaveLength(2)
      expect(getDatabase().modelPresets[0].temperature).toBe(30)
      expect(getDatabase().temperature).toBe(30)
    } finally {
      vi.useRealTimers()
    }
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
      getDatabase().modelPresets[0] = {
        ...getDatabase().modelPresets[0],
        name: 'Model A edited after dispatch',
      }
      getDatabase().promptPresets[1] = {
        ...getDatabase().promptPresets[1],
        name: 'Prompt B edited after dispatch',
      }
    })

    createPromptPreset(makePreset('prompt-created', 'Prompt Created') as unknown as PromptPreset)

    expect(getDatabase().promptPresets.map((preset) => preset.id)).toEqual(['prompt-a', 'prompt-b', 'prompt-created'])
    await waitForPresetCommand(calls, '/prompt-presets')
    await waitForState(() => {
      expect(getDatabase().promptPresets.map((preset) => preset.id)).toEqual(['prompt-a', 'prompt-b'])
      expect(getDatabase().promptPresets[1]).toMatchObject({ name: 'Prompt B edited after dispatch' })
      expect(getDatabase().modelPresets).toEqual([
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
      const created = getDatabase().promptPresets.find((preset) => preset.name === 'Prompt Created')
      createdId = created?.id
      if (created) {
        created.name = 'Prompt Created edited after dispatch'
      }
    })

    createPromptPreset(makePreset('prompt-created', 'Prompt Created') as unknown as PromptPreset)

    await waitForPresetCommand(calls, '/prompt-presets')
    await waitForState(() => {
      expect(createdId).toBe('prompt-created')
      expect(getDatabase().promptPresets.map((preset) => preset.id)).toEqual(['prompt-a', 'prompt-created'])
      expect(getDatabase().promptPresets[1]).toMatchObject({ name: 'Prompt Created edited after dispatch' })
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
      getDatabase().modelPresets[0] = {
        ...getDatabase().modelPresets[0],
        name: 'Model A edited after dispatch',
      }
      getDatabase().modelPresets.push(
        makePreset('model-d', 'Model D appended after dispatch') as unknown as ModelPreset,
      )
    })

    deleteModelPreset(1, 0)

    expect(getDatabase().modelPresets.map((preset) => preset.id)).toEqual(['model-a', 'model-c'])
    await waitForPresetCommand(calls, '/model-presets/model-b')
    await waitForState(() => {
      expect(getDatabase().modelPresets.map((preset) => preset.id)).toEqual([
        'model-a',
        'model-b',
        'model-c',
        'model-d',
      ])
      expect(getDatabase().modelPresets[0]).toMatchObject({ name: 'Model A edited after dispatch' })
      expect(getDatabase().modelPresets[1]).toMatchObject({ name: 'Model B' })
      expect(getDatabase().modelPresets[3]).toMatchObject({ name: 'Model D appended after dispatch' })
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
      getDatabase().modelPresets.push(makePreset('model-b', 'Model B newer same id') as unknown as ModelPreset)
    })

    deleteModelPreset(1, 0)

    await waitForPresetCommand(secondCalls, '/model-presets/model-b')
    await waitForState(() => {
      expect(getDatabase().modelPresets.map((preset) => preset.id)).toEqual(['model-a', 'model-c', 'model-b'])
      expect(getDatabase().modelPresets[2]).toMatchObject({ name: 'Model B newer same id' })
    })
  })

  it('captures client-only legacy/model reorder proofs from the optimistic projection', async () => {
    seedPresetDatabase({
      botPresets: [makePreset('preset-a', 'A'), makePreset('preset-b', 'B'), makePreset('preset-c', 'C')],
      botPresetsId: 1,
      modelPresets: [
        makePreset('model-a', 'Model A') as unknown as ModelPreset,
        makePreset('model-b', 'Model B') as unknown as ModelPreset,
        makePreset('model-c', 'Model C') as unknown as ModelPreset,
        makePreset('model-d', 'Model D') as unknown as ModelPreset,
      ],
      modelPresetsId: 1,
    })
    setCachedServerCommandRevision(100)
    const calls: CapturedFetch[] = []
    let revision = 100
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
        revision += 1
        if (url.endsWith('/presets/reorder')) {
          return jsonResponse({
            revision,
            event: {
              type: 'preset.reordered',
              revision,
              resource: 'presetCollectionWithPointer',
            },
            presetReorderCertificate: 'preset-reorder-v1',
            presetKind: 'legacy',
            presetIds: ['preset-b', 'preset-c', 'preset-a'],
            selectedPresetId: 'preset-b',
            settingsWritten: true,
          })
        }
        if (url.endsWith('/model-presets/reorder')) {
          return jsonResponse({
            revision,
            event: { type: 'modelPreset.reordered', revision, resource: 'modelPreset' },
            presetReorderCertificate: 'preset-reorder-v1',
            presetKind: 'model',
            presetIds: ['model-a', 'model-b', 'model-d', 'model-c'],
            selectedModelPresetId: 'model-b',
            settingsWritten: false,
          })
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    const observedEffects: ServerCommandLocalEffect[] = []
    setServerCommandSuccessReconciler((_event, _events, localEffects) => {
      observedEffects.push(...localEffects.values())
    })

    reorderPresets(0, 3)
    await waitForState(() => expect(observedEffects).toHaveLength(1))
    reorderModelPresets(2, 4)
    await waitForState(() => expect(observedEffects).toHaveLength(2))

    expect(observedEffects).toEqual([
      {
        kind: 'presetReorder',
        presetKind: 'legacy',
        collectionProjectionEpoch: expect.any(Number),
        settingsProjectionEpoch: expect.any(Number),
        presetIds: ['preset-b', 'preset-c', 'preset-a'],
        selectedPresetId: 'preset-b',
        settingsWritten: true,
      },
      {
        kind: 'presetReorder',
        presetKind: 'model',
        collectionProjectionEpoch: expect.any(Number),
        settingsProjectionEpoch: expect.any(Number),
        presetIds: ['model-a', 'model-b', 'model-d', 'model-c'],
        selectedPresetId: 'model-b',
        settingsWritten: false,
      },
    ])
    expect(calls.map((call) => call.body)).toEqual([
      { baseRevision: 100, presetIds: ['preset-b', 'preset-c', 'preset-a'] },
      { baseRevision: 101, modelPresetIds: ['model-a', 'model-b', 'model-d', 'model-c'] },
    ])
  })

  it('taints collection and full settings before rolling back a failed model reorder', async () => {
    seedPresetDatabase({
      modelPresets: [
        makePreset('model-a', 'Model A') as unknown as ModelPreset,
        makePreset('model-b', 'Model B') as unknown as ModelPreset,
        makePreset('model-c', 'Model C') as unknown as ModelPreset,
      ],
      modelPresetsId: 1,
    })
    const calls = stubFailedPresetCommand()

    expect(isCollectionAcknowledgementTainted('modelPresets')).toBe(false)
    expect(isSettingsAcknowledgementTainted()).toBe(false)
    reorderModelPresets(0, 3)

    await waitForPresetCommand(calls, '/model-presets/reorder')
    await waitForState(() => {
      expect(getDatabase().modelPresets.map((preset) => preset.id)).toEqual(['model-a', 'model-b', 'model-c'])
      expect(getDatabase().modelPresetsId).toBe(1)
      expect(isCollectionAcknowledgementTainted('modelPresets')).toBe(true)
      expect(isSettingsAcknowledgementTainted()).toBe(true)
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
      const promptC = getDatabase().promptPresets.find((preset) => preset.id === 'prompt-c')
      if (promptC) {
        promptC.name = 'Prompt C edited after dispatch'
      }
    })

    reorderPromptPresets(0, 3)

    expect(getDatabase().promptPresets.map((preset) => preset.id)).toEqual(['prompt-b', 'prompt-c', 'prompt-a'])
    expect(getDatabase().promptPresetsId).toBe(0)
    await waitForPresetCommand(calls, '/prompt-presets/reorder')
    await waitForState(() => {
      expect(getDatabase().promptPresets.map((preset) => preset.id)).toEqual(['prompt-a', 'prompt-b', 'prompt-c'])
      expect(getDatabase().promptPresets[2]).toMatchObject({ name: 'Prompt C edited after dispatch' })
      expect(getDatabase().promptPresetsId).toBe(1)
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
      getDatabase().promptPresets = [
        getDatabase().promptPresets[1],
        getDatabase().promptPresets[2],
        getDatabase().promptPresets[0],
      ]
      getDatabase().promptPresetsId = 0
    })

    reorderPromptPresets(0, 3)

    await waitForPresetCommand(calls, '/prompt-presets/reorder')
    await waitForState(() => {
      expect(getDatabase().promptPresets.map((preset) => preset.id)).toEqual(['prompt-c', 'prompt-a', 'prompt-b'])
      expect(getDatabase().promptPresetsId).toBe(0)
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
      getDatabase().temperature = 123
    })

    selectModelPreset(1)

    expect(getDatabase().modelPresetsId).toBe(1)
    expect(getDatabase().aiModel).toBe('model-b-api')
    expect(getDatabase().temperature).toBe(22)
    await waitForPresetCommand(calls, '/model-presets/select')
    await waitForState(() => {
      expect(getDatabase().modelPresetsId).toBe(0)
      expect(getDatabase().aiModel).toBe('live-model')
      expect(getDatabase().temperature).toBe(123)
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
      getDatabase().globalNote = 'newer note after dispatch'
    })

    selectPromptPreset(1)

    expect(getDatabase().promptPresetsId).toBe(1)
    expect(getDatabase().mainPrompt).toBe('Prompt B prompt')
    expect(getDatabase().globalNote).toBe('Prompt B note')
    await waitForPresetCommand(calls, '/prompt-presets/select')
    await waitForState(() => {
      expect(getDatabase().promptPresetsId).toBe(0)
      expect(getDatabase().mainPrompt).toBe('live main')
      expect(getDatabase().globalNote).toBe('newer note after dispatch')
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

    applyModelPresetFieldsToDatabase(getDatabase(), getDatabase().modelPresets[0])

    expect(getDatabase().aiModel).toBe('model-ai')
    expect(getDatabase().subModel).toBe('model-sub')
    expect(getDatabase().temperature).toBe(31)
    expect(getDatabase().modelRoles).toMatchObject({
      memory: 'prompt-memory',
      scriptAux: 'prompt-script-aux',
    })
    expect(getDatabase().modelProfiles).toEqual([
      {
        id: 'model-profile',
        name: 'Model Profile',
        modelId: 'model-ai',
        providerOptions: { requestModel: 'model-wire', apiKey: 'model-secret' },
      },
    ])
    expect(getDatabase().modelRoleProfiles).toEqual(
      normalizedModelRoleProfiles({
        memory: { mode: 'profile', profileId: 'prompt-profile' },
      }),
    )
    expect(getDatabase().modelRuntimeDefaults).toEqual({
      maxContext: 7777,
      modelTools: ['model-tool'],
    })
    expect(getDatabase().seperateModelsForAxModels).toBe(true)
    expect(getDatabase().seperateModels).toMatchObject({
      memory: 'prompt-separate-memory',
      scriptAux: 'prompt-separate-script-aux',
    })
    expect(getDatabase().fallbackModels).toMatchObject({
      model: ['prompt-fallback-main'],
      memory: ['prompt-fallback-memory'],
      scriptAux: ['prompt-fallback-script-aux'],
    })
    expect(getDatabase().fallbackWhenBlankResponse).toBe(true)

    getDatabase().promptPresets[0] = {
      ...getDatabase().promptPresets[0],
      overrideModelParameters: true,
      temperature: 88,
    }
    applyPromptPresetFieldsToDatabase(getDatabase(), getDatabase().promptPresets[0])

    expect(getDatabase().temperature).toBe(88)
  })

  it('L21: failed copy restores the original collection after save-current and generated copy id', async () => {
    seedPresetDatabase({ temperature: 88 })
    let generatedCopyId: string | undefined
    const calls = stubFailedPresetCommand(() => {
      generatedCopyId = getDatabase().botPresets.find((preset) => preset.name === 'Alpha Copy')?.id
      getDatabase().botPresets[0].name = 'Alpha source edited after dispatch'
      getDatabase().botPresets.push(makePreset('preset-c', 'Gamma appended after dispatch'))
    })

    copyPreset(0)

    expect(getDatabase().botPresets).toHaveLength(3)
    expect(getDatabase().botPresets[0].temperature).toBe(88)
    await waitForPresetCommand(calls, '/presets/preset-a/copy')
    await waitForState(() => {
      expect(generatedCopyId).toBeTruthy()
      expect(getDatabase().botPresets.some((preset) => preset.id === generatedCopyId)).toBe(false)
      expect(getDatabase().botPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b', 'preset-c'])
      expect(getDatabase().botPresets[0]).toMatchObject({
        name: 'Alpha source edited after dispatch',
        temperature: 11,
      })
      expect(getDatabase().botPresets[2]).toMatchObject({ name: 'Gamma appended after dispatch' })
      expect(getDatabase().botPresetsId).toBe(0)
    })
  })

  it('L21: shared preset boundary keeps copy as one rollback-safe command', async () => {
    seedPresetDatabase({ temperature: 77 })
    const beforeSourceTemperature = getDatabase().botPresets[0].temperature
    const beforeSelected = getDatabase().botPresetsId
    const calls = stubFailedPresetCommand()

    copyPreset(0)

    await waitForPresetCommand(calls, '/presets/preset-a/copy')
    await waitForState(() => {
      expect(getDatabase().botPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b'])
      expect(getDatabase().botPresets.some((preset) => preset.name === 'Alpha Copy')).toBe(false)
      expect(getDatabase().botPresets[0].temperature).toBe(beforeSourceTemperature)
      expect(getDatabase().botPresetsId).toBe(beforeSelected)
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
      optimisticPresetId = getDatabase().botPresets.find((preset) => preset.name === 'Created')?.id
      getDatabase().botPresets[0].name = 'Alpha edited after dispatch'
      getDatabase().botPresets.push(makePreset('preset-c', 'Gamma appended after dispatch'))
      getDatabase().botPresetsId = 1
    })
    const newPreset = makePreset('preset-created', 'Created')
    delete newPreset.id

    createPreset(newPreset)

    const optimisticPreset = getDatabase().botPresets.find((preset) => preset.name === 'Created')
    expect(optimisticPreset?.id).toBeTruthy()
    await waitForPresetCommand(calls, '/presets')
    await waitForState(() => {
      expect(optimisticPresetId).toBe(optimisticPreset?.id)
      expect(getDatabase().botPresets.some((preset) => preset.id === optimisticPreset?.id)).toBe(false)
      expect(getDatabase().botPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b', 'preset-c'])
      expect(getDatabase().botPresets[0]).toMatchObject({ name: 'Alpha edited after dispatch' })
      expect(getDatabase().botPresets[2]).toMatchObject({ name: 'Gamma appended after dispatch' })
      expect(getDatabase().botPresetsId).toBe(1)
    })
  })

  it('L21: failed update restores the patched preset row', async () => {
    seedPresetDatabase()
    const calls = stubFailedPresetCommand(() => {
      getDatabase().botPresets[1].name = 'Newer Beta edit after dispatch'
      getDatabase().botPresets.push(makePreset('preset-c', 'Gamma appended after dispatch'))
    })

    updatePreset(1, { name: 'Broken Update', temperature: 99 })

    expect(getDatabase().botPresets[1]).toMatchObject({ name: 'Broken Update', temperature: 99 })
    await waitForPresetCommand(calls, '/presets/preset-b')
    await waitForState(() => {
      expect(getDatabase().botPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b', 'preset-c'])
      expect(getDatabase().botPresets[1]).toMatchObject({
        name: 'Newer Beta edit after dispatch',
        temperature: 22,
      })
      expect(getDatabase().botPresets[2]).toMatchObject({ name: 'Gamma appended after dispatch' })
      expect(getDatabase().botPresetsId).toBe(0)
    })
  })

  it('L21: failed delete restores collection, selection, and setPreset scalars', async () => {
    seedPresetDatabase()
    const calls = stubFailedPresetCommand(() => {
      getDatabase().botPresets.push(makePreset('preset-c', 'Gamma appended after dispatch'))
      getDatabase().botPresetsId = 1
      getDatabase().mainPrompt = 'newer prompt after dispatch'
    })

    deletePreset(0, 1, true)

    expect(getDatabase().botPresets.map((preset) => preset.id)).toEqual(['preset-b'])
    expect(getDatabase().botPresetsId).toBe(0)
    expect(getDatabase().mainPrompt).toBe('Beta prompt')
    await waitForPresetCommand(calls, '/presets/preset-a')
    await waitForState(() => {
      expect(getDatabase().botPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b', 'preset-c'])
      expect(getDatabase().botPresets[0]).toMatchObject({ name: 'Alpha' })
      expect(getDatabase().botPresets[2]).toMatchObject({ name: 'Gamma appended after dispatch' })
      expect(getDatabase().botPresetsId).toBe(2)
      expect(getDatabase().mainPrompt).toBe('newer prompt after dispatch')
    })
  })

  it('legacy delete with apply does not change top-level promptTemplate', async () => {
    seedPresetDatabase()
    const beforePromptTemplate = clonePlain(getDatabase().promptTemplate)
    const calls = stubFailedPresetCommand()

    deletePreset(0, 1, true)

    expect(getDatabase().botPresetsId).toBe(0)
    expect(getDatabase().mainPrompt).toBe('Beta prompt')
    expect(getDatabase().promptTemplate).toEqual(beforePromptTemplate)
    await waitForPresetCommand(calls, '/presets/preset-a')
  })

  it('L21: failed reorder restores collection order and selected index', async () => {
    seedPresetDatabase({
      botPresets: [makePreset('preset-a', 'Alpha'), makePreset('preset-b', 'Beta'), makePreset('preset-c', 'Gamma')],
      botPresetsId: 1,
    })
    const calls = stubFailedPresetCommand(() => {
      const gamma = getDatabase().botPresets.find((preset) => preset.id === 'preset-c')
      if (gamma) {
        gamma.name = 'Gamma edited after dispatch'
      }
    })

    expect(isCollectionAcknowledgementTainted('botPresets')).toBe(false)
    expect(isSettingsAcknowledgementTainted()).toBe(false)
    reorderPresets(0, 3)

    expect(getDatabase().botPresets.map((preset) => preset.id)).toEqual(['preset-b', 'preset-c', 'preset-a'])
    expect(getDatabase().botPresetsId).toBe(0)
    await waitForPresetCommand(calls, '/presets/reorder')
    await waitForState(() => {
      expect(getDatabase().botPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b', 'preset-c'])
      expect(getDatabase().botPresets[2]).toMatchObject({ name: 'Gamma edited after dispatch' })
      expect(getDatabase().botPresetsId).toBe(1)
      expect(isCollectionAcknowledgementTainted('botPresets')).toBe(true)
      expect(isSettingsAcknowledgementTainted()).toBe(true)
    })
  })

  it('failed older legacy reorder skips rollback after a newer reorder changes live ids', async () => {
    seedPresetDatabase({
      botPresets: [makePreset('preset-a', 'Alpha'), makePreset('preset-b', 'Beta'), makePreset('preset-c', 'Gamma')],
      botPresetsId: 1,
    })
    const calls = stubFailedPresetCommand(() => {
      getDatabase().botPresets = [getDatabase().botPresets[1], getDatabase().botPresets[2], getDatabase().botPresets[0]]
      getDatabase().botPresetsId = 0
    })

    reorderPresets(0, 3)

    await waitForPresetCommand(calls, '/presets/reorder')
    await waitForState(() => {
      expect(getDatabase().botPresets.map((preset) => preset.id)).toEqual(['preset-c', 'preset-a', 'preset-b'])
      expect(getDatabase().botPresetsId).toBe(0)
    })
  })

  it('L21: failed select restores setPreset scalars without overwriting unrelated fields', async () => {
    seedPresetDatabase()
    const beforePresets = clonePlain(getDatabase().botPresets)
    const beforePrompt = getDatabase().mainPrompt
    const beforePromptTemplate = clonePlain(getDatabase().promptTemplate)
    const beforeNaiSettings = clonePlain(getDatabase().NAIsettings)
    const calls = stubFailedPresetCommand(() => {
      getDatabase().temperature = 123
      getDatabase().customBackground = 'changed while preset command was in flight'
    })

    changeToPreset(1, false)

    expect(getDatabase().botPresetsId).toBe(1)
    expect(getDatabase().mainPrompt).toBe('Beta prompt')
    expect(getDatabase().temperature).toBe(22)
    await waitForPresetCommand(calls, '/presets/select')
    await waitForState(() => {
      expect(getDatabase().botPresets).toEqual(beforePresets)
      expect(getDatabase().botPresetsId).toBe(0)
      expect(getDatabase().mainPrompt).toBe(beforePrompt)
      expect(getDatabase().temperature).toBe(123)
      expect(getDatabase().promptTemplate).toEqual(beforePromptTemplate)
      expect(getDatabase().NAIsettings).toEqual(beforeNaiSettings)
      expect(getDatabase().customBackground).toBe('changed while preset command was in flight')
    })
  })

  it('legacy select does not change top-level promptTemplate', async () => {
    seedPresetDatabase()
    const beforePromptTemplate = clonePlain(getDatabase().promptTemplate)
    const calls = stubFailedPresetCommand()

    changeToPreset(1, false)

    expect(getDatabase().botPresetsId).toBe(1)
    expect(getDatabase().mainPrompt).toBe('Beta prompt')
    expect(getDatabase().promptTemplate).toEqual(beforePromptTemplate)
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
      getDatabase().modelPresets[0].name = 'Existing Model edited after dispatch'
      getDatabase().modelPresets.push(
        makePreset('model-newer', 'Newer Model appended after dispatch', {
          aiModel: 'newer-model-api',
        }) as unknown as ModelPreset,
      )
      getDatabase().promptPresets[0].name = 'Existing Prompt edited after dispatch'
      getDatabase().promptPresets.push(
        makePreset('prompt-newer', 'Newer Prompt appended after dispatch') as unknown as PromptPreset,
      )
    })

    extractLegacyBotPresetByIndex(0, 'all')

    expect(getDatabase().botPresets.map((preset) => preset.id)).toEqual(['preset-b'])
    expect(getDatabase().modelPresets.some((preset) => preset.name === 'Alpha Model')).toBe(true)
    expect(getDatabase().promptPresets.some((preset) => preset.name === 'Alpha Prompt')).toBe(true)
    expect(getDatabase().promptPresets.find((preset) => preset.name === 'Alpha Prompt')?.promptTemplate).toEqual([
      { id: 'preset-a-prompt', type: 'plain', text: 'Alpha prompt item' },
    ])
    await waitForPresetCommand(calls, '/legacy-bot-presets/preset-a/extract')
    await waitForState(() => {
      expect(getDatabase().botPresets.map((preset) => preset.id)).toEqual(['preset-a', 'preset-b'])
      expect(getDatabase().botPresetsId).toBe(0)
      expect(getDatabase().modelPresets.map((preset) => preset.id)).toEqual(['model-existing', 'model-newer'])
      expect(getDatabase().modelPresets[0]).toMatchObject({ name: 'Existing Model edited after dispatch' })
      expect(getDatabase().modelPresets[1]).toMatchObject({ name: 'Newer Model appended after dispatch' })
      expect(getDatabase().promptPresets.map((preset) => preset.id)).toEqual(['prompt-existing', 'prompt-newer'])
      expect(getDatabase().promptPresets[0]).toMatchObject({ name: 'Existing Prompt edited after dispatch' })
      expect(getDatabase().promptPresets[1]).toMatchObject({ name: 'Newer Prompt appended after dispatch' })
    })
  })
})
