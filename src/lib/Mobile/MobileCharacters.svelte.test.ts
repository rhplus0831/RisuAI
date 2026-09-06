import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mobileCharacterMocks = vi.hoisted(() => ({
  charactersResourceState: {
    characters: [] as Array<Record<string, unknown>>,
    currentChar: -1,
    status: 'ready' as 'idle' | 'loading' | 'ready' | 'error',
  },
  settingsResourceState: {
    value: { language: 'en' },
    groupStatuses: { language: 'ready' },
    status: 'ready' as 'error' | 'ready',
  },
}))

const characterActionSpies = vi.hoisted(() => ({
  addCharacter: vi.fn(),
  changeChar: vi.fn(),
}))

const routerActionSpies = vi.hoisted(() => ({
  navigate: vi.fn(),
}))

vi.mock('src/ts/server/resourceState.svelte', async (importActual) => ({
  ...(await importActual<typeof import('src/ts/server/resourceState.svelte')>()),
  charactersResourceState: mobileCharacterMocks.charactersResourceState,
  settingsResourceState: mobileCharacterMocks.settingsResourceState,
  getCharacterResourceOwner: (characterId: string) => {
    const matches = mobileCharacterMocks.charactersResourceState.characters.filter(
      (character) => character.chaId === characterId,
    )
    return matches.length === 1 ? matches[0] : undefined
  },
}))

vi.mock('src/ts/characters', () => ({
  addCharacter: characterActionSpies.addCharacter,
  changeChar: characterActionSpies.changeChar,
  getCharImage: vi.fn(() => ''),
}))

vi.mock('src/ts/router', () => ({
  characterRoutePath: (characterId: string, chatId?: string) =>
    chatId ? `/character/${characterId}/${chatId}` : `/character/${characterId}`,
  navigate: routerActionSpies.navigate,
}))

vi.mock('../SideBars/BarIcon.svelte', async () => ({
  default: (await import('./MobileControls.testStub.svelte')).default,
}))

