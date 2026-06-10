import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sidebarMocks = vi.hoisted(() => {
  type DeferredCommand = {
    input?: unknown
    promise: Promise<unknown>
    reject: (reason?: unknown) => void
    resolve: (value: unknown) => void
    settled: boolean
  }

  class SortableMock {
    static create = vi.fn(
      (element: Element, options: unknown) => new SortableMock(element, options),
    )

    element: Element
    options: unknown
    destroy = vi.fn()

    constructor(element: Element, options: unknown) {
      this.element = element
      this.options = options
    }
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
    SortableMock,
    alertChatOptions: vi.fn(),
    alertConfirm: vi.fn(async () => false),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(async () => '0'),
    appendMessageCommand: unusedCommand,
    changeChatTo: vi.fn(),
    canUseServerCommands: vi.fn(() => serverCommandsEnabled),
    createChatCommand: vi.fn((input: unknown) => {
      if (!pendingCreateCommand) {
        throw new Error('No deferred create-chat command was prepared')
      }
      pendingCreateCommand.input = input
      return pendingCreateCommand.promise
    }),
    createDeferredCreateCommand,
    createDeferredDeleteCommand,
    createDeferredSelectCommand,
    createChatCopyName: vi.fn((name: string, suffix: string) => `${name} ${suffix}`),
    createChatFolderCommand: unusedCommand,
    deleteChatCommand: vi.fn((input: unknown) => {
      if (!pendingDeleteCommand) {
        throw new Error('No deferred delete-chat command was prepared')
      }
      pendingDeleteCommand.input = input
      return pendingDeleteCommand.promise
    }),
    deleteChatFolderCommand: unusedCommand,
    deleteMessageCommand: unusedCommand,
    dispatchCreateChatFolder: vi.fn(),
    dispatchDeleteChatFolder: vi.fn(),
    dispatchForkChat: vi.fn(),
    dispatchReorderChats: vi.fn(),
    dispatchReorderChatsByIds: vi.fn(),
    dispatchUpdateChat: vi.fn(),
    dispatchUpdateChatFolder: vi.fn(),
    exportAllChats: vi.fn(),
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
    runOptimisticCommandSequence: vi.fn(),
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
    watchServerBackedChatMetadata: vi.fn(() => vi.fn()),
  }
})

vi.mock('sortablejs/modular/sortable.core.esm.js', () => ({
  default: sidebarMocks.SortableMock,
}))

vi.mock('src/lang', () => ({
  language: {
    cancel: 'Cancel',
    changeFolderColor: 'Change folder color',
    doYouWantToBindCurrentPersona: 'Bind persona?',
    doYouWantToUnbindCurrentPersona: 'Unbind persona?',
    errors: { onlyOneChat: 'Only one chat' },
    newChat: 'New Chat',
    personaBindedSuccess: 'Persona bound',
    personaUnbindedSuccess: 'Persona unbound',
    removeConfirm: 'Remove ',
  },
}))

vi.mock('src/ts/alert', () => ({
  alertChatOptions: sidebarMocks.alertChatOptions,
  alertConfirm: sidebarMocks.alertConfirm,
  alertError: sidebarMocks.alertError,
  alertNormal: sidebarMocks.alertNormal,
  alertSelect: sidebarMocks.alertSelect,
}))

vi.mock('src/ts/characters', () => ({
  exportAllChats: sidebarMocks.exportAllChats,
  exportChat: sidebarMocks.exportChat,
  importChat: sidebarMocks.importChat,
}))

vi.mock('src/ts/chatCommands', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/chatCommands')>()
  return {
    ...actual,
    dispatchCreateChatFolder: sidebarMocks.dispatchCreateChatFolder,
    dispatchDeleteChatFolder: sidebarMocks.dispatchDeleteChatFolder,
    dispatchForkChat: sidebarMocks.dispatchForkChat,
    dispatchReorderChats: sidebarMocks.dispatchReorderChats,
    dispatchReorderChatsByIds: sidebarMocks.dispatchReorderChatsByIds,
    dispatchUpdateChat: sidebarMocks.dispatchUpdateChat,
    dispatchUpdateChatFolder: sidebarMocks.dispatchUpdateChatFolder,
    runOptimisticCommandSequence: sidebarMocks.runOptimisticCommandSequence,
  }
})

