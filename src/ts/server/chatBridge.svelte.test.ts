import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'

const recorded = vi.hoisted(() => ({
  chatResult: null as Promise<{ status: 'ok' }> | null,
  chatUpdates: [] as Array<{
    chatId: string
    patch: Record<string, unknown>
    keepalive?: boolean
  }>,
  chatRollbacks: [] as Array<() => void>,
  folderUpdates: [] as Array<{
    folderId: string
    patch: Record<string, unknown>
    keepalive?: boolean
  }>,
  folderResult: null as Promise<{ status: 'ok' }> | null,
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
  withTrustedServerProjectionWrite: (callback: () => unknown) => callback(),
}))

vi.mock('../chatCommands', () => {
  const cloneJsonValue = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T))
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
      rollback: {
        selectedCharID: number
        characterId?: string
        chatId: string
        metadata: Record<string, unknown>
      },
      options?: { keepalive?: boolean },
      rollbackRowMetadata?: (snapshot: typeof rollback) => void,
    ) => {
      recorded.chatUpdates.push({
        chatId,
        patch: cloneJsonValue(patch),
        ...(options?.keepalive ? { keepalive: options.keepalive } : {}),
      })
      recorded.chatRollbacks.push(() => {
        rollbackRowMetadata?.(rollback)
      })
      return recorded.chatResult ?? Promise.resolve({ status: 'ok' as const })
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
      return recorded.folderResult ?? Promise.resolve({ status: 'ok' as const })
    },
    restoreChatState: (snapshot: { characters: unknown[]; selectedCharID: number }) => {
      const db = chatCommandState.getDb?.()
      if (db) {
        db.characters = cloneJsonValue(snapshot.characters)
      }
      chatCommandState.setSelectedCharId?.(snapshot.selectedCharID)
    },
    restoreChatRowMetadata: (snapshot: {
      selectedCharID: number
      characterId?: string
      chatId: string
      metadata: Record<string, unknown>
    }) => {
      const db = chatCommandState.getDb?.()
      if (!db) return
      const characters = db.characters as
        | Array<{
            chaId?: string
            chats?: Array<Record<string, unknown> & { id?: string }>
          }>
        | undefined
      const character =
        characters?.find((candidate) => candidate.chaId === snapshot.characterId) ??
        characters?.[snapshot.selectedCharID]
      const chat = character?.chats?.find((candidate) => candidate.id === snapshot.chatId)
      if (!chat) return
      for (const key of [
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
      ]) {
        if (key in snapshot.metadata) {
          chat[key] = cloneJsonValue(snapshot.metadata[key])
        } else {
          delete chat[key]
        }
      }
    },
  }
})

import { selectedCharID } from '../stores.svelte'
import { setDatabaseLite, type Database } from '../storage/database.svelte'
import { withCloneInstrumentation } from '../__tests__/cloneCostHarness'
import { getResourceDatabase as getDatabase } from './resourceState.svelte'
import {
  currentChatMetadataBaselines,
  flushPendingServerBackedChatPatches,
  rollbackServerBackedChatMetadata,
  syncServerBackedChatMetadataBaselines,
  watchServerBackedChatMetadata,
} from './chatBridge.svelte'

const DELAY = 50

