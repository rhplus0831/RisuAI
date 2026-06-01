import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'

const recorded = vi.hoisted(() => ({
  chatUpdates: [] as Array<{ chatId: string; patch: Record<string, unknown> }>,
  folderUpdates: [] as Array<{ folderId: string; patch: Record<string, unknown> }>,
}))
const projectionGuardState = vi.hoisted(() => ({ epoch: 0 }))
const chatCommandState = vi.hoisted(() => ({
  getDb: null as null | (() => Record<string, unknown>),
  getSelectedCharId: null as null | (() => number),
  setSelectedCharId: null as null | ((value: number) => void),
}))

vi.mock('./commands', () => ({
  canUseServerCommands: () => true,
}))

vi.mock('./projectionWriteGuard.svelte', () => ({
  getServerProjectionApplyEpoch: () => projectionGuardState.epoch,
}))

vi.mock('../chatCommands', () => {
  const cloneJsonValue = <T>(value: T): T =>
    value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
  return {
    cloneJsonValue,
    currentChatStateSnapshot: () => ({
      characters: cloneJsonValue(chatCommandState.getDb?.().characters ?? []),
      selectedCharID: chatCommandState.getSelectedCharId?.() ?? -1,
    }),
    dispatchUpdateChat: (chatId: string, patch: Record<string, unknown>) => {
      recorded.chatUpdates.push({ chatId, patch: cloneJsonValue(patch) })
    },
    dispatchUpdateChatFolder: (folderId: string, patch: Record<string, unknown>) => {
      recorded.folderUpdates.push({ folderId, patch: cloneJsonValue(patch) })
    },
    restoreChatState: (snapshot: { characters: unknown[]; selectedCharID: number }) => {
      const db = chatCommandState.getDb?.()
      if (db) {
        db.characters = cloneJsonValue(snapshot.characters)
      }
      chatCommandState.setSelectedCharId?.(snapshot.selectedCharID)
    },
    sanitizeChatPatch: (patch: Record<string, unknown>) => {
      const { id: _id, message: _message, chatFolders: _chatFolders, ...rest } = patch
      return cloneJsonValue(rest)
    },
  }
})

import { DBState, selectedCharID } from '../stores.svelte'
import {
  rollbackServerBackedChatMetadata,
  watchServerBackedChatMetadata,
} from './chatBridge.svelte'

const DELAY = 50

function setupChat(name = 'Initial'): void {
  ;(DBState as { db: unknown }).db = {
    characters: [
      {
        chaId: 'char-1',
        chats: [{ id: 'chat-1', name, message: [] }],
        chatFolders: [{ id: 'folder-1', name: 'Folder', color: '#fff', folded: false }],
      },
    ],
  }
  selectedCharID.set(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  projectionGuardState.epoch = 0
  chatCommandState.getDb = () => DBState.db as unknown as Record<string, unknown>
  chatCommandState.getSelectedCharId = () => {
    let selected = -1
    const unsubscribe = selectedCharID.subscribe((value) => {
      selected = value
    })
    unsubscribe()
    return selected
  }
  chatCommandState.setSelectedCharId = (value) => selectedCharID.set(value)
  recorded.chatUpdates.length = 0
  recorded.folderUpdates.length = 0
})

afterEach(() => {
  vi.useRealTimers()
  selectedCharID.set(-1)
  ;(DBState as { db: unknown }).db = {}
})

describe('watchServerBackedChatMetadata baselines', () => {
  it('refreshes baseline on server projection updates before local chat edits', async () => {
    setupChat()
    const stop = watchServerBackedChatMetadata({ delayMs: DELAY })
    flushSync()

    projectionGuardState.epoch += 1
    DBState.db.characters[0].chats[0].name = 'Server'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.chatUpdates).toEqual([])

    DBState.db.characters[0].chats[0].name = 'Local'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.chatUpdates).toEqual([{ chatId: 'chat-1', patch: { name: 'Local' } }])
    stop()
  })

  it('refreshes baseline on server projection updates before local folder edits', async () => {
    setupChat()
    const stop = watchServerBackedChatMetadata({ delayMs: DELAY })
    flushSync()

    projectionGuardState.epoch += 1
    DBState.db.characters[0].chatFolders[0].name = 'Server Folder'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.folderUpdates).toEqual([])

    DBState.db.characters[0].chatFolders[0].folded = true
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.folderUpdates).toEqual([
      { folderId: 'folder-1', patch: { folded: true } },
    ])
    stop()
  })

  it('does not echo rollback state restoration', async () => {
    setupChat('Current')
    const stop = watchServerBackedChatMetadata({ delayMs: DELAY })
    flushSync()

    rollbackServerBackedChatMetadata({
      characters: [
        {
          chaId: 'char-1',
          chats: [{ id: 'chat-1', name: 'Rolled Back', message: [] }],
          chatFolders: [],
        },
      ] as never,
      selectedCharID: 0,
    })
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.chatUpdates).toEqual([])
    stop()
  })
})