vi.mock('src/ts/globalApi.svelte', () => ({
  changeChatTo: sidebarMocks.changeChatTo,
  createChatCopyName: sidebarMocks.createChatCopyName,
  downloadFile: vi.fn(),
  saveAsset: vi.fn(async () => ''),
}))

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: () => [],
  getModuleLorebooks: () => [],
  getModuleRegexScripts: () => [],
  getModules: () => [],
  getModuleTriggers: () => [],
  getModuleToggles: () => '',
  moduleUpdate: vi.fn(),
}))

vi.mock('src/ts/process/scripts', () => ({
  resetScriptCache: vi.fn(),
}))

vi.mock('src/ts/router', () => ({
  characterRoutePath: (characterId: string, chatId?: string) =>
    chatId ? `/character/${characterId}/${chatId}` : `/character/${characterId}`,
  navigate: sidebarMocks.navigate,
}))

vi.mock('src/ts/server/chatBridge.svelte', () => ({
  watchServerBackedChatMetadata: sidebarMocks.watchServerBackedChatMetadata,
}))

vi.mock('src/ts/server/chatMessageHydration.svelte', () => ({
  ensureAllChatsHydrated: vi.fn(async () => undefined),
}))

vi.mock('src/ts/server/commands', () => ({
  appendMessageCommand: sidebarMocks.appendMessageCommand,
  canUseServerCommands: sidebarMocks.canUseServerCommands,
  createChatCommand: sidebarMocks.createChatCommand,
  createChatFolderCommand: sidebarMocks.createChatFolderCommand,
  deleteChatCommand: sidebarMocks.deleteChatCommand,
  deleteChatFolderCommand: sidebarMocks.deleteChatFolderCommand,
  deleteMessageCommand: sidebarMocks.deleteMessageCommand,
  forkChatCommand: sidebarMocks.forkChatCommand,
  patchChatScriptstateCommand: sidebarMocks.patchChatScriptstateCommand,
  reorderChatFoldersCommand: sidebarMocks.reorderChatFoldersCommand,
  reorderChatsCommand: sidebarMocks.reorderChatsCommand,
  replaceMessagesCommand: sidebarMocks.replaceMessagesCommand,
  runServerCommand: sidebarMocks.runServerCommand,
  truncateMessagesCommand: sidebarMocks.truncateMessagesCommand,
  updateChatCommand: sidebarMocks.updateChatCommand,
  updateChatFolderCommand: sidebarMocks.updateChatFolderCommand,
  updateMessageCommand: sidebarMocks.updateMessageCommand,
}))

vi.mock('./Toggles.svelte', async () => {
  const mock = await import('./SideChatList.testToggles.svelte')
  return { default: mock.default }
})

import SideChatListHarness from './SideChatList.testHarness.svelte'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import type { Chat, character } from 'src/ts/storage/database.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

function makeChat(id: string, name: string, folderId: string | null = null): Chat {
  return {
    id,
    name,
    folderId,
    message: [],
    localLore: [],
    fmIndex: -1,
    note: '',
  } as Chat
}

function seedSidebarDatabase(): character {
  const chara = {
    chaId: 'char-a',
    name: 'Harness Character',
    chatPage: 1,
    chats: [
      makeChat('chat-root-a', 'Root Chat A'),
      makeChat('chat-foldered', 'Foldered Chat', 'folder-a'),
      makeChat('chat-root-b', 'Root Chat B'),
    ],
    chatFolders: [{ id: 'folder-a', name: 'Pinned Folder', folded: false }],
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
    customPromptTemplateToggle: '',
    customSidebarItems: [],
    enabledModules: [],
    hypaV3: false,
    jailbreak: '',
    modules: [],
    personas: [],
    promptTemplate: [],
    selectedPersona: 0,
    username: 'User',
  } as never

  return DBState.db.characters[0]
}