const resourceDatabase = {
  set current(value: unknown) {
    setDatabaseLite(value as Database)
  },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function setupChat(name = 'Initial'): void {
  resourceDatabase.current = {
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
  chatCommandState.getDb = () => getDatabase() as unknown as Record<string, unknown>
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
  recorded.chatRollbacks.length = 0
  recorded.chatResult = null
  recorded.folderUpdates.length = 0
  recorded.folderResult = null
})

afterEach(() => {
  vi.useRealTimers()
  selectedCharID.set(-1)
  resourceDatabase.current = {}
})

describe('watchServerBackedChatMetadata baselines', () => {
  it('refreshes baseline on server projection updates before local chat edits', async () => {
    setupChat()
    const stop = watchServerBackedChatMetadata({ delayMs: DELAY })
    flushSync()

    projectionGuardState.epoch += 1
    getDatabase().characters[0].chats[0].name = 'Server'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.chatUpdates).toEqual([])

    getDatabase().characters[0].chats[0].name = 'Local'
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
    getDatabase().characters[0].chatFolders[0].name = 'Server Folder'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.folderUpdates).toEqual([])

    getDatabase().characters[0].chatFolders[0].folded = true
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.folderUpdates).toEqual([{ folderId: 'folder-1', patch: { folded: true } }])
    stop()
  })

  it('coalesces rapid names and overlays them through pending and in-flight projections', async () => {
    setupChat()
    const chatSave = deferred<{ status: 'ok' }>()
    const folderSave = deferred<{ status: 'ok' }>()
    recorded.chatResult = chatSave.promise
    recorded.folderResult = folderSave.promise
    const stop = watchServerBackedChatMetadata({ delayMs: DELAY })
    flushSync()

    getDatabase().characters[0].chats[0].name = 'h'
    flushSync()
    getDatabase().characters[0].chats[0].name = 'he'
    flushSync()
    getDatabase().characters[0].chats[0].name = 'hello'
    getDatabase().characters[0].chatFolders[0].name = 'folder'
    flushSync()

    projectionGuardState.epoch += 1
    getDatabase().characters[0].chats[0].name = 'Server Old Chat'
    getDatabase().characters[0].chatFolders[0].name = 'Server Old Folder'
    flushSync()

    expect(getDatabase().characters[0].chats[0].name).toBe('hello')
    expect(getDatabase().characters[0].chatFolders[0].name).toBe('folder')

    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.chatUpdates).toEqual([{ chatId: 'chat-1', patch: { name: 'hello' } }])
    expect(recorded.folderUpdates).toEqual([{ folderId: 'folder-1', patch: { name: 'folder' } }])

    projectionGuardState.epoch += 1
    getDatabase().characters[0].chats[0].name = 'Older In-Flight Chat'
    getDatabase().characters[0].chatFolders[0].name = 'Older In-Flight Folder'
    flushSync()

    expect(getDatabase().characters[0].chats[0].name).toBe('hello')
    expect(getDatabase().characters[0].chatFolders[0].name).toBe('folder')

    chatSave.resolve({ status: 'ok' })
    folderSave.resolve({ status: 'ok' })
    await Promise.resolve()
    await Promise.resolve()
    stop()
  })

  it('accepts direct optimistic metadata without echoing it through the bridge', async () => {
    setupChat()
    const stop = watchServerBackedChatMetadata({ delayMs: DELAY })
    flushSync()

    getDatabase().characters[0].chatFolders[0].folded = true
    syncServerBackedChatMetadataBaselines()
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.folderUpdates).toEqual([])
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

  it('L26: chat row rollback suppresses watcher echo and resets the restored baseline', async () => {
    setupChat('Initial')
    const stop = watchServerBackedChatMetadata({ delayMs: DELAY })
    flushSync()

    getDatabase().characters[0].chats[0].name = 'Conflict'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.chatUpdates.map(({ chatId, patch }) => ({ chatId, patch }))).toEqual([
      { chatId: 'chat-1', patch: { name: 'Conflict' } },
    ])

    recorded.chatRollbacks[0]?.()
    await Promise.resolve()
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(getDatabase().characters[0].chats[0].name).toBe('Initial')
    expect(recorded.chatUpdates.map(({ chatId, patch }) => ({ chatId, patch }))).toEqual([
      { chatId: 'chat-1', patch: { name: 'Conflict' } },
    ])

    getDatabase().characters[0].chats[0].name = 'User Edit After Rollback'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.chatUpdates.map(({ chatId, patch }) => ({ chatId, patch }))).toEqual([
      { chatId: 'chat-1', patch: { name: 'Conflict' } },
      { chatId: 'chat-1', patch: { name: 'User Edit After Rollback' } },
    ])
    stop()
  })

  it('M8: flushes pending chat and folder metadata with keepalive and clears debounces', async () => {
    setupChat()
    const stop = watchServerBackedChatMetadata({ delayMs: DELAY * 10 })
    flushSync()

    getDatabase().characters[0].chats[0].name = 'Unload Chat'
    getDatabase().characters[0].chatFolders[0].folded = true
    flushSync()
    flushPendingServerBackedChatPatches({ keepalive: true })

    expect(recorded.chatUpdates).toEqual([{ chatId: 'chat-1', patch: { name: 'Unload Chat' }, keepalive: true }])
    expect(recorded.folderUpdates).toEqual([{ folderId: 'folder-1', patch: { folded: true }, keepalive: true }])

    await vi.advanceTimersByTimeAsync(DELAY * 10)
    expect(recorded.chatUpdates).toHaveLength(1)
    expect(recorded.folderUpdates).toHaveLength(1)
    stop()
  })

  it('M8: watcher teardown flushes pending chat and folder metadata and clears debounces', async () => {
    setupChat()
    const stop = watchServerBackedChatMetadata({ delayMs: DELAY * 10 })
    flushSync()

    getDatabase().characters[0].chats[0].name = 'Teardown Chat'
    getDatabase().characters[0].chatFolders[0].folded = true
    flushSync()
    stop()

    expect(recorded.chatUpdates).toEqual([{ chatId: 'chat-1', patch: { name: 'Teardown Chat' } }])
    expect(recorded.folderUpdates).toEqual([{ folderId: 'folder-1', patch: { folded: true } }])

    await vi.advanceTimersByTimeAsync(DELAY * 10)
    expect(recorded.chatUpdates).toHaveLength(1)
    expect(recorded.folderUpdates).toHaveLength(1)
  })
})

