import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../platform', () => ({ isFastifyServer: true }))

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'test-auth-token',
}))

import {
  appendMessageCommand,
  bulkPluginStorageCommand,
  createAgentPresetCommand,
  createAgentPresetStepCommand,
  createChatCommand,
  createChatFolderCommand,
  createAndSelectCharacterCommand,
  createCharacterCommand,
  createLoadoutCommand,
  createModuleCommand,
  createPersonaCommand,
  createPluginCommand,
  clearAppliedServerResourceRevision,
  clearCachedServerCommandRevision,
  createPromptItemCommand,
  createPresetCommand,
  createTranslatorPresetCommand,
  createAndBindModelProfileCommand,
  createModelProfileCommand,
  createGlobalLorebookCommand,
  convertLegacyModelProfilesCommand,
  copyPresetCommand,
  deleteAgentPresetCommand,
  deleteAgentPresetStepCommand,
  deleteCharacterLorebookEntryCommand,
  deleteChatCommand,
  deleteChatFolderCommand,
  deleteChatLorebookEntryCommand,
  deleteCharacterCommand,
  deleteGlobalLorebookCommand,
  deleteGlobalLorebookEntryCommand,
  deleteLoadoutCommand,
  deleteMessageCommand,
  deleteModelProfileCommand,
  deleteModuleCommand,
  deleteModuleLorebookEntryCommand,
  deletePersonaCommand,
  deletePluginCommand,
  deletePluginStorageCommand,
  deletePromptItemCommand,
  deleteTranslatorPresetCommand,
  enablePromptItemsCommand,
  favoriteLoadoutCommand,
  enablePluginCommand,
  enableModuleCommand,
  forkChatCommand,
  getServerCommandBaseRevision,
  patchPromptSettingsCommand,
  patchChatScriptstateCommand,
  patchServerBackedSettings,
  patchRuntimeSettings,
  patchSettingsGroup,
  peekAppliedServerResourceRevision,
  peekCachedServerCommandRevision,
  importPresetCommand,
  persistGenerationResultCommand,
  duplicateAgentPresetCommand,
  duplicateAgentPresetStepCommand,
  duplicateModelProfileCommand,
  putPluginStorageCommand,
  saveChatGenerationSettingsCommand,
  reorderCharactersCommand,
  reorderChatFoldersCommand,
  reorderChatsCommand,
  reorderPersonasCommand,
  reorderGlobalLorebooksCommand,
  reorderCharacterLorebookEntriesCommand,
  reorderCharacterModulesCommand,
  reorderChatLorebookEntriesCommand,
  reorderModulesCommand,
  reorderGlobalLorebookEntriesCommand,
  reorderModuleLorebookEntriesCommand,
  reorderPluginsCommand,
  reorderPromptItemsCommand,
  reorderAgentPresetsCommand,
  reorderAgentPresetStepsCommand,
  reorderPresetsCommand,
  runServerCommand,
  runServerPresetCommand,
  replaceTailMessagesCommand,
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
  selectGlobalLorebookCommand,
  setAgentPresetDefaultCommand,
  settingsGroupForKey,
  selectPersonaCommand,
  selectPluginProviderCommand,
  selectTranslatorPresetCommand,
  touchLoadoutCommand,
  truncateMessagesCommand,
  translateMessageCommand,
  updateCharacterCommand,
  updateChatCommand,
  updateChatFolderCommand,
  updateAgentPresetCommand,
  updateAgentPresetStepCommand,
  updateGlobalLorebookCommand,
  updateLoadoutCommand,
  updateMessageCommand,
  updateModelProfileCommand,
  updateModelRoleProfilesCommand,
  updateModelRuntimeDefaultsCommand,
  updateModuleCommand,
  updatePersonaCommand,
  updatePluginCommand,
  upsertCharacterLorebookEntryCommand,
  upsertChatLorebookEntryCommand,
  upsertGlobalLorebookEntryCommand,
  upsertModuleLorebookEntryCommand,
  updateTranslatorPresetCommand,
  selectPresetCommand,
  setAppliedServerResourceRevision,
  setCachedServerCommandRevision,
  setServerCommandSuccessReconciler,
  updatePromptItemCommand,
} from './commands'
import { createDestructiveRefreshToken } from './staleStateGuards'

interface CapturedFetch {
  url: string
  method: string
  authHeader: string | null
  contentType: string | null
  body: unknown
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  let reject!: Deferred<T>['reject']
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
  clearAppliedServerResourceRevision()
  clearCachedServerCommandRevision()
  setServerCommandSuccessReconciler(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('server command API adapter', () => {
  it('patches runtime settings with the auth header and baseRevision', async () => {
    const event = { type: 'settings.updated', revision: 2, resource: 'settings' }
    const commandFetch = makeCommandFetch(() => ({ revision: 2, event }))
    vi.stubGlobal('fetch', commandFetch.fetch)

    const result = await patchRuntimeSettings({
      baseRevision: 1,
      patch: { streamGeminiThoughts: true },
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
          patch: { streamGeminiThoughts: true },
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

  it('exposes the canonical settings patch as a response-confirmed local effect', async () => {
    const event = {
      type: 'settings.updated',
      revision: 3,
      resource: 'settings',
      id: 'display',
    }
    const commandFetch = makeCommandFetch(() => ({
      revision: 3,
      event,
      settings: { theme: 'light', zoomsize: 90 },
    }))
    vi.stubGlobal('fetch', commandFetch.fetch)
    const observedEffects: unknown[] = []
    setServerCommandSuccessReconciler((_event, _coalescedEvents, localEffects) => {
      observedEffects.push(...localEffects.values())
    })

    await patchSettingsGroup({
      group: 'display',
      baseRevision: 2,
      patch: { theme: 'LIGHT', zoomsize: 90 },
    })

    expect(observedEffects).toEqual([
      {
        kind: 'settingsPatch',
        group: 'display',
        attemptedPatch: { theme: 'LIGHT', zoomsize: 90 },
        settings: { theme: 'light', zoomsize: 90 },
      },
    ])
  })

  it('notifies the command success reconciler before resolving an ok command', async () => {
    const event = { type: 'settings.updated', revision: 3, resource: 'settings', origin: { writerSessionId: 'w1' } }
    const commandFetch = makeCommandFetch(() => ({ revision: 3, event }))
    vi.stubGlobal('fetch', commandFetch.fetch)
    const observed: unknown[] = []

    setServerCommandSuccessReconciler(async (commandEvent) => {
      observed.push(commandEvent)
    })

    const result = await patchSettingsGroup({
      group: 'display',
      baseRevision: 2,
      patch: { theme: 'light' },
    })

    expect(result).toEqual({ status: 'ok', revision: 3, event })
    expect(observed).toEqual([event])
  })

  it('notifies the command success reconciler for custom runServerCommand factories', async () => {
    const event = { type: 'custom.updated', revision: 8, resource: 'asset' }
    const observed: unknown[] = []
    setCachedServerCommandRevision(7)
    setServerCommandSuccessReconciler(async (commandEvent) => {
      observed.push(commandEvent)
    })

    const result = await runServerCommand({
      command: async (baseRevision) => ({
        status: 'ok' as const,
        revision: baseRevision + 1,
        event,
      }),
    })

    expect(result).toEqual({ status: 'ok', revision: 8, event })
    expect(observed).toEqual([event])
  })

  it('serializes independent high-level mutations so each request uses the previously accepted revision', async () => {
    const firstResponse = createDeferred<Response>()
    const calls: Array<{ body: unknown }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        calls.push({
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })
        if (calls.length === 1) return firstResponse.promise
        return jsonResponse({
          revision: 12,
          event: { type: 'settings.updated', revision: 12, resource: 'settings' },
        })
      }) as unknown as typeof fetch,
    )
    setCachedServerCommandRevision(10)

    const first = runServerCommand({
      command: (baseRevision) =>
        patchRuntimeSettings({
          baseRevision,
          patch: { maxContext: 8_000 },
        }),
    })
    const second = patchServerBackedSettings({
      patch: { maxResponse: 1_000 },
    })

    await vi.waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]?.body).toEqual({
      baseRevision: 10,
      patch: { maxContext: 8_000 },
    })

    firstResponse.resolve(
      jsonResponse({
        revision: 11,
        event: { type: 'settings.updated', revision: 11, resource: 'settings' },
      }),
    )

    await expect(first).resolves.toMatchObject({ status: 'ok', revision: 11 })
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1]?.body).toEqual({
      baseRevision: 11,
      patch: { maxResponse: 1_000 },
    })
    await expect(second).resolves.toMatchObject({ status: 'ok', revision: 12 })
  })

