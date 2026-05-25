import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const platformState = vi.hoisted(() => ({ isFastifyServer: true }))

vi.mock('../platform', async (importActual) => {
  const actual = await importActual<typeof import('../platform')>()
  return {
    ...actual,
    get isFastifyServer() {
      return platformState.isFastifyServer
    },
  }
})

vi.mock('../storage/nodeStorage', () => ({
  getNodeServerProxyAuth: async () => 'test-auth-token',
}))

import {
  canUseServerCommands,
  appendMessageCommand,
  createChatCommand,
  createChatFolderCommand,
  createCharacterCommand,
  createLoadoutCommand,
  createPersonaCommand,
  clearCachedServerCommandRevision,
  createPromptItemCommand,
  createPresetCommand,
  createTranslatorPresetCommand,
  createGlobalLorebookCommand,
  deleteChatCommand,
  deleteChatFolderCommand,
  deleteCharacterCommand,
  deleteGlobalLorebookCommand,
  deleteLoadoutCommand,
  deleteMessageCommand,
  deletePersonaCommand,
  deletePromptItemCommand,
  deleteTranslatorPresetCommand,
  favoriteLoadoutCommand,
  forkChatCommand,
  getServerCommandBaseRevision,
  patchPromptSettingsCommand,
  patchChatScriptstateCommand,
  patchServerBackedSettings,
  patchRuntimeSettings,
  patchSettingsGroup,
  persistGenerationResultCommand,
  reorderCharactersCommand,
  reorderChatFoldersCommand,
  reorderChatsCommand,
  reorderPersonasCommand,
  reorderGlobalLorebooksCommand,
  reorderPromptItemsCommand,
  reorderPresetsCommand,
  runServerCommand,
  runServerPresetCommand,
  replaceMessagesCommand,
  replaceCharacterScriptsCommand,
  replaceCharacterTriggersCommand,
  replaceCharacterLorebooksCommand,
  replaceChatLorebooksCommand,
  replaceGlobalLorebookEntriesCommand,
  replaceModuleLorebooksCommand,
  replaceModuleScriptsCommand,
  replaceModuleTriggersCommand,
  selectCharacterCommand,
  selectPersonaCommand,
  selectTranslatorPresetCommand,
  touchLoadoutCommand,
  truncateMessagesCommand,
  updateCharacterCommand,
  updateChatCommand,
  updateChatFolderCommand,
  updateGlobalLorebookCommand,
  updateLoadoutCommand,
  updateMessageCommand,
  updatePersonaCommand,
  updateTranslatorPresetCommand,
  selectPresetCommand,
  updatePromptItemCommand,
} from './commands'

interface CapturedFetch {
  url: string
  method: string
  authHeader: string | null
  contentType: string | null
  body: unknown
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeCommandFetch(bodyForUrl: (url: string, init: RequestInit) => unknown): {
  calls: CapturedFetch[]
  fetch: typeof fetch
} {
  const calls: CapturedFetch[] = []
  return {
    calls,
    fetch: vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = init.headers as Record<string, string> | undefined
      const rawBody = typeof init.body === 'string' ? JSON.parse(init.body) : null
      const url = String(input)
      calls.push({
        url,
        method: init.method ?? 'GET',
        authHeader: headers?.['risu-auth'] ?? null,
        contentType: headers?.['content-type'] ?? null,
        body: rawBody,
      })
      const body = bodyForUrl(url, init)
      return body instanceof Response ? body : jsonResponse(body)
    }) as unknown as typeof fetch,
  }
}

