import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/gui/tooltip', () => ({
  tooltipRight: () => ({
    destroy: vi.fn(),
    update: vi.fn(),
  }),
}))

vi.mock('src/ts/characters', () => ({
  getCharImage: (source: string) => source,
}))

vi.mock('src/ts/router', async () => {
  const { writable } = await import('svelte/store')
  return {
    currentRoute: writable({ kind: 'home', path: '/' }),
  }
})

import PinnedChatsRail from './PinnedChatsRail.svelte'
import { currentRoute } from 'src/ts/router'
import type { PinnedChatItem } from './sidebarMultitasking'

type MountedComponent = Parameters<typeof unmount>[0]

const pinnedChats: readonly PinnedChatItem[] = [
  {
    characterId: 'char-a',
    characterIndex: 0,
    characterName: 'Alpha',
    characterImage: '',
    chatId: 'chat-a',
    chatName: 'Alpha Chat',
  },
  {
    characterId: 'char-b',
    characterIndex: 1,
    characterName: 'Beta',
    characterImage: '',
    chatId: 'chat-b',
    chatName: 'Beta Chat',
  },
]

let component: MountedComponent | undefined
let target: HTMLElement

function setCharacterRoute(characterId: string, chatId?: string): void {
  currentRoute.set({
    kind: 'character',
    path: chatId ? `/character/${characterId}/${chatId}` : `/character/${characterId}`,
    chaId: characterId,
    ...(chatId ? { chatId } : {}),
  })
}

function pinnedRow(chatId: string): HTMLElement {
  const row = target.querySelector<HTMLElement>(`[data-risu-pinned-chat="${chatId}"]`)
  expect(row).toBeTruthy()
  return row!
}

function pinnedAction(chatId: string): HTMLElement {
  const action = pinnedRow(chatId).querySelector<HTMLElement>('[role="button"]')
  expect(action).toBeTruthy()
  return action!
}

function expectCurrentPinnedChat(chatId: string | null): void {
  const currentRows = target.querySelectorAll('[data-risu-pinned-chat-current="true"]')
  const currentActions = target.querySelectorAll('[aria-current="page"]')
  expect(currentRows).toHaveLength(chatId ? 1 : 0)
  expect(currentActions).toHaveLength(chatId ? 1 : 0)

  for (const item of pinnedChats) {
    const current = item.chatId === chatId
    expect(pinnedRow(item.chatId).dataset.risuPinnedChatCurrent).toBe(current ? 'true' : 'false')
    expect(pinnedRow(item.chatId).classList.contains('bg-selected')).toBe(current)
    expect(pinnedAction(item.chatId).getAttribute('aria-current')).toBe(current ? 'page' : null)
  }
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  currentRoute.set({ kind: 'home', path: '/' })
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  currentRoute.set({ kind: 'home', path: '/' })
})

describe('PinnedChatsRail current route', () => {
  it('tracks exactly one current pinned chat across chat, character-only, and non-chat routes', async () => {
    setCharacterRoute('char-a', 'chat-a')
    component = mount(PinnedChatsRail, {
      target,
      props: {
        items: pinnedChats,
        generatingChatIds: new Set<string>(),
        rounded: false,
        onOpen: vi.fn(),
      },
    })
    await tick()

    expectCurrentPinnedChat('chat-a')

    setCharacterRoute('char-b', 'chat-b')
    await tick()
    expectCurrentPinnedChat('chat-b')

    setCharacterRoute('char-a')
    await tick()
    expectCurrentPinnedChat(null)

    currentRoute.set({ kind: 'home', path: '/' })
    await tick()
    expectCurrentPinnedChat(null)
  })

  it('renders a warning treatment instead of a healthy spinner for an exhausted chat', async () => {
    const onOpen = vi.fn()
    component = mount(PinnedChatsRail, {
      target,
      props: {
        items: pinnedChats,
        generatingChatIds: new Set(['chat-a', 'chat-b']),
        warningChatIds: new Set(['chat-a']),
        rounded: false,
        onOpen,
      },
    })
    await tick()

    const warning = pinnedRow('chat-a').querySelector<HTMLElement>('[data-risu-generation-indicator="warning"]')
    const healthy = pinnedRow('chat-b').querySelector<HTMLElement>('[data-risu-generation-indicator="generating"]')
    expect(warning).toBeTruthy()
    expect(warning?.getAttribute('role')).toBe('status')
    expect(warning?.getAttribute('aria-label')).toContain('Alpha Chat')
    expect(warning?.querySelector('.animate-spin')).toBeNull()
    expect(healthy).toBeTruthy()
    expect(healthy?.querySelector('.animate-spin')).toBeTruthy()

    warning!.click()
    expect(onOpen).toHaveBeenCalledWith(pinnedChats[0])
  })
})