function chatRows(): HTMLButtonElement[] {
  return Array.from(target.querySelectorAll<HTMLButtonElement>('button[data-risu-chat-idx]'))
}

function rowByText(text: string): HTMLButtonElement {
  const row = chatRows().find((candidate) => candidate.textContent?.includes(text))
  expect(row, `chat row ${text}`).toBeTruthy()
  return row!
}

function createButton(): HTMLButtonElement {
  const button = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.trim() === 'New Chat',
  )
  expect(button, 'create chat button').toBeTruthy()
  return button!
}

function rowActionButton(row: HTMLElement, actionIndex: number): HTMLElement {
  const actions = Array.from(row.querySelectorAll<HTMLElement>('[role="button"]'))
  const action = actions[actionIndex]
  expect(action, `chat row action ${actionIndex}`).toBeTruthy()
  return action!
}

function editButtonForRow(row: HTMLElement): HTMLElement {
  return rowActionButton(row, 1)
}

function deleteButtonForRow(row: HTMLElement): HTMLElement {
  return rowActionButton(row, row.querySelectorAll<HTMLElement>('[role="button"]').length - 1)
}

function folderHeader(folder: HTMLElement): HTMLButtonElement {
  const header = Array.from(folder.children).find(
    (child): child is HTMLButtonElement => child instanceof HTMLButtonElement,
  )
  expect(header, 'folder header').toBeTruthy()
  return header!
}

function folderElementByText(text: string): HTMLElement {
  const folder = Array.from(
    target.querySelectorAll<HTMLElement>('[data-risu-chat-folder-idx]'),
  ).find((candidate) => folderHeader(candidate).textContent?.includes(text))
  expect(folder, `folder row ${text}`).toBeTruthy()
  return folder!
}

function folderChatContainer(folder: HTMLElement): HTMLElement {
  const container = Array.from(folder.children).find(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.classList.contains('risu-chat'),
  )
  expect(container, 'folder chat container').toBeTruthy()
  return container!
}

function inputByValue(value: string): HTMLInputElement {
  const input = Array.from(target.querySelectorAll<HTMLInputElement>('input')).find(
    (candidate) => candidate.value === value,
  )
  expect(input, `input with value ${value}`).toBeTruthy()
  return input!
}

async function setTextInputValue(input: HTMLInputElement, value: string): Promise<void> {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()
}

function selectedCharacter(): character {
  return DBState.db.characters[0]
}

function removeCharacterId(chara: character): void {
  ;(chara as { chaId?: string }).chaId = undefined
}

async function flushCommandWork(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await tick()
}

