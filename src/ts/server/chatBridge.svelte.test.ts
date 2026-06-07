import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'

const recorded = vi.hoisted(() => ({
  chatUpdates: [] as Array<{
    chatId: string
    patch: Record<string, unknown>
    keepalive?: boolean
  }>,
  folderUpdates: [] as Array<{
    folderId: string
    patch: Record<string, unknown>
    keepalive?: boolean
  }>,
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
    CHAT_PATCH_ALLOWED_KEYS: new Set([
      'name',
      'note',
      'sdData',
      'lastMemory',
      'suggestMessages',
      'bindedPersona',
      'fmIndex',
      'folderId',
      'lastDate',
      'bookmarks',
      'bookmarkNames',
      'modules',
    ]),
    dispatchUpdateChatRow: (
      chatId: string,
      patch: Record<string, unknown>,
      _rollback: unknown,
      options?: { keepalive?: boolean },
    ) => {
      recorded.chatUpdates.push({
        chatId,
        patch: cloneJsonValue(patch),
        ...(options?.keepalive ? { keepalive: options.keepalive } : {}),
      })
    },
    dispatchUpdateChatFolderRow: (
      folderId: string,
      patch: Record<string, unknown>,
      _rollback: unknown,
      options?: { keepalive?: boolean },
    ) => {
      recorded.folderUpdates.push({
        folderId,
        patch: cloneJsonValue(patch),
        ...(options?.keepalive ? { keepalive: options.keepalive } : {}),
      })
    },
    restoreChatState: (snapshot: { characters: unknown[]; selectedCharID: number }) => {
      const db = chatCommandState.getDb?.()
      if (db) {
        db.characters = cloneJsonValue(snapshot.characters)
      }
      chatCommandState.setSelectedCharId?.(snapshot.selectedCharID)
    },
  }
})

import { DBState, selectedCharID } from '../stores.svelte'
import { withCloneInstrumentation } from '../__tests__/cloneCostHarness'
import {
  flushPendingServerBackedChatPatches,
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
    expect(recorded.folderUpdates).toEqual([{ folderId: 'folder-1', patch: { folded: true } }])
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

  it('M8: flushes pending chat and folder metadata with keepalive and clears debounces', async () => {
    setupChat()
    const stop = watchServerBackedChatMetadata({ delayMs: DELAY * 10 })
    flushSync()

    DBState.db.characters[0].chats[0].name = 'Unload Chat'
    DBState.db.characters[0].chatFolders[0].folded = true
    flushSync()
    flushPendingServerBackedChatPatches({ keepalive: true })

    expect(recorded.chatUpdates).toEqual([
      { chatId: 'chat-1', patch: { name: 'Unload Chat' }, keepalive: true },
    ])
    expect(recorded.folderUpdates).toEqual([
      { folderId: 'folder-1', patch: { folded: true }, keepalive: true },
    ])

    await vi.advanceTimersByTimeAsync(DELAY * 10)
    expect(recorded.chatUpdates).toHaveLength(1)
    expect(recorded.folderUpdates).toHaveLength(1)
    stop()
  })

  it('M8: watcher teardown flushes pending chat and folder metadata and clears debounces', async () => {
    setupChat()
    const stop = watchServerBackedChatMetadata({ delayMs: DELAY * 10 })
    flushSync()

    DBState.db.characters[0].chats[0].name = 'Teardown Chat'
    DBState.db.characters[0].chatFolders[0].folded = true
    flushSync()
    stop()

    expect(recorded.chatUpdates).toEqual([
      { chatId: 'chat-1', patch: { name: 'Teardown Chat' } },
    ])
    expect(recorded.folderUpdates).toEqual([
      { folderId: 'folder-1', patch: { folded: true } },
    ])

    await vi.advanceTimersByTimeAsync(DELAY * 10)
    expect(recorded.chatUpdates).toHaveLength(1)
    expect(recorded.folderUpdates).toHaveLength(1)
  })
})

const BIG_BODY = 'x'.repeat(5000)

function setupHydratedChat(): void {
  ;(DBState as { db: unknown }).db = {
    characters: [
      {
        chaId: 'char-1',
        chats: [
          {
            id: 'chat-1',
            name: 'Initial',
            note: 'note',
            message: Array.from({ length: 50 }, (_unused, index) => ({
              role: index % 2 === 0 ? 'user' : 'char',
              data: BIG_BODY,
              chatId: `msg-${index}`,
            })),
            localLore: [{ content: BIG_BODY }],
          },
        ],
        chatFolders: [{ id: 'folder-1', name: 'Folder', color: '#fff', folded: false }],
      },
    ],
  }
  selectedCharID.set(0)
}

describe('watchServerBackedChatMetadata clone cost (Phase 2)', () => {
  it('builds scalar metadata without serializing the chat message history', () => {
    setupHydratedChat()
    const stop = watchServerBackedChatMetadata({ delayMs: DELAY })

    // The first effect run captures the baseline (scalarChatMetadata per chat).
    // It must never serialize the 50-message history (~250 KB) or localLore.
    const instrumented = withCloneInstrumentation(() => flushSync())

    expect(instrumented.maxClonedSize).toBeLessThan(BIG_BODY.length)
    expect(recorded.chatUpdates).toEqual([])
    stop()
  })

  it('does not re-clone or wake on a streaming message append', async () => {
    setupHydratedChat()
    const stop = watchServerBackedChatMetadata({ delayMs: DELAY })
    flushSync()

    // A streaming chunk only mutates message[], which is no longer a metadata
    // dependency: the watcher must neither clone the transcript nor queue a patch.
    const instrumented = withCloneInstrumentation(() => {
      DBState.db.characters[0].chats[0].message.push({
        role: 'char',
        data: BIG_BODY,
        chatId: 'msg-stream',
      })
      flushSync()
    })
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(instrumented.maxClonedSize).toBeLessThan(BIG_BODY.length)
    expect(recorded.chatUpdates).toEqual([])
    stop()
  })

  it('rebuilds baselines on a projection epoch advance without a whole-chat clone', () => {
    setupHydratedChat()
    const stop = watchServerBackedChatMetadata({ delayMs: DELAY })
    flushSync()

    projectionGuardState.epoch += 1
    DBState.db.characters[0].chats[0].name = 'Server Renamed'

    const instrumented = withCloneInstrumentation(() => flushSync())

    expect(instrumented.maxClonedSize).toBeLessThan(BIG_BODY.length)
    expect(recorded.chatUpdates).toEqual([])
    stop()
  })
})
