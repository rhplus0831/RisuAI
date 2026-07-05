import { beforeEach, describe, expect, it, vi } from 'vitest'
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

vi.mock('./util', () => ({
  findCharacterIndexbyId: routerMocks.findCharacterIndexbyId,
}))

vi.mock('./stores.svelte', async () => {
  const { writable } = await import('svelte/store')
  return {
    CharEmotion: writable({}),
    CustomGUISettingMenuStore: writable(false),
    DBState: { db: { characters: [] } },
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
  it('does not let a stale character route clear a newer pending character route', async () => {
    const router = await importRouterAt('/character/char-a/chat-a')
    const stores = await import('./stores.svelte')
    const { DBState, selectedCharID } = stores
    DBState.db = {
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
    } as any
    selectedCharID.set(-1)
    routerMocks.findCharacterIndexbyId.mockImplementation(
      (characterId: string) =>
        DBState.db.characters?.findIndex((character: any) => character?.chaId === characterId) ?? -1,
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
    const { DBState, PlaygroundStore, SettingsMenuIndex, selectedCharID, settingsOpen } = stores
    DBState.db = {
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
    } as any
    selectedCharID.set(-1)
    routerMocks.findCharacterIndexbyId.mockImplementation(
      (characterId: string) =>
        DBState.db.characters?.findIndex((character: any) => character?.chaId === characterId) ?? -1,
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
    const { DBState, selectedCharID } = stores
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
    DBState.db = {
      characters: [charA, charB],
    } as any
    selectedCharID.set(-1)
    routerMocks.findCharacterIndexbyId.mockImplementation(
      (characterId: string) =>
        DBState.db.characters?.findIndex((character: any) => character?.chaId === characterId) ?? -1,
    )
    routerMocks.changeChar.mockImplementation(async (_index: number) => {
      DBState.db.characters = [charB, charA] as any
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
