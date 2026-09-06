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
  charactersStatus: 'ready',
  databaseState: {
    db: {
      characters: [],
    },
  },
}))
const resourceState = vi.hoisted(() => ({
  applyCharacterResource: vi.fn(),
  applyServerChatMessagesResource: vi.fn(),
  markChatBodyResourceRevision: vi.fn(),
}))

vi.mock('../alert', () => alertState)

vi.mock('../globalApi.svelte', () => ({
  forageStorage: storageState,
}))

vi.mock('../server/commands', () => ({
  getServerCommandBaseRevision: commandState.getBaseRevision,
  recoverColdStorageCharacterCommand: commandState.recoverCharacter,
  recoverColdStorageChatCommand: commandState.recoverChat,
}))

vi.mock('../server/resourceState.svelte', () => ({
  applyCharacterResource: resourceState.applyCharacterResource,
  charactersResourceState: {
    get characters() {
      return storeState.databaseState.db.characters
    },
    get status() {
      return storeState.charactersStatus
    },
  },
  getCharacterResourceOwner: (characterId: string) => {
    const matches = storeState.databaseState.db.characters.filter(
      (candidate: { chaId?: string }) => candidate?.chaId === characterId,
    )
    return matches.length === 1 ? matches[0] : undefined
  },
  getChatMetadataOwnerState: (chatId: string) => {
    const matches = storeState.databaseState.db.characters.flatMap((character: { chats?: any[] }) =>
      (character.chats ?? []).filter((chat) => chat?.id === chatId),
    )
    return matches.length === 1 ? { chatId } : undefined
  },
  markChatBodyResourceRevision: resourceState.markChatBodyResourceRevision,
}))

vi.mock('../server/chatMessageHydration.svelte', () => ({
  applyServerChatMessagesResource: resourceState.applyServerChatMessagesResource,
  getChatMessageOwnerState: (chatId: string) => {
    const matches = storeState.databaseState.db.characters.flatMap((character: { chats?: any[] }) =>
      (character.chats ?? []).filter((chat) => chat?.id === chatId),
    )
    return matches.length === 1 ? { chatId, messages: matches[0].message ?? [] } : undefined
  },
}))

import {
  cleanColdStorage,
  coldStorageHeader,
  getColdStorageItem,
  listColdDataKeys,
  listColdStorageItems,
  preLoadChat,
  recoverColdStorageCharacter,
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
  storeState.charactersStatus = 'ready'
  resourceState.applyCharacterResource.mockImplementation(
    ({ character }: { revision: number; character: { chaId?: string } }) => {
      const index = storeState.databaseState.db.characters.findIndex(
        (candidate: { chaId?: string }) => candidate?.chaId === character.chaId,
      )
      if (index < 0) return false
      storeState.databaseState.db.characters[index] = character
      return true
    },
  )
  resourceState.applyServerChatMessagesResource.mockImplementation(
    (
      chatId: string,
      messages: unknown[],
      hypaV3Data: unknown,
      _alternates: unknown[],
      _range: unknown,
      options: any,
    ) => {
      const chats = storeState.databaseState.db.characters.flatMap(
        (character: { chats?: any[] }) => character.chats ?? [],
      )
      const matches = chats.filter((chat: { id?: string }) => chat?.id === chatId)
      if (matches.length !== 1) return false
      matches[0].message = messages
      if (options?.hypaV3DataIncluded) matches[0].hypaV3Data = hypaV3Data
      return true
    },
  )
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

  it('applies a recovered character and each transcript through stable owners', async () => {
    const recoveredCharacter = {
      chaId: 'character-a',
      name: 'Recovered Character',
      chats: [
        {
          id: 'chat-a',
          name: 'Recovered Chat',
          message: [{ role: 'user', data: 'recovered transcript', chatId: 'message-a' }],
        },
      ],
    }
    storeState.databaseState.db = {
      characters: [{ chaId: 'character-a', coldstorage: 'cold-character-a', chats: [] }],
    } as any
    commandState.recoverCharacter.mockResolvedValue({
      status: 'ok',
      revision: 5,
      event: {
        type: 'coldStorage.characterRecovered',
        revision: 5,
        resource: 'character',
        id: 'character-a',
      },
      characterId: 'character-a',
      character: recoveredCharacter,
    })

    await expect(recoverColdStorageCharacter(0)).resolves.toBe(true)

    expect(commandState.recoverCharacter).toHaveBeenCalledWith({
      baseRevision: 4,
      characterId: 'character-a',
      key: 'cold-character-a',
    })
    expect(resourceState.applyCharacterResource).toHaveBeenCalledWith({
      revision: 5,
      character: recoveredCharacter,
    })
    expect(resourceState.applyServerChatMessagesResource).toHaveBeenCalledWith(
      'chat-a',
      recoveredCharacter.chats[0].message,
      undefined,
      [],
      undefined,
      { hypaV3DataIncluded: false },
    )
    expect(resourceState.markChatBodyResourceRevision).toHaveBeenCalledWith('chat-a', 5)
    expect(alertState.alertClear).toHaveBeenCalledOnce()
  })

  it('fails closed while character owners are loading', async () => {
    storeState.databaseState.db = {
      characters: [{ chaId: 'character-a', coldstorage: 'cold-character-a', chats: [] }],
    } as any
    storeState.charactersStatus = 'loading'

    await expect(recoverColdStorageCharacter(0)).resolves.toBe(false)
    await expect(listColdDataKeys()).resolves.toEqual([])
    expect(commandState.recoverCharacter).not.toHaveBeenCalled()
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
