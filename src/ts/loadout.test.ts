import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'loadout-command-token',
}))

import { clearCachedServerCommandRevision, setServerCommandSuccessReconciler } from './server/commands'
import { isCanonicalLoadout } from './server/loadoutCanonical'
import { setResourceWriteGuardEnabled, withTrustedResourceWrite } from './server/resourceWriteGuard.svelte'
import {
  applyCollectionsResource,
  applySettingsGroupResource,
  getResourceDatabase,
  replaceResourceDatabase,
} from './server/resourceState.svelte'
import type { Database } from './storage/database.svelte'
import { selectedCharID } from './stores.svelte'
import { applyLoadout, deleteLoadout, saveCurrentLoadout, toggleLoadoutFavorite, type Loadout } from './loadout'
import { currentPersonaStateSnapshot, isPersonaSettingsWatcherSuppressed, queueSelectedPersonaUpdate } from './persona'
import { MODEL_ROLES } from './model/modelRoles'

const testDatabaseState = {
  get db() {
    return getResourceDatabase()
  },
  set db(value: Database) {
    replaceResourceDatabase(value)
  },
}

interface CapturedFetch {
  url: string
  method: string
  authHeader: string | null
  body: unknown
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function normalizedModelRoleProfiles(overrides: Record<string, Record<string, unknown>> = {}) {
  return {
    ...Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])),
    ...overrides,
  }
}

function makeLoadout(overrides: Partial<Loadout>): Loadout {
  return {
    id: 'loadout-a',
    name: 'Loadout A',
    lastUsed: 100,
    favorite: false,
    characterIds: ['char-a'],
    modules: ['module-a'],
    globalVariables: { mood: 'calm' },
    presetName: 'Preset A',
    modelPresetId: '',
    modelPresetName: '',
    promptPresetId: '',
    promptPresetName: '',
    personaId: 'persona-a',
    ...overrides,
  }
}

function seedLoadouts(): void {
  testDatabaseState.db = {
    loadouts: [
      makeLoadout({ id: 'loadout-a', name: 'Loadout A', favorite: false }),
      makeLoadout({ id: 'loadout-b', name: 'Loadout B', favorite: true, lastUsed: 50 }),
    ],
    lastLoadedLoadoutName: 'Loadout A',
  } as any
}

function seedApplyLoadoutState(): Loadout {
  const loadout = makeLoadout({
    id: 'loadout-a',
    name: 'Battle Loadout',
    lastUsed: 100,
    characterIds: [],
    modules: ['module-a', 'module-stay'],
    globalVariables: { mood: 'focused', scene: 'night' },
    presetName: 'Preset B',
    personaId: 'persona-b',
  })

  selectedCharID.set(0)
  testDatabaseState.db = {
    loadouts: [cloneJsonValue(loadout)],
    lastLoadedLoadoutName: 'Before Loadout',
    characters: [{ chaId: 'char-a', chats: [], chatPage: 0 }],
    personas: [
      {
        id: 'persona-a',
        name: 'Persona A',
        icon: 'icon-a',
        personaPrompt: 'persona-a prompt',
        note: 'persona-a note',
      },
      {
        id: 'persona-b',
        name: 'Persona B',
        icon: 'icon-b',
        personaPrompt: 'persona-b prompt',
        note: 'persona-b note',
      },
    ],
    selectedPersona: 0,
    username: 'Live User',
    userIcon: 'live-icon',
    personaPrompt: 'live persona prompt',
    userNote: 'live user note',
    botPresets: [
      {
        id: 'preset-a',
        name: 'Preset A',
        mainPrompt: 'preset-a main',
        jailbreak: 'preset-a jailbreak',
        globalNote: 'preset-a global',
        temperature: 11,
        maxContext: 111,
        maxResponse: 222,
        frequencyPenalty: 33,
        PresensePenalty: 44,
        formatingOrder: [],
        promptPreprocess: false,
        bias: [],
        ooba: {},
        ainconfig: {},
      },
      {
        id: 'preset-b',
        name: 'Preset B',
        mainPrompt: 'preset-b main',
        jailbreak: 'preset-b jailbreak',
        globalNote: 'preset-b global',
        temperature: 66,
        maxContext: 666,
        maxResponse: 777,
        frequencyPenalty: 88,
        PresensePenalty: 99,
        formatingOrder: ['main'],
        promptPreprocess: true,
        bias: [['tone', 1]],
        ooba: { mode: 'target' },
        ainconfig: { mode: 'target' },
        promptTemplate: [],
      },
    ],
    botPresetsId: 0,
    mainPrompt: 'live main',
    jailbreak: 'live jailbreak',
    globalNote: 'live global',
    promptTemplate: [{ id: 'live-prompt', type: 'plain', text: 'live prompt row' }],
    temperature: 20,
    maxContext: 200,
    maxResponse: 300,
    frequencyPenalty: 40,
    PresensePenalty: 50,
    formatingOrder: ['description'],
    promptPreprocess: false,
    bias: [],
    ooba: {},
    ainconfig: {},
    NAIsettings: {},
    doNotChangeSeperateModels: false,
    doNotChangeFallbackModels: false,
    enabledModules: ['module-stay', 'module-z'],
    globalChatVariables: { mood: 'calm', kept: 'yes' },
  } as any

  return testDatabaseState.db.loadouts[0] as Loadout
}

