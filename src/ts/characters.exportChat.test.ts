import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const exportMocks = vi.hoisted(() => ({
  alertError: vi.fn(),
  alertNormal: vi.fn(),
  alertSelect: vi.fn(),
  downloadFile: vi.fn(),
  ensureAllChatsHydrated: vi.fn(),
  hydrateChatMessages: vi.fn(),
}))

vi.mock('./alert', async (importActual) => {
  const actual = await importActual<typeof import('./alert')>()
  return {
    ...actual,
    alertError: exportMocks.alertError,
    alertNormal: exportMocks.alertNormal,
    alertSelect: exportMocks.alertSelect,
  }
})

vi.mock('./globalApi.svelte', async (importActual) => {
  const actual = await importActual<typeof import('./globalApi.svelte')>()
  return {
    ...actual,
    downloadFile: exportMocks.downloadFile,
  }
})

vi.mock('./server/chatMessageHydration.svelte', async (importActual) => {
  const actual = await importActual<typeof import('./server/chatMessageHydration.svelte')>()
  return {
    ...actual,
    ensureAllChatsHydrated: exportMocks.ensureAllChatsHydrated,
    hydrateChatMessages: exportMocks.hydrateChatMessages,
  }
})

vi.mock('./process/modules', () => ({
  getModuleAssets: () => [],
  getModuleLorebooks: () => [],
  getModuleRegexScripts: () => [],
  getModules: () => [],
  getModuleToggles: () => '',
  getModuleTriggers: () => [],
  moduleUpdate: vi.fn(),
}))

vi.mock('./process/scripts', () => ({
  resetScriptCache: vi.fn(),
}))

import { exportAllChats, exportChat } from './characters'
import { replaceResourceDatabase } from './server/resourceState.svelte'
import { selectedCharID } from './stores.svelte'
import type { Chat, character, Database } from './storage/database.svelte'

const clipboardWrite = vi.fn()

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

function makeChat(id: string, name: string, message: string): Chat {
  return {
    id,
    name,
    message: [{ role: 'user', data: message, chatId: `${id}-message` }],
    localLore: [],
    fmIndex: -1,
    note: '',
  } as Chat
}

function makeCharacter(id: string, name: string, chats: Chat[]): character {
  return {
    chaId: id,
    name,
    chatPage: 0,
    chats,
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
}

function setDatabase(characters: character[]): void {
  replaceResourceDatabase({
    characters,
    username: 'User',
  } as Database)
}

function downloadedJson(): Record<string, unknown> {
  const bytes = exportMocks.downloadFile.mock.calls[0]?.[1] as Uint8Array
  return JSON.parse(Buffer.from(bytes).toString('utf-8')) as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { write: clipboardWrite },
  })
  selectedCharID.set(0)
})

afterEach(() => {
  selectedCharID.set(-1)
  replaceResourceDatabase({} as Database)
})

