import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

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

import { clearCachedServerCommandRevision, setCachedServerCommandRevision } from './server/commands'
import {
  clearPendingMutationOutbox,
  listPendingMutations,
  preparePendingMutationOutbox,
  resetPendingMutationOutboxForTests,
  stagePendingMutation,
  type DurableMutationIntent,
} from './server/pendingMutationOutbox'
import { replayPendingMutations } from './server/pendingMutationReplay'
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
  createGlobalModuleWithOutcome,
  deleteGlobalModule,
  dispatchModuleInfoPatch,
  dispatchReorderModules,
  rebaseModuleDraftOntoLatest,
  rebaseModuleEditorDraftOntoLatest,
  restoreCharacterModuleState,
  saveGlobalModuleDraft,
  saveGlobalModuleDraftWithOutcome,
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

function stubModuleDraftSaveFetch(): CapturedFetch[] {
  const calls: CapturedFetch[] = []
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

      revision += 1
      const common = { revision, moduleId: 'mod-a' }
      if (url === '/api/v1/commands/modules/mod-a') {
        return jsonResponse({
          ...common,
          event: { type: 'module.updated', revision, resource: 'moduleUpdated', id: 'mod-a' },
        })
      }
      if (url === '/api/v1/commands/modules/mod-a/lorebooks') {
        return jsonResponse({
          ...common,
          event: { type: 'lorebook.entries.replaced', revision, resource: 'moduleUpdated', id: 'mod-a' },
        })
      }
      if (url === '/api/v1/commands/modules/mod-a/scripts') {
        return jsonResponse({
          ...common,
          event: {
            type: 'scriptDefinitions.replaced',
            revision,
            resource: 'moduleScriptDefinition',
            id: 'mod-a',
          },
        })
      }
      if (url === '/api/v1/commands/modules/mod-a/triggers') {
        return jsonResponse({
          ...common,
          event: {
            type: 'triggerDefinitions.replaced',
            revision,
            resource: 'moduleTriggerDefinition',
            id: 'mod-a',
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

  it('retains both chat-module defaults as one replayable batch after a transient first-step failure', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-chat-module-defaults',
      writerEpoch: 12,
      databaseLineage: 'lineage-chat-module-defaults',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(20)

    getDatabase().personas = [{ id: 'persona-a', name: 'Persona A', personaPrompt: '', icon: '', note: '' }] as any
    getDatabase().modelPresets = [{ id: 'model-a', name: 'Model A' }] as any
    getDatabase().promptPresets = [{ id: 'preset-a', name: 'Preset A', customPromptTemplateToggle: '' }] as any
    getDatabase().modules = [
      { id: 'mod-a', name: 'Module A' },
      { id: 'mod-b', name: 'Module B', customModuleToggle: 'flag=Flag' },
    ] as any
    getDatabase().characters[0].chats[0].generationSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {},
    }
    setResourceWriteGuardEnabled(true)

    let recover = false
    let revision = 20
    const commands: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        if (url === '/api/v1/commands/chats/chat-a') {
          commands.push(url)
          if (!recover) return jsonResponse({ error: 'temporarily unavailable' }, 500)
          revision += 1
          return jsonResponse({
            revision,
            event: { type: 'chat.updated', revision, resource: 'chat', id: 'chat-a' },
            chatId: 'chat-a',
          })
        }
        if (url === '/api/v1/commands/chats/chat-a/generation-settings') {
          commands.push(url)
          if (!recover) throw new Error('generation defaults overtook the retained module link')
          revision += 1
          return jsonResponse({
            revision,
            event: { type: 'chat.generationSettings.updated', revision, resource: 'chat', id: 'chat-a' },
            chatId: 'chat-a',
          })
        }
        return jsonResponse({ error: `unexpected ${init.method ?? 'GET'} ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      const mutation = toggleSelectedChatModule('mod-b')

      await vi.waitFor(() => expect(commands).toEqual(['/api/v1/commands/chats/chat-a']))
      await vi.waitFor(async () => {
        expect(
          (await listPendingMutations()).map((entry) => ({
            key: entry.handle.key,
            path: entry.intent.requests[0]?.path,
          })),
        ).toEqual([
          { key: 'character-owner:char-a', path: '/chats/chat-a' },
          { key: 'character-owner:char-a', path: '/chats/chat-a/generation-settings' },
        ])
      })
      expect(getDatabase().characters[0].chats[0].modules).toEqual(['mod-a', 'mod-b'])
      expect(getDatabase().characters[0].chats[0].generationSettings?.sidebarToggles).toEqual({ flag: '0' })
      const queued = await mutation
      expect(queued).toMatchObject({
        status: 'queued',
        result: { status: 'error' },
        mutationIds: expect.arrayContaining([expect.any(String)]),
      })

      recover = true
      await expect(replayPendingMutations()).resolves.toMatchObject({ succeeded: 2 })
      expect(commands).toEqual([
        '/api/v1/commands/chats/chat-a',
        '/api/v1/commands/chats/chat-a',
        '/api/v1/commands/chats/chat-a/generation-settings',
      ])
      expect(await listPendingMutations()).toEqual([])
      if (queued.status !== 'queued') throw new Error('Expected the module mutation to be retained')
      await expect(queued.settlement).resolves.toEqual({ status: 'accepted' })
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('reports and rolls back a retained chat-module toggle when replay is discarded', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-chat-module-discard',
      writerEpoch: 16,
      databaseLineage: 'lineage-chat-module-discard',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(60)
    setResourceWriteGuardEnabled(true)

    let replaying = false
    const commands: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        if (url === '/api/v1/commands/chats/chat-a') {
          commands.push(url)
          if (!replaying) return jsonResponse({ error: 'temporarily unavailable' }, 500)
          return jsonResponse({ error: 'module link is invalid', reason: 'invalid-request' }, 400)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      const queued = await toggleSelectedChatModule('mod-b')
      expect(queued).toMatchObject({ status: 'queued', result: { status: 'error' } })
      if (queued.status !== 'queued') throw new Error('Expected the module mutation to be retained')
      expect(getDatabase().characters[0].chats[0].modules).toEqual(['mod-a', 'mod-b'])

      replaying = true
      await expect(replayPendingMutations()).resolves.toMatchObject({ discarded: 1, retained: 0 })
      await expect(queued.settlement).resolves.toMatchObject({
        status: 'failed',
        result: { status: 'error', error: 'module link is invalid' },
      })
      await vi.waitFor(() => expect(getDatabase().characters[0].chats[0].modules).toEqual(['mod-a']))
      expect(commands).toEqual(['/api/v1/commands/chats/chat-a', '/api/v1/commands/chats/chat-a'])
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('rolls back both compound defaults when the module-link request is terminally rejected', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-chat-module-terminal',
      writerEpoch: 13,
      databaseLineage: 'lineage-chat-module-terminal',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(30)

    getDatabase().personas = [{ id: 'persona-a', name: 'Persona A', personaPrompt: '', icon: '', note: '' }] as any
    getDatabase().modelPresets = [{ id: 'model-a', name: 'Model A' }] as any
    getDatabase().promptPresets = [{ id: 'preset-a', name: 'Preset A', customPromptTemplateToggle: '' }] as any
    getDatabase().modules[1] = { id: 'mod-b', name: 'Module B', customModuleToggle: 'flag=Flag' } as any
    const initialSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {},
    }
    getDatabase().characters[0].chats[0].generationSettings = initialSettings
    setResourceWriteGuardEnabled(true)

    const commands: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        commands.push(url)
        if (url === '/api/v1/commands/chats/chat-a') {
          return jsonResponse({ error: 'chat no longer exists' }, 404)
        }
        throw new Error('terminally rejected batch sent a later request')
      }) as unknown as typeof fetch,
    )

    try {
      const mutation = toggleSelectedChatModule('mod-b')
      await vi.waitFor(() => expect(commands).toEqual(['/api/v1/commands/chats/chat-a']))
      await vi.waitFor(() => expect(getDatabase().characters[0].chats[0].modules).toEqual(['mod-a']))
      await expect(mutation).resolves.toMatchObject({
        status: 'failed',
        result: { status: 'error', reason: 'not-found' },
      })
      expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(initialSettings)
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('preserves an accepted module link while rolling back only rejected generation defaults', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-chat-module-prefix',
      writerEpoch: 15,
      databaseLineage: 'lineage-chat-module-prefix',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(50)

    getDatabase().personas = [{ id: 'persona-a', name: 'Persona A', personaPrompt: '', icon: '', note: '' }] as any
    getDatabase().modelPresets = [{ id: 'model-a', name: 'Model A' }] as any
    getDatabase().promptPresets = [{ id: 'preset-a', name: 'Preset A', customPromptTemplateToggle: '' }] as any
    getDatabase().modules[1] = { id: 'mod-b', name: 'Module B', customModuleToggle: 'flag=Flag' } as any
    const initialSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {},
    }
    getDatabase().characters[0].chats[0].generationSettings = initialSettings
    setResourceWriteGuardEnabled(true)

    let revision = 50
    const commands: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        commands.push(url)
        if (url === '/api/v1/commands/chats/chat-a') {
          revision += 1
          return jsonResponse({
            revision,
            event: { type: 'chat.updated', revision, resource: 'chat', id: 'chat-a' },
            chatId: 'chat-a',
          })
        }
        if (url === '/api/v1/commands/chats/chat-a/generation-settings') {
          return jsonResponse({ error: 'preset no longer exists' }, 404)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      toggleSelectedChatModule('mod-b')
      await vi.waitFor(() =>
        expect(commands).toEqual([
          '/api/v1/commands/chats/chat-a',
          '/api/v1/commands/chats/chat-a/generation-settings',
        ]),
      )
      await vi.waitFor(() => expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(initialSettings))
      expect(getDatabase().characters[0].chats[0].modules).toEqual(['mod-a', 'mod-b'])
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('keeps a reordered global module list durable across a transient request failure', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-module-order',
      writerEpoch: 14,
      databaseLineage: 'lineage-module-order',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(40)
    setResourceWriteGuardEnabled(true)

    const previous = currentGlobalModuleStateSnapshot()
    withTrustedResourceWrite(() => {
      getDatabase().modules = [...getDatabase().modules].reverse()
    })

    let recover = false
    let revision = 40
    const commands: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        if (url !== '/api/v1/commands/modules/reorder') {
          return jsonResponse({ error: `unexpected ${url}` }, 404)
        }
        commands.push(url)
        if (!recover) return jsonResponse({ error: 'temporarily unavailable' }, 500)
        revision += 1
        return jsonResponse({
          revision,
          event: { type: 'module.reordered', revision, resource: 'moduleReordered' },
        })
      }) as unknown as typeof fetch,
    )

    try {
      dispatchReorderModules(previous)
      await vi.waitFor(() => expect(commands).toHaveLength(1))
      await vi.waitFor(async () => {
        expect(
          (await listPendingMutations()).map((entry) => ({
            key: entry.handle.key,
            path: entry.intent.requests[0]?.path,
            body: entry.intent.requests[0]?.body,
          })),
        ).toEqual([
          {
            key: 'module-collection',
            path: '/modules/reorder',
            body: { moduleIds: ['mod-b', 'mod-a'] },
          },
        ])
      })
      expect(getDatabase().modules.map((module) => module.id)).toEqual(['mod-b', 'mod-a'])

      recover = true
      await expect(replayPendingMutations()).resolves.toMatchObject({ succeeded: 1 })
      expect(commands).toHaveLength(2)
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
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

  it('normalizes module lorebook, regex, and trigger identities before create dispatch', async () => {
    const calls = stubCommandFetch()
    const module = {
      id: 'mod-import',
      name: 'Imported module',
      description: '',
      lorebook: [{ id: 'duplicate', content: 'First' }, { id: 'duplicate', content: 'Second' }, { content: 'Third' }],
      regex: [{ comment: 'Regex' }],
      trigger: [{ comment: 'Trigger', type: 'manual', conditions: [], effect: [] }],
    } as any

    const result = createGlobalModule(module)
    await waitForCallCount(calls, 2)
    await expect(result).resolves.toMatchObject({ status: 'ok' })

    const sent = (calls[1].body as { module: typeof module }).module
    expect(sent.lorebook[0].id).toBe('duplicate')
    expect(new Set(sent.lorebook.map((entry: { id: string }) => entry.id)).size).toBe(3)
    expect(sent.regex[0].id).toEqual(expect.any(String))
    expect(sent.trigger[0].id).toEqual(expect.any(String))
  })

  it('keeps a new module edit behind its transient durable create', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-module-create-update',
      writerEpoch: 9,
      databaseLineage: 'lineage-module-create-update',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(20)
    setResourceWriteGuardEnabled(true)

    const firstCreate = createDeferred<Response>()
    let recover = false
    let revision = 20
    const commands: Array<{ method: string; url: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        const method = init.method ?? 'GET'
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        if (url === '/api/v1/commands/modules' && method === 'POST') {
          commands.push({ method, url })
          if (commands.length === 1) return firstCreate.promise
          if (!recover) return jsonResponse({ error: 'temporarily unavailable' }, 500)
          revision += 1
          return jsonResponse({
            revision,
            event: { type: 'module.created', revision, resource: 'module', id: 'mod-new' },
            moduleId: 'mod-new',
          })
        }
        if (url === '/api/v1/commands/modules/mod-new' && method === 'PATCH') {
          commands.push({ method, url })
          if (!recover) throw new Error('module update overtook retained create')
          revision += 1
          return jsonResponse({
            revision,
            event: { type: 'module.updated', revision, resource: 'module', id: 'mod-new' },
            moduleId: 'mod-new',
          })
        }
        return jsonResponse({ error: `unexpected ${method} ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      const createResult = createGlobalModule({ id: 'mod-new', name: 'New Module', description: '' })
      await vi.waitFor(() => expect(commands).toHaveLength(1))
      const updateResult = updateGlobalModule('mod-new', {
        id: 'mod-new',
        name: 'Edited before create recovered',
        description: '',
      })
      firstCreate.resolve(jsonResponse({ error: 'temporarily unavailable' }, 500))

      await expect(createResult).resolves.toMatchObject({ status: 'error' })
      await expect(updateResult).resolves.toMatchObject({ status: 'unavailable' })
      expect(commands.map(({ method }) => method)).toEqual(['POST', 'POST'])
      expect(
        (await listPendingMutations()).map((entry) => ({
          key: entry.handle.key,
          method: entry.intent.requests[0]?.method,
        })),
      ).toEqual([
        { key: 'module-owner:mod-new', method: 'POST' },
        { key: 'module-owner:mod-new', method: 'PATCH' },
      ])

      recover = true
      const recoveryStart = commands.length
      await expect(replayPendingMutations()).resolves.toMatchObject({ succeeded: 2 })
      expect(commands.slice(recoveryStart)).toEqual([
        { method: 'POST', url: '/api/v1/commands/modules' },
        { method: 'PATCH', url: '/api/v1/commands/modules/mod-new' },
      ])
      expect(await listPendingMutations()).toEqual([])
    } finally {
      firstCreate.resolve(jsonResponse({ error: 'temporarily unavailable' }, 500))
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('does not let a restored module metadata save overtake its retained delete', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-module-delete-update',
      writerEpoch: 10,
      databaseLineage: 'lineage-module-delete-update',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(30)
    setResourceWriteGuardEnabled(true)

    const deleteIntent: DurableMutationIntent = {
      version: 1,
      requests: [{ method: 'DELETE', path: '/modules/mod-a', body: {} }],
    }
    const retainedDelete = stagePendingMutation('module-owner:mod-a', deleteIntent)
    await expect(retainedDelete.ready).resolves.toBe('persisted')

    const commands: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        const method = init.method ?? 'GET'
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        if (url === '/api/v1/commands/modules/mod-a' && method === 'DELETE') {
          commands.push(method)
          return jsonResponse({ error: 'temporarily unavailable' }, 500)
        }
        if (method === 'PATCH') throw new Error('metadata save overtook retained module delete')
        return jsonResponse({ error: `unexpected ${method} ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      await expect(
        updateGlobalModule('mod-a', { id: 'mod-a', name: 'Restored edit', description: '' }),
      ).resolves.toMatchObject({ status: 'unavailable' })
      expect(commands).toEqual(['DELETE'])
      expect(
        (await listPendingMutations()).map((entry) => ({
          key: entry.handle.key,
          method: entry.intent.requests[0]?.method,
        })),
      ).toEqual([
        { key: 'module-owner:mod-a', method: 'DELETE' },
        { key: 'module-owner:mod-a', method: 'PATCH' },
      ])
      // The exact PATCH row is durable behind the retained delete, so its
      // optimistic metadata stays visible until the owner chain replays.
      expect(getDatabase().modules.find((module) => module.id === 'mod-a')?.name).toBe('Restored edit')
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('keeps a newer global enable behind a retained module delete', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-module-enable',
      writerEpoch: 9,
      databaseLineage: 'lineage-module-enable',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(20)
    setResourceWriteGuardEnabled(true)

    const deleteIntent: DurableMutationIntent = {
      version: 1,
      requests: [
        {
          method: 'DELETE',
          path: '/modules/mod-a',
          body: {},
        },
      ],
    }
    const retainedDelete = stagePendingMutation('module-owner:mod-a', deleteIntent)
    await expect(retainedDelete.ready).resolves.toBe('persisted')

    let recover = false
    let revision = 20
    const commands: Array<{ method: string; mutationId: string | null }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/commands/mutation-receipts/ack') {
          return jsonResponse({ acknowledged: true })
        }

        const method = init.method ?? 'GET'
        const headers = init.headers as Record<string, string> | undefined
        if (url === '/api/v1/commands/modules/mod-a' && method === 'DELETE') {
          commands.push({ method, mutationId: headers?.['risu-mutation-id'] ?? null })
          if (!recover) return jsonResponse({ error: 'temporarily unavailable' }, 500)
          revision += 1
          return jsonResponse({
            revision,
            event: { type: 'module.deleted', revision, resource: 'module', id: 'mod-a' },
            moduleId: 'mod-a',
          })
        }
        if (url === '/api/v1/commands/modules/enable' && method === 'POST') {
          commands.push({ method, mutationId: headers?.['risu-mutation-id'] ?? null })
          if (recover) return jsonResponse({ error: 'module no longer exists' }, 404)
          revision += 1
          return jsonResponse({
            revision,
            event: { type: 'module.enabled', revision, resource: 'module', id: 'mod-a' },
            moduleId: 'mod-a',
            enabled: true,
          })
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      setGlobalModuleEnabled('mod-a', true)
      expect(getDatabase().enabledModules).toEqual(['mod-a'])

      await vi.waitFor(() => expect(commands.map(({ method }) => method)).toEqual(['DELETE']))
      await vi.waitFor(async () => {
        expect(
          (await listPendingMutations()).map((entry) => ({
            key: entry.handle.key,
            method: entry.intent.requests[0]?.method,
            path: entry.intent.requests[0]?.path,
          })),
        ).toEqual([
          { key: 'module-owner:mod-a', method: 'DELETE', path: '/modules/mod-a' },
          { key: 'module-owner:mod-a', method: 'POST', path: '/modules/enable' },
        ])
      })
      // The newer enable has its own durable row and therefore keeps owning
      // the projection while the predecessor delete is retryable.
      expect(getDatabase().enabledModules).toEqual(['mod-a'])

      recover = true
      await expect(replayPendingMutations()).resolves.toMatchObject({ succeeded: 1, discarded: 1 })
      expect(commands.map(({ method }) => method)).toEqual(['DELETE', 'DELETE', 'POST'])
      expect(commands.every(({ mutationId }) => mutationId !== null)).toBe(true)
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('optimistically applies global module textarea fields and rolls back on command failure', async () => {
    const calls = stubFailingCommandFetch()
    const assets: [string, string, string][] = [['asset.png', 'a'.repeat(64), 'png']]
    const regex = [{ in: 'x'.repeat(10_000), out: '', type: 'editoutput' }] as any
    getDatabase().modules[0] = {
      id: 'mod-a',
      name: 'Module A',
      description: '',
      backgroundEmbedding: 'old background',
      cjs: 'x'.repeat(10_000),
      assets,
      regex,
    } as any
    setResourceWriteGuardEnabled(true)

    expect(() => {
      getDatabase().modules[0].backgroundEmbedding = 'direct'
    }).toThrow()

    const resultPromise = updateGlobalModule('mod-a', {
      id: 'mod-a',
      name: 'Module A',
      description: '',
      backgroundEmbedding: 'new background',
      cjs: 'x'.repeat(10_000),
      assets,
      regex,
    })

    expect(getDatabase().modules[0].backgroundEmbedding).toBe('new background')

    await waitForCallCount(calls, 2)
    await expect(resultPromise).resolves.toEqual({ status: 'error', error: 'forced failure' })

    expect(calls[1]).toEqual({
      url: '/api/v1/commands/modules/mod-a',
      method: 'PATCH',
      authHeader: 'module-command-token',
      body: {
        baseRevision: 10,
        patch: {
          backgroundEmbedding: 'new background',
        },
      },
    })
    expect(getDatabase().modules[0].backgroundEmbedding).toBe('old background')
  })

  it('encodes optional module-field removals and restores them when the command fails', async () => {
    const calls = stubFailingCommandFetch()
    const assets: [string, string, string][] = [['asset.png', 'b'.repeat(64), 'png']]
    getDatabase().modules[0] = {
      id: 'mod-a',
      name: 'Module A',
      description: '',
      backgroundEmbedding: 'old background',
      cjs: 'old cjs',
      assets,
    } as any
    setResourceWriteGuardEnabled(true)

    updateGlobalModule('mod-a', { id: 'mod-a', name: 'Module A', description: '' })

    expect(getDatabase().modules[0]).not.toHaveProperty('backgroundEmbedding')
    expect(getDatabase().modules[0]).not.toHaveProperty('cjs')
    expect(getDatabase().modules[0]).not.toHaveProperty('assets')

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(calls[1]).toEqual({
      url: '/api/v1/commands/modules/mod-a',
      method: 'PATCH',
      authHeader: 'module-command-token',
      body: {
        baseRevision: 10,
        patch: {
          backgroundEmbedding: null,
          cjs: null,
          assets: null,
        },
      },
    })
    expect(getDatabase().modules[0]).toMatchObject({
      backgroundEmbedding: 'old background',
      cjs: 'old cjs',
      assets,
    })
  })

  it('keeps omitted optional fields untouched in a partial module-info patch', async () => {
    const calls = stubCommandFetch()
    const assets: [string, string, string][] = [['asset.png', 'c'.repeat(64), 'png']]
    getDatabase().modules[0] = {
      id: 'mod-a',
      name: 'Module A',
      description: '',
      cjs: 'x'.repeat(10_000),
      assets,
    } as any
    const previous = currentGlobalModuleStateSnapshot()
    setResourceWriteGuardEnabled(true)
    withTrustedResourceWrite(() => {
      getDatabase().modules[0].name = 'Renamed A'
    })

    dispatchModuleInfoPatch('mod-a', { name: 'Renamed A' }, null, previous)

    await waitForCallCount(calls, 2)
    expect(calls[1]).toEqual({
      url: '/api/v1/commands/modules/mod-a',
      method: 'PATCH',
      authHeader: 'module-command-token',
      body: {
        baseRevision: 10,
        patch: { name: 'Renamed A' },
      },
    })
    expect(getDatabase().modules[0]).toMatchObject({ cjs: 'x'.repeat(10_000), assets })
  })

  it('rebases module drafts with top-level edits and supported deletions while preserving untouched latest fields', () => {
    const baseline = {
      id: 'mod-a',
      name: 'Module A',
      description: 'Original description',
      namespace: 'original-namespace',
      cjs: 'original code',
    }
    const draft = {
      id: 'mod-a',
      name: 'Locally renamed',
      description: 'Original description',
      cjs: 'original code',
    }
    const latest = {
      id: 'mod-a',
      name: 'Module A',
      description: 'Description changed remotely',
      namespace: 'remote-namespace',
      cjs: 'remote code',
      hideIcon: true,
    }

    expect(rebaseModuleDraftOntoLatest(baseline, draft, latest)).toEqual({
      id: 'mod-a',
      name: 'Locally renamed',
      description: 'Description changed remotely',
      cjs: 'remote code',
      hideIcon: true,
    })
  })

  it('preserves concurrently updated split-owned fields when rebasing a stale parent draft', () => {
    const baseline = {
      id: 'mod-a',
      name: 'Module A',
      lorebook: [{ id: 'lore-original', content: 'original lore' }],
      regex: [{ id: 'regex-original', in: 'original regex' }],
      trigger: [{ id: 'trigger-original', comment: 'original trigger' }],
      mcp: { type: 'stdio', command: 'original-command' },
    } as any
    const draft = {
      ...baseline,
      name: 'Locally renamed',
      lorebook: [{ id: 'lore-stale', content: 'stale lore' }],
      regex: [{ id: 'regex-stale', in: 'stale regex' }],
      trigger: [{ id: 'trigger-stale', comment: 'stale trigger' }],
      mcp: { type: 'stdio', command: 'stale-command' },
    } as any
    const latest = {
      ...baseline,
      lorebook: [{ id: 'lore-latest', content: 'latest lore' }],
      regex: [{ id: 'regex-latest', in: 'latest regex' }],
      trigger: [{ id: 'trigger-latest', comment: 'latest trigger' }],
      mcp: { type: 'stdio', command: 'latest-command' },
    } as any

    expect(rebaseModuleDraftOntoLatest(baseline, draft, latest)).toEqual({
      ...latest,
      name: 'Locally renamed',
    })
  })

  it('does not resurrect rolled-back split-owned edits when rebasing the parent draft', () => {
    const baseline = {
      id: 'mod-a',
      name: 'Module A',
    } as any
    const draft = {
      ...baseline,
      name: 'Locally renamed',
      lorebook: [{ id: 'lore-rolled-back', content: 'rolled-back lore edit' }],
      regex: [{ id: 'regex-rolled-back', in: 'rolled-back regex edit' }],
      trigger: [{ id: 'trigger-rolled-back', comment: 'rolled-back trigger edit' }],
      mcp: { type: 'stdio', command: 'rolled-back-command' },
    } as any
    const latestAfterRollback = { ...baseline }

    expect(rebaseModuleDraftOntoLatest(baseline, draft, latestAfterRollback)).toEqual({
      ...baseline,
      name: 'Locally renamed',
    })
  })

  it('rebases only editor-changed split collections over the latest module projection', () => {
    const baseline = {
      id: 'mod-a',
      name: 'Module A',
      lorebook: [{ id: 'lore-original', content: 'original lore' }],
      regex: [{ id: 'regex-original', in: 'original regex' }],
      trigger: [{ id: 'trigger-original', comment: 'original trigger' }],
    } as any
    const draft = {
      ...baseline,
      name: 'Locally renamed',
      lorebook: [{ id: 'lore-local', content: 'local lore' }],
    } as any
    const latest = {
      ...baseline,
      lorebook: [{ id: 'lore-remote', content: 'remote lore' }],
      regex: [{ id: 'regex-remote', in: 'remote regex' }],
      trigger: [{ id: 'trigger-remote', comment: 'remote trigger' }],
    } as any

    expect(rebaseModuleEditorDraftOntoLatest(baseline, draft, latest)).toEqual({
      ...latest,
      name: 'Locally renamed',
      lorebook: [{ id: 'lore-local', content: 'local lore' }],
    })
  })

  it('persists an explicit editor Save through every changed module slice', async () => {
    const calls = stubModuleDraftSaveFetch()
    getDatabase().modules[0] = {
      id: 'mod-a',
      name: 'Module A',
      description: 'Description',
      lorebook: [
        {
          id: 'lore-old',
          key: 'old',
          secondkey: '',
          insertorder: 100,
          comment: 'Old lore',
          content: 'old lore',
          mode: 'normal',
          alwaysActive: false,
          selective: false,
        },
      ],
      regex: [{ id: 'regex-old', comment: 'Old regex', in: 'old', out: '', type: 'editinput' }],
      trigger: [{ id: 'trigger-old', comment: 'Old trigger', type: 'start', conditions: [], effect: [] }],
    } as any
    setResourceWriteGuardEnabled(true)

    const savedModule = {
      id: 'mod-a',
      name: 'Saved Module A',
      description: 'Description',
      lorebook: [
        {
          id: 'lore-new',
          key: 'new',
          secondkey: '',
          insertorder: 100,
          comment: 'New lore',
          content: 'new lore',
          mode: 'normal',
          alwaysActive: false,
          selective: false,
        },
      ],
      regex: [{ id: 'regex-new', comment: 'New regex', in: 'new', out: '', type: 'editinput' }],
      trigger: [{ id: 'trigger-new', comment: 'New trigger', type: 'start', conditions: [], effect: [] }],
    } as any

    const resultPromise = saveGlobalModuleDraft('mod-a', savedModule)

    expect(getDatabase().modules[0]).toEqual(savedModule)
    await expect(resultPromise).resolves.toBeNull()
    expect(calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'module-command-token',
        body: null,
      },
      {
        url: '/api/v1/commands/modules/mod-a',
        method: 'PATCH',
        authHeader: 'module-command-token',
        body: { baseRevision: 10, patch: { name: 'Saved Module A' } },
      },
      {
        url: '/api/v1/commands/modules/mod-a/lorebooks',
        method: 'PUT',
        authHeader: 'module-command-token',
        body: { baseRevision: 11, entries: savedModule.lorebook },
      },
      {
        url: '/api/v1/commands/modules/mod-a/scripts',
        method: 'PUT',
        authHeader: 'module-command-token',
        body: { baseRevision: 12, scripts: savedModule.regex },
      },
      {
        url: '/api/v1/commands/modules/mod-a/triggers',
        method: 'PUT',
        authHeader: 'module-command-token',
        body: { baseRevision: 13, triggers: savedModule.trigger },
      },
    ])
  })

  it('optimistically applies only the sanitized parent patch from a stale full-module save', async () => {
    const calls = stubCommandFetch()
    const latestSplitFields = {
      lorebook: [{ id: 'lore-latest', content: 'latest lore' }],
      regex: [{ id: 'regex-latest', in: 'latest regex' }],
      trigger: [{ id: 'trigger-latest', comment: 'latest trigger' }],
      mcp: { type: 'stdio', command: 'latest-command' },
    }
    getDatabase().modules[0] = {
      id: 'mod-a',
      name: 'Module A',
      description: 'Current description',
      ...latestSplitFields,
    } as any
    setResourceWriteGuardEnabled(true)

    const resultPromise = updateGlobalModule('mod-a', {
      id: 'mod-a',
      name: 'Locally renamed',
      description: 'Current description',
      lorebook: [{ id: 'lore-stale', content: 'stale lore' }],
      regex: [{ id: 'regex-stale', in: 'stale regex' }],
      trigger: [{ id: 'trigger-stale', comment: 'stale trigger' }],
      mcp: { type: 'stdio', command: 'stale-command' },
    } as any)

    expect(getDatabase().modules[0]).toMatchObject({
      name: 'Locally renamed',
      ...latestSplitFields,
    })

    await waitForCallCount(calls, 2)
    expect(calls[1]).toEqual({
      url: '/api/v1/commands/modules/mod-a',
      method: 'PATCH',
      authHeader: 'module-command-token',
      body: {
        baseRevision: 10,
        patch: { name: 'Locally renamed' },
      },
    })
    await expect(resultPromise).resolves.toMatchObject({ status: 'ok' })
    expect(getDatabase().modules[0]).toMatchObject({
      name: 'Locally renamed',
      ...latestSplitFields,
    })
  })

  it('optimistically applies global module create and rolls back on command failure', async () => {
    const calls = stubFailingCommandFetch()
    setResourceWriteGuardEnabled(true)

    const resultPromise = createGlobalModule({ id: 'mod-c', name: 'Module C', description: '' })

    expect(getDatabase().modules.map((module) => module.id)).toEqual(['mod-a', 'mod-b', 'mod-c'])

    await waitForCallCount(calls, 2)
    await expect(resultPromise).resolves.toEqual({ status: 'error', error: 'forced failure' })

    expect(getDatabase().modules.map((module) => module.id)).toEqual(['mod-a', 'mod-b'])
  })

  it('optimistically applies global module delete references and rolls back on command failure', async () => {
    const calls = stubFailingCommandFetch()
    getDatabase().enabledModules = ['mod-a']
    getDatabase().personas = [
      { id: 'persona-a', name: 'Persona A', icon: '', personaPrompt: '', modules: ['mod-a', 'persona-module'] },
    ]
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

    withTrustedResourceWrite(() => {
      getDatabase().modules[0].name = 'Latest optimistic module child edit'
    })

    deleteGlobalModule('mod-a')

    expect(getDatabase().enabledModules).toEqual([])
    expect(getDatabase().modules.map((module) => module.id)).toEqual(['mod-b'])
    expect(getDatabase().personas[0].modules).toEqual(['persona-module'])
    expect(getDatabase().characters[0].modules).toEqual(['character-module'])
    expect(getDatabase().characters[0].chats[0].modules).toEqual(['chat-module'])

    withTrustedResourceWrite(() => {
      getDatabase().characters[0].name = 'Concurrent character edit'
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(getDatabase().enabledModules).toEqual(['mod-a'])
    expect(getDatabase().modules.map((module) => module.id)).toEqual(['mod-a', 'mod-b'])
    expect(getDatabase().modules[0].name).toBe('Latest optimistic module child edit')
    expect(getDatabase().personas[0].modules).toEqual(['mod-a', 'persona-module'])
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

    const outcome = setGlobalModuleEnabled('mod-a', true)
    expect(getDatabase().enabledModules).toEqual(['mod-b', 'mod-a'])

    withTrustedResourceWrite(() => {
      getDatabase().enabledModules = getDatabase().enabledModules.filter((id) => id !== 'mod-b')
      getDatabase().enabledModules.push('mod-c')
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    await expect(outcome).resolves.toMatchObject({ status: 'failed' })
    expect(getDatabase().enabledModules).toEqual(['mod-c'])
  })

  it('classifies a retained global enable as queued until replay accepts it', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-module-enable-outcome',
      writerEpoch: 4,
      databaseLineage: 'lineage-module-enable-outcome',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(10)
    setResourceWriteGuardEnabled(true)
    let recover = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        if (url === '/api/v1/commands/modules/enable') {
          if (!recover) return jsonResponse({ error: 'temporarily unavailable' }, 500)
          return jsonResponse({
            revision: 11,
            event: { type: 'module.enabled', revision: 11, resource: 'module', id: 'mod-a' },
            moduleId: 'mod-a',
            enabled: true,
          })
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      await expect(setGlobalModuleEnabled('mod-a', true)).resolves.toMatchObject({ status: 'queued' })
      expect(getDatabase().enabledModules).toEqual(['mod-a'])
      expect(await listPendingMutations()).toHaveLength(1)

      recover = true
      await expect(replayPendingMutations()).resolves.toMatchObject({ succeeded: 1 })
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('keeps an outcome-aware create queued until replay accepts the staged Save', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-module-create-outcome',
      writerEpoch: 5,
      databaseLineage: 'lineage-module-create-outcome',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(10)
    setResourceWriteGuardEnabled(true)
    let recover = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        if (url === '/api/v1/commands/modules') {
          if (!recover) return jsonResponse({ error: 'temporarily unavailable' }, 500)
          return jsonResponse({
            revision: 11,
            event: { type: 'module.created', revision: 11, resource: 'module', id: 'mod-new' },
            moduleId: 'mod-new',
          })
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      const outcome = await createGlobalModuleWithOutcome({
        id: 'mod-new',
        name: 'Queued module',
        description: '',
      })
      expect(outcome).toMatchObject({ status: 'queued', mutationIds: [expect.any(String)] })
      expect(getDatabase().modules.some((module) => module.id === 'mod-new')).toBe(true)
      expect(await listPendingMutations()).toHaveLength(1)
      if (outcome.status !== 'queued') throw new Error('Expected create Save to remain queued')

      recover = true
      await expect(replayPendingMutations()).resolves.toMatchObject({ succeeded: 1 })
      await expect(outcome.settlement).resolves.toEqual({ status: 'accepted' })
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('reports a queued editor Save as failed when replay permanently rejects it', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-module-edit-outcome',
      writerEpoch: 6,
      databaseLineage: 'lineage-module-edit-outcome',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(10)
    setResourceWriteGuardEnabled(true)
    let replaying = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        if (url === '/api/v1/commands/modules/mod-a') {
          return replaying
            ? jsonResponse({ error: 'module edit is invalid' }, 400)
            : jsonResponse({ error: 'temporarily unavailable' }, 500)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      const outcome = await saveGlobalModuleDraftWithOutcome('mod-a', {
        ...getDatabase().modules[0],
        name: 'Queued edit',
      } as any)
      expect(outcome).toMatchObject({ status: 'queued', mutationIds: [expect.any(String)] })
      expect(getDatabase().modules[0].name).toBe('Queued edit')
      if (outcome.status !== 'queued') throw new Error('Expected editor Save to remain queued')

      replaying = true
      await expect(replayPendingMutations()).resolves.toMatchObject({ discarded: 1, retained: 0 })
      await expect(outcome.settlement).resolves.toMatchObject({
        status: 'failed',
        result: { status: 'error', error: 'module edit is invalid' },
      })
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('failed delete reinserts only deleted module and restores references only while they match attempted deletion', async () => {
    const calls = stubFailingCommandFetch()
    getDatabase().enabledModules = ['mod-a', 'mod-b']
    getDatabase().personas = [
      { id: 'persona-a', name: 'Persona A', icon: '', personaPrompt: '', modules: ['mod-a', 'persona-module'] },
      { id: 'persona-b', name: 'Persona B', icon: '', personaPrompt: '', modules: ['mod-a', 'changed-persona'] },
    ]
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
    expect(getDatabase().personas[0].modules).toEqual(['persona-module'])
    expect(getDatabase().characters[0].modules).toEqual(['character-module'])
    expect(getDatabase().characters[0].chats[0].modules).toEqual(['chat-module'])
    expect(getDatabase().loadouts[0].modules).toEqual(['loadout-module'])

    withTrustedResourceWrite(() => {
      getDatabase().modules.push({ id: 'mod-c', name: 'Newer Module C' } as any)
      getDatabase().enabledModules.push('mod-c')
      getDatabase().personas[1].modules = ['newer-persona-ref']
      getDatabase().characters[1].modules = ['newer-character-ref']
      getDatabase().characters[1].chats[0].modules = ['newer-chat-ref']
      getDatabase().loadouts[1].modules = ['newer-loadout-ref']
    })

    await waitForCallCount(calls, 2)
    await flushCommandEffects()

    expect(getDatabase().modules.map((module) => module.id)).toEqual(['mod-a', 'mod-b', 'mod-c'])
    expect(getDatabase().enabledModules).toEqual(['mod-a', 'mod-b', 'mod-c'])
    expect(getDatabase().personas[0].modules).toEqual(['mod-a', 'persona-module'])
    expect(getDatabase().personas[1].modules).toEqual(['newer-persona-ref'])
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
