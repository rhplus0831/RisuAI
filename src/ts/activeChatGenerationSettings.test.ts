import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./platform', async (importActual) => {
  const actual = await importActual<typeof import('./platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'active-chat-generation-settings-token',
}))

import { clearCachedServerCommandRevision } from './server/commands'
import { setResourceWriteGuardEnabled } from './server/resourceWriteGuard.svelte'
import { getResourceDatabase, replaceResourceDatabase } from './server/resourceState.svelte'
import type { Database } from './storage/database.svelte'
import { selectedCharID } from './stores.svelte'
import {
  activeChatModelPresetRecommendationState,
  createActiveChatGenerationSettingsPatch,
  createActiveChatGenerationSettingsDefaultValuesPatch,
  createActiveChatGenerationSettingsSelectionPatch,
  createActiveChatPersonaSelectionPatch,
  createManualModelPresetSelection,
  createPromptPresetSelection,
  fillMissingActiveChatSidebarToggleDefaults,
  guardActiveChatGenerationSettingsForSend,
  resolveActiveChatGenerationSettings,
  saveActiveChatGenerationSettings,
  saveActiveChatGenerationSettingsDefaultValues,
  saveActiveChatGenerationSettingsPatch,
  saveActiveChatGenerationSettingsSelection,
} from './activeChatGenerationSettings'
import { captureActiveChatTarget } from './chatCommands'

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

function clonePlain<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function stubCommandFetch(): CapturedFetch[] {
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

      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 100 })
      if (url.endsWith('/generation-settings')) {
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : {}
        return jsonResponse({
          revision: 101,
          event: {
            type: 'chat.updated',
            revision: 101,
            resource: 'characterRow',
            id: 'chat-a',
            parentId: 'char-a',
          },
          chatId: 'chat-a',
          characterId: 'char-a',
          certificate: 'chat-generation-settings-sparse-v1',
          patchedKeys: Object.keys(body.patch ?? {}).sort(),
          deletedKeys: [...(body.deleteKeys ?? [])].sort(),
          sidebarTogglePatchedKeys: Object.keys(body.patch?.sidebarToggles ?? {}).sort(),
          sidebarToggleDeletedKeys: [...(body.sidebarToggleDeleteKeys ?? [])].sort(),
          prunedSidebarToggleKeys: [],
        } satisfies Record<string, unknown>)
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

function seedDb(): void {
  selectedCharID.set(0)
  testDatabaseState.db = {
    personas: [
      { id: 'persona-a', name: 'Persona A', personaPrompt: '', icon: '', note: '' },
      { id: 'persona-b', name: 'Persona B', personaPrompt: '', icon: '', note: '' },
    ],
    modelPresets: [{ id: 'model-preset-a', name: 'Model Preset A' }],
    agentPresets: [{ id: 'agent-preset-a', name: 'Agent Preset A' }],
    promptPresets: [
      {
        id: 'preset-a',
        name: 'Preset A',
        jailbreak: 'Jailbreak',
        customPromptTemplateToggle: 'mode=Mode=select=warm,cold',
        moduleIntergration: 'preset-integrated-space',
      },
      {
        id: 'preset-b',
        name: 'Preset B',
        jailbreak: '',
        customPromptTemplateToggle: '',
      },
    ],
    modules: [
      { id: 'global-module', customModuleToggle: 'global=Global module' },
      { id: 'chat-module', customModuleToggle: 'chat=Chat module' },
      { id: 'character-module', customModuleToggle: 'character=Character module' },
      {
        id: 'integrated-module',
        namespace: 'preset-integrated-space',
        customModuleToggle: 'integrated=Integrated module',
      },
      {
        id: 'global-integrated-module',
        namespace: 'global-integrated-space',
        customModuleToggle: 'globalIntegrated=Global integrated module',
      },
      { id: 'inactive-module', customModuleToggle: 'inactive=Inactive module' },
    ],
    enabledModules: ['global-module'],
    moduleIntergration: 'global-integrated-space',
    characters: [
      {
        chaId: 'char-a',
        name: 'Character A',
        modules: ['character-module'],
        chatPage: 0,
        chats: [
          {
            id: 'chat-a',
            name: 'Chat A',
            note: '',
            message: [],
            localLore: [],
            modules: ['chat-module'],
          },
          {
            id: 'chat-b',
            name: 'Chat B',
            note: '',
            message: [],
            localLore: [],
            generationSettings: {
              configured: true,
              personaId: 'persona-b',
              modelPresetId: 'model-preset-a',
              promptPresetId: 'preset-b',
              jailbreakToggle: false,
              sidebarToggles: {},
            },
          },
        ],
      },
    ],
  } as any
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  setResourceWriteGuardEnabled(false)
  seedDb()
})