beforeEach(() => {
  platformState.isFastifyServer = true
  clearCachedServerCommandRevision()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('server command API adapter', () => {
  it('reports availability from the Fastify platform gate', () => {
    expect(canUseServerCommands()).toBe(true)
    platformState.isFastifyServer = false
    expect(canUseServerCommands()).toBe(false)
  })

  it('patches runtime settings with the auth header and baseRevision', async () => {
    const event = { type: 'settings.updated', revision: 2, resource: 'settings' }
    const commandFetch = makeCommandFetch(() => ({ revision: 2, event }))
    vi.stubGlobal('fetch', commandFetch.fetch)

    const result = await patchRuntimeSettings({
      baseRevision: 1,
      patch: { useServerPromptAssembly: true },
    })

    expect(result).toEqual({ status: 'ok', revision: 2, event })
    expect(commandFetch.calls).toEqual([
      {
        url: '/api/v1/commands/settings/runtime',
        method: 'PATCH',
        authHeader: 'test-auth-token',
        contentType: 'application/json',
        body: {
          baseRevision: 1,
          patch: { useServerPromptAssembly: true },
        },
      },
    ])
  })

  it('patches grouped scalar settings with the auth header and baseRevision', async () => {
    const event = { type: 'settings.updated', revision: 3, resource: 'settings' }
    const commandFetch = makeCommandFetch(() => ({ revision: 3, event }))
    vi.stubGlobal('fetch', commandFetch.fetch)

    const result = await patchSettingsGroup({
      group: 'display',
      baseRevision: 2,
      patch: { theme: 'light', zoomsize: 90 },
    })

    expect(result).toEqual({ status: 'ok', revision: 3, event })
    expect(commandFetch.calls).toEqual([
      {
        url: '/api/v1/commands/settings/display',
        method: 'PATCH',
        authHeader: 'test-auth-token',
        contentType: 'application/json',
        body: {
          baseRevision: 2,
          patch: { theme: 'light', zoomsize: 90 },
        },
      },
    ])
  })

  it('reads and caches the command base revision from bootstrap', async () => {
    const commandFetch = makeCommandFetch(() => ({ revision: 12 }))
    vi.stubGlobal('fetch', commandFetch.fetch)

    await expect(getServerCommandBaseRevision()).resolves.toBe(12)
    await expect(getServerCommandBaseRevision()).resolves.toBe(12)

    expect(commandFetch.calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'test-auth-token',
        contentType: null,
        body: null,
      },
    ])
  })

  it('maps revision conflicts to a typed conflict result', async () => {
    const commandFetch = makeCommandFetch(() =>
      jsonResponse({ error: 'revision_conflict', currentRevision: 7 }, 409),
    )
    vi.stubGlobal('fetch', commandFetch.fetch)

    const result = await patchRuntimeSettings({
      baseRevision: 6,
      patch: { useServerPromptAssembly: true },
    })

    expect(result).toEqual({ status: 'conflict', currentRevision: 7 })
  })

  it('maps command errors to status:error', async () => {
    const commandFetch = makeCommandFetch(() =>
      jsonResponse({ error: 'useServerPromptAssembly must be a boolean' }, 400),
    )
    vi.stubGlobal('fetch', commandFetch.fetch)

    const result = await patchRuntimeSettings({
      baseRevision: 1,
      patch: { useServerPromptAssembly: true },
    })

    expect(result).toEqual({
      status: 'error',
      error: 'useServerPromptAssembly must be a boolean',
    })
  })

  it('patches mixed server-backed settings by group with the latest revision', async () => {
    const commandFetch = makeCommandFetch((url) => {
      if (url === '/api/v1/bootstrap') return { revision: 10 }
      if (url.endsWith('/settings/providers')) {
        return {
          revision: 11,
          event: { type: 'settings.updated', revision: 11, resource: 'settings' },
        }
      }
      return {
        revision: 12,
        event: { type: 'settings.updated', revision: 12, resource: 'settings' },
      }
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    const result = await patchServerBackedSettings({
      patch: {
        aiModel: 'openrouter',
        maxContext: 12000,
      },
    })

    expect(result).toEqual({
      status: 'ok',
      revision: 12,
      event: { type: 'settings.updated', revision: 12, resource: 'settings' },
    })
    expect(commandFetch.calls.map((call) => ({ url: call.url, body: call.body }))).toEqual([
      {
        url: '/api/v1/bootstrap',
        body: null,
      },
      {
        url: '/api/v1/commands/settings/providers',
        body: {
          baseRevision: 10,
          patch: { aiModel: 'openrouter' },
        },
      },
      {
        url: '/api/v1/commands/settings/runtime',
        body: {
          baseRevision: 11,
          patch: { maxContext: 12000 },
        },
      },
    ])
  })

  it('retries a server-backed settings patch on conflict', async () => {
    let providerAttempts = 0
    const commandFetch = makeCommandFetch((url) => {
      if (url === '/api/v1/bootstrap') return { revision: 4 }
      if (url.endsWith('/settings/providers')) {
        providerAttempts += 1
        if (providerAttempts === 1) {
          return jsonResponse({ error: 'revision_conflict', currentRevision: 8 }, 409)
        }
        return {
          revision: 9,
          event: { type: 'settings.updated', revision: 9, resource: 'settings' },
        }
      }
      return { revision: 10 }
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    await expect(
      patchServerBackedSettings({
        patch: { openrouterKey: 'secret' },
      }),
    ).resolves.toEqual({
      status: 'ok',
      revision: 9,
      event: { type: 'settings.updated', revision: 9, resource: 'settings' },
    })

    expect(commandFetch.calls.map((call) => call.body)).toEqual([
      null,
      { baseRevision: 4, patch: { openrouterKey: 'secret' } },
      { baseRevision: 8, patch: { openrouterKey: 'secret' } },
    ])
  })

  it('rolls back optimistic settings when a server-backed patch fails', async () => {
    const rollback = vi.fn()
    const commandFetch = makeCommandFetch((url) => {
      if (url === '/api/v1/bootstrap') return { revision: 1 }
      return jsonResponse({ error: 'aiModel must be a string' }, 400)
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    const result = await patchServerBackedSettings({
      patch: { aiModel: 1 },
      rollback,
    })

    expect(result).toEqual({ status: 'error', error: 'aiModel must be a string' })
    expect(rollback).toHaveBeenCalledTimes(1)
  })

  it('does not fetch when server commands are unavailable', async () => {
    platformState.isFastifyServer = false
    const commandFetch = makeCommandFetch(() => ({ revision: 2 }))
    vi.stubGlobal('fetch', commandFetch.fetch)

    const result = await patchRuntimeSettings({
      baseRevision: 1,
      patch: { useServerPromptAssembly: true },
    })

    expect(result).toEqual({ status: 'unavailable' })
    expect(commandFetch.calls).toEqual([])
  })

  it('does not dispatch server-backed settings patches outside Fastify mode', async () => {
    platformState.isFastifyServer = false
    const rollback = vi.fn()
    const commandFetch = makeCommandFetch(() => ({ revision: 2 }))
    vi.stubGlobal('fetch', commandFetch.fetch)

    const result = await patchServerBackedSettings({
      patch: { aiModel: 'openrouter' },
      rollback,
    })

    expect(result).toEqual({ status: 'unavailable' })
    expect(rollback).not.toHaveBeenCalled()
    expect(commandFetch.calls).toEqual([])
  })

  it('creates presets through the typed command helper', async () => {
    const event = { type: 'preset.created', revision: 2, resource: 'preset', id: 'preset-a' }
    const commandFetch = makeCommandFetch(() => ({ revision: 2, event, presetId: 'preset-a' }))
    vi.stubGlobal('fetch', commandFetch.fetch)

    const result = await createPresetCommand({
      baseRevision: 1,
      preset: { id: 'preset-a', name: 'A', mainPrompt: 'hello' },
    })

    expect(result).toEqual({ status: 'ok', revision: 2, event, presetId: 'preset-a' })
    expect(commandFetch.calls).toEqual([
      {
        url: '/api/v1/commands/presets',
        method: 'POST',
        authHeader: 'test-auth-token',
        contentType: 'application/json',
        body: {
          baseRevision: 1,
          preset: { id: 'preset-a', name: 'A', mainPrompt: 'hello' },
        },
      },
    ])
  })

  it('selects and reorders presets through typed command helpers', async () => {
    const commandFetch = makeCommandFetch((url) => {
      if (url.endsWith('/presets/select')) {
        return {
          revision: 3,
          event: { type: 'preset.selected', revision: 3, resource: 'preset', id: 'preset-b' },
          presetId: 'preset-b',
        }
      }
      return {
        revision: 4,
        event: { type: 'preset.reordered', revision: 4, resource: 'preset' },
        selectedPresetId: 'preset-b',
      }
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    await expect(
      selectPresetCommand({
        baseRevision: 2,
        presetId: 'preset-b',
        apply: true,
        saveCurrent: true,
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 3, presetId: 'preset-b' })

    await expect(
      reorderPresetsCommand({
        baseRevision: 3,
        presetIds: ['preset-b', 'preset-a'],
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 4, selectedPresetId: 'preset-b' })

    expect(commandFetch.calls.map((call) => ({ url: call.url, body: call.body }))).toEqual([
      {
        url: '/api/v1/commands/presets/select',
        body: {
          baseRevision: 2,
          presetId: 'preset-b',
          apply: true,
          saveCurrent: true,
        },
      },
      {
        url: '/api/v1/commands/presets/reorder',
        body: {
          baseRevision: 3,
          presetIds: ['preset-b', 'preset-a'],
        },
      },
    ])
  })

  it('runs server preset commands with revision lookup and one conflict retry', async () => {
    let selectAttempts = 0
    const commandFetch = makeCommandFetch((url) => {
      if (url === '/api/v1/bootstrap') return { revision: 5 }
      selectAttempts += 1
      if (selectAttempts === 1) {
        return jsonResponse({ error: 'revision_conflict', currentRevision: 8 }, 409)
      }
      return {
        revision: 9,
        event: { type: 'preset.selected', revision: 9, resource: 'preset', id: 'preset-b' },
        presetId: 'preset-b',
      }
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    await expect(
      runServerPresetCommand({
        command: (baseRevision) =>
          selectPresetCommand({
            baseRevision,
            presetId: 'preset-b',
          }),
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 9, presetId: 'preset-b' })

    expect(commandFetch.calls.map((call) => call.body)).toEqual([
      null,
      { baseRevision: 5, presetId: 'preset-b' },
      { baseRevision: 8, presetId: 'preset-b' },
    ])
  })

  it('does not dispatch preset commands outside Fastify mode', async () => {
    platformState.isFastifyServer = false
    const rollback = vi.fn()
    const commandFetch = makeCommandFetch(() => ({ revision: 2 }))
    vi.stubGlobal('fetch', commandFetch.fetch)

    const result = await runServerPresetCommand({
      command: (baseRevision) =>
        selectPresetCommand({
          baseRevision,
          presetId: 'preset-b',
        }),
      rollback,
    })

    expect(result).toEqual({ status: 'unavailable' })
    expect(rollback).not.toHaveBeenCalled()
    expect(commandFetch.calls).toEqual([])
  })

  it('dispatches prompt settings and prompt item commands through typed helpers', async () => {
    const commandFetch = makeCommandFetch((url) => {
      if (url.endsWith('/prompt-settings')) {
        return {
          revision: 2,
          event: { type: 'prompt.settings.updated', revision: 2, resource: 'prompt' },
        }
      }
      if (url.endsWith('/prompt-items/reorder')) {
        return {
          revision: 6,
          event: { type: 'prompt.item.reordered', revision: 6, resource: 'promptItem' },
        }
      }
      if (url.endsWith('/prompt-items/item-a')) {
        return {
          revision: 5,
          event: { type: 'prompt.item.deleted', revision: 5, resource: 'promptItem', id: 'item-a' },
          itemId: 'item-a',
        }
      }
      if (url.endsWith('/prompt-items/item-b')) {
        return {
          revision: 4,
          event: { type: 'prompt.item.updated', revision: 4, resource: 'promptItem', id: 'item-b' },
          itemId: 'item-b',
        }
      }
      return {
        revision: 3,
        event: { type: 'prompt.item.created', revision: 3, resource: 'promptItem', id: 'item-b' },
        itemId: 'item-b',
      }
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    await expect(
      patchPromptSettingsCommand({
        baseRevision: 1,
        patch: { promptSettings: { sendName: true } },
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 2 })

    await expect(
      createPromptItemCommand({
        baseRevision: 2,
        promptItem: { id: 'item-b', type: 'memory' },
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 3, itemId: 'item-b' })

    await expect(
      updatePromptItemCommand({
        baseRevision: 3,
        itemId: 'item-b',
        patch: { type: 'description' },
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 4, itemId: 'item-b' })

    await expect(
      deletePromptItemCommand({
        baseRevision: 4,
        itemId: 'item-a',
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 5, itemId: 'item-a' })

    await expect(
      reorderPromptItemsCommand({
        baseRevision: 5,
        itemIds: ['item-b'],
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 6 })

    expect(
      commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body })),
    ).toEqual([
      {
        url: '/api/v1/commands/prompt-settings',
        method: 'PATCH',
        body: { baseRevision: 1, patch: { promptSettings: { sendName: true } } },
      },
      {
        url: '/api/v1/commands/prompt-items',
        method: 'POST',
        body: { baseRevision: 2, promptItem: { id: 'item-b', type: 'memory' } },
      },
      {
        url: '/api/v1/commands/prompt-items/item-b',
        method: 'PATCH',
        body: { baseRevision: 3, patch: { type: 'description' } },
      },
      {
        url: '/api/v1/commands/prompt-items/item-a',
        method: 'DELETE',
        body: { baseRevision: 4 },
      },
      {
        url: '/api/v1/commands/prompt-items/reorder',
        method: 'POST',
        body: { baseRevision: 5, itemIds: ['item-b'] },
      },
    ])
  })

  it('runs prompt commands with revision lookup and one conflict retry', async () => {
    let attempts = 0
    const commandFetch = makeCommandFetch((url) => {
      if (url === '/api/v1/bootstrap') return { revision: 11 }
      attempts += 1
      if (attempts === 1) {
        return jsonResponse({ error: 'revision_conflict', currentRevision: 14 }, 409)
      }
      return {
        revision: 15,
        event: { type: 'prompt.item.updated', revision: 15, resource: 'promptItem', id: 'item-a' },
        itemId: 'item-a',
      }
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    await expect(
      runServerCommand({
        command: (baseRevision) =>
          updatePromptItemCommand({
            baseRevision,
            itemId: 'item-a',
            patch: { type: 'memory' },
          }),
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 15, itemId: 'item-a' })

    expect(commandFetch.calls.map((call) => call.body)).toEqual([
      null,
      { baseRevision: 11, patch: { type: 'memory' } },
      { baseRevision: 14, patch: { type: 'memory' } },
    ])
  })

  it('dispatches persona commands through typed helpers', async () => {
    const commandFetch = makeCommandFetch((url) => {
      if (url.endsWith('/personas/select')) {
        return {
          revision: 5,
          event: { type: 'persona.selected', revision: 5, resource: 'persona', id: 'persona-b' },
          personaId: 'persona-b',
        }
      }
      if (url.endsWith('/personas/reorder')) {
        return {
          revision: 6,
          event: { type: 'persona.reordered', revision: 6, resource: 'persona' },
          selectedPersonaId: 'persona-b',
        }
      }
      if (url.endsWith('/personas/persona-a')) {
        return {
          revision: 4,
          event: { type: 'persona.deleted', revision: 4, resource: 'persona', id: 'persona-a' },
          personaId: 'persona-a',
          selectedPersonaId: 'persona-b',
        }
      }
      if (url.endsWith('/personas/persona-b')) {
        return {
          revision: 3,
          event: { type: 'persona.updated', revision: 3, resource: 'persona', id: 'persona-b' },
          personaId: 'persona-b',
        }
      }
      return {
        revision: 2,
        event: { type: 'persona.created', revision: 2, resource: 'persona', id: 'persona-b' },
        personaId: 'persona-b',
      }
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    await expect(
      createPersonaCommand({
        baseRevision: 1,
        persona: { id: 'persona-b', name: 'B', icon: '', personaPrompt: 'hello' },
        mirrorLegacyProfile: true,
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 2, personaId: 'persona-b' })

    await expect(
      updatePersonaCommand({
        baseRevision: 2,
        personaId: 'persona-b',
        patch: { name: 'Bee', largePortrait: true },
        mirrorLegacyProfile: true,
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 3, personaId: 'persona-b' })

    await expect(
      deletePersonaCommand({
        baseRevision: 3,
        personaId: 'persona-a',
        selectPersonaId: 'persona-b',
        mirrorLegacyProfile: true,
        saveCurrent: true,
      }),
    ).resolves.toMatchObject({
      status: 'ok',
      revision: 4,
      personaId: 'persona-a',
      selectedPersonaId: 'persona-b',
    })

    await expect(
      selectPersonaCommand({
        baseRevision: 4,
        personaId: 'persona-b',
        mirrorLegacyProfile: true,
        saveCurrent: true,
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 5, personaId: 'persona-b' })

    await expect(
      reorderPersonasCommand({
        baseRevision: 5,
        personaIds: ['persona-b'],
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 6, selectedPersonaId: 'persona-b' })

    expect(
      commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body })),
    ).toEqual([
      {
        url: '/api/v1/commands/personas',
        method: 'POST',
        body: {
          baseRevision: 1,
          persona: { id: 'persona-b', name: 'B', icon: '', personaPrompt: 'hello' },
          mirrorLegacyProfile: true,
        },
      },
      {
        url: '/api/v1/commands/personas/persona-b',
        method: 'PATCH',
        body: {
          baseRevision: 2,
          patch: { name: 'Bee', largePortrait: true },
          mirrorLegacyProfile: true,
        },
      },
      {
        url: '/api/v1/commands/personas/persona-a',
        method: 'DELETE',
        body: {
          baseRevision: 3,
          personaId: 'persona-b',
          mirrorLegacyProfile: true,
          saveCurrent: true,
        },
      },
      {
        url: '/api/v1/commands/personas/select',
        method: 'POST',
        body: {
          baseRevision: 4,
          personaId: 'persona-b',
          mirrorLegacyProfile: true,
          saveCurrent: true,
        },
      },
      {
        url: '/api/v1/commands/personas/reorder',
        method: 'POST',
        body: { baseRevision: 5, personaIds: ['persona-b'] },
      },
    ])
  })

  it('runs persona commands with revision lookup and one conflict retry', async () => {
    let attempts = 0
    const commandFetch = makeCommandFetch((url) => {
      if (url === '/api/v1/bootstrap') return { revision: 20 }
      attempts += 1
      if (attempts === 1) {
        return jsonResponse({ error: 'revision_conflict', currentRevision: 23 }, 409)
      }
      return {
        revision: 24,
        event: { type: 'persona.selected', revision: 24, resource: 'persona', id: 'persona-b' },
        personaId: 'persona-b',
      }
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    await expect(
      runServerCommand({
        command: (baseRevision) =>
          selectPersonaCommand({
            baseRevision,
            personaId: 'persona-b',
          }),
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 24, personaId: 'persona-b' })

    expect(commandFetch.calls.map((call) => call.body)).toEqual([
      null,
      { baseRevision: 20, personaId: 'persona-b' },
      { baseRevision: 23, personaId: 'persona-b' },
    ])
  })

  it('dispatches translator preset commands through typed helpers', async () => {
    const commandFetch = makeCommandFetch((url) => {
      if (url.endsWith('/translator-presets/select')) {
        return {
          revision: 5,
          event: {
            type: 'translatorPreset.selected',
            revision: 5,
            resource: 'translatorPreset',
            id: 'translator-b',
          },
          presetId: 'translator-b',
        }
      }
      if (url.endsWith('/translator-presets/translator-a')) {
        return {
          revision: 4,
          event: {
            type: 'translatorPreset.deleted',
            revision: 4,
            resource: 'translatorPreset',
            id: 'translator-a',
          },
          presetId: 'translator-a',
          selectedPresetId: 'translator-b',
        }
      }
      if (url.endsWith('/translator-presets/translator-b')) {
        return {
          revision: 3,
          event: {
            type: 'translatorPreset.updated',
            revision: 3,
            resource: 'translatorPreset',
            id: 'translator-b',
          },
          presetId: 'translator-b',
        }
      }
      return {
        revision: 2,
        event: {
          type: 'translatorPreset.created',
          revision: 2,
          resource: 'translatorPreset',
          id: 'translator-b',
        },
        presetId: 'translator-b',
      }
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    await expect(
      createTranslatorPresetCommand({
        baseRevision: 1,
        preset: {
          id: 'translator-b',
          name: 'B',
          prompt: 'translate to B',
          maxResponse: 200,
        },
        select: true,
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 2, presetId: 'translator-b' })

    await expect(
      updateTranslatorPresetCommand({
        baseRevision: 2,
        presetId: 'translator-b',
        patch: { prompt: 'updated', maxResponse: 300 },
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 3, presetId: 'translator-b' })

    await expect(
      deleteTranslatorPresetCommand({
        baseRevision: 3,
        presetId: 'translator-a',
        selectPresetId: 'translator-b',
      }),
    ).resolves.toMatchObject({
      status: 'ok',
      revision: 4,
      presetId: 'translator-a',
      selectedPresetId: 'translator-b',
    })

    await expect(
      selectTranslatorPresetCommand({
        baseRevision: 4,
        presetId: 'translator-b',
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 5, presetId: 'translator-b' })

    expect(
      commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body })),
    ).toEqual([
      {
        url: '/api/v1/commands/translator-presets',
        method: 'POST',
        body: {
          baseRevision: 1,
          preset: {
            id: 'translator-b',
            name: 'B',
            prompt: 'translate to B',
            maxResponse: 200,
          },
          select: true,
        },
      },
      {
        url: '/api/v1/commands/translator-presets/translator-b',
        method: 'PATCH',
        body: {
          baseRevision: 2,
          patch: { prompt: 'updated', maxResponse: 300 },
        },
      },
      {
        url: '/api/v1/commands/translator-presets/translator-a',
        method: 'DELETE',
        body: {
          baseRevision: 3,
          presetId: 'translator-b',
        },
      },
      {
        url: '/api/v1/commands/translator-presets/select',
        method: 'POST',
        body: {
          baseRevision: 4,
          presetId: 'translator-b',
        },
      },
    ])
  })

  it('runs translator preset commands with revision lookup and one conflict retry', async () => {
    let attempts = 0
    const commandFetch = makeCommandFetch((url) => {
      if (url === '/api/v1/bootstrap') return { revision: 30 }
      attempts += 1
      if (attempts === 1) {
        return jsonResponse({ error: 'revision_conflict', currentRevision: 33 }, 409)
      }
      return {
        revision: 34,
        event: {
          type: 'translatorPreset.selected',
          revision: 34,
          resource: 'translatorPreset',
          id: 'translator-b',
        },
        presetId: 'translator-b',
      }
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    await expect(
      runServerCommand({
        command: (baseRevision) =>
          selectTranslatorPresetCommand({
            baseRevision,
            presetId: 'translator-b',
          }),
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 34, presetId: 'translator-b' })

    expect(commandFetch.calls.map((call) => call.body)).toEqual([
      null,
      { baseRevision: 30, presetId: 'translator-b' },
      { baseRevision: 33, presetId: 'translator-b' },
    ])
  })

  it('dispatches loadout commands through typed helpers', async () => {
    const commandFetch = makeCommandFetch((url) => {
      if (url.endsWith('/loadouts/loadout-a/touch')) {
        return {
          revision: 6,
          event: { type: 'loadout.touched', revision: 6, resource: 'loadout', id: 'loadout-a' },
          loadoutId: 'loadout-a',
        }
      }
      if (url.endsWith('/loadouts/loadout-a/favorite')) {
        return {
          revision: 5,
          event: { type: 'loadout.favorited', revision: 5, resource: 'loadout', id: 'loadout-a' },
          loadoutId: 'loadout-a',
        }
      }
      if (url.endsWith('/loadouts/loadout-b')) {
        return {
          revision: 4,
          event: { type: 'loadout.deleted', revision: 4, resource: 'loadout', id: 'loadout-b' },
          loadoutId: 'loadout-b',
        }
      }
      if (url.endsWith('/loadouts/loadout-a')) {
        return {
          revision: 3,
          event: { type: 'loadout.updated', revision: 3, resource: 'loadout', id: 'loadout-a' },
          loadoutId: 'loadout-a',
        }
      }
      return {
        revision: 2,
        event: { type: 'loadout.created', revision: 2, resource: 'loadout', id: 'loadout-a' },
        loadoutId: 'loadout-a',
      }
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    await expect(
      createLoadoutCommand({
        baseRevision: 1,
        loadout: {
          id: 'loadout-a',
          name: 'A',
          lastUsed: 100,
          favorite: false,
          characterIds: ['char-a'],
          modules: ['module-a'],
          globalVariables: { mood: 'bright' },
          presetName: 'Preset A',
          personaId: 'persona-a',
        },
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 2, loadoutId: 'loadout-a' })

    await expect(
      updateLoadoutCommand({
        baseRevision: 2,
        loadoutId: 'loadout-a',
        patch: { name: 'A updated' },
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 3, loadoutId: 'loadout-a' })

    await expect(
      deleteLoadoutCommand({
        baseRevision: 3,
        loadoutId: 'loadout-b',
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 4, loadoutId: 'loadout-b' })

    await expect(
      favoriteLoadoutCommand({
        baseRevision: 4,
        loadoutId: 'loadout-a',
        favorite: true,
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 5, loadoutId: 'loadout-a' })

    await expect(
      touchLoadoutCommand({
        baseRevision: 5,
        loadoutId: 'loadout-a',
        lastUsed: 1234,
        characterId: 'char-b',
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 6, loadoutId: 'loadout-a' })

    expect(
      commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body })),
    ).toEqual([
      {
        url: '/api/v1/commands/loadouts',
        method: 'POST',
        body: {
          baseRevision: 1,
          loadout: {
            id: 'loadout-a',
            name: 'A',
            lastUsed: 100,
            favorite: false,
            characterIds: ['char-a'],
            modules: ['module-a'],
            globalVariables: { mood: 'bright' },
            presetName: 'Preset A',
            personaId: 'persona-a',
          },
        },
      },
      {
        url: '/api/v1/commands/loadouts/loadout-a',
        method: 'PATCH',
        body: {
          baseRevision: 2,
          patch: { name: 'A updated' },
        },
      },
      {
        url: '/api/v1/commands/loadouts/loadout-b',
        method: 'DELETE',
        body: {
          baseRevision: 3,
        },
      },
      {
        url: '/api/v1/commands/loadouts/loadout-a/favorite',
        method: 'POST',
        body: {
          baseRevision: 4,
          favorite: true,
        },
      },
      {
        url: '/api/v1/commands/loadouts/loadout-a/touch',
        method: 'POST',
        body: {
          baseRevision: 5,
          lastUsed: 1234,
          characterId: 'char-b',
        },
      },
    ])
  })

  it('runs loadout commands with revision lookup and one conflict retry', async () => {
    let attempts = 0
    const commandFetch = makeCommandFetch((url) => {
      if (url === '/api/v1/bootstrap') return { revision: 40 }
      attempts += 1
      if (attempts === 1) {
        return jsonResponse({ error: 'revision_conflict', currentRevision: 43 }, 409)
      }
      return {
        revision: 44,
        event: { type: 'loadout.favorited', revision: 44, resource: 'loadout', id: 'loadout-a' },
        loadoutId: 'loadout-a',
      }
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    await expect(
      runServerCommand({
        command: (baseRevision) =>
          favoriteLoadoutCommand({
            baseRevision,
            loadoutId: 'loadout-a',
            favorite: false,
          }),
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 44, loadoutId: 'loadout-a' })

    expect(commandFetch.calls.map((call) => call.body)).toEqual([
      null,
      { baseRevision: 40, favorite: false },
      { baseRevision: 43, favorite: false },
    ])
  })

  it('dispatches character commands through typed helpers', async () => {
    const commandFetch = makeCommandFetch((url) => {
      if (url.endsWith('/characters/reorder')) {
        return {
          revision: 6,
          event: { type: 'character.reordered', revision: 6, resource: 'character' },
          selectedCharacterId: 'char-a',
        }
      }
      if (url.endsWith('/characters/select')) {
        return {
          revision: 5,
          event: {
            type: 'character.selected',
            revision: 5,
            resource: 'character',
            id: 'char-a',
          },
          characterId: 'char-a',
        }
      }
      if (url.endsWith('/characters/char-b')) {
        const method = commandFetch.calls.at(-1)?.method
        return method === 'DELETE'
          ? {
              revision: 4,
              event: {
                type: 'character.deleted',
                revision: 4,
                resource: 'character',
                id: 'char-b',
              },
              characterId: 'char-b',
              selectedCharacterId: 'char-a',
            }
          : {
              revision: 3,
              event: {
                type: 'character.updated',
                revision: 3,
                resource: 'character',
                id: 'char-b',
              },
              characterId: 'char-b',
            }
      }
      return {
        revision: 2,
        event: { type: 'character.created', revision: 2, resource: 'character', id: 'char-b' },
        characterId: 'char-b',
      }
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    await expect(
      createCharacterCommand({
        baseRevision: 1,
        character: { chaId: 'char-b', name: 'B' },
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 2, characterId: 'char-b' })

    await expect(
      updateCharacterCommand({
        baseRevision: 2,
        characterId: 'char-b',
        patch: { name: 'B renamed' },
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 3, characterId: 'char-b' })

    await expect(
      deleteCharacterCommand({
        baseRevision: 3,
        characterId: 'char-b',
      }),
    ).resolves.toMatchObject({
      status: 'ok',
      revision: 4,
      characterId: 'char-b',
      selectedCharacterId: 'char-a',
    })

    await expect(
      selectCharacterCommand({
        baseRevision: 4,
        characterId: 'char-a',
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 5, characterId: 'char-a' })

    await expect(
      reorderCharactersCommand({
        baseRevision: 5,
        characterOrder: [{ id: 'folder-a', name: 'Folder', color: '', data: ['char-a'] }],
      }),
    ).resolves.toMatchObject({
      status: 'ok',
      revision: 6,
      selectedCharacterId: 'char-a',
    })

    expect(
      commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body })),
    ).toEqual([
      {
        url: '/api/v1/commands/characters',
        method: 'POST',
        body: {
          baseRevision: 1,
          character: { chaId: 'char-b', name: 'B' },
        },
      },
      {
        url: '/api/v1/commands/characters/char-b',
        method: 'PATCH',
        body: {
          baseRevision: 2,
          patch: { name: 'B renamed' },
        },
      },
      {
        url: '/api/v1/commands/characters/char-b',
        method: 'DELETE',
        body: {
          baseRevision: 3,
        },
      },
      {
        url: '/api/v1/commands/characters/select',
        method: 'POST',
        body: {
          baseRevision: 4,
          characterId: 'char-a',
        },
      },
      {
        url: '/api/v1/commands/characters/reorder',
        method: 'POST',
        body: {
          baseRevision: 5,
          characterOrder: [{ id: 'folder-a', name: 'Folder', color: '', data: ['char-a'] }],
        },
      },
    ])
  })

  it('runs character commands with revision lookup and one conflict retry', async () => {
    let attempts = 0
    const commandFetch = makeCommandFetch((url) => {
      if (url === '/api/v1/bootstrap') return { revision: 50 }
      attempts += 1
      if (attempts === 1) {
        return jsonResponse({ error: 'revision_conflict', currentRevision: 52 }, 409)
      }
      return {
        revision: 53,
        event: { type: 'character.selected', revision: 53, resource: 'character', id: 'char-a' },
        characterId: 'char-a',
      }
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    await expect(
      runServerCommand({
        command: (baseRevision) =>
          selectCharacterCommand({
            baseRevision,
            characterId: 'char-a',
          }),
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 53, characterId: 'char-a' })

    expect(commandFetch.calls.map((call) => call.body)).toEqual([
      null,
      { baseRevision: 50, characterId: 'char-a' },
      { baseRevision: 52, characterId: 'char-a' },
    ])
  })

  it('dispatches chat and chat-folder commands through typed helpers', async () => {
    const commandFetch = makeCommandFetch((url) => {
      if (url.endsWith('/chat-folders/reorder')) {
        return {
          revision: 9,
          event: { type: 'chatFolder.reordered', revision: 9, resource: 'chatFolder' },
          selectedChatId: 'chat-a',
        }
      }
      if (url.endsWith('/chat-folders/folder-a')) {
        const method = commandFetch.calls.at(-1)?.method
        return method === 'DELETE'
          ? {
              revision: 8,
              event: {
                type: 'chatFolder.deleted',
                revision: 8,
                resource: 'chatFolder',
                id: 'folder-a',
              },
              folderId: 'folder-a',
            }
          : {
              revision: 7,
              event: {
                type: 'chatFolder.updated',
                revision: 7,
                resource: 'chatFolder',
                id: 'folder-a',
              },
              folderId: 'folder-a',
            }
      }
      if (url.endsWith('/chat-folders')) {
        return {
          revision: 6,
          event: {
            type: 'chatFolder.created',
            revision: 6,
            resource: 'chatFolder',
            id: 'folder-a',
          },
          folderId: 'folder-a',
        }
      }
      if (url.endsWith('/chats/reorder')) {
        return {
          revision: 5,
          event: { type: 'chat.reordered', revision: 5, resource: 'chat' },
          selectedChatId: 'chat-a',
        }
      }
      if (url.endsWith('/chats/chat-a/fork')) {
        return {
          revision: 4,
          event: { type: 'chat.forked', revision: 4, resource: 'chat', id: 'chat-b' },
          chatId: 'chat-b',
          sourceChatId: 'chat-a',
          selectedChatId: 'chat-b',
        }
      }
      if (url.endsWith('/chats/chat-a')) {
        const method = commandFetch.calls.at(-1)?.method
        return method === 'DELETE'
          ? {
              revision: 3,
              event: { type: 'chat.deleted', revision: 3, resource: 'chat', id: 'chat-a' },
              chatId: 'chat-a',
              selectedChatId: 'chat-b',
            }
          : {
              revision: 2,
              event: { type: 'chat.updated', revision: 2, resource: 'chat', id: 'chat-a' },
              chatId: 'chat-a',
              selectedChatId: 'chat-a',
            }
      }
      return {
        revision: 1,
        event: { type: 'chat.created', revision: 1, resource: 'chat', id: 'chat-a' },
        chatId: 'chat-a',
        selectedChatId: 'chat-a',
      }
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    await expect(
      createChatCommand({
        baseRevision: 0,
        characterId: 'char-a',
        chat: { id: 'chat-a', name: 'A', note: '', message: [], localLore: [] },
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 1, chatId: 'chat-a' })

    await expect(
      updateChatCommand({
        baseRevision: 1,
        chatId: 'chat-a',
        patch: { name: 'A renamed' },
        select: true,
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 2, selectedChatId: 'chat-a' })

    await expect(
      deleteChatCommand({
        baseRevision: 2,
        chatId: 'chat-a',
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 3, selectedChatId: 'chat-b' })

    await expect(
      forkChatCommand({
        baseRevision: 3,
        chatId: 'chat-a',
        chat: { id: 'chat-b', name: 'B', note: '', message: [], localLore: [] },
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 4, chatId: 'chat-b' })

    await expect(
      reorderChatsCommand({
        baseRevision: 4,
        characterId: 'char-a',
        chatIds: ['chat-a', 'chat-b'],
        folderByChatId: { 'chat-a': null, 'chat-b': 'folder-a' },
        selectedChatId: 'chat-a',
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 5, selectedChatId: 'chat-a' })

    await expect(
      createChatFolderCommand({
        baseRevision: 5,
        characterId: 'char-a',
        folder: { id: 'folder-a', name: 'Folder', folded: false },
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 6, folderId: 'folder-a' })

    await expect(
      updateChatFolderCommand({
        baseRevision: 6,
        folderId: 'folder-a',
        patch: { folded: true },
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 7, folderId: 'folder-a' })

    await expect(
      deleteChatFolderCommand({
        baseRevision: 7,
        folderId: 'folder-a',
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 8, folderId: 'folder-a' })

    await expect(
      reorderChatFoldersCommand({
        baseRevision: 8,
        characterId: 'char-a',
        folderIds: ['folder-a'],
        selectedChatId: 'chat-a',
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 9, selectedChatId: 'chat-a' })

    expect(
      commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body })),
    ).toEqual([
      {
        url: '/api/v1/commands/characters/char-a/chats',
        method: 'POST',
        body: {
          baseRevision: 0,
          chat: { id: 'chat-a', name: 'A', note: '', message: [], localLore: [] },
        },
      },
      {
        url: '/api/v1/commands/chats/chat-a',
        method: 'PATCH',
        body: {
          baseRevision: 1,
          patch: { name: 'A renamed' },
          select: true,
        },
      },
      {
        url: '/api/v1/commands/chats/chat-a',
        method: 'DELETE',
        body: {
          baseRevision: 2,
        },
      },
      {
        url: '/api/v1/commands/chats/chat-a/fork',
        method: 'POST',
        body: {
          baseRevision: 3,
          chat: { id: 'chat-b', name: 'B', note: '', message: [], localLore: [] },
        },
      },
      {
        url: '/api/v1/commands/characters/char-a/chats/reorder',
        method: 'POST',
        body: {
          baseRevision: 4,
          chatIds: ['chat-a', 'chat-b'],
          folderByChatId: { 'chat-a': null, 'chat-b': 'folder-a' },
          selectedChatId: 'chat-a',
        },
      },
      {
        url: '/api/v1/commands/characters/char-a/chat-folders',
        method: 'POST',
        body: {
          baseRevision: 5,
          folder: { id: 'folder-a', name: 'Folder', folded: false },
        },
      },
      {
        url: '/api/v1/commands/chat-folders/folder-a',
        method: 'PATCH',
        body: {
          baseRevision: 6,
          patch: { folded: true },
        },
      },
      {
        url: '/api/v1/commands/chat-folders/folder-a',
        method: 'DELETE',
        body: {
          baseRevision: 7,
        },
      },
      {
        url: '/api/v1/commands/characters/char-a/chat-folders/reorder',
        method: 'POST',
        body: {
          baseRevision: 8,
          folderIds: ['folder-a'],
          selectedChatId: 'chat-a',
        },
      },
    ])
  })

  it('dispatches message history commands through typed helpers', async () => {
    const commandFetch = makeCommandFetch((url) => {
      if (url.endsWith('/messages/truncate')) {
        return {
          revision: 4,
          event: { type: 'message.truncated', revision: 4, resource: 'message' },
          chatId: 'chat-a',
          afterMessageId: 'msg-a',
          removedCount: 2,
        }
      }
      if (url.endsWith('/chats/chat-a/messages')) {
        const method = commandFetch.calls.at(-1)?.method
        return method === 'PUT'
          ? {
              revision: 5,
              event: { type: 'messages.replaced', revision: 5, resource: 'message' },
              chatId: 'chat-a',
            }
          : {
              revision: 1,
              event: {
                type: 'message.appended',
                revision: 1,
                resource: 'message',
                id: 'msg-a',
              },
              chatId: 'chat-a',
              messageId: 'msg-a',
            }
      }
      if (url.endsWith('/messages/msg-a')) {
        const method = commandFetch.calls.at(-1)?.method
        return method === 'DELETE'
          ? {
              revision: 3,
              event: {
                type: 'message.deleted',
                revision: 3,
                resource: 'message',
                id: 'msg-a',
              },
              chatId: 'chat-a',
              messageId: 'msg-a',
            }
          : {
              revision: 2,
              event: {
                type: 'message.updated',
                revision: 2,
                resource: 'message',
                id: 'msg-a',
              },
              chatId: 'chat-a',
              messageId: 'msg-a',
            }
      }
      if (url.endsWith('/chats/chat-a/generation-result')) {
        return {
          revision: 6,
          event: {
            type: 'generation.persisted',
            revision: 6,
            resource: 'generation',
            id: 'gen-a',
          },
          chatId: 'chat-a',
          messageId: 'gen-a',
        }
      }
      return jsonResponse({ error: 'unexpected' }, 500)
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    await expect(
      appendMessageCommand({
        baseRevision: 0,
        chatId: 'chat-a',
        message: { role: 'user', data: 'hello', chatId: 'msg-a' },
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 1, messageId: 'msg-a' })

    await expect(
      updateMessageCommand({
        baseRevision: 1,
        messageId: 'msg-a',
        patch: { data: 'edited', disabled: true },
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 2, messageId: 'msg-a' })

    await expect(
      deleteMessageCommand({
        baseRevision: 2,
        messageId: 'msg-a',
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 3, messageId: 'msg-a' })

    await expect(
      truncateMessagesCommand({
        baseRevision: 3,
        chatId: 'chat-a',
        afterMessageId: 'msg-a',
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 4, removedCount: 2 })

    await expect(
      replaceMessagesCommand({
        baseRevision: 4,
        chatId: 'chat-a',
        messages: [{ role: 'char', data: 'replacement', chatId: 'msg-b' }],
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 5, chatId: 'chat-a' })

    await expect(
      persistGenerationResultCommand({
        baseRevision: 5,
        chatId: 'chat-a',
        generationResult: {
          targetMessageId: 'msg-b',
          message: {
            role: 'char',
            data: 'generated',
            chatId: 'gen-a',
            generationInfo: { generationId: 'gen-a' },
            promptInfo: { promptName: 'Preset' },
          },
        },
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 6, messageId: 'gen-a' })

    expect(
      commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body })),
    ).toEqual([
      {
        url: '/api/v1/commands/chats/chat-a/messages',
        method: 'POST',
        body: {
          baseRevision: 0,
          message: { role: 'user', data: 'hello', chatId: 'msg-a' },
        },
      },
      {
        url: '/api/v1/commands/messages/msg-a',
        method: 'PATCH',
        body: {
          baseRevision: 1,
          patch: { data: 'edited', disabled: true },
        },
      },
      {
        url: '/api/v1/commands/messages/msg-a',
        method: 'DELETE',
        body: {
          baseRevision: 2,
        },
      },
      {
        url: '/api/v1/commands/chats/chat-a/messages/truncate',
        method: 'POST',
        body: {
          baseRevision: 3,
          afterMessageId: 'msg-a',
        },
      },
      {
        url: '/api/v1/commands/chats/chat-a/messages',
        method: 'PUT',
        body: {
          baseRevision: 4,
          messages: [{ role: 'char', data: 'replacement', chatId: 'msg-b' }],
        },
      },
      {
        url: '/api/v1/commands/chats/chat-a/generation-result',
        method: 'POST',
        body: {
          baseRevision: 5,
          generationResult: {
            targetMessageId: 'msg-b',
            message: {
              role: 'char',
              data: 'generated',
              chatId: 'gen-a',
              generationInfo: { generationId: 'gen-a' },
              promptInfo: { promptName: 'Preset' },
            },
          },
        },
      },
    ])
  })

  it('dispatches chat scriptstate commands through typed helpers', async () => {
    const commandFetch = makeCommandFetch((url) => {
      if (url.endsWith('/chats/chat-a/scriptstate')) {
        return {
          revision: 7,
          event: {
            type: 'chat.scriptstate.updated',
            revision: 7,
            resource: 'chat',
            id: 'chat-a',
          },
          chatId: 'chat-a',
        }
      }
      return jsonResponse({ error: 'unexpected' }, 500)
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    await expect(
      patchChatScriptstateCommand({
        baseRevision: 6,
        chatId: 'chat-a',
        patch: { $score: '9', $count: 2 },
        deleteKeys: ['$old'],
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 7, chatId: 'chat-a' })

    expect(
      commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body })),
    ).toEqual([
      {
        url: '/api/v1/commands/chats/chat-a/scriptstate',
        method: 'PATCH',
        body: {
          baseRevision: 6,
          patch: { $score: '9', $count: 2 },
          deleteKeys: ['$old'],
        },
      },
    ])
  })

  it('does not dispatch chat scriptstate commands outside Fastify mode', async () => {
    platformState.isFastifyServer = false
    const commandFetch = makeCommandFetch(() => ({ revision: 7 }))
    vi.stubGlobal('fetch', commandFetch.fetch)

    const result = await patchChatScriptstateCommand({
      baseRevision: 6,
      chatId: 'chat-a',
      patch: { $score: '9' },
    })

    expect(result).toEqual({ status: 'unavailable' })
    expect(commandFetch.calls).toEqual([])
  })

  it('dispatches lorebook commands through typed helpers', async () => {
    const commandFetch = makeCommandFetch((url) => {
      if (
        url.includes('/lorebooks') ||
        url.includes('/characters/') ||
        url.includes('/chats/') ||
        url.includes('/modules/')
      ) {
        return {
          revision: 9,
          event: {
            type: 'lorebook.entries.replaced',
            revision: 9,
            resource: 'lorebook',
          },
          lorebookId: 'book-a',
          characterId: 'char-a',
          chatId: 'chat-a',
          moduleId: 'mod-a',
        }
      }
      return jsonResponse({ error: 'unexpected' }, 500)
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    const entry = {
      id: 'entry-a',
      key: 'key',
      secondkey: '',
      insertorder: 100,
      comment: 'Lore',
      content: 'body',
      mode: 'normal',
      alwaysActive: false,
      selective: false,
    }

    await createGlobalLorebookCommand({
      baseRevision: 1,
      lorebook: { id: 'book-a', name: 'A', data: [] },
    })
    await updateGlobalLorebookCommand({
      baseRevision: 2,
      lorebookId: 'book-a',
      patch: { name: 'Renamed' },
    })
    await deleteGlobalLorebookCommand({ baseRevision: 3, lorebookId: 'book-a' })
    await reorderGlobalLorebooksCommand({ baseRevision: 4, lorebookIds: ['book-a'] })
    await replaceGlobalLorebookEntriesCommand({
      baseRevision: 5,
      lorebookId: 'book-a',
      entries: [entry],
    })
    await replaceCharacterLorebooksCommand({
      baseRevision: 6,
      characterId: 'char-a',
      entries: [entry],
    })
    await replaceChatLorebooksCommand({ baseRevision: 7, chatId: 'chat-a', entries: [entry] })
    await replaceModuleLorebooksCommand({ baseRevision: 8, moduleId: 'mod-a', entries: [entry] })

    expect(
      commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body })),
    ).toEqual([
      {
        url: '/api/v1/commands/lorebooks',
        method: 'POST',
        body: { baseRevision: 1, lorebook: { id: 'book-a', name: 'A', data: [] } },
      },
      {
        url: '/api/v1/commands/lorebooks/book-a',
        method: 'PATCH',
        body: { baseRevision: 2, patch: { name: 'Renamed' } },
      },
      {
        url: '/api/v1/commands/lorebooks/book-a',
        method: 'DELETE',
        body: { baseRevision: 3 },
      },
      {
        url: '/api/v1/commands/lorebooks/reorder',
        method: 'POST',
        body: { baseRevision: 4, lorebookIds: ['book-a'] },
      },
      {
        url: '/api/v1/commands/lorebooks/book-a/entries',
        method: 'PUT',
        body: { baseRevision: 5, entries: [entry] },
      },
      {
        url: '/api/v1/commands/characters/char-a/lorebooks',
        method: 'PUT',
        body: { baseRevision: 6, entries: [entry] },
      },
      {
        url: '/api/v1/commands/chats/chat-a/lorebooks',
        method: 'PUT',
        body: { baseRevision: 7, entries: [entry] },
      },
      {
        url: '/api/v1/commands/modules/mod-a/lorebooks',
        method: 'PUT',
        body: { baseRevision: 8, entries: [entry] },
      },
    ])
  })

  it('dispatches script and trigger definition commands through typed helpers', async () => {
    const commandFetch = makeCommandFetch((url) => {
      if (url.includes('/scripts')) {
        return {
          revision: 9,
          event: {
            type: 'scriptDefinitions.replaced',
            revision: 9,
            resource: 'scriptDefinition',
          },
          characterId: 'char-a',
          moduleId: 'mod-a',
        }
      }
      if (url.includes('/triggers')) {
        return {
          revision: 10,
          event: {
            type: 'triggerDefinitions.replaced',
            revision: 10,
            resource: 'triggerDefinition',
          },
          characterId: 'char-a',
          moduleId: 'mod-a',
        }
      }
      return jsonResponse({ error: 'unexpected' }, 500)
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    const script = {
      id: 'script-a',
      comment: 'Regex',
      in: 'a',
      out: 'b',
      type: 'editinput',
    }
    const trigger = {
      id: 'trigger-a',
      comment: 'Start',
      type: 'start',
      conditions: [],
      effect: [],
    }

    await replaceCharacterScriptsCommand({
      baseRevision: 1,
      characterId: 'char-a',
      scripts: [script],
    })
    await replaceCharacterTriggersCommand({
      baseRevision: 2,
      characterId: 'char-a',
      triggers: [trigger],
    })
    await replaceModuleScriptsCommand({
      baseRevision: 3,
      moduleId: 'mod-a',
      scripts: [script],
    })
    await replaceModuleTriggersCommand({
      baseRevision: 4,
      moduleId: 'mod-a',
      triggers: [trigger],
    })

    expect(
      commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body })),
    ).toEqual([
      {
        url: '/api/v1/commands/characters/char-a/scripts',
        method: 'PUT',
        body: { baseRevision: 1, scripts: [script] },
      },
      {
        url: '/api/v1/commands/characters/char-a/triggers',
        method: 'PUT',
        body: { baseRevision: 2, triggers: [trigger] },
      },
      {
        url: '/api/v1/commands/modules/mod-a/scripts',
        method: 'PUT',
        body: { baseRevision: 3, scripts: [script] },
      },
      {
        url: '/api/v1/commands/modules/mod-a/triggers',
        method: 'PUT',
        body: { baseRevision: 4, triggers: [trigger] },
      },
    ])
  })
})
