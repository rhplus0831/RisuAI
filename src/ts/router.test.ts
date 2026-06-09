import { describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

vi.mock('./characters', () => ({
  changeChar: vi.fn(),
}))

vi.mock('./globalApi.svelte', () => ({
  changeChatTo: vi.fn(),
}))

vi.mock('./playground', () => ({
  PLAYGROUND_CHARACTER_ID: 'playground',
  openPlaygroundChat: vi.fn(),
}))

vi.mock('./util', () => ({
  findCharacterIndexbyId: vi.fn(() => -1),
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

async function importRouterAt(path: string) {
  vi.resetModules()
  window.history.replaceState(null, '', path)
  return await import('./router')
}

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
})