describe('SideChatList DOM contract harness', () => {
  beforeEach(() => {
    target = document.createElement('div')
    document.body.appendChild(target)
    sidebarMocks.resetCommandHarness()
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

  it('renders seeded root and folder chat rows with the selected row class', async () => {
    seedSidebarDatabase()

    component = mount(SideChatListHarness, { target })
    await tick()

    expect(chatRows().map((row) => row.textContent?.trim())).toEqual([
      'Foldered Chat',
      'Root Chat A',
      'Root Chat B',
    ])
    expect(rowByText('Foldered Chat').dataset.risuChatIdx).toBe('1')
    expect(rowByText('Foldered Chat').classList.contains('bg-selected')).toBe(true)
    expect(rowByText('Root Chat A').classList.contains('bg-selected')).toBe(false)
    expect(rowByText('Root Chat B').classList.contains('bg-selected')).toBe(false)
    expect(sidebarMocks.watchServerBackedChatMetadata).toHaveBeenCalledOnce()
  })

  it('keeps foldered chat row indexes tied to original chat positions', async () => {
    const chara = seedSidebarDatabase()
    chara.chats.push(makeChat('chat-foldered-second', 'Second Foldered Chat', 'folder-a'))

    component = mount(SideChatListHarness, { target })
    await tick()

    expect(
      chatRows().map((row) => ({
        index: row.dataset.risuChatIdx,
        text: row.textContent?.trim(),
      })),
    ).toEqual([
      { index: '1', text: 'Foldered Chat' },
      { index: '3', text: 'Second Foldered Chat' },
      { index: '0', text: 'Root Chat A' },
      { index: '2', text: 'Root Chat B' },
    ])
  })

  it('hides folded folder rows without losing selected chat state', async () => {
    const chara = seedSidebarDatabase()
    chara.chatFolders[0].folded = true
    chara.chatPage = 1

    component = mount(SideChatListHarness, { target })
    await tick()

    const folder = folderElementByText('Pinned Folder')
    const folderRows = folderChatContainer(folder)
    const selectedRow = rowByText('Foldered Chat')

    expect(folderRows.classList.contains('hidden')).toBe(true)
    expect(chara.chatPage).toBe(1)
    expect(chara.chats[chara.chatPage]?.id).toBe('chat-foldered')
    expect(selectedRow.dataset.risuChatIdx).toBe('1')
    expect(selectedRow.classList.contains('bg-selected')).toBe(true)
    expect(rowByText('Root Chat A').classList.contains('bg-selected')).toBe(false)
    expect(rowByText('Root Chat B').classList.contains('bg-selected')).toBe(false)
  })

  it('dispatches chat and folder rename commands with stable ids from edit mode', async () => {
    seedSidebarDatabase()
    sidebarMocks.setServerCommandsEnabled(true)

    component = mount(SideChatListHarness, { target })
    await tick()

    editButtonForRow(rowByText('Foldered Chat')).click()
    await tick()

    const chatNameInput = inputByValue('Foldered Chat')
    const folderNameInput = inputByValue('Pinned Folder')

    await setTextInputValue(chatNameInput, 'Renamed Foldered Chat')
    await setTextInputValue(folderNameInput, 'Renamed Folder')

    expect(sidebarMocks.dispatchUpdateChat).toHaveBeenCalledWith(
      'chat-foldered',
      { name: 'Renamed Foldered Chat' },
      expect.any(Object),
    )
    expect(sidebarMocks.dispatchUpdateChatFolder).toHaveBeenCalledWith(
      'folder-a',
      { name: 'Renamed Folder' },
      expect.any(Object),
    )
  })

  it('dispatches folder folded toggles with the folder stable id', async () => {
    const chara = seedSidebarDatabase()
    sidebarMocks.setServerCommandsEnabled(true)

    component = mount(SideChatListHarness, { target })
    await tick()

    folderHeader(folderElementByText('Pinned Folder')).click()
    await tick()

    expect(sidebarMocks.dispatchUpdateChatFolder).toHaveBeenCalledWith(
      'folder-a',
      { folded: true },
      expect.any(Object),
    )
    expect(chara.chatFolders[0].folded).toBe(false)
  })

  it('navigates when selecting a sidebar row and reflects the route-applied selection', async () => {
    const chara = seedSidebarDatabase()

    component = mount(SideChatListHarness, { target })
    await tick()

    expect(rowByText('Foldered Chat').classList.contains('bg-selected')).toBe(true)

    rowByText('Root Chat B').click()
    await tick()

    expect(sidebarMocks.navigate).toHaveBeenCalledWith('/character/char-a/chat-root-b')
    expect(sidebarMocks.updateChatCommand).not.toHaveBeenCalled()
    expect(chara.chatPage).toBe(1)
    expect(rowByText('Foldered Chat').classList.contains('bg-selected')).toBe(true)
    expect(rowByText('Root Chat B').classList.contains('bg-selected')).toBe(false)

    chara.chatPage = 2
    await tick()

    expect(rowByText('Foldered Chat').classList.contains('bg-selected')).toBe(false)
    expect(rowByText('Root Chat B').classList.contains('bg-selected')).toBe(true)
  })

  it('optimistically selects a sidebar row through command fallback and restores on failure', async () => {
    const chara = seedSidebarDatabase()
    chara.chatPage = 0
    removeCharacterId(chara)
    sidebarMocks.setServerCommandsEnabled(true)
    const command = sidebarMocks.createDeferredSelectCommand()

    component = mount(SideChatListHarness, { target })
    await tick()

    expect(rowByText('Root Chat A').classList.contains('bg-selected')).toBe(true)
    expect(rowByText('Root Chat B').classList.contains('bg-selected')).toBe(false)

    rowByText('Root Chat B').click()
    await tick()

    expect(sidebarMocks.navigate).not.toHaveBeenCalled()
    expect(command.settled).toBe(false)
    expect(command.input).toMatchObject({
      chatId: 'chat-root-b',
      patch: {},
      select: true,
    })
    expect(chara.chatPage).toBe(2)
    expect(rowByText('Root Chat A').classList.contains('bg-selected')).toBe(false)
    expect(rowByText('Root Chat B').classList.contains('bg-selected')).toBe(true)

    command.resolve({ error: 'select failed', status: 'error' })
    await flushCommandWork()

    expect(chara.chatPage).toBe(0)
    expect(rowByText('Root Chat A').classList.contains('bg-selected')).toBe(true)
    expect(rowByText('Root Chat B').classList.contains('bg-selected')).toBe(false)
  })

  it('shows a newly created sidebar chat before the command resolves', async () => {
    seedSidebarDatabase()
    sidebarMocks.setServerCommandsEnabled(true)
    const command = sidebarMocks.createDeferredCreateCommand()

    component = mount(SideChatListHarness, { target })
    await tick()

    createButton().click()
    await tick()

    const chara = selectedCharacter()
    const createdChat = chara.chats[0]
    expect(command.settled).toBe(false)
    expect(createdChat.name).toBe('New Chat 4')
    expect(chara.chatPage).toBe(0)
    expect(rowByText('New Chat 4').classList.contains('bg-selected')).toBe(true)
    expect(sidebarMocks.navigate).toHaveBeenCalledWith(`/character/char-a/${createdChat.id}`)
    expect(command.input).toMatchObject({
      characterId: 'char-a',
      select: true,
    })

    command.resolve({ revision: 11, status: 'ok' })
    await flushCommandWork()
  })

  it('rolls back a failed optimistic sidebar chat create in state and DOM', async () => {
    seedSidebarDatabase()
    sidebarMocks.setServerCommandsEnabled(true)
    const command = sidebarMocks.createDeferredCreateCommand()

    component = mount(SideChatListHarness, { target })
    await tick()

    createButton().click()
    await tick()

    expect(rowByText('New Chat 4').classList.contains('bg-selected')).toBe(true)
    expect(selectedCharacter().chats.map((chat) => chat.name)).toEqual([
      'New Chat 4',
      'Root Chat A',
      'Foldered Chat',
      'Root Chat B',
    ])

    command.resolve({ error: 'create failed', status: 'error' })
    await flushCommandWork()

    expect(chatRows().map((row) => row.textContent?.trim())).toEqual([
      'Foldered Chat',
      'Root Chat A',
      'Root Chat B',
    ])
    expect(selectedCharacter().chats.map((chat) => chat.name)).toEqual([
      'Root Chat A',
      'Foldered Chat',
      'Root Chat B',
    ])
    expect(selectedCharacter().chatPage).toBe(1)
    expect(rowByText('Foldered Chat').classList.contains('bg-selected')).toBe(true)
    expect(target.textContent).not.toContain('New Chat 4')
  })

  it('removes a confirmed root sidebar chat before the delete command resolves', async () => {
    const chara = seedSidebarDatabase()
    chara.chatPage = 2
    sidebarMocks.setServerCommandsEnabled(true)
    sidebarMocks.alertConfirm.mockResolvedValueOnce(true)
    const command = sidebarMocks.createDeferredDeleteCommand()

    component = mount(SideChatListHarness, { target })
    await tick()

    expect(rowByText('Root Chat B').classList.contains('bg-selected')).toBe(true)

    deleteButtonForRow(rowByText('Root Chat B')).click()
    await flushCommandWork()

    expect(command.settled).toBe(false)
    expect(command.input).toMatchObject({ chatId: 'chat-root-b' })
    expect(selectedCharacter().chats.map((chat) => chat.name)).toEqual([
      'Root Chat A',
      'Foldered Chat',
    ])
    expect(selectedCharacter().chatPage).toBe(1)
    expect(target.textContent).not.toContain('Root Chat B')
    expect(rowByText('Foldered Chat').classList.contains('bg-selected')).toBe(true)
    expect(sidebarMocks.navigate).toHaveBeenCalledWith('/character/char-a/chat-foldered', {
      replace: true,
    })

    command.resolve({ revision: 12, status: 'ok' })
    await flushCommandWork()
  })

  it('restores a failed optimistic foldered sidebar chat delete in state and DOM', async () => {
    seedSidebarDatabase()
    sidebarMocks.setServerCommandsEnabled(true)
    sidebarMocks.alertConfirm.mockResolvedValueOnce(true)
    const command = sidebarMocks.createDeferredDeleteCommand()

    component = mount(SideChatListHarness, { target })
    await tick()

    expect(rowByText('Foldered Chat').classList.contains('bg-selected')).toBe(true)

    deleteButtonForRow(rowByText('Foldered Chat')).click()
    await flushCommandWork()

    expect(command.settled).toBe(false)
    expect(command.input).toMatchObject({ chatId: 'chat-foldered' })
    expect(selectedCharacter().chats.map((chat) => chat.name)).toEqual([
      'Root Chat A',
      'Root Chat B',
    ])
    expect(selectedCharacter().chatPage).toBe(1)
    expect(target.textContent).not.toContain('Foldered Chat')
    expect(rowByText('Root Chat B').classList.contains('bg-selected')).toBe(true)

    command.resolve({ error: 'delete failed', status: 'error' })
    await flushCommandWork()

    expect(selectedCharacter().chats.map((chat) => chat.name)).toEqual([
      'Root Chat A',
      'Foldered Chat',
      'Root Chat B',
    ])
    expect(selectedCharacter().chatPage).toBe(1)
    expect(chatRows().map((row) => row.textContent?.trim())).toEqual([
      'Foldered Chat',
      'Root Chat A',
      'Root Chat B',
    ])
    expect(rowByText('Foldered Chat').classList.contains('bg-selected')).toBe(true)
  })

  it('reports the one-chat sidebar delete guard and leaves the row unchanged', async () => {
    const chara = seedSidebarDatabase()
    chara.chatPage = 0
    chara.chatFolders = []
    chara.chats = [makeChat('chat-only', 'Only Chat')]
    sidebarMocks.setServerCommandsEnabled(true)

    component = mount(SideChatListHarness, { target })
    await tick()

    deleteButtonForRow(rowByText('Only Chat')).click()
    await tick()

    expect(sidebarMocks.alertError).toHaveBeenCalledWith('Only one chat')
    expect(sidebarMocks.alertConfirm).not.toHaveBeenCalled()
    expect(sidebarMocks.deleteChatCommand).not.toHaveBeenCalled()
    expect(selectedCharacter().chats.map((chat) => chat.name)).toEqual(['Only Chat'])
    expect(selectedCharacter().chatPage).toBe(0)
    expect(chatRows().map((row) => row.textContent?.trim())).toEqual(['Only Chat'])
    expect(rowByText('Only Chat').classList.contains('bg-selected')).toBe(true)
  })
})
