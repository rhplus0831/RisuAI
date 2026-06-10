import { mount, tick, unmount } from 'svelte'
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
    updateChatCommand: unusedCommand,
    updateChatFolderCommand: unusedCommand,
    updateMessageCommand: unusedCommand,
    watchServerBackedChatMetadata: vi.fn(() => vi.fn()),
    withTrustedServerProjectionWrite: vi.fn((callback: () => void) => callback()),
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

vi.mock('src/ts/server/projectionWriteGuard.svelte', () => ({
  withTrustedServerProjectionWrite: chatListMocks.withTrustedServerProjectionWrite,
}))

import ChatList from './ChatList.svelte'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
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
    chats: [
      makeChat('chat-a', 'Modal Chat A'),
      makeChat('chat-b', 'Modal Chat B'),
      makeChat('chat-c', 'Modal Chat C'),
    ],
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
  DBState.db = {
    characters: [chara],
    enabledModules: [],
    modules: [],
  } as never

  return DBState.db.characters[0]
}

function chatRows(): HTMLButtonElement[] {
  return Array.from(target.querySelectorAll<HTMLButtonElement>('button')).filter(
    (button) =>
      Boolean(button.querySelector('span')) &&
      button.classList.contains('items-center') &&
      button.classList.contains('border-t-1'),
  )
}

function rowByText(text: string): HTMLButtonElement {
  const row = chatRows().find((candidate) => candidate.textContent?.includes(text))
  expect(row, `chat row ${text}`).toBeTruthy()
  return row!
}

function createButton(): HTMLButtonElement {
  const button = target.querySelector<HTMLButtonElement>('div.flex.mt-2.items-center > button')
  expect(button, 'create chat button').toBeTruthy()
  return button!
}

function deleteButtonForRow(row: HTMLElement): HTMLElement {
  const actions = Array.from(row.querySelectorAll<HTMLElement>('[role="button"]'))
  const action = actions[actions.length - 1]
  expect(action, 'delete chat action').toBeTruthy()
  return action!
}

function selectedCharacter(): character {
  return DBState.db.characters[0]
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
  })

  afterEach(() => {
    if (component) {
      unmount(component)
      component = undefined
    }
    target.remove()
    document.body.innerHTML = ''
    selectedCharID.set(-1)
    DBState.db = {} as never
  })

  it('renders seeded chat rows with the selected row class', async () => {
    seedModalDatabase()

    component = mount(ChatList, { target, props: { close: vi.fn() } })
    await tick()

    expect(chatRows().map((row) => row.textContent?.trim())).toEqual([
      'Modal Chat A',
      'Modal Chat B',
      'Modal Chat C',
    ])
    expect(rowByText('Modal Chat B').classList.contains('bg-selected')).toBe(true)
    expect(rowByText('Modal Chat A').classList.contains('bg-selected')).toBe(false)
    expect(rowByText('Modal Chat C').classList.contains('bg-selected')).toBe(false)
    expect(chatListMocks.watchServerBackedChatMetadata).toHaveBeenCalledOnce()
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
    expect(rowByText('New Chat 4').classList.contains('bg-selected')).toBe(true)
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

    expect(rowByText('New Chat 4').classList.contains('bg-selected')).toBe(true)
    expect(selectedCharacter().chats.map((chat) => chat.name)).toEqual([
      'New Chat 4',
      'Modal Chat A',
      'Modal Chat B',
      'Modal Chat C',
    ])
    expect(close).toHaveBeenCalledOnce()

    command.resolve({ error: 'create failed', status: 'error' })
    await flushCommandWork()

    expect(chatRows().map((row) => row.textContent?.trim())).toEqual([
      'Modal Chat A',
      'Modal Chat B',
      'Modal Chat C',
    ])
    expect(selectedCharacter().chats.map((chat) => chat.name)).toEqual([
      'Modal Chat A',
      'Modal Chat B',
      'Modal Chat C',
    ])
    expect(selectedCharacter().chatPage).toBe(1)
    expect(rowByText('Modal Chat B').classList.contains('bg-selected')).toBe(true)
    expect(target.textContent).not.toContain('New Chat 4')
  })

  it('removes a confirmed modal chat before the command resolves and restores on failure', async () => {
    seedModalDatabase()
    chatListMocks.setServerCommandsEnabled(true)
    chatListMocks.alertConfirm.mockResolvedValueOnce(true)
    const command = chatListMocks.createDeferredDeleteCommand()

    component = mount(ChatList, { target, props: { close: vi.fn() } })
    await tick()

    expect(rowByText('Modal Chat B').classList.contains('bg-selected')).toBe(true)

    deleteButtonForRow(rowByText('Modal Chat B')).click()
    await flushCommandWork()

    expect(command.settled).toBe(false)
    expect(command.input).toMatchObject({ chatId: 'chat-b' })
    expect(selectedCharacter().chats.map((chat) => chat.name)).toEqual([
      'Modal Chat A',
      'Modal Chat C',
    ])
    expect(selectedCharacter().chatPage).toBe(1)
    expect(target.textContent).not.toContain('Modal Chat B')
    expect(rowByText('Modal Chat C').classList.contains('bg-selected')).toBe(true)
    expect(chatListMocks.navigate).toHaveBeenCalledWith('/character/char-a/chat-c', {
      replace: true,
    })

    command.resolve({ error: 'delete failed', status: 'error' })
    await flushCommandWork()

    expect(selectedCharacter().chats.map((chat) => chat.name)).toEqual([
      'Modal Chat A',
      'Modal Chat B',
      'Modal Chat C',
    ])
    expect(selectedCharacter().chatPage).toBe(1)
    expect(chatRows().map((row) => row.textContent?.trim())).toEqual([
      'Modal Chat A',
      'Modal Chat B',
      'Modal Chat C',
    ])
    expect(rowByText('Modal Chat B').classList.contains('bg-selected')).toBe(true)
  })

  it('reports the one-chat modal delete guard and leaves the row unchanged', async () => {
    const chara = seedModalDatabase()
    chara.chatPage = 0
    chara.chats = [makeChat('chat-only', 'Only Chat')]
    chatListMocks.setServerCommandsEnabled(true)

    component = mount(ChatList, { target, props: { close: vi.fn() } })
    await tick()

    deleteButtonForRow(rowByText('Only Chat')).click()
    await tick()

    expect(chatListMocks.alertError).toHaveBeenCalledWith('Only one chat')
    expect(chatListMocks.alertConfirm).not.toHaveBeenCalled()
    expect(chatListMocks.deleteChatCommand).not.toHaveBeenCalled()
    expect(selectedCharacter().chats.map((chat) => chat.name)).toEqual(['Only Chat'])
    expect(selectedCharacter().chatPage).toBe(0)
    expect(chatRows().map((row) => row.textContent?.trim())).toEqual(['Only Chat'])
    expect(rowByText('Only Chat').classList.contains('bg-selected')).toBe(true)
  })
})
