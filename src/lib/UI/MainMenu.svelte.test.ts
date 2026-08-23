import { get, type Writable } from 'svelte/store'
import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mainMenuMocks = vi.hoisted(() => ({
  database: {
    language: 'en',
    doNotWarnExternalServers: true,
    roundIcons: false,
    characterOrder: ['character-a', 'character-b', 'character-trash', '§playground'],
    characters: [] as Array<Record<string, unknown>>,
  },
  navigate: vi.fn(),
  openGridRoute: vi.fn(),
  markChatRead: vi.fn(),
}))

vi.mock('src/ts/server/resourceState.svelte', () => ({
  getResourceDatabase: () => mainMenuMocks.database,
}))

vi.mock('src/ts/stores.svelte', async () => {
  const { writable } = await import('svelte/store')
  return { OpenRealmStore: writable(false) }
})

vi.mock('src/ts/characterImage', () => ({
  getCharImage: vi.fn(async (source: string) => (source ? `/assets/${source}` : '/none.webp')),
}))

vi.mock('src/ts/router', () => ({
  characterRoutePath: (characterId: string, chatId?: string) =>
    chatId ? `/character/${characterId}/${chatId}` : `/character/${characterId}`,
  navigate: mainMenuMocks.navigate,
  openGridRoute: mainMenuMocks.openGridRoute,
}))

vi.mock('src/ts/process/generationActivity.svelte', async () => {
  const { writable } = await import('svelte/store')
  return {
    activeChatGenerations: writable([{ chatId: 'pinned-3', kind: 'message' }]),
  }
})

vi.mock('src/ts/process/reattach', async () => {
  const { writable } = await import('svelte/store')
  return {
    activeGenerationJobs: writable([{ chatId: 'pinned-2' }]),
    generationJobLifecycles: writable({ warning: { chatId: 'pinned-2', status: 'exhausted-dead' } }),
  }
})

vi.mock('src/ts/process/chatUnread.svelte', async () => {
  const { writable } = await import('svelte/store')
  return {
    unreadChatIds: writable(new Set(['pinned-4'])),
    markChatRead: mainMenuMocks.markChatRead,
  }
})

vi.mock('src/ts/globalApi.svelte', () => ({
  getVersionString: () => 'test-version',
}))

vi.mock('src/ts/alert', () => ({
  alertConfirm: vi.fn(async () => true),
}))

vi.mock('./Realm/RealmMain.svelte', () => ({ default: () => {} }))
vi.mock('./Title.svelte', () => ({ default: () => {} }))

import MainMenu from './MainMenu.svelte'
import { changeLanguage, language } from 'src/lang'
import { OpenRealmStore } from 'src/ts/stores.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

function chat(id: string, name: string, pinned = false) {
  return { id, name, pinned }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  changeLanguage('en')
  mainMenuMocks.navigate.mockReset()
  mainMenuMocks.openGridRoute.mockReset()
  mainMenuMocks.markChatRead.mockReset()
  ;(OpenRealmStore as Writable<boolean>).set(false)
  mainMenuMocks.database.characters = [
    {
      chaId: 'character-a',
      name: 'Character A',
      image: 'a.webp',
      lastInteraction: Date.now() - 60_000,
      chatPage: 0,
      chats: Array.from({ length: 7 }, (_, index) => chat(`pinned-${index + 1}`, `Pinned ${index + 1}`, true)),
    },
    {
      chaId: 'character-b',
      name: 'Character B',
      image: 'b.webp',
      lastInteraction: Date.now() - 30_000,
      chatPage: 1,
      chats: [chat('b-first', 'First'), chat('b-active', 'Active')],
    },
    {
      chaId: 'character-trash',
      name: 'Trashed',
      lastInteraction: Date.now(),
      trashTime: 1,
      chatPage: 0,
      chats: [],
    },
    {
      chaId: '§playground',
      name: 'Playground',
      lastInteraction: Date.now(),
      chatPage: 0,
      chats: [],
    },
  ]
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  vi.clearAllTimers()
  vi.useRealTimers()
  target.remove()
})

describe('MainMenu home dashboard', () => {
  it('renders resumable pinned chats and recent characters in priority order', async () => {
    component = mount(MainMenu, { target })
    await tick()

    const sections = Array.from(target.querySelectorAll<HTMLElement>('[data-risu-home-section]')).map(
      (section) => section.dataset.risuHomeSection,
    )
    expect(sections).toEqual(['pinned-chats', 'recent-characters', 'explore'])
    expect(target.querySelectorAll('[data-risu-home-pinned-chat]')).toHaveLength(6)
    expect(target.querySelectorAll('[data-risu-home-recent-character]')).toHaveLength(2)
    expect(target.querySelector('[data-risu-home-recent-character="character-trash"]')).toBeNull()
    expect(target.querySelector('[data-risu-home-recent-character="§playground"]')).toBeNull()

    expect(
      target.querySelector('[data-risu-home-pinned-chat="pinned-2"] [data-risu-generation-indicator="warning"]'),
    ).toBeTruthy()
    expect(target.querySelector('[data-risu-home-pinned-chat="pinned-3"] .animate-spin')).toBeTruthy()
    expect(target.querySelector('[data-risu-home-pinned-chat="pinned-4"] [data-risu-unread-indicator]')).toBeTruthy()

    target.querySelector<HTMLButtonElement>('[data-risu-home-pinned-chat="pinned-1"]')!.click()
    expect(mainMenuMocks.markChatRead).toHaveBeenCalledWith('pinned-1')
    expect(mainMenuMocks.navigate).toHaveBeenCalledWith('/character/character-a/pinned-1')

    target.querySelector<HTMLButtonElement>('[data-risu-home-recent-character="character-b"]')!.click()
    expect(mainMenuMocks.navigate).toHaveBeenCalledWith('/character/character-b/b-active')
  })

  it('expands the bounded pinned section and opens the full character catalog', async () => {
    component = mount(MainMenu, { target })
    await tick()

    const expand = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes(language.homeShowAllPinnedChats(7)),
    )
    expect(expand).toBeTruthy()
    expect(expand?.getAttribute('aria-expanded')).toBe('false')

    expand!.click()
    await tick()
    expect(target.querySelectorAll('[data-risu-home-pinned-chat]')).toHaveLength(7)
    expect(expand?.getAttribute('aria-expanded')).toBe('true')
    expect(expand?.textContent).toContain(language.homeShowFewerPinnedChats)

    const viewAll = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === language.homeViewAllCharacters,
    )
    viewAll!.click()
    expect(mainMenuMocks.openGridRoute).toHaveBeenCalledOnce()
    expect(get(OpenRealmStore)).toBe(false)
  })

  it('uses compact guidance when there is nothing to resume', async () => {
    mainMenuMocks.database.characters = []
    mainMenuMocks.database.characterOrder = []
    component = mount(MainMenu, { target })
    await tick()

    expect(target.textContent).toContain(language.homePinnedChatsEmpty)
    expect(target.textContent).toContain(language.homeRecentCharactersEmpty)
    expect(target.textContent).toContain(language.openRisuRealm)
  })
})
