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
    static instances: SortableMock[] = []
    static create = vi.fn((element: Element, options: unknown) => new SortableMock(element, options))

    element: Element
    options: unknown
    destroy = vi.fn()

    constructor(element: Element, options: unknown) {
      this.element = element
      this.options = options
      SortableMock.instances.push(this)
    }
  }

  let serverCommandsEnabled = false
  let pendingCreateCommand: DeferredCommand | undefined
  let pendingCreateFolderCommand: DeferredCommand | undefined
  let pendingDeleteCommand: DeferredCommand | undefined
  let pendingSelectCommand: DeferredCommand | undefined
  let pendingUpdateCommand: DeferredCommand | undefined

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

  function createDeferredCreateFolderCommand(): DeferredCommand {
    pendingCreateFolderCommand = createDeferredCommand()
    return pendingCreateFolderCommand
  }

  function createDeferredDeleteCommand(): DeferredCommand {
    pendingDeleteCommand = createDeferredCommand()
    return pendingDeleteCommand
  }

  function createDeferredSelectCommand(): DeferredCommand {
    pendingSelectCommand = createDeferredCommand()
    return pendingSelectCommand
  }

  function createDeferredUpdateCommand(): DeferredCommand {
    pendingUpdateCommand = createDeferredCommand()
    return pendingUpdateCommand
  }

  function okCommandResult() {
    return {
      revision: 1,
      status: 'ok',
    }
  }

  const unusedCommand = vi.fn(async () => okCommandResult())
  const currentRouteSubscribers = new Set<(value: unknown) => void>()
  let currentRouteValue: unknown = {
    kind: 'character',
    path: '/character/char-a',
    chaId: 'char-a',
  }

  const currentRoute = {
    subscribe(run: (value: unknown) => void) {
      run(currentRouteValue)
      currentRouteSubscribers.add(run)
      return () => {
        currentRouteSubscribers.delete(run)
      }
    },
  }

  function setCurrentRoute(value: unknown): void {
    currentRouteValue = value
    currentRouteSubscribers.forEach((run) => run(value))
  }

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
    createDeferredCreateFolderCommand,
    createDeferredDeleteCommand,
    createDeferredSelectCommand,
    createDeferredUpdateCommand,
    createChatCopyName: vi.fn((name: string, suffix: string) => `${name} ${suffix}`),
    currentRoute,
    createChatFolderCommand: vi.fn((input: unknown) => {
      if (!pendingCreateFolderCommand) {
        throw new Error('No deferred create-folder command was prepared')
      }
      pendingCreateFolderCommand.input = input
      return pendingCreateFolderCommand.promise
    }),
    deleteChatCommand: vi.fn((input: unknown) => {
      if (!pendingDeleteCommand) {
        throw new Error('No deferred delete-chat command was prepared')
      }
      pendingDeleteCommand.input = input
      return pendingDeleteCommand.promise
    }),
    deleteChatFolderCommand: unusedCommand,
    deleteMessageCommand: unusedCommand,
    dispatchDeleteChatFolder: vi.fn(),
    dispatchForkChat: vi.fn(),
    dispatchReorderChatFoldersAndChatsByIds: vi.fn(),
    dispatchReorderChats: vi.fn(),
    dispatchReorderChatsByIds: vi.fn(),
    dispatchUpdateChat: vi.fn(),
    dispatchUpdateChatFolder: vi.fn(),
    exportAllChats: vi.fn(),
    exportChat: vi.fn(),
    forkChatCommand: unusedCommand,
    hydrateChatMessages: vi.fn(async (_chatId: string, _options?: { strict?: boolean }) => undefined),
    importChat: vi.fn(),
    navigate: vi.fn(),
    patchChatScriptstateCommand: unusedCommand,
    reorderChatFoldersCommand: unusedCommand,
    reorderChatsCommand: unusedCommand,
    replaceMessagesCommand: unusedCommand,
    resetCommandHarness: () => {
      pendingCreateCommand = undefined
      pendingCreateFolderCommand = undefined
      pendingDeleteCommand = undefined
      pendingSelectCommand = undefined
      pendingUpdateCommand = undefined
      SortableMock.instances = []
      serverCommandsEnabled = false
      setCurrentRoute({
        kind: 'character',
        path: '/character/char-a',
        chaId: 'char-a',
      })
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
    rollbackServerBackedChatFolderRowMetadata: vi.fn(),
    rollbackServerBackedChatRowMetadata: vi.fn(),
    syncServerBackedChatMetadataBaselines: vi.fn(),
    setCurrentRoute,
    truncateMessagesCommand: unusedCommand,
    updateChatCommand: vi.fn((input: unknown) => {
      if ((input as { select?: boolean }).select) {
        if (!pendingSelectCommand) {
          throw new Error('No deferred select-chat command was prepared')
        }
        pendingSelectCommand.input = input
        return pendingSelectCommand.promise
      }
      if (pendingUpdateCommand) {
        pendingUpdateCommand.input = input
        return pendingUpdateCommand.promise
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
    bookmarks: 'Bookmarks',
    branch: 'Branch',
    chatDataLoadFailed: 'Chat data could not be loaded.',
    chatListCreateFolder: 'Create chat folder',
    chatListEdit: 'Edit chat list',
    chatListExportAll: 'Export all chats',
    chatListImport: 'Import chat',
    chatOptions: 'Chat options',
    changeFolderColor: 'Change folder color',
    doYouWantToBindCurrentPersona: 'Bind persona?',
    doYouWantToUnbindCurrentPersona: 'Unbind persona?',
    errors: { onlyOneChat: 'Only one chat' },
    edit: 'Edit',
    export: 'Export',
    goback: 'Back',
    authorNote: "Author's Note",
    help: { chatNote: 'Chat note help' },
    hotkeyDesc: { popupEditor: 'Open popup editor' },
    chooseDestinationFolder: 'Choose destination folder',
    moveDown: 'Move down',
    moveOutOfFolder: 'Move out of folder',
    moveToFolder: 'Move to folder',
    moveUp: 'Move up',
    newChat: 'New Chat',
    options: 'Options',
    personaBindedSuccess: 'Persona bound',
    personaBindingFailed: 'Persona binding failed',
    personaBindingQueued: 'Persona binding queued',
    personaUnbindedSuccess: 'Persona unbound',
    removeConfirm: 'Remove ',
    remove: 'Remove',
    showHelp: 'Show help',
    tokens: 'tokens',
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
    dispatchDeleteChatFolder: sidebarMocks.dispatchDeleteChatFolder,
    dispatchForkChat: sidebarMocks.dispatchForkChat,
    dispatchReorderChatFoldersAndChatsByIds: sidebarMocks.dispatchReorderChatFoldersAndChatsByIds,
    dispatchReorderChats: sidebarMocks.dispatchReorderChats,
    dispatchReorderChatsByIds: sidebarMocks.dispatchReorderChatsByIds,
    dispatchUpdateChat: sidebarMocks.dispatchUpdateChat,
    dispatchUpdateChatFolder: sidebarMocks.dispatchUpdateChatFolder,
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
  currentRoute: sidebarMocks.currentRoute,
  navigate: sidebarMocks.navigate,
}))

vi.mock('src/ts/server/chatBridge.svelte', () => ({
  rollbackServerBackedChatFolderRowMetadata: sidebarMocks.rollbackServerBackedChatFolderRowMetadata,
  rollbackServerBackedChatRowMetadata: sidebarMocks.rollbackServerBackedChatRowMetadata,
  syncServerBackedChatMetadataBaselines: sidebarMocks.syncServerBackedChatMetadataBaselines,
  watchServerBackedChatMetadata: sidebarMocks.watchServerBackedChatMetadata,
}))

vi.mock('src/ts/server/chatMessageHydration.svelte', () => ({
  applyServerChatMessagesResource: vi.fn(() => true),
  ensureAllChatsHydrated: vi.fn(async () => undefined),
  hydrateActiveChat: vi.fn(async () => undefined),
  hydrateChatMessages: sidebarMocks.hydrateChatMessages,
  resetChatHydration: vi.fn(),
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
import { selectedCharID } from 'src/ts/stores.svelte'
import { setResourceWriteGuardEnabled, withTrustedResourceWrite } from 'src/ts/server/resourceWriteGuard.svelte'
import {
  getResourceDatabase as getDatabase,
  replaceResourceDatabase as setDatabaseLite,
} from 'src/ts/server/resourceState.svelte'
import type { Chat, ChatFolder, character } from 'src/ts/storage/database.svelte'
import { restoreChatRowMetadata } from 'src/ts/chatCommands'
import { language } from 'src/lang'

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
  setDatabaseLite({
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
  } as never)

  return getDatabase().characters[0]
}

function appendCharacterCopy(source: character, characterId: string): character {
  const copy = JSON.parse(JSON.stringify(source)) as character
  copy.chaId = characterId
  copy.name = `Copy ${characterId}`
  getDatabase().characters.push(copy)
  return getDatabase().characters.at(-1)!
}

function sidebarRoot(): HTMLElement {
  const root = target.querySelector<HTMLElement>('[data-risu-chat-list="sidebar"]')
  expect(root, 'sidebar chat list root').toBeTruthy()
  return root!
}

function chatRows(): HTMLElement[] {
  return Array.from(sidebarRoot().querySelectorAll<HTMLElement>('[data-risu-chat-idx][data-risu-chat-id]'))
}

function rowByChatId(chatId: string): HTMLElement {
  const row = chatRows().find((candidate) => candidate.dataset.risuChatId === chatId)
  expect(row, `chat row ${chatId}`).toBeTruthy()
  return row!
}

function selectButtonForRow(row: HTMLElement): HTMLButtonElement {
  const button = row.querySelector<HTMLButtonElement>('[data-risu-chat-action="select"]')
  expect(button, 'select chat button').toBeTruthy()
  return button!
}

function createButton(): HTMLButtonElement {
  const action = sidebarRoot().querySelector<HTMLElement>('[data-risu-chat-action="create"]')
  const button = action instanceof HTMLButtonElement ? action : action?.querySelector<HTMLButtonElement>('button')
  expect(button, 'create chat button').toBeTruthy()
  return button!
}

function createFolderButton(): HTMLButtonElement {
  const button = sidebarRoot().querySelector<HTMLButtonElement>('[data-risu-chat-action="create-folder"]')
  expect(button, 'create folder button').toBeTruthy()
  return button!
}

function backToChatListButton(): HTMLButtonElement {
  const button = sidebarRoot().querySelector<HTMLButtonElement>('[data-risu-chat-action="back-to-chat-list"]')
  expect(button, 'back to chat list button').toBeTruthy()
  return button!
}

function rowActionButton(row: HTMLElement, actionKind: string): HTMLElement {
  const action = row.querySelector<HTMLElement>(`[data-risu-chat-action="${actionKind}"]`)
  expect(action, `${actionKind} chat action`).toBeTruthy()
  return action!
}

function editButtonForRow(row: HTMLElement): HTMLElement {
  return rowActionButton(row, 'edit')
}

function deleteButtonForRow(row: HTMLElement): HTMLElement {
  return rowActionButton(row, 'delete')
}

function folderHeader(folder: HTMLElement): HTMLButtonElement {
  const header = folder.querySelector<HTMLButtonElement>(
    ':scope > [data-risu-chat-folder-header] > [data-risu-chat-action="toggle-folder"]',
  )
  expect(header, 'folder header').toBeTruthy()
  return header!
}

function folderHeaderContainer(folder: HTMLElement): HTMLElement {
  const header = folder.querySelector<HTMLElement>(':scope > [data-risu-chat-folder-header]')
  expect(header, 'folder header container').toBeTruthy()
  return header!
}

function folderElementById(folderId: string): HTMLElement {
  const folder = Array.from(
    sidebarRoot().querySelectorAll<HTMLElement>('[data-risu-chat-folder-idx][data-risu-chat-folder-id]'),
  ).find((candidate) => candidate.dataset.risuChatFolderId === folderId)
  expect(folder, `folder row ${folderId}`).toBeTruthy()
  return folder!
}

function folderPanelById(folderId: string): HTMLElement {
  const panel = sidebarRoot().querySelector<HTMLElement>(`[data-risu-chat-folder-panel-id="${folderId}"]`)
  expect(panel, `folder panel ${folderId}`).toBeTruthy()
  return panel!
}

function inputIn(element: HTMLElement, description: string): HTMLInputElement {
  const input = element.querySelector<HTMLInputElement>('input')
  expect(input, description).toBeTruthy()
  return input!
}

function expectRowSelected(chatId: string, selected: boolean): void {
  expect(rowByChatId(chatId).dataset.risuChatSelected).toBe(selected ? 'true' : 'false')
}

function sortableForElement(element: Element): { options: { onEnd: (event: { to: HTMLElement }) => Promise<void> } } {
  const sortable = sidebarMocks.SortableMock.instances.find((instance) => instance.element === element)
  expect(sortable, 'sortable instance').toBeTruthy()
  return sortable as unknown as { options: { onEnd: (event: { to: HTMLElement }) => Promise<void> } }
}

function activeSortablesForElement(element: Element): Array<{ destroy: ReturnType<typeof vi.fn> }> {
  return sidebarMocks.SortableMock.instances.filter(
    (instance) => instance.element === element && instance.destroy.mock.calls.length === 0,
  )
}

async function setTextInputValue(input: HTMLInputElement, value: string): Promise<void> {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()
}

function selectedCharacter(): character {
  return getDatabase().characters[0]
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
    setResourceWriteGuardEnabled(false)
    if (component) {
      unmount(component)
      component = undefined
    }
    target.remove()
    document.body.innerHTML = ''
    selectedCharID.set(-1)
    setDatabaseLite({} as never)
  })

  it('renders seeded root and folder chat rows with selected and folder selectors', async () => {
    seedSidebarDatabase()

    component = mount(SideChatListHarness, { target })
    await tick()

    expect(chatRows().map((row) => row.dataset.risuChatId)).toEqual(['chat-foldered', 'chat-root-a', 'chat-root-b'])
    expect(rowByChatId('chat-foldered').dataset.risuChatIdx).toBe('1')
    expect(rowByChatId('chat-foldered').dataset.risuChatFolderId).toBe('folder-a')
    expect(rowByChatId('chat-root-a').dataset.risuChatFolderId).toBe('')
    expect(rowByChatId('chat-root-b').dataset.risuChatFolderId).toBe('')
    expect(folderElementById('folder-a').dataset.risuChatFolderFolded).toBe('false')
    expectRowSelected('chat-foldered', true)
    expectRowSelected('chat-root-a', false)
    expectRowSelected('chat-root-b', false)
    expect(sidebarRoot().dataset.risuChatOpen).toBe('false')
    expect(target.querySelector('[data-testid="side-chat-list-toggles-stub"]')).toBeNull()
    expect(sidebarMocks.watchServerBackedChatMetadata).toHaveBeenCalledOnce()
  })

  it('gives every icon-only chat and folder action a specific accessible name', async () => {
    seedSidebarDatabase()
    component = mount(SideChatListHarness, { target })
    await tick()

    const rootChat = rowByChatId('chat-root-a')
    expect(rowActionButton(rootChat, 'options').getAttribute('aria-label')).toBe(`${language.chatOptions}: Root Chat A`)
    expect(rowActionButton(rootChat, 'edit').getAttribute('aria-label')).toBe(`${language.edit}: Root Chat A`)
    expect(rowActionButton(rootChat, 'export').getAttribute('aria-label')).toBe(`${language.export}: Root Chat A`)
    expect(rowActionButton(rootChat, 'delete').getAttribute('aria-label')).toBe(`${language.remove}: Root Chat A`)

    const folder = folderElementById('folder-a')
    expect(rowActionButton(folder, 'folder-options').getAttribute('aria-label')).toBe(
      `${language.options}: Pinned Folder`,
    )
    expect(rowActionButton(folder, 'folder-edit').getAttribute('aria-label')).toBe(`${language.edit}: Pinned Folder`)
    expect(rowActionButton(folder, 'folder-delete').getAttribute('aria-label')).toBe(
      `${language.remove}: Pinned Folder`,
    )

    const footerActions = {
      'export-all': language.chatListExportAll,
      import: language.chatListImport,
      'edit-list': language.chatListEdit,
      branches: language.branch,
      bookmarks: language.bookmarks,
      'create-folder': language.chatListCreateFolder,
    }
    for (const [action, expectedName] of Object.entries(footerActions)) {
      expect(
        sidebarRoot().querySelector<HTMLElement>(`[data-risu-chat-action="${action}"]`)?.getAttribute('aria-label'),
      ).toBe(expectedName)
    }
  })

  it('reorders chats through keyboard-accessible organizer actions', async () => {
    const chara = seedSidebarDatabase()
    sidebarMocks.changeChatTo.mockImplementation((index: number) => {
      chara.chatPage = index
    })
    sidebarMocks.alertSelect.mockResolvedValueOnce('0')
    component = mount(SideChatListHarness, { target })
    await tick()

    const editList = sidebarRoot().querySelector<HTMLButtonElement>('[data-risu-chat-action="edit-list"]')!
    editList.click()
    await tick()
    expect(editList.getAttribute('aria-pressed')).toBe('true')

    const organizer = rowActionButton(rowByChatId('chat-root-b'), 'organize') as HTMLButtonElement
    expect(organizer.getAttribute('aria-label')).toBe(`${language.options}: Root Chat B`)
    organizer.focus()
    organizer.click()
    await flushCommandWork()

    expect(chara.chats.map((chat) => chat.id)).toEqual(['chat-foldered', 'chat-root-b', 'chat-root-a'])
    expect(chatRows().map((row) => row.dataset.risuChatId)).toEqual(['chat-foldered', 'chat-root-b', 'chat-root-a'])
    expect(sidebarMocks.changeChatTo).toHaveBeenCalledWith(0)
    expect(sidebarMocks.dispatchReorderChats).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(rowActionButton(rowByChatId('chat-root-b'), 'organize'))
  })

  it('moves a chat into a folder through organizer choices', async () => {
    seedSidebarDatabase()
    sidebarMocks.setServerCommandsEnabled(true)
    sidebarMocks.alertSelect.mockResolvedValueOnce('1').mockResolvedValueOnce('0')
    component = mount(SideChatListHarness, { target })
    await tick()

    sidebarRoot().querySelector<HTMLButtonElement>('[data-risu-chat-action="edit-list"]')!.click()
    await tick()
    rowActionButton(rowByChatId('chat-root-a'), 'organize').click()
    await flushCommandWork()

    expect(sidebarMocks.alertSelect).toHaveBeenNthCalledWith(2, ['Pinned Folder'], language.chooseDestinationFolder)
    expect(sidebarMocks.dispatchReorderChatsByIds).toHaveBeenCalledWith(
      'char-a',
      ['chat-foldered', 'chat-root-a', 'chat-root-b'],
      {
        'chat-foldered': 'folder-a',
        'chat-root-a': 'folder-a',
        'chat-root-b': null,
      },
      expect.anything(),
      'chat-foldered',
    )
  })

  it('reorders chat folders through their native options button', async () => {
    const chara = seedSidebarDatabase()
    chara.chatFolders.push({ id: 'folder-b', name: 'Second Folder', folded: false } as ChatFolder)
    chara.chats.push(makeChat('chat-second-foldered', 'Second Foldered Chat', 'folder-b'))
    sidebarMocks.setServerCommandsEnabled(true)
    sidebarMocks.alertSelect.mockResolvedValueOnce('0')
    component = mount(SideChatListHarness, { target })
    await tick()

    sidebarRoot().querySelector<HTMLButtonElement>('[data-risu-chat-action="edit-list"]')!.click()
    await tick()
    const organizer = rowActionButton(folderElementById('folder-b'), 'folder-options') as HTMLButtonElement
    organizer.focus()
    organizer.click()
    await flushCommandWork()

    expect(sidebarMocks.dispatchReorderChatFoldersAndChatsByIds).toHaveBeenCalledWith(
      'char-a',
      ['folder-b', 'folder-a'],
      ['chat-second-foldered', 'chat-foldered', 'chat-root-a', 'chat-root-b'],
      {
        'chat-foldered': 'folder-a',
        'chat-root-a': null,
        'chat-root-b': null,
        'chat-second-foldered': 'folder-b',
      },
      expect.anything(),
      'chat-foldered',
    )
    expect(document.activeElement).toBe(organizer)
  })

  it('keeps local chat order and selection aligned when organizing folders', async () => {
    const chara = seedSidebarDatabase()
    chara.chatFolders.push({ id: 'folder-b', name: 'Second Folder', folded: false } as ChatFolder)
    chara.chats.push(makeChat('chat-second-foldered', 'Second Foldered Chat', 'folder-b'))
    chara.chatPage = 3
    sidebarMocks.changeChatTo.mockImplementation((index: number) => {
      chara.chatPage = index
    })
    sidebarMocks.alertSelect.mockResolvedValueOnce('0')
    component = mount(SideChatListHarness, { target })
    await tick()

    sidebarRoot().querySelector<HTMLButtonElement>('[data-risu-chat-action="edit-list"]')!.click()
    await tick()
    const organizer = rowActionButton(folderElementById('folder-b'), 'folder-options') as HTMLButtonElement
    organizer.focus()
    organizer.click()
    await flushCommandWork()

    expect(chara.chatFolders.map((folder) => folder.id)).toEqual(['folder-b', 'folder-a'])
    expect(chara.chats.map((chat) => chat.id)).toEqual([
      'chat-second-foldered',
      'chat-foldered',
      'chat-root-a',
      'chat-root-b',
    ])
    expect(sidebarMocks.changeChatTo).toHaveBeenCalledWith(0)
    expect(chara.chats[chara.chatPage]?.id).toBe('chat-second-foldered')
    expect(chatRows().map((row) => row.dataset.risuChatId)).toEqual([
      'chat-second-foldered',
      'chat-foldered',
      'chat-root-a',
      'chat-root-b',
    ])
    expect(document.activeElement).toBe(rowActionButton(folderElementById('folder-b'), 'folder-options'))
  })

  it('moves a chat into a folded folder and restores focus to its visible folder action', async () => {
    const chara = seedSidebarDatabase()
    chara.chatFolders[0].folded = true
    sidebarMocks.alertSelect.mockResolvedValueOnce('1').mockResolvedValueOnce('0')
    component = mount(SideChatListHarness, { target })
    await tick()

    sidebarRoot().querySelector<HTMLButtonElement>('[data-risu-chat-action="edit-list"]')!.click()
    await tick()
    const organizer = rowActionButton(rowByChatId('chat-root-a'), 'organize') as HTMLButtonElement
    organizer.focus()
    organizer.click()
    await flushCommandWork()

    expect(chara.chats.find((chat) => chat.id === 'chat-root-a')?.folderId).toBe('folder-a')
    expect(folderPanelById('folder-a').hidden).toBe(true)
    expect(document.activeElement).toBe(rowActionButton(folderElementById('folder-a'), 'folder-options'))
  })

  it('supports within-folder moves and moving a chat back to the root list', async () => {
    const chara = seedSidebarDatabase()
    chara.chats.push(makeChat('chat-foldered-second', 'Second Foldered Chat', 'folder-a'))
    sidebarMocks.alertSelect.mockResolvedValueOnce('0').mockResolvedValueOnce('1')
    component = mount(SideChatListHarness, { target })
    await tick()

    sidebarRoot().querySelector<HTMLButtonElement>('[data-risu-chat-action="edit-list"]')!.click()
    await tick()
    rowActionButton(rowByChatId('chat-foldered-second'), 'organize').click()
    await flushCommandWork()

    expect(chara.chats.map((chat) => chat.id)).toEqual([
      'chat-foldered-second',
      'chat-foldered',
      'chat-root-a',
      'chat-root-b',
    ])

    rowActionButton(rowByChatId('chat-foldered-second'), 'organize').click()
    await flushCommandWork()

    expect(chara.chats.find((chat) => chat.id === 'chat-foldered-second')?.folderId).toBeNull()
    expect(chara.chats.map((chat) => chat.id)).toEqual([
      'chat-foldered',
      'chat-root-a',
      'chat-root-b',
      'chat-foldered-second',
    ])
  })

  it('rebuilds organizer moves from current chats after an async choice', async () => {
    const chara = seedSidebarDatabase()
    let resolveSelection!: (selection: string) => void
    sidebarMocks.alertSelect.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveSelection = resolve
        }),
    )
    component = mount(SideChatListHarness, { target })
    await tick()

    sidebarRoot().querySelector<HTMLButtonElement>('[data-risu-chat-action="edit-list"]')!.click()
    await tick()
    rowActionButton(rowByChatId('chat-root-b'), 'organize').click()
    await Promise.resolve()
    chara.chats.push(makeChat('chat-added', 'Added Chat'))
    resolveSelection('0')
    await flushCommandWork()

    expect(chara.chats.map((chat) => chat.id)).toEqual(['chat-foldered', 'chat-root-b', 'chat-root-a', 'chat-added'])
  })

  it('does not finish a pending chat move after the selected character changes', async () => {
    const original = seedSidebarDatabase()
    let resolveFolderSelection!: (selection: string) => void
    sidebarMocks.alertSelect.mockResolvedValueOnce('1').mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveFolderSelection = resolve
        }),
    )
    component = mount(SideChatListHarness, { target })
    await tick()

    sidebarRoot().querySelector<HTMLButtonElement>('[data-risu-chat-action="edit-list"]')!.click()
    await tick()
    rowActionButton(rowByChatId('chat-root-a'), 'organize').click()
    await Promise.resolve()
    await tick()
    expect(sidebarMocks.alertSelect).toHaveBeenCalledTimes(2)

    const replacement = appendCharacterCopy(original, 'char-b')
    selectedCharID.set(1)
    await tick()
    resolveFolderSelection('0')
    await flushCommandWork()

    expect(original.chats.map((chat) => [chat.id, chat.folderId])).toEqual([
      ['chat-root-a', null],
      ['chat-foldered', 'folder-a'],
      ['chat-root-b', null],
    ])
    expect(replacement.chats.map((chat) => [chat.id, chat.folderId])).toEqual([
      ['chat-root-a', null],
      ['chat-foldered', 'folder-a'],
      ['chat-root-b', null],
    ])
    expect(sidebarMocks.dispatchReorderChats).not.toHaveBeenCalled()
    expect(sidebarMocks.dispatchReorderChatsByIds).not.toHaveBeenCalled()
  })

  it('does not finish a pending folder color change for a newly selected character', async () => {
    const original = seedSidebarDatabase()
    let resolveColorSelection!: (selection: string) => void
    sidebarMocks.alertSelect.mockResolvedValueOnce('0').mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveColorSelection = resolve
        }),
    )
    component = mount(SideChatListHarness, { target })
    await tick()

    rowActionButton(folderElementById('folder-a'), 'folder-options').click()
    await Promise.resolve()
    await tick()
    expect(sidebarMocks.alertSelect).toHaveBeenCalledTimes(2)

    const replacement = appendCharacterCopy(original, 'char-b')
    selectedCharID.set(1)
    await tick()
    resolveColorSelection('0')
    await flushCommandWork()

    expect(original.chatFolders[0].color).toBeUndefined()
    expect(replacement.chatFolders[0].color).toBeUndefined()
    expect(sidebarMocks.dispatchUpdateChatFolder).not.toHaveBeenCalled()
  })

  it('omits all reorder actions when a chat id is incomplete', async () => {
    const chara = seedSidebarDatabase()
    ;(chara.chats[0] as { id?: string }).id = undefined
    chara.chatFolders.push({ id: 'folder-b', name: 'Second Folder', folded: false } as ChatFolder)
    sidebarMocks.alertSelect.mockResolvedValueOnce(null)
    component = mount(SideChatListHarness, { target })
    await tick()

    sidebarRoot().querySelector<HTMLButtonElement>('[data-risu-chat-action="edit-list"]')!.click()
    await tick()

    expect(sidebarRoot().querySelector('[data-risu-chat-action="organize"]')).toBeNull()
    rowActionButton(folderElementById('folder-b'), 'folder-options').click()
    await flushCommandWork()
    expect(sidebarMocks.alertSelect).toHaveBeenNthCalledWith(
      1,
      [language.changeFolderColor],
      `${language.options}: Second Folder`,
    )
    expect(sidebarMocks.dispatchReorderChatFoldersAndChatsByIds).not.toHaveBeenCalled()
    expect(chara.chats).toHaveLength(3)
  })

  it('fails closed when organizer ids are duplicated', async () => {
    const chara = seedSidebarDatabase()
    chara.chats[0].id = 'chat-foldered'
    chara.chatFolders.push({ id: 'folder-a', name: 'Duplicate Folder', folded: false } as ChatFolder)
    component = mount(SideChatListHarness, { target })
    await tick()

    sidebarRoot().querySelector<HTMLButtonElement>('[data-risu-chat-action="edit-list"]')!.click()
    await tick()

    expect(sidebarRoot().querySelector('[data-risu-chat-action="organize"]')).toBeNull()
    rowActionButton(folderElementById('folder-a'), 'folder-options').click()
    await flushCommandWork()
    expect(sidebarMocks.alertSelect).not.toHaveBeenCalled()
    expect(sidebarMocks.dispatchReorderChatFoldersAndChatsByIds).not.toHaveBeenCalled()
    expect(chara.chats).toHaveLength(3)
  })

  it('uses native sibling buttons for chat and folder actions', async () => {
    const chara = seedSidebarDatabase()
    component = mount(SideChatListHarness, { target })
    await tick()

    const chatExport = rowActionButton(rowByChatId('chat-root-a'), 'export')
    expect(chatExport).toBeInstanceOf(HTMLButtonElement)
    chatExport.click()
    rowActionButton(rowByChatId('chat-foldered'), 'export').click()
    sidebarRoot().querySelector<HTMLButtonElement>('[data-risu-chat-action="export-all"]')!.click()
    chara.chats.reverse()
    await tick()

    expect(sidebarMocks.exportChat.mock.calls).toEqual([
      [{ characterId: 'char-a', chatId: 'chat-root-a' }],
      [{ characterId: 'char-a', chatId: 'chat-foldered' }],
    ])
    expect(sidebarMocks.exportAllChats).toHaveBeenCalledWith('char-a')

    const folderDelete = rowActionButton(folderElementById('folder-a'), 'folder-delete')
    expect(folderDelete).toBeInstanceOf(HTMLButtonElement)
    folderDelete.click()
    await flushCommandWork()

    expect(sidebarMocks.alertConfirm).toHaveBeenCalledWith('Remove Pinned Folder')
    expect(sidebarRoot().querySelector('button button, button input, button [role="button"]')).toBeNull()
  })

  it('remints copied message ids before dispatching a server-backed chat copy', async () => {
    const chara = seedSidebarDatabase()
    chara.chats[0].message = [
      { chatId: 'root-message-0', data: 'first root message', role: 'user' },
      { chatId: 'root-message-1', data: 'second root message', role: 'char' },
    ]
    sidebarMocks.setServerCommandsEnabled(true)
    sidebarMocks.alertChatOptions.mockResolvedValueOnce(0)

    component = mount(SideChatListHarness, { target })
    await tick()

    rowActionButton(rowByChatId('chat-root-a'), 'options').click()
    await flushCommandWork()

    expect(sidebarMocks.dispatchForkChat).toHaveBeenCalledOnce()
    const [sourceChatId, , payload] = sidebarMocks.dispatchForkChat.mock.calls[0] as [string, unknown, { chat: Chat }]
    expect(sourceChatId).toBe('chat-root-a')
    expect(payload.chat.name).toBe('Root Chat A Copy')
    expect(payload.chat.id).not.toBe('chat-root-a')
    expect(payload.chat.message.map((message) => ({ data: message.data, role: message.role }))).toEqual([
      { data: 'first root message', role: 'user' },
      { data: 'second root message', role: 'char' },
    ])
    expect(payload.chat.message.map((message) => message.chatId)).not.toContain('root-message-0')
    expect(payload.chat.message.map((message) => message.chatId)).not.toContain('root-message-1')
    expect(new Set(payload.chat.message.map((message) => message.chatId)).size).toBe(payload.chat.message.length)
    expect(chara.chats[0].message.map((message) => message.chatId)).toEqual(['root-message-0', 'root-message-1'])
  })

  it('hydrates an unopened chat before dispatching a server-backed copy', async () => {
    const chara = seedSidebarDatabase()
    chara.chats[0].message = []
    sidebarMocks.setServerCommandsEnabled(true)
    sidebarMocks.alertChatOptions.mockResolvedValueOnce(0)
    sidebarMocks.hydrateChatMessages.mockImplementationOnce(async () => {
      withTrustedResourceWrite(() => {
        chara.chats[0].message = [
          { chatId: 'server-message-0', data: 'loaded from server', role: 'user' },
          { chatId: 'server-message-1', data: 'complete history', role: 'char' },
        ]
      })
    })

    component = mount(SideChatListHarness, { target })
    await tick()

    rowActionButton(rowByChatId('chat-root-a'), 'options').click()
    await flushCommandWork()

    expect(sidebarMocks.hydrateChatMessages).toHaveBeenCalledWith('chat-root-a', { strict: true })
    const payload = sidebarMocks.dispatchForkChat.mock.calls[0]?.[2] as { chat: Chat }
    expect(payload.chat.message.map((message) => message.data)).toEqual(['loaded from server', 'complete history'])
    expect(payload.chat.message.map((message) => message.chatId)).not.toContain('server-message-0')
  })

  it('does not copy an unopened chat when strict hydration fails', async () => {
    seedSidebarDatabase().chats[0].message = []
    sidebarMocks.setServerCommandsEnabled(true)
    sidebarMocks.alertChatOptions.mockResolvedValueOnce(0)
    sidebarMocks.hydrateChatMessages.mockRejectedValueOnce(new Error('offline'))

    component = mount(SideChatListHarness, { target })
    await tick()

    rowActionButton(rowByChatId('chat-root-a'), 'options').click()
    await flushCommandWork()

    expect(sidebarMocks.dispatchForkChat).not.toHaveBeenCalled()
    expect(sidebarMocks.alertError).toHaveBeenCalledWith('Chat data could not be loaded.')
  })

  it('shows active-chat controls instead of the chat list on a chat route', async () => {
    seedSidebarDatabase()
    sidebarMocks.setCurrentRoute({
      kind: 'character',
      path: '/character/char-a/chat-foldered',
      chaId: 'char-a',
      chatId: 'chat-foldered',
    })

    component = mount(SideChatListHarness, { target })
    await tick()

    expect(sidebarRoot().dataset.risuChatOpen).toBe('true')
    expect(chatRows()).toEqual([])
    expect(target.querySelector('[data-risu-chat-author-note]')).toBeTruthy()
    expect(target.querySelector('[data-testid="side-chat-list-toggles-stub"]')).toBeTruthy()

    backToChatListButton().click()
    await tick()

    expect(sidebarMocks.navigate).toHaveBeenCalledWith('/character/char-a')
  })

  it('keeps foldered chat row indexes tied to original chat positions', async () => {
    const chara = seedSidebarDatabase()
    chara.chats.push(makeChat('chat-foldered-second', 'Second Foldered Chat', 'folder-a'))

    component = mount(SideChatListHarness, { target })
    await tick()

    expect(
      chatRows().map((row) => ({
        id: row.dataset.risuChatId,
        index: row.dataset.risuChatIdx,
      })),
    ).toEqual([
      { id: 'chat-foldered', index: '1' },
      { id: 'chat-foldered-second', index: '3' },
      { id: 'chat-root-a', index: '0' },
      { id: 'chat-root-b', index: '2' },
    ])
  })

  it('dispatches combined folder and chat reorder helper for server-backed folder drag', async () => {
    const chara = seedSidebarDatabase()
    chara.chatFolders.push({ id: 'folder-b', name: 'Second Folder', folded: false } as any)
    chara.chats.push(makeChat('chat-second-foldered', 'Second Foldered Chat', 'folder-b'))
    sidebarMocks.setServerCommandsEnabled(true)

    component = mount(SideChatListHarness, { target })
    await tick()

    const folderA = folderElementById('folder-a')
    const folderB = folderElementById('folder-b')
    const folderContainer = folderA.parentElement
    expect(folderContainer, 'folder container').toBeTruthy()
    folderContainer!.insertBefore(folderB, folderA)

    const folderSortable = sidebarMocks.SortableMock.create.mock.results.at(-1)?.value as {
      options: { onEnd: (event: { to: HTMLElement }) => Promise<void> }
    }
    await folderSortable.options.onEnd({ to: folderContainer! })

    expect(sidebarMocks.dispatchReorderChatFoldersAndChatsByIds).toHaveBeenCalledOnce()
    const [characterId, folderIds, chatIds, folderByChatId, previous, selectedChatId] =
      sidebarMocks.dispatchReorderChatFoldersAndChatsByIds.mock.calls[0]
    expect(characterId).toBe('char-a')
    expect(folderIds).toEqual(['folder-b', 'folder-a'])
    expect(chatIds).toEqual(['chat-second-foldered', 'chat-foldered', 'chat-root-a', 'chat-root-b'])
    expect(folderByChatId).toEqual({
      'chat-foldered': 'folder-a',
      'chat-root-a': null,
      'chat-root-b': null,
      'chat-second-foldered': 'folder-b',
    })
    expect(previous).toMatchObject({
      selectedCharID: 0,
      characters: [
        {
          chaId: 'char-a',
          chatFolders: [{ id: 'folder-a' }, { id: 'folder-b' }],
          chats: [
            { id: 'chat-root-a' },
            { id: 'chat-foldered' },
            { id: 'chat-root-b' },
            { id: 'chat-second-foldered' },
          ],
        },
      ],
    })
    expect(selectedChatId).toBe('chat-foldered')
    expect(sidebarMocks.reorderChatFoldersCommand).not.toHaveBeenCalled()
    expect(sidebarMocks.reorderChatsCommand).not.toHaveBeenCalled()
  })

  it('uses DOM chat ids instead of live indexes when chat projection changes during drag', async () => {
    const chara = seedSidebarDatabase()
    sidebarMocks.setServerCommandsEnabled(true)

    component = mount(SideChatListHarness, { target })
    await tick()

    const rootA = rowByChatId('chat-root-a')
    const rootB = rowByChatId('chat-root-b')
    const rootContainer = rootA.parentElement
    expect(rootContainer, 'root chat sortable container').toBeTruthy()
    rootContainer!.insertBefore(rootB, rootA)

    const liveChatsById = new Map(chara.chats.map((chat) => [chat.id, chat]))
    chara.chats = [
      liveChatsById.get('chat-root-b')!,
      liveChatsById.get('chat-foldered')!,
      liveChatsById.get('chat-root-a')!,
    ]

    await sortableForElement(rootContainer!).options.onEnd({ to: rootContainer! })

    expect(sidebarMocks.dispatchReorderChatsByIds).toHaveBeenCalledOnce()
    const [characterId, chatIds, folderByChatId, previous, selectedChatId] =
      sidebarMocks.dispatchReorderChatsByIds.mock.calls[0]
    expect(characterId).toBe('char-a')
    expect(chatIds).toEqual(['chat-foldered', 'chat-root-b', 'chat-root-a'])
    expect(folderByChatId).toEqual({
      'chat-foldered': 'folder-a',
      'chat-root-a': null,
      'chat-root-b': null,
    })
    expect(previous).toMatchObject({
      characters: [
        {
          chats: [{ id: 'chat-root-b' }, { id: 'chat-foldered' }, { id: 'chat-root-a' }],
        },
      ],
    })
    expect(selectedChatId).toBe('chat-foldered')
  })

  it('uses DOM folder and chat ids when folder projection changes during drag', async () => {
    const chara = seedSidebarDatabase()
    chara.chatFolders.push({ id: 'folder-b', name: 'Second Folder', folded: false } as any)
    chara.chats.push(makeChat('chat-second-foldered', 'Second Foldered Chat', 'folder-b'))
    sidebarMocks.setServerCommandsEnabled(true)

    component = mount(SideChatListHarness, { target })
    await tick()

    const folderA = folderElementById('folder-a')
    const folderB = folderElementById('folder-b')
    const folderContainer = folderA.parentElement
    expect(folderContainer, 'folder container').toBeTruthy()
    folderContainer!.insertBefore(folderB, folderA)

    const liveFoldersById = new Map(chara.chatFolders.map((folder) => [folder.id, folder]))
    chara.chatFolders = [liveFoldersById.get('folder-b')!, liveFoldersById.get('folder-a')!]

    const liveChatsById = new Map(chara.chats.map((chat) => [chat.id, chat]))
    chara.chats = [
      liveChatsById.get('chat-root-b')!,
      liveChatsById.get('chat-second-foldered')!,
      liveChatsById.get('chat-foldered')!,
      liveChatsById.get('chat-root-a')!,
    ]

    await sortableForElement(folderContainer!).options.onEnd({ to: folderContainer! })

    expect(sidebarMocks.dispatchReorderChatFoldersAndChatsByIds).toHaveBeenCalledOnce()
    const [characterId, folderIds, chatIds, folderByChatId, previous, selectedChatId] =
      sidebarMocks.dispatchReorderChatFoldersAndChatsByIds.mock.calls[0]
    expect(characterId).toBe('char-a')
    expect(folderIds).toEqual(['folder-b', 'folder-a'])
    expect(chatIds).toEqual(['chat-second-foldered', 'chat-foldered', 'chat-root-a', 'chat-root-b'])
    expect(folderByChatId).toEqual({
      'chat-foldered': 'folder-a',
      'chat-root-a': null,
      'chat-root-b': null,
      'chat-second-foldered': 'folder-b',
    })
    expect(previous).toMatchObject({
      characters: [
        {
          chatFolders: [{ id: 'folder-b' }, { id: 'folder-a' }],
          chats: [
            { id: 'chat-root-b' },
            { id: 'chat-second-foldered' },
            { id: 'chat-foldered' },
            { id: 'chat-root-a' },
          ],
        },
      ],
    })
    expect(selectedChatId).toBe('chat-foldered')
  })

  it('fails closed and resets DOM when a live chat appears during chat drag', async () => {
    const chara = seedSidebarDatabase()
    sidebarMocks.setServerCommandsEnabled(true)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    component = mount(SideChatListHarness, { target })
    await tick()

    const rootA = rowByChatId('chat-root-a')
    const rootB = rowByChatId('chat-root-b')
    const rootContainer = rootA.parentElement
    expect(rootContainer, 'root chat sortable container').toBeTruthy()
    rootContainer!.insertBefore(rootB, rootA)
    chara.chats.push(makeChat('chat-added', 'Added Chat'))

    await sortableForElement(rootContainer!).options.onEnd({ to: rootContainer! })
    await tick()

    expect(sidebarMocks.dispatchReorderChatsByIds).not.toHaveBeenCalled()
    expect(sidebarMocks.dispatchReorderChatFoldersAndChatsByIds).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      'Ignoring stale sidebar chat reorder: current chat id "chat-added" is missing from the DOM',
    )
    expect(chatRows().map((row) => row.dataset.risuChatId)).toEqual([
      'chat-foldered',
      'chat-root-a',
      'chat-root-b',
      'chat-added',
    ])
  })

  it('hides folded folder rows without losing selected chat state', async () => {
    const chara = seedSidebarDatabase()
    chara.chatFolders[0].folded = true
    chara.chatPage = 1

    component = mount(SideChatListHarness, { target })
    await tick()

    const folder = folderElementById('folder-a')
    const folderPanel = folderPanelById('folder-a')
    const selectedRow = rowByChatId('chat-foldered')

    expect(folder.dataset.risuChatFolderFolded).toBe('true')
    expect(folderPanel.hidden).toBe(true)
    expect(chara.chatPage).toBe(1)
    expect(chara.chats[chara.chatPage]?.id).toBe('chat-foldered')
    expect(selectedRow.dataset.risuChatIdx).toBe('1')
    expect(selectedRow.dataset.risuChatFolderId).toBe('folder-a')
    expectRowSelected('chat-foldered', true)
    expectRowSelected('chat-root-a', false)
    expectRowSelected('chat-root-b', false)
  })

  it('keeps rapid chat and folder name input in the debounced bridge pipeline', async () => {
    seedSidebarDatabase()
    sidebarMocks.setServerCommandsEnabled(true)
    setResourceWriteGuardEnabled(true)

    component = mount(SideChatListHarness, { target })
    await tick()

    editButtonForRow(rowByChatId('chat-foldered')).click()
    await tick()

    const chatNameInput = inputIn(rowByChatId('chat-foldered'), 'chat name input')
    const folderNameInput = inputIn(folderElementById('folder-a'), 'folder name input')

    await setTextInputValue(chatNameInput, 'h')
    await setTextInputValue(chatNameInput, 'he')
    await setTextInputValue(chatNameInput, 'hello')
    await setTextInputValue(folderNameInput, 'f')
    await setTextInputValue(folderNameInput, 'fo')
    await setTextInputValue(folderNameInput, 'folder')

    expect(selectedCharacter().chats[1].name).toBe('hello')
    expect(selectedCharacter().chatFolders[0].name).toBe('folder')
    expect(chatNameInput.value).toBe('hello')
    expect(folderNameInput.value).toBe('folder')
    expect(sidebarMocks.dispatchUpdateChat).not.toHaveBeenCalled()
    expect(sidebarMocks.dispatchUpdateChatFolder).not.toHaveBeenCalled()
    expect(sidebarMocks.syncServerBackedChatMetadataBaselines).not.toHaveBeenCalled()
  })

  it('paints folder folded toggles before dispatching with the folder stable id', async () => {
    seedSidebarDatabase()
    sidebarMocks.setServerCommandsEnabled(true)
    setResourceWriteGuardEnabled(true)
    sidebarMocks.dispatchUpdateChatFolder.mockImplementationOnce(() => {
      expect(selectedCharacter().chatFolders[0].folded).toBe(true)
    })

    component = mount(SideChatListHarness, { target })
    await tick()

    const folder = folderElementById('folder-a')
    const header = folderHeader(folder)
    const panel = folderPanelById('folder-a')
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(header.getAttribute('aria-controls')).toBe(panel.id)

    header.click()
    await tick()

    expect(sidebarMocks.dispatchUpdateChatFolder).toHaveBeenCalledWith(
      'folder-a',
      { folded: true },
      expect.any(Object),
      sidebarMocks.rollbackServerBackedChatFolderRowMetadata,
    )
    expect(selectedCharacter().chatFolders[0].folded).toBe(true)
    expect(folder.dataset.risuChatFolderFolded).toBe('true')
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(panel.hidden).toBe(true)
  })

  it('routes a failed direct folder toggle through the bridge-safe rollback callback', async () => {
    seedSidebarDatabase()
    sidebarMocks.setServerCommandsEnabled(true)
    setResourceWriteGuardEnabled(true)
    sidebarMocks.rollbackServerBackedChatFolderRowMetadata.mockImplementationOnce((snapshot) => {
      withTrustedResourceWrite(() => {
        const folder = selectedCharacter().chatFolders[0]
        if (folder.folded === snapshot.attempted?.folded) {
          folder.folded = snapshot.metadata.folded ?? false
        }
      })
      sidebarMocks.syncServerBackedChatMetadataBaselines()
    })
    sidebarMocks.dispatchUpdateChatFolder.mockImplementationOnce((folderId, patch, _previous, rollback) => {
      rollback({
        selectedCharID: 0,
        characterId: 'char-a',
        folderId,
        metadata: { folded: false },
        attempted: patch,
      })
    })

    component = mount(SideChatListHarness, { target })
    await tick()

    folderHeader(folderElementById('folder-a')).click()
    await tick()

    expect(sidebarMocks.dispatchUpdateChatFolder).toHaveBeenCalledTimes(1)
    expect(sidebarMocks.rollbackServerBackedChatFolderRowMetadata).toHaveBeenCalledTimes(1)
    expect(selectedCharacter().chatFolders[0].folded).toBe(false)
    expect(folderElementById('folder-a').dataset.risuChatFolderFolded).toBe('false')
  })

  it('paints a selected folder color before dispatch', async () => {
    seedSidebarDatabase()
    sidebarMocks.setServerCommandsEnabled(true)
    setResourceWriteGuardEnabled(true)
    sidebarMocks.alertSelect.mockResolvedValueOnce('0').mockResolvedValueOnce('0')
    sidebarMocks.dispatchUpdateChatFolder.mockImplementationOnce(() => {
      expect(selectedCharacter().chatFolders[0].color).toBe('red')
    })

    component = mount(SideChatListHarness, { target })
    await tick()

    rowActionButton(folderElementById('folder-a'), 'folder-options').click()
    await flushCommandWork()

    expect(sidebarMocks.dispatchUpdateChatFolder).toHaveBeenCalledWith(
      'folder-a',
      { color: 'red' },
      expect.any(Object),
      sidebarMocks.rollbackServerBackedChatFolderRowMetadata,
    )
    expect(selectedCharacter().chatFolders[0].color).toBe('red')
    expect(folderHeaderContainer(folderElementById('folder-a')).classList.contains('bg-red-900')).toBe(true)
  })

  it('does not change a folder color when the action selection is cancelled', async () => {
    seedSidebarDatabase()
    sidebarMocks.setServerCommandsEnabled(true)
    setResourceWriteGuardEnabled(true)
    sidebarMocks.alertSelect.mockResolvedValueOnce(null)

    component = mount(SideChatListHarness, { target })
    await tick()

    rowActionButton(folderElementById('folder-a'), 'folder-options').click()
    await flushCommandWork()

    expect(sidebarMocks.alertSelect).toHaveBeenCalledWith(
      [language.changeFolderColor],
      `${language.options}: Pinned Folder`,
    )
    expect(sidebarMocks.dispatchUpdateChatFolder).not.toHaveBeenCalled()
    expect(selectedCharacter().chatFolders[0].color).toBeUndefined()
  })

  it('keeps persona unbinding pending until failure rolls state and DOM back', async () => {
    const chara = seedSidebarDatabase()
    chara.chats[1].bindedPersona = 'persona-a'
    sidebarMocks.setServerCommandsEnabled(true)
    setResourceWriteGuardEnabled(true)
    sidebarMocks.alertChatOptions.mockResolvedValueOnce(1)
    sidebarMocks.alertConfirm.mockResolvedValueOnce(true)
    sidebarMocks.rollbackServerBackedChatRowMetadata.mockImplementationOnce(restoreChatRowMetadata)
    const command = sidebarMocks.createDeferredUpdateCommand()

    component = mount(SideChatListHarness, { target })
    await tick()

    const options = rowActionButton(rowByChatId('chat-foldered'), 'options')
    options.click()
    await flushCommandWork()

    expect(command.settled).toBe(false)
    expect(command.input).toMatchObject({ chatId: 'chat-foldered', patch: { bindedPersona: '' }, select: false })
    expect(selectedCharacter().chats[1].bindedPersona).toBe('')
    expect(options.getAttribute('aria-busy')).toBe('true')
    expect(options.getAttribute('aria-disabled')).toBe('true')
    expect(options).toBeInstanceOf(HTMLButtonElement)
    expect((options as HTMLButtonElement).disabled).toBe(true)
    expect(sidebarMocks.alertNormal).not.toHaveBeenCalled()
    expect(sidebarMocks.alertError).not.toHaveBeenCalled()

    options.click()
    await tick()
    expect(sidebarMocks.alertChatOptions).toHaveBeenCalledOnce()

    command.resolve({ error: 'persona update failed', status: 'error' })
    await flushCommandWork()

    expect(sidebarMocks.rollbackServerBackedChatRowMetadata).toHaveBeenCalledOnce()
    expect(selectedCharacter().chats[1].bindedPersona).toBe('persona-a')
    expect(options.getAttribute('aria-busy')).toBe('false')
    expect(options.getAttribute('aria-disabled')).toBe('false')
    expect((options as HTMLButtonElement).disabled).toBe(false)
    expect(sidebarMocks.alertError).toHaveBeenCalledWith('Persona binding failed')
    expect(sidebarMocks.alertNormal).not.toHaveBeenCalled()
  })

  it('shows persona binding success only after the deferred command settles', async () => {
    seedSidebarDatabase()
    getDatabase().personas = [{ id: 'persona-selected', name: 'Selected Persona' }] as never
    sidebarMocks.setServerCommandsEnabled(true)
    setResourceWriteGuardEnabled(true)
    sidebarMocks.alertChatOptions.mockResolvedValueOnce(1)
    sidebarMocks.alertConfirm.mockResolvedValueOnce(true)
    const command = sidebarMocks.createDeferredUpdateCommand()

    component = mount(SideChatListHarness, { target })
    await tick()

    const options = rowActionButton(rowByChatId('chat-root-a'), 'options')
    options.click()
    await flushCommandWork()

    expect(command.settled).toBe(false)
    expect(command.input).toMatchObject({
      chatId: 'chat-root-a',
      patch: { bindedPersona: 'persona-selected' },
      select: false,
    })
    expect(selectedCharacter().chats[0].bindedPersona).toBe('persona-selected')
    expect(options.getAttribute('aria-busy')).toBe('true')
    expect(sidebarMocks.alertNormal).not.toHaveBeenCalled()

    command.resolve({ revision: 11, status: 'ok' })
    await flushCommandWork()

    expect(options.getAttribute('aria-busy')).toBe('false')
    expect(sidebarMocks.alertError).not.toHaveBeenCalled()
    expect(sidebarMocks.alertNormal).toHaveBeenCalledWith('Persona bound')
  })

  it('reports a retained persona binding as queued without reverting the visible state', async () => {
    seedSidebarDatabase()
    getDatabase().personas = [{ id: 'persona-selected', name: 'Selected Persona' }] as never
    sidebarMocks.setServerCommandsEnabled(true)
    setResourceWriteGuardEnabled(true)
    sidebarMocks.alertChatOptions.mockResolvedValueOnce(1)
    sidebarMocks.alertConfirm.mockResolvedValueOnce(true)
    sidebarMocks.runServerCommand.mockImplementationOnce(async (input) => input.command(10))
    const command = sidebarMocks.createDeferredUpdateCommand()

    component = mount(SideChatListHarness, { target })
    await tick()

    const options = rowActionButton(rowByChatId('chat-root-a'), 'options')
    options.click()
    await flushCommandWork()

    expect(selectedCharacter().chats[0].bindedPersona).toBe('persona-selected')
    command.resolve({ status: 'unavailable' })
    await flushCommandWork()

    expect(selectedCharacter().chats[0].bindedPersona).toBe('persona-selected')
    expect(sidebarMocks.rollbackServerBackedChatRowMetadata).not.toHaveBeenCalled()
    expect(sidebarMocks.alertError).not.toHaveBeenCalled()
    expect(sidebarMocks.alertNormal).toHaveBeenCalledWith('Persona binding queued')
  })

  it('navigates when selecting a sidebar row and reflects the route-applied selection', async () => {
    const chara = seedSidebarDatabase()

    component = mount(SideChatListHarness, { target })
    await tick()

    expectRowSelected('chat-foldered', true)

    selectButtonForRow(rowByChatId('chat-root-b')).click()
    await tick()

    expect(sidebarMocks.navigate).toHaveBeenCalledWith('/character/char-a/chat-root-b')
    expect(sidebarMocks.updateChatCommand).not.toHaveBeenCalled()
    expect(chara.chatPage).toBe(1)
    expectRowSelected('chat-foldered', true)
    expectRowSelected('chat-root-b', false)

    chara.chatPage = 2
    await tick()

    expectRowSelected('chat-foldered', false)
    expectRowSelected('chat-root-b', true)
  })

  it('optimistically selects a sidebar row through command fallback and restores on failure', async () => {
    const chara = seedSidebarDatabase()
    chara.chatPage = 0
    removeCharacterId(chara)
    sidebarMocks.setServerCommandsEnabled(true)
    const command = sidebarMocks.createDeferredSelectCommand()

    component = mount(SideChatListHarness, { target })
    await tick()

    expectRowSelected('chat-root-a', true)
    expectRowSelected('chat-root-b', false)

    selectButtonForRow(rowByChatId('chat-root-b')).click()
    await tick()

    expect(sidebarMocks.navigate).not.toHaveBeenCalled()
    expect(command.settled).toBe(false)
    expect(command.input).toMatchObject({
      chatId: 'chat-root-b',
      patch: {},
      select: true,
    })
    expect(chara.chatPage).toBe(2)
    expectRowSelected('chat-root-a', false)
    expectRowSelected('chat-root-b', true)

    command.resolve({ error: 'select failed', status: 'error' })
    await flushCommandWork()

    expect(chara.chatPage).toBe(0)
    expectRowSelected('chat-root-a', true)
    expectRowSelected('chat-root-b', false)
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
    expectRowSelected(createdChat.id, true)
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

    const createdChat = selectedCharacter().chats[0]
    expectRowSelected(createdChat.id, true)
    expect(selectedCharacter().chats.map((chat) => chat.name)).toEqual([
      'New Chat 4',
      'Root Chat A',
      'Foldered Chat',
      'Root Chat B',
    ])

    command.resolve({ error: 'create failed', status: 'error' })
    await flushCommandWork()

    expect(chatRows().map((row) => row.dataset.risuChatId)).toEqual(['chat-foldered', 'chat-root-a', 'chat-root-b'])
    expect(selectedCharacter().chats.map((chat) => chat.name)).toEqual(['Root Chat A', 'Foldered Chat', 'Root Chat B'])
    expect(selectedCharacter().chatPage).toBe(1)
    expectRowSelected('chat-foldered', true)
    expect(target.textContent).not.toContain('New Chat 4')
  })

  it('shows a newly created sidebar folder before the command resolves', async () => {
    seedSidebarDatabase()
    sidebarMocks.setServerCommandsEnabled(true)
    setResourceWriteGuardEnabled(true)
    const command = sidebarMocks.createDeferredCreateFolderCommand()

    component = mount(SideChatListHarness, { target })
    await tick()
    const initialSortables = [...sidebarMocks.SortableMock.instances]

    createFolderButton().click()
    await flushCommandWork()

    const createdFolder = selectedCharacter().chatFolders[0]
    expect(command.settled).toBe(false)
    expect(createdFolder.name).toBe('New Folder 2')
    expect(folderElementById(createdFolder.id).textContent).toContain('New Folder 2')
    expect(selectedCharacter().chatFolders.map((folder) => folder.name)).toEqual(['New Folder 2', 'Pinned Folder'])
    expect(command.input).toMatchObject({
      characterId: 'char-a',
      folder: {
        id: createdFolder.id,
        name: 'New Folder 2',
        folded: false,
      },
    })
    expect(initialSortables.every((sortable) => sortable.destroy.mock.calls.length === 1)).toBe(true)
    expect(activeSortablesForElement(folderPanelById(createdFolder.id))).toHaveLength(1)

    command.resolve({ revision: 12, status: 'ok' })
    await flushCommandWork()
  })

  it('rolls back a failed optimistic sidebar folder create in state and DOM', async () => {
    seedSidebarDatabase()
    sidebarMocks.setServerCommandsEnabled(true)
    setResourceWriteGuardEnabled(true)
    const command = sidebarMocks.createDeferredCreateFolderCommand()

    component = mount(SideChatListHarness, { target })
    await tick()

    createFolderButton().click()
    await flushCommandWork()

    const createdFolderId = selectedCharacter().chatFolders[0].id
    const createdFolderPanel = folderPanelById(createdFolderId)
    const [createdFolderSortable] = activeSortablesForElement(createdFolderPanel)
    expect(createdFolderSortable).toBeTruthy()
    expect(folderElementById(createdFolderId).textContent).toContain('New Folder 2')
    expect(selectedCharacter().chatFolders.map((folder) => folder.name)).toEqual(['New Folder 2', 'Pinned Folder'])

    command.resolve({ error: 'create folder failed', status: 'error' })
    await flushCommandWork()

    expect(selectedCharacter().chatFolders.map((folder) => folder.name)).toEqual(['Pinned Folder'])
    expect(sidebarRoot().querySelector(`[data-risu-chat-folder-id="${createdFolderId}"]`)).toBeNull()
    expect(target.textContent).not.toContain('New Folder 2')
    expect(createdFolderSortable.destroy).toHaveBeenCalledOnce()
    // Svelte may recycle the panel element for the remaining keyed position;
    // its old Sortable is still destroyed and exactly one fresh listener wins.
    expect(createdFolderPanel.dataset.risuChatFolderPanelId).toBe('folder-a')
    expect(activeSortablesForElement(createdFolderPanel)).toHaveLength(1)
  })

  it('removes a confirmed root sidebar chat before the delete command resolves', async () => {
    const chara = seedSidebarDatabase()
    chara.chatPage = 2
    sidebarMocks.setServerCommandsEnabled(true)
    sidebarMocks.alertConfirm.mockResolvedValueOnce(true)
    const command = sidebarMocks.createDeferredDeleteCommand()

    component = mount(SideChatListHarness, { target })
    await tick()

    expectRowSelected('chat-root-b', true)

    deleteButtonForRow(rowByChatId('chat-root-b')).click()
    await flushCommandWork()

    expect(command.settled).toBe(false)
    expect(command.input).toMatchObject({ chatId: 'chat-root-b' })
    expect(selectedCharacter().chats.map((chat) => chat.name)).toEqual(['Root Chat A', 'Foldered Chat'])
    expect(selectedCharacter().chatPage).toBe(1)
    expect(target.textContent).not.toContain('Root Chat B')
    expectRowSelected('chat-foldered', true)
    expect(sidebarMocks.navigate).toHaveBeenCalledWith('/character/char-a/chat-foldered', {
      replace: true,
    })

    command.resolve({ revision: 12, status: 'ok' })
    await flushCommandWork()
  })

  it('keeps the chat-list route when deleting a non-selected chat', async () => {
    const chara = seedSidebarDatabase()
    chara.chatPage = 0
    sidebarMocks.setServerCommandsEnabled(true)
    sidebarMocks.alertConfirm.mockResolvedValueOnce(true)
    const command = sidebarMocks.createDeferredDeleteCommand()

    component = mount(SideChatListHarness, { target })
    await tick()

    expectRowSelected('chat-root-a', true)
    deleteButtonForRow(rowByChatId('chat-root-b')).click()
    await flushCommandWork()

    expect(command.settled).toBe(false)
    expect(selectedCharacter().chats.map((chat) => chat.name)).toEqual(['Root Chat A', 'Foldered Chat'])
    expect(selectedCharacter().chatPage).toBe(0)
    expectRowSelected('chat-root-a', true)
    expect(sidebarMocks.navigate).not.toHaveBeenCalled()

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

    expectRowSelected('chat-foldered', true)

    deleteButtonForRow(rowByChatId('chat-foldered')).click()
    await flushCommandWork()

    expect(command.settled).toBe(false)
    expect(command.input).toMatchObject({ chatId: 'chat-foldered' })
    expect(selectedCharacter().chats.map((chat) => chat.name)).toEqual(['Root Chat A', 'Root Chat B'])
    expect(selectedCharacter().chatPage).toBe(1)
    expect(target.textContent).not.toContain('Foldered Chat')
    expectRowSelected('chat-root-b', true)

    command.resolve({ error: 'delete failed', status: 'error' })
    await flushCommandWork()

    expect(selectedCharacter().chats.map((chat) => chat.name)).toEqual(['Root Chat A', 'Foldered Chat', 'Root Chat B'])
    expect(selectedCharacter().chatPage).toBe(1)
    expect(chatRows().map((row) => row.dataset.risuChatId)).toEqual(['chat-foldered', 'chat-root-a', 'chat-root-b'])
    expectRowSelected('chat-foldered', true)
  })

  it('reports the one-chat sidebar delete guard and leaves the row unchanged', async () => {
    const chara = seedSidebarDatabase()
    chara.chatPage = 0
    chara.chatFolders = []
    chara.chats = [makeChat('chat-only', 'Only Chat')]
    sidebarMocks.setServerCommandsEnabled(true)

    component = mount(SideChatListHarness, { target })
    await tick()

    deleteButtonForRow(rowByChatId('chat-only')).click()
    await tick()

    expect(sidebarMocks.alertError).toHaveBeenCalledWith('Only one chat')
    expect(sidebarMocks.alertConfirm).not.toHaveBeenCalled()
    expect(sidebarMocks.deleteChatCommand).not.toHaveBeenCalled()
    expect(selectedCharacter().chats.map((chat) => chat.name)).toEqual(['Only Chat'])
    expect(selectedCharacter().chatPage).toBe(0)
    expect(chatRows().map((row) => row.dataset.risuChatId)).toEqual(['chat-only'])
    expectRowSelected('chat-only', true)
  })
})
