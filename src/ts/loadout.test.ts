import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'loadout-command-token',
}))

import {
  clearCachedServerCommandRevision,
  setCachedServerCommandRevision,
  setServerCommandSuccessReconciler,
} from './server/commands'
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
import { setGlobalModuleEnabled } from './moduleCommands'
import { MODEL_ROLES } from './model/modelRoles'
import {
  clearPendingMutationOutbox,
  listPendingMutations,
  preparePendingMutationOutbox,
  resetPendingMutationOutboxForTests,
  stagePendingMutation,
  type DurableMutationIntent,
} from './server/pendingMutationOutbox'
import { SETTINGS_BRIDGE_MUTATION_KEY } from './server/settingsMutationKey'
import {
  chatResourceOwnerMutationKey,
  loadoutOwnerMutationKey,
  moduleOwnerMutationKey,
} from './server/resourceOwnerMutationKeys'
import { markPromptTemplateProjectionApplied, resetPromptTemplateHydration } from './server/promptTemplateHydration'
import {
  queuePromptItemProjectionUpdate,
  resetPromptTemplateSelectionDirtyState,
} from './server/promptTemplateBridge.svelte'

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

interface DurableCapturedFetch extends CapturedFetch {
  mutationId: string | null
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

function seedConcurrentApplyState(): Loadout {
  const loadout = makeLoadout({
    id: 'concurrent-loadout',
    name: 'Concurrent Loadout',
    lastUsed: 100,
    characterIds: [],
    modules: ['module-a'],
    globalVariables: { mode: 'target' },
    presetName: '',
    agentPresetId: 'agent-target',
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
              agentPresetId: 'agent-before',
              jailbreakToggle: false,
              sidebarToggles: {},
            },
          },
        ],
      },
    ],
    agentPresets: [
      { id: 'agent-before', name: 'Before Agent', enabled: true, version: 1, steps: [] },
      { id: 'agent-target', name: 'Target Agent', enabled: true, version: 1, steps: [] },
    ],
    botPresets: [],
    botPresetsId: -1,
    modelPresets: [],
    modelPresetsId: -1,
    promptPresets: [],
    promptPresetsId: -1,
    enabledModules: [],
    globalChatVariables: { mode: 'before' },
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
    accept: () =>
      command.resolve(
        jsonResponse({
          revision: 11,
          event: { type: 'test.command', revision: 11, resource: 'test' },
        }),
      ),
    reject: () => command.resolve(jsonResponse({ error: 'forced deferred failure' }, 500)),
  }
}