afterEach(() => {
  setResourceWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('active chat generation settings helper', () => {
  it('auto-applies a prompt recommendation until the chat has a manual model selection', () => {
    testDatabaseState.db.modelPresets.push({ id: 'model-preset-b', name: 'Model Preset B' } as never)
    testDatabaseState.db.promptPresets[0].recommendedModelPresetId = 'model-preset-b'
    testDatabaseState.db.characters[0].chats[0].generationSettings = {
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-b',
    }

    let state = resolveActiveChatGenerationSettings()
    expect(createPromptPresetSelection('preset-a', testDatabaseState.db.promptPresets[0], state)).toEqual({
      promptPresetId: 'preset-a',
      modelPresetId: 'model-preset-b',
      modelPresetSelectionSource: 'prompt-recommendation',
    })

    testDatabaseState.db.characters[0].chats[0].generationSettings = {
      ...testDatabaseState.db.characters[0].chats[0].generationSettings,
      ...createManualModelPresetSelection('model-preset-a'),
    }
    state = resolveActiveChatGenerationSettings()
    expect(createPromptPresetSelection('preset-a', testDatabaseState.db.promptPresets[0], state)).toEqual({
      promptPresetId: 'preset-a',
    })
  })

  it('reports matched and mismatched prompt recommendations but ignores stale references', () => {
    testDatabaseState.db.modelPresets.push({ id: 'model-preset-b', name: 'Model Preset B' } as never)
    testDatabaseState.db.promptPresets[0].recommendedModelPresetId = 'model-preset-b'
    testDatabaseState.db.characters[0].chats[0].generationSettings = {
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
    }

    expect(activeChatModelPresetRecommendationState()).toBe('mismatch')
    testDatabaseState.db.characters[0].chats[0].generationSettings.modelPresetId = 'model-preset-b'
    expect(activeChatModelPresetRecommendationState()).toBe('matched')
    testDatabaseState.db.promptPresets[0].recommendedModelPresetId = 'missing-model'
    expect(activeChatModelPresetRecommendationState()).toBe('none')
  })

  it('resolves unconfigured active-chat state, required toggles, and missing labels', () => {
    testDatabaseState.db.characters[0].chats[0].generationSettings = {
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
      sidebarToggles: {},
    }

    const state = resolveActiveChatGenerationSettings()

    expect(state.identity).toMatchObject({
      selectedCharIndex: 0,
      characterIndex: 0,
      chatIndex: 0,
      characterId: 'char-a',
      chatId: 'chat-a',
    })
    expect(state.persona).toMatchObject({ id: 'persona-a' })
    expect(state.promptPreset).toMatchObject({ id: 'preset-a' })
    expect(state.readiness.ready).toBe(false)
    expect(state.requiredSidebarToggles.map((toggle) => toggle.key)).toEqual([
      'mode',
      'global',
      'chat',
      'character',
      'integrated',
    ])
    expect(state.missingLabels).toEqual([
      'Configuration confirmation',
      'Jailbreak toggle',
      'Mode',
      'Global module',
      'Chat module',
      'Character module',
      'Integrated module',
    ])
  })

  it('resolves preset toggles from bootstrap-shaped preset stubs without global fallback', () => {
    testDatabaseState.db.customPromptTemplateToggle = 'fallback=Fallback'
    testDatabaseState.db.promptPresets = [
      {
        id: 'preset-a',
        name: 'Preset A',
        image: 'preset-a.png',
        customPromptTemplateToggle: 'mode=Mode=select=warm,cold',
        moduleIntergration: 'preset-integrated-space',
      },
    ] as any
    testDatabaseState.db.characters[0].chats[0].generationSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {
        mode: '1',
        global: '0',
        chat: '0',
        character: '0',
        integrated: '1',
      },
    }

    const state = resolveActiveChatGenerationSettings()

    expect(state.readiness.ready).toBe(true)
    expect(state.requiredSidebarToggles.map((toggle) => toggle.key)).toEqual([
      'mode',
      'global',
      'chat',
      'character',
      'integrated',
    ])
    expect(state.requiredSidebarToggles.map((toggle) => toggle.key)).not.toContain('fallback')
    expect(state.requiredSidebarToggles.map((toggle) => toggle.key)).not.toContain('globalIntegrated')
  })

  it('returns a stable guard error with active-chat missing labels', () => {
    testDatabaseState.db.characters[0].chats[0].generationSettings = {
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
      sidebarToggles: {},
    }

    const guard = guardActiveChatGenerationSettingsForSend()

    expect(guard.status).toBe('error')
    if (guard.status === 'error') {
      expect(guard.error).toBe(
        'Chat generation settings are incomplete. Missing: Configuration confirmation, Jailbreak toggle, Mode, Global module, Chat module, Character module, Integrated module.',
      )
    }
  })

  it('blocks send when deleted preset and persona ids remain on the active chat', () => {
    testDatabaseState.db.selectedPersona = 0
    testDatabaseState.db.promptPresetsId = 0
    testDatabaseState.db.characters[0].chats[0].generationSettings = {
      configured: true,
      personaId: 'deleted-persona',
      modelPresetId: 'deleted-model',
      promptPresetId: 'deleted-preset',
      agentPresetId: 'deleted-agent-preset',
      jailbreakToggle: false,
      sidebarToggles: {
        global: '1',
        chat: '1',
        character: '1',
      },
    }

    const state = resolveActiveChatGenerationSettings()

    expect(state.persona).toBeUndefined()
    expect(state.promptPreset).toBeUndefined()
    expect(state.readiness.ready).toBe(false)
    expect(state.readiness.missing).toEqual([
      {
        code: 'persona_missing',
        field: 'generationSettings.personaId',
        personaId: 'deleted-persona',
      },
      {
        code: 'model_preset_missing',
        field: 'generationSettings.modelPresetId',
        modelPresetId: 'deleted-model',
      },
      {
        code: 'prompt_preset_missing',
        field: 'generationSettings.promptPresetId',
        promptPresetId: 'deleted-preset',
      },
      {
        code: 'agent_preset_missing',
        field: 'generationSettings.agentPresetId',
        agentPresetId: 'deleted-agent-preset',
      },
    ])
    expect(state.missingLabels).toEqual(['Persona', 'Model preset', 'Prompt preset', 'Agent preset'])

    const guard = guardActiveChatGenerationSettingsForSend(state)

    expect(guard.status).toBe('error')
    if (guard.status === 'error') {
      expect(guard.error).toBe(
        'Chat generation settings are incomplete. Missing: Persona, Model preset, Prompt preset, Agent preset.',
      )
    }
    expect(testDatabaseState.db.characters[0].chats[0].generationSettings).toMatchObject({
      personaId: 'deleted-persona',
      modelPresetId: 'deleted-model',
      promptPresetId: 'deleted-preset',
      agentPresetId: 'deleted-agent-preset',
    })
    expect(testDatabaseState.db.selectedPersona).toBe(0)
    expect(testDatabaseState.db.promptPresetsId).toBe(0)
  })

  it('fails closed when the active chat prompt owner is duplicated', () => {
    testDatabaseState.db.promptPresets = [
      { id: 'preset-a', name: 'Preset A' },
      { id: 'preset-a', name: 'Duplicate Preset A' },
    ] as any
    testDatabaseState.db.characters[0].chats[0].generationSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {},
    }

    const state = resolveActiveChatGenerationSettings()

    expect(state.promptPreset).toBeUndefined()
  })

  it('ignores global moduleIntergration when the selected preset does not link integrated modules', () => {
    testDatabaseState.db.characters[0].chats[0].generationSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-b',
      jailbreakToggle: false,
      sidebarToggles: {
        global: '1',
        chat: '1',
        character: '1',
        integrated: '1',
        globalIntegrated: '1',
      },
    }

    const state = resolveActiveChatGenerationSettings()
    const requiredKeys = state.requiredSidebarToggles.map((toggle) => toggle.key)

    expect(testDatabaseState.db.moduleIntergration).toBe('global-integrated-space')
    expect(requiredKeys).toEqual(['global', 'chat', 'character'])
    expect(requiredKeys).not.toContain('globalIntegrated')
    expect(state.staleSidebarToggleKeys).toEqual(['integrated', 'globalIntegrated'])

    expect(
      createActiveChatGenerationSettingsPatch({
        sidebarToggles: {
          global: '0',
        },
      }).sidebarToggles,
    ).toEqual({
      global: '0',
      chat: '1',
      character: '1',
    })
  })

  it('saves first-time persona/preset selections with an explicit jailbreak toggle off', async () => {
    testDatabaseState.db.personas[0].modules = ['persona-module']
    testDatabaseState.db.modules.push({
      id: 'persona-module',
      customModuleToggle: 'persona=Persona module',
    } as never)
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    const nextSettings = createActiveChatGenerationSettingsSelectionPatch({
      personaId: 'persona-a',
      promptPresetId: 'preset-b',
    })
    expect(nextSettings).toEqual({
      configured: true,
      personaId: 'persona-a',
      promptPresetId: 'preset-b',
      jailbreakToggle: false,
      sidebarToggles: {
        global: '0',
        chat: '0',
        character: '0',
        persona: '0',
      },
    })

    expect(
      saveActiveChatGenerationSettingsSelection({
        personaId: 'persona-a',
        promptPresetId: 'preset-b',
      }),
    ).toBe(true)

    await waitForCallCount(calls, 2)
    expect(testDatabaseState.db.characters[0].chats[0].generationSettings).toEqual(nextSettings)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      body: {
        baseRevision: 100,
        patch: nextSettings,
      },
    })
  })

  it('clears only the authoritative persona id when unbinding a configured chat', () => {
    testDatabaseState.db.characters[0].chats[0].generationSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {
        mode: 'warm',
        global: '1',
        chat: '1',
        character: '1',
        integrated: '1',
      },
    }

    expect(createActiveChatPersonaSelectionPatch(null)).toEqual({
      configured: true,
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {
        mode: 'warm',
        global: '1',
        chat: '1',
        character: '1',
        integrated: '1',
      },
    })
  })

  it('prefills missing sidebar toggle defaults when selecting a preset', async () => {
    testDatabaseState.db.globalChatVariables = {
      toggle_mode: '1',
      toggle_global: '1',
    } as any
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    const nextSettings = createActiveChatGenerationSettingsSelectionPatch({
      promptPresetId: 'preset-a',
    })
    expect(nextSettings).toEqual({
      configured: true,
      promptPresetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {
        mode: '0',
        global: '0',
        chat: '0',
        character: '0',
        integrated: '0',
      },
    })
    expect(
      resolveActiveChatGenerationSettings({
        db: {
          ...testDatabaseState.db,
          characters: [
            {
              ...testDatabaseState.db.characters[0],
              chats: [
                {
                  ...testDatabaseState.db.characters[0].chats[0],
                  generationSettings: nextSettings,
                },
              ],
            },
          ],
        } as any,
        selectedCharIndex: 0,
      }).readiness.missing.map((reason) => reason.code),
    ).not.toContain('sidebar_toggle_missing')

    expect(
      saveActiveChatGenerationSettingsSelection({
        promptPresetId: 'preset-a',
      }),
    ).toBe(true)

    await waitForCallCount(calls, 2)
    expect(testDatabaseState.db.characters[0].chats[0].generationSettings).toEqual(nextSettings)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      body: {
        baseRevision: 100,
        patch: nextSettings,
      },
    })
  })

  it('fills missing active sidebar toggle defaults without resetting existing values', () => {
    testDatabaseState.db.modules.push({
      id: 'new-chat-module',
      customModuleToggle: [
        'newFlag=New flag',
        'newMode=New mode=select=alpha,beta',
        'newNote=New note=text',
        'newMemo=New memo=textarea',
      ].join('\n'),
    } as any)
    testDatabaseState.db.characters[0].chats[0].modules = ['chat-module', 'new-chat-module']
    testDatabaseState.db.characters[0].chats[0].generationSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-b',
      jailbreakToggle: false,
      sidebarToggles: {
        global: '1',
        chat: 'custom-chat-value',
        character: '1',
        newMode: '1',
      },
    }

    const nextSettings = fillMissingActiveChatSidebarToggleDefaults()

    expect(nextSettings).toEqual({
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-b',
      jailbreakToggle: false,
      sidebarToggles: {
        global: '1',
        chat: 'custom-chat-value',
        character: '1',
        newMode: '1',
        newFlag: '0',
        newNote: '',
        newMemo: '',
      },
    })

    const state = resolveActiveChatGenerationSettings({
      db: {
        ...testDatabaseState.db,
        characters: [
          {
            ...testDatabaseState.db.characters[0],
            chats: [
              {
                ...testDatabaseState.db.characters[0].chats[0],
                generationSettings: nextSettings,
              },
            ],
          },
        ],
      } as any,
      selectedCharIndex: 0,
    })
    expect(state.readiness.missing.map((reason) => reason.code)).not.toContain('sidebar_toggle_missing')
  })

  it('automatically saves defaults when active toggle requirements gain new keys', async () => {
    testDatabaseState.db.characters[0].chats[0].generationSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-b',
      jailbreakToggle: false,
      sidebarToggles: {
        global: '1',
        chat: 'custom-chat-value',
        character: '0',
      },
    }
    testDatabaseState.db.promptPresets[1].customPromptTemplateToggle = [
      'newFlag=New flag',
      'newMode=New mode=select=alpha,beta',
      'newNote=New note=text',
      'newMemo=New memo=textarea',
    ].join('\n')
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    const state = resolveActiveChatGenerationSettings()
    expect(state.readiness.missing.map((reason) => reason.code)).toContain('sidebar_toggle_missing')
    expect(guardActiveChatGenerationSettingsForSend(state).status).toBe('ok')

    const expectedSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-b',
      jailbreakToggle: false,
      sidebarToggles: {
        global: '1',
        chat: 'custom-chat-value',
        character: '0',
        newFlag: '0',
        newMode: '0',
        newNote: '',
        newMemo: '',
      },
    }
    expect(testDatabaseState.db.characters[0].chats[0].generationSettings).toEqual(expectedSettings)

    await waitForCallCount(calls, 2)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      body: {
        baseRevision: 100,
        patch: {
          sidebarToggles: {
            newFlag: '0',
            newMemo: '',
            newMode: '0',
            newNote: '',
          },
        },
      },
    })
  })

  it('resets active-chat toggle values to defaults', async () => {
    testDatabaseState.db.promptPresets[0].customPromptTemplateToggle =
      'mode=Mode=select=warm,cold\nflag=Flag\nnote=Note=text\nmemo=Memo=textarea'
    testDatabaseState.db.characters[0].chats[0].generationSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: true,
      sidebarToggles: {
        mode: '',
        flag: '1',
        note: 'old note',
        memo: 'old memo',
        global: '1',
        chat: '',
        character: '1',
        integrated: '1',
        stale: '1',
      },
    }
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    const nextSettings = createActiveChatGenerationSettingsDefaultValuesPatch()
    expect(nextSettings).toEqual({
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {
        mode: '0',
        flag: '0',
        note: '',
        memo: '',
        global: '0',
        chat: '0',
        character: '0',
        integrated: '0',
      },
    })

    expect(saveActiveChatGenerationSettingsDefaultValues()).toBe(true)

    await waitForCallCount(calls, 2)
    expect(testDatabaseState.db.characters[0].chats[0].generationSettings).toEqual(nextSettings)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      body: {
        baseRevision: 100,
        patch: {
          jailbreakToggle: false,
          sidebarToggles: nextSettings.sidebarToggles,
        },
        sidebarToggleDeleteKeys: ['stale'],
      },
    })
  })

  it('normalizes direct full saves with an explicit jailbreak toggle off', async () => {
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    expect(
      saveActiveChatGenerationSettings({
        personaId: 'persona-a',
        modelPresetId: 'model-preset-a',
        promptPresetId: 'preset-b',
      }),
    ).toBe(true)

    await waitForCallCount(calls, 2)
    const nextSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-b',
      jailbreakToggle: false,
      sidebarToggles: {
        global: '0',
        chat: '0',
        character: '0',
      },
    }
    expect(testDatabaseState.db.characters[0].chats[0].generationSettings).toEqual(nextSettings)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      body: {
        baseRevision: 100,
        patch: nextSettings,
      },
    })
  })

  it('creates and saves configured persona/preset selections by id', async () => {
    testDatabaseState.db.characters[0].chats[0].generationSettings = {
      jailbreakToggle: false,
      sidebarToggles: {
        mode: 'warm',
        global: '1',
        chat: '0',
        character: '1',
        integrated: '0',
      },
    }
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    const nextSettings = createActiveChatGenerationSettingsSelectionPatch({
      personaId: 'persona-b',
      promptPresetId: 'preset-a',
    })
    expect(nextSettings).toEqual({
      configured: true,
      personaId: 'persona-b',
      promptPresetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {
        mode: 'warm',
        global: '1',
        chat: '0',
        character: '1',
        integrated: '0',
      },
    })

    expect(
      saveActiveChatGenerationSettingsSelection({
        personaId: 'persona-b',
        promptPresetId: 'preset-a',
      }),
    ).toBe(true)

    await waitForCallCount(calls, 2)
    expect(testDatabaseState.db.characters[0].chats[0].generationSettings).toEqual(nextSettings)
    expect(calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'active-chat-generation-settings-token',
        body: null,
      },
      {
        url: '/api/v1/commands/chats/chat-a/generation-settings',
        method: 'PUT',
        authHeader: 'active-chat-generation-settings-token',
        body: {
          baseRevision: 100,
          baseGenerationSettingsDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          patch: {
            configured: true,
            personaId: 'persona-b',
            promptPresetId: 'preset-a',
          },
        },
      },
    ])
  })

  it('preserves existing fields and prunes stale sidebar toggle keys on toggle saves', async () => {
    testDatabaseState.db.characters[0].chats[0].generationSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: true,
      sidebarToggles: {
        mode: 'warm',
        global: '1',
        chat: '1',
        character: '1',
        integrated: '1',
        stale: 'remove-me',
      },
    }
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    const before = resolveActiveChatGenerationSettings()
    expect(before.staleSidebarToggleKeys).toEqual(['stale'])

    const nextSettings = createActiveChatGenerationSettingsPatch({
      jailbreakToggle: false,
      sidebarToggles: {
        mode: 'cold',
      },
    })
    expect(nextSettings).toEqual({
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {
        mode: 'cold',
        global: '1',
        chat: '1',
        character: '1',
        integrated: '1',
      },
    })

    expect(
      saveActiveChatGenerationSettingsPatch({
        jailbreakToggle: false,
        sidebarToggles: {
          mode: 'cold',
        },
      }),
    ).toBe(true)

    await waitForCallCount(calls, 2)
    expect(testDatabaseState.db.characters[0].chats[0].generationSettings).toEqual(nextSettings)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      body: {
        baseRevision: 100,
        patch: {
          jailbreakToggle: false,
          sidebarToggles: { mode: 'cold' },
        },
        sidebarToggleDeleteKeys: ['stale'],
      },
    })
  })

  it('resolves different settings when the active chat switches', () => {
    testDatabaseState.db.characters[0].chats[0].generationSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: true,
      sidebarToggles: {
        mode: 'warm',
        global: '1',
        chat: '1',
        character: '1',
        integrated: '1',
      },
    }

    expect(resolveActiveChatGenerationSettings()).toMatchObject({
      identity: { chatId: 'chat-a' },
      settings: { personaId: 'persona-a', promptPresetId: 'preset-a' },
      persona: { id: 'persona-a' },
      promptPreset: { id: 'preset-a' },
    })

    testDatabaseState.db.characters[0].chatPage = 1

    expect(resolveActiveChatGenerationSettings()).toMatchObject({
      identity: { chatId: 'chat-b' },
      settings: { personaId: 'persona-b', promptPresetId: 'preset-b' },
      persona: { id: 'persona-b' },
      promptPreset: { id: 'preset-b' },
    })
  })

  it('does not dispatch or save when the active chat has no id', () => {
    delete testDatabaseState.db.characters[0].chats[0].id
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    expect(
      saveActiveChatGenerationSettingsPatch({
        personaId: 'persona-a',
        modelPresetId: 'model-preset-a',
        promptPresetId: 'preset-a',
        jailbreakToggle: false,
        sidebarToggles: {
          mode: 'warm',
          global: '1',
          chat: '1',
          character: '1',
          integrated: '1',
        },
      }),
    ).toBe(false)

    expect(calls).toEqual([])
    expect(testDatabaseState.db.characters[0].chats[0].generationSettings).toBeUndefined()
  })

  it('returns false without resolving, mutating, or fetching when expected target is stale', () => {
    testDatabaseState.db.characters[0].chats[0].generationSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: true,
      sidebarToggles: {
        mode: 'warm',
        global: '1',
        chat: '1',
        character: '1',
        integrated: '1',
      },
    }
    const target = captureActiveChatTarget()
    const chatASettings = clonePlain(testDatabaseState.db.characters[0].chats[0].generationSettings)
    const chatBSettings = clonePlain(testDatabaseState.db.characters[0].chats[1].generationSettings)
    const calls = stubCommandFetch()

    testDatabaseState.db.characters[0].chatPage = 1
    setResourceWriteGuardEnabled(true)

    expect(
      saveActiveChatGenerationSettingsSelection(
        {
          personaId: 'persona-b',
        },
        { expectedTarget: target },
      ),
    ).toBe(false)
    expect(
      saveActiveChatGenerationSettingsPatch(
        {
          jailbreakToggle: false,
        },
        { expectedTarget: target },
      ),
    ).toBe(false)
    expect(
      saveActiveChatGenerationSettings(
        {
          personaId: 'persona-b',
          modelPresetId: 'model-preset-a',
          promptPresetId: 'preset-b',
        },
        { expectedTarget: target },
      ),
    ).toBe(false)
    expect(saveActiveChatGenerationSettingsDefaultValues({ expectedTarget: target })).toBe(false)

    expect(calls).toEqual([])
    expect(testDatabaseState.db.characters[0].chats[0].generationSettings).toEqual(chatASettings)
    expect(testDatabaseState.db.characters[0].chats[1].generationSettings).toEqual(chatBSettings)
  })
})
