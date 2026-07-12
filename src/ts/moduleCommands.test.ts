import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./platform', async (importActual) => {
  const actual = await importActual<typeof import('./platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'module-command-token',
}))

import { clearCachedServerCommandRevision } from './server/commands'
import { setResourceWriteGuardEnabled, withTrustedResourceWrite } from './server/resourceWriteGuard.svelte'
import {
  getResourceDatabase as getDatabase,
  replaceResourceDatabase as setDatabaseLite,
} from './server/resourceState.svelte'
import { selectedCharID } from './stores.svelte'
import { seedCloneCostDb, withCloneInstrumentation } from './__tests__/cloneCostHarness'
import {
  currentCharacterModuleStateSnapshot,
  currentGlobalModuleStateSnapshot,
  createGlobalModule,
  deleteGlobalModule,
  restoreCharacterModuleState,
  setGlobalModuleEnabled,
  toggledModuleIds,
  toggleSelectedCharacterModule,
  toggleSelectedChatModule,
  updateGlobalModule,
} from './moduleCommands'

interface CapturedFetch {
  url: string
  method: string
  authHeader: string | null
  body: unknown
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
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

      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
      if (url === '/api/v1/commands/chats/chat-a') {
        return jsonResponse({
          revision: 11,
          event: { type: 'chat.updated', revision: 11, resource: 'chat' },
        })
      }
      if (url === '/api/v1/commands/chats/chat-a/generation-settings') {
        return jsonResponse({
          revision: 12,
          event: { type: 'chat.generationSettings.updated', revision: 12, resource: 'chat' },
          chatId: 'chat-a',
        })
      }
      if (url === '/api/v1/commands/characters/char-a/modules/reorder') {
        return jsonResponse({
          revision: 11,
          event: { type: 'character.modules.reordered', revision: 11, resource: 'character' },
        })
      }
      if (url === '/api/v1/commands/modules/enable') {
        return jsonResponse({
          revision: 11,
          event: { type: 'module.enabled', revision: 11, resource: 'module' },
        })
      }
      if (url === '/api/v1/commands/modules') {
        return jsonResponse({
          revision: 11,
          event: { type: 'module.created', revision: 11, resource: 'module' },
        })
      }
      if (url === '/api/v1/commands/modules/mod-a') {
        return jsonResponse({
          revision: 11,
          event: {
            type: init.method === 'DELETE' ? 'module.deleted' : 'module.updated',
            revision: 11,
            resource: 'module',
          },
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

function stubFailingCommandFetch(): CapturedFetch[] {
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
      return jsonResponse({ error: 'forced failure' }, 500)
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

function moduleNames(): Record<string, string | undefined> {
  return Object.fromEntries((getDatabase().modules ?? []).map((module) => [module.id, module.name]))
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  setResourceWriteGuardEnabled(false)
  selectedCharID.set(0)
  setDatabaseLite({
    characters: [
      {
        chaId: 'char-a',
        name: 'Character',
        chatPage: 0,
        chats: [{ id: 'chat-a', name: 'Chat', modules: ['mod-a'], message: [] }],
        modules: ['mod-a'],
      },
    ],
    characterOrder: [],
    enabledModules: [],
    modules: [
      { id: 'mod-a', name: 'Module A' },
      { id: 'mod-b', name: 'Module B' },
    ],
  } as any)
})

afterEach(() => {
  setResourceWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('module command projection helpers', () => {
  it('toggles module ids without mutating the input array', () => {
    const current = ['mod-a']

    expect(toggledModuleIds(current, 'mod-b')).toEqual(['mod-a', 'mod-b'])
    expect(toggledModuleIds(current, 'mod-a')).toEqual([])
    expect(current).toEqual(['mod-a'])
  })

  it('routes selected-chat module toggles through a chat command under the resource guard', async () => {
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    expect(() => {
      getDatabase().characters[0].chats[0].modules.push('direct')
    }).toThrow()

    toggleSelectedChatModule('mod-b')

    expect(getDatabase().characters[0].chats[0].modules).toEqual(['mod-a', 'mod-b'])
    expect(() => {
      getDatabase().characters[0].chats[0].modules.push('direct')
    }).toThrow()

    await waitForCallCount(calls, 2)
    expect(calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'module-command-token',
        body: null,
      },
      {
        url: '/api/v1/commands/chats/chat-a',
        method: 'PATCH',
        authHeader: 'module-command-token',
        body: {
          baseRevision: 10,
          patch: { modules: ['mod-a', 'mod-b'] },
          select: false,
        },
      },
    ])
  })

  it('prefills active sidebar toggle defaults when enabling a chat-scoped module', async () => {
    const calls = stubCommandFetch()
    getDatabase().personas = [{ id: 'persona-a', name: 'Persona A', personaPrompt: '', icon: '', note: '' }] as any
    getDatabase().modelPresets = [{ id: 'model-a', name: 'Model A' }] as any
    getDatabase().promptPresets = [{ id: 'preset-a', name: 'Preset A', customPromptTemplateToggle: '' }] as any
    getDatabase().modules = [
      { id: 'mod-a', name: 'Module A', customModuleToggle: 'existing=Existing' },
      {
        id: 'mod-b',
        name: 'Module B',
        customModuleToggle: 'flag=Flag\nmode=Mode=select=alpha,beta\nnote=Note=text\nmemo=Memo=textarea',
      },
    ] as any
    getDatabase().characters[0].chats[0].generationSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {
        existing: '1',
        mode: '1',
      },
    }
    setResourceWriteGuardEnabled(true)

    toggleSelectedChatModule('mod-b')

    const expectedSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {
        existing: '1',
        mode: '1',
        flag: '0',
        note: '',
        memo: '',
      },
    }
    expect(getDatabase().characters[0].chats[0].modules).toEqual(['mod-a', 'mod-b'])
    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(expectedSettings)

    await waitForCallCount(calls, 3)
    expect(calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'module-command-token',
        body: null,
      },
      {
        url: '/api/v1/commands/chats/chat-a',
        method: 'PATCH',
        authHeader: 'module-command-token',
        body: {
          baseRevision: 10,
          patch: { modules: ['mod-a', 'mod-b'] },
          select: false,
        },
      },
      {
        url: '/api/v1/commands/chats/chat-a/generation-settings',
        method: 'PUT',
        authHeader: 'module-command-token',
        body: {
          baseRevision: 11,
          generationSettings: expectedSettings,
        },
      },
    ])
  })

  it('routes selected-character module toggles through the character-module command', async () => {
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    expect(() => {
      getDatabase().characters[0].modules.push('direct')
    }).toThrow()

    toggleSelectedCharacterModule('mod-b')

    expect(getDatabase().characters[0].modules).toEqual(['mod-a', 'mod-b'])
    expect(() => {
      getDatabase().characters[0].modules.push('direct')
    }).toThrow()

    await waitForCallCount(calls, 2)
    expect(calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'module-command-token',
        body: null,
      },
      {
        url: '/api/v1/commands/characters/char-a/modules/reorder',
        method: 'POST',
        authHeader: 'module-command-token',
        body: {
          baseRevision: 10,
          moduleIds: ['mod-a', 'mod-b'],
        },
      },
    ])
  })

  it('prefills active sidebar toggle defaults when enabling a character-scoped module', async () => {
    const calls = stubCommandFetch()
    getDatabase().personas = [{ id: 'persona-a', name: 'Persona A', personaPrompt: '', icon: '', note: '' }] as any
    getDatabase().modelPresets = [{ id: 'model-a', name: 'Model A' }] as any
    getDatabase().promptPresets = [{ id: 'preset-a', name: 'Preset A', customPromptTemplateToggle: '' }] as any
    getDatabase().modules = [
      { id: 'mod-a', name: 'Module A', customModuleToggle: 'existing=Existing' },
      {
        id: 'mod-b',
        name: 'Module B',
        customModuleToggle: 'flag=Flag\nmode=Mode=select=alpha,beta\nnote=Note=text\nmemo=Memo=textarea',
      },
    ] as any
    getDatabase().characters[0].chats[0].modules = []
    getDatabase().characters[0].chats[0].generationSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {
        existing: '1',
        mode: '1',
      },
    }
    setResourceWriteGuardEnabled(true)

    toggleSelectedCharacterModule('mod-b')

    const expectedSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {
        existing: '1',
        mode: '1',
        flag: '0',
        note: '',
        memo: '',
      },
    }
    expect(getDatabase().characters[0].modules).toEqual(['mod-a', 'mod-b'])
    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(expectedSettings)

    await waitForCallCount(calls, 3)
    expect(calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'module-command-token',
        body: null,
      },
      {
        url: '/api/v1/commands/characters/char-a/modules/reorder',
        method: 'POST',
        authHeader: 'module-command-token',
        body: {
          baseRevision: 10,
          moduleIds: ['mod-a', 'mod-b'],
        },
      },
      {
        url: '/api/v1/commands/chats/chat-a/generation-settings',
        method: 'PUT',
        authHeader: 'module-command-token',
        body: {
          baseRevision: 11,
          generationSettings: expectedSettings,
        },
      },
    ])
  })

  it('routes global module edits through commands under the resource guard', async () => {
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    expect(() => {
      getDatabase().enabledModules.push('direct')
    }).toThrow()

    setGlobalModuleEnabled('mod-a', true)
    expect(getDatabase().enabledModules).toEqual(['mod-a'])
    await waitForCallCount(calls, 2)

    createGlobalModule({ id: 'mod-c', name: 'Module C', description: '' })
    expect(getDatabase().modules.map((module) => module.id)).toEqual(['mod-a', 'mod-b', 'mod-c'])
    await waitForCallCount(calls, 3)

    updateGlobalModule('mod-a', { id: 'mod-a', name: 'Module A renamed', description: '' })
    expect(getDatabase().modules[0].name).toBe('Module A renamed')
    await waitForCallCount(calls, 4)

    deleteGlobalModule('mod-a')

    expect(getDatabase().enabledModules).toEqual([])
    expect(getDatabase().modules.map((module) => module.id)).toEqual(['mod-b', 'mod-c'])
    expect(getDatabase().characters[0].modules).toEqual([])
    expect(getDatabase().characters[0].chats[0].modules).toEqual([])

    await waitForCallCount(calls, 5)
    expect(calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'module-command-token',
        body: null,
      },
      {
        url: '/api/v1/commands/modules/enable',
        method: 'POST',
        authHeader: 'module-command-token',
        body: {
          baseRevision: expect.any(Number),
          moduleId: 'mod-a',
          enabled: true,
        },
      },
      {
        url: '/api/v1/commands/modules',
        method: 'POST',
        authHeader: 'module-command-token',
        body: {
          baseRevision: expect.any(Number),
          module: { id: 'mod-c', name: 'Module C', description: '' },
        },
      },
      {
        url: '/api/v1/commands/modules/mod-a',
        method: 'PATCH',
        authHeader: 'module-command-token',
        body: {
          baseRevision: expect.any(Number),
          patch: { name: 'Module A renamed', description: '' },
        },
      },
      {
        url: '/api/v1/commands/modules/mod-a',
        method: 'DELETE',
        authHeader: 'module-command-token',
        body: {
          baseRevision: expect.any(Number),
        },
      },
    ])
  })

  it('optimistically applies global module textarea fields and rolls back on command failure', async () => {
    const calls = stubFailingCommandFetch()
    getDatabase().modules[0] = {
      id: 'mod-a',
      name: 'Module A',
      description: '',
      backgroundEmbedding: 'old background',
    } as any
    setResourceWriteGuardEnabled(true)

    expect(() => {
      getDatabase().modules[0].backgroundEmbedding = 'direct'
    }).toThrow()

    updateGlobalModule('mod-a', {
      id: 'mod-a',
      name: 'Module A',
      description: '',
      backgroundEmbedding: 'new background',
    })

    expect(getDatabase().modules[0].backgroundEmbedding).toBe('new background')

    await waitForCallCount(calls, 2)

    expect(calls[1]).toEqual({
      url: '/api/v1/commands/modules/mod-a',
      method: 'PATCH',
      authHeader: 'module-command-token',
      body: {
        baseRevision: 10,
        patch: {
          name: 'Module A',
          description: '',
          backgroundEmbedding: 'new background',
        },
      },
    })
    expect(getDatabase().modules[0].backgroundEmbedding).toBe('old background')
  })

  it('optimistically applies global module create and rolls back on command failure', async () => {
    const calls = stubFailingCommandFetch()
    setResourceWriteGuardEnabled(true)

    createGlobalModule({ id: 'mod-c', name: 'Module C', description: '' })

    expect(getDatabase().modules.map((module) => module.id)).toEqual(['mod-a', 'mod-b', 'mod-c'])

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(getDatabase().modules.map((module) => module.id)).toEqual(['mod-a', 'mod-b'])
  })

  it('optimistically applies global module delete references and rolls back on command failure', async () => {
    const calls = stubFailingCommandFetch()
    getDatabase().enabledModules = ['mod-a']
    getDatabase().characters = [
      {
        chaId: 'char-a',
        name: 'Character A',
        chatPage: 0,
        chats: [{ id: 'chat-a', name: 'Chat A', modules: ['mod-a', 'chat-module'], message: [] }],
        modules: ['mod-a', 'character-module'],
      },
    ] as any
    setResourceWriteGuardEnabled(true)

    deleteGlobalModule('mod-a')

    expect(getDatabase().enabledModules).toEqual([])
    expect(getDatabase().modules.map((module) => module.id)).toEqual(['mod-b'])
    expect(getDatabase().characters[0].modules).toEqual(['character-module'])
    expect(getDatabase().characters[0].chats[0].modules).toEqual(['chat-module'])

    withTrustedResourceWrite(() => {
      getDatabase().characters[0].name = 'Concurrent character edit'
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(getDatabase().enabledModules).toEqual(['mod-a'])
    expect(getDatabase().modules.map((module) => module.id)).toEqual(['mod-a', 'mod-b'])
    expect(getDatabase().characters[0].modules).toEqual(['mod-a', 'character-module'])
    expect(getDatabase().characters[0].chats[0].modules).toEqual(['mod-a', 'chat-module'])
    expect(getDatabase().characters[0].name).toBe('Concurrent character edit')
  })

  it('failed module update preserves newer same-module field edit', async () => {
    const calls = stubFailingCommandFetch()
    getDatabase().modules[0] = { id: 'mod-a', name: 'Module A', description: 'old description' } as any
    setResourceWriteGuardEnabled(true)

    updateGlobalModule('mod-a', { id: 'mod-a', name: 'Attempted A', description: 'attempted description' })
    expect(getDatabase().modules[0]).toMatchObject({
      name: 'Attempted A',
      description: 'attempted description',
    })

    withTrustedResourceWrite(() => {
      getDatabase().modules[0] = {
        ...getDatabase().modules[0],
        name: 'Newer A',
      }
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(getDatabase().modules[0]).toMatchObject({
      name: 'Newer A',
      description: 'old description',
    })
  })

  it('failed module update preserves sibling module edit, create, and delete', async () => {
    const calls = stubFailingCommandFetch()
    setResourceWriteGuardEnabled(true)

    updateGlobalModule('mod-a', { id: 'mod-a', name: 'Attempted A', description: 'attempted description' })
    withTrustedResourceWrite(() => {
      getDatabase().modules[1] = {
        ...getDatabase().modules[1],
        name: 'Sibling B newer',
      }
      getDatabase().modules.push({ id: 'mod-c', name: 'Sibling C newer' } as any)
      getDatabase().modules = getDatabase().modules.filter((module) => module.id !== 'mod-b')
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(moduleNames()).toEqual({
      'mod-a': 'Module A',
      'mod-c': 'Sibling C newer',
    })
  })

  it('failed create removes only the attempted created module, not later-created modules', async () => {
    const calls = stubFailingCommandFetch()
    setResourceWriteGuardEnabled(true)

    createGlobalModule({ id: 'mod-c', name: 'Module C', description: '' })
    withTrustedResourceWrite(() => {
      getDatabase().modules.push({ id: 'mod-d', name: 'Module D newer' } as any)
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(getDatabase().modules.map((module) => module.id)).toEqual(['mod-a', 'mod-b', 'mod-d'])
  })

  it('failed enable restores only that module id and preserves newer enabled sibling changes', async () => {
    const calls = stubFailingCommandFetch()
    getDatabase().enabledModules = ['mod-b']
    setResourceWriteGuardEnabled(true)

    setGlobalModuleEnabled('mod-a', true)
    expect(getDatabase().enabledModules).toEqual(['mod-b', 'mod-a'])

    withTrustedResourceWrite(() => {
      getDatabase().enabledModules = getDatabase().enabledModules.filter((id) => id !== 'mod-b')
      getDatabase().enabledModules.push('mod-c')
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(getDatabase().enabledModules).toEqual(['mod-c'])
  })

  it('failed delete reinserts only deleted module and restores references only while they match attempted deletion', async () => {
    const calls = stubFailingCommandFetch()
    getDatabase().enabledModules = ['mod-a', 'mod-b']
    getDatabase().characters = [
      {
        chaId: 'char-a',
        name: 'Character A',
        chatPage: 0,
        chats: [
          { id: 'chat-a', name: 'Chat A', modules: ['mod-a', 'chat-module'], message: [] },
          { id: 'chat-b', name: 'Chat B', modules: ['mod-a', 'changed-chat'], message: [] },
        ],
        modules: ['mod-a', 'character-module'],
      },
      {
        chaId: 'char-b',
        name: 'Character B',
        chatPage: 0,
        chats: [{ id: 'chat-c', name: 'Chat C', modules: ['mod-a', 'changed-character-chat'], message: [] }],
        modules: ['mod-a', 'changed-character'],
      },
    ] as any
    getDatabase().loadouts = [
      { id: 'loadout-a', name: 'Loadout A', modules: ['mod-a', 'loadout-module'] },
      { id: 'loadout-b', name: 'Loadout B', modules: ['mod-a', 'changed-loadout'] },
    ] as any
    setResourceWriteGuardEnabled(true)

    deleteGlobalModule('mod-a')
    expect(getDatabase().modules.map((module) => module.id)).toEqual(['mod-b'])
    expect(getDatabase().enabledModules).toEqual(['mod-b'])
    expect(getDatabase().characters[0].modules).toEqual(['character-module'])
    expect(getDatabase().characters[0].chats[0].modules).toEqual(['chat-module'])
    expect(getDatabase().loadouts[0].modules).toEqual(['loadout-module'])

    withTrustedResourceWrite(() => {
      getDatabase().modules.push({ id: 'mod-c', name: 'Newer Module C' } as any)
      getDatabase().enabledModules.push('mod-c')
      getDatabase().characters[1].modules = ['newer-character-ref']
      getDatabase().characters[1].chats[0].modules = ['newer-chat-ref']
      getDatabase().loadouts[1].modules = ['newer-loadout-ref']
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(getDatabase().modules.map((module) => module.id)).toEqual(['mod-a', 'mod-b', 'mod-c'])
    expect(getDatabase().enabledModules).toEqual(['mod-a', 'mod-b', 'mod-c'])
    expect(getDatabase().characters[0].modules).toEqual(['mod-a', 'character-module'])
    expect(getDatabase().characters[0].chats[0].modules).toEqual(['mod-a', 'chat-module'])
    expect(getDatabase().characters[1].modules).toEqual(['newer-character-ref'])
    expect(getDatabase().characters[1].chats[0].modules).toEqual(['newer-chat-ref'])
    expect(getDatabase().loadouts[0].modules).toEqual(['mod-a', 'loadout-module'])
    expect(getDatabase().loadouts[1].modules).toEqual(['newer-loadout-ref'])
  })

  it('serialized overlapping update failures unwind correctly', async () => {
    const firstUpdate = createDeferred<Response>()
    const secondUpdate = createDeferred<Response>()
    const updateResponses = [firstUpdate, secondUpdate]
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
        if (url === '/api/v1/commands/modules/mod-a') {
          const response = updateResponses.shift()
          if (!response) return jsonResponse({ error: 'unexpected update' }, 500)
          return response.promise
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    setResourceWriteGuardEnabled(true)

    updateGlobalModule('mod-a', { id: 'mod-a', name: 'Attempted One', description: '' })
    updateGlobalModule('mod-a', { id: 'mod-a', name: 'Attempted Two', description: '' })

    // One bootstrap + the first command. The global revisioned-mutation lane
    // deliberately holds the second request until the first settles.
    await waitForCallCount(calls, 2)
    expect(getDatabase().modules[0].name).toBe('Attempted Two')

    firstUpdate.resolve(jsonResponse({ error: 'first failed' }, 500))
    await waitForCallCount(calls, 3)
    await flushCommandEffects()
    expect(getDatabase().modules[0].name).toBe('Attempted Two')

    secondUpdate.resolve(jsonResponse({ error: 'second failed' }, 500))
    await flushCommandEffects()
    expect(getDatabase().modules[0].name).toBe('Module A')
  })
})

describe('Phase 3 chat-scoped module toggle (L34)', () => {
  it('L34: toggling a chat module captures a chat-scoped baseline, never the whole characters array', async () => {
    setDatabaseLite(seedCloneCostDb() as any) // char-0 large (40 messages), siblings small
    getDatabase().enabledModules = []
    getDatabase().modules = [{ id: 'mod-a', name: 'Module A' }] as any
    selectedCharID.set(1)
    const charactersSize = JSON.stringify(getDatabase().characters).length
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ revision: 10 })) as unknown as typeof fetch)

    const instrumented = withCloneInstrumentation(() => {
      toggleSelectedChatModule('mod-a')
    })

    // The rollback capture + dispatch payload stay bounded to the one active
    // chat; the large sibling (char-0) transcript is never serialized.
    expect(instrumented.maxClonedSize).toBeLessThan(charactersSize)
    expect(getDatabase().characters[1].chats[0].modules).toEqual(['mod-a'])

    // drain the async dispatch so it does not leak into the next test
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('L34: a failed toggle restores only the active chat row, preserving sibling edits', async () => {
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        calls.push({
          url,
          method: init.method ?? 'GET',
          authHeader: null,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
        return jsonResponse({ error: 'nope' }, 500)
      }) as unknown as typeof fetch,
    )
    setDatabaseLite({
      characters: [
        {
          chaId: 'char-a',
          name: 'Character',
          chatPage: 0,
          chats: [
            { id: 'chat-a', name: 'Chat A', modules: ['mod-a'], message: [] },
            { id: 'chat-b', name: 'Chat B', modules: [], message: [] },
          ],
          modules: [],
        },
      ],
      characterOrder: [],
      enabledModules: [],
      modules: [{ id: 'mod-a', name: 'Module A' }],
    } as any)
    selectedCharID.set(0)

    toggleSelectedChatModule('mod-a')
    expect(getDatabase().characters[0].chats[0].modules).toEqual([])
    // a concurrent, unrelated edit to ANOTHER chat row a whole-array restore would wipe
    getDatabase().characters[0].chats[1].name = 'Concurrent sibling edit'

    await waitForCallCount(calls, 2)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(getDatabase().characters[0].chats[0].modules).toEqual(['mod-a'])
    expect(getDatabase().characters[0].chats[1].name).toBe('Concurrent sibling edit')
  })
})

describe('Phase 4 module snapshot narrowing (M10)', () => {
  it('M10: global module snapshots clone only modules and enabledModules', () => {
    setDatabaseLite(
      seedCloneCostDb({
        characterCount: 3,
        hydratedMessageCount: 40,
        messageBodySize: 300,
      }) as any,
    )
    getDatabase().modules = [{ id: 'mod-a', name: 'Module A' }] as any
    getDatabase().enabledModules = ['mod-a']
    const charactersSize = JSON.stringify(getDatabase().characters).length

    const instrumented = withCloneInstrumentation(() => currentGlobalModuleStateSnapshot())

    expect(instrumented.result).toEqual({
      modules: [{ id: 'mod-a', name: 'Module A' }],
      enabledModules: ['mod-a'],
    })
    expect('characters' in instrumented.result).toBe(false)
    expect(instrumented.maxClonedSize).toBeLessThan(charactersSize)
  })

  it('M10: character-module snapshots clone and restore only the target modules field', () => {
    setDatabaseLite(
      seedCloneCostDb({
        characterCount: 2,
        hydratedMessageCount: 40,
        messageBodySize: 300,
      }) as any,
    )
    getDatabase().characters[0].modules = ['sibling-original']
    getDatabase().characters[1].modules = ['mod-a']
    getDatabase().characters[1].notes = 'same-row payload '.repeat(500)
    const charactersSize = JSON.stringify(getDatabase().characters).length
    const targetCharacterSize = JSON.stringify(getDatabase().characters[1]).length

    const instrumented = withCloneInstrumentation(() => currentCharacterModuleStateSnapshot('char-1'))
    const snapshot = instrumented.result

    expect(snapshot).toEqual({
      characterId: 'char-1',
      hasModulesField: true,
      modules: ['mod-a'],
    })
    expect(snapshot && 'characters' in snapshot).toBe(false)
    expect(instrumented.maxClonedSize).toBeLessThan(targetCharacterSize)
    expect(instrumented.maxClonedSize).toBeLessThan(charactersSize)

    getDatabase().characters[0].modules = ['sibling-concurrent']
    getDatabase().characters[1].name = 'Concurrent same-row edit'
    getDatabase().characters[1].modules = ['mod-b']
    restoreCharacterModuleState(snapshot!)

    expect(getDatabase().characters[1].modules).toEqual(['mod-a'])
    expect(getDatabase().characters[1].name).toBe('Concurrent same-row edit')
    expect(getDatabase().characters[0].modules).toEqual(['sibling-concurrent'])
  })

  it('M10: forced-failure global rollback preserves concurrent character edits', async () => {
    const calls = stubFailingCommandFetch()
    getDatabase().characters = [
      {
        chaId: 'char-a',
        name: 'Character A',
        chatPage: 0,
        chats: [{ id: 'chat-a', name: 'Chat A', modules: [], message: [] }],
        modules: ['char-module'],
      },
    ] as any
    getDatabase().modules = [
      { id: 'mod-a', name: 'Module A' },
      { id: 'mod-b', name: 'Module B' },
    ] as any
    getDatabase().enabledModules = []

    setGlobalModuleEnabled('mod-a', true)
    expect(getDatabase().enabledModules).toEqual(['mod-a'])

    getDatabase().characters[0].name = 'Concurrent character edit'

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(getDatabase().enabledModules).toEqual([])
    expect(getDatabase().modules.map((module) => module.id)).toEqual(['mod-a', 'mod-b'])
    expect(getDatabase().characters[0].name).toBe('Concurrent character edit')
    expect(getDatabase().characters[0].modules).toEqual(['char-module'])
  })

  it('M10: forced-failure character-module rollback preserves sibling and same-row edits', async () => {
    const calls = stubFailingCommandFetch()
    getDatabase().characters = [
      {
        chaId: 'char-a',
        name: 'Character A',
        notes: 'original notes',
        chatPage: 0,
        chats: [{ id: 'chat-a', name: 'Chat A', modules: [], message: [] }],
        modules: ['mod-a'],
      },
      {
        chaId: 'char-b',
        name: 'Character B',
        chatPage: 0,
        chats: [{ id: 'chat-b', name: 'Chat B', modules: [], message: [] }],
        modules: ['mod-b'],
      },
    ] as any
    selectedCharID.set(0)

    toggleSelectedCharacterModule('mod-c')
    expect(getDatabase().characters[0].modules).toEqual(['mod-a', 'mod-c'])

    getDatabase().characters[0].notes = 'Concurrent same-row edit'
    getDatabase().characters[1].name = 'Concurrent sibling edit'

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(getDatabase().characters[0].modules).toEqual(['mod-a'])
    expect(getDatabase().characters[0].notes).toBe('Concurrent same-row edit')
    expect(getDatabase().characters[1].name).toBe('Concurrent sibling edit')
    expect(getDatabase().characters[1].modules).toEqual(['mod-b'])
  })

  it('M10: character-module rollback uses stable ids across index shifts', async () => {
    const calls = stubFailingCommandFetch()
    getDatabase().characters = [
      {
        chaId: 'char-a',
        name: 'Character A',
        chatPage: 0,
        chats: [{ id: 'chat-a', name: 'Chat A', modules: [], message: [] }],
        modules: ['mod-a'],
      },
      {
        chaId: 'char-b',
        name: 'Character B',
        chatPage: 0,
        chats: [{ id: 'chat-b', name: 'Chat B', modules: [], message: [] }],
        modules: ['mod-b'],
      },
    ] as any
    selectedCharID.set(1)

    toggleSelectedCharacterModule('mod-c')
    expect(getDatabase().characters[1].modules).toEqual(['mod-b', 'mod-c'])

    const [target] = getDatabase().characters.splice(1, 1)
    getDatabase().characters.unshift(target)

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(getDatabase().characters.map((character) => character.chaId)).toEqual(['char-b', 'char-a'])
    expect(getDatabase().characters[0].modules).toEqual(['mod-b'])
    expect(getDatabase().characters[1].modules).toEqual(['mod-a'])
  })
})
