import { mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const chatListMocks = vi.hoisted(() => {
  type DeferredCommand = {
    input?: unknown
    promise: Promise<unknown>
    reject: (reason?: unknown) => void
    resolve: (value: unknown) => void
    settled: boolean
  }

  let serverCommandsEnabled = false
  let pendingCreateCommand: DeferredCommand | undefined
  let pendingDeleteCommand: DeferredCommand | undefined
  let pendingSelectCommand: DeferredCommand | undefined

  function createDeferredCommand(): DeferredCommand {
    let resolveCommand!: (value: unknown) => void
    let rejectCommand!: (reason?: unknown) => void
    const command: DeferredCommand = {
      promise: new Promise((resolve, reject) => {
        resolveCommand = resolve
        rejectCommand = reject
      }),
      reject: (reason?: unknown) => {
        command.settled = true
        rejectCommand(reason)
      },
      resolve: (value: unknown) => {
        command.settled = true
        resolveCommand(value)
      },
      settled: false,
    }
    return command
  }

  function createDeferredCreateCommand(): DeferredCommand {
    pendingCreateCommand = createDeferredCommand()
    return pendingCreateCommand
  }

  function createDeferredDeleteCommand(): DeferredCommand {
    pendingDeleteCommand = createDeferredCommand()
    return pendingDeleteCommand
  }

  function createDeferredSelectCommand(): DeferredCommand {
    pendingSelectCommand = createDeferredCommand()
    return pendingSelectCommand
  }

  function okCommandResult() {
    return {
      revision: 1,
      status: 'ok',
    }
  }

  const unusedCommand = vi.fn(async () => okCommandResult())

  return {
    alertConfirm: vi.fn(async () => false),
    alertError: vi.fn(),
    appendMessageCommand: unusedCommand,
    canUseServerCommands: vi.fn(() => serverCommandsEnabled),
    changeChatTo: vi.fn(),
    createChatCommand: vi.fn((input: unknown) => {
      if (!pendingCreateCommand) {
        throw new Error('No deferred create-chat command was prepared')
      }
      pendingCreateCommand.input = input
      return pendingCreateCommand.promise
    }),
    createChatFolderCommand: unusedCommand,
    createDeferredCreateCommand,
    createDeferredDeleteCommand,
    createDeferredSelectCommand,
    deleteChatCommand: vi.fn((input: unknown) => {
      if (!pendingDeleteCommand) {
        throw new Error('No deferred delete-chat command was prepared')
      }
      pendingDeleteCommand.input = input
      return pendingDeleteCommand.promise
    }),
    deleteChatFolderCommand: unusedCommand,
    deleteMessageCommand: unusedCommand,
    dispatchUpdateChat: vi.fn(),
    exportChat: vi.fn(),
    forkChatCommand: unusedCommand,
    importChat: vi.fn(),
    navigate: vi.fn(),
    patchChatScriptstateCommand: unusedCommand,
    reorderChatFoldersCommand: unusedCommand,
    reorderChatsCommand: unusedCommand,
    replaceMessagesCommand: unusedCommand,
    resetCommandHarness: () => {
      pendingCreateCommand = undefined
      pendingDeleteCommand = undefined
      pendingSelectCommand = undefined
      serverCommandsEnabled = false
    },
    runServerCommand: vi.fn(
      async (input: { command: (baseRevision: number) => Promise<any>; rollback?: () => void }) => {
        if (!serverCommandsEnabled) return { status: 'unavailable' }
        try {
          const result = await input.command(10)
          if (result.status !== 'ok') {
            input.rollback?.()
          }
          return result
        } catch (error) {
          input.rollback?.()
          return {
            error: error instanceof Error ? error.message : String(error),
            status: 'error',
          }
        }
      },
    ),
    setServerCommandsEnabled: (enabled: boolean) => {
      serverCommandsEnabled = enabled
    },
    truncateMessagesCommand: unusedCommand,
    updateChatCommand: vi.fn((input: unknown) => {
      if ((input as { select?: boolean }).select) {
        if (!pendingSelectCommand) {
          throw new Error('No deferred select-chat command was prepared')
        }
        pendingSelectCommand.input = input
        return pendingSelectCommand.promise
      }
      return okCommandResult()
    }),
    updateChatFolderCommand: unusedCommand,
    updateMessageCommand: unusedCommand,
    rollbackServerBackedChatRowMetadata: vi.fn(),
    syncServerBackedChatMetadataBaselines: vi.fn(),
    watchServerBackedChatMetadata: vi.fn(() => vi.fn()),
    withTrustedResourceWrite: vi.fn((callback: () => void) => callback()),
  }
})

vi.mock('../../lang', () => ({
  language: {
    chatList: 'Chat List',
    errors: { onlyOneChat: 'Only one chat' },
    removeConfirm: 'Remove ',
  },
}))

vi.mock('../../ts/alert', () => ({
  alertConfirm: chatListMocks.alertConfirm,
  alertError: chatListMocks.alertError,
}))

vi.mock('../../ts/characters', () => ({
  exportChat: chatListMocks.exportChat,
  importChat: chatListMocks.importChat,
}))

vi.mock('src/ts/chatCommands', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/chatCommands')>()
  return {
    ...actual,
    dispatchUpdateChat: chatListMocks.dispatchUpdateChat,
  }
})

