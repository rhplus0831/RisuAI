import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { ResourceRequirement } from './resourceManifest'

const loaderMocks = vi.hoisted(() => ({
  activeChat: vi.fn(async () => true),
  prompt: vi.fn(async () => true),
  promptOwner: vi.fn((): string | null => null),
  refresh: vi.fn(),
  requirements: [] as ResourceRequirement[],
  standalone: vi.fn(),
}))

vi.mock('./resourceManifest', () => ({
  RESOURCE_SURFACE_MANIFEST: { test: { requirements: [] } },
  resourceSurfacesForRoute: (route: { path: string }) => ['shared:app-shell', `test:${route.path}`],
  resolveResourceRequirements: () => loaderMocks.requirements,
  resourceRequirementIdentity: (requirement: ResourceRequirement) => {
    switch (requirement.kind) {
      case 'settings-group':
        return `settings-group:${requirement.group}`
      case 'collection':
        return `collection:${requirement.collection}`
      case 'standalone-setting':
        return `standalone-setting:${requirement.setting}`
      case 'projection':
        return `projection:${requirement.projection}`
    }
  },
}))

vi.mock('./resourceInvalidation', () => ({
  refreshServerResourceTargets: loaderMocks.refresh,
}))

vi.mock('./resourceReads', () => ({
  fetchServerStandaloneSetting: loaderMocks.standalone,
}))

vi.mock('./chatMessageHydration.svelte', () => ({
  hydrateActiveChat: loaderMocks.activeChat,
}))

vi.mock('./promptTemplateHydration', () => ({
  currentPromptTemplateOwnerId: loaderMocks.promptOwner,
  ensurePromptTemplateHydrated: loaderMocks.prompt,
}))

import { clearAppliedServerResourceRevision, setAppliedServerResourceRevision } from './commands'
import {
  currentRouteResourceLoadState,
  ensureResourceSurfaces,
  finishRouteResources,
  prefetchCharacterRouteResource,
  prepareRouteResources,
  routeResourceLoadState,
  stopRouteResourceLoader,
} from './routeResourceLoader'
import {
  applyCharactersResource,
  applySettingsGroupResource,
  getResourceDatabase,
  resetServerResourceState,
  settingsResourceState,
} from './resourceState.svelte'
import { withTrustedResourceWrite } from './resourceWriteGuard.svelte'