  it('starts a queued transport before reconciling the older command and never restores its older optimistic value', async () => {
    const firstResponse = createDeferred<Response>()
    const secondResponse = createDeferred<Response>()
    const reconcileRelease = createDeferred<void>()
    const calls: Array<{ body: unknown }> = []
    const reconciled: Array<{ revision: number; coalescedRevisions: number[] }> = []
    let visibleValue = 'first optimistic value'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        calls.push({
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })
        return calls.length === 1 ? firstResponse.promise : secondResponse.promise
      }) as unknown as typeof fetch,
    )
    setCachedServerCommandRevision(10)
    setServerCommandSuccessReconciler(async (event, coalescedEvents) => {
      reconciled.push({
        revision: event.revision,
        coalescedRevisions: coalescedEvents.map((coalescedEvent) => coalescedEvent.revision),
      })
      await reconcileRelease.promise
      visibleValue = event.revision === 11 ? 'first server value' : 'second optimistic value'
    })

    const first = runServerCommand({
      command: (baseRevision) =>
        patchRuntimeSettings({
          baseRevision,
          patch: { maxContext: 8_000 },
        }),
    })
    visibleValue = 'second optimistic value'
    const second = patchServerBackedSettings({
      patch: { maxResponse: 1_000 },
    })
    let commandsSettled = false
    const commands = Promise.all([first, second]).then((results) => {
      commandsSettled = true
      return results
    })

    await vi.waitFor(() => expect(calls).toHaveLength(1))
    firstResponse.resolve(
      jsonResponse({
        revision: 11,
        event: { type: 'settings.updated', revision: 11, resource: 'settings' },
      }),
    )

    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1]?.body).toEqual({
      baseRevision: 11,
      patch: { maxResponse: 1_000 },
    })
    expect(reconciled).toEqual([])
    expect(visibleValue).toBe('second optimistic value')

    secondResponse.resolve(
      jsonResponse({
        revision: 12,
        event: { type: 'settings.updated', revision: 12, resource: 'settings' },
      }),
    )

    await vi.waitFor(() => expect(reconciled).toEqual([{ revision: 12, coalescedRevisions: [11, 12] }]))
    expect(commandsSettled).toBe(false)
    expect(visibleValue).toBe('second optimistic value')
    reconcileRelease.resolve()

    await expect(commands).resolves.toEqual([
      expect.objectContaining({ status: 'ok', revision: 11 }),
      expect.objectContaining({ status: 'ok', revision: 12 }),
    ])
    expect(reconciled).toEqual([{ revision: 12, coalescedRevisions: [11, 12] }])
    expect(visibleValue).toBe('second optimistic value')
  })

  it('keeps unqueued translation response reconciliation immediate during an unrelated queued mutation', async () => {
    const queuedResponse = createDeferred<Response>()
    const reconciledRevisions: number[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/messages/message-1/translate')) {
          return jsonResponse({
            revision: 11,
            event: { type: 'message.updated', revision: 11, resource: 'message', id: 'message-1' },
            chatId: 'chat-1',
            messageId: 'message-1',
            translation: { source: 'raw', text: 'translated' },
          })
        }
        return queuedResponse.promise
      }) as unknown as typeof fetch,
    )
    setCachedServerCommandRevision(10)
    setServerCommandSuccessReconciler(async (event) => {
      reconciledRevisions.push(event.revision)
    })

    const queued = runServerCommand({
      command: (baseRevision) =>
        patchRuntimeSettings({
          baseRevision,
          patch: { maxContext: 8_000 },
        }),
    })
    const translation = await translateMessageCommand({ baseRevision: 10, messageId: 'message-1' })

    expect(translation).toMatchObject({ status: 'ok', revision: 11 })
    expect(reconciledRevisions).toEqual([11])

    queuedResponse.resolve(
      jsonResponse({
        revision: 12,
        event: { type: 'settings.updated', revision: 12, resource: 'settings' },
      }),
    )
    await expect(queued).resolves.toMatchObject({ status: 'ok', revision: 12 })
    expect(reconciledRevisions).toEqual([11, 12])
  })

  it('maps projection-sweep toggles to server-backed settings groups', () => {
    expect(settingsGroupForKey('notification')).toBe('display')
    expect(settingsGroupForKey('useAutoSuggestions')).toBe('runtime')
    expect(settingsGroupForKey('useAutoTranslateInput')).toBe('language')
    expect(settingsGroupForKey('globalChatVariables')).toBe('sidebar')
    expect(settingsGroupForKey('jailbreakToggle')).toBe('sidebar')
    expect(settingsGroupForKey('customSidebarItems')).toBe('sidebar')
    expect(settingsGroupForKey('ooba')).toBe('providers')
    expect(settingsGroupForKey('reverseProxyOobaArgs')).toBe('providers')
    expect(settingsGroupForKey('localStopStrings')).toBe('runtime')
    expect(settingsGroupForKey('NAIsettings')).toBe('providers')
    expect(settingsGroupForKey('ainconfig')).toBe('providers')
    expect(settingsGroupForKey('bias')).toBe('providers')
    expect(settingsGroupForKey('additionalParams')).toBe('providers')
    expect(settingsGroupForKey('aiModel')).toBe('providers')
    expect(settingsGroupForKey('subModel')).toBe('providers')
    expect(settingsGroupForKey('google')).toBe('providers')
    expect(settingsGroupForKey('vertexClientEmail')).toBe('providers')
    expect(settingsGroupForKey('vertexPrivateKey')).toBe('providers')
    expect(settingsGroupForKey('vertexAccessToken')).toBe('providers')
    expect(settingsGroupForKey('vertexAccessTokenExpires')).toBe('providers')
    expect(settingsGroupForKey('vertexRegion')).toBe('providers')
    expect(settingsGroupForKey('novelai')).toBe('providers')
    expect(settingsGroupForKey('OaiCompAPIKeys')).toBe('providers')
    expect(settingsGroupForKey('hordeConfig')).toBe('providers')
    expect(settingsGroupForKey('ollamaCloudModel')).toBe('providers')
    expect(settingsGroupForKey('ollamaCloudModelName')).toBe('providers')
    expect(settingsGroupForKey('nanogptRequestModel')).toBe('providers')
    expect(settingsGroupForKey('nanogptRequestModelName')).toBe('providers')
    expect(settingsGroupForKey('openrouterRequestModel')).toBe('providers')
    expect(settingsGroupForKey('openrouterFallback')).toBe('providers')
    expect(settingsGroupForKey('openrouterMiddleOut')).toBe('providers')
    expect(settingsGroupForKey('openrouterProvider')).toBe('providers')
    expect(settingsGroupForKey('useInstructPrompt')).toBe('providers')
    expect(settingsGroupForKey('instructChatTemplate')).toBe('providers')
    expect(settingsGroupForKey('JinjaTemplate')).toBe('providers')
    expect(settingsGroupForKey('modelProfiles')).toBe('providers')
    expect(settingsGroupForKey('modelRoleProfiles')).toBe('providers')
    expect(settingsGroupForKey('modelRuntimeDefaults')).toBe('providers')
    expect(settingsGroupForKey('modelRoles')).toBe('providers')
    expect(settingsGroupForKey('seperateModels')).toBe('runtime')
    expect(settingsGroupForKey('seperateModelsForAxModels')).toBe('runtime')
    expect(settingsGroupForKey('doNotChangeSeperateModels')).toBe('runtime')
    expect(settingsGroupForKey('seperateParameters')).toBe('runtime')
    expect(settingsGroupForKey('seperateParametersByModel')).toBe('runtime')
    expect(settingsGroupForKey('seperateParametersEnabled')).toBe('runtime')
    expect(settingsGroupForKey('disableSeperateParameterChangeOnPresetChange')).toBe('runtime')
    expect(settingsGroupForKey('epEnabled')).toBe('runtime')
    expect(settingsGroupForKey('streamGeminiThoughts')).toBe('runtime')
    expect(settingsGroupForKey('verbosity')).toBe('runtime')
    expect(settingsGroupForKey('doNotWarnExternalServers')).toBe('advanced')
    expect(settingsGroupForKey('pluginCompatibilityMode')).toBe('advanced')
    expect(settingsGroupForKey('strictScriptCheck')).toBe('advanced')
    expect(settingsGroupForKey('sdProvider')).toBe('media')
    expect(settingsGroupForKey('webUiUrl')).toBe('media')
    expect(settingsGroupForKey('sdSteps')).toBe('media')
    expect(settingsGroupForKey('sdCFG')).toBe('media')
    expect(settingsGroupForKey('sdConfig')).toBe('media')
    expect(settingsGroupForKey('NAIImgUrl')).toBe('media')
    expect(settingsGroupForKey('NAIApiKey')).toBe('media')
    expect(settingsGroupForKey('NAIImgModel')).toBe('media')
    expect(settingsGroupForKey('NAII2I')).toBe('media')
    expect(settingsGroupForKey('NAIImgConfig')).toBe('media')
    expect(settingsGroupForKey('dallEQuality')).toBe('media')
    expect(settingsGroupForKey('stabilityKey')).toBe('media')
    expect(settingsGroupForKey('stabilityModel')).toBe('media')
    expect(settingsGroupForKey('stabllityStyle')).toBe('media')
    expect(settingsGroupForKey('comfyConfig')).toBe('media')
    expect(settingsGroupForKey('comfyUiUrl')).toBe('media')
    expect(settingsGroupForKey('falToken')).toBe('media')
    expect(settingsGroupForKey('falModel')).toBe('media')
    expect(settingsGroupForKey('falLora')).toBe('media')
    expect(settingsGroupForKey('falLoraScale')).toBe('media')
    expect(settingsGroupForKey('ImagenModel')).toBe('media')
    expect(settingsGroupForKey('ImagenImageSize')).toBe('media')
    expect(settingsGroupForKey('ImagenAspectRatio')).toBe('media')
    expect(settingsGroupForKey('ImagenPersonGeneration')).toBe('media')
    expect(settingsGroupForKey('openaiCompatImage')).toBe('media')
    expect(settingsGroupForKey('wavespeedImage')).toBe('media')
    expect(settingsGroupForKey('ttsAutoSpeech')).toBe('media')
    expect(settingsGroupForKey('elevenLabKey')).toBe('media')
    expect(settingsGroupForKey('voicevoxUrl')).toBe('media')
    expect(settingsGroupForKey('huggingfaceKey')).toBe('providers')
    expect(settingsGroupForKey('fishSpeechKey')).toBe('media')
    expect(settingsGroupForKey('emotionProcesser')).toBe('media')
    expect(settingsGroupForKey('hypaV3')).toBe('memory')
    expect(settingsGroupForKey('hypaV3Presets')).toBe('memory')
    expect(settingsGroupForKey('hypaV3PresetId')).toBe('memory')
    expect(settingsGroupForKey('hypaModel')).toBe('memory')
    expect(settingsGroupForKey('hypaV3Key')).toBe('memory')
    expect(settingsGroupForKey('hypaCustomSettings')).toBe('memory')
    expect(settingsGroupForKey('voyageApiKey')).toBe('memory')
    expect(settingsGroupForKey('enableCustomFlags')).toBe('advanced')
    expect(settingsGroupForKey('customFlags')).toBe('advanced')
  })

  it('does not map retired Context Agent settings to command groups', () => {
    expect(settingsGroupForKey('agentContextEnabled')).toBeNull()
    expect(settingsGroupForKey('agentContextPrompt')).toBeNull()
    expect(settingsGroupForKey('agentContextMaxOutput')).toBeNull()
    expect(settingsGroupForKey('agentContextMaxToolRounds')).toBeNull()
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

  it('does not let an older asynchronous response move the cached revision backward', () => {
    setCachedServerCommandRevision(12)
    setCachedServerCommandRevision(9)

    expect(peekCachedServerCommandRevision()).toBe(12)
  })

  it('tracks the known command revision independently from the applied resource revision', () => {
    setAppliedServerResourceRevision(7)
    setCachedServerCommandRevision(9)

    expect(peekCachedServerCommandRevision()).toBe(9)
    expect(peekAppliedServerResourceRevision()).toBe(7)
  })

  it('maps revision conflicts to a typed conflict result', async () => {
    const commandFetch = makeCommandFetch(() => jsonResponse({ error: 'revision_conflict', currentRevision: 7 }, 409))
    vi.stubGlobal('fetch', commandFetch.fetch)

    const result = await patchRuntimeSettings({
      baseRevision: 6,
      patch: { streamGeminiThoughts: true },
    })

    expect(result).toEqual({ status: 'conflict', currentRevision: 7 })
    expect(peekCachedServerCommandRevision()).toBe(7)
    expect(peekAppliedServerResourceRevision()).toBeNull()
  })

  it('maps command errors to status:error', async () => {
    const commandFetch = makeCommandFetch(() => jsonResponse({ error: 'streamGeminiThoughts must be a boolean' }, 400))
    vi.stubGlobal('fetch', commandFetch.fetch)

    const result = await patchRuntimeSettings({
      baseRevision: 1,
      patch: { streamGeminiThoughts: true },
    })

    expect(result).toEqual({
      status: 'error',
      error: 'streamGeminiThoughts must be a boolean',
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

  it('routes residual manual settings through existing settings groups', async () => {
    const commandFetch = makeCommandFetch((url) => {
      if (url === '/api/v1/bootstrap') return { revision: 20 }
      if (url.endsWith('/settings/display')) {
        return {
          revision: 21,
          event: { type: 'settings.updated', revision: 21, resource: 'settings' },
        }
      }
      if (url.endsWith('/settings/providers')) {
        return {
          revision: 22,
          event: { type: 'settings.updated', revision: 22, resource: 'settings' },
        }
      }
      return {
        revision: 23,
        event: { type: 'settings.updated', revision: 23, resource: 'settings' },
      }
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    const result = await patchServerBackedSettings({
      patch: {
        colorSchemeName: 'custom',
        textScreenColor: null,
        promptDiffPrefs: { diffStyle: 'line', contextRadius: 2 },
        customModels: [{ id: 'model-a', name: 'Model A' }],
        bias: [['token', -10]],
        additionalParams: [['stop', 'value']],
        moduleIntergration: 'module-ns',
        globalscript: [{ id: 'script-a', in: 'foo', out: 'bar', type: 'editinput' }],
        banCharacterset: ['Latn'],
        allowAllExtentionFiles: true,
        auxModelUnderModelSettings: true,
        showUnrecommended: true,
        enableCustomFlags: true,
        customFlags: [8],
      },
    })

    expect(result).toEqual({
      status: 'ok',
      revision: 23,
      event: { type: 'settings.updated', revision: 23, resource: 'settings' },
    })
    expect(commandFetch.calls.map((call) => ({ url: call.url, body: call.body }))).toEqual([
      {
        url: '/api/v1/bootstrap',
        body: null,
      },
      {
        url: '/api/v1/commands/settings/display',
        body: {
          baseRevision: 20,
          patch: {
            colorSchemeName: 'custom',
            textScreenColor: null,
            promptDiffPrefs: { diffStyle: 'line', contextRadius: 2 },
          },
        },
      },
      {
        url: '/api/v1/commands/settings/providers',
        body: {
          baseRevision: 21,
          patch: {
            customModels: [{ id: 'model-a', name: 'Model A' }],
            bias: [['token', -10]],
            additionalParams: [['stop', 'value']],
          },
        },
      },
      {
        url: '/api/v1/commands/settings/advanced',
        body: {
          baseRevision: 22,
          patch: {
            moduleIntergration: 'module-ns',
            globalscript: [{ id: 'script-a', in: 'foo', out: 'bar', type: 'editinput' }],
            banCharacterset: ['Latn'],
            allowAllExtentionFiles: true,
            auxModelUnderModelSettings: true,
            showUnrecommended: true,
            enableCustomFlags: true,
            customFlags: [8],
          },
        },
      },
    ])
  })

  it('surfaces server-backed settings patch conflicts without retrying', async () => {
    let providerAttempts = 0
    const commandFetch = makeCommandFetch((url) => {
      if (url === '/api/v1/bootstrap') return { revision: 4 }
      if (url.endsWith('/settings/providers')) {
        providerAttempts += 1
        if (providerAttempts === 1) {
          return jsonResponse({ error: 'revision_conflict', currentRevision: 8 }, 409)
        }
        throw new Error('unexpected retry')
      }
      return { revision: 10 }
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    await expect(
      patchServerBackedSettings({
        patch: { openrouterKey: 'secret' },
      }),
    ).resolves.toEqual({ status: 'conflict', currentRevision: 8 })

    expect(commandFetch.calls.map((call) => call.body)).toEqual([
      null,
      { baseRevision: 4, patch: { openrouterKey: 'secret' } },
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

  it('skips settings rollback when a destructive refresh lands before patch failure', async () => {
    const liveSettings = { aiModel: 'attempted' }
    const rollback = vi.fn(() => {
      if (liveSettings.aiModel === 'attempted') liveSettings.aiModel = 'before'
    })
    const commandFetch = makeCommandFetch((url) => {
      if (url === '/api/v1/bootstrap') return { revision: 1 }
      createDestructiveRefreshToken('test-full-settings-restore')
      liveSettings.aiModel = 'attempted'
      return jsonResponse({ error: 'aiModel must be a string' }, 400)
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    const result = await patchServerBackedSettings({
      patch: { aiModel: 1 },
      rollback,
    })

    expect(result).toEqual({ status: 'error', error: 'aiModel must be a string' })
    expect(rollback).not.toHaveBeenCalled()
    expect(liveSettings.aiModel).toBe('attempted')
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

  it('copies and imports presets through typed command helpers with stable ids', async () => {
    const commandFetch = makeCommandFetch((url) => {
      if (url.endsWith('/presets/preset-a/copy')) {
        return {
          revision: 2,
          event: { type: 'preset.copied', revision: 2, resource: 'preset', id: 'preset-copy' },
          presetId: 'preset-copy',
          sourcePresetId: 'preset-a',
        }
      }
      return {
        revision: 3,
        event: { type: 'preset.imported', revision: 3, resource: 'preset', id: 'preset-import' },
        presetId: 'preset-import',
      }
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    await expect(
      copyPresetCommand({
        baseRevision: 1,
        presetId: 'preset-a',
        newPresetId: 'preset-copy',
        name: 'A Copy',
        saveCurrent: true,
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 2, presetId: 'preset-copy' })

    await expect(
      importPresetCommand({
        baseRevision: 2,
        preset: { id: 'preset-import', name: 'Imported' },
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 3, presetId: 'preset-import' })

    expect(commandFetch.calls.map((call) => ({ url: call.url, body: call.body }))).toEqual([
      {
        url: '/api/v1/commands/presets/preset-a/copy',
        body: {
          baseRevision: 1,
          newPresetId: 'preset-copy',
          name: 'A Copy',
          saveCurrent: true,
        },
      },
      {
        url: '/api/v1/commands/presets/import',
        body: {
          baseRevision: 2,
          preset: { id: 'preset-import', name: 'Imported' },
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

  it('dispatches model profile commands through typed helpers', async () => {
    const commandFetch = makeCommandFetch((url) => {
      const event = { type: 'modelProfile.test', revision: 99, resource: 'modelProfile' }
      if (url.endsWith('/model-profiles/source-profile/duplicate')) {
        return { revision: 99, event, profileId: 'copy-profile', sourceProfileId: 'source-profile' }
      }
      if (url.endsWith('/model-profiles/create-and-bind')) {
        return { revision: 99, event, profileId: 'bound-profile', role: 'memory' }
      }
      if (url.endsWith('/model-profiles/convert-legacy')) {
        return { revision: 99, event, profileIdsByRole: { chatMain: 'main-profile' }, convertedRoles: ['chatMain'] }
      }
      if (url.endsWith('/model-role-profiles')) {
        return { revision: 99, event, roles: ['memory'] }
      }
      if (url.endsWith('/model-runtime-defaults')) {
        return { revision: 99, event }
      }
      if (url.endsWith('/model-profiles/profile-a')) {
        return { revision: 99, event, profileId: 'profile-a', reassignedRoles: ['memory'] }
      }
      return { revision: 99, event, profileId: 'new-profile' }
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    await createModelProfileCommand({
      baseRevision: 1,
      profile: { name: 'Created', modelId: 'gpt-5' },
    })
    await updateModelProfileCommand({
      baseRevision: 2,
      profileId: 'profile-a',
      profile: { id: 'profile-a', name: 'Updated', modelId: 'gpt-4o' },
    })
    await duplicateModelProfileCommand({
      baseRevision: 3,
      profileId: 'source-profile',
      name: 'Copy',
      includeSecrets: true,
    })
    await deleteModelProfileCommand({
      baseRevision: 4,
      profileId: 'profile-a',
      reassignments: { memory: { mode: 'inherit' } },
    })
    await updateModelRoleProfilesCommand({
      baseRevision: 5,
      bindings: { memory: { mode: 'profile', profileId: 'profile-a' } },
    })
    await createAndBindModelProfileCommand({
      baseRevision: 6,
      role: 'memory',
      profile: { name: 'Bound', modelId: 'gpt-5' },
    })
    await updateModelRuntimeDefaultsCommand({
      baseRevision: 7,
      runtimeDefaults: { temperature: 55 },
    })
    await convertLegacyModelProfilesCommand({
      baseRevision: 8,
    })

    expect(commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body }))).toEqual([
      {
        url: '/api/v1/commands/model-profiles',
        method: 'POST',
        body: {
          baseRevision: 1,
          profile: { name: 'Created', modelId: 'gpt-5' },
        },
      },
      {
        url: '/api/v1/commands/model-profiles/profile-a',
        method: 'PATCH',
        body: {
          baseRevision: 2,
          profile: { id: 'profile-a', name: 'Updated', modelId: 'gpt-4o' },
        },
      },
      {
        url: '/api/v1/commands/model-profiles/source-profile/duplicate',
        method: 'POST',
        body: {
          baseRevision: 3,
          name: 'Copy',
          includeSecrets: true,
        },
      },
      {
        url: '/api/v1/commands/model-profiles/profile-a',
        method: 'DELETE',
        body: {
          baseRevision: 4,
          reassignments: { memory: { mode: 'inherit' } },
        },
      },
      {
        url: '/api/v1/commands/model-role-profiles',
        method: 'PUT',
        body: {
          baseRevision: 5,
          bindings: { memory: { mode: 'profile', profileId: 'profile-a' } },
        },
      },
      {
        url: '/api/v1/commands/model-profiles/create-and-bind',
        method: 'POST',
        body: {
          baseRevision: 6,
          role: 'memory',
          profile: { name: 'Bound', modelId: 'gpt-5' },
        },
      },
      {
        url: '/api/v1/commands/model-runtime-defaults',
        method: 'PUT',
        body: {
          baseRevision: 7,
          runtimeDefaults: { temperature: 55 },
        },
      },
      {
        url: '/api/v1/commands/model-profiles/convert-legacy',
        method: 'POST',
        body: {
          baseRevision: 8,
        },
      },
    ])
  })

  it('dispatches Agent Preset commands through typed helpers', async () => {
    const commandFetch = makeCommandFetch((url) => {
      const event = { type: 'agentPreset.test', revision: 99, resource: 'agentPreset' }
      if (url.endsWith('/agent-presets/ap_a/steps/aps_a/duplicate')) {
        return { revision: 99, event, presetId: 'ap_a', stepId: 'aps_copy', sourceStepId: 'aps_a' }
      }
      if (url.endsWith('/agent-presets/ap_a/steps/aps_b')) {
        return { revision: 99, event, presetId: 'ap_a', stepId: 'aps_b' }
      }
      if (url.endsWith('/agent-presets/ap_a/steps/aps_a')) {
        return { revision: 99, event, presetId: 'ap_a', stepId: 'aps_a' }
      }
      if (url.endsWith('/agent-presets/ap_a/steps/reorder')) {
        return { revision: 99, event, presetId: 'ap_a' }
      }
      if (url.endsWith('/agent-presets/ap_a/steps')) {
        return { revision: 99, event, presetId: 'ap_a', stepId: 'aps_a' }
      }
      if (url.endsWith('/agent-presets/default')) {
        return { revision: 99, event, agentPresetDefaultId: 'ap_b' }
      }
      if (url.endsWith('/agent-presets/reorder')) {
        return { revision: 99, event, agentPresetDefaultId: 'ap_a' }
      }
      if (url.endsWith('/agent-presets/ap_a/duplicate')) {
        return { revision: 99, event, presetId: 'ap_copy', sourcePresetId: 'ap_a' }
      }
      if (url.endsWith('/agent-presets/ap_b')) {
        return {
          revision: 99,
          event: { type: 'agentPreset.deleted', revision: 99, resource: 'agentPresetDeleted', id: 'ap_b' },
          presetId: 'ap_b',
          clearedDefault: true,
          clearedChatCount: 2,
          clearedLoadoutCount: 1,
        }
      }
      if (url.endsWith('/agent-presets/ap_a')) {
        return { revision: 99, event, presetId: 'ap_a' }
      }
      return { revision: 99, event, presetId: 'ap_a' }
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    await createAgentPresetCommand({
      baseRevision: 1,
      preset: { name: 'Created' },
    })
    await updateAgentPresetCommand({
      baseRevision: 2,
      presetId: 'ap_a',
      patch: { name: 'Updated', enabled: false },
    })
    await duplicateAgentPresetCommand({
      baseRevision: 3,
      presetId: 'ap_a',
      name: 'Copy',
    })
    await deleteAgentPresetCommand({
      baseRevision: 4,
      presetId: 'ap_b',
    })
    await reorderAgentPresetsCommand({
      baseRevision: 5,
      presetIds: ['ap_b', 'ap_a'],
    })
    await setAgentPresetDefaultCommand({
      baseRevision: 6,
      agentPresetId: 'ap_b',
    })
    await createAgentPresetStepCommand({
      baseRevision: 7,
      presetId: 'ap_a',
      step: { name: 'Step' },
    })
    await updateAgentPresetStepCommand({
      baseRevision: 8,
      presetId: 'ap_a',
      stepId: 'aps_a',
      patch: { outputKey: 'facts' },
    })
    await duplicateAgentPresetStepCommand({
      baseRevision: 9,
      presetId: 'ap_a',
      stepId: 'aps_a',
      name: 'Step Copy',
    })
    await deleteAgentPresetStepCommand({
      baseRevision: 10,
      presetId: 'ap_a',
      stepId: 'aps_b',
    })
    await reorderAgentPresetStepsCommand({
      baseRevision: 11,
      presetId: 'ap_a',
      stepIds: ['aps_b', 'aps_a'],
    })

    expect(commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body }))).toEqual([
      {
        url: '/api/v1/commands/agent-presets',
        method: 'POST',
        body: {
          baseRevision: 1,
          preset: { name: 'Created' },
        },
      },
      {
        url: '/api/v1/commands/agent-presets/ap_a',
        method: 'PATCH',
        body: {
          baseRevision: 2,
          patch: { name: 'Updated', enabled: false },
        },
      },
      {
        url: '/api/v1/commands/agent-presets/ap_a/duplicate',
        method: 'POST',
        body: {
          baseRevision: 3,
          name: 'Copy',
        },
      },
      {
        url: '/api/v1/commands/agent-presets/ap_b',
        method: 'DELETE',
        body: {
          baseRevision: 4,
        },
      },
      {
        url: '/api/v1/commands/agent-presets/reorder',
        method: 'POST',
        body: {
          baseRevision: 5,
          presetIds: ['ap_b', 'ap_a'],
        },
      },
      {
        url: '/api/v1/commands/agent-presets/default',
        method: 'POST',
        body: {
          baseRevision: 6,
          agentPresetId: 'ap_b',
        },
      },
      {
        url: '/api/v1/commands/agent-presets/ap_a/steps',
        method: 'POST',
        body: {
          baseRevision: 7,
          step: { name: 'Step' },
        },
      },
      {
        url: '/api/v1/commands/agent-presets/ap_a/steps/aps_a',
        method: 'PATCH',
        body: {
          baseRevision: 8,
          patch: { outputKey: 'facts' },
        },
      },
      {
        url: '/api/v1/commands/agent-presets/ap_a/steps/aps_a/duplicate',
        method: 'POST',
        body: {
          baseRevision: 9,
          name: 'Step Copy',
        },
      },
      {
        url: '/api/v1/commands/agent-presets/ap_a/steps/aps_b',
        method: 'DELETE',
        body: {
          baseRevision: 10,
        },
      },
      {
        url: '/api/v1/commands/agent-presets/ap_a/steps/reorder',
        method: 'POST',
        body: {
          baseRevision: 11,
          stepIds: ['aps_b', 'aps_a'],
        },
      },
    ])
  })

  it('runs server preset commands with revision lookup and surfaces conflicts', async () => {
    let selectAttempts = 0
    const commandFetch = makeCommandFetch((url) => {
      if (url === '/api/v1/bootstrap') return { revision: 5 }
      selectAttempts += 1
      if (selectAttempts === 1) {
        return jsonResponse({ error: 'revision_conflict', currentRevision: 8 }, 409)
      }
      throw new Error('unexpected retry')
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
    ).resolves.toEqual({ status: 'conflict', currentRevision: 8 })

    expect(commandFetch.calls.map((call) => call.body)).toEqual([null, { baseRevision: 5, presetId: 'preset-b' }])
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
      if (url.endsWith('/prompt-items/enable')) {
        return {
          revision: 7,
          event: { type: 'prompt.item.enabled', revision: 7, resource: 'promptItem' },
          enabled: true,
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
        patch: {
          mainPrompt: 'MAIN',
          jailbreak: 'JB',
          globalNote: 'GN',
          formatingOrder: ['main', 'jailbreak'],
          promptPreprocess: true,
          presetRegex: [{ id: 'regex-a', type: 'editinput', in: 'hello', out: 'hi' }],
          promptSettings: { sendName: true },
        },
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 2 })

    await expect(
      createPromptItemCommand({
        baseRevision: 2,
        promptPresetId: 'prompt-preset-a',
        promptItem: { id: 'item-b', type: 'memory' },
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 3, itemId: 'item-b' })

    await expect(
      updatePromptItemCommand({
        baseRevision: 3,
        promptPresetId: 'prompt-preset-a',
        itemId: 'item-b',
        patch: { type: 'description' },
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 4, itemId: 'item-b' })

    await expect(
      deletePromptItemCommand({
        baseRevision: 4,
        promptPresetId: 'prompt-preset-a',
        itemId: 'item-a',
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 5, itemId: 'item-a' })

    await expect(
      reorderPromptItemsCommand({
        baseRevision: 5,
        promptPresetId: 'prompt-preset-a',
        itemIds: ['item-b'],
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 6 })

    await expect(
      enablePromptItemsCommand({
        baseRevision: 6,
        promptPresetId: 'prompt-preset-a',
        enabled: true,
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 7, enabled: true })

    expect(commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body }))).toEqual([
      {
        url: '/api/v1/commands/prompt-settings',
        method: 'PATCH',
        body: {
          baseRevision: 1,
          patch: {
            mainPrompt: 'MAIN',
            jailbreak: 'JB',
            globalNote: 'GN',
            formatingOrder: ['main', 'jailbreak'],
            promptPreprocess: true,
            presetRegex: [{ id: 'regex-a', type: 'editinput', in: 'hello', out: 'hi' }],
            promptSettings: { sendName: true },
          },
        },
      },
      {
        url: '/api/v1/commands/prompt-items',
        method: 'POST',
        body: { baseRevision: 2, promptPresetId: 'prompt-preset-a', promptItem: { id: 'item-b', type: 'memory' } },
      },
      {
        url: '/api/v1/commands/prompt-items/item-b',
        method: 'PATCH',
        body: { baseRevision: 3, promptPresetId: 'prompt-preset-a', patch: { type: 'description' } },
      },
      {
        url: '/api/v1/commands/prompt-items/item-a',
        method: 'DELETE',
        body: { baseRevision: 4, promptPresetId: 'prompt-preset-a' },
      },
      {
        url: '/api/v1/commands/prompt-items/reorder',
        method: 'POST',
        body: { baseRevision: 5, promptPresetId: 'prompt-preset-a', itemIds: ['item-b'] },
      },
      {
        url: '/api/v1/commands/prompt-items/enable',
        method: 'POST',
        body: { baseRevision: 6, promptPresetId: 'prompt-preset-a', enabled: true },
      },
    ])
  })

  it('runs prompt commands with revision lookup and surfaces conflicts', async () => {
    let attempts = 0
    const commandFetch = makeCommandFetch((url) => {
      if (url === '/api/v1/bootstrap') return { revision: 11 }
      attempts += 1
      if (attempts === 1) {
        return jsonResponse({ error: 'revision_conflict', currentRevision: 14 }, 409)
      }
      throw new Error('unexpected retry')
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
    ).resolves.toEqual({ status: 'conflict', currentRevision: 14 })

    expect(commandFetch.calls.map((call) => call.body)).toEqual([null, { baseRevision: 11, patch: { type: 'memory' } }])
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

    expect(commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body }))).toEqual([
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
          selectPersonaId: 'persona-b',
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

  it('runs persona commands with revision lookup and surfaces conflicts', async () => {
    let attempts = 0
    const commandFetch = makeCommandFetch((url) => {
      if (url === '/api/v1/bootstrap') return { revision: 20 }
      attempts += 1
      if (attempts === 1) {
        return jsonResponse({ error: 'revision_conflict', currentRevision: 23 }, 409)
      }
      throw new Error('unexpected retry')
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
    ).resolves.toEqual({ status: 'conflict', currentRevision: 23 })

    expect(commandFetch.calls.map((call) => call.body)).toEqual([null, { baseRevision: 20, personaId: 'persona-b' }])
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

    expect(commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body }))).toEqual([
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
          selectPresetId: 'translator-b',
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

  it('runs translator preset commands with revision lookup and surfaces conflicts', async () => {
    let attempts = 0
    const commandFetch = makeCommandFetch((url) => {
      if (url === '/api/v1/bootstrap') return { revision: 30 }
      attempts += 1
      if (attempts === 1) {
        return jsonResponse({ error: 'revision_conflict', currentRevision: 33 }, 409)
      }
      throw new Error('unexpected retry')
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
    ).resolves.toEqual({ status: 'conflict', currentRevision: 33 })

    expect(commandFetch.calls.map((call) => call.body)).toEqual([null, { baseRevision: 30, presetId: 'translator-b' }])
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

    expect(commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body }))).toEqual([
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

  it('runs loadout commands with revision lookup and surfaces conflicts', async () => {
    let attempts = 0
    const commandFetch = makeCommandFetch((url) => {
      if (url === '/api/v1/bootstrap') return { revision: 40 }
      attempts += 1
      if (attempts === 1) {
        return jsonResponse({ error: 'revision_conflict', currentRevision: 43 }, 409)
      }
      throw new Error('unexpected retry')
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
    ).resolves.toEqual({ status: 'conflict', currentRevision: 43 })

    expect(commandFetch.calls.map((call) => call.body)).toEqual([null, { baseRevision: 40, favorite: false }])
  })

  it('strips embedded chats from character create command payloads without mutating input', async () => {
    const commandFetch = makeCommandFetch((url) => ({
      revision: url.endsWith('/create-and-select') ? 3 : 2,
      event: {
        type: url.endsWith('/create-and-select') ? 'character.createdAndSelected' : 'character.created',
        revision: url.endsWith('/create-and-select') ? 3 : 2,
        resource: 'character',
      },
      characterId: url.endsWith('/create-and-select') ? 'char-selected' : 'char-created',
    }))
    vi.stubGlobal('fetch', commandFetch.fetch)

    const createChat = {
      id: 'chat-created',
      name: 'Starter',
      message: [{ role: 'user', data: 'hello' }],
    }
    const createCharacter = {
      chaId: 'char-created',
      name: 'Created',
      chatPage: 0,
      chats: [createChat],
    }
    const selectChat = {
      id: 'chat-selected',
      name: 'Starter',
      message: [{ role: 'char', data: 'hi' }],
    }
    const selectCharacter = {
      chaId: 'char-selected',
      name: 'Selected',
      chatPage: 0,
      chats: [selectChat],
    }

    await expect(
      createCharacterCommand({
        baseRevision: 1,
        character: createCharacter,
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 2, characterId: 'char-created' })

    await expect(
      createAndSelectCharacterCommand({
        baseRevision: 2,
        character: selectCharacter,
        lastInteraction: 1234,
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 3, characterId: 'char-selected' })

    expect(commandFetch.calls.map((call) => call.body)).toEqual([
      {
        baseRevision: 1,
        character: {
          chaId: 'char-created',
          name: 'Created',
          chatPage: 0,
        },
      },
      {
        baseRevision: 2,
        character: {
          chaId: 'char-selected',
          name: 'Selected',
          chatPage: 0,
        },
        lastInteraction: 1234,
      },
    ])
    expect(createCharacter.chats).toEqual([createChat])
    expect(selectCharacter.chats).toEqual([selectChat])
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
            resource: 'characterSelection',
            id: 'char-a',
          },
          characterId: 'char-a',
        }
      }
      if (url.endsWith('/characters/create-and-select')) {
        return {
          revision: 7,
          event: {
            type: 'character.createdAndSelected',
            revision: 7,
            resource: 'character',
            id: 'char-c',
          },
          characterId: 'char-c',
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
        patch: {
          name: 'B renamed',
          image: 'a'.repeat(64),
          systemPrompt: 'new system prompt',
          ttsMode: 'openai',
          oaiTTSConfig: { enabled: true, voice: 'alloy', model: 'tts-1', format: 'mp3' },
          depth_prompt: { depth: 2, prompt: 'stay close' },
        },
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
        lastInteraction: 1234,
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

    await expect(
      createAndSelectCharacterCommand({
        baseRevision: 6,
        character: { chaId: 'char-c', name: 'C' },
        lastInteraction: 5678,
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 7, characterId: 'char-c' })

    expect(commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body }))).toEqual([
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
          patch: {
            name: 'B renamed',
            image: 'a'.repeat(64),
            systemPrompt: 'new system prompt',
            ttsMode: 'openai',
            oaiTTSConfig: { enabled: true, voice: 'alloy', model: 'tts-1', format: 'mp3' },
            depth_prompt: { depth: 2, prompt: 'stay close' },
          },
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
          lastInteraction: 1234,
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
      {
        url: '/api/v1/commands/characters/create-and-select',
        method: 'POST',
        body: {
          baseRevision: 6,
          character: { chaId: 'char-c', name: 'C' },
          lastInteraction: 5678,
        },
      },
    ])
  })

  it('runs character commands with revision lookup and surfaces conflicts', async () => {
    let attempts = 0
    const commandFetch = makeCommandFetch((url) => {
      if (url === '/api/v1/bootstrap') return { revision: 50 }
      attempts += 1
      if (attempts === 1) {
        return jsonResponse({ error: 'revision_conflict', currentRevision: 52 }, 409)
      }
      throw new Error('unexpected retry')
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
    ).resolves.toEqual({ status: 'conflict', currentRevision: 52 })

    expect(commandFetch.calls.map((call) => call.body)).toEqual([null, { baseRevision: 50, characterId: 'char-a' }])
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

    expect(commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body }))).toEqual([
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

  it('dispatches message translation commands through the typed helper', async () => {
    const translation = {
      text: 'translated raw',
      source: 'raw',
      sourceHash: 'a'.repeat(64),
      targetLanguage: 'ko',
      inputLanguage: 'en',
      translatorType: 'llm',
      settingsHash: 'b'.repeat(64),
      updatedAt: 123,
    }
    const commandFetch = makeCommandFetch(() => ({
      revision: 2,
      event: {
        type: 'message.updated',
        revision: 2,
        resource: 'message',
        id: 'msg-a',
      },
      chatId: 'chat-a',
      messageId: 'msg-a',
      translation,
    }))
    vi.stubGlobal('fetch', commandFetch.fetch)

    await expect(
      translateMessageCommand({
        baseRevision: 1,
        messageId: 'msg-a',
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 2, messageId: 'msg-a', translation })

    expect(commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body }))).toEqual([
      {
        url: '/api/v1/commands/messages/msg-a/translate',
        method: 'POST',
        body: {
          baseRevision: 1,
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
      if (url.endsWith('/messages/tail')) {
        return {
          revision: 5,
          event: { type: 'messages.replaced', revision: 5, resource: 'message' },
          chatId: 'chat-a',
          afterMessageId: 'msg-a',
          messageIds: ['msg-b'],
          replacedCount: 1,
        }
      }
      if (url.endsWith('/chats/chat-a/messages')) {
        const method = commandFetch.calls.at(-1)?.method
        return method === 'PUT'
          ? {
              revision: 6,
              event: { type: 'messages.replaced', revision: 6, resource: 'message' },
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
          revision: 7,
          event: {
            type: 'generation.persisted',
            revision: 7,
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
      replaceTailMessagesCommand({
        baseRevision: 4,
        chatId: 'chat-a',
        afterMessageId: 'msg-a',
        messages: [{ role: 'char', data: 'replacement', chatId: 'msg-b' }],
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 5, chatId: 'chat-a', messageIds: ['msg-b'] })

    await expect(
      replaceMessagesCommand({
        baseRevision: 5,
        chatId: 'chat-a',
        messages: [{ role: 'char', data: 'replacement', chatId: 'msg-b' }],
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 6, chatId: 'chat-a' })

    await expect(
      persistGenerationResultCommand({
        baseRevision: 6,
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
    ).resolves.toMatchObject({ status: 'ok', revision: 7, messageId: 'gen-a' })

    expect(commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body }))).toEqual([
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
        url: '/api/v1/commands/chats/chat-a/messages/tail',
        method: 'POST',
        body: {
          baseRevision: 4,
          afterMessageId: 'msg-a',
          messages: [{ role: 'char', data: 'replacement', chatId: 'msg-b' }],
        },
      },
      {
        url: '/api/v1/commands/chats/chat-a/messages',
        method: 'PUT',
        body: {
          baseRevision: 5,
          messages: [{ role: 'char', data: 'replacement', chatId: 'msg-b' }],
        },
      },
      {
        url: '/api/v1/commands/chats/chat-a/generation-result',
        method: 'POST',
        body: {
          baseRevision: 6,
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

    expect(commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body }))).toEqual([
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

  it('dispatches chat generation settings through the dedicated typed helper', async () => {
    const observedEffects: unknown[] = []
    setServerCommandSuccessReconciler((_event, _coalescedEvents, localEffects) => {
      observedEffects.push(...localEffects.values())
    })
    const attemptedGenerationSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
      agentPresetId: 'agent-preset-a',
      jailbreakToggle: false,
      sidebarToggles: {
        mode: '0',
        notes: '',
      },
    }
    const canonicalGenerationSettings = {
      ...attemptedGenerationSettings,
      sidebarToggles: { mode: '0' },
    }
    const commandFetch = makeCommandFetch((url) => {
      if (url.endsWith('/chats/chat-a/generation-settings')) {
        return {
          revision: 8,
          event: {
            type: 'chat.updated',
            revision: 8,
            resource: 'characterRow',
            id: 'chat-a',
            parentId: 'char-a',
          },
          chatId: 'chat-a',
          characterId: 'char-a',
          generationSettings: canonicalGenerationSettings,
        }
      }
      return jsonResponse({ error: 'unexpected' }, 500)
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    await expect(
      saveChatGenerationSettingsCommand({
        baseRevision: 7,
        chatId: 'chat-a',
        generationSettings: attemptedGenerationSettings,
      }),
    ).resolves.toMatchObject({
      status: 'ok',
      revision: 8,
      chatId: 'chat-a',
      characterId: 'char-a',
      generationSettings: canonicalGenerationSettings,
    })

    expect(observedEffects).toEqual([
      {
        kind: 'chatGenerationSettings',
        chatId: 'chat-a',
        characterId: 'char-a',
        attemptedGenerationSettings,
        generationSettings: canonicalGenerationSettings,
      },
    ])

    expect(commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body }))).toEqual([
      {
        url: '/api/v1/commands/chats/chat-a/generation-settings',
        method: 'PUT',
        body: {
          baseRevision: 7,
          generationSettings: {
            configured: true,
            personaId: 'persona-a',
            modelPresetId: 'model-preset-a',
            promptPresetId: 'preset-a',
            agentPresetId: 'agent-preset-a',
            jailbreakToggle: false,
            sidebarToggles: {
              mode: '0',
              notes: '',
            },
          },
        },
      },
    ])
  })

  it('reports an accepted character-row patch as a local command effect', async () => {
    const observedEffects: unknown[] = []
    setServerCommandSuccessReconciler((_event, _coalescedEvents, localEffects) => {
      observedEffects.push(...localEffects.values())
    })
    const commandFetch = makeCommandFetch(() => ({
      revision: 3,
      event: {
        type: 'character.updated',
        revision: 3,
        resource: 'characterRow',
        id: 'char-b',
      },
      characterId: 'char-b',
    }))
    vi.stubGlobal('fetch', commandFetch.fetch)

    await expect(
      updateCharacterCommand({
        baseRevision: 2,
        characterId: 'char-b',
        patch: { name: 'B renamed' },
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 3, characterId: 'char-b' })

    expect(observedEffects).toEqual([
      {
        kind: 'characterPatch',
        characterId: 'char-b',
        patch: { name: 'B renamed' },
      },
    ])
  })

  it('reports an accepted character selection as a local command effect', async () => {
    const observedEffects: unknown[] = []
    setServerCommandSuccessReconciler((_event, _coalescedEvents, localEffects) => {
      observedEffects.push(...localEffects.values())
    })
    const commandFetch = makeCommandFetch(() => ({
      revision: 4,
      event: {
        type: 'character.selected',
        revision: 4,
        resource: 'characterSelection',
        id: 'char-b',
      },
      characterId: 'char-b',
    }))
    vi.stubGlobal('fetch', commandFetch.fetch)

    await expect(
      selectCharacterCommand({
        baseRevision: 3,
        characterId: 'char-b',
        lastInteraction: 1234,
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 4, characterId: 'char-b' })

    expect(observedEffects).toEqual([
      {
        kind: 'characterSelection',
        characterId: 'char-b',
        lastInteraction: 1234,
      },
    ])
  })

  it('reports an accepted chat update as a local command effect', async () => {
    const observedEffects: unknown[] = []
    setServerCommandSuccessReconciler((_event, _coalescedEvents, localEffects) => {
      observedEffects.push(...localEffects.values())
    })
    const commandFetch = makeCommandFetch(() => ({
      revision: 5,
      event: {
        type: 'chat.updated',
        revision: 5,
        resource: 'characterRow',
        id: 'chat-a',
        parentId: 'char-a',
      },
      chatId: 'chat-a',
      selectedChatId: 'chat-a',
    }))
    vi.stubGlobal('fetch', commandFetch.fetch)

    await expect(
      updateChatCommand({
        baseRevision: 4,
        chatId: 'chat-a',
        patch: {},
        select: true,
      }),
    ).resolves.toMatchObject({ status: 'ok', revision: 5, selectedChatId: 'chat-a' })

    expect(observedEffects).toEqual([
      {
        kind: 'chatPatch',
        characterId: 'char-a',
        chatId: 'chat-a',
        patch: {},
        select: true,
      },
    ])
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
    await selectGlobalLorebookCommand({ baseRevision: 5, lorebookId: 'book-a' })
    await replaceGlobalLorebookEntriesCommand({
      baseRevision: 6,
      lorebookId: 'book-a',
      entries: [entry],
    })
    await replaceCharacterLorebooksCommand({
      baseRevision: 7,
      characterId: 'char-a',
      entries: [entry],
    })
    await replaceChatLorebooksCommand({ baseRevision: 8, chatId: 'chat-a', entries: [entry] })
    await replaceModuleLorebooksCommand({ baseRevision: 9, moduleId: 'mod-a', entries: [entry] })
    await upsertGlobalLorebookEntryCommand({
      baseRevision: 10,
      lorebookId: 'book-a',
      entryId: 'entry-a',
      entry,
    })
    await upsertCharacterLorebookEntryCommand({
      baseRevision: 11,
      characterId: 'char-a',
      entryId: 'entry-a',
      entry,
    })
    await upsertChatLorebookEntryCommand({
      baseRevision: 12,
      chatId: 'chat-a',
      entryId: 'entry-a',
      entry,
    })
    await upsertModuleLorebookEntryCommand({
      baseRevision: 13,
      moduleId: 'mod-a',
      entryId: 'entry-a',
      entry,
    })
    await deleteGlobalLorebookEntryCommand({ baseRevision: 14, lorebookId: 'book-a', entryId: 'entry-a' })
    await deleteCharacterLorebookEntryCommand({ baseRevision: 15, characterId: 'char-a', entryId: 'entry-a' })
    await deleteChatLorebookEntryCommand({ baseRevision: 16, chatId: 'chat-a', entryId: 'entry-a' })
    await deleteModuleLorebookEntryCommand({ baseRevision: 17, moduleId: 'mod-a', entryId: 'entry-a' })
    await reorderGlobalLorebookEntriesCommand({
      baseRevision: 18,
      lorebookId: 'book-a',
      entryIds: ['entry-b', 'entry-a'],
    })
    await reorderCharacterLorebookEntriesCommand({
      baseRevision: 19,
      characterId: 'char-a',
      entryIds: ['entry-b', 'entry-a'],
    })
    await reorderChatLorebookEntriesCommand({
      baseRevision: 20,
      chatId: 'chat-a',
      entryIds: ['entry-b', 'entry-a'],
    })
    await reorderModuleLorebookEntriesCommand({
      baseRevision: 21,
      moduleId: 'mod-a',
      entryIds: ['entry-b', 'entry-a'],
    })

    expect(commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body }))).toEqual([
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
        url: '/api/v1/commands/lorebooks/book-a/select',
        method: 'POST',
        body: { baseRevision: 5 },
      },
      {
        url: '/api/v1/commands/lorebooks/book-a/entries',
        method: 'PUT',
        body: { baseRevision: 6, entries: [entry] },
      },
      {
        url: '/api/v1/commands/characters/char-a/lorebooks',
        method: 'PUT',
        body: { baseRevision: 7, entries: [entry] },
      },
      {
        url: '/api/v1/commands/chats/chat-a/lorebooks',
        method: 'PUT',
        body: { baseRevision: 8, entries: [entry] },
      },
      {
        url: '/api/v1/commands/modules/mod-a/lorebooks',
        method: 'PUT',
        body: { baseRevision: 9, entries: [entry] },
      },
      {
        url: '/api/v1/commands/lorebooks/book-a/entries/entry-a',
        method: 'PUT',
        body: { baseRevision: 10, entry },
      },
      {
        url: '/api/v1/commands/characters/char-a/lorebooks/entries/entry-a',
        method: 'PUT',
        body: { baseRevision: 11, entry },
      },
      {
        url: '/api/v1/commands/chats/chat-a/lorebooks/entries/entry-a',
        method: 'PUT',
        body: { baseRevision: 12, entry },
      },
      {
        url: '/api/v1/commands/modules/mod-a/lorebooks/entries/entry-a',
        method: 'PUT',
        body: { baseRevision: 13, entry },
      },
      {
        url: '/api/v1/commands/lorebooks/book-a/entries/entry-a',
        method: 'DELETE',
        body: { baseRevision: 14 },
      },
      {
        url: '/api/v1/commands/characters/char-a/lorebooks/entries/entry-a',
        method: 'DELETE',
        body: { baseRevision: 15 },
      },
      {
        url: '/api/v1/commands/chats/chat-a/lorebooks/entries/entry-a',
        method: 'DELETE',
        body: { baseRevision: 16 },
      },
      {
        url: '/api/v1/commands/modules/mod-a/lorebooks/entries/entry-a',
        method: 'DELETE',
        body: { baseRevision: 17 },
      },
      {
        url: '/api/v1/commands/lorebooks/book-a/entries/reorder',
        method: 'POST',
        body: { baseRevision: 18, entryIds: ['entry-b', 'entry-a'] },
      },
      {
        url: '/api/v1/commands/characters/char-a/lorebooks/entries/reorder',
        method: 'POST',
        body: { baseRevision: 19, entryIds: ['entry-b', 'entry-a'] },
      },
      {
        url: '/api/v1/commands/chats/chat-a/lorebooks/entries/reorder',
        method: 'POST',
        body: { baseRevision: 20, entryIds: ['entry-b', 'entry-a'] },
      },
      {
        url: '/api/v1/commands/modules/mod-a/lorebooks/entries/reorder',
        method: 'POST',
        body: { baseRevision: 21, entryIds: ['entry-b', 'entry-a'] },
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

    expect(commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body }))).toEqual([
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

  it('dispatches module record and enablement commands through typed helpers', async () => {
    const commandFetch = makeCommandFetch((url) => {
      if (url.includes('/modules') || url.includes('/characters/char-a/modules/reorder')) {
        return {
          revision: 9,
          event: {
            type: 'module.updated',
            revision: 9,
            resource: 'module',
          },
          moduleId: 'mod-a',
          characterId: 'char-a',
          enabled: true,
        }
      }
      return jsonResponse({ error: 'unexpected' }, 500)
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    await createModuleCommand({
      baseRevision: 1,
      module: { id: 'mod-a', name: 'A', description: 'Module' },
    })
    await updateModuleCommand({
      baseRevision: 2,
      moduleId: 'mod-a',
      patch: { name: 'Renamed', assets: [['asset.png', 'b'.repeat(64), 'png']] },
    })
    await deleteModuleCommand({ baseRevision: 3, moduleId: 'mod-a' })
    await enableModuleCommand({ baseRevision: 4, moduleId: 'mod-a', enabled: true })
    await reorderModulesCommand({ baseRevision: 5, moduleIds: ['mod-b', 'mod-a'] })
    await reorderCharacterModulesCommand({
      baseRevision: 6,
      characterId: 'char-a',
      moduleIds: ['mod-a'],
    })

    expect(commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body }))).toEqual([
      {
        url: '/api/v1/commands/modules',
        method: 'POST',
        body: {
          baseRevision: 1,
          module: { id: 'mod-a', name: 'A', description: 'Module' },
        },
      },
      {
        url: '/api/v1/commands/modules/mod-a',
        method: 'PATCH',
        body: {
          baseRevision: 2,
          patch: { name: 'Renamed', assets: [['asset.png', 'b'.repeat(64), 'png']] },
        },
      },
      {
        url: '/api/v1/commands/modules/mod-a',
        method: 'DELETE',
        body: { baseRevision: 3 },
      },
      {
        url: '/api/v1/commands/modules/enable',
        method: 'POST',
        body: { baseRevision: 4, moduleId: 'mod-a', enabled: true },
      },
      {
        url: '/api/v1/commands/modules/reorder',
        method: 'POST',
        body: { baseRevision: 5, moduleIds: ['mod-b', 'mod-a'] },
      },
      {
        url: '/api/v1/commands/characters/char-a/modules/reorder',
        method: 'POST',
        body: { baseRevision: 6, moduleIds: ['mod-a'] },
      },
    ])
  })

  it('dispatches plugin record and configuration commands through typed helpers', async () => {
    const commandFetch = makeCommandFetch((url) => {
      if (url.includes('/plugins')) {
        return {
          revision: 10,
          event: {
            type: 'plugin.updated',
            revision: 10,
            resource: 'plugin',
          },
          pluginId: 'plugin-a',
          provider: 'provider-a',
          enabled: true,
        }
      }
      return jsonResponse({ error: 'unexpected' }, 500)
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    await createPluginCommand({
      baseRevision: 1,
      plugin: {
        name: 'plugin-a',
        script: 'Risuai.log("hello")',
        arguments: { token: 'string' },
        realArg: { token: '' },
        customLink: [],
        argMeta: {},
        version: '3.0',
        enabled: true,
      },
    })
    await updatePluginCommand({
      baseRevision: 2,
      pluginId: 'plugin-a',
      patch: { realArg: { token: 'abc' } },
    })
    await deletePluginCommand({ baseRevision: 3, pluginId: 'plugin-a' })
    await enablePluginCommand({ baseRevision: 4, pluginId: 'plugin-a', enabled: true })
    await selectPluginProviderCommand({ baseRevision: 5, provider: 'provider-a' })
    await reorderPluginsCommand({ baseRevision: 6, pluginIds: ['plugin-b', 'plugin-a'] })

    expect(commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body }))).toEqual([
      {
        url: '/api/v1/commands/plugins',
        method: 'POST',
        body: {
          baseRevision: 1,
          plugin: {
            name: 'plugin-a',
            script: 'Risuai.log("hello")',
            arguments: { token: 'string' },
            realArg: { token: '' },
            customLink: [],
            argMeta: {},
            version: '3.0',
            enabled: true,
          },
        },
      },
      {
        url: '/api/v1/commands/plugins/plugin-a',
        method: 'PATCH',
        body: { baseRevision: 2, patch: { realArg: { token: 'abc' } } },
      },
      {
        url: '/api/v1/commands/plugins/plugin-a',
        method: 'DELETE',
        body: { baseRevision: 3 },
      },
      {
        url: '/api/v1/commands/plugins/plugin-a/enable',
        method: 'POST',
        body: { baseRevision: 4, enabled: true },
      },
      {
        url: '/api/v1/commands/plugins/provider',
        method: 'POST',
        body: { baseRevision: 5, provider: 'provider-a' },
      },
      {
        url: '/api/v1/commands/plugins/reorder',
        method: 'POST',
        body: { baseRevision: 6, pluginIds: ['plugin-b', 'plugin-a'] },
      },
    ])
  })

  it('dispatches plugin-storage commands through typed helpers', async () => {
    const commandFetch = makeCommandFetch((url) => {
      if (url.includes('/plugin-storage')) {
        return {
          revision: 10,
          event: {
            type: 'pluginStorage.updated',
            revision: 10,
            resource: 'pluginStorage',
          },
          key: 'theme',
        }
      }
      return jsonResponse({ error: 'unexpected' }, 500)
    })
    vi.stubGlobal('fetch', commandFetch.fetch)

    await putPluginStorageCommand({ baseRevision: 1, key: 'theme', value: { mode: 'dark' } })
    await deletePluginStorageCommand({ baseRevision: 2, key: 'theme' })
    await bulkPluginStorageCommand({
      baseRevision: 3,
      values: { score: 42 },
      deleteKeys: ['old'],
      clear: false,
    })

    expect(commandFetch.calls.map((call) => ({ url: call.url, method: call.method, body: call.body }))).toEqual([
      {
        url: '/api/v1/commands/plugin-storage/theme',
        method: 'PUT',
        body: { baseRevision: 1, value: { mode: 'dark' } },
      },
      {
        url: '/api/v1/commands/plugin-storage/theme',
        method: 'DELETE',
        body: { baseRevision: 2 },
      },
      {
        url: '/api/v1/commands/plugin-storage/bulk',
        method: 'POST',
        body: { baseRevision: 3, values: { score: 42 }, deleteKeys: ['old'], clear: false },
      },
    ])
  })
})

describe('L36 runner rejection rollback (stability/perf plan, Phase 3)', () => {
  it('rolls back a failed command result when no destructive refresh occurred', async () => {
    setCachedServerCommandRevision(12)
    const rollback = vi.fn()

    const result = await runServerCommand({
      command: async () => ({ status: 'error' as const, error: 'forced failure' }),
      rollback,
    })

    expect(result).toEqual({ status: 'error', error: 'forced failure' })
    expect(rollback).toHaveBeenCalledTimes(1)
  })

  it('skips command-result rollback when the destructive refresh epoch changed after dispatch', async () => {
    setCachedServerCommandRevision(12)
    const rollback = vi.fn()

    const result = await runServerCommand({
      command: async () => {
        createDestructiveRefreshToken('test-full-resync')
        return { status: 'error' as const, error: 'forced failure' }
      },
      rollback,
    })

    expect(result).toEqual({ status: 'error', error: 'forced failure' })
    expect(rollback).not.toHaveBeenCalled()
  })

  it('captures a fresh epoch for commands dispatched after a destructive refresh', async () => {
    setCachedServerCommandRevision(12)
    createDestructiveRefreshToken('test-refresh-before-dispatch')
    const rollback = vi.fn()

    const result = await runServerCommand({
      command: async () => ({ status: 'error' as const, error: 'forced failure' }),
      rollback,
    })

    expect(result).toEqual({ status: 'error', error: 'forced failure' })
    expect(rollback).toHaveBeenCalledTimes(1)
  })

  it('L36: a rejected command factory rolls back once and resolves to an error result', async () => {
    const commandFetch = makeCommandFetch((url) => {
      if (url === '/api/v1/bootstrap') return { revision: 7 }
      return jsonResponse({ error: 'unexpected' }, 500)
    })
    vi.stubGlobal('fetch', commandFetch.fetch)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const rollback = vi.fn()

    // Pre-fix the rejection escaped `void runServerCommand(...)` as an
    // unhandled rejection and the rollback never ran.
    const result = await runServerCommand({
      command: async () => {
        throw new Error('factory exploded')
      },
      rollback,
    })

    expect(result).toEqual({
      status: 'error',
      error: 'Command factory rejected: factory exploded',
    })
    expect(rollback).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('L36: a synchronous factory throw is also surfaced and rolled back', async () => {
    const commandFetch = makeCommandFetch((url) => {
      if (url === '/api/v1/bootstrap') return { revision: 7 }
      return jsonResponse({ error: 'unexpected' }, 500)
    })
    vi.stubGlobal('fetch', commandFetch.fetch)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const rollback = vi.fn()

    const result = await runServerCommand({
      command: () => {
        throw new TypeError('bad command input')
      },
      rollback,
    })

    expect(result.status).toBe('error')
    expect(rollback).toHaveBeenCalledTimes(1)
    consoleError.mockRestore()
  })
})
