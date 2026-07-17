import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compressSync, decompressSync } from 'fflate'

const alertState = vi.hoisted(() => ({
  alertClear: vi.fn(),
  alertError: vi.fn(),
  alertWait: vi.fn(),
}))
const commandState = vi.hoisted(() => ({
  getBaseRevision: vi.fn(async () => 4 as number | null),
  recoverCharacter: vi.fn(),
  recoverChat: vi.fn(),
}))
const storageState = vi.hoisted(() => ({
  getItem: vi.fn(),
  keys: vi.fn(),
  removeItem: vi.fn(),
  setItem: vi.fn(),
}))
const storeState = vi.hoisted(() => ({
  databaseState: {
    db: {
      characters: [],
    },
  },
}))

vi.mock('../alert', () => alertState)

vi.mock('../globalApi.svelte', () => ({
  forageStorage: storageState,
}))

vi.mock('../storage/database.svelte', () => ({
  getDatabase: () => storeState.databaseState.db,
}))

vi.mock('../server/commands', () => ({
  getServerCommandBaseRevision: commandState.getBaseRevision,
  recoverColdStorageCharacterCommand: commandState.recoverCharacter,
  recoverColdStorageChatCommand: commandState.recoverChat,
}))

vi.mock('../server/resourceWriteGuard.svelte', () => ({
  withTrustedResourceWrite: (callback: () => unknown) => callback(),
}))

import {
  cleanColdStorage,
  coldStorageHeader,
  getColdStorageItem,
  listColdStorageItems,
  preLoadChat,
  setColdStorageItem,
} from './coldstorage.svelte'

beforeEach(() => {
  vi.clearAllMocks()
  commandState.getBaseRevision.mockResolvedValue(4)
  storageState.keys.mockResolvedValue([])
  storageState.setItem.mockResolvedValue(null)
  storeState.databaseState.db = {
    characters: [],
  } as any
})

describe('legacy cold-storage recovery', () => {
  it('reads, writes, and lists legacy compressed sidecars without cleaning them up', async () => {
    const archived = { message: [{ role: 'user', data: 'legacy', chatId: 'message-a' }] }
    storageState.getItem.mockResolvedValue(
      Buffer.from(compressSync(new TextEncoder().encode(JSON.stringify(archived)))),
    )
    storageState.keys.mockResolvedValue(['other', 'coldstorage/cold-a', 'coldstorage/cold-b'])

    await expect(getColdStorageItem('cold-a')).resolves.toEqual(archived)
    await expect(setColdStorageItem('cold-c', archived)).resolves.toBe(true)
    await expect(listColdStorageItems()).resolves.toEqual({ items: ['cold-a', 'cold-b'] })
    await expect(cleanColdStorage()).resolves.toBeUndefined()

    expect(storageState.getItem).toHaveBeenCalledWith('coldstorage/cold-a')
    const [, written] = storageState.setItem.mock.calls[0]
    expect(JSON.parse(new TextDecoder().decode(decompressSync(written)))).toEqual(archived)
    expect(storageState.removeItem).not.toHaveBeenCalled()
  })

  it('replaces a chat pointer only after the conditional server recovery commits', async () => {
    const recoveredChat = {
      id: 'chat-a',
      name: 'Recovered',
      note: '',
      localLore: [],
      message: [{ role: 'user', data: 'legacy transcript', chatId: 'message-a' }],
    }
    storeState.databaseState.db = {
      characters: [
        {
          chaId: 'character-a',
          chats: [
            {
              id: 'chat-a',
              message: [{ role: 'char', data: `${coldStorageHeader}cold-a`, chatId: 'pointer-a' }],
            },
          ],
        },
      ],
    } as any
    commandState.recoverChat.mockResolvedValue({
      status: 'ok',
      revision: 5,
      event: {
        type: 'coldStorage.chatRecovered',
        revision: 5,
        resource: 'chatTranscript',
        id: 'chat-a',
        parentId: 'character-a',
      },
      chatId: 'chat-a',
      characterId: 'character-a',
      chat: recoveredChat,
    })

    await expect(preLoadChat(0, 0)).resolves.toBe(true)

    expect(commandState.recoverChat).toHaveBeenCalledWith({
      baseRevision: 4,
      chatId: 'chat-a',
      key: 'cold-a',
    })
    expect(storeState.databaseState.db.characters[0].chats[0]).toEqual(recoveredChat)
    expect(storageState.getItem).not.toHaveBeenCalled()
    expect(storageState.removeItem).not.toHaveBeenCalled()
  })

  it('keeps the pointer and identifies the archive key when recovery fails', async () => {
    const pointer = `${coldStorageHeader}missing-a`
    storeState.databaseState.db = {
      characters: [
        {
          chaId: 'character-a',
          chats: [{ id: 'chat-a', message: [{ role: 'char', data: pointer, chatId: 'pointer-a' }] }],
        },
      ],
    } as any
    commandState.recoverChat.mockResolvedValue({
      status: 'error',
      error: 'Cold-storage archive not found for key: missing-a',
      reason: 'invalid-request',
    })

    await expect(preLoadChat(0, 0)).resolves.toBe(false)

    expect(storeState.databaseState.db.characters[0].chats[0].message[0].data).toBe(pointer)
    expect(alertState.alertError).toHaveBeenCalledWith(expect.stringContaining('missing-a'))
  })
})
