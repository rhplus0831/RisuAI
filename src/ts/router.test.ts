import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const routerMocks = vi.hoisted(() => ({
  changeChar: vi.fn<(...args: any[]) => Promise<void> | void>(),
  changeChatTo: vi.fn(),
  findCharacterIndexbyId: vi.fn<(characterId: string) => number>(() => -1),
  openPlaygroundChat: vi.fn(),
}))

vi.mock('./characters', () => ({
  changeChar: routerMocks.changeChar,
}))

vi.mock('./globalApi.svelte', () => ({
  changeChatTo: routerMocks.changeChatTo,
}))

vi.mock('./playground', () => ({
  PLAYGROUND_CHARACTER_ID: 'playground',
  openPlaygroundChat: routerMocks.openPlaygroundChat,
}))

vi.mock('./process/index.svelte', async () => {
  const { writable } = await import('svelte/store')
  return {
    activeGenerationTarget: writable(null),
    doingChat: writable(false),
  }
})

vi.mock('./util', () => ({
  findCharacterIndexbyId: routerMocks.findCharacterIndexbyId,
}))

vi.mock('./stores.svelte', async () => {
  const { writable } = await import('svelte/store')
  return {
    CharEmotion: writable({}),
    CustomGUISettingMenuStore: writable(false),
    OpenRealmStore: writable(false),
    PlaygroundStore: writable(0),
    SettingsMenuIndex: writable(1),
    botMakerMode: writable(false),
    selectedCharID: writable(-1),
    settingsOpen: writable(false),
  }
})

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function importRouterAt(path: string) {
  vi.resetModules()
  window.history.replaceState(null, '', path)
  return await import('./router')
}

beforeEach(() => {
  routerMocks.changeChar.mockReset()
  routerMocks.changeChatTo.mockReset()
  routerMocks.findCharacterIndexbyId.mockReset()
  routerMocks.findCharacterIndexbyId.mockReturnValue(-1)
  routerMocks.openPlaygroundChat.mockReset()
})

afterEach(async () => {
  const { activeGenerationTarget, doingChat } = await import('./process/index.svelte')
  activeGenerationTarget.set(null)
  doingChat.set(false)
})

describe('router initial application', () => {
  it('does not treat initial root load as a pending home navigation', async () => {
    const router = await importRouterAt('/')

    expect(get(router.currentRoute)).toMatchObject({ kind: 'home', path: '/' })
    expect(router.hasPendingRouteApplication()).toBe(false)
  })

  it('still applies a deep link route on initial load', async () => {
    const router = await importRouterAt('/character/char-a/chat-a')

    expect(get(router.currentRoute)).toMatchObject({
      kind: 'character',
      chaId: 'char-a',
      chatId: 'chat-a',
    })
    expect(router.hasPendingRouteApplication()).toBe(true)
  })

  it('keeps the bare settings route as the settings menu state', async () => {
    const router = await importRouterAt('/settings')
    const stores = await import('./stores.svelte')
    const { SettingsMenuIndex, settingsOpen } = stores

    expect(get(router.currentRoute)).toMatchObject({
      kind: 'settings',
      path: '/settings',
      section: '',
      index: -1,
    })

    await router.applyRouteToStores(get(router.currentRoute))
    await flushMicrotasks()

    expect(get(settingsOpen)).toBe(true)
    expect(get(SettingsMenuIndex)).toBe(-1)
  })

  it('serializes the open settings menu as the bare settings route', async () => {
    const router = await importRouterAt('/')

    router.syncRouteFromState({
      currentRouteKind: 'home',
      settingsOpen: true,
      settingsMenuIndex: -1,
      selectedCharID: -1,
      playgroundStore: 0,
    })

    expect(window.location.pathname).toBe('/settings')
    expect(get(router.currentRoute)).toMatchObject({
      kind: 'settings',
      path: '/settings',
      section: '',
      index: -1,
    })
  })

  it('routes the agent preset settings section', async () => {
    const router = await importRouterAt('/settings/agent-presets')
    const stores = await import('./stores.svelte')
    const { SettingsMenuIndex, settingsOpen } = stores

    expect(get(router.currentRoute)).toMatchObject({
      kind: 'settings',
      path: '/settings/agent-presets',
      section: 'agent-presets',
      index: 19,
    })

    await router.applyRouteToStores(get(router.currentRoute))
    await flushMicrotasks()

    expect(get(settingsOpen)).toBe(true)
    expect(get(SettingsMenuIndex)).toBe(19)
  })

  it('does not route the removed context agent settings slug', async () => {
    const router = await importRouterAt('/settings/context-agent')

    expect(get(router.currentRoute)).toMatchObject({
      kind: 'not-found',
      path: '/settings/context-agent',
    })
  })

  it('serializes the agent preset settings section', async () => {
    const router = await importRouterAt('/')

    router.syncRouteFromState({
      currentRouteKind: 'home',
      settingsOpen: true,
      settingsMenuIndex: 19,
      selectedCharID: -1,
      playgroundStore: 0,
    })

    expect(window.location.pathname).toBe('/settings/agent-presets')
    expect(get(router.currentRoute)).toMatchObject({
      kind: 'settings',
      path: '/settings/agent-presets',
      section: 'agent-presets',
      index: 19,
    })
  })
})

