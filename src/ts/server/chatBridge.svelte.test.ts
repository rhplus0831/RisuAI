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
  chatTransports: [] as Array<{ mutationId?: string; databaseLineage?: string }>,
  folderUpdates: [] as Array<{
    folderId: string
    patch: Record<string, unknown>
    keepalive?: boolean
  }>,
  folderRollbacks: [] as Array<() => void>,
  folderTransports: [] as Array<{ mutationId?: string; databaseLineage?: string }>,
  folderResult: null as Promise<{ status: 'ok' }> | null,
  folderAttempts: [] as Array<{
    sequence: number
    folderId: string
    rollback: {
      selectedCharID: number
      characterId?: string
      folderId: string
      metadata: Record<string, unknown>
      attempted?: Record<string, unknown>
    }
  }>,
  nextFolderAttemptSequence: 0,
}))
const resourceGuardState = vi.hoisted(() => ({ epoch: 0 }))
const durableState = vi.hoisted(() => ({
  nextId: 0,
  stages: [] as Array<{ key: string; intent: Record<string, unknown>; handle: Record<string, any> }>,
  dispatches: [] as Array<{ handle: Record<string, any>; intent: Record<string, unknown> }>,
  acknowledgements: [] as Array<Record<string, any>>,
}))
const chatCommandState = vi.hoisted(() => ({
  getDb: null as null | (() => Record<string, unknown>),
  getSelectedCharId: null as null | (() => number),
  setSelectedCharId: null as null | ((value: number) => void),
}))

vi.mock('./commands', () => ({
  canUseServerCommands: () => true,
}))

vi.mock('./resourceWriteGuard.svelte', () => ({
  getServerResourceApplyEpoch: () => resourceGuardState.epoch,
  withTrustedResourceWrite: (callback: () => unknown) => callback(),
}))

vi.mock('./pendingMutationOutbox', () => ({
  stagePendingMutation: (key: string, intent: Record<string, unknown>, previous?: Record<string, any> | null) => {
    const reuse = previous?.phase === 'staged' && previous.key === key
    if (reuse) previous.phase = 'superseded'
    const handle = {
      key,
      mutationId: reuse ? previous!.mutationId : `chat-mutation-${++durableState.nextId}`,
      phase: 'staged',
    }
    durableState.stages.push({ key, intent: JSON.parse(JSON.stringify(intent)), handle })
    return handle
  },
  acknowledgePendingMutation: async (handle: Record<string, any>) => {
    durableState.acknowledgements.push(handle)
    return 'deleted'
  },
}))

