import { get } from 'svelte/store'
import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const bookmarkMocks = vi.hoisted(() => ({
  hydrateChatMessages: vi.fn(),
  navigateToCharacterChatMessage: vi.fn(),
}))

vi.mock('../ChatScreens/Chat.svelte', async () => ({
  default: (await import('./BookmarkList.testChat.svelte')).default,
}))

vi.mock('src/ts/characters', () => ({
  getCharImage: vi.fn(() => ''),
}))

vi.mock('src/ts/util', async (importOriginal) => ({
  ...(await importOriginal<typeof import('src/ts/util')>()),
  getUserDisplayName: vi.fn(() => 'User'),
  getUserIcon: vi.fn(() => ''),
}))

vi.mock('src/ts/process/modules', async (importOriginal) => ({
  ...(await importOriginal<typeof import('src/ts/process/modules')>()),
  getModuleTriggers: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

vi.mock('src/ts/alert', () => ({
  alertInput: vi.fn(),
}))

vi.mock('src/ts/chatCommands', () => ({
  currentChatScopedSnapshot: vi.fn(),
  currentChatStateSnapshot: vi.fn(),
  dispatchUpdateChat: vi.fn(),
  dispatchUpdateChatScoped: vi.fn(),
}))

vi.mock('src/ts/server/commands', () => ({
  canUseServerCommands: vi.fn(() => false),
}))

vi.mock('src/ts/server/chatBridge.svelte', () => ({
  rollbackServerBackedChatRowMetadata: vi.fn(),
  syncServerBackedChatMetadataBaselines: vi.fn(),
}))

vi.mock('src/ts/server/chatMessageHydration.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('src/ts/server/chatMessageHydration.svelte')>()),
  hydrateChatMessages: bookmarkMocks.hydrateChatMessages,
}))

vi.mock('src/ts/router', () => ({
  navigateToCharacterChatMessage: bookmarkMocks.navigateToCharacterChatMessage,
}))

import BookmarkList from './BookmarkList.svelte'
import { language } from 'src/lang'
import { bookmarkListOpen, selectedCharID } from 'src/ts/stores.svelte'
import {
  getResourceDatabase as getDatabase,
  replaceResourceDatabase as setDatabaseLite,
} from 'src/ts/server/resourceState.svelte'
import { withTrustedResourceWrite } from 'src/ts/server/resourceWriteGuard.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function seedBookmarkDatabase(messageResident: boolean): void {
  selectedCharID.set(0)
  bookmarkListOpen.set(true)
  setDatabaseLite({
    language: 'en',
    username: 'User',
    characters: [
      {
        chaId: 'char-a',
        name: 'Character',
        image: '',
        chatPage: 0,
        chats: [
          {
            id: 'chat-a',
            name: 'Chat A',
            message: messageResident
              ? [{ chatId: 'message-old', role: 'user', data: 'Older bookmarked message' }]
              : [{ chatId: 'message-tail', role: 'char', data: 'Resident tail message' }],
            bookmarks: ['message-old'],
            bookmarkNames: { 'message-old': 'Older bookmark' },
            localLore: [],
          },
        ],
        customscript: [],
        emotionImages: [],
        triggerscript: [],
      },
    ],
  } as never)
}

function bookmarkOwner(suffix: 'a' | 'b', messageResident: boolean) {
  const bookmarkId = `message-${suffix}-old`
  return {
    chaId: `char-${suffix}`,
    name: `Character ${suffix.toUpperCase()}`,
    image: '',
    chatPage: 0,
    chats: [
      {
        id: `chat-${suffix}`,
        name: `Chat ${suffix.toUpperCase()}`,
        message: messageResident
          ? [{ chatId: bookmarkId, role: 'user', data: `${suffix.toUpperCase()} older bookmarked message` }]
          : [{ chatId: `message-${suffix}-tail`, role: 'char', data: `${suffix.toUpperCase()} resident tail` }],
        bookmarks: [bookmarkId],
        bookmarkNames: { [bookmarkId]: `${suffix.toUpperCase()} older bookmark` },
        localLore: [],
      },
    ],
    customscript: [],
    emotionImages: [],
    triggerscript: [],
  }
}

function seedBookmarkOwners(aResident: boolean, bResident: boolean): void {
  selectedCharID.set(0)
  bookmarkListOpen.set(true)
  setDatabaseLite({
    language: 'en',
    username: 'User',
    characters: [bookmarkOwner('a', aResident), bookmarkOwner('b', bResident)],
  } as never)
}

function installOwnerHydration(suffix: 'a' | 'b', ownerIndex: number, hydration: ReturnType<typeof deferred>): void {
  bookmarkMocks.hydrateChatMessages.mockImplementation(async (chatId: string) => {
    if (chatId !== `chat-${suffix}`) return
    await hydration.promise
    withTrustedResourceWrite(() => {
      getDatabase().characters[ownerIndex].chats[0].message = [
        {
          chatId: `message-${suffix}-old`,
          role: 'user',
          data: `${suffix.toUpperCase()} older bookmarked message`,
        },
        { chatId: `message-${suffix}-tail`, role: 'char', data: `${suffix.toUpperCase()} resident tail` },
      ]
    })
  })
}