describe('router character route freshness', () => {
  it('routes character-only navigation to the active generation owner chat', async () => {
    const router = await importRouterAt('/')
    const { activeGenerationTarget, doingChat } = await import('./process/index.svelte')
    activeGenerationTarget.set({
      selectedCharID: 0,
      chatPage: 1,
      characterId: 'char-a',
      chatId: 'chat-owner',
    })
    doingChat.set(true)

    router.navigate('/character/char-a')

    expect(window.location.pathname).toBe('/character/char-a/chat-owner')
    expect(get(router.currentRoute)).toMatchObject({
      kind: 'character',
      chaId: 'char-a',
      chatId: 'chat-owner',
    })

    router.navigate('/character/char-b')
    expect(window.location.pathname).toBe('/character/char-a/chat-owner')
  })

  it('reopens exactly the active generation owner after leaving the chat', async () => {
    const router = await importRouterAt('/settings/model')
    const stores = await import('./stores.svelte')
    const { activeGenerationTarget, doingChat } = await import('./process/index.svelte')
    const { getResourceDatabase, replaceResourceDatabase } = await import('./server/resourceState.svelte')
    const { selectedCharID } = stores
    replaceResourceDatabase({
      characters: [
        {
          chaId: 'char-a',
          chatPage: 0,
          chats: [
            { id: 'chat-a', name: 'Chat A', message: [] },
            { id: 'chat-owner', name: 'Generating chat', message: [] },
          ],
        },
        {
          chaId: 'char-b',
          chatPage: 0,
          chats: [{ id: 'chat-b', name: 'Chat B', message: [] }],
        },
      ],
    } as any)
    selectedCharID.set(-1)
    routerMocks.findCharacterIndexbyId.mockImplementation(
      (characterId: string) =>
        getResourceDatabase().characters?.findIndex((character: any) => character?.chaId === characterId) ?? -1,
    )
    routerMocks.changeChar.mockImplementation(async (index: number) => {
      selectedCharID.set(index)
    })
    activeGenerationTarget.set({
      selectedCharID: 0,
      chatPage: 1,
      characterId: 'char-a',
      chatId: 'chat-owner',
    })
    doingChat.set(true)

    router.navigate('/character/char-a/chat-a')
    router.navigate('/character/char-b/chat-b')
    expect(window.location.pathname).toBe('/settings/model')

    router.navigate('/character/char-a/chat-owner')
    expect(window.location.pathname).toBe('/character/char-a/chat-owner')
    await router.applyRouteToStores(get(router.currentRoute))
    await flushMicrotasks()

    expect(routerMocks.changeChar).toHaveBeenCalledWith(0, {
      isFresh: expect.any(Function),
      allowDuringGeneration: expect.any(Function),
    })
    expect(routerMocks.changeChatTo).toHaveBeenCalledWith('chat-owner')
    expect(get(selectedCharID)).toBe(0)
  })

  it('canonicalizes history navigation to another chat back to the active generation owner', async () => {
    const router = await importRouterAt('/character/char-a/chat-other')
    const stores = await import('./stores.svelte')
    const { activeGenerationTarget, doingChat } = await import('./process/index.svelte')
    const { replaceResourceDatabase } = await import('./server/resourceState.svelte')
    replaceResourceDatabase({
      characters: [
        {
          chaId: 'char-a',
          chatPage: 0,
          chats: [
            { id: 'chat-owner', name: 'Generating chat', message: [] },
            { id: 'chat-other', name: 'Other chat', message: [] },
          ],
        },
      ],
    } as any)
    stores.selectedCharID.set(-1)
    routerMocks.findCharacterIndexbyId.mockReturnValue(0)
    routerMocks.changeChar.mockImplementation(async (index: number) => {
      stores.selectedCharID.set(index)
    })
    activeGenerationTarget.set({
      selectedCharID: 0,
      chatPage: 0,
      characterId: 'char-a',
      chatId: 'chat-owner',
    })
    doingChat.set(true)

    await router.applyRouteToStores(get(router.currentRoute))
    await flushMicrotasks()

    expect(window.location.pathname).toBe('/character/char-a/chat-owner')
    expect(get(router.currentRoute)).toMatchObject({
      kind: 'character',
      chaId: 'char-a',
      chatId: 'chat-owner',
    })
    expect(routerMocks.changeChar).toHaveBeenCalledWith(0, {
      isFresh: expect.any(Function),
      allowDuringGeneration: expect.any(Function),
    })
    expect(routerMocks.changeChatTo).not.toHaveBeenCalled()
    expect(get(stores.selectedCharID)).toBe(0)
  })

  it('keeps the selected character route when in-app navigation is attempted during generation', async () => {
    const router = await importRouterAt('/')
    const stores = await import('./stores.svelte')
    const { activeGenerationTarget, doingChat } = await import('./process/index.svelte')
    const { replaceResourceDatabase } = await import('./server/resourceState.svelte')
    const { selectedCharID } = stores
    replaceResourceDatabase({
      characters: [
        {
          chaId: 'char-a',
          chatPage: 0,
          chats: [{ id: 'chat-a', name: 'Chat A', message: [] }],
        },
        {
          chaId: 'char-b',
          chatPage: 0,
          chats: [{ id: 'chat-b', name: 'Chat B', message: [] }],
        },
      ],
    } as any)
    selectedCharID.set(0)
    router.syncRouteFromState({
      currentRouteKind: 'home',
      settingsOpen: false,
      settingsMenuIndex: 1,
      selectedCharID: 0,
      playgroundStore: 0,
      characterId: 'char-a',
      chatId: 'chat-a',
    })
    activeGenerationTarget.set({
      selectedCharID: 0,
      chatPage: 0,
      characterId: 'char-a',
      chatId: 'chat-a',
    })
    doingChat.set(true)

    router.navigate('/character/char-b/chat-b')

    expect(window.location.pathname).toBe('/character/char-a/chat-a')
    expect(get(router.currentRoute)).toMatchObject({
      kind: 'character',
      chaId: 'char-a',
      chatId: 'chat-a',
    })
    expect(get(selectedCharID)).toBe(0)
    expect(routerMocks.changeChar).not.toHaveBeenCalled()
  })

  it('canonicalizes a deep or history route when character selection is refused', async () => {
    const router = await importRouterAt('/character/char-b/chat-b')
    const stores = await import('./stores.svelte')
    const { getResourceDatabase, replaceResourceDatabase } = await import('./server/resourceState.svelte')
    const { selectedCharID } = stores
    replaceResourceDatabase({
      characters: [
        {
          chaId: 'char-a',
          chatPage: 0,
          chats: [{ id: 'chat-a', name: 'Chat A', message: [] }],
        },
        {
          chaId: 'char-b',
          chatPage: 0,
          chats: [{ id: 'chat-b', name: 'Chat B', message: [] }],
        },
      ],
    } as any)
    selectedCharID.set(0)
    routerMocks.findCharacterIndexbyId.mockImplementation(
      (characterId: string) =>
        getResourceDatabase().characters?.findIndex((character: any) => character?.chaId === characterId) ?? -1,
    )
    routerMocks.changeChar.mockResolvedValue(undefined)

    await router.applyRouteToStores(get(router.currentRoute))
    await flushMicrotasks()

    expect(routerMocks.changeChar).toHaveBeenCalledWith(1, { isFresh: expect.any(Function) })
    expect(get(selectedCharID)).toBe(0)
    expect(window.location.pathname).toBe('/character/char-a/chat-a')
    expect(get(router.currentRoute)).toMatchObject({
      kind: 'character',
      chaId: 'char-a',
      chatId: 'chat-a',
    })
    expect(router.isApplyingRouteToStores()).toBe(false)
    expect(router.hasPendingRouteApplication()).toBe(false)
  })

  it('does not let a stale character route clear a newer pending character route', async () => {
    const router = await importRouterAt('/character/char-a/chat-a')
    const stores = await import('./stores.svelte')
    const { getResourceDatabase, replaceResourceDatabase } = await import('./server/resourceState.svelte')
    const { selectedCharID } = stores
    replaceResourceDatabase({
      characters: [
        {
          chaId: 'char-a',
          chatPage: 0,
          chats: [
            { id: 'chat-old-a', name: 'Old A', message: [] },
            { id: 'chat-a', name: 'Chat A', message: [] },
          ],
        },
        {
          chaId: 'char-b',
          chatPage: 0,
          chats: [
            { id: 'chat-old-b', name: 'Old B', message: [] },
            { id: 'chat-b', name: 'Chat B', message: [] },
          ],
        },
      ],
    } as any)
    selectedCharID.set(-1)
    routerMocks.findCharacterIndexbyId.mockImplementation(
      (characterId: string) =>
        getResourceDatabase().characters?.findIndex((character: any) => character?.chaId === characterId) ?? -1,
    )
    const staleSelection = deferred()
    const latestSelection = deferred()
    routerMocks.changeChar
      .mockImplementationOnce(async () => {
        await staleSelection.promise
      })
      .mockImplementationOnce(async () => {
        await latestSelection.promise
      })

    const staleRoute = router.applyRouteToStores({
      kind: 'character',
      path: '/character/char-a/chat-a',
      chaId: 'char-a',
      chatId: 'chat-a',
    })
    await vi.waitFor(() => {
      expect(routerMocks.changeChar).toHaveBeenCalledTimes(1)
    })

    router.navigate('/character/char-b/chat-b')
    const latestRoute = router.applyRouteToStores({
      kind: 'character',
      path: '/character/char-b/chat-b',
      chaId: 'char-b',
      chatId: 'chat-b',
    })
    await vi.waitFor(() => {
      expect(routerMocks.changeChar).toHaveBeenCalledTimes(2)
    })

    staleSelection.resolve()
    await staleRoute
    await flushMicrotasks()

    expect(routerMocks.changeChatTo).not.toHaveBeenCalled()
    expect(router.isApplyingRouteToStores()).toBe(true)
    expect(router.hasPendingRouteApplication()).toBe(true)

    selectedCharID.set(1)
    latestSelection.resolve()
    await latestRoute
    await flushMicrotasks()

    expect(routerMocks.changeChatTo).toHaveBeenCalledTimes(1)
    expect(routerMocks.changeChatTo).toHaveBeenCalledWith('chat-b')
    expect(router.isApplyingRouteToStores()).toBe(false)
    expect(router.hasPendingRouteApplication()).toBe(false)
  })

  it('does not let a stale delayed character route select a chat after a newer settings route wins', async () => {
    const router = await importRouterAt('/character/char-a/chat-target')
    const stores = await import('./stores.svelte')
    const { getResourceDatabase, replaceResourceDatabase } = await import('./server/resourceState.svelte')
    const { PlaygroundStore, SettingsMenuIndex, selectedCharID, settingsOpen } = stores
    replaceResourceDatabase({
      characters: [
        {
          chaId: 'char-a',
          chatPage: 0,
          chats: [
            { id: 'chat-old', name: 'Old chat', message: [] },
            { id: 'chat-target', name: 'Target chat', message: [] },
          ],
        },
      ],
    } as any)
    selectedCharID.set(-1)
    routerMocks.findCharacterIndexbyId.mockImplementation(
      (characterId: string) =>
        getResourceDatabase().characters?.findIndex((character: any) => character?.chaId === characterId) ?? -1,
    )
    const pendingSelection = deferred()
    routerMocks.changeChar.mockImplementation(async () => {
      await pendingSelection.promise
    })

    const staleRoute = router.applyRouteToStores({
      kind: 'character',
      path: '/character/char-a/chat-target',
      chaId: 'char-a',
      chatId: 'chat-target',
    })
    await vi.waitFor(() => {
      expect(routerMocks.changeChar).toHaveBeenCalledWith(0, { isFresh: expect.any(Function) })
    })

    const latestRoute = router.applyRouteToStores({
      kind: 'settings',
      path: '/settings/model',
      section: 'model',
      index: 17,
    })
    await latestRoute
    await flushMicrotasks()

    expect(get(settingsOpen)).toBe(true)
    expect(get(SettingsMenuIndex)).toBe(17)
    expect(get(PlaygroundStore)).toBe(0)
    expect(get(selectedCharID)).toBe(-1)
    expect(router.isApplyingRouteToStores()).toBe(false)
    expect(router.hasPendingRouteApplication()).toBe(false)

    pendingSelection.resolve()
    await staleRoute
    await flushMicrotasks()

    expect(routerMocks.changeChatTo).not.toHaveBeenCalled()
    expect(get(settingsOpen)).toBe(true)
    expect(get(selectedCharID)).toBe(-1)
    expect(router.isApplyingRouteToStores()).toBe(false)
    expect(router.hasPendingRouteApplication()).toBe(false)
  })

  it('re-resolves the live character index after character selection before selecting the routed chat', async () => {
    const router = await importRouterAt('/')
    const stores = await import('./stores.svelte')
    const { getResourceDatabase, replaceResourceDatabase, withResourceDatabaseWrite } =
      await import('./server/resourceState.svelte')
    const { selectedCharID } = stores
    const charA = {
      chaId: 'char-a',
      chatPage: 0,
      chats: [
        { id: 'chat-old', name: 'Old chat', message: [] },
        { id: 'chat-target', name: 'Target chat', message: [] },
      ],
    }
    const charB = {
      chaId: 'char-b',
      chatPage: 0,
      chats: [{ id: 'chat-b', name: 'B chat', message: [] }],
    }
    replaceResourceDatabase({
      characters: [charA, charB],
    } as any)
    selectedCharID.set(-1)
    routerMocks.findCharacterIndexbyId.mockImplementation(
      (characterId: string) =>
        getResourceDatabase().characters?.findIndex((character: any) => character?.chaId === characterId) ?? -1,
    )
    routerMocks.changeChar.mockImplementation(async (_index: number) => {
      withResourceDatabaseWrite((database) => {
        database.characters = [charB, charA] as any
      })
      selectedCharID.set(1)
    })

    await router.applyRouteToStores({
      kind: 'character',
      path: '/character/char-a/chat-target',
      chaId: 'char-a',
      chatId: 'chat-target',
    })

    expect(routerMocks.changeChar).toHaveBeenCalledWith(0, { isFresh: expect.any(Function) })
    expect(routerMocks.changeChatTo).toHaveBeenCalledWith('chat-target')
  })
})

describe('router playground route freshness', () => {
  it('passes route ownership into an asynchronous playground open', async () => {
    const router = await importRouterAt('/playground/chat')
    const stores = await import('./stores.svelte')
    const { PlaygroundStore, selectedCharID } = stores
    const pendingOpen = deferred()
    let routeIsFresh: (() => boolean) | undefined
    routerMocks.openPlaygroundChat.mockImplementationOnce(async (options: { isFresh?: () => boolean } = {}) => {
      routeIsFresh = options.isFresh
      await pendingOpen.promise
      if (routeIsFresh?.()) {
        selectedCharID.set(3)
      }
    })

    const staleRoute = router.applyRouteToStores({
      kind: 'playground',
      path: '/playground/chat',
      tool: 'chat',
      index: 2,
    })
    await vi.waitFor(() => expect(routerMocks.openPlaygroundChat).toHaveBeenCalledTimes(1))

    await router.applyRouteToStores({ kind: 'home', path: '/' })
    await flushMicrotasks()
    expect(routeIsFresh?.()).toBe(false)

    pendingOpen.resolve()
    await staleRoute
    await flushMicrotasks()

    expect(get(PlaygroundStore)).toBe(0)
    expect(get(selectedCharID)).toBe(-1)
  })
})