vi.mock('./durableMutationDispatch', () => ({
  dispatchDurableMutation: async (
    handle: Record<string, any>,
    intent: Record<string, unknown>,
    dispatch: (transport: { mutationId: string; databaseLineage: string }) => Promise<unknown>,
  ) => {
    handle.phase = 'dispatching'
    durableState.dispatches.push({ handle, intent: JSON.parse(JSON.stringify(intent)) })
    return dispatch({ mutationId: handle.mutationId, databaseLineage: 'test-lineage' })
  },
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
      options?: { keepalive?: boolean; mutationId?: string; databaseLineage?: string },
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
      recorded.chatTransports.push({
        mutationId: options?.mutationId,
        databaseLineage: options?.databaseLineage,
      })
      return recorded.chatResult ?? Promise.resolve({ status: 'ok' as const })
    },
    dispatchUpdateChatFolderRow: (
      folderId: string,
      patch: Record<string, unknown>,
      rollback: {
        selectedCharID: number
        characterId?: string
        folderId: string
        metadata: Record<string, unknown>
      },
      options?: { keepalive?: boolean; mutationId?: string; databaseLineage?: string },
      rollbackFolderMetadata?: (snapshot: typeof rollback) => void,
    ) => {
      recorded.folderUpdates.push({
        folderId,
        patch: cloneJsonValue(patch),
        ...(options?.keepalive ? { keepalive: options.keepalive } : {}),
      })
      recorded.folderTransports.push({
        mutationId: options?.mutationId,
        databaseLineage: options?.databaseLineage,
      })
      const attemptedRollback = {
        ...rollback,
        metadata: cloneJsonValue(rollback.metadata),
        attempted: cloneJsonValue(patch),
      }
      const attempt = {
        sequence: ++recorded.nextFolderAttemptSequence,
        folderId,
        rollback: attemptedRollback,
      }
      recorded.folderAttempts.push(attempt)
      const clearAttempt = () => {
        recorded.folderAttempts = recorded.folderAttempts.filter((candidate) => candidate.sequence !== attempt.sequence)
      }
      recorded.folderRollbacks.push(() => {
        rollbackFolderMetadata?.(attemptedRollback)

        const rebasedKeys = new Set<string>()
        for (const later of recorded.folderAttempts) {
          if (later.sequence <= attempt.sequence || !later.rollback.attempted) continue
          for (const key of ['name', 'color', 'folded']) {
            if (rebasedKeys.has(key)) continue
            if (!Object.prototype.hasOwnProperty.call(attemptedRollback.attempted, key)) continue
            if (!Object.prototype.hasOwnProperty.call(later.rollback.attempted, key)) continue
            const laterPrevious = Object.prototype.hasOwnProperty.call(later.rollback.metadata, key)
              ? later.rollback.metadata[key]
              : undefined
            if (JSON.stringify(laterPrevious) !== JSON.stringify(attemptedRollback.attempted[key])) continue
            if (Object.prototype.hasOwnProperty.call(attemptedRollback.metadata, key)) {
              later.rollback.metadata[key] = cloneJsonValue(attemptedRollback.metadata[key])
            } else {
              delete later.rollback.metadata[key]
            }
            rebasedKeys.add(key)
          }
        }
        clearAttempt()
      })
      const result = recorded.folderResult ?? Promise.resolve({ status: 'ok' as const })
      void result.then(clearAttempt, clearAttempt)
      return result
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
    restoreChatFolderRowMetadata: (snapshot: {
      selectedCharID: number
      characterId?: string
      folderId: string
      metadata: Record<string, unknown>
      attempted?: Record<string, unknown>
    }) => {
      const db = chatCommandState.getDb?.()
      if (!db) return
      const characters = db.characters as
        | Array<{
            chaId?: string
            chatFolders?: Array<Record<string, unknown> & { id?: string }>
          }>
        | undefined
      const character =
        characters?.find((candidate) => candidate.chaId === snapshot.characterId) ??
        characters?.[snapshot.selectedCharID]
      const folder = character?.chatFolders?.find((candidate) => candidate.id === snapshot.folderId)
      if (!folder) return
      for (const key of ['name', 'color', 'folded']) {
        if (
          snapshot.attempted &&
          Object.prototype.hasOwnProperty.call(snapshot.attempted, key) &&
          JSON.stringify(folder[key]) !== JSON.stringify(snapshot.attempted[key])
        ) {
          continue
        }
        if (key in snapshot.metadata) {
          folder[key] = cloneJsonValue(snapshot.metadata[key])
        } else {
          delete folder[key]
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
  rollbackServerBackedChatFolderRowMetadata,
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
  resourceGuardState.epoch = 0
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
  recorded.chatTransports.length = 0
  recorded.chatResult = null
  recorded.folderUpdates.length = 0
  recorded.folderRollbacks.length = 0
  recorded.folderTransports.length = 0
  recorded.folderResult = null
  recorded.folderAttempts.length = 0
  recorded.nextFolderAttemptSequence = 0
  durableState.nextId = 0
  durableState.stages.length = 0
  durableState.dispatches.length = 0
  durableState.acknowledgements.length = 0
})

afterEach(() => {
  vi.useRealTimers()
  selectedCharID.set(-1)
  resourceDatabase.current = {}
})

describe('watchServerBackedChatMetadata baselines', () => {
  it('stages exact chat and folder payloads and forwards replay-safe transport ids', async () => {
    setupChat()
    const stop = watchServerBackedChatMetadata({ delayMs: DELAY })
    flushSync()

    getDatabase().characters[0].chats[0].name = 'Queued Chat'
    getDatabase().characters[0].chatFolders[0].folded = true
    flushSync()

    expect(durableState.stages.map(({ key, intent }) => ({ key, intent }))).toEqual([
      {
        key: 'chat-metadata:chat-1',
        intent: {
          version: 1,
          requests: [
            {
              method: 'PATCH',
              path: '/chats/chat-1',
              body: { patch: { name: 'Queued Chat' }, select: false },
            },
          ],
        },
      },
      {
        key: 'chat-folder-metadata:folder-1',
        intent: {
          version: 1,
          requests: [
            {
              method: 'PATCH',
              path: '/chat-folders/folder-1',
              body: { patch: { folded: true } },
            },
          ],
        },
      },
    ])

    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.chatTransports).toEqual([
      {
        mutationId: durableState.stages[0].handle.mutationId,
        databaseLineage: 'test-lineage',
      },
    ])
    expect(recorded.folderTransports).toEqual([
      {
        mutationId: durableState.stages[1].handle.mutationId,
        databaseLineage: 'test-lineage',
      },
    ])
    stop()
  })

  it('dispatches an in-flight chat generation independently from a newly queued generation', async () => {
    const firstResult = deferred<{ status: 'ok' }>()
    recorded.chatResult = firstResult.promise
    setupChat()
    const stop = watchServerBackedChatMetadata({ delayMs: DELAY })
    flushSync()

    getDatabase().characters[0].chats[0].name = 'Generation A'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    getDatabase().characters[0].chats[0].name = 'Generation B'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(durableState.stages).toHaveLength(2)
    expect(durableState.stages[0].handle.mutationId).not.toBe(durableState.stages[1].handle.mutationId)
    expect(durableState.dispatches.map((entry) => entry.handle)).toEqual([
      durableState.stages[0].handle,
      durableState.stages[1].handle,
    ])
    expect(recorded.chatUpdates.map((entry) => entry.patch)).toEqual([
      { name: 'Generation A' },
      { name: 'Generation B' },
    ])

    firstResult.resolve({ status: 'ok' })
    await Promise.resolve()
    await Promise.resolve()
    stop()
  })

  it('refreshes baseline on server projection updates before local chat edits', async () => {
    setupChat()
    const stop = watchServerBackedChatMetadata({ delayMs: DELAY })
    flushSync()

    resourceGuardState.epoch += 1
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

    resourceGuardState.epoch += 1
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

    resourceGuardState.epoch += 1
    getDatabase().characters[0].chats[0].name = 'Server Old Chat'
    getDatabase().characters[0].chatFolders[0].name = 'Server Old Folder'
    flushSync()

    expect(getDatabase().characters[0].chats[0].name).toBe('hello')
    expect(getDatabase().characters[0].chatFolders[0].name).toBe('folder')

    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.chatUpdates).toEqual([{ chatId: 'chat-1', patch: { name: 'hello' } }])
    expect(recorded.folderUpdates).toEqual([{ folderId: 'folder-1', patch: { name: 'folder' } }])

    resourceGuardState.epoch += 1
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

  it('folder row rollback suppresses a reverse watcher patch after a direct failure', async () => {
    setupChat()
    const stop = watchServerBackedChatMetadata({ delayMs: DELAY })
    flushSync()

    getDatabase().characters[0].chatFolders[0].folded = true
    syncServerBackedChatMetadataBaselines()
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.folderUpdates).toEqual([])

    rollbackServerBackedChatFolderRowMetadata({
      selectedCharID: 0,
      characterId: 'char-1',
      folderId: 'folder-1',
      metadata: { name: 'Folder', color: '#fff', folded: false },
      attempted: { folded: true },
    })
    await Promise.resolve()
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(getDatabase().characters[0].chatFolders[0].folded).toBe(false)
    expect(recorded.folderUpdates).toEqual([])
    stop()
  })

  it('restores the original folder value when two watcher-driven deferred patches fail oldest-first', async () => {
    setupChat()
    recorded.folderResult = new Promise(() => {})
    const stop = watchServerBackedChatMetadata({ delayMs: DELAY })
    flushSync()

    getDatabase().characters[0].chatFolders[0].name = 'First rename'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    getDatabase().characters[0].chatFolders[0].name = 'Second rename'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.folderUpdates).toEqual([
      { folderId: 'folder-1', patch: { name: 'First rename' } },
      { folderId: 'folder-1', patch: { name: 'Second rename' } },
    ])

    recorded.folderRollbacks[0]?.()
    await Promise.resolve()
    expect(getDatabase().characters[0].chatFolders[0].name).toBe('Second rename')

    recorded.folderRollbacks[1]?.()
    await Promise.resolve()
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(getDatabase().characters[0].chatFolders[0].name).toBe('Folder')
    expect(recorded.folderUpdates).toHaveLength(2)
    stop()
  })

  it('does not reassert a failed in-flight chat patch after a resource apply', async () => {
    setupChat('Initial')
    recorded.chatResult = new Promise(() => {})
    const stop = watchServerBackedChatMetadata({ delayMs: DELAY })
    flushSync()

    getDatabase().characters[0].chats[0].name = 'Failed optimistic name'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.chatUpdates).toHaveLength(1)
    recorded.chatRollbacks[0]?.()
    resourceGuardState.epoch += 1
    getDatabase().characters[0].chats[0].name = 'Authoritative name'
    flushSync()

    expect(getDatabase().characters[0].chats[0].name).toBe('Authoritative name')
    stop()
  })

  it('does not reassert a failed in-flight folder patch after a resource apply', async () => {
    setupChat()
    recorded.folderResult = new Promise(() => {})
    const stop = watchServerBackedChatMetadata({ delayMs: DELAY })
    flushSync()

    getDatabase().characters[0].chatFolders[0].name = 'Failed optimistic folder'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.folderUpdates).toHaveLength(1)
    recorded.folderRollbacks[0]?.()
    resourceGuardState.epoch += 1
    getDatabase().characters[0].chatFolders[0].name = 'Authoritative folder'
    flushSync()

    expect(getDatabase().characters[0].chatFolders[0].name).toBe('Authoritative folder')
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

    resourceGuardState.epoch += 1
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