function stubFirstDeferredApplyCommand() {
  const calls: CapturedFetch[] = []
  const firstCommand = deferred<Response>()
  let commandNumber = 0
  let revision = 10
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
      if (url === '/api/v1/bootstrap') return jsonResponse({ revision })
      if (url.startsWith('/api/v1/commands/')) {
        commandNumber += 1
        if (commandNumber === 1) return firstCommand.promise
        revision += 1
        return jsonResponse({
          revision,
          event: { type: 'test.command', revision, resource: 'test' },
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return {
    calls,
    rejectFirst: () => firstCommand.resolve(jsonResponse({ error: 'forced deferred failure' }, 500)),
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

function stubDurableApplyLoadoutFetch(
  onCommand?: (call: DurableCapturedFetch, commandNumber: number) => Response | Promise<Response> | null,
): DurableCapturedFetch[] {
  const calls: DurableCapturedFetch[] = []
  let revision = 10
  let commandNumber = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = init.headers as Record<string, string> | undefined
      const url = String(input)
      const call: DurableCapturedFetch = {
        url,
        method: init.method ?? 'GET',
        authHeader: headers?.['risu-auth'] ?? null,
        mutationId: headers?.['risu-mutation-id'] ?? null,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      }
      calls.push(call)

      if (url === '/api/v1/bootstrap') return jsonResponse({ revision })
      if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
      if (url.startsWith('/api/v1/commands/')) {
        commandNumber += 1
        const response = onCommand?.(call, commandNumber)
        if (response) return response
        revision += 1
        return jsonResponse({
          revision,
          event: { type: 'test.command', revision, resource: 'test' },
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

    const creation = saveCurrentLoadout('   ')
    const created = testDatabaseState.db.loadouts.at(-1) as Loadout
    await waitForCallCount(calls, 2)
    await expect(creation).resolves.toStrictEqual(created)
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

  it('keeps create pending with its optimistic row until the server accepts it', async () => {
    seedApplyLoadoutState()
    const command = stubDeferredCommandFailure()
    setResourceWriteGuardEnabled(true)

    let settled = false
    const creation = saveCurrentLoadout('Deferred Loadout').then((result) => {
      settled = true
      return result
    })
    const created = testDatabaseState.db.loadouts.at(-1) as Loadout

    expect(created).toMatchObject({ name: 'Deferred Loadout' })
    await waitForCallCount(command.calls, 2)
    await Promise.resolve()
    expect(settled).toBe(false)

    command.accept()

    await expect(creation).resolves.toStrictEqual(created)
    expect(testDatabaseState.db.loadouts.at(-1)).toStrictEqual(created)
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

    const creation = saveCurrentLoadout('Fresh Split Loadout')
    const loadout = testDatabaseState.db.loadouts.at(-1) as Loadout

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
    await expect(creation).resolves.toStrictEqual(loadout)

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

    const application = applyLoadout(loadout)

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
    await expect(application).resolves.toBe('applied')

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

  it('orders retained settings, legacy selection, and global variables under distinct durable receipts', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-loadout-settings-order',
      writerEpoch: 6,
      databaseLineage: 'lineage-loadout-settings-order',
      requestedWriterWasActive: true,
    })

    try {
      const loadout = seedApplyLoadoutState()
      setCachedServerCommandRevision(10)
      const predecessorIntent: DurableMutationIntent = {
        version: 1,
        requests: [
          {
            method: 'PATCH',
            path: '/settings/model',
            body: { patch: { temperature: 55 } },
          },
        ],
      }
      const predecessor = stagePendingMutation(SETTINGS_BRIDGE_MUTATION_KEY, predecessorIntent)
      await predecessor.ready
      const calls = stubDurableApplyLoadoutFetch()
      setResourceWriteGuardEnabled(true)

      await expect(applyLoadout(loadout, ['preset', 'globalVariables'])).resolves.toBe('applied')

      const commands = calls.filter((call) => call.url !== '/api/v1/commands/mutation-receipts/ack')
      expect(commands.map(({ method, url }) => `${method} ${url}`)).toEqual([
        'PATCH /api/v1/commands/settings/model',
        'POST /api/v1/commands/presets/select',
        'PATCH /api/v1/commands/settings/sidebar',
        'POST /api/v1/commands/loadouts/loadout-a/touch',
      ])
      expect(commands.slice(0, 3).map(({ body }) => body)).toEqual([
        { baseRevision: 10, patch: { temperature: 55 } },
        { baseRevision: 11, presetId: 'preset-b', apply: true, saveCurrent: true },
        {
          baseRevision: 12,
          patch: { globalChatVariables: { mood: 'focused', scene: 'night' } },
        },
      ])
      expect(new Set(commands.slice(0, 3).map(({ mutationId }) => mutationId)).size).toBe(3)
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('keeps a split prompt selection behind a transient flushed edit from the outgoing owner', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-loadout-prompt-owner-order',
      writerEpoch: 7,
      databaseLineage: 'lineage-loadout-prompt-owner-order',
      requestedWriterWasActive: true,
    })
    resetPromptTemplateHydration()
    resetPromptTemplateSelectionDirtyState()

    try {
      const loadout = seedSplitPresetLoadoutState()
      loadout.modelPresetId = ''
      loadout.modelPresetName = ''
      const previousItem = { id: 'prompt-a-row', type: 'plain', text: 'before loadout' } as any
      let draftItems = [{ ...previousItem, text: 'edited before loadout' }]
      testDatabaseState.db.promptPresets[0].promptTemplate = [cloneJsonValue(previousItem)]
      testDatabaseState.db.promptPresets[1].promptTemplate = [
        { id: 'prompt-b-row', type: 'plain', text: 'target row' },
      ] as any
      testDatabaseState.db.promptTemplate = [cloneJsonValue(previousItem)]
      markPromptTemplateProjectionApplied('prompt-a', 10)
      setCachedServerCommandRevision(10)

      queuePromptItemProjectionUpdate(
        {
          getItems: () => draftItems,
          setItems: (items) => {
            draftItems = items as typeof draftItems
          },
        },
        'prompt-a-row',
        previousItem,
        60_000,
        'prompt-a',
      )
      const calls = stubDurableApplyLoadoutFetch((call) =>
        call.url === '/api/v1/commands/prompt-items/prompt-a-row'
          ? jsonResponse({ error: 'prompt row temporarily unavailable' }, 500)
          : null,
      )
      vi.spyOn(Date, 'now').mockReturnValue(123456)
      setResourceWriteGuardEnabled(true)

      await expect(applyLoadout(loadout, ['preset'])).resolves.toBe('queued')

      const commands = calls.filter((call) => call.url !== '/api/v1/commands/mutation-receipts/ack')
      expect(commands.map(({ method, url }) => `${method} ${url}`)).toEqual([
        'PATCH /api/v1/commands/prompt-items/prompt-a-row',
        'PATCH /api/v1/commands/prompt-items/prompt-a-row',
      ])
      expect(commands.some((call) => call.url === '/api/v1/commands/prompt-presets/select')).toBe(false)
      expect((await listPendingMutations()).map((entry) => entry.intent)).toEqual([
        {
          version: 1,
          requests: [
            {
              method: 'PATCH',
              path: '/prompt-items/prompt-a-row',
              body: { promptPresetId: 'prompt-a', patch: { text: 'edited before loadout' } },
            },
          ],
        },
        {
          version: 1,
          dependencyKeys: ['prompt-template-owner:prompt-a', 'prompt-template-owner:prompt-b'],
          requests: [
            {
              method: 'POST',
              path: '/prompt-presets/select',
              body: { promptPresetId: 'prompt-b' },
            },
          ],
        },
        {
          version: 1,
          dependencyKeys: [SETTINGS_BRIDGE_MUTATION_KEY],
          requests: [
            {
              method: 'POST',
              path: '/loadouts/split-loadout/touch',
              body: { lastUsed: 123456, characterId: 'char-a' },
            },
          ],
        },
      ])
      expect(testDatabaseState.db.promptPresetsId).toBe(1)
      expect(testDatabaseState.db.loadouts[0]).toMatchObject({ lastUsed: 123456, characterIds: ['char-a'] })
      expect(testDatabaseState.db.lastLoadedLoadoutName).toBe('Split Loadout')
    } finally {
      resetPromptTemplateSelectionDirtyState()
      resetPromptTemplateHydration()
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('keeps a retryable module step and its persisted tail projected for replay', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-loadout-skipped-steps',
      writerEpoch: 7,
      databaseLineage: 'lineage-loadout-skipped-steps',
      requestedWriterWasActive: true,
    })

    try {
      const loadout = seedApplyLoadoutState()
      const authoritativeModules = cloneJsonValue(testDatabaseState.db.enabledModules)
      const authoritativeGlobalVariables = cloneJsonValue(testDatabaseState.db.globalChatVariables)
      let reconciledAcceptedPrefix = false
      setServerCommandSuccessReconciler(() => {
        reconciledAcceptedPrefix = true
        // A legacy preset acknowledgement performs a full settings read in
        // production. Simulate its affected groups replacing the retained
        // module/global tail before the sequence promise resolves.
        applySettingsGroupResource(
          { revision: 21, group: 'modules', settings: { enabledModules: authoritativeModules } },
          ['enabledModules'],
        )
        applySettingsGroupResource(
          { revision: 21, group: 'sidebar', settings: { globalChatVariables: authoritativeGlobalVariables } },
          ['globalChatVariables'],
        )
      })
      setCachedServerCommandRevision(20)
      const calls = stubDurableApplyLoadoutFetch((call) =>
        call.url === '/api/v1/commands/modules/enable' ? jsonResponse({ error: 'forced module failure' }, 500) : null,
      )
      vi.spyOn(Date, 'now').mockReturnValue(123456)
      setResourceWriteGuardEnabled(true)

      await expect(applyLoadout(loadout, ['preset', 'modules', 'globalVariables'])).resolves.toBe('queued')

      const commands = calls.filter((call) => call.url !== '/api/v1/commands/mutation-receipts/ack')
      expect(commands.map((call) => call.url)).toEqual([
        '/api/v1/commands/presets/select',
        '/api/v1/commands/modules/enable',
      ])
      expect(commands.some((call) => call.url === '/api/v1/commands/settings/sidebar')).toBe(false)
      const pending = await listPendingMutations()
      expect(pending.map((entry) => ({ key: entry.handle.key, requests: entry.intent.requests }))).toEqual([
        {
          key: moduleOwnerMutationKey('module-a'),
          requests: [
            {
              method: 'POST',
              path: '/modules/enable',
              body: { moduleId: 'module-a', enabled: true },
            },
          ],
        },
        {
          key: moduleOwnerMutationKey('module-z'),
          requests: [
            {
              method: 'POST',
              path: '/modules/enable',
              body: { moduleId: 'module-z', enabled: false },
            },
          ],
        },
        {
          key: SETTINGS_BRIDGE_MUTATION_KEY,
          requests: [
            {
              method: 'PATCH',
              path: '/settings/sidebar',
              body: { patch: { globalChatVariables: { mood: 'focused', scene: 'night' } } },
            },
          ],
        },
        {
          key: loadoutOwnerMutationKey('loadout-a'),
          requests: [
            {
              method: 'POST',
              path: '/loadouts/loadout-a/touch',
              body: { lastUsed: 123456, characterId: 'char-a' },
            },
          ],
        },
      ])
      expect(testDatabaseState.db.botPresetsId).toBe(1)
      expect(reconciledAcceptedPrefix).toBe(true)
      expect(testDatabaseState.db.enabledModules).toEqual(['module-a', 'module-stay'])
      expect(testDatabaseState.db.globalChatVariables).toEqual({ mood: 'focused', scene: 'night' })
      expect(testDatabaseState.db.loadouts[0]).toMatchObject({ lastUsed: 123456, characterIds: ['char-a'] })
      expect(testDatabaseState.db.lastLoadedLoadoutName).toBe('Battle Loadout')
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('reserves the command queue before waiting for every loadout row to become durable', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-loadout-readiness-order',
      writerEpoch: 8,
      databaseLineage: 'lineage-loadout-readiness-order',
      requestedWriterWasActive: true,
    })

    try {
      const loadout = seedApplyLoadoutState()
      const encryptionGate = deferred<void>()
      const originalEncrypt = globalThis.crypto.subtle.encrypt.bind(globalThis.crypto.subtle)
      const encryptSpy = vi
        .spyOn(globalThis.crypto.subtle, 'encrypt')
        .mockImplementationOnce(async (algorithm, key, data) => {
          await encryptionGate.promise
          return originalEncrypt(algorithm, key, data)
        })
      setCachedServerCommandRevision(20)
      const calls = stubDurableApplyLoadoutFetch()
      setResourceWriteGuardEnabled(true)

      const application = applyLoadout(loadout, ['modules'])
      await vi.waitFor(() => expect(encryptSpy).toHaveBeenCalled())
      expect(testDatabaseState.db.enabledModules).toEqual(['module-a', 'module-stay'])

      setGlobalModuleEnabled('module-b', true)
      expect(testDatabaseState.db.enabledModules).toEqual(['module-a', 'module-stay', 'module-b'])
      await flushCommandEffects()
      expect(calls.filter((call) => call.url.startsWith('/api/v1/commands/'))).toEqual([])

      encryptionGate.resolve()
      await expect(application).resolves.toBe('applied')
      await vi.waitFor(() =>
        expect(
          calls
            .filter((call) => call.url === '/api/v1/commands/modules/enable')
            .map((call) => (call.body as { moduleId: string }).moduleId),
        ).toEqual(['module-a', 'module-z', 'module-b']),
      )
      expect(testDatabaseState.db.enabledModules).toEqual(['module-a', 'module-stay', 'module-b'])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('discards a terminal module step and its skipped persisted tail before reverse rollback', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-loadout-terminal-step',
      writerEpoch: 8,
      databaseLineage: 'lineage-loadout-terminal-step',
      requestedWriterWasActive: true,
    })

    try {
      const loadout = seedApplyLoadoutState()
      const previousModules = cloneJsonValue(testDatabaseState.db.enabledModules)
      const previousGlobalVariables = cloneJsonValue(testDatabaseState.db.globalChatVariables)
      setCachedServerCommandRevision(20)
      const calls = stubDurableApplyLoadoutFetch((call) =>
        call.url === '/api/v1/commands/modules/enable' ? jsonResponse({ error: 'module no longer exists' }, 404) : null,
      )
      setResourceWriteGuardEnabled(true)

      await expect(applyLoadout(loadout, ['preset', 'modules', 'globalVariables'])).resolves.toBe('persistence-failed')

      const commands = calls.filter((call) => call.url !== '/api/v1/commands/mutation-receipts/ack')
      expect(commands.map((call) => call.url)).toEqual([
        '/api/v1/commands/presets/select',
        '/api/v1/commands/modules/enable',
      ])
      expect(await listPendingMutations()).toEqual([])
      expect(testDatabaseState.db.botPresetsId).toBe(1)
      expect(testDatabaseState.db.enabledModules).toEqual(previousModules)
      expect(testDatabaseState.db.globalChatVariables).toEqual(previousGlobalVariables)
      expect(testDatabaseState.db.loadouts[0]).toMatchObject({ lastUsed: 100, characterIds: [] })
      expect(testDatabaseState.db.lastLoadedLoadoutName).toBe('Before Loadout')
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('rolls back failed and skipped loadout steps when IndexedDB staging is unavailable', async () => {
    resetPendingMutationOutboxForTests()
    const persistenceWarning = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const loadout = seedApplyLoadoutState()
      const previousModules = cloneJsonValue(testDatabaseState.db.enabledModules)
      const previousGlobalVariables = cloneJsonValue(testDatabaseState.db.globalChatVariables)
      setCachedServerCommandRevision(20)
      const calls = stubDurableApplyLoadoutFetch((call) =>
        call.url === '/api/v1/commands/modules/enable'
          ? jsonResponse({ error: 'module temporarily unavailable' }, 500)
          : null,
      )
      setResourceWriteGuardEnabled(true)

      await expect(applyLoadout(loadout, ['preset', 'modules', 'globalVariables'])).resolves.toBe('persistence-failed')

      const commands = calls.filter((call) => call.url !== '/api/v1/commands/mutation-receipts/ack')
      expect(commands.map((call) => ({ url: call.url, mutationId: call.mutationId }))).toEqual([
        { url: '/api/v1/commands/presets/select', mutationId: null },
        { url: '/api/v1/commands/modules/enable', mutationId: null },
      ])
      expect(await listPendingMutations()).toEqual([])
      expect(testDatabaseState.db.botPresetsId).toBe(1)
      expect(testDatabaseState.db.enabledModules).toEqual(previousModules)
      expect(testDatabaseState.db.globalChatVariables).toEqual(previousGlobalVariables)
      expect(testDatabaseState.db.loadouts[0]).toMatchObject({ lastUsed: 100, characterIds: [] })
      expect(testDatabaseState.db.lastLoadedLoadoutName).toBe('Before Loadout')
    } finally {
      persistenceWarning.mockRestore()
      resetPendingMutationOutboxForTests()
    }
  })

  it('orders a retained chat generation save before the loadout Agent Preset correction', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-loadout-agent-preset',
      writerEpoch: 8,
      databaseLineage: 'lineage-loadout-agent-preset',
      requestedWriterWasActive: true,
    })

    try {
      const loadout = makeLoadout({
        id: 'agent-loadout',
        name: 'Agent Loadout',
        characterIds: [],
        modules: [],
        globalVariables: {},
        presetName: '',
        agentPresetId: 'agent-b',
        agentPresetName: 'Agent B',
        personaId: '',
      })
      const generationSettings = {
        configured: true,
        agentPresetId: 'agent-a',
        jailbreakToggle: false,
        sidebarToggles: {},
      }
      selectedCharID.set(0)
      testDatabaseState.db = {
        loadouts: [cloneJsonValue(loadout)],
        lastLoadedLoadoutName: 'Before Loadout',
        characters: [
          {
            chaId: 'char-a',
            chatPage: 0,
            chats: [{ id: 'chat-a', message: [], generationSettings: cloneJsonValue(generationSettings) }],
          },
        ],
        agentPresets: [
          { id: 'agent-a', name: 'Agent A', enabled: true, version: 1, steps: [] },
          { id: 'agent-b', name: 'Agent B', enabled: true, version: 1, steps: [] },
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
      setCachedServerCommandRevision(10)
      const predecessorIntent: DurableMutationIntent = {
        version: 1,
        requests: [
          {
            method: 'PUT',
            path: '/chats/chat-a/generation-settings',
            body: { generationSettings: cloneJsonValue(generationSettings) },
          },
        ],
      }
      const predecessor = stagePendingMutation(chatResourceOwnerMutationKey('chat-a', 'char-a'), predecessorIntent)
      await predecessor.ready
      const calls = stubDurableApplyLoadoutFetch()
      setResourceWriteGuardEnabled(true)

      await expect(applyLoadout(loadout, ['preset'])).resolves.toBe('applied')

      const commands = calls.filter((call) => call.url !== '/api/v1/commands/mutation-receipts/ack')
      expect(commands.slice(0, 2).map(({ method, url }) => `${method} ${url}`)).toEqual([
        'PUT /api/v1/commands/chats/chat-a/generation-settings',
        'PUT /api/v1/commands/chats/chat-a/generation-settings',
      ])
      expect(commands[0].body).toEqual({ baseRevision: 10, generationSettings })
      expect(commands[1].body).toEqual({
        baseRevision: 11,
        generationSettings: { ...generationSettings, agentPresetId: 'agent-b' },
      })
      expect(new Set(commands.slice(0, 2).map(({ mutationId }) => mutationId)).size).toBe(2)
      expect(testDatabaseState.db.characters[0].chats[0].generationSettings.agentPresetId).toBe('agent-b')
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('drains a retained module toggle before applying the loadout absolute target', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-loadout-module-order',
      writerEpoch: 9,
      databaseLineage: 'lineage-loadout-module-order',
      requestedWriterWasActive: true,
    })

    try {
      const loadout = seedApplyLoadoutState()
      loadout.modules = ['module-stay']
      testDatabaseState.db.enabledModules = ['module-a', 'module-stay']
      setCachedServerCommandRevision(10)
      const predecessorIntent: DurableMutationIntent = {
        version: 1,
        requests: [
          {
            method: 'POST',
            path: '/modules/enable',
            body: { moduleId: 'module-a', enabled: true },
          },
        ],
      }
      const predecessor = stagePendingMutation(moduleOwnerMutationKey('module-a'), predecessorIntent)
      await predecessor.ready
      const calls = stubDurableApplyLoadoutFetch()
      setResourceWriteGuardEnabled(true)

      await expect(applyLoadout(loadout, ['modules'])).resolves.toBe('applied')

      const commands = calls.filter((call) => call.url !== '/api/v1/commands/mutation-receipts/ack')
      expect(commands.slice(0, 2).map(({ method, url, body }) => ({ method, url, body }))).toEqual([
        {
          method: 'POST',
          url: '/api/v1/commands/modules/enable',
          body: { baseRevision: 10, moduleId: 'module-a', enabled: true },
        },
        {
          method: 'POST',
          url: '/api/v1/commands/modules/enable',
          body: { baseRevision: 11, moduleId: 'module-a', enabled: false },
        },
      ])
      expect(new Set(commands.slice(0, 2).map(({ mutationId }) => mutationId)).size).toBe(2)
      expect(testDatabaseState.db.enabledModules).toEqual(['module-stay'])
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('replans a concurrent same-target module apply after the first apply rolls back', async () => {
    const loadout = seedConcurrentApplyState()
    const command = stubFirstDeferredApplyCommand()
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setResourceWriteGuardEnabled(true)

    const first = applyLoadout(loadout, ['modules'])
    await waitForCallCount(command.calls, 2)
    const second = applyLoadout(loadout, ['modules'])

    command.rejectFirst()

    await expect(first).resolves.toBe('persistence-failed')
    await expect(second).resolves.toBe('applied')
    expect(
      command.calls
        .filter((call) => call.url.startsWith('/api/v1/commands/'))
        .map((call) => ({ url: call.url, body: call.body })),
    ).toEqual([
      {
        url: '/api/v1/commands/modules/enable',
        body: { baseRevision: 10, moduleId: 'module-a', enabled: true },
      },
      {
        url: '/api/v1/commands/modules/enable',
        body: { baseRevision: 10, moduleId: 'module-a', enabled: true },
      },
      {
        url: '/api/v1/commands/loadouts/concurrent-loadout/touch',
        body: { baseRevision: 11, lastUsed: 123456, characterId: 'char-a' },
      },
    ])
    expect(testDatabaseState.db.enabledModules).toEqual(['module-a'])
  })

  it('replans concurrent same-target global variables after the first apply rolls back', async () => {
    const loadout = seedConcurrentApplyState()
    const command = stubFirstDeferredApplyCommand()
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setResourceWriteGuardEnabled(true)

    const first = applyLoadout(loadout, ['globalVariables'])
    await waitForCallCount(command.calls, 2)
    const second = applyLoadout(loadout, ['globalVariables'])

    command.rejectFirst()

    await expect(first).resolves.toBe('persistence-failed')
    await expect(second).resolves.toBe('applied')
    expect(
      command.calls
        .filter((call) => call.url.startsWith('/api/v1/commands/'))
        .map((call) => ({ url: call.url, body: call.body })),
    ).toEqual([
      {
        url: '/api/v1/commands/settings/sidebar',
        body: { baseRevision: 10, patch: { globalChatVariables: { mode: 'target' } } },
      },
      {
        url: '/api/v1/commands/settings/sidebar',
        body: { baseRevision: 10, patch: { globalChatVariables: { mode: 'target' } } },
      },
      {
        url: '/api/v1/commands/loadouts/concurrent-loadout/touch',
        body: { baseRevision: 11, lastUsed: 123456, characterId: 'char-a' },
      },
    ])
    expect(testDatabaseState.db.globalChatVariables).toEqual({ mode: 'target' })
  })

  it('replans a concurrent same-target Agent Preset after the first apply rolls back', async () => {
    const loadout = seedConcurrentApplyState()
    const command = stubFirstDeferredApplyCommand()
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setResourceWriteGuardEnabled(true)

    const first = applyLoadout(loadout, ['preset'])
    await waitForCallCount(command.calls, 2)
    const second = applyLoadout(loadout, ['preset'])

    command.rejectFirst()

    await expect(first).resolves.toBe('persistence-failed')
    await expect(second).resolves.toBe('applied')
    expect(
      command.calls
        .filter((call) => call.url.startsWith('/api/v1/commands/'))
        .map((call) => ({ url: call.url, body: call.body })),
    ).toEqual([
      {
        url: '/api/v1/commands/chats/chat-a/generation-settings',
        body: {
          baseRevision: 10,
          generationSettings: {
            configured: true,
            agentPresetId: 'agent-target',
            jailbreakToggle: false,
            sidebarToggles: {},
          },
        },
      },
      {
        url: '/api/v1/commands/chats/chat-a/generation-settings',
        body: {
          baseRevision: 10,
          generationSettings: {
            configured: true,
            agentPresetId: 'agent-target',
            jailbreakToggle: false,
            sidebarToggles: {},
          },
        },
      },
      {
        url: '/api/v1/commands/loadouts/concurrent-loadout/touch',
        body: { baseRevision: 11, lastUsed: 123456, characterId: 'char-a' },
      },
    ])
    expect(testDatabaseState.db.characters[0].chats[0].generationSettings.agentPresetId).toBe('agent-target')
  })

  it('recomputes a concurrent same-loadout touch after the first touch rolls back', async () => {
    const loadout = seedConcurrentApplyState()
    const command = stubFirstDeferredApplyCommand()
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    setResourceWriteGuardEnabled(true)

    const first = applyLoadout(loadout, [])
    await waitForCallCount(command.calls, 2)
    now.mockReturnValue(2000)
    const second = applyLoadout(loadout, [])

    // A queued apply must not capture the first apply's optimistic touch as its
    // baseline before that touch has either committed or rolled back.
    expect(testDatabaseState.db.loadouts[0]).toMatchObject({ lastUsed: 1000, characterIds: ['char-a'] })
    command.rejectFirst()

    await expect(first).resolves.toBe('persistence-failed')
    await expect(second).resolves.toBe('applied')
    expect(
      command.calls
        .filter((call) => call.url.startsWith('/api/v1/commands/'))
        .map((call) => ({ url: call.url, body: call.body })),
    ).toEqual([
      {
        url: '/api/v1/commands/loadouts/concurrent-loadout/touch',
        body: { baseRevision: 10, lastUsed: 1000, characterId: 'char-a' },
      },
      {
        url: '/api/v1/commands/loadouts/concurrent-loadout/touch',
        body: { baseRevision: 10, lastUsed: 2000, characterId: 'char-a' },
      },
    ])
    expect(testDatabaseState.db.loadouts[0]).toMatchObject({ lastUsed: 2000, characterIds: ['char-a'] })
  })

  it('keeps apply pending until the complete command sequence is accepted', async () => {
    const loadout = seedApplyLoadoutState()
    const command = stubDeferredCommandFailure()
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setResourceWriteGuardEnabled(true)

    let settled = false
    const application = applyLoadout(loadout, []).then((status) => {
      settled = true
      return status
    })

    expect(testDatabaseState.db.loadouts[0]).toMatchObject({ lastUsed: 123456, characterIds: ['char-a'] })
    await waitForCallCount(command.calls, 2)
    await Promise.resolve()
    expect(settled).toBe(false)

    command.accept()

    await expect(application).resolves.toBe('applied')
  })

  it('returns persistence failure only after a deferred apply command rolls back', async () => {
    const loadout = seedApplyLoadoutState()
    const command = stubDeferredCommandFailure()
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setResourceWriteGuardEnabled(true)

    let settled = false
    const application = applyLoadout(loadout, []).then((status) => {
      settled = true
      return status
    })

    expect(testDatabaseState.db.loadouts[0]).toMatchObject({ lastUsed: 123456, characterIds: ['char-a'] })
    await waitForCallCount(command.calls, 2)
    await Promise.resolve()
    expect(settled).toBe(false)

    command.reject()

    await expect(application).resolves.toBe('persistence-failed')
    expect(testDatabaseState.db.loadouts[0]).toMatchObject({ lastUsed: 100, characterIds: [] })
    expect(testDatabaseState.db.lastLoadedLoadoutName).toBe('Before Loadout')
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

    const application = applyLoadout(loadout)
    expect(testDatabaseState.db.selectedPersona).toBe(1)
    expect(testDatabaseState.db.botPresetsId).toBe(1)
    expect(testDatabaseState.db.enabledModules).toEqual(['module-a', 'module-stay'])
    expect(testDatabaseState.db.globalChatVariables).toEqual({ mood: 'focused', scene: 'night' })

    await waitForCallCount(calls, 6)
    await expect(application).resolves.toBe('persistence-failed')
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

  it('keeps the original character and chat target while legacy preset hydration is pending', async () => {
    const loadout = seedApplyLoadoutState()
    loadout.agentPresetId = 'agent-preset-target'
    loadout.agentPresetName = 'Target Agent'
    testDatabaseState.db.agentPresets = [
      { id: 'agent-preset-old-a', name: 'Old A', enabled: true, version: 1, steps: [] },
      { id: 'agent-preset-old-b', name: 'Old B', enabled: true, version: 1, steps: [] },
      { id: 'agent-preset-target', name: 'Target Agent', enabled: true, version: 1, steps: [] },
    ]
    testDatabaseState.db.characters = [
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
            generationSettings: { agentPresetId: 'agent-preset-old-a', jailbreakToggle: false },
          },
        ],
      },
      {
        chaId: 'char-b',
        chatPage: 0,
        chats: [
          {
            id: 'chat-b',
            name: 'Chat B',
            note: '',
            message: [],
            localLore: [],
            generationSettings: { agentPresetId: 'agent-preset-old-b', jailbreakToggle: false },
          },
        ],
      },
    ] as any
    testDatabaseState.db.botPresets[1] = {
      id: 'preset-b',
      name: 'Preset B',
    } as never
    const hydration = deferred<Response>()
    const calls = stubApplyLoadoutFetch({ projectionResponse: hydration.promise })
    setResourceWriteGuardEnabled(true)

    const application = applyLoadout(loadout, ['preset'])
    await waitForUrl(calls, '/api/v1/legacy-presets/preset-b')

    selectedCharID.set(1)
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

    await expect(application).resolves.toBe('applied')
    expect(testDatabaseState.db.characters[0].chats[0].generationSettings?.agentPresetId).toBe('agent-preset-target')
    expect(testDatabaseState.db.characters[1].chats[0].generationSettings?.agentPresetId).toBe('agent-preset-old-b')
    expect(loadout.characterIds).toContain('char-a')
    expect(loadout.characterIds).not.toContain('char-b')
    await waitForUrl(calls, '/api/v1/commands/chats/chat-a/generation-settings')
    expect(calls.map((call) => call.url)).not.toContain('/api/v1/commands/chats/chat-b/generation-settings')
  })

  it('returns a visible failure status when legacy preset hydration fails', async () => {
    const loadout = seedApplyLoadoutState()
    testDatabaseState.db.botPresets[1] = {
      id: 'preset-b',
      name: 'Preset B',
    } as never
    const hydration = deferred<Response>()
    const calls = stubApplyLoadoutFetch({ projectionResponse: hydration.promise })
    setResourceWriteGuardEnabled(true)

    const application = applyLoadout(loadout, ['preset'])
    await waitForUrl(calls, '/api/v1/legacy-presets/preset-b')
    hydration.resolve(jsonResponse({ error: 'forced hydration failure' }, 500))

    await expect(application).resolves.toBe('preset-hydration-failed')
    expect(testDatabaseState.db.mainPrompt).toBe('live main')
    expect(calls.some((call) => call.url.startsWith('/api/v1/commands/'))).toBe(false)
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

    const creation = saveCurrentLoadout('Created Loadout')
    await waitForCallCount(failure.calls, 2)
    const created = testDatabaseState.db.loadouts.at(-1) as Loadout
    const authoritativeLoadouts = [makeLoadout({ id: 'loadout-a', name: 'Authoritative A' }), cloneJsonValue(created)]
    applyCollectionsResource(
      {
        revision: 11,
        collections: { loadouts: authoritativeLoadouts },
      },
      'loadouts',
    )
    failure.reject()
    await expect(creation).resolves.toBeNull()
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

  it('reasserts a retained create after collection reconciliation erases its optimistic row', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-retained-loadout-create',
      writerEpoch: 1,
      databaseLineage: 'lineage-retained-loadout-create',
      requestedWriterWasActive: true,
    })
    try {
      seedApplyLoadoutState()
      const failure = stubDeferredCommandFailure()
      setResourceWriteGuardEnabled(true)

      const creation = saveCurrentLoadout('Retained Create')
      const created = cloneJsonValue(testDatabaseState.db.loadouts.at(-1) as Loadout)
      await waitForCallCount(failure.calls, 2)
      applyCollectionsResource(
        {
          revision: 11,
          collections: { loadouts: [makeLoadout({ id: 'loadout-a', name: 'Authoritative A' })] },
        },
        'loadouts',
      )
      failure.reject()

      await expect(creation).resolves.toEqual(created)
      expect(testDatabaseState.db.loadouts.at(-1)).toEqual(created)
      expect((await listPendingMutations()).map((entry) => entry.handle.key)).toContain(
        loadoutOwnerMutationKey(created.id),
      )
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('reasserts a retained favorite after collection reconciliation restores its old value', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-retained-loadout-favorite',
      writerEpoch: 1,
      databaseLineage: 'lineage-retained-loadout-favorite',
      requestedWriterWasActive: true,
    })
    try {
      const failure = stubDeferredCommandFailure()
      setResourceWriteGuardEnabled(true)

      expect(toggleLoadoutFavorite('loadout-a')).toBe(true)
      await waitForCallCount(failure.calls, 2)
      applyCollectionsResource(
        {
          revision: 11,
          collections: {
            loadouts: [
              makeLoadout({ id: 'loadout-a', name: 'Authoritative A', favorite: false }),
              makeLoadout({ id: 'loadout-b', name: 'Authoritative B', favorite: true }),
            ],
          },
        },
        'loadouts',
      )
      failure.reject()
      await flushCommandEffects()

      expect(testDatabaseState.db.loadouts.find((loadout) => loadout.id === 'loadout-a')?.favorite).toBe(true)
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('reasserts a retained delete after collection reconciliation resurrects its row', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-retained-loadout-delete',
      writerEpoch: 1,
      databaseLineage: 'lineage-retained-loadout-delete',
      requestedWriterWasActive: true,
    })
    try {
      const failure = stubDeferredCommandFailure()
      setResourceWriteGuardEnabled(true)

      expect(deleteLoadout('loadout-b')).toBe(true)
      await waitForCallCount(failure.calls, 2)
      applyCollectionsResource(
        {
          revision: 11,
          collections: {
            loadouts: [
              makeLoadout({ id: 'loadout-a', name: 'Authoritative A' }),
              makeLoadout({ id: 'loadout-b', name: 'Authoritative B' }),
            ],
          },
        },
        'loadouts',
      )
      failure.reject()
      await flushCommandEffects()

      expect(testDatabaseState.db.loadouts.some((loadout) => loadout.id === 'loadout-b')).toBe(false)
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('composes a settled retained create with a later retained favorite after collection replacement', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-retained-loadout-composition',
      writerEpoch: 1,
      databaseLineage: 'lineage-retained-loadout-composition',
      requestedWriterWasActive: true,
    })
    try {
      seedApplyLoadoutState()
      const replayFailure = deferred<Response>()
      const calls = stubDurableApplyLoadoutFetch((call, commandNumber) => {
        if (call.url !== '/api/v1/commands/loadouts') return null
        if (commandNumber === 1) return jsonResponse({ error: 'create response lost' }, 500)
        return replayFailure.promise
      })
      setResourceWriteGuardEnabled(true)

      const creation = saveCurrentLoadout('Composed Create')
      const created = cloneJsonValue(testDatabaseState.db.loadouts.at(-1) as Loadout)
      await expect(creation).resolves.toEqual(created)
      expect(toggleLoadoutFavorite(created.id)).toBe(true)
      await waitForCallCount(calls, 3)
      applyCollectionsResource(
        {
          revision: 11,
          collections: { loadouts: [makeLoadout({ id: 'loadout-a', name: 'Authoritative A' })] },
        },
        'loadouts',
      )
      replayFailure.resolve(jsonResponse({ error: 'create still unavailable' }, 500))
      await flushCommandEffects()

      expect(testDatabaseState.db.loadouts.find((loadout) => loadout.id === created.id)).toEqual({
        ...created,
        favorite: true,
      })
      expect(calls.filter((call) => call.url === '/api/v1/commands/loadouts')).toHaveLength(2)
      expect(calls.some((call) => call.url.endsWith('/favorite'))).toBe(false)
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
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

    const creation = saveCurrentLoadout('Created Loadout')
    const created = testDatabaseState.db.loadouts.at(-1) as Loadout
    expect(testDatabaseState.db.loadouts.map((item) => item.id)).toEqual(['loadout-a', created.id])
    withTrustedResourceWrite(() => {
      testDatabaseState.db.loadouts[0].name = 'Edited Existing Loadout'
      testDatabaseState.db.loadouts.push(makeLoadout({ id: 'loadout-later', name: 'Later Loadout' }))
    })

    await waitForCallCount(calls, 2)
    await expect(creation).resolves.toBeNull()
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