function seedSplitPresetLoadoutState(): Loadout {
  const loadout = makeLoadout({
    id: 'split-loadout',
    name: 'Split Loadout',
    characterIds: [],
    modules: ['module-stay'],
    globalVariables: { mood: 'calm' },
    presetName: 'Story Model / Story Prompt',
    modelPresetId: 'model-b',
    modelPresetName: 'Story Model',
    promptPresetId: 'prompt-b',
    promptPresetName: 'Story Prompt',
    personaId: 'persona-a',
  })

  selectedCharID.set(0)
  testDatabaseState.db = {
    loadouts: [cloneJsonValue(loadout)],
    lastLoadedLoadoutName: 'Before Loadout',
    characters: [{ chaId: 'char-a', chats: [], chatPage: 0 }],
    personas: [
      {
        id: 'persona-a',
        name: 'Persona A',
        icon: 'icon-a',
        personaPrompt: 'persona-a prompt',
        note: 'persona-a note',
      },
    ],
    selectedPersona: 0,
    username: 'Persona A',
    userIcon: 'icon-a',
    personaPrompt: 'persona-a prompt',
    userNote: 'persona-a note',
    botPresets: [],
    botPresetsId: -1,
    modelPresets: [
      {
        id: 'model-a',
        name: 'Default Model',
        apiType: 'openai',
        temperature: 0.4,
        maxResponse: 100,
      },
      {
        id: 'model-b',
        name: 'Story Model',
        apiType: 'kobold',
        temperature: 0.9,
        maxResponse: 450,
        modelProfiles: [
          {
            id: ' story-profile ',
            name: ' Story Profile ',
            modelId: ' story-model ',
            providerOptions: { requestModel: ' story-wire ' },
            fallbacks: [{ mode: 'profile', profileId: ' fallback-profile ' }],
          },
          { id: 'story-profile', name: 'Duplicate' },
        ],
        modelRoleProfiles: {
          memory: { mode: 'profile', profileId: ' story-profile ' },
        },
        modelRuntimeDefaults: {
          maxContext: 7777,
          modelTools: [' story-tool ', ''],
        },
      },
    ],
    modelPresetsId: 0,
    promptPresets: [
      {
        id: 'prompt-a',
        name: 'Default Prompt',
        mainPrompt: 'default main',
        jailbreak: 'default jailbreak',
        globalNote: 'default global',
        formatingOrder: ['description'],
      },
      {
        id: 'prompt-b',
        name: 'Story Prompt',
        mainPrompt: 'story main',
        jailbreak: 'story jailbreak',
        globalNote: 'story global',
        formatingOrder: ['main'],
        modelProfiles: [{ id: 'prompt-profile', name: 'Prompt Profile' }],
        modelRoleProfiles: {
          memory: { mode: 'profile', profileId: ' prompt-profile ' },
        },
        modelRuntimeDefaults: {
          maxContext: 9999,
        },
      },
    ],
    promptPresetsId: 0,
    apiType: 'openai',
    temperature: 0.4,
    maxResponse: 100,
    modelProfiles: [{ id: 'base-profile', name: 'Base Profile', modelId: 'base-model' }],
    modelRoleProfiles: normalizedModelRoleProfiles({
      memory: { mode: 'profile', profileId: 'base-profile' },
    }),
    modelRuntimeDefaults: { maxContext: 1111 },
    mainPrompt: 'default main',
    jailbreak: 'default jailbreak',
    globalNote: 'default global',
    formatingOrder: ['description'],
    enabledModules: ['module-stay'],
    globalChatVariables: { mood: 'calm' },
  } as any

  return testDatabaseState.db.loadouts[0] as Loadout
}

function stubCommandFetch(options: { failCommands?: boolean } = {}): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = init.headers as Record<string, string> | undefined
      const url = String(input)
      calls.push({
        url,
        method: init.method ?? 'GET',
        authHeader: headers?.['risu-auth'] ?? null,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      })

      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
      if (options.failCommands) return jsonResponse({ error: 'forced failure' }, 500)
      if (url === '/api/v1/commands/loadouts/loadout-a/favorite') {
        return jsonResponse({
          revision: 11,
          event: { type: 'loadout.favorited', revision: 11, resource: 'loadout', id: 'loadout-a' },
          loadoutId: 'loadout-a',
        })
      }
      if (url === '/api/v1/commands/loadouts/loadout-b') {
        return jsonResponse({
          revision: 11,
          event: { type: 'loadout.deleted', revision: 11, resource: 'loadout', id: 'loadout-b' },
          loadoutId: 'loadout-b',
        })
      }
      if (url === '/api/v1/commands/loadouts') {
        const loadoutId = (calls.at(-1)?.body as { loadout?: { id?: unknown } } | null)?.loadout?.id
        return jsonResponse({
          revision: 11,
          event: { type: 'loadout.created', revision: 11, resource: 'loadout', id: loadoutId },
          loadoutId,
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

function stubDeferredCommandFailure() {
  const calls: CapturedFetch[] = []
  const command = deferred<Response>()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = init.headers as Record<string, string> | undefined
      const url = String(input)
      calls.push({
        url,
        method: init.method ?? 'GET',
        authHeader: headers?.['risu-auth'] ?? null,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      })
      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
      return command.promise
    }) as unknown as typeof fetch,
  )
  return {
    calls,
    reject: () => command.resolve(jsonResponse({ error: 'forced deferred failure' }, 500)),
  }
}