import MobileCharacters from './MobileCharacters.svelte'
import { MobileSearch, selectedCharID } from 'src/ts/stores.svelte'
import { language } from 'src/lang'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  selectedCharID.set(-1)
  MobileSearch.set('')
  mobileCharacterMocks.charactersResourceState.currentChar = 0
  mobileCharacterMocks.charactersResourceState.status = 'ready'
  mobileCharacterMocks.settingsResourceState.groupStatuses.language = 'ready'
  mobileCharacterMocks.settingsResourceState.value.language = 'en'
  mobileCharacterMocks.settingsResourceState.status = 'ready'
  mobileCharacterMocks.charactersResourceState.characters = [
    {
      chaId: 'character-a',
      name: 'Character A',
      image: '',
      lastInteraction: Date.now() - 30_000,
      chatPage: 0,
      chats: [{ id: 'chat-a' }],
      chatCount: 1,
      activeChatId: 'chat-a',
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

describe('MobileCharacters relative time', () => {
  it('updates while the list remains open', async () => {
    component = mount(MobileCharacters, { target })
    await tick()

    const ago = target.querySelector<HTMLElement>('[data-risu-mobile-character-ago]')
    expect(ago).toBeTruthy()
    const initial = ago?.textContent

    await vi.advanceTimersByTimeAsync(60_000)
    await tick()

    expect(ago?.textContent).not.toBe(initial)
    expect(ago?.textContent).toBe(new Intl.RelativeTimeFormat('en', { style: 'short' }).format(-1, 'minute'))
  })
})

describe('MobileCharacters actions', () => {
  it('opens ID-backed rows by stable owner and exposes character creation', async () => {
    component = mount(MobileCharacters, { target })
    await tick()

    const row = target.querySelector<HTMLButtonElement>('[data-risu-mobile-character-action="open"]')
    const create = target.querySelector<HTMLButtonElement>('[data-risu-mobile-character-action="create"]')
    if (!row || !create) throw new Error('Mobile character actions were not rendered')
    expect(create.getAttribute('aria-label')).toBe(language.addCharacter)

    row.click()
    expect(routerActionSpies.navigate).toHaveBeenCalledWith('/character/character-a/chat-a')
    expect(characterActionSpies.changeChar).not.toHaveBeenCalled()

    create.click()
    expect(characterActionSpies.addCharacter).toHaveBeenCalledOnce()

    mobileCharacterMocks.charactersResourceState.characters = [
      {
        chaId: 'character-b',
        name: 'Character B',
        image: '',
        chatPage: 0,
        chats: [{ id: 'chat-b' }],
        chatCount: 1,
        activeChatId: 'chat-b',
      },
    ]
    row.click()

    expect(routerActionSpies.navigate).toHaveBeenCalledTimes(1)
    expect(characterActionSpies.changeChar).not.toHaveBeenCalled()
  })

  it('fails closed when a stable character id is duplicated', async () => {
    mobileCharacterMocks.charactersResourceState.characters = [
      {
        chaId: 'duplicate-character',
        name: 'First duplicate',
        image: '',
        chatPage: 0,
        chats: [{ id: 'chat-a' }],
        chatCount: 1,
        activeChatId: 'chat-a',
      },
      {
        chaId: 'duplicate-character',
        name: 'Second duplicate',
        image: '',
        chatPage: 0,
        chats: [{ id: 'chat-b' }],
        chatCount: 1,
        activeChatId: 'chat-b',
      },
    ]
    component = mount(MobileCharacters, { target })
    await tick()

    expect(target.querySelector('[data-risu-mobile-character-row]')).toBeNull()
    target.querySelector<HTMLButtonElement>('[data-risu-mobile-character-action="open"]')?.click()

    expect(routerActionSpies.navigate).not.toHaveBeenCalled()
    expect(characterActionSpies.changeChar).not.toHaveBeenCalled()
  })

  it('uses the owner selection rather than a stale selection index', async () => {
    selectedCharID.set(99)
    component = mount(MobileCharacters, { target })
    await tick()

    const row = target.querySelector<HTMLButtonElement>('[data-risu-mobile-character-action="open"]')
    expect(row?.dataset.risuSelected).toBe('true')
    expect(row?.getAttribute('aria-current')).toBe('true')
  })

  it('fails closed before the owner list is ready', async () => {
    mobileCharacterMocks.charactersResourceState.characters = [
      {
        chaId: 'resident-character',
        name: 'Resident character',
        image: '',
        chats: [],
      },
    ]
    mobileCharacterMocks.charactersResourceState.status = 'idle'
    mobileCharacterMocks.charactersResourceState.currentChar = -1
    component = mount(MobileCharacters, { target })
    await tick()

    expect(target.querySelector('[data-risu-mobile-character-row]')).toBeNull()
    expect(routerActionSpies.navigate).not.toHaveBeenCalled()
  })

  it('fails owner errors closed without reading character compatibility', async () => {
    mobileCharacterMocks.charactersResourceState.characters = []
    mobileCharacterMocks.charactersResourceState.status = 'error'

    component = mount(MobileCharacters, { target })
    await tick()

    expect(target.querySelector('[data-risu-mobile-character-row]')).toBeNull()
  })

  it('fails settings errors closed to the English relative-time locale', async () => {
    mobileCharacterMocks.settingsResourceState.status = 'error'
    mobileCharacterMocks.settingsResourceState.groupStatuses.language = 'error'
    mobileCharacterMocks.charactersResourceState.characters[0].lastInteraction = Date.now() - 120_000

    component = mount(MobileCharacters, { target })
    await tick()

    expect(target.querySelector('[data-risu-mobile-character-ago]')?.textContent).toBe(
      new Intl.RelativeTimeFormat('en', { style: 'short' }).format(-2, 'minute'),
    )
  })
})
