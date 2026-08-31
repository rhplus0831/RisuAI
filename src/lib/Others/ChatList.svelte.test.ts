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
  let createOutcomeOverride: ((...args: any[]) => Promise<any>) | undefined
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
      return () => currentRouteSubscribers.delete(run)
    },
  }

  function setCurrentRoute(value: unknown): void {
    currentRouteValue = value
    currentRouteSubscribers.forEach((run) => run(value))
  }

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
    alertNormal: vi.fn(),
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
    createDeferredUpdateCommand: createDeferredCommand,
    deleteChatCommand: vi.fn((input: unknown) => {
      if (!pendingDeleteCommand) {
        throw new Error('No deferred delete-chat command was prepared')
      }
      pendingDeleteCommand.input = input
      return pendingDeleteCommand.promise
    }),
    deleteChatFolderCommand: unusedCommand,
    deleteMessageCommand: unusedCommand,
    dispatchUpdateChatWithOutcome: vi.fn(async (..._args: any[]) => ({
      status: 'accepted',
      result: okCommandResult(),
    })),
    exportChat: vi.fn(),
    forkChatCommand: unusedCommand,
    importChat: vi.fn(),
    navigate: vi.fn(),
    currentRoute,
    patchChatScriptstateCommand: unusedCommand,
    reorderChatFoldersCommand: unusedCommand,
    reorderChatsCommand: unusedCommand,
    replaceMessagesCommand: unusedCommand,
    resetCommandHarness: () => {
      pendingCreateCommand = undefined
      pendingDeleteCommand = undefined
      pendingSelectCommand = undefined
      createOutcomeOverride = undefined
      serverCommandsEnabled = false
      setCurrentRoute({
        kind: 'character',
        path: '/character/char-a',
        chaId: 'char-a',
      })
    },
    runServerCommand: vi.fn(
      async (input: {
        command: (baseRevision: number) => Promise<any>
        rollback?: () => void
        failureRollbackDisposition?: (failure: any) => 'retain' | 'rollback'
      }) => {
        if (!serverCommandsEnabled) return { status: 'unavailable' }
        try {
          const result = await input.command(10)
          if (result.status !== 'ok' && (input.failureRollbackDisposition?.(result) ?? 'rollback') === 'rollback') {
            input.rollback?.()
          }
          return result
        } catch (error) {
          const result = {
            error: error instanceof Error ? error.message : String(error),
            status: 'error',
          }
          if ((input.failureRollbackDisposition?.(result) ?? 'rollback') === 'rollback') input.rollback?.()
          return result
        }
      },
    ),
    setServerCommandsEnabled: (enabled: boolean) => {
      serverCommandsEnabled = enabled
    },
    setCreateOutcomeOverride: (override: ((...args: any[]) => Promise<any>) | undefined) => {
      createOutcomeOverride = override
    },
    dispatchCreateChatWithOutcome: (...args: any[]) => createOutcomeOverride?.(...args),
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
      return okCommandResult()
    }),
    updateChatFolderCommand: unusedCommand,
    updateMessageCommand: unusedCommand,
    withTestDatabaseWrite: vi.fn((callback: () => void) => callback()),
  }
})

vi.mock('../../lang', () => ({
  language: {
    chatList: 'Chat List',
    chatCreateProvisional: (name: string) => `${name} is provisional`,
    chatStructureFailed: (action: string) => `${action} failed`,
    chatStructurePending: (action: string) => `Saving ${action}`,
    chatStructureQueued: (action: string) => `${action} queued`,
    close: 'Close',
    edit: 'Edit',
    errors: { onlyOneChat: 'Only one chat' },
    export: 'Export',
    import: 'Import',
    newChat: 'New Chat',
    remove: 'Remove',
    removeConfirm: 'Remove ',
  },
}))

vi.mock('../../ts/alert', () => ({
  alertConfirm: chatListMocks.alertConfirm,
  alertError: chatListMocks.alertError,
  alertNormal: chatListMocks.alertNormal,
}))

