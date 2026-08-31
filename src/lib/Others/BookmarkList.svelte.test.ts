import { get } from 'svelte/store'
import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const bookmarkMocks = vi.hoisted(() => ({
  alertError: vi.fn(),
  alertInput: vi.fn(),
  alertNormal: vi.fn(),
  canUseServerCommands: vi.fn(() => false),
  currentChatScopedSnapshot: vi.fn(),
  dispatchUpdateChatScopedWithOutcome: vi.fn(),
  hydrateChatMessages: vi.fn(),
  navigateToCharacterChatMessage: vi.fn(),
}))

vi.mock('../ChatScreens/Chat.svelte', async () => ({
  default: (await import('./BookmarkList.testChat.svelte')).default,
}))

vi.mock('src/ts/characters', () => ({
  getCharImage: vi.fn(() => ''),
}))

vi.mock('src/ts/utilState', () => ({
  getPersonaPrompt: vi.fn(() => ''),
  getUserDisplayName: vi.fn(() => 'User'),
  getUserIcon: vi.fn(() => ''),
  getUserName: vi.fn(() => 'User'),
}))

vi.mock('src/ts/process/modules', async (importOriginal) => ({
  ...(await importOriginal<typeof import('src/ts/process/modules')>()),
  getModuleTriggers: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

vi.mock('src/ts/alert', () => ({
  alertError: bookmarkMocks.alertError,
  alertInput: bookmarkMocks.alertInput,
  alertNormal: bookmarkMocks.alertNormal,
}))

vi.mock('src/ts/chatCommands', () => ({
  currentChatScopedSnapshot: bookmarkMocks.currentChatScopedSnapshot,
  currentChatStateSnapshot: vi.fn(),
  dispatchUpdateChat: vi.fn(),
  dispatchUpdateChatScopedWithOutcome: bookmarkMocks.dispatchUpdateChatScopedWithOutcome,
}))

vi.mock('src/ts/server/commands', () => ({
  canUseServerCommands: bookmarkMocks.canUseServerCommands,
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
import type { ChatMutationFinalOutcome, ChatMutationOutcome } from 'src/ts/chatCommands'
import {
  charactersResourceState,
  getResourceDatabase as getDatabase,
  replaceResourceDatabase as setDatabaseLite,
} from 'src/ts/server/resourceState.svelte'
import { withTrustedResourceWrite } from 'src/ts/server/resourceWriteGuard.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function queuedMutationOutcome(settlement: Promise<ChatMutationFinalOutcome>, mutationId: string): ChatMutationOutcome {
  return {
    status: 'queued',
    result: { status: 'unavailable' },
    mutationIds: [mutationId],
    settlement,
  }
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
    currentChar: 0,
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
    currentChar: 0,
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
    bookmarkMocks.alertError.mockReset()
    bookmarkMocks.alertInput.mockReset()
    bookmarkMocks.alertNormal.mockReset()
    bookmarkMocks.canUseServerCommands.mockReset().mockReturnValue(false)
    bookmarkMocks.currentChatScopedSnapshot.mockReset()
    bookmarkMocks.dispatchUpdateChatScopedWithOutcome.mockReset()
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

  it('hydrates bookmarked metadata when no resident transcript owner exists', async () => {
    const hydration = deferred()
    seedBookmarkDatabase(true)
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].message = undefined as never
    })
    bookmarkMocks.hydrateChatMessages.mockImplementationOnce(async () => {
      await hydration.promise
      withTrustedResourceWrite(() => {
        getDatabase().characters[0].chats[0].message = [
          { chatId: 'message-old', role: 'user', data: 'Older bookmarked message' },
        ]
      })
    })

    component = mount(BookmarkList, { target })
    await tick()

    expect(bookmarkMocks.hydrateChatMessages).toHaveBeenCalledWith('chat-a', { strict: true })
    expect(target.querySelector('[role="status"]')?.textContent).toBe(language.loading)

    hydration.resolve()
    await vi.waitFor(() => expect(target.querySelector('[data-risu-bookmark-id="message-old"]')).not.toBeNull())
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

  it('tracks bookmark persistence by row and settles queued operations as accepted or failed', async () => {
    const renameRequest = deferred<ChatMutationOutcome>()
    const renameSettlement = deferred<ChatMutationFinalOutcome>()
    const removeRequest = deferred<ChatMutationOutcome>()
    const removeSettlement = deferred<ChatMutationFinalOutcome>()
    seedBookmarkDatabase(true)
    bookmarkMocks.canUseServerCommands.mockReturnValue(true)
    bookmarkMocks.alertInput.mockResolvedValueOnce('Renamed bookmark')
    bookmarkMocks.currentChatScopedSnapshot.mockImplementation(() => ({
      selectedCharID: 0,
      characterId: 'char-a',
      chatId: 'chat-a',
      chat: JSON.parse(JSON.stringify(getDatabase().characters[0].chats[0])),
    }))
    bookmarkMocks.dispatchUpdateChatScopedWithOutcome
      .mockReturnValueOnce(renameRequest.promise)
      .mockReturnValueOnce(removeRequest.promise)

    component = mount(BookmarkList, { target })
    await vi.waitFor(() => expect(target.querySelector('[data-risu-bookmark-id="message-old"]')).not.toBeNull())

    const rename = target.querySelector<HTMLButtonElement>('[data-risu-bookmark-action="rename"]')
    const remove = target.querySelector<HTMLButtonElement>('[data-risu-bookmark-action="remove"]')
    expect(rename).toBeTruthy()
    expect(remove).toBeTruthy()
    rename!.click()
    await vi.waitFor(() => expect(bookmarkMocks.dispatchUpdateChatScopedWithOutcome).toHaveBeenCalledTimes(1))

    const pendingRow = target.querySelector<HTMLElement>('[data-risu-bookmark-id="message-old"]')
    expect(pendingRow?.getAttribute('aria-busy')).toBe('true')
    expect(rename!.disabled).toBe(true)
    expect(remove!.disabled).toBe(true)
    remove!.click()
    expect(bookmarkMocks.dispatchUpdateChatScopedWithOutcome).toHaveBeenCalledTimes(1)

    renameRequest.resolve(queuedMutationOutcome(renameSettlement.promise, 'rename-mutation'))
    await vi.waitFor(() =>
      expect(bookmarkMocks.alertNormal).toHaveBeenCalledWith(language.bookmarkRenameQueued('Older bookmark')),
    )
    expect(pendingRow?.getAttribute('data-risu-mutation-status')).toBe('queued')
    expect(target.querySelector('[data-risu-bookmark-mutation-status="queued"]')).toBeNull()

    renameSettlement.resolve({ status: 'accepted' })
    await vi.waitFor(() => expect(pendingRow?.getAttribute('data-risu-mutation-status')).toBe('idle'))

    target.querySelector<HTMLButtonElement>('[data-risu-bookmark-action="remove"]')!.click()
    await vi.waitFor(() => expect(bookmarkMocks.dispatchUpdateChatScopedWithOutcome).toHaveBeenCalledTimes(2))
    expect(target.querySelector('[data-risu-bookmark-id="message-old"]')).toBeNull()
    expect(target.querySelector('[data-risu-bookmark-mutation-status="pending"]')).toBeNull()

    removeRequest.resolve(queuedMutationOutcome(removeSettlement.promise, 'remove-mutation'))
    await vi.waitFor(() =>
      expect(bookmarkMocks.alertNormal).toHaveBeenCalledWith(language.bookmarkRemoveQueued('Renamed bookmark')),
    )

    withTrustedResourceWrite(() => {
      const chat = getDatabase().characters[0].chats[0]
      chat.bookmarks = ['message-old']
      chat.bookmarkNames = { 'message-old': 'Renamed bookmark' }
    })
    removeSettlement.resolve({ status: 'failed', result: { status: 'error', error: 'rejected' } })

    await vi.waitFor(() =>
      expect(target.querySelector('[data-risu-bookmark-mutation-status="failed"]')?.textContent).toContain(
        language.bookmarkRemoveFailed('Renamed bookmark'),
      ),
    )
    expect(target.querySelector('[data-risu-bookmark-id="message-old"]')).not.toBeNull()
    expect(bookmarkMocks.alertError).toHaveBeenCalledWith(language.bookmarkRemoveFailed('Renamed bookmark'))
  })

  it('does not let an older queued settlement overwrite a newer rename attempt', async () => {
    const firstSettlement = deferred<ChatMutationFinalOutcome>()
    const secondSettlement = deferred<ChatMutationFinalOutcome>()
    seedBookmarkDatabase(true)
    bookmarkMocks.canUseServerCommands.mockReturnValue(true)
    bookmarkMocks.alertInput.mockResolvedValueOnce('First rename').mockResolvedValueOnce('Second rename')
    bookmarkMocks.currentChatScopedSnapshot.mockImplementation(() => ({
      selectedCharID: 0,
      characterId: 'char-a',
      chatId: 'chat-a',
      chat: JSON.parse(JSON.stringify(getDatabase().characters[0].chats[0])),
    }))
    bookmarkMocks.dispatchUpdateChatScopedWithOutcome
      .mockResolvedValueOnce(queuedMutationOutcome(firstSettlement.promise, 'first-rename'))
      .mockResolvedValueOnce(queuedMutationOutcome(secondSettlement.promise, 'second-rename'))

    component = mount(BookmarkList, { target })
    await vi.waitFor(() => expect(target.querySelector('[data-risu-bookmark-action="rename"]')).not.toBeNull())

    target.querySelector<HTMLButtonElement>('[data-risu-bookmark-action="rename"]')!.click()
    await vi.waitFor(() =>
      expect(
        target.querySelector('[data-risu-bookmark-id="message-old"]')?.getAttribute('data-risu-mutation-status'),
      ).toBe('queued'),
    )
    target.querySelector<HTMLButtonElement>('[data-risu-bookmark-action="rename"]')!.click()
    await vi.waitFor(() => expect(bookmarkMocks.dispatchUpdateChatScopedWithOutcome).toHaveBeenCalledTimes(2))

    firstSettlement.resolve({ status: 'failed', result: { status: 'error', error: 'first rejected' } })
    await vi.waitFor(() =>
      expect(bookmarkMocks.alertError).toHaveBeenCalledWith(language.bookmarkRenameFailed('Older bookmark')),
    )
    expect(
      target.querySelector('[data-risu-bookmark-id="message-old"]')?.getAttribute('data-risu-mutation-status'),
    ).toBe('queued')

    secondSettlement.resolve({ status: 'accepted' })
    await vi.waitFor(() =>
      expect(
        target.querySelector('[data-risu-bookmark-id="message-old"]')?.getAttribute('data-risu-mutation-status'),
      ).toBe('idle'),
    )
    expect(target.querySelector('[data-risu-bookmark-mutation-status="failed"]')).toBeNull()
  })

  it('reports a bookmark settlement even after the modal unmounts', async () => {
    const request = deferred<ChatMutationOutcome>()
    const settlement = deferred<ChatMutationFinalOutcome>()
    seedBookmarkDatabase(true)
    bookmarkMocks.canUseServerCommands.mockReturnValue(true)
    bookmarkMocks.alertInput.mockResolvedValueOnce('Detached rename')
    bookmarkMocks.currentChatScopedSnapshot.mockImplementation(() => ({
      selectedCharID: 0,
      characterId: 'char-a',
      chatId: 'chat-a',
      chat: JSON.parse(JSON.stringify(getDatabase().characters[0].chats[0])),
    }))
    bookmarkMocks.dispatchUpdateChatScopedWithOutcome.mockReturnValueOnce(request.promise)
    component = mount(BookmarkList, { target })
    await vi.waitFor(() => expect(target.querySelector('[data-risu-bookmark-action="rename"]')).not.toBeNull())

    target.querySelector<HTMLButtonElement>('[data-risu-bookmark-action="rename"]')!.click()
    await vi.waitFor(() => expect(bookmarkMocks.dispatchUpdateChatScopedWithOutcome).toHaveBeenCalledOnce())
    unmount(component)
    component = undefined

    request.resolve(queuedMutationOutcome(settlement.promise, 'detached-rename'))
    await vi.waitFor(() =>
      expect(bookmarkMocks.alertNormal).toHaveBeenCalledWith(language.bookmarkRenameQueued('Older bookmark')),
    )

    settlement.resolve({ status: 'failed', result: { status: 'error', error: 'rejected after unmount' } })
    await vi.waitFor(() =>
      expect(bookmarkMocks.alertError).toHaveBeenCalledWith(language.bookmarkRenameFailed('Older bookmark')),
    )
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

    charactersResourceState.currentChar = 1
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

    charactersResourceState.currentChar = 1
    selectedCharID.set(1)
    await vi.waitFor(() => expect(bookmarkMocks.hydrateChatMessages).toHaveBeenCalledWith('chat-b', { strict: true }))
    expect(target.querySelector('[role="status"]')?.textContent).toBe(language.loading)
    expect(target.textContent).not.toContain(language.noBookmarks)

    bHydration.resolve()
    await vi.waitFor(() => expect(target.querySelector('[data-risu-bookmark-id="message-b-old"]')).not.toBeNull())
    expect(target.textContent).toContain('B older bookmark')
  })

  it('fails closed when the selected character stable id is duplicated', async () => {
    seedBookmarkDatabase(true)
    withTrustedResourceWrite(() => {
      getDatabase().characters.push(JSON.parse(JSON.stringify(getDatabase().characters[0])))
    })

    component = mount(BookmarkList, { target })
    await tick()

    expect(bookmarkMocks.hydrateChatMessages).not.toHaveBeenCalled()
    expect(target.querySelector('[data-risu-bookmark-id]')).toBeNull()
  })

  it('fails closed on character owner errors and duplicate active chat ids', async () => {
    seedBookmarkDatabase(true)
    withTrustedResourceWrite(() => {
      getDatabase().characters.push({
        ...bookmarkOwner('b', true),
        chats: [{ ...bookmarkOwner('b', true).chats[0], id: 'chat-a' }],
      } as any)
    })

    component = mount(BookmarkList, { target })
    await tick()
    expect(bookmarkMocks.hydrateChatMessages).not.toHaveBeenCalled()
    expect(target.querySelector('[data-risu-bookmark-id]')).toBeNull()

    unmount(component)
    component = undefined
    seedBookmarkDatabase(true)
    charactersResourceState.rowStatuses['char-a'] = 'error'
    component = mount(BookmarkList, { target })
    await tick()
    expect(target.querySelector('[data-risu-bookmark-id]')).toBeNull()

    unmount(component)
    component = undefined
    seedBookmarkDatabase(true)
    charactersResourceState.status = 'error'
    component = mount(BookmarkList, { target })
    await tick()
    expect(target.querySelector('[data-risu-bookmark-id]')).toBeNull()
  })

  it('fails closed on duplicate bookmark and message stable ids', async () => {
    seedBookmarkDatabase(true)
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].bookmarks = ['message-old', 'message-old']
    })

    component = mount(BookmarkList, { target })
    await tick()
    expect(target.querySelector('[data-risu-bookmark-id]')).toBeNull()
    expect(bookmarkMocks.hydrateChatMessages).not.toHaveBeenCalled()

    unmount(component)
    component = undefined
    seedBookmarkDatabase(true)
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].message.push({
        chatId: 'message-old',
        role: 'char',
        data: 'Duplicate stable message id',
      } as never)
    })

    component = mount(BookmarkList, { target })
    await tick()
    expect(target.querySelector('[data-risu-bookmark-id]')).toBeNull()
  })
})
