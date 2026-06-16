import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'loadout-command-token',
}))

import { clearCachedServerCommandRevision } from './server/commands'
import { setServerProjectionWriteGuardEnabled } from './server/projectionWriteGuard.svelte'
import { DBState, selectedCharID } from './stores.svelte'
import { applyLoadout, deleteLoadout, saveCurrentLoadout, toggleLoadoutFavorite, type Loadout } from './loadout'
import { currentPersonaStateSnapshot, isPersonaSettingsWatcherSuppressed, queueSelectedPersonaUpdate } from './persona'

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

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
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
    personaId: 'persona-a',
    ...overrides,
  }
}

function seedLoadouts(): void {
  DBState.db = {
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
  DBState.db = {
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

  return DBState.db.loadouts[0] as Loadout
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
  DBState.db = {
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
      },
    ],
    promptPresetsId: 0,
    apiType: 'openai',
    temperature: 0.4,
    maxResponse: 100,
    mainPrompt: 'default main',
    jailbreak: 'default jailbreak',
    globalNote: 'default global',
    formatingOrder: ['description'],
    enabledModules: ['module-stay'],
    globalChatVariables: { mood: 'calm' },
  } as any

  return DBState.db.loadouts[0] as Loadout
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
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

function stubApplyLoadoutFetch(
  options: { failCommandNumber?: number; projectionPreset?: Record<string, unknown> } = {},
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
      if (url === '/api/v1/projection/preset?id=preset-b') {
        return jsonResponse({
          revision: 100,
          resource: 'preset',
          mode: 'preset',
          presetId: 'preset-b',
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

async function flushCommandEffects(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  seedLoadouts()
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('LoadoutModal projection write cleanup', () => {
  it('routes modal favorite and delete operations through loadout domain helpers', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/Others/LoadoutModal.svelte'), 'utf8')

    expect(source).not.toContain('withTrustedServerProjectionWrite')
    expect(source).not.toContain('currentLoadoutStateSnapshot')
    expect(source).not.toContain('dispatchDeleteLoadout')
    expect(source).not.toContain('dispatchFavoriteLoadout')
    expect(source).toContain('toggleLoadoutFavorite')
    expect(source).toContain('deleteLoadout')
  })
})

describe('loadout projection command helpers', () => {
  it('saves split model and prompt preset ids when no legacy bot preset is selected', async () => {
    seedSplitPresetLoadoutState()
    DBState.db.loadouts = []
    DBState.db.modelPresetsId = 1
    DBState.db.promptPresetsId = 1
    const calls = stubApplyLoadoutFetch()
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setServerProjectionWriteGuardEnabled(true)

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
      personaId: 'persona-a',
    })
    expect(DBState.db.loadouts[0]).toMatchObject(loadout)

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
        }),
      },
    })
  })

  it('applies all requested facets locally and dispatches them as one serialized command sequence', async () => {
    const loadout = seedApplyLoadoutState()
    const calls = stubApplyLoadoutFetch()
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setServerProjectionWriteGuardEnabled(true)

    applyLoadout(loadout)

    expect(DBState.db.selectedPersona).toBe(1)
    expect(DBState.db.username).toBe('Persona B')
    expect(DBState.db.personas[0]).toMatchObject({
      name: 'Live User',
      icon: 'live-icon',
      personaPrompt: 'live persona prompt',
      note: 'live user note',
    })
    expect(DBState.db.botPresetsId).toBe(1)
    expect(DBState.db.mainPrompt).toBe('preset-b main')
    expect(DBState.db.enabledModules).toEqual(['module-a', 'module-stay'])
    expect(DBState.db.globalChatVariables).toEqual({ mood: 'focused', scene: 'night' })
    expect(DBState.db.loadouts[0]).toMatchObject({
      lastUsed: 123456,
      characterIds: ['char-a'],
    })
    expect(DBState.db.lastLoadedLoadoutName).toBe('Battle Loadout')

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

  it('applies split model and prompt preset selections without falling back to legacy presets', async () => {
    const loadout = seedSplitPresetLoadoutState()
    const calls = stubApplyLoadoutFetch()
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setServerProjectionWriteGuardEnabled(true)

    applyLoadout(loadout, ['preset'])

    expect(DBState.db.botPresetsId).toBe(-1)
    expect(DBState.db.modelPresetsId).toBe(1)
    expect(DBState.db.promptPresetsId).toBe(1)
    expect(DBState.db.apiType).toBe('kobold')
    expect(DBState.db.temperature).toBe(0.9)
    expect(DBState.db.maxResponse).toBe(450)
    expect(DBState.db.mainPrompt).toBe('story main')
    expect(DBState.db.jailbreak).toBe('story jailbreak')
    expect(DBState.db.globalNote).toBe('story global')
    expect(DBState.db.lastLoadedLoadoutName).toBe('Split Loadout')

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

  it('rolls back every applied loadout facet when one sequenced command fails', async () => {
    const loadout = seedApplyLoadoutState()
    const previousLoadouts = cloneJsonValue(DBState.db.loadouts)
    const previousPersonas = cloneJsonValue(DBState.db.personas)
    const previousBotPresets = cloneJsonValue(DBState.db.botPresets)
    const previousEnabledModules = cloneJsonValue(DBState.db.enabledModules)
    const previousGlobalVariables = cloneJsonValue(DBState.db.globalChatVariables)
    const calls = stubApplyLoadoutFetch({ failCommandNumber: 5 })
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setServerProjectionWriteGuardEnabled(true)

    applyLoadout(loadout)
    expect(DBState.db.selectedPersona).toBe(1)
    expect(DBState.db.botPresetsId).toBe(1)
    expect(DBState.db.enabledModules).toEqual(['module-a', 'module-stay'])
    expect(DBState.db.globalChatVariables).toEqual({ mood: 'focused', scene: 'night' })

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
    expect(DBState.db.loadouts).toEqual(previousLoadouts)
    expect(DBState.db.lastLoadedLoadoutName).toBe('Before Loadout')
    expect(DBState.db.personas).toEqual(previousPersonas)
    expect(DBState.db.selectedPersona).toBe(0)
    expect(DBState.db.username).toBe('Live User')
    expect(DBState.db.userIcon).toBe('live-icon')
    expect(DBState.db.personaPrompt).toBe('live persona prompt')
    expect(DBState.db.userNote).toBe('live user note')
    expect(DBState.db.botPresets).toEqual(previousBotPresets)
    expect(DBState.db.botPresetsId).toBe(0)
    expect(DBState.db.mainPrompt).toBe('live main')
    expect(DBState.db.temperature).toBe(20)
    expect(DBState.db.enabledModules).toEqual(previousEnabledModules)
    expect(DBState.db.globalChatVariables).toEqual(previousGlobalVariables)
  })

  it('applies a subset of facets without mutating or commanding skipped facets', async () => {
    const loadout = seedApplyLoadoutState()
    const calls = stubApplyLoadoutFetch()
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setServerProjectionWriteGuardEnabled(true)

    applyLoadout(loadout, ['modules'])

    expect(DBState.db.selectedPersona).toBe(0)
    expect(DBState.db.username).toBe('Live User')
    expect(DBState.db.botPresetsId).toBe(0)
    expect(DBState.db.mainPrompt).toBe('live main')
    expect(DBState.db.globalChatVariables).toEqual({ mood: 'calm', kept: 'yes' })
    expect(DBState.db.enabledModules).toEqual(['module-a', 'module-stay'])
    expect(DBState.db.lastLoadedLoadoutName).toBe('Battle Loadout')
    expect(DBState.db.loadouts[0]).toMatchObject({
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
    DBState.db.botPresets[1] = {
      id: 'preset-b',
      name: 'Preset B',
    } as never
    const calls = stubApplyLoadoutFetch({
      projectionPreset: {
        id: 'preset-b',
        name: 'Preset B',
        mainPrompt: 'hydrated preset-b main',
        promptTemplate: [],
      },
    })
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setServerProjectionWriteGuardEnabled(true)

    applyLoadout(loadout, ['preset'])

    expect(DBState.db.botPresetsId).toBe(1)
    expect(DBState.db.mainPrompt).toBe('live main')

    await waitForCallCount(calls, 4)
    await flushCommandEffects()

    expect(calls.map((call) => call.url)).toContain('/api/v1/projection/preset?id=preset-b')
    expect(calls.map((call) => call.url)).toContain('/api/v1/commands/presets/select')
    expect(calls.map((call) => call.url)).toContain('/api/v1/commands/loadouts/loadout-a/touch')
    expect(DBState.db.mainPrompt).toBe('hydrated preset-b main')
  })

  it('suppresses PersonaSettings watcher echo for loadout-driven persona selection', async () => {
    const loadout = seedApplyLoadoutState()
    const calls = stubApplyLoadoutFetch()
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    setServerProjectionWriteGuardEnabled(true)

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

  it('toggles favorite projection, dispatches the favorite command, and rolls back on failure', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    const previousLoadouts = cloneJsonValue(DBState.db.loadouts)
    setServerProjectionWriteGuardEnabled(true)

    expect(() => {
      DBState.db.loadouts[0].favorite = true
    }).toThrow()

    expect(toggleLoadoutFavorite('loadout-a')).toBe(true)
    expect(DBState.db.loadouts[0].favorite).toBe(true)

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
    expect(DBState.db.loadouts).toEqual(previousLoadouts)
    expect(DBState.db.lastLoadedLoadoutName).toBe('Loadout A')
  })

  it('removes the deleted loadout projection, dispatches the delete command, and rolls back on failure', async () => {
    const calls = stubCommandFetch({ failCommands: true })
    const previousLoadouts = cloneJsonValue(DBState.db.loadouts)
    setServerProjectionWriteGuardEnabled(true)

    expect(deleteLoadout('loadout-b')).toBe(true)
    expect(DBState.db.loadouts.map((loadout) => loadout.id)).toEqual(['loadout-a'])

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
    expect(DBState.db.loadouts).toEqual(previousLoadouts)
    expect(DBState.db.lastLoadedLoadoutName).toBe('Loadout A')
  })

  it('returns false for missing ids without dispatching commands or mutating loadouts', () => {
    const calls = stubCommandFetch()
    const previousLoadouts = cloneJsonValue(DBState.db.loadouts)
    setServerProjectionWriteGuardEnabled(true)

    expect(toggleLoadoutFavorite('missing-loadout')).toBe(false)
    expect(deleteLoadout('missing-loadout')).toBe(false)

    expect(calls).toHaveLength(0)
    expect(DBState.db.loadouts).toEqual(previousLoadouts)
  })
})