vi.mock('../../ts/characters', () => ({
  exportChat: chatListMocks.exportChat,
  importChat: chatListMocks.importChat,
}))

vi.mock('src/ts/chatCommands', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/chatCommands')>()
  return {
    ...actual,
    dispatchCreateChatWithOutcome: (...args: Parameters<typeof actual.dispatchCreateChatWithOutcome>) =>
      chatListMocks.dispatchCreateChatWithOutcome(...args) ?? actual.dispatchCreateChatWithOutcome(...args),
    dispatchUpdateChatWithOutcome: chatListMocks.dispatchUpdateChatWithOutcome,
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
  currentRoute: chatListMocks.currentRoute,
  navigate: chatListMocks.navigate,
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

import ChatList from './ChatList.svelte'
import { selectedCharID } from 'src/ts/stores.svelte'
import { currentChatSelectionSnapshot, dispatchSelectChat, restoreChatRowMetadata } from 'src/ts/chatCommands'
import { charactersResourceState, replaceResourceDatabase as setDatabaseLite } from 'src/ts/server/resourceState.svelte'

import type { Chat, character } from 'src/ts/storage/database.svelte'
import { getResourceDatabase as getDatabase, withTestDatabaseWrite } from 'src/ts/__tests__/resourceDatabaseState'

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
    currentChar: 0,
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

function chatRows(): HTMLElement[] {
  return Array.from(modalRoot().querySelectorAll<HTMLElement>('[data-risu-chat-id]'))
}

function rowByChatId(chatId: string): HTMLElement {
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

  it('renders chat metadata from the hydrated character owner when it conflicts with the aggregate', async () => {
    const aggregate = seedModalDatabase()
    charactersResourceState.characters = [
      {
        ...aggregate,
        chats: aggregate.chats.map((chat, index) => ({ ...chat, name: `Owner Chat ${index}` })),
      },
    ]

    component = mount(ChatList, { target, props: { close: vi.fn() } })
    await flushCommandWork()

    expect(rowByChatId('chat-a').textContent).toContain('Owner Chat 0')
    expect(rowByChatId('chat-a').textContent).not.toContain('Modal Chat A')
  })

  it('fails closed when the modal character stable id is duplicated', async () => {
    const chara = seedModalDatabase()
    withTestDatabaseWrite(() => {
      getDatabase().characters.push({ ...chara, chats: chara.chats.map((chat) => ({ ...chat })) })
    })

    component = mount(ChatList, { target, props: { close: vi.fn() } })
    await tick()

    expect(target.querySelector('[data-risu-chat-list="modal"]')).toBeNull()
    expect(chatListMocks.navigate).not.toHaveBeenCalled()
  })

  it('fails closed on character owner errors and duplicate or missing chat ids', async () => {
    const chara = seedModalDatabase()
    withTestDatabaseWrite(() => {
      getDatabase().characters.push({
        ...chara,
        chaId: 'char-b',
        chats: [makeChat('chat-b', 'Duplicate Chat')],
      })
    })

    component = mount(ChatList, { target, props: { close: vi.fn() } })
    await tick()
    expect(target.querySelector('[data-risu-chat-list="modal"]')).toBeNull()

    unmount(component)
    component = undefined
    const missingIdOwner = seedModalDatabase()
    missingIdOwner.chats[0].id = ''
    component = mount(ChatList, { target, props: { close: vi.fn() } })
    await tick()
    expect(target.querySelector('[data-risu-chat-list="modal"]')).toBeNull()

    unmount(component)
    component = undefined
    seedModalDatabase()
    charactersResourceState.rowStatuses['char-a'] = 'error'
    component = mount(ChatList, { target, props: { close: vi.fn() } })
    await tick()
    expect(target.querySelector('[data-risu-chat-list="modal"]')).toBeNull()

    unmount(component)
    component = undefined
    seedModalDatabase()
    charactersResourceState.status = 'error'
    component = mount(ChatList, { target, props: { close: vi.fn() } })
    await tick()
    expect(target.querySelector('[data-risu-chat-list="modal"]')).toBeNull()
  })

  it('uses a blocking focus contract and owns Escape and backdrop close interactions', async () => {
    seedModalDatabase()
    const opener = document.createElement('button')
    opener.textContent = 'Open chat list'
    document.body.insertBefore(opener, target)
    opener.focus()
    const close = vi.fn()

    component = mount(ChatList, { target, props: { close } })
    await flushCommandWork()

    const backdrop = modalRoot()
    const dialog = backdrop.querySelector<HTMLElement>('[role="dialog"]')
    const initialFocus = dialog?.querySelector<HTMLButtonElement>('[data-modal-initial-focus]')
    if (!dialog || !initialFocus) throw new Error('Chat list dialog not found')
    expect(backdrop.hasAttribute('data-modal-root')).toBe(true)
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBe('risu-chat-list-title')
    expect(opener.inert).toBe(true)
    expect(document.activeElement).toBe(initialFocus)

    const last = dialog.querySelector<HTMLButtonElement>('[data-risu-chat-action="edit"]')
    if (!last) throw new Error('Chat list final focus target not found')
    last.focus()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    last.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(initialFocus)

    dialog.click()
    expect(close).not.toHaveBeenCalled()
    backdrop.click()
    expect(close).toHaveBeenCalledOnce()
    close.mockClear()

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    initialFocus.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(close).toHaveBeenCalledOnce()

    unmount(component)
    component = undefined
    await flushCommandWork()
    expect(opener.inert).toBe(false)
    expect(document.activeElement).toBe(opener)
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
  })

  it('closes and removes an open modal when the route clears the selected character', async () => {
    seedModalDatabase()
    const close = vi.fn()

    component = mount(ChatList, { target, props: { close } })
    await tick()
    expect(modalRoot()).toBeTruthy()

    charactersResourceState.currentChar = -1
    selectedCharID.set(-1)
    await tick()

    expect(target.querySelector('[data-risu-chat-list="modal"]')).toBeNull()
    expect(close).toHaveBeenCalledOnce()

    charactersResourceState.currentChar = 0
    selectedCharID.set(0)
    await tick()
    expect(target.querySelector('[data-risu-chat-list="modal"]')).toBeNull()
  })

  it('does not let stale modal actions target a newly selected character', async () => {
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
    const close = vi.fn()

    component = mount(ChatList, { target, props: { close } })
    await tick()

    const staleCreateButton = createButton()
    const staleOpenButton = rowActionButton(rowByChatId('chat-c'), 'open')
    const staleExportButton = rowActionButton(rowByChatId('chat-c'), 'export')
    const staleDeleteButton = rowActionButton(rowByChatId('chat-c'), 'delete')
    const staleImportButton = modalRoot().querySelector<HTMLButtonElement>('[data-risu-chat-action="import"]')!

    charactersResourceState.currentChar = 1
    selectedCharID.set(1)
    staleCreateButton.click()
    staleOpenButton.click()
    staleExportButton.click()
    staleDeleteButton.click()
    staleImportButton.click()
    await tick()

    expect(target.querySelector('[data-risu-chat-list="modal"]')).toBeNull()
    expect(close).toHaveBeenCalledOnce()
    expect(charA.chats.map((chat) => chat.id)).toEqual(['chat-a', 'chat-b', 'chat-c'])
    expect(charB.chats.map((chat) => chat.id)).toEqual(['other-chat-a', 'other-chat-b'])
    expect(chatListMocks.changeChatTo).not.toHaveBeenCalled()
    expect(chatListMocks.alertConfirm).not.toHaveBeenCalled()
    expect(chatListMocks.exportChat).not.toHaveBeenCalled()
    expect(chatListMocks.importChat).not.toHaveBeenCalled()
    expect(chatListMocks.navigate).not.toHaveBeenCalled()
  })

  it('passes stable character and chat ids to modal exports', async () => {
    const chara = seedModalDatabase()

    component = mount(ChatList, { target, props: { close: vi.fn() } })
    await tick()

    rowActionButton(rowByChatId('chat-c'), 'export').click()
    chara.chats.reverse()
    await tick()

    expect(chatListMocks.exportChat).toHaveBeenCalledWith({
      characterId: 'char-a',
      chatId: 'chat-c',
    })
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

    expect(chatListMocks.canUseServerCommands).toHaveBeenCalled()
    expect(chatListMocks.withTestDatabaseWrite).not.toHaveBeenCalled()
    expect(chatListMocks.dispatchUpdateChatWithOutcome).toHaveBeenCalledOnce()
    const [chatId, patch, previous] = chatListMocks.dispatchUpdateChatWithOutcome.mock.calls[0]
    expect(chatId).toBe('chat-b')
    expect(patch).toEqual({ name: 'Renamed Modal Chat B' })
    expect(chatListMocks.dispatchUpdateChatWithOutcome.mock.calls[0][4]).toBe(restoreChatRowMetadata)
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

  it('keeps a pending rename enabled and supersedes it without an older failure clobbering the draft', async () => {
    seedModalDatabase()
    chatListMocks.setServerCommandsEnabled(true)
    const firstRename = chatListMocks.createDeferredUpdateCommand()
    const finalRename = chatListMocks.createDeferredUpdateCommand()
    chatListMocks.dispatchUpdateChatWithOutcome
      .mockImplementationOnce(async (chatId, patch, previous, _select, rollback) => {
        const outcome = (await firstRename.promise) as any
        if (outcome.status === 'failed') {
          const previousChat = previous.characters[0].chats.find((candidate) => candidate.id === chatId)
          rollback({
            selectedCharID: previous.selectedCharID,
            characterId: previous.characters[0].chaId,
            chatId,
            metadata: { name: previousChat?.name },
            attempted: patch,
          })
        }
        return outcome
      })
      .mockImplementationOnce(() => finalRename.promise as Promise<any>)

    component = mount(ChatList, { target, props: { close: vi.fn() } })
    await tick()
    editButton().click()
    await tick()

    const input = rowByChatId('chat-b').querySelector<HTMLInputElement>('input')!
    input.value = 'First Modal Rename'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()

    expect(input.disabled).toBe(false)
    input.focus()
    expect(document.activeElement).toBe(input)

    input.value = 'Final Modal Rename'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await flushCommandWork()

    expect(chatListMocks.dispatchUpdateChatWithOutcome).toHaveBeenCalledTimes(2)
    expect(chatListMocks.dispatchUpdateChatWithOutcome.mock.calls.map((call) => call[1])).toEqual([
      { name: 'First Modal Rename' },
      { name: 'Final Modal Rename' },
    ])

    firstRename.resolve({ status: 'failed', result: { status: 'error', error: 'rename failed' } })
    await flushCommandWork()

    expect(selectedCharacter().chats[1].name).toBe('Final Modal Rename')
    expect(rowByChatId('chat-b').querySelector<HTMLInputElement>('input')?.value).toBe('Final Modal Rename')
    expect(chatListMocks.alertError).toHaveBeenCalledWith('Edit: First Modal Rename failed')
    expect(modalRoot().querySelector('[role="alert"]')?.textContent).toContain('Edit: First Modal Rename failed')
    expect(
      modalRoot().querySelectorAll(
        '[data-risu-chat-mutation][data-risu-chat-mutation-status="pending"][role="status"]',
      ),
    ).toHaveLength(0)
    expect(rowByChatId('chat-b').dataset.risuChatMutationStatus).toBe('pending')

    finalRename.resolve({ status: 'accepted', result: { revision: 2, status: 'ok' } })
    await flushCommandWork()

    expect(modalRoot().querySelector('[role="alert"]')).toBeNull()
    expect(
      modalRoot().querySelectorAll('[data-risu-chat-mutation][data-risu-chat-mutation-status="failed"]'),
    ).toHaveLength(0)
    expect(rowByChatId('chat-b').dataset.risuChatMutationStatus).toBe('')
  })

  it('clears a failed rename ledger entry when a later retry succeeds', async () => {
    seedModalDatabase()
    chatListMocks.setServerCommandsEnabled(true)
    const failedRename = chatListMocks.createDeferredUpdateCommand()
    chatListMocks.dispatchUpdateChatWithOutcome.mockImplementationOnce(() => failedRename.promise as Promise<any>)

    component = mount(ChatList, { target, props: { close: vi.fn() } })
    await tick()
    editButton().click()
    await tick()

    const input = rowByChatId('chat-b').querySelector<HTMLInputElement>('input')!
    input.value = 'Failed Modal Rename'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    failedRename.resolve({ status: 'failed', result: { status: 'error', error: 'rename failed' } })
    await flushCommandWork()

    expect(modalRoot().querySelectorAll('[data-risu-chat-mutation-status="failed"][role="alert"]')).toHaveLength(1)

    input.value = 'Successful Modal Retry'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await flushCommandWork()

    expect(modalRoot().querySelector('[role="alert"]')).toBeNull()
    expect(
      modalRoot().querySelectorAll('[data-risu-chat-mutation][data-risu-chat-mutation-status="failed"]'),
    ).toHaveLength(0)
    expect(rowByChatId('chat-b').dataset.risuChatMutationStatus).toBe('')
  })

  it('does not clear a newer pending rename when an older attempt succeeds', async () => {
    seedModalDatabase()
    chatListMocks.setServerCommandsEnabled(true)
    const firstRename = chatListMocks.createDeferredUpdateCommand()
    const secondRename = chatListMocks.createDeferredUpdateCommand()
    chatListMocks.dispatchUpdateChatWithOutcome
      .mockImplementationOnce(() => firstRename.promise as Promise<any>)
      .mockImplementationOnce(() => secondRename.promise as Promise<any>)

    component = mount(ChatList, { target, props: { close: vi.fn() } })
    await tick()
    editButton().click()
    await tick()

    const input = rowByChatId('chat-b').querySelector<HTMLInputElement>('input')!
    input.value = 'Older Modal Rename'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
    input.value = 'Newer Pending Modal Rename'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()

    firstRename.resolve({ status: 'accepted', result: { revision: 1, status: 'ok' } })
    await flushCommandWork()

    expect(
      modalRoot().querySelectorAll(
        '[data-risu-chat-mutation][data-risu-chat-mutation-status="pending"][role="status"]',
      ),
    ).toHaveLength(0)
    expect(rowByChatId('chat-b').dataset.risuChatMutationStatus).toBe('pending')

    secondRename.resolve({ status: 'accepted', result: { revision: 2, status: 'ok' } })
    await flushCommandWork()
    expect(rowByChatId('chat-b').dataset.risuChatMutationStatus).toBe('')
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

    rowActionButton(rowByChatId('chat-c'), 'open').click()
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

  it('fails the modal closed while character owners are loading', async () => {
    seedModalDatabase()
    charactersResourceState.status = 'loading'
    chatListMocks.setServerCommandsEnabled(true)
    const close = vi.fn()

    component = mount(ChatList, { target, props: { close } })
    await tick()

    expect(target.querySelector('[data-risu-chat-list-modal]')).toBeNull()
    expect(chatListMocks.navigate).not.toHaveBeenCalled()
    expect(chatListMocks.updateChatCommand).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })

  it('shows a pending modal chat but waits for acceptance before navigating and closing', async () => {
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
    expect(rowByChatId(createdChat.id).dataset.risuChatMutationStatus).toBe('pending')
    expect(chatListMocks.navigate).not.toHaveBeenCalled()
    expect(command.input).toMatchObject({
      characterId: 'char-a',
      select: true,
    })
    expect(close).not.toHaveBeenCalled()

    command.resolve({ revision: 11, status: 'ok' })
    await flushCommandWork()

    expect(chatListMocks.navigate).toHaveBeenCalledWith(`/character/char-a/${createdChat.id}`)
    expect(close).toHaveBeenCalledOnce()
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
    expect(close).not.toHaveBeenCalled()

    command.resolve({ error: 'create failed', status: 'error' })
    await flushCommandWork()

    expect(chatRows().map((row) => row.dataset.risuChatId)).toEqual(['chat-a', 'chat-b', 'chat-c'])
    expect(selectedCharacter().chats.map((chat) => chat.name)).toEqual(['Modal Chat A', 'Modal Chat B', 'Modal Chat C'])
    expect(selectedCharacter().chatPage).toBe(1)
    expectRowSelected('chat-b', true)
    expect(chatListMocks.navigate).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    expect(modalRoot().querySelector('[data-risu-chat-mutation-status="failed"]')).toBeTruthy()
  })

  it('labels a retained modal create as provisional before navigating', async () => {
    seedModalDatabase()
    chatListMocks.setServerCommandsEnabled(true)
    let resolveOutcome!: (outcome: any) => void
    let resolveSettlement!: (outcome: any) => void
    const settlement = new Promise((resolve) => {
      resolveSettlement = resolve
    })
    chatListMocks.setCreateOutcomeOverride(
      () =>
        new Promise((resolve) => {
          resolveOutcome = resolve
        }),
    )
    const close = vi.fn()

    component = mount(ChatList, { target, props: { close } })
    await tick()

    createButton().click()
    await tick()
    const createdChat = selectedCharacter().chats[0]
    expect(chatListMocks.navigate).not.toHaveBeenCalled()

    resolveOutcome({
      status: 'queued',
      result: { status: 'unavailable' },
      mutationIds: ['queued-modal-create'],
      settlement,
    })
    await flushCommandWork()

    expect(selectedCharacter().chats[0].id).toBe(createdChat.id)
    expect(chatListMocks.alertNormal).toHaveBeenCalledWith(`${createdChat.name} is provisional`)
    expect(chatListMocks.navigate).toHaveBeenCalledWith(`/character/char-a/${createdChat.id}`)
    expect(close).toHaveBeenCalledOnce()
    expect(modalRoot().querySelector('[data-risu-chat-mutation][data-risu-chat-mutation-status="queued"]')).toBeNull()

    resolveSettlement({ status: 'accepted' })
    await flushCommandWork()
    expect(modalRoot().querySelector('[data-risu-chat-mutation-status="queued"]')).toBeNull()
  })

  it('recovers a rejected provisional route only while that provisional chat is still open', async () => {
    const chara = seedModalDatabase()
    chatListMocks.setServerCommandsEnabled(true)
    let resolveSettlement!: (outcome: any) => void
    const settlement = new Promise((resolve) => {
      resolveSettlement = resolve
    })
    chatListMocks.setCreateOutcomeOverride(async () => ({
      status: 'queued',
      result: { status: 'unavailable' },
      mutationIds: ['rejected-modal-create'],
      settlement,
    }))

    component = mount(ChatList, { target, props: { close: vi.fn() } })
    await tick()
    createButton().click()
    await flushCommandWork()
    const provisionalChatId = chara.chats[0].id
    chatListMocks.setCurrentRoute({
      kind: 'character',
      path: `/character/char-a/${provisionalChatId}`,
      chaId: 'char-a',
      chatId: provisionalChatId,
    })

    chara.chats.splice(0, 1)
    chara.chatPage = chara.chats.findIndex((chat) => chat.id === 'chat-b')
    resolveSettlement({ status: 'failed', result: { status: 'error', error: 'rejected' } })
    await flushCommandWork()

    expect(chatListMocks.navigate).toHaveBeenLastCalledWith('/character/char-a/chat-b', { replace: true })
    expect(modalRoot().querySelector('[data-risu-chat-mutation-status="failed"]')).toBeTruthy()
  })

  it('does not recover a rejected provisional create over newer modal navigation', async () => {
    const chara = seedModalDatabase()
    chatListMocks.setServerCommandsEnabled(true)
    let resolveSettlement!: (outcome: any) => void
    const settlement = new Promise((resolve) => {
      resolveSettlement = resolve
    })
    chatListMocks.setCreateOutcomeOverride(async () => ({
      status: 'queued',
      result: { status: 'unavailable' },
      mutationIds: ['stale-modal-create'],
      settlement,
    }))

    component = mount(ChatList, { target, props: { close: vi.fn() } })
    await tick()
    createButton().click()
    await flushCommandWork()
    chara.chats.splice(0, 1)
    chara.chatPage = chara.chats.findIndex((chat) => chat.id === 'chat-c')
    chatListMocks.setCurrentRoute({
      kind: 'character',
      path: '/character/char-a/chat-c',
      chaId: 'char-a',
      chatId: 'chat-c',
    })
    const navigationCount = chatListMocks.navigate.mock.calls.length

    resolveSettlement({ status: 'failed', result: { status: 'error', error: 'rejected' } })
    await flushCommandWork()

    expect(chatListMocks.navigate).toHaveBeenCalledTimes(navigationCount)
  })

  it('does not let an older accepted create hijack a newer modal route selection', async () => {
    const chara = seedModalDatabase()
    chatListMocks.setServerCommandsEnabled(true)
    const command = chatListMocks.createDeferredCreateCommand()
    const close = vi.fn()

    component = mount(ChatList, { target, props: { close } })
    await tick()

    createButton().click()
    await tick()
    chara.chatPage = chara.chats.findIndex((chat) => chat.id === 'chat-c')
    chatListMocks.setCurrentRoute({
      kind: 'character',
      path: '/character/char-a/chat-c',
      chaId: 'char-a',
      chatId: 'chat-c',
    })
    await tick()

    command.resolve({ revision: 11, status: 'ok' })
    await flushCommandWork()

    expect(chatListMocks.navigate).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
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
    expect(chatRows().map((row) => row.dataset.risuChatId)).toEqual(['chat-a', 'chat-c'])
    expectRowSelected('chat-c', true)
    expect(chatListMocks.navigate).not.toHaveBeenCalled()

    command.resolve({ error: 'delete failed', status: 'error' })
    await flushCommandWork()

    expect(selectedCharacter().chats.map((chat) => chat.name)).toEqual(['Modal Chat A', 'Modal Chat B', 'Modal Chat C'])
    expect(selectedCharacter().chatPage).toBe(1)
    expect(chatRows().map((row) => row.dataset.risuChatId)).toEqual(['chat-a', 'chat-b', 'chat-c'])
    expectRowSelected('chat-b', true)
    expect(chatListMocks.navigate).not.toHaveBeenCalled()
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
    const close = vi.fn()

    component = mount(ChatList, { target, props: { close } })
    await tick()

    deleteButtonForRow(rowByChatId('chat-b')).click()
    await tick()

    charactersResourceState.currentChar = 1
    selectedCharID.set(1)
    await tick()
    expect(target.querySelector('[data-risu-chat-list="modal"]')).toBeNull()
    expect(close).toHaveBeenCalledOnce()

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

  it('navigates a selected modal delete only after acceptance and ignores a newer route', async () => {
    const chara = seedModalDatabase()
    chatListMocks.setServerCommandsEnabled(true)
    chatListMocks.alertConfirm.mockResolvedValueOnce(true)
    const command = chatListMocks.createDeferredDeleteCommand()

    component = mount(ChatList, { target, props: { close: vi.fn() } })
    await tick()

    deleteButtonForRow(rowByChatId('chat-b')).click()
    await flushCommandWork()
    expect(chatListMocks.navigate).not.toHaveBeenCalled()

    chara.chatPage = chara.chats.findIndex((chat) => chat.id === 'chat-a')
    chatListMocks.setCurrentRoute({
      kind: 'character',
      path: '/character/char-a/chat-a',
      chaId: 'char-a',
      chatId: 'chat-a',
    })
    await tick()

    command.resolve({ revision: 11, status: 'ok' })
    await flushCommandWork()

    expect(chatListMocks.navigate).not.toHaveBeenCalled()
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