function requirement<T extends ResourceRequirement>(value: T): T {
  return value
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

beforeEach(() => {
  stopRouteResourceLoader()
  withTrustedResourceWrite(resetServerResourceState)
  clearAppliedServerResourceRevision()
  setAppliedServerResourceRevision(4)
  loaderMocks.requirements = []
  loaderMocks.refresh.mockReset().mockResolvedValue({ status: 'ok', revision: 5, scope: 'targeted' })
  loaderMocks.standalone.mockReset().mockResolvedValue({
    status: 'ok',
    revision: 5,
    setting: 'selectedPersona',
    state: { present: true, value: 0 },
  })
  loaderMocks.activeChat.mockReset().mockResolvedValue(true)
  loaderMocks.prompt.mockReset().mockResolvedValue(true)
  loaderMocks.promptOwner.mockReset().mockReturnValue(null)
})

afterEach(() => {
  stopRouteResourceLoader()
  clearAppliedServerResourceRevision()
  Reflect.deleteProperty(window, 'requestIdleCallback')
  Reflect.deleteProperty(window, 'cancelIdleCallback')
})

describe('route resource loader', () => {
  it('loads granular declarations with the request-start revision', async () => {
    loaderMocks.requirements = [
      requirement({ kind: 'settings-group', group: 'display', purposes: ['render'] }),
      requirement({ kind: 'collection', collection: 'personas', purposes: ['render'] }),
      requirement({ kind: 'standalone-setting', setting: 'selectedPersona', purposes: ['render'] }),
      requirement({ kind: 'projection', projection: 'selected-character', purposes: ['render'] }),
    ]
    const route = { kind: 'character', path: '/character/char-a', chaId: 'char-a' } as const

    await expect(prepareRouteResources(route)).resolves.toBe(true)
    await expect(finishRouteResources(route)).resolves.toBe(true)

    expect(loaderMocks.refresh).toHaveBeenCalledTimes(3)
    expect(loaderMocks.refresh.mock.calls.map(([target]) => target)).toEqual(
      expect.arrayContaining([
        { settingsGroups: ['display'], minimumRevision: 4 },
        { collections: ['personas'], minimumRevision: 4 },
        { characterIds: ['char-a'], minimumRevision: 4 },
      ]),
    )
    expect(getResourceDatabase().selectedPersona).toBe(0)
    expect(get(routeResourceLoadState)).toEqual({
      error: null,
      routeKey: 'character:char-a:',
      status: 'ready',
    })
  })

  it('aborts an older route and drops its terminal state', async () => {
    loaderMocks.requirements = [requirement({ kind: 'settings-group', group: 'display', purposes: ['render'] })]
    const secondRead = deferred<{ status: 'ok'; revision: number; scope: 'targeted' }>()
    loaderMocks.refresh
      .mockImplementationOnce(async (_target, options: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => options.signal.addEventListener('abort', () => resolve(), { once: true }))
        return { status: 'error', error: 'aborted' }
      })
      .mockImplementationOnce(() => secondRead.promise)

    const first = prepareRouteResources({ kind: 'home', path: '/' })
    const secondRoute = { kind: 'grid', path: '/grid' } as const
    const second = prepareRouteResources(secondRoute)
    secondRead.resolve({ status: 'ok', revision: 5, scope: 'targeted' })

    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(true)
    await expect(finishRouteResources(secondRoute)).resolves.toBe(true)
    expect(currentRouteResourceLoadState()).toMatchObject({ routeKey: 'grid', status: 'ready' })
  })

  it('keeps a resource failure local and permits a clean retry', async () => {
    loaderMocks.requirements = [requirement({ kind: 'settings-group', group: 'display', purposes: ['render'] })]
    loaderMocks.refresh
      .mockResolvedValueOnce({ status: 'error', error: 'display unavailable' })
      .mockResolvedValueOnce({ status: 'ok', revision: 6, scope: 'targeted' })
    const route = { kind: 'settings', path: '/settings/display', section: 'display', index: 3 } as const

    await expect(prepareRouteResources(route)).resolves.toBe(false)
    expect(currentRouteResourceLoadState()).toMatchObject({ status: 'error', error: 'display unavailable' })
    expect(settingsResourceState.groupErrors.display).toBe('display unavailable')

    await expect(prepareRouteResources(route)).resolves.toBe(true)
    await expect(finishRouteResources(route)).resolves.toBe(true)
    expect(currentRouteResourceLoadState()).toMatchObject({ status: 'ready', error: null })
    expect(settingsResourceState.groupErrors.display).toBeUndefined()
  })

  it('deduplicates concurrent deferred consumers per surface', async () => {
    loaderMocks.requirements = [requirement({ kind: 'settings-group', group: 'providers', purposes: ['interact'] })]
    const read = deferred<{ status: 'ok'; revision: number; scope: 'targeted' }>()
    loaderMocks.refresh.mockReturnValue(read.promise)

    const first = ensureResourceSurfaces(['runtime:plugins'])
    const second = ensureResourceSurfaces(['runtime:plugins'])
    expect(first).toBe(second)
    expect(loaderMocks.refresh).toHaveBeenCalledOnce()

    read.resolve({ status: 'ok', revision: 5, scope: 'targeted' })
    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBeUndefined()
  })

  it('lets a deferred consumer join a route-owned request for the same resource', async () => {
    loaderMocks.requirements = [requirement({ kind: 'settings-group', group: 'display', purposes: ['render'] })]
    const read = deferred<{ status: 'ok'; revision: number; scope: 'targeted' }>()
    loaderMocks.refresh.mockReturnValue(read.promise)
    const route = { kind: 'home', path: '/' } as const

    const routeLoad = prepareRouteResources(route)
    const deferredLoad = ensureResourceSurfaces(['runtime:background-effects'])
    expect(loaderMocks.refresh).toHaveBeenCalledOnce()

    read.resolve({ status: 'ok', revision: 5, scope: 'targeted' })
    await expect(routeLoad).resolves.toBe(true)
    await expect(deferredLoad).resolves.toBeUndefined()
    await expect(finishRouteResources(route)).resolves.toBe(true)
  })

  it('hydrates a chat-owned prompt template without replacing the global compatibility owner', async () => {
    loaderMocks.requirements = []
    loaderMocks.promptOwner.mockReturnValue('prompt-a')
    withTrustedResourceWrite(() =>
      applyCharactersResource({
        version: 1,
        revision: 4,
        characters: [
          {
            chaId: 'char-a',
            type: 'character',
            name: 'Ada',
            chats: [
              {
                id: 'chat-b',
                name: 'Chat B',
                message: [],
                generationSettings: { promptPresetId: 'prompt-b' },
              },
            ],
            chatPage: 0,
            chatFolders: [],
          } as never,
        ],
        characterOrder: ['char-a'],
        currentChar: 0,
      }),
    )
    const route = { kind: 'character', path: '/character/char-a/chat-b', chaId: 'char-a', chatId: 'chat-b' } as const

    await expect(prepareRouteResources(route)).resolves.toBe(true)
    await expect(finishRouteResources(route)).resolves.toBe(true)
    expect(loaderMocks.prompt).toHaveBeenCalledWith({
      applyProjection: false,
      minimumRevision: 4,
      promptPresetId: 'prompt-b',
    })
  })

  it('prefetches only one hovered shell row during idle time', async () => {
    loaderMocks.requirements = []
    const route = { kind: 'grid', path: '/grid' } as const
    await prepareRouteResources(route)
    await finishRouteResources(route)
    withTrustedResourceWrite(() =>
      applyCharactersResource({
        version: 1,
        revision: 4,
        characters: [
          {
            __serverCharacterShell: true,
            chaId: 'char-a',
            type: 'character',
            name: 'Ada',
            chats: [],
            chatPage: 0,
            chatFolders: [],
          } as never,
        ],
        characterOrder: ['char-a'],
        currentChar: 0,
      }),
    )
    let idleCallback: (() => void) | null = null
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: vi.fn((callback: () => void) => {
        idleCallback = callback
        return 1
      }),
    })
    Object.defineProperty(window, 'cancelIdleCallback', { configurable: true, value: vi.fn() })

    prefetchCharacterRouteResource('char-a')
    prefetchCharacterRouteResource('char-a')
    expect(loaderMocks.refresh).not.toHaveBeenCalled()
    expect(window.requestIdleCallback).toHaveBeenCalledOnce()

    idleCallback?.()
    await vi.waitFor(() => expect(loaderMocks.refresh).toHaveBeenCalledOnce())
    expect(loaderMocks.refresh).toHaveBeenCalledWith(
      { characterIds: ['char-a'], minimumRevision: 4 },
      { signal: expect.any(AbortSignal) },
    )
  })

  it('rejects a standalone response superseded after request start', async () => {
    loaderMocks.requirements = [
      requirement({ kind: 'standalone-setting', setting: 'selectedPersona', purposes: ['render'] }),
    ]
    const read = deferred<{
      status: 'ok'
      revision: number
      setting: 'selectedPersona'
      state: { present: true; value: number }
    }>()
    loaderMocks.standalone.mockReturnValue(read.promise)
    const route = { kind: 'character', path: '/character/char-a', chaId: 'char-a' } as const
    const loading = prepareRouteResources(route)

    withTrustedResourceWrite(() =>
      applySettingsGroupResource({ revision: 7, group: 'display', settings: { theme: 'newer' } }, ['theme']),
    )
    read.resolve({
      status: 'ok',
      revision: 6,
      setting: 'selectedPersona',
      state: { present: true, value: 2 },
    })

    await expect(loading).resolves.toBe(false)
    expect(currentRouteResourceLoadState()).toMatchObject({
      status: 'error',
      error: 'Standalone setting selectedPersona was superseded before apply',
    })
    expect(getResourceDatabase().selectedPersona).toBeUndefined()
  })

  it('reports selected-chat failure locally and retries the post-route detail', async () => {
    loaderMocks.requirements = [
      requirement({ kind: 'projection', projection: 'selected-chat', purposes: ['render'] }),
      requirement({ kind: 'projection', projection: 'selected-prompt-template', purposes: ['generate'] }),
    ]
    const route = {
      kind: 'character',
      path: '/character/char-a/chat-a',
      chaId: 'char-a',
      chatId: 'chat-a',
    } as const
    loaderMocks.activeChat.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    await expect(prepareRouteResources(route)).resolves.toBe(true)
    await expect(finishRouteResources(route)).resolves.toBe(false)
    expect(currentRouteResourceLoadState()).toMatchObject({ status: 'error', error: 'Selected chat hydration failed' })

    await expect(prepareRouteResources(route)).resolves.toBe(true)
    await expect(finishRouteResources(route)).resolves.toBe(true)
    expect(loaderMocks.prompt).toHaveBeenCalledOnce()
    expect(currentRouteResourceLoadState()).toMatchObject({ status: 'ready' })
  })
})