describe('BookmarkList hydration and navigation', () => {
  let target: HTMLElement
  let component: MountedComponent | undefined

  beforeEach(() => {
    target = document.createElement('div')
    document.body.appendChild(target)
    bookmarkMocks.hydrateChatMessages.mockReset()
    bookmarkMocks.navigateToCharacterChatMessage.mockReset()
  })

  afterEach(() => {
    if (component) {
      unmount(component)
      component = undefined
    }
    target.remove()
    selectedCharID.set(-1)
    bookmarkListOpen.set(false)
    setDatabaseLite({} as never)
  })

  it('hydrates an older nonresident bookmarked message before rendering an empty state', async () => {
    const hydration = deferred()
    seedBookmarkDatabase(false)
    bookmarkMocks.hydrateChatMessages.mockImplementationOnce(async () => {
      await hydration.promise
      withTrustedResourceWrite(() => {
        getDatabase().characters[0].chats[0].message = [
          { chatId: 'message-old', role: 'user', data: 'Older bookmarked message' },
          { chatId: 'message-tail', role: 'char', data: 'Resident tail message' },
        ]
      })
    })

    component = mount(BookmarkList, { target })
    await tick()

    expect(bookmarkMocks.hydrateChatMessages).toHaveBeenCalledWith('chat-a', { strict: true })
    expect(target.querySelector('[role="status"]')?.textContent).toBe(language.loading)
    expect(target.textContent).not.toContain(language.noBookmarks)

    hydration.resolve()
    await vi.waitFor(() => expect(target.querySelector('[data-risu-bookmark-id="message-old"]')).not.toBeNull())

    expect(target.textContent).toContain('Older bookmark')
    expect(target.textContent).not.toContain(language.noBookmarks)
  })

  it('routes a bookmark jump through the chat-message navigation queue and closes', async () => {
    seedBookmarkDatabase(true)
    component = mount(BookmarkList, { target })
    await tick()

    const jump = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.goToChat}"]`)
    if (!jump) throw new Error('Bookmark jump button not found')
    jump.click()

    expect(bookmarkMocks.hydrateChatMessages).not.toHaveBeenCalled()
    expect(bookmarkMocks.navigateToCharacterChatMessage).toHaveBeenCalledOnce()
    expect(bookmarkMocks.navigateToCharacterChatMessage).toHaveBeenCalledWith('char-a', 'chat-a', 0)
    expect(get(bookmarkListOpen)).toBe(false)
  })

  it('ignores a stale hydration completion after switching bookmark owners', async () => {
    const aHydration = deferred()
    const bHydration = deferred()
    seedBookmarkOwners(false, false)
    bookmarkMocks.hydrateChatMessages.mockImplementation(async (chatId: string) => {
      const suffix = chatId === 'chat-a' ? 'a' : 'b'
      const ownerIndex = suffix === 'a' ? 0 : 1
      const hydration = suffix === 'a' ? aHydration : bHydration
      await hydration.promise
      withTrustedResourceWrite(() => {
        getDatabase().characters[ownerIndex].chats[0].message = [
          {
            chatId: `message-${suffix}-old`,
            role: 'user',
            data: `${suffix.toUpperCase()} older bookmarked message`,
          },
          { chatId: `message-${suffix}-tail`, role: 'char', data: `${suffix.toUpperCase()} resident tail` },
        ]
      })
    })

    component = mount(BookmarkList, { target })
    await tick()
    expect(bookmarkMocks.hydrateChatMessages).toHaveBeenCalledWith('chat-a', { strict: true })

    selectedCharID.set(1)
    await vi.waitFor(() => expect(bookmarkMocks.hydrateChatMessages).toHaveBeenCalledWith('chat-b', { strict: true }))

    aHydration.resolve()
    await tick()
    await Promise.resolve()

    expect(target.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(target.querySelector('[role="status"]')?.textContent).toBe(language.loading)
    expect(target.textContent).not.toContain(language.noBookmarks)

    bHydration.resolve()
    await vi.waitFor(() => expect(target.querySelector('[data-risu-bookmark-id="message-b-old"]')).not.toBeNull())
    expect(target.textContent).toContain('B older bookmark')
    expect(target.textContent).not.toContain('A older bookmark')
  })

  it('hydrates a newly selected nonresident owner after the previous owner is ready', async () => {
    const bHydration = deferred()
    seedBookmarkOwners(true, false)
    installOwnerHydration('b', 1, bHydration)

    component = mount(BookmarkList, { target })
    await vi.waitFor(() => expect(target.querySelector('[data-risu-bookmark-id="message-a-old"]')).not.toBeNull())
    expect(bookmarkMocks.hydrateChatMessages).not.toHaveBeenCalled()

    selectedCharID.set(1)
    await vi.waitFor(() => expect(bookmarkMocks.hydrateChatMessages).toHaveBeenCalledWith('chat-b', { strict: true }))
    expect(target.querySelector('[role="status"]')?.textContent).toBe(language.loading)
    expect(target.textContent).not.toContain(language.noBookmarks)

    bHydration.resolve()
    await vi.waitFor(() => expect(target.querySelector('[data-risu-bookmark-id="message-b-old"]')).not.toBeNull())
    expect(target.textContent).toContain('B older bookmark')
  })
})
