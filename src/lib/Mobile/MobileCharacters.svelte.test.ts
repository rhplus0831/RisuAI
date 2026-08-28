import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mobileCharacterMocks = vi.hoisted(() => ({
  database: {
    language: 'en',
    characters: [] as Array<Record<string, unknown>>,
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
  getResourceDatabase: () => mobileCharacterMocks.database,
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
  mobileCharacterMocks.database.characters = [
    {
      chaId: 'character-a',
      name: 'Character A',
      image: '',
      lastInteraction: Date.now() - 30_000,
      chatPage: 0,
      chats: [{ id: 'chat-a' }],
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

    mobileCharacterMocks.database.characters = [
      {
        chaId: 'character-b',
        name: 'Character B',
        image: '',
        chatPage: 0,
        chats: [{ id: 'chat-b' }],
      },
    ]
    row.click()

    expect(routerActionSpies.navigate).toHaveBeenCalledTimes(1)
    expect(characterActionSpies.changeChar).not.toHaveBeenCalled()
  })
})