function stubApplyLoadoutFetch(
  options: {
    failCommandNumber?: number
    projectionPreset?: Record<string, unknown>
    projectionResponse?: Promise<Response>
  } = {},
): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  let nextRevision = 10
  let commandNumber = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = init.headers as Record<string, string> | undefined
      const url = String(input)
      calls.push({
        url,
        method: init.method ?? 'GET',
        authHeader: headers?.['risu-auth'] ?? null,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      })

      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
      if (url === '/api/v1/legacy-presets/preset-b') {
        if (options.projectionResponse) return options.projectionResponse
        return jsonResponse({
          revision: 100,
          preset: options.projectionPreset ?? {
            id: 'preset-b',
            name: 'Preset B',
            mainPrompt: 'hydrated preset-b main',
            promptTemplate: [],
          },
        })
      }
      if (url.startsWith('/api/v1/commands/')) {
        commandNumber += 1
        if (options.failCommandNumber === commandNumber) {
          return jsonResponse({ error: 'forced sequence failure' }, 500)
        }
        nextRevision += 1
        return jsonResponse({
          revision: nextRevision,
          event: { type: 'test.command', revision: nextRevision, resource: 'test' },
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

async function waitForCallCount(calls: CapturedFetch[], expected: number): Promise<void> {
  for (let attempt = 0; attempt < 20 && calls.length < expected; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(calls).toHaveLength(expected)
}

async function waitForUrl(calls: CapturedFetch[], url: string): Promise<void> {
  for (let attempt = 0; attempt < 20 && !calls.some((call) => call.url === url); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(calls.map((call) => call.url)).toContain(url)
}

async function flushCommandEffects(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  setServerCommandSuccessReconciler(null)
  setResourceWriteGuardEnabled(false)
  seedLoadouts()
})

afterEach(() => {
  setServerCommandSuccessReconciler(null)
  setResourceWriteGuardEnabled(false)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('loadout projection command helpers', () => {
  it('canonicalizes blank create fields and acknowledges the exact optimistic row', async () => {
    seedApplyLoadoutState()
    testDatabaseState.db.personas = []
    testDatabaseState.db.selectedPersona = 0
    const observedEffects: unknown[] = []
    setServerCommandSuccessReconciler((_event, _events, localEffects) => {
      observedEffects.push(...localEffects.values())
    })
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    const created = saveCurrentLoadout('   ')
    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(created.name).toBe('New Loadout')
    expect(created.personaId).toBe('')
    expect(isCanonicalLoadout(created)).toBe(true)
    expect(calls[1]).toEqual({
      url: '/api/v1/commands/loadouts',
      method: 'POST',
      authHeader: 'loadout-command-token',
      body: { baseRevision: 10, loadout: created },
    })
    expect(observedEffects).toEqual([
      {
        kind: 'loadoutMutation',
        operation: 'create',
        loadoutId: created.id,
        loadoutsProjectionEpoch: expect.any(Number),
      },
    ])
  })

  it('saves split model and prompt preset ids when no legacy bot preset is selected', async () => {
    seedSplitPresetLoadoutState()
    testDatabaseState.db.loadouts = []
    testDatabaseState.db.modelPresetsId = 1
    testDatabaseState.db.promptPresetsId = 1
    testDatabaseState.db.agentPresets = [
      { id: 'agent-preset-a', name: 'Research Agent', enabled: true, version: 1, steps: [] },
    ]
    testDatabaseState.db.characters[0].chats = [
      {
        id: 'chat-a',
        name: 'Chat A',
        note: '',
        message: [],
        localLore: [],
        generationSettings: {
          agentPresetId: 'agent-preset-a',
          jailbreakToggle: false,
        },
      } as any,
    ]
    testDatabaseState.db.characters[0].chatPage = 0
    const calls = stubApplyLoadoutFetch()
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setResourceWriteGuardEnabled(true)

    const loadout = saveCurrentLoadout('Fresh Split Loadout')

    expect(loadout).toMatchObject({
      name: 'Fresh Split Loadout',
      lastUsed: 123456,
      characterIds: ['char-a'],
      presetName: 'Story Model / Story Prompt',
      modelPresetId: 'model-b',
      modelPresetName: 'Story Model',
      promptPresetId: 'prompt-b',
      promptPresetName: 'Story Prompt',
      agentPresetId: 'agent-preset-a',
      agentPresetName: 'Research Agent',
      personaId: 'persona-a',
    })
    expect(testDatabaseState.db.loadouts[0]).toMatchObject(loadout)

    await waitForCallCount(calls, 2)

    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/loadouts',
      method: 'POST',
      body: {
        baseRevision: 10,
        loadout: expect.objectContaining({
          name: 'Fresh Split Loadout',
          modelPresetId: 'model-b',
          modelPresetName: 'Story Model',
          promptPresetId: 'prompt-b',
          promptPresetName: 'Story Prompt',
          agentPresetId: 'agent-preset-a',
          agentPresetName: 'Research Agent',
        }),
      },
    })
  })

  it('applies and clears Agent Preset selections on the active chat generation settings', async () => {
    const loadout = makeLoadout({
      id: 'agent-loadout',
      name: 'Agent Loadout',
      characterIds: [],
      modules: [],
      globalVariables: {},
      presetName: '',
      agentPresetId: 'agent-preset-target',
      agentPresetName: 'Target Agent',
      personaId: '',
    })
    selectedCharID.set(0)
    testDatabaseState.db = {
      loadouts: [cloneJsonValue(loadout)],
      lastLoadedLoadoutName: 'Before Loadout',
      characters: [
        {
          chaId: 'char-a',
          chatPage: 0,
          chats: [
            {
              id: 'chat-a',
              name: 'Chat A',
              note: '',
              message: [],
              localLore: [],
              generationSettings: {
                configured: true,
                personaId: 'persona-a',
                modelPresetId: 'model-a',
                promptPresetId: 'prompt-a',
                agentPresetId: 'agent-preset-old',
                jailbreakToggle: false,
                sidebarToggles: {},
              },
            },
          ],
        },
      ],
      agentPresets: [
        { id: 'agent-preset-old', name: 'Old Agent', enabled: true, version: 1, steps: [] },
        { id: 'agent-preset-target', name: 'Target Agent', enabled: true, version: 1, steps: [] },
      ],
      botPresets: [],
      botPresetsId: -1,
      modelPresets: [],
      modelPresetsId: -1,
      promptPresets: [],
      promptPresetsId: -1,
      enabledModules: [],
      globalChatVariables: {},
    } as any
    const calls = stubApplyLoadoutFetch()
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setResourceWriteGuardEnabled(true)

    applyLoadout(loadout, ['preset'])

    expect(testDatabaseState.db.characters[0].chats[0].generationSettings.agentPresetId).toBe('agent-preset-target')

    await waitForCallCount(calls, 3)

    expect(calls.map((call) => ({ url: call.url, method: call.method, body: call.body }))).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        body: null,
      },
      {
        url: '/api/v1/commands/chats/chat-a/generation-settings',
        method: 'PUT',
        body: {
          baseRevision: 10,
          generationSettings: {
            configured: true,
            personaId: 'persona-a',
            modelPresetId: 'model-a',
            promptPresetId: 'prompt-a',
            agentPresetId: 'agent-preset-target',
            jailbreakToggle: false,
            sidebarToggles: {},
          },
        },
      },
      {
        url: '/api/v1/commands/loadouts/agent-loadout/touch',
        method: 'POST',
        body: {
          baseRevision: 11,
          lastUsed: 123456,
          characterId: 'char-a',
        },
      },
    ])

    const clearLoadout = {
      ...loadout,
      agentPresetId: '',
      agentPresetName: '',
    }
    const clearCalls = stubApplyLoadoutFetch()

    applyLoadout(clearLoadout, ['preset'])

    expect(testDatabaseState.db.characters[0].chats[0].generationSettings.agentPresetId).toBe('')
    await waitForCallCount(clearCalls, 2)
    expect(clearCalls[0]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
    })
    expect(clearCalls[0].body).toMatchObject({
      generationSettings: {
        agentPresetId: '',
      },
    })
  })

  it('applies all requested facets locally and dispatches them as one serialized command sequence', async () => {
    const loadout = seedApplyLoadoutState()
    const calls = stubApplyLoadoutFetch()
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setResourceWriteGuardEnabled(true)

    applyLoadout(loadout)

    expect(testDatabaseState.db.selectedPersona).toBe(1)
    expect(testDatabaseState.db.username).toBe('Persona B')
    expect(testDatabaseState.db.personas[0]).toMatchObject({
      name: 'Live User',
      icon: 'live-icon',
      personaPrompt: 'live persona prompt',
      note: 'live user note',
    })
    expect(testDatabaseState.db.botPresetsId).toBe(1)
    expect(testDatabaseState.db.mainPrompt).toBe('preset-b main')
    expect(testDatabaseState.db.promptTemplate).toEqual([{ id: 'live-prompt', type: 'plain', text: 'live prompt row' }])
    expect(testDatabaseState.db.botPresets[0]).not.toHaveProperty('promptTemplate')
    expect(testDatabaseState.db.enabledModules).toEqual(['module-a', 'module-stay'])
    expect(testDatabaseState.db.globalChatVariables).toEqual({ mood: 'focused', scene: 'night' })
    expect(testDatabaseState.db.loadouts[0]).toMatchObject({
      lastUsed: 123456,
      characterIds: ['char-a'],
    })
    expect(testDatabaseState.db.lastLoadedLoadoutName).toBe('Battle Loadout')

    await waitForCallCount(calls, 7)

    expect(calls.map((call) => ({ url: call.url, method: call.method, body: call.body }))).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        body: null,
      },
      {
        url: '/api/v1/commands/personas/select',
        method: 'POST',
        body: {
          baseRevision: 10,
          personaId: 'persona-b',
          mirrorLegacyProfile: true,
          saveCurrent: true,
        },
      },
      {
        url: '/api/v1/commands/presets/select',
        method: 'POST',
        body: {
          baseRevision: 11,
          presetId: 'preset-b',
          apply: true,
          saveCurrent: true,
        },
      },
      {
        url: '/api/v1/commands/modules/enable',
        method: 'POST',
        body: {
          baseRevision: 12,
          moduleId: 'module-a',
          enabled: true,
        },
      },
      {
        url: '/api/v1/commands/modules/enable',
        method: 'POST',
        body: {
          baseRevision: 13,
          moduleId: 'module-z',
          enabled: false,
        },
      },
      {
        url: '/api/v1/commands/settings/sidebar',
        method: 'PATCH',
        body: {
          baseRevision: 14,
          patch: {
            globalChatVariables: { mood: 'focused', scene: 'night' },
          },
        },
      },
      {
        url: '/api/v1/commands/loadouts/loadout-a/touch',
        method: 'POST',
        body: {
          baseRevision: 15,
          lastUsed: 123456,
          characterId: 'char-a',
        },
      },
    ])
  })

  it('omits the current character from a touch when the loadout already contains it', async () => {
    const loadout = seedApplyLoadoutState()
    loadout.characterIds.push('char-a')
    const calls = stubApplyLoadoutFetch()
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setResourceWriteGuardEnabled(true)

    applyLoadout(loadout, [])

    await waitForCallCount(calls, 2)

    expect(testDatabaseState.db.loadouts[0]).toMatchObject({
      lastUsed: 123456,
      characterIds: ['char-a'],
    })
    expect(calls[1]).toEqual({
      url: '/api/v1/commands/loadouts/loadout-a/touch',
      method: 'POST',
      authHeader: 'loadout-command-token',
      body: {
        baseRevision: 10,
        lastUsed: 123456,
      },
    })
  })

  it('derives the touched loadout name from the live collection row', async () => {
    const liveLoadout = seedApplyLoadoutState()
    const staleArgument = { ...cloneJsonValue(liveLoadout), name: 'Stale caller name' }
    const calls = stubApplyLoadoutFetch()
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setResourceWriteGuardEnabled(true)

    applyLoadout(staleArgument, [])

    expect(testDatabaseState.db.lastLoadedLoadoutName).toBe('Battle Loadout')
    await waitForCallCount(calls, 2)
  })

  it('applies split model and prompt preset selections without falling back to legacy presets', async () => {
    const loadout = seedSplitPresetLoadoutState()
    const calls = stubApplyLoadoutFetch()
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setResourceWriteGuardEnabled(true)

    applyLoadout(loadout, ['preset'])

    expect(testDatabaseState.db.botPresetsId).toBe(-1)
    expect(testDatabaseState.db.modelPresetsId).toBe(1)
    expect(testDatabaseState.db.promptPresetsId).toBe(1)
    expect(testDatabaseState.db.apiType).toBe('kobold')
    expect(testDatabaseState.db.temperature).toBe(0.9)
    expect(testDatabaseState.db.maxResponse).toBe(450)
    expect(testDatabaseState.db.modelProfiles).toEqual([
      {
        id: 'story-profile',
        name: 'Story Profile',
        modelId: 'story-model',
        providerOptions: { requestModel: 'story-wire' },
        fallbacks: [{ mode: 'profile', profileId: 'fallback-profile' }],
      },
    ])
    expect(testDatabaseState.db.modelRoleProfiles).toEqual(
      normalizedModelRoleProfiles({
        memory: { mode: 'profile', profileId: 'prompt-profile' },
      }),
    )
    expect(testDatabaseState.db.modelRuntimeDefaults).toEqual({
      maxContext: 7777,
      modelTools: ['story-tool'],
    })
    expect(testDatabaseState.db.mainPrompt).toBe('story main')
    expect(testDatabaseState.db.jailbreak).toBe('story jailbreak')
    expect(testDatabaseState.db.globalNote).toBe('story global')
    expect(testDatabaseState.db.lastLoadedLoadoutName).toBe('Split Loadout')

    await waitForCallCount(calls, 4)

    expect(calls.map((call) => ({ url: call.url, method: call.method, body: call.body }))).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        body: null,
      },
      {
        url: '/api/v1/commands/model-presets/select',
        method: 'POST',
        body: {
          baseRevision: 10,
          modelPresetId: 'model-b',
        },
      },
      {
        url: '/api/v1/commands/prompt-presets/select',
        method: 'POST',
        body: {
          baseRevision: 11,
          promptPresetId: 'prompt-b',
        },
      },
      {
        url: '/api/v1/commands/loadouts/split-loadout/touch',
        method: 'POST',
        body: {
          baseRevision: 12,
          lastUsed: 123456,
          characterId: 'char-a',
        },
      },
    ])
  })

  it('restores durable profile state when a split prompt preset loadout command fails', async () => {
    const loadout = seedSplitPresetLoadoutState()
    const calls = stubApplyLoadoutFetch({ failCommandNumber: 2 })
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setResourceWriteGuardEnabled(true)

    applyLoadout(loadout, ['preset'])

    expect(testDatabaseState.db.modelPresetsId).toBe(1)
    expect(testDatabaseState.db.promptPresetsId).toBe(1)
    expect(testDatabaseState.db.modelProfiles).toEqual([
      {
        id: 'story-profile',
        name: 'Story Profile',
        modelId: 'story-model',
        providerOptions: { requestModel: 'story-wire' },
        fallbacks: [{ mode: 'profile', profileId: 'fallback-profile' }],
      },
    ])
    expect(testDatabaseState.db.modelRoleProfiles).toEqual(
      normalizedModelRoleProfiles({
        memory: { mode: 'profile', profileId: 'prompt-profile' },
      }),
    )
    expect(testDatabaseState.db.modelRuntimeDefaults).toEqual({
      maxContext: 7777,
      modelTools: ['story-tool'],
    })

    await waitForCallCount(calls, 3)
    await flushCommandEffects()

    expect(calls.map((call) => call.url)).toEqual([
      '/api/v1/bootstrap',
      '/api/v1/commands/model-presets/select',
      '/api/v1/commands/prompt-presets/select',
    ])
    expect(testDatabaseState.db.modelPresetsId).toBe(1)
    expect(testDatabaseState.db.promptPresetsId).toBe(0)
    expect(testDatabaseState.db.modelProfiles).toEqual([
      {
        id: 'story-profile',
        name: 'Story Profile',
        modelId: 'story-model',
        providerOptions: { requestModel: 'story-wire' },
        fallbacks: [{ mode: 'profile', profileId: 'fallback-profile' }],
      },
    ])
    expect(testDatabaseState.db.modelRoleProfiles).toEqual(
      normalizedModelRoleProfiles({
        memory: { mode: 'profile', profileId: 'story-profile' },
      }),
    )
    expect(testDatabaseState.db.modelRuntimeDefaults).toEqual({
      maxContext: 7777,
      modelTools: ['story-tool'],
    })
    expect(testDatabaseState.db.lastLoadedLoadoutName).toBe('Before Loadout')
  })

  it('keeps accepted loadout apply steps and rolls back only the failed settings/touch tail', async () => {
    const loadout = seedApplyLoadoutState()
    const previousGlobalVariables = cloneJsonValue(testDatabaseState.db.globalChatVariables)
    const calls = stubApplyLoadoutFetch({ failCommandNumber: 5 })
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setResourceWriteGuardEnabled(true)

    applyLoadout(loadout)
    expect(testDatabaseState.db.selectedPersona).toBe(1)
    expect(testDatabaseState.db.botPresetsId).toBe(1)
    expect(testDatabaseState.db.enabledModules).toEqual(['module-a', 'module-stay'])
    expect(testDatabaseState.db.globalChatVariables).toEqual({ mood: 'focused', scene: 'night' })

    await waitForCallCount(calls, 6)
    await flushCommandEffects()

    expect(calls.map((call) => call.url)).toEqual([
      '/api/v1/bootstrap',
      '/api/v1/commands/personas/select',
      '/api/v1/commands/presets/select',
      '/api/v1/commands/modules/enable',
      '/api/v1/commands/modules/enable',
      '/api/v1/commands/settings/sidebar',
    ])
    expect(testDatabaseState.db.loadouts[0]).toMatchObject({
      lastUsed: 100,
      characterIds: [],
    })
    expect(testDatabaseState.db.lastLoadedLoadoutName).toBe('Before Loadout')
    expect(testDatabaseState.db.selectedPersona).toBe(1)
    expect(testDatabaseState.db.username).toBe('Persona B')
    expect(testDatabaseState.db.userIcon).toBe('icon-b')
    expect(testDatabaseState.db.personaPrompt).toBe('persona-b prompt')
    expect(testDatabaseState.db.userNote).toBe('persona-b note')
    expect(testDatabaseState.db.personas[0]).toMatchObject({
      name: 'Live User',
      icon: 'live-icon',
      personaPrompt: 'live persona prompt',
      note: 'live user note',
    })
    expect(testDatabaseState.db.botPresets[0]).toMatchObject({
      id: 'preset-a',
      name: 'Preset A',
      mainPrompt: 'live main',
      jailbreak: 'live jailbreak',
      globalNote: 'live global',
      temperature: 20,
    })
    expect(testDatabaseState.db.botPresetsId).toBe(1)
    expect(testDatabaseState.db.mainPrompt).toBe('preset-b main')
    expect(testDatabaseState.db.temperature).toBe(66)
    expect(testDatabaseState.db.promptTemplate).toEqual([{ id: 'live-prompt', type: 'plain', text: 'live prompt row' }])
    expect(testDatabaseState.db.botPresets[0]).not.toHaveProperty('promptTemplate')
    expect(testDatabaseState.db.enabledModules).toEqual(['module-a', 'module-stay'])
    expect(testDatabaseState.db.globalChatVariables).toEqual(previousGlobalVariables)
  })

  it('restores the previously selected legacy preset row after normalizing missing ids on failed preset select', async () => {
    const loadout = seedApplyLoadoutState()
    delete testDatabaseState.db.botPresets[0].id
    delete testDatabaseState.db.botPresets[1].id
    const calls = stubApplyLoadoutFetch({ failCommandNumber: 1 })
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setResourceWriteGuardEnabled(true)

    applyLoadout(loadout, ['preset'])

    const previousPresetId = testDatabaseState.db.botPresets[0].id
    const attemptedPresetId = testDatabaseState.db.botPresets[1].id
    expect(previousPresetId).toEqual(expect.any(String))
    expect(attemptedPresetId).toEqual(expect.any(String))
    expect(previousPresetId).not.toBe(attemptedPresetId)
    expect(testDatabaseState.db.botPresetsId).toBe(1)
    expect(testDatabaseState.db.mainPrompt).toBe('preset-b main')
    expect(testDatabaseState.db.promptTemplate).toEqual([{ id: 'live-prompt', type: 'plain', text: 'live prompt row' }])

    withTrustedResourceWrite(() => {
      testDatabaseState.db.botPresets.push({
        id: 'preset-later',
        name: 'Later Preset',
        mainPrompt: 'later main',
        jailbreak: 'later jailbreak',
        globalNote: 'later global',
        temperature: 1,
        maxContext: 2,
        maxResponse: 3,
        frequencyPenalty: 4,
        PresensePenalty: 5,
        formatingOrder: [],
        promptPreprocess: false,
        bias: [],
        ooba: {} as never,
        ainconfig: {} as never,
        promptTemplate: [],
      })
      testDatabaseState.db.enabledModules = ['module-later']
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(calls.map((call) => call.url)).toEqual(['/api/v1/bootstrap', '/api/v1/commands/presets/select'])
    expect(calls[1]).toMatchObject({
      method: 'POST',
      body: {
        baseRevision: 10,
        presetId: attemptedPresetId,
        apply: true,
        saveCurrent: true,
      },
    })
    expect(testDatabaseState.db.botPresetsId).toBe(0)
    expect(testDatabaseState.db.botPresets[0]).toMatchObject({
      id: previousPresetId,
      name: 'Preset A',
      mainPrompt: 'preset-a main',
    })
    expect(testDatabaseState.db.mainPrompt).toBe('live main')
    expect(testDatabaseState.db.enabledModules).toEqual(['module-later'])
    expect(testDatabaseState.db.botPresets.map((preset) => preset.name)).toContain('Later Preset')
  })

  it('applies a subset of facets without mutating or commanding skipped facets', async () => {
    const loadout = seedApplyLoadoutState()
    const calls = stubApplyLoadoutFetch()
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setResourceWriteGuardEnabled(true)

    applyLoadout(loadout, ['modules'])

    expect(testDatabaseState.db.selectedPersona).toBe(0)
    expect(testDatabaseState.db.username).toBe('Live User')
    expect(testDatabaseState.db.botPresetsId).toBe(0)
    expect(testDatabaseState.db.mainPrompt).toBe('live main')
    expect(testDatabaseState.db.globalChatVariables).toEqual({ mood: 'calm', kept: 'yes' })
    expect(testDatabaseState.db.enabledModules).toEqual(['module-a', 'module-stay'])
    expect(testDatabaseState.db.lastLoadedLoadoutName).toBe('Battle Loadout')
    expect(testDatabaseState.db.loadouts[0]).toMatchObject({
      lastUsed: 123456,
      characterIds: ['char-a'],
    })

    await waitForCallCount(calls, 4)

    expect(calls.map((call) => ({ url: call.url, method: call.method, body: call.body }))).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        body: null,
      },
      {
        url: '/api/v1/commands/modules/enable',
        method: 'POST',
        body: {
          baseRevision: 10,
          moduleId: 'module-a',
          enabled: true,
        },
      },
      {
        url: '/api/v1/commands/modules/enable',
        method: 'POST',
        body: {
          baseRevision: 11,
          moduleId: 'module-z',
          enabled: false,
        },
      },
      {
        url: '/api/v1/commands/loadouts/loadout-a/touch',
        method: 'POST',
        body: {
          baseRevision: 12,
          lastUsed: 123456,
          characterId: 'char-a',
        },
      },
    ])
  })

  it('does not apply stubbed preset settings until preset hydration arrives', async () => {
    const loadout = seedApplyLoadoutState()
    testDatabaseState.db.botPresets[1] = {
      id: 'preset-b',
      name: 'Preset B',
    } as never
    const hydration = deferred<Response>()
    const calls = stubApplyLoadoutFetch({ projectionResponse: hydration.promise })
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setResourceWriteGuardEnabled(true)

    applyLoadout(loadout, ['preset'])

    expect(testDatabaseState.db.botPresetsId).toBe(0)
    expect(testDatabaseState.db.mainPrompt).toBe('live main')
    expect(calls.map((call) => call.url)).not.toContain('/api/v1/commands/presets/select')
    expect(calls.map((call) => call.url)).not.toContain('/api/v1/commands/loadouts/loadout-a/touch')

    await waitForUrl(calls, '/api/v1/legacy-presets/preset-b')
    withTrustedResourceWrite(() => {
      testDatabaseState.db.botPresets = [testDatabaseState.db.botPresets[1], testDatabaseState.db.botPresets[0]]
      testDatabaseState.db.botPresetsId = 1
    })
    hydration.resolve(
      jsonResponse({
        revision: 100,
        preset: {
          id: 'preset-b',
          name: 'Preset B',
          mainPrompt: 'hydrated preset-b main',
          promptTemplate: [],
        },
      }),
    )

    await waitForCallCount(calls, 4)
    await flushCommandEffects()

    expect(calls.map((call) => call.url)).toContain('/api/v1/legacy-presets/preset-b')
    expect(calls.map((call) => call.url)).toContain('/api/v1/commands/presets/select')
    expect(calls.map((call) => call.url)).toContain('/api/v1/commands/loadouts/loadout-a/touch')
    expect(testDatabaseState.db.botPresetsId).toBe(0)
    expect(testDatabaseState.db.mainPrompt).toBe('hydrated preset-b main')
    expect(testDatabaseState.db.promptTemplate).toEqual([{ id: 'live-prompt', type: 'plain', text: 'live prompt row' }])
  })

  it('suppresses PersonaSettings watcher echo for loadout-driven persona selection', async () => {
    const loadout = seedApplyLoadoutState()
    const calls = stubApplyLoadoutFetch()
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setResourceWriteGuardEnabled(true)

    const previousPersona = currentPersonaStateSnapshot()
    applyLoadout(loadout, ['persona'])
    const attemptedPersona = currentPersonaStateSnapshot()

    expect(isPersonaSettingsWatcherSuppressed()).toBe(true)
    queueSelectedPersonaUpdate(previousPersona, attemptedPersona)

    await waitForCallCount(calls, 3)
    await flushCommandEffects()

    expect(calls.map((call) => call.url)).toEqual([
      '/api/v1/bootstrap',
      '/api/v1/commands/personas/select',
      '/api/v1/commands/loadouts/loadout-a/touch',
    ])
  })

  it('flushes a pending persona PATCH ahead of a loadout persona selection', async () => {
    const loadout = seedApplyLoadoutState()
    const previousPersona = currentPersonaStateSnapshot()
    withTrustedResourceWrite(() => {
      testDatabaseState.db.username = 'Pending User'
      testDatabaseState.db.personas[0].name = 'Pending User'
    })
    queueSelectedPersonaUpdate(previousPersona, currentPersonaStateSnapshot())
    const calls = stubApplyLoadoutFetch()
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setResourceWriteGuardEnabled(true)

    applyLoadout(loadout, ['persona'])

    await waitForCallCount(calls, 4)
    expect(calls.map((call) => call.url)).toEqual([
      '/api/v1/bootstrap',
      '/api/v1/commands/personas/persona-a',
      '/api/v1/commands/personas/select',
      '/api/v1/commands/loadouts/loadout-a/touch',
    ])
    expect(calls[1].body).toMatchObject({
      baseRevision: 10,
      patch: { name: 'Pending User' },
    })
    expect(calls[2].body).toMatchObject({
      baseRevision: 11,
      personaId: 'persona-b',
      saveCurrent: true,
    })
    await flushCommandEffects()
  })

  it('failed favorite preserves newer sibling edits/appends and newer same-row changes', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    setResourceWriteGuardEnabled(true)

    expect(() => {
      testDatabaseState.db.loadouts[0].favorite = true
    }).toThrow()

    expect(toggleLoadoutFavorite('loadout-a')).toBe(true)
    expect(testDatabaseState.db.loadouts[0].favorite).toBe(true)
    withTrustedResourceWrite(() => {
      testDatabaseState.db.loadouts[0].name = 'Newer Loadout A'
      testDatabaseState.db.loadouts[0].favorite = false
      testDatabaseState.db.loadouts[1].name = 'Edited Loadout B'
      testDatabaseState.db.loadouts.push(makeLoadout({ id: 'loadout-c', name: 'Later Loadout' }))
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'loadout-command-token',
        body: null,
      },
      {
        url: '/api/v1/commands/loadouts/loadout-a/favorite',
        method: 'POST',
        authHeader: 'loadout-command-token',
        body: {
          baseRevision: 10,
          favorite: true,
        },
      },
    ])
    expect(testDatabaseState.db.loadouts).toHaveLength(3)
    expect(testDatabaseState.db.loadouts[0]).toMatchObject({
      id: 'loadout-a',
      name: 'Newer Loadout A',
      favorite: false,
    })
    expect(testDatabaseState.db.loadouts[1]).toMatchObject({
      id: 'loadout-b',
      name: 'Edited Loadout B',
      favorite: true,
    })
    expect(testDatabaseState.db.loadouts[2]).toMatchObject({
      id: 'loadout-c',
      name: 'Later Loadout',
    })
    expect(testDatabaseState.db.lastLoadedLoadoutName).toBe('Loadout A')
  })

  it('does not roll back a failed favorite across an authoritative loadout replacement', async () => {
    const failure = stubDeferredCommandFailure()
    setResourceWriteGuardEnabled(true)

    expect(toggleLoadoutFavorite('loadout-a')).toBe(true)
    await waitForCallCount(failure.calls, 2)
    applyCollectionsResource(
      {
        revision: 11,
        collections: {
          loadouts: [
            makeLoadout({ id: 'loadout-a', name: 'Authoritative A', favorite: true }),
            makeLoadout({ id: 'loadout-b', name: 'Authoritative B', favorite: true }),
          ],
        },
      },
      'loadouts',
    )
    failure.reject()
    await flushCommandEffects()

    expect(testDatabaseState.db.loadouts[0]).toMatchObject({
      id: 'loadout-a',
      name: 'Authoritative A',
      favorite: true,
    })
  })

  it('does not roll back a failed create across an authoritative loadout replacement', async () => {
    seedApplyLoadoutState()
    const failure = stubDeferredCommandFailure()
    setResourceWriteGuardEnabled(true)

    const created = saveCurrentLoadout('Created Loadout')
    await waitForCallCount(failure.calls, 2)
    const authoritativeLoadouts = [makeLoadout({ id: 'loadout-a', name: 'Authoritative A' }), cloneJsonValue(created)]
    applyCollectionsResource(
      {
        revision: 11,
        collections: { loadouts: authoritativeLoadouts },
      },
      'loadouts',
    )
    failure.reject()
    await flushCommandEffects()

    expect(testDatabaseState.db.loadouts).toEqual(authoritativeLoadouts)
  })

  it('does not roll back a failed delete across an authoritative loadout replacement', async () => {
    const failure = stubDeferredCommandFailure()
    setResourceWriteGuardEnabled(true)

    expect(deleteLoadout('loadout-b')).toBe(true)
    await waitForCallCount(failure.calls, 2)
    const authoritativeLoadouts = [
      makeLoadout({ id: 'loadout-a', name: 'Authoritative A' }),
      makeLoadout({ id: 'loadout-c', name: 'Authoritative C' }),
    ]
    applyCollectionsResource(
      {
        revision: 11,
        collections: { loadouts: authoritativeLoadouts },
      },
      'loadouts',
    )
    failure.reject()
    await flushCommandEffects()

    expect(testDatabaseState.db.loadouts).toEqual(authoritativeLoadouts)
  })

  it('rolls back only touch settings after an authoritative loadout replacement', async () => {
    const loadout = seedApplyLoadoutState()
    const failure = stubDeferredCommandFailure()
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setResourceWriteGuardEnabled(true)

    applyLoadout(loadout, [])
    await waitForCallCount(failure.calls, 2)
    applyCollectionsResource(
      {
        revision: 11,
        collections: {
          loadouts: [
            makeLoadout({
              id: 'loadout-a',
              name: 'Battle Loadout',
              lastUsed: 777,
              characterIds: ['authoritative-char'],
            }),
          ],
        },
      },
      'loadouts',
    )
    failure.reject()
    await flushCommandEffects()

    expect(testDatabaseState.db.loadouts[0]).toMatchObject({
      lastUsed: 777,
      characterIds: ['authoritative-char'],
    })
    expect(testDatabaseState.db.lastLoadedLoadoutName).toBe('Before Loadout')
  })

  it('rolls back only touch collection fields after an authoritative sidebar replacement', async () => {
    const loadout = seedApplyLoadoutState()
    const failure = stubDeferredCommandFailure()
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setResourceWriteGuardEnabled(true)

    applyLoadout(loadout, [])
    await waitForCallCount(failure.calls, 2)
    applySettingsGroupResource(
      {
        revision: 11,
        group: 'sidebar',
        settings: { lastLoadedLoadoutName: 'Authoritative loaded name' },
      },
      ['lastLoadedLoadoutName'],
    )
    failure.reject()
    await flushCommandEffects()

    expect(testDatabaseState.db.loadouts[0]).toMatchObject({
      lastUsed: 100,
      characterIds: [],
    })
    expect(testDatabaseState.db.lastLoadedLoadoutName).toBe('Authoritative loaded name')
  })

  it('failed create removes only the unchanged attempted loadout and preserves later rows', async () => {
    seedApplyLoadoutState()
    const calls = stubCommandFetch({ failCommands: true })
    setResourceWriteGuardEnabled(true)

    const created = saveCurrentLoadout('Created Loadout')
    expect(testDatabaseState.db.loadouts.map((item) => item.id)).toEqual(['loadout-a', created.id])
    withTrustedResourceWrite(() => {
      testDatabaseState.db.loadouts[0].name = 'Edited Existing Loadout'
      testDatabaseState.db.loadouts.push(makeLoadout({ id: 'loadout-later', name: 'Later Loadout' }))
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/loadouts',
      method: 'POST',
      authHeader: 'loadout-command-token',
      body: {
        baseRevision: 10,
        loadout: expect.objectContaining({
          id: created.id,
          name: 'Created Loadout',
        }),
      },
    })
    expect(testDatabaseState.db.loadouts.map((item) => item.id)).toEqual(['loadout-a', 'loadout-later'])
    expect(testDatabaseState.db.loadouts[0].name).toBe('Edited Existing Loadout')
  })

  it('failed delete reinserts only a still-missing loadout and preserves sibling edits/appends', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    const deletedLoadout = cloneJsonValue(testDatabaseState.db.loadouts[1])
    setResourceWriteGuardEnabled(true)

    expect(deleteLoadout('loadout-b')).toBe(true)
    expect(testDatabaseState.db.loadouts.map((loadout) => loadout.id)).toEqual(['loadout-a'])
    withTrustedResourceWrite(() => {
      testDatabaseState.db.loadouts[0].name = 'Edited Loadout A'
      testDatabaseState.db.loadouts.push(makeLoadout({ id: 'loadout-c', name: 'Later Loadout' }))
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'loadout-command-token',
        body: null,
      },
      {
        url: '/api/v1/commands/loadouts/loadout-b',
        method: 'DELETE',
        authHeader: 'loadout-command-token',
        body: {
          baseRevision: 10,
        },
      },
    ])
    expect(testDatabaseState.db.loadouts.map((loadout) => loadout.id)).toEqual(['loadout-a', 'loadout-b', 'loadout-c'])
    expect(testDatabaseState.db.loadouts[0].name).toBe('Edited Loadout A')
    expect(testDatabaseState.db.loadouts[1]).toEqual(deletedLoadout)
    expect(testDatabaseState.db.loadouts[2]).toMatchObject({
      id: 'loadout-c',
      name: 'Later Loadout',
    })
    expect(testDatabaseState.db.lastLoadedLoadoutName).toBe('Loadout A')
  })

  it('does not acknowledge delete when the pre-mutation collection is malformed', async () => {
    const observedEffects: unknown[] = []
    setServerCommandSuccessReconciler((_event, _events, localEffects) => {
      observedEffects.push(...localEffects.values())
    })
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)
    withTrustedResourceWrite(() => {
      ;(testDatabaseState.db.loadouts[0] as Loadout & { legacyMetadata?: string }).legacyMetadata = 'discarded'
    })

    expect(deleteLoadout('loadout-b')).toBe(true)
    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(calls[1]).toEqual({
      url: '/api/v1/commands/loadouts/loadout-b',
      method: 'DELETE',
      authHeader: 'loadout-command-token',
      body: { baseRevision: 10 },
    })
    expect(observedEffects).toEqual([])
  })

  it('failed delete skips rollback when the same loadout id was recreated', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    setResourceWriteGuardEnabled(true)

    expect(deleteLoadout('loadout-b')).toBe(true)
    withTrustedResourceWrite(() => {
      testDatabaseState.db.loadouts[0].name = 'Edited Loadout A'
      testDatabaseState.db.loadouts.push(makeLoadout({ id: 'loadout-b', name: 'Recreated Loadout B', lastUsed: 999 }))
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(testDatabaseState.db.loadouts.map((loadout) => loadout.id)).toEqual(['loadout-a', 'loadout-b'])
    expect(testDatabaseState.db.loadouts[0].name).toBe('Edited Loadout A')
    expect(testDatabaseState.db.loadouts[1]).toMatchObject({
      id: 'loadout-b',
      name: 'Recreated Loadout B',
      lastUsed: 999,
    })
    expect(testDatabaseState.db.lastLoadedLoadoutName).toBe('Loadout A')
  })

  it('returns false for missing ids without dispatching commands or mutating loadouts', () => {
    const calls = stubCommandFetch()
    const previousLoadouts = cloneJsonValue(testDatabaseState.db.loadouts)
    setResourceWriteGuardEnabled(true)

    expect(toggleLoadoutFavorite('missing-loadout')).toBe(false)
    expect(deleteLoadout('missing-loadout')).toBe(false)

    expect(calls).toHaveLength(0)
    expect(testDatabaseState.db.loadouts).toEqual(previousLoadouts)
  })
})