describe('chat export stable targets', () => {
  it.each([
    { name: 'format selection', selections: [null] },
    { name: 'HTML translation selection', selections: ['2', null] },
    { name: 'HTML persona-name selection', selections: ['2', '1', null] },
  ])('does not hydrate or download after cancelling the $name', async ({ selections }) => {
    const targetChat = makeChat('chat-a-target', 'Target Chat', 'target message')
    setDatabase([makeCharacter('char-a', 'Character A', [targetChat])])
    for (const selection of selections) exportMocks.alertSelect.mockResolvedValueOnce(selection)

    await exportChat({ characterId: 'char-a', chatId: 'chat-a-target' })

    expect(exportMocks.alertSelect).toHaveBeenCalledTimes(selections.length)
    expect(exportMocks.hydrateChatMessages).not.toHaveBeenCalled()
    expect(exportMocks.downloadFile).not.toHaveBeenCalled()
    expect(exportMocks.alertError).not.toHaveBeenCalled()
  })

  it('keeps the clicked chat through deferred dialogs, hydration, selection changes, and reordering', async () => {
    const targetChat = makeChat('chat-a-target', 'Target Chat', 'target message')
    const otherChat = makeChat('chat-a-other', 'Other Chat', 'other message')
    const characterA = makeCharacter('char-a', 'Character A', [otherChat, targetChat])
    const characterB = makeCharacter('char-b', 'Character B', [makeChat('chat-b', 'Wrong Chat', 'wrong message')])
    setDatabase([characterA, characterB])

    const dialog = deferred<string>()
    const hydration = deferred<void>()
    exportMocks.alertSelect.mockReturnValueOnce(dialog.promise)
    exportMocks.hydrateChatMessages.mockReturnValueOnce(hydration.promise)

    const exporting = exportChat({ characterId: 'char-a', chatId: 'chat-a-target' })
    setDatabase([characterB, { ...characterA, chats: [targetChat, otherChat] } as character])
    selectedCharID.set(0)
    dialog.resolve('0')

    await vi.waitFor(() => {
      expect(exportMocks.hydrateChatMessages).toHaveBeenCalledWith('chat-a-target', { strict: true })
    })

    setDatabase([characterB, { ...characterA, chats: [otherChat, targetChat] } as character])
    hydration.resolve()
    await exporting

    expect(exportMocks.downloadFile).toHaveBeenCalledOnce()
    expect(downloadedJson()).toMatchObject({
      type: 'risuChat',
      data: {
        id: 'chat-a-target',
        name: 'Target Chat',
        message: [{ data: 'target message' }],
      },
    })
    expect(exportMocks.alertError).not.toHaveBeenCalled()
  })

  it('exports all chats for the original character after hydration reorders characters and changes selection', async () => {
    const characterA = makeCharacter('char-a', 'Character A', [
      makeChat('chat-a-1', 'Chat A1', 'a1'),
      makeChat('chat-a-2', 'Chat A2', 'a2'),
    ])
    const characterB = makeCharacter('char-b', 'Character B', [makeChat('chat-b', 'Wrong Chat', 'wrong')])
    setDatabase([characterA, characterB])

    const hydration = deferred<void>()
    exportMocks.ensureAllChatsHydrated.mockReturnValueOnce(hydration.promise)

    const exporting = exportAllChats('char-a')
    setDatabase([characterB, { ...characterA, chats: [...characterA.chats].reverse() } as character])
    selectedCharID.set(0)
    hydration.resolve()
    await expect(exporting).resolves.toBe(true)

    expect(exportMocks.ensureAllChatsHydrated).toHaveBeenCalledWith({ strict: true })
    expect(downloadedJson()).toMatchObject({
      type: 'risuAllChats',
      data: [{ id: 'chat-a-2' }, { id: 'chat-a-1' }],
    })
    expect(exportMocks.downloadFile.mock.calls[0]?.[0]).toContain('Character A_all_chats_')
    expect(exportMocks.alertError).not.toHaveBeenCalled()
  })

  it('aborts without downloading when a target vanishes during an export await', async () => {
    const targetChat = makeChat('chat-a-target', 'Target Chat', 'target')
    const characterA = makeCharacter('char-a', 'Character A', [targetChat])
    setDatabase([characterA])

    const dialog = deferred<string>()
    exportMocks.alertSelect.mockReturnValueOnce(dialog.promise)

    const exporting = exportChat({ characterId: 'char-a', chatId: 'chat-a-target' })
    setDatabase([])
    dialog.resolve('0')
    await exporting

    expect(exportMocks.hydrateChatMessages).not.toHaveBeenCalled()
    expect(exportMocks.downloadFile).not.toHaveBeenCalled()
    expect(exportMocks.alertError).not.toHaveBeenCalled()
  })

  it('alerts and creates no artifact when strict chat hydration fails', async () => {
    const targetChat = makeChat('chat-a-target', 'Target Chat', 'stale shell message')
    setDatabase([makeCharacter('char-a', 'Character A', [targetChat])])
    const hydrationError = new Error('strict hydration failed')
    exportMocks.alertSelect.mockResolvedValueOnce('0')
    exportMocks.hydrateChatMessages.mockRejectedValueOnce(hydrationError)

    await exportChat({ characterId: 'char-a', chatId: 'chat-a-target' })

    expect(exportMocks.hydrateChatMessages).toHaveBeenCalledWith('chat-a-target', { strict: true })
    expect(exportMocks.alertError).toHaveBeenCalledOnce()
    expect(exportMocks.alertError).toHaveBeenCalledWith(hydrationError)
    expect(exportMocks.downloadFile).not.toHaveBeenCalled()
    expect(clipboardWrite).not.toHaveBeenCalled()
    expect(exportMocks.alertNormal).not.toHaveBeenCalled()
  })

  it('aborts without downloading when the chat vanishes during hydration', async () => {
    const targetChat = makeChat('chat-a-target', 'Target Chat', 'target')
    const characterA = makeCharacter('char-a', 'Character A', [targetChat])
    setDatabase([characterA])

    const hydration = deferred<void>()
    exportMocks.alertSelect.mockResolvedValueOnce('0')
    exportMocks.hydrateChatMessages.mockReturnValueOnce(hydration.promise)

    const exporting = exportChat({ characterId: 'char-a', chatId: 'chat-a-target' })
    await vi.waitFor(() => {
      expect(exportMocks.hydrateChatMessages).toHaveBeenCalledWith('chat-a-target', { strict: true })
    })
    setDatabase([{ ...characterA, chats: [] } as character])
    hydration.resolve()
    await exporting

    expect(exportMocks.downloadFile).not.toHaveBeenCalled()
    expect(exportMocks.alertError).not.toHaveBeenCalled()
  })

  it('aborts export-all when its character vanishes during hydration', async () => {
    const characterA = makeCharacter('char-a', 'Character A', [makeChat('chat-a', 'Chat A', 'a')])
    setDatabase([characterA])

    const hydration = deferred<void>()
    exportMocks.ensureAllChatsHydrated.mockReturnValueOnce(hydration.promise)

    const exporting = exportAllChats('char-a')
    setDatabase([])
    hydration.resolve()
    await expect(exporting).resolves.toBe(false)

    expect(exportMocks.downloadFile).not.toHaveBeenCalled()
    expect(exportMocks.alertError).not.toHaveBeenCalled()
  })

  it('reports a failed all-chat download to its caller', async () => {
    const downloadError = new Error('download failed')
    setDatabase([makeCharacter('char-a', 'Character A', [makeChat('chat-a', 'Chat A', 'a')])])
    exportMocks.downloadFile.mockRejectedValueOnce(downloadError)

    await expect(exportAllChats('char-a')).resolves.toBe(false)

    expect(exportMocks.alertError).toHaveBeenCalledWith(downloadError)
  })
})