const BIG_BODY = 'x'.repeat(5000)

function setupHydratedChat(): void {
  resourceDatabase.current = {
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
      getDatabase().characters[0].chats[0].message.push({
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
    getDatabase().characters[0].chats[0].name = 'Server Renamed'

    const instrumented = withCloneInstrumentation(() => flushSync())

    expect(instrumented.maxClonedSize).toBeLessThan(BIG_BODY.length)
    expect(recorded.chatUpdates).toEqual([])
    stop()
  })
})

describe('watchServerBackedChatMetadata no-change short-circuit (Phase 6)', () => {
  it('L29: message-only guarded writes reuse scalar maps and queue no patches', async () => {
    setupHydratedChat()
    const stop = watchServerBackedChatMetadata({ delayMs: DELAY })
    flushSync()
    const baseline = currentChatMetadataBaselines()

    getDatabase().characters[0].chats[0].message[0].data = 'streaming frame'
    resourceDatabase.current = { ...getDatabase() }

    const afterMessageOnly = currentChatMetadataBaselines(baseline)
    expect(afterMessageOnly.chats).toBe(baseline.chats)
    expect(afterMessageOnly.folders).toBe(baseline.folders)

    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.chatUpdates).toEqual([])
    expect(recorded.folderUpdates).toEqual([])
    stop()
  })

  it('L29: real chat and folder scalar edits still dispatch after a no-change fire', async () => {
    setupChat()
    const stop = watchServerBackedChatMetadata({ delayMs: DELAY })
    flushSync()
    resourceDatabase.current = { ...getDatabase() }
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.chatUpdates).toEqual([])
    expect(recorded.folderUpdates).toEqual([])

    getDatabase().characters[0].chats[0].note = 'Edited note'
    getDatabase().characters[0].chatFolders[0].color = '#000'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.chatUpdates).toEqual([{ chatId: 'chat-1', patch: { note: 'Edited note' } }])
    expect(recorded.folderUpdates).toEqual([{ folderId: 'folder-1', patch: { color: '#000' } }])
    stop()
  })
})