vi.mock('src/ts/globalApi.svelte', () => ({
  changeChatTo: chatListMocks.changeChatTo,
  downloadFile: vi.fn(),
  saveAsset: vi.fn(async () => ''),
}))

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: () => [],
  getModuleLorebooks: () => [],
  getModuleRegexScripts: () => [],
  getModules: () => [],
  getModuleToggles: () => '',
  getModuleTriggers: () => [],
  moduleUpdate: vi.fn(),
}))

vi.mock('src/ts/process/scripts', () => ({
  resetScriptCache: vi.fn(),
}))

vi.mock('src/ts/router', () => ({
  characterRoutePath: (characterId: string, chatId?: string) =>
    chatId ? `/character/${characterId}/${chatId}` : `/character/${characterId}`,
  navigate: chatListMocks.navigate,
}))

vi.mock('src/ts/server/chatBridge.svelte', () => ({
  rollbackServerBackedChatRowMetadata: chatListMocks.rollbackServerBackedChatRowMetadata,
  syncServerBackedChatMetadataBaselines: chatListMocks.syncServerBackedChatMetadataBaselines,
  watchServerBackedChatMetadata: chatListMocks.watchServerBackedChatMetadata,
}))

vi.mock('src/ts/server/commands', () => ({
  appendMessageCommand: chatListMocks.appendMessageCommand,
  canUseServerCommands: chatListMocks.canUseServerCommands,
  createChatCommand: chatListMocks.createChatCommand,
  createChatFolderCommand: chatListMocks.createChatFolderCommand,
  deleteChatCommand: chatListMocks.deleteChatCommand,
  deleteChatFolderCommand: chatListMocks.deleteChatFolderCommand,
  deleteMessageCommand: chatListMocks.deleteMessageCommand,
  forkChatCommand: chatListMocks.forkChatCommand,
  patchChatScriptstateCommand: chatListMocks.patchChatScriptstateCommand,
  reorderChatFoldersCommand: chatListMocks.reorderChatFoldersCommand,
  reorderChatsCommand: chatListMocks.reorderChatsCommand,
  replaceMessagesCommand: chatListMocks.replaceMessagesCommand,
  runServerCommand: chatListMocks.runServerCommand,
  truncateMessagesCommand: chatListMocks.truncateMessagesCommand,
  updateChatCommand: chatListMocks.updateChatCommand,
  updateChatFolderCommand: chatListMocks.updateChatFolderCommand,
  updateMessageCommand: chatListMocks.updateMessageCommand,
}))

vi.mock('src/ts/server/resourceWriteGuard.svelte', () => ({
  withTrustedResourceWrite: chatListMocks.withTrustedResourceWrite,
}))

