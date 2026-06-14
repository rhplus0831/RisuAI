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

import { clearCachedServerCommandRevision, type ServerCommandResult } from './server/commands'
import { setServerProjectionWriteGuardEnabled } from './server/projectionWriteGuard.svelte'
import { DBState, selectedCharID } from './stores.svelte'
import {
  createActiveChatGenerationSettingsPatch,
  createActiveChatGenerationSettingsDefaultValuesPatch,
  createActiveChatGenerationSettingsSelectionPatch,
  guardActiveChatGenerationSettingsForSend,
  resolveActiveChatGenerationSettings,
  saveActiveChatGenerationSettings,
  saveActiveChatGenerationSettingsDefaultValues,
  saveActiveChatGenerationSettingsPatch,
  saveActiveChatGenerationSettingsSelection,
} from './activeChatGenerationSettings'

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
        return jsonResponse({
          status: 'ok',
          revision: 101,
          event: {
            type: 'chat.updated',
            revision: 101,
            resource: 'characterRow',
            id: 'chat-a',
          },
          chatId: 'chat-a',
        } satisfies ServerCommandResult<{ chatId: string }> & Record<string, unknown>)
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
  DBState.db = {
    personas: [
      { id: 'persona-a', name: 'Persona A', personaPrompt: '', icon: '', note: '' },
      { id: 'persona-b', name: 'Persona B', personaPrompt: '', icon: '', note: '' },
    ],
    botPresets: [
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
              presetId: 'preset-b',
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
  setServerProjectionWriteGuardEnabled(false)
  seedDb()
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('active chat generation settings helper', () => {
  it('resolves unconfigured active-chat state, required toggles, and missing labels', () => {
    DBState.db.characters[0].chats[0].generationSettings = {
      personaId: 'persona-a',
      presetId: 'preset-a',
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
    expect(state.preset).toMatchObject({ id: 'preset-a' })
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
    DBState.db.customPromptTemplateToggle = 'fallback=Fallback'
    DBState.db.botPresets = [
      {
        id: 'preset-a',
        name: 'Preset A',
        image: 'preset-a.png',
        customPromptTemplateToggle: 'mode=Mode=select=warm,cold',
        moduleIntergration: 'preset-integrated-space',
      },
    ] as any
    DBState.db.characters[0].chats[0].generationSettings = {
      configured: true,
      personaId: 'persona-a',
      presetId: 'preset-a',
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
    DBState.db.characters[0].chats[0].generationSettings = {
      personaId: 'persona-a',
      presetId: 'preset-a',
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
    DBState.db.selectedPersona = 0
    DBState.db.botPresetsId = 0
    DBState.db.characters[0].chats[0].generationSettings = {
      configured: true,
      personaId: 'deleted-persona',
      presetId: 'deleted-preset',
      jailbreakToggle: false,
      sidebarToggles: {
        global: '1',
        chat: '1',
        character: '1',
      },
    }

    const state = resolveActiveChatGenerationSettings()

    expect(state.persona).toBeUndefined()
    expect(state.preset).toBeUndefined()
    expect(state.readiness.ready).toBe(false)
    expect(state.readiness.missing).toEqual([
      {
        code: 'persona_missing',
        field: 'generationSettings.personaId',
        personaId: 'deleted-persona',
      },
      {
        code: 'preset_missing',
        field: 'generationSettings.presetId',
        presetId: 'deleted-preset',
      },
    ])
    expect(state.missingLabels).toEqual(['Persona', 'Preset'])

    const guard = guardActiveChatGenerationSettingsForSend(state)

    expect(guard.status).toBe('error')
    if (guard.status === 'error') {
      expect(guard.error).toBe('Chat generation settings are incomplete. Missing: Persona, Preset.')
    }
    expect(DBState.db.characters[0].chats[0].generationSettings).toMatchObject({
      personaId: 'deleted-persona',
      presetId: 'deleted-preset',
    })
    expect(DBState.db.selectedPersona).toBe(0)
    expect(DBState.db.botPresetsId).toBe(0)
  })

  it('ignores global moduleIntergration when the selected preset does not link integrated modules', () => {
    DBState.db.characters[0].chats[0].generationSettings = {
      configured: true,
      personaId: 'persona-a',
      presetId: 'preset-b',
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

    expect(DBState.db.moduleIntergration).toBe('global-integrated-space')
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
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    const nextSettings = createActiveChatGenerationSettingsSelectionPatch({
      personaId: 'persona-a',
      presetId: 'preset-b',
    })
    expect(nextSettings).toEqual({
      configured: true,
      personaId: 'persona-a',
      presetId: 'preset-b',
      jailbreakToggle: false,
      sidebarToggles: {
        global: '0',
        chat: '0',
        character: '0',
      },
    })

    expect(
      saveActiveChatGenerationSettingsSelection({
        personaId: 'persona-a',
        presetId: 'preset-b',
      }),
    ).toBe(true)

    await waitForCallCount(calls, 2)
    expect(DBState.db.characters[0].chats[0].generationSettings).toEqual(nextSettings)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      body: {
        baseRevision: 100,
        generationSettings: nextSettings,
      },
    })
  })

  it('prefills missing sidebar toggle defaults when selecting a preset', async () => {
    DBState.db.globalChatVariables = {
      toggle_mode: '1',
      toggle_global: '1',
    } as any
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    const nextSettings = createActiveChatGenerationSettingsSelectionPatch({
      presetId: 'preset-a',
    })
    expect(nextSettings).toEqual({
      configured: true,
      presetId: 'preset-a',
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
          ...DBState.db,
          characters: [
            {
              ...DBState.db.characters[0],
              chats: [
                {
                  ...DBState.db.characters[0].chats[0],
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
        presetId: 'preset-a',
      }),
    ).toBe(true)

    await waitForCallCount(calls, 2)
    expect(DBState.db.characters[0].chats[0].generationSettings).toEqual(nextSettings)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      body: {
        baseRevision: 100,
        generationSettings: nextSettings,
      },
    })
  })

  it('resets active-chat toggle values to defaults', async () => {
    DBState.db.botPresets[0].customPromptTemplateToggle =
      'mode=Mode=select=warm,cold\nflag=Flag\nnote=Note=text\nmemo=Memo=textarea'
    DBState.db.characters[0].chats[0].generationSettings = {
      configured: true,
      personaId: 'persona-a',
      presetId: 'preset-a',
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
    setServerProjectionWriteGuardEnabled(true)

    const nextSettings = createActiveChatGenerationSettingsDefaultValuesPatch()
    expect(nextSettings).toEqual({
      configured: true,
      personaId: 'persona-a',
      presetId: 'preset-a',
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
    expect(DBState.db.characters[0].chats[0].generationSettings).toEqual(nextSettings)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      body: {
        baseRevision: 100,
        generationSettings: nextSettings,
      },
    })
  })

  it('normalizes direct full saves with an explicit jailbreak toggle off', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    expect(
      saveActiveChatGenerationSettings({
        personaId: 'persona-a',
        presetId: 'preset-b',
      }),
    ).toBe(true)

    await waitForCallCount(calls, 2)
    const nextSettings = {
      configured: true,
      personaId: 'persona-a',
      presetId: 'preset-b',
      jailbreakToggle: false,
    }
    expect(DBState.db.characters[0].chats[0].generationSettings).toEqual(nextSettings)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      body: {
        baseRevision: 100,
        generationSettings: nextSettings,
      },
    })
  })

  it('creates and saves configured persona/preset selections by id', async () => {
    DBState.db.characters[0].chats[0].generationSettings = {
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
    setServerProjectionWriteGuardEnabled(true)

    const nextSettings = createActiveChatGenerationSettingsSelectionPatch({
      personaId: 'persona-b',
      presetId: 'preset-a',
    })
    expect(nextSettings).toEqual({
      configured: true,
      personaId: 'persona-b',
      presetId: 'preset-a',
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
        presetId: 'preset-a',
      }),
    ).toBe(true)

    await waitForCallCount(calls, 2)
    expect(DBState.db.characters[0].chats[0].generationSettings).toEqual(nextSettings)
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
          generationSettings: nextSettings,
        },
      },
    ])
  })

  it('preserves existing fields and prunes stale sidebar toggle keys on toggle saves', async () => {
    DBState.db.characters[0].chats[0].generationSettings = {
      configured: true,
      personaId: 'persona-a',
      presetId: 'preset-a',
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
    setServerProjectionWriteGuardEnabled(true)

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
      presetId: 'preset-a',
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
    expect(DBState.db.characters[0].chats[0].generationSettings).toEqual(nextSettings)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      body: {
        baseRevision: 100,
        generationSettings: nextSettings,
      },
    })
  })

  it('resolves different settings when the active chat switches', () => {
    DBState.db.characters[0].chats[0].generationSettings = {
      configured: true,
      personaId: 'persona-a',
      presetId: 'preset-a',
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
      settings: { personaId: 'persona-a', presetId: 'preset-a' },
      persona: { id: 'persona-a' },
      preset: { id: 'preset-a' },
    })

    DBState.db.characters[0].chatPage = 1

    expect(resolveActiveChatGenerationSettings()).toMatchObject({
      identity: { chatId: 'chat-b' },
      settings: { personaId: 'persona-b', presetId: 'preset-b' },
      persona: { id: 'persona-b' },
      preset: { id: 'preset-b' },
    })
  })

  it('does not dispatch or save when the active chat has no id', () => {
    delete DBState.db.characters[0].chats[0].id
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    expect(
      saveActiveChatGenerationSettingsPatch({
        personaId: 'persona-a',
        presetId: 'preset-a',
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
    expect(DBState.db.characters[0].chats[0].generationSettings).toBeUndefined()
  })
})