import ChatList from './ChatList.svelte'
import { selectedCharID } from 'src/ts/stores.svelte'
import { currentChatSelectionSnapshot, dispatchSelectChat } from 'src/ts/chatCommands'
import {
  getResourceDatabase as getDatabase,
  replaceResourceDatabase as setDatabaseLite,
} from 'src/ts/server/resourceState.svelte'
import type { Chat, character } from 'src/ts/storage/database.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

function makeChat(id: string, name: string): Chat {
  return {
    id,
    name,
    message: [],
    localLore: [],
    fmIndex: -1,
    note: '',
  } as Chat
}

function seedModalDatabase(): character {
  const chara = {
    chaId: 'char-a',
    name: 'Harness Character',
    chatPage: 1,
    chats: [makeChat('chat-a', 'Modal Chat A'), makeChat('chat-b', 'Modal Chat B'), makeChat('chat-c', 'Modal Chat C')],
    chatFolders: [],
    firstMessage: '',
    desc: '',
    notes: '',
    viewScreen: 'none',
    bias: [],
    emotionImages: [],
    globalLore: [],
    sdData: [],
    customscript: [],
    triggerscript: [],
    utilityBot: false,
    exampleMessage: '',
    creatorNotes: '',
    systemPrompt: '',
    postHistoryInstructions: '',
    alternateGreetings: [],
    tags: [],
    creator: '',
    characterVersion: '',
    personality: '',
    scenario: '',
    firstMsgIndex: 0,
  } as character

  selectedCharID.set(0)
  setDatabaseLite({
    characters: [chara],
    enabledModules: [],
    modules: [],
  } as never)

  return getDatabase().characters[0]
}

function modalRoot(): HTMLElement {
  const root = target.querySelector<HTMLElement>('[data-risu-chat-list="modal"]')
  expect(root, 'modal chat list root').toBeTruthy()
  return root!
}

function chatRows(): HTMLButtonElement[] {
  return Array.from(modalRoot().querySelectorAll<HTMLButtonElement>('button[data-risu-chat-id]'))
}

function rowByChatId(chatId: string): HTMLButtonElement {
  const row = chatRows().find((candidate) => candidate.dataset.risuChatId === chatId)
  expect(row, `chat row ${chatId}`).toBeTruthy()
  return row!
}

function createButton(): HTMLButtonElement {
  const button = modalRoot().querySelector<HTMLButtonElement>('[data-risu-chat-action="create"]')
  expect(button, 'create chat button').toBeTruthy()
  return button!
}

function editButton(): HTMLButtonElement {
  const button = modalRoot().querySelector<HTMLButtonElement>('[data-risu-chat-action="edit"]')
  expect(button, 'edit chat button').toBeTruthy()
  return button!
}

function rowActionButton(row: HTMLElement, actionKind: string): HTMLElement {
  const action = row.querySelector<HTMLElement>(`[data-risu-chat-action="${actionKind}"]`)
  expect(action, `${actionKind} chat action`).toBeTruthy()
  return action!
}

function deleteButtonForRow(row: HTMLElement): HTMLElement {
  return rowActionButton(row, 'delete')
}

function expectRowSelected(chatId: string, selected: boolean): void {
  expect(rowByChatId(chatId).dataset.risuChatSelected).toBe(selected ? 'true' : 'false')
}

function selectedCharacter(): character {
  return getDatabase().characters[0]
}

function removeCharacterId(chara: character): void {
  ;(chara as { chaId?: string }).chaId = undefined
}

function changeChatToLikeReal(idOrIndex: string | number): void {
  const previous = currentChatSelectionSnapshot()
  const chara = selectedCharacter()
  let index = -1

  if (typeof idOrIndex === 'number') {
    index = idOrIndex
  } else {
    index = chara.chats.findIndex((chat) => chat.id === idOrIndex)
  }

  if (index < 0) return

  chara.chatPage = index
  const chatId = chara.chats[index]?.id
  if (chatId) dispatchSelectChat(chatId, previous)
}

async function flushCommandWork(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await tick()
}

describe('ChatList DOM contract harness', () => {
  beforeEach(() => {
    target = document.createElement('div')
    document.body.appendChild(target)
    chatListMocks.resetCommandHarness()
    vi.clearAllMocks()
    chatListMocks.changeChatTo.mockImplementation(changeChatToLikeReal)
  })

  afterEach(() => {
    if (component) {
      unmount(component)
      component = undefined
    }
    target.remove()
    document.body.innerHTML = ''
    selectedCharID.set(-1)
    setDatabaseLite({} as never)
  })

  it('renders seeded chat rows with the selected row selector', async () => {
    seedModalDatabase()

    component = mount(ChatList, { target, props: { close: vi.fn() } })
    await tick()

    expect(chatRows().map((row) => row.dataset.risuChatId)).toEqual(['chat-a', 'chat-b', 'chat-c'])
    expect(chatRows().map((row) => row.dataset.risuChatIdx)).toEqual(['0', '1', '2'])
    expectRowSelected('chat-b', true)
    expectRowSelected('chat-a', false)
    expectRowSelected('chat-c', false)
    expect(chatListMocks.watchServerBackedChatMetadata).toHaveBeenCalledOnce()
  })
  it('paints a chat rename before dispatching the update command', async () => {
    seedModalDatabase()
    chatListMocks.setServerCommandsEnabled(true)

    component = mount(ChatList, { target, props: { close: vi.fn() } })
    await tick()

    editButton().click()
    await tick()
    vi.clearAllMocks()

    const input = rowByChatId('chat-b').querySelector<HTMLInputElement>('input')
    expect(input, 'chat-b name input').toBeTruthy()
    input!.value = 'Renamed Modal Chat B'
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    input!.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()

    expect(chatListMocks.canUseServerCommands).toHaveBeenCalledOnce()
    expect(chatListMocks.withTrustedResourceWrite).toHaveBeenCalledOnce()
    expect(chatListMocks.syncServerBackedChatMetadataBaselines).toHaveBeenCalledOnce()
    expect(chatListMocks.dispatchUpdateChat).toHaveBeenCalledOnce()
    const [chatId, patch, previous] = chatListMocks.dispatchUpdateChat.mock.calls[0]
    expect(chatId).toBe('chat-b')
    expect(patch).toEqual({ name: 'Renamed Modal Chat B' })
    expect(chatListMocks.dispatchUpdateChat.mock.calls[0][4]).toBe(chatListMocks.rollbackServerBackedChatRowMetadata)
    expect(previous).toMatchObject({
      selectedCharID: 0,
      characters: [
        {
          chaId: 'char-a',
          chats: [{ name: 'Modal Chat A' }, { name: 'Modal Chat B' }, { name: 'Modal Chat C' }],
        },
      ],
    })
    expect(selectedCharacter().chats[1].name).toBe('Renamed Modal Chat B')
    expect(input!.value).toBe('Renamed Modal Chat B')
  })

  it('preserves an unsaved row draft when another chat rename repaints metadata', async () => {
    seedModalDatabase()
    chatListMocks.setServerCommandsEnabled(true)

    component = mount(ChatList, { target, props: { close: vi.fn() } })
    await tick()

    editButton().click()
    await tick()

    const pendingInput = rowByChatId('chat-c').querySelector<HTMLInputElement>('input')
    const committedInput = rowByChatId('chat-b').querySelector<HTMLInputElement>('input')
    expect(pendingInput, 'chat-c name input').toBeTruthy()
    expect(committedInput, 'chat-b name input').toBeTruthy()

    pendingInput!.value = 'Unsaved Modal Chat C'
    pendingInput!.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    committedInput!.value = 'Renamed Modal Chat B'
    committedInput!.dispatchEvent(new Event('input', { bubbles: true }))
    committedInput!.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()

    expect(selectedCharacter().chats[1].name).toBe('Renamed Modal Chat B')
    expect(rowByChatId('chat-c').querySelector<HTMLInputElement>('input')?.value).toBe('Unsaved Modal Chat C')
  })

  it('navigates when selecting a modal row and reflects the route-applied selection', async () => {
    const chara = seedModalDatabase()
    const close = vi.fn()

    component = mount(ChatList, { target, props: { close } })
    await tick()

    expectRowSelected('chat-b', true)

    rowByChatId('chat-c').click()
    await tick()

    expect(chatListMocks.navigate).toHaveBeenCalledWith('/character/char-a/chat-c')
    expect(chatListMocks.updateChatCommand).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
    expect(chara.chatPage).toBe(1)
    expectRowSelected('chat-b', true)
    expectRowSelected('chat-c', false)

    chara.chatPage = 2
    await tick()

    expectRowSelected('chat-b', false)
    expectRowSelected('chat-c', true)
  })

  it('optimistically selects a modal row through command fallback and restores on failure', async () => {
    const chara = seedModalDatabase()
    chara.chatPage = 0
    removeCharacterId(chara)
    chatListMocks.setServerCommandsEnabled(true)
    const command = chatListMocks.createDeferredSelectCommand()
    const close = vi.fn()

    component = mount(ChatList, { target, props: { close } })
    await tick()

    expectRowSelected('chat-a', true)
    expectRowSelected('chat-c', false)

    rowByChatId('chat-c').click()
    await tick()

    expect(chatListMocks.navigate).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
    expect(command.settled).toBe(false)
    expect(command.input).toMatchObject({
      chatId: 'chat-c',
      patch: {},
      select: true,
    })
    expect(chara.chatPage).toBe(2)
    expectRowSelected('chat-a', false)
    expectRowSelected('chat-c', true)

    command.resolve({ error: 'select failed', status: 'error' })
    await flushCommandWork()

    expect(chara.chatPage).toBe(0)
    expectRowSelected('chat-a', true)
    expectRowSelected('chat-c', false)
  })

  it('shows a newly created modal chat before the command resolves and closes', async () => {
    seedModalDatabase()
    chatListMocks.setServerCommandsEnabled(true)
    const command = chatListMocks.createDeferredCreateCommand()
    const close = vi.fn()

    component = mount(ChatList, { target, props: { close } })
    await tick()

    createButton().click()
    await tick()

    const chara = selectedCharacter()
    const createdChat = chara.chats[0]
    expect(command.settled).toBe(false)
    expect(createdChat.name).toBe('New Chat 4')
    expect(chara.chatPage).toBe(0)
    expectRowSelected(createdChat.id, true)
    expect(chatListMocks.navigate).toHaveBeenCalledWith(`/character/char-a/${createdChat.id}`)
    expect(command.input).toMatchObject({
      characterId: 'char-a',
      select: true,
    })
    expect(close).toHaveBeenCalledOnce()

    command.resolve({ revision: 11, status: 'ok' })
    await flushCommandWork()
  })

  it('rolls back a failed optimistic modal chat create in state and DOM', async () => {
    seedModalDatabase()
    chatListMocks.setServerCommandsEnabled(true)
    const command = chatListMocks.createDeferredCreateCommand()
    const close = vi.fn()

    component = mount(ChatList, { target, props: { close } })
    await tick()

    createButton().click()
    await tick()

    const createdChat = selectedCharacter().chats[0]
    expectRowSelected(createdChat.id, true)
    expect(selectedCharacter().chats.map((chat) => chat.name)).toEqual([
      'New Chat 4',
      'Modal Chat A',
      'Modal Chat B',
      'Modal Chat C',
    ])
    expect(close).toHaveBeenCalledOnce()

    command.resolve({ error: 'create failed', status: 'error' })
    await flushCommandWork()

    expect(chatRows().map((row) => row.dataset.risuChatId)).toEqual(['chat-a', 'chat-b', 'chat-c'])
    expect(selectedCharacter().chats.map((chat) => chat.name)).toEqual(['Modal Chat A', 'Modal Chat B', 'Modal Chat C'])
    expect(selectedCharacter().chatPage).toBe(1)
    expectRowSelected('chat-b', true)
    expect(target.textContent).not.toContain('New Chat 4')
  })

  it('removes a confirmed modal chat before the command resolves and restores on failure', async () => {
    seedModalDatabase()
    chatListMocks.setServerCommandsEnabled(true)
    chatListMocks.alertConfirm.mockResolvedValueOnce(true)
    const command = chatListMocks.createDeferredDeleteCommand()

    component = mount(ChatList, { target, props: { close: vi.fn() } })
    await tick()

    expectRowSelected('chat-b', true)

    deleteButtonForRow(rowByChatId('chat-b')).click()
    await flushCommandWork()

    expect(command.settled).toBe(false)
    expect(command.input).toMatchObject({ chatId: 'chat-b' })
    expect(selectedCharacter().chats.map((chat) => chat.name)).toEqual(['Modal Chat A', 'Modal Chat C'])
    expect(selectedCharacter().chatPage).toBe(1)
    expect(target.textContent).not.toContain('Modal Chat B')
    expectRowSelected('chat-c', true)
    expect(chatListMocks.navigate).toHaveBeenCalledWith('/character/char-a/chat-c', {
      replace: true,
    })

    command.resolve({ error: 'delete failed', status: 'error' })
    await flushCommandWork()

    expect(selectedCharacter().chats.map((chat) => chat.name)).toEqual(['Modal Chat A', 'Modal Chat B', 'Modal Chat C'])
    expect(selectedCharacter().chatPage).toBe(1)
    expect(chatRows().map((row) => row.dataset.risuChatId)).toEqual(['chat-a', 'chat-b', 'chat-c'])
    expectRowSelected('chat-b', true)
  })

  it('deletes the originally targeted modal chat when selection changes during confirm', async () => {
    const charA = seedModalDatabase()
    const charB = {
      ...charA,
      chaId: 'char-b',
      name: 'Other Character',
      chatPage: 0,
      chats: [makeChat('other-chat-a', 'Other Chat A'), makeChat('other-chat-b', 'Other Chat B')],
      chatFolders: [],
    } as character
    getDatabase().characters.push(charB)
    chatListMocks.setServerCommandsEnabled(true)
    let resolveConfirm!: (confirmed: boolean) => void
    chatListMocks.alertConfirm.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        resolveConfirm = resolve
      }),
    )
    const command = chatListMocks.createDeferredDeleteCommand()

    component = mount(ChatList, { target, props: { close: vi.fn() } })
    await tick()

    deleteButtonForRow(rowByChatId('chat-b')).click()
    await tick()

    selectedCharID.set(1)
    await tick()
    expect(chatRows().map((row) => row.dataset.risuChatId)).toEqual(['other-chat-a', 'other-chat-b'])

    resolveConfirm(true)
    await flushCommandWork()

    expect(command.settled).toBe(false)
    expect(command.input).toMatchObject({ chatId: 'chat-b' })
    expect(charA.chats.map((chat) => chat.id)).toEqual(['chat-a', 'chat-c'])
    expect(charB.chats.map((chat) => chat.id)).toEqual(['other-chat-a', 'other-chat-b'])
    expect(get(selectedCharID)).toBe(1)
    expect(chatListMocks.navigate).not.toHaveBeenCalled()
    expect(chatListMocks.changeChatTo).not.toHaveBeenCalled()

    command.resolve({ revision: 11, status: 'ok' })
    await flushCommandWork()
  })

  it('reports the one-chat modal delete guard and leaves the row unchanged', async () => {
    const chara = seedModalDatabase()
    chara.chatPage = 0
    chara.chats = [makeChat('chat-only', 'Only Chat')]
    chatListMocks.setServerCommandsEnabled(true)

    component = mount(ChatList, { target, props: { close: vi.fn() } })
    await tick()

    deleteButtonForRow(rowByChatId('chat-only')).click()
    await tick()

    expect(chatListMocks.alertError).toHaveBeenCalledWith('Only one chat')
    expect(chatListMocks.alertConfirm).not.toHaveBeenCalled()
    expect(chatListMocks.deleteChatCommand).not.toHaveBeenCalled()
    expect(selectedCharacter().chats.map((chat) => chat.name)).toEqual(['Only Chat'])
    expect(selectedCharacter().chatPage).toBe(0)
    expect(chatRows().map((row) => row.dataset.risuChatId)).toEqual(['chat-only'])
    expectRowSelected('chat-only', true)
  })
})
