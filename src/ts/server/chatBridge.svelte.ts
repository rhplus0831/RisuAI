import { untrack } from 'svelte'
import { get } from 'svelte/store'
import {
  CHAT_PATCH_ALLOWED_KEYS,
  cloneJsonValue,
  dispatchUpdateChatFolderRow,
  dispatchUpdateChatRow,
  restoreChatState,
  type ChatFolderRowMetadataSnapshot,
  type ChatRowMetadataSnapshot,
  type ChatStateSnapshot,
} from '../chatCommands'
import {
  canUseServerCommands,
  type ChatFolderSnapshot,
  type ChatSnapshot,
  type ServerCommandTransportOptions,
} from './commands'
import { DBState, selectedCharID } from '../stores.svelte'
import type { ChatFolder } from '../storage/database.svelte'
import { getServerProjectionApplyEpoch } from './projectionWriteGuard.svelte'

interface PendingChatPatch {
  chatId: string
  patch: ChatSnapshot
  rollback: ChatRowMetadataSnapshot
  timer: ReturnType<typeof setTimeout> | null
}

interface PendingFolderPatch {
  folderId: string
  patch: ChatFolderSnapshot
  rollback: ChatFolderRowMetadataSnapshot
  timer: ReturnType<typeof setTimeout> | null
}

const pendingChatPatches = new Map<string, PendingChatPatch>()
const pendingFolderPatches = new Map<string, PendingFolderPatch>()
let suppressRollbackDispatch = false
let activeStop: (() => void) | null = null
let watcherRefs = 0

export interface WatchServerBackedChatMetadataOptions {
  delayMs?: number
}

export function watchServerBackedChatMetadata(
  options: WatchServerBackedChatMetadataOptions = {},
): () => void {
  if (!canUseServerCommands()) return () => {}
  if (activeStop) {
    watcherRefs += 1
    return () => {
      watcherRefs -= 1
      if (watcherRefs <= 0) {
        flushPendingServerBackedChatPatches()
        activeStop?.()
        activeStop = null
        watcherRefs = 0
      }
    }
  }

  const delayMs = options.delayMs ?? 300
  let initialized = false
  let previousChats = new Map<string, ChatSnapshot>()
  let previousFolders = new Map<string, ChatFolderSnapshot>()
  let previousProjectionApplyEpoch = getServerProjectionApplyEpoch()

  activeStop = $effect.root(() => {
    $effect(() => {
      const projectionApplyEpoch = getServerProjectionApplyEpoch()
      const selectedChar = get(selectedCharID)
      const character = DBState.db.characters?.[selectedChar]
      const characterId = character?.chaId
      const currentChats = new Map(
        (character?.chats ?? [])
          .filter((chat) => typeof chat.id === 'string' && chat.id)
          .map((chat) => [chat.id as string, scalarChatMetadata(chat as unknown as ChatSnapshot)]),
      )
      const currentFolders = new Map(
        (character?.chatFolders ?? [])
          .filter((folder) => typeof folder.id === 'string' && folder.id)
          .map((folder) => [folder.id, scalarChatFolderMetadata(folder as unknown as ChatFolder)]),
      )

      if (
        suppressRollbackDispatch ||
        !initialized ||
        projectionApplyEpoch !== previousProjectionApplyEpoch
      ) {
        initialized = true
        previousProjectionApplyEpoch = projectionApplyEpoch
        previousChats = currentChats
        previousFolders = currentFolders
        return
      }

      for (const [chatId, current] of currentChats) {
        const previous = previousChats.get(chatId)
        if (!previous) continue
        const patch = changedFields(previous, current)
        if (Object.keys(patch).length > 0) {
          // Capture the rollback lazily, only when there is a real change: the
          // per-row scalar baseline (`previous`) is exactly what a failed patch
          // must restore. No whole-characters clone.
          const rollback: ChatRowMetadataSnapshot = {
            selectedCharID: selectedChar,
            characterId,
            chatId,
            metadata: previous,
          }
          untrack(() => queueChatPatch(chatId, patch, rollback, delayMs))
        }
      }

      for (const [folderId, current] of currentFolders) {
        const previous = previousFolders.get(folderId)
        if (!previous) continue
        const patch = changedFields(previous, current)
        if (Object.keys(patch).length > 0) {
          const rollback: ChatFolderRowMetadataSnapshot = {
            selectedCharID: selectedChar,
            characterId,
            folderId,
            metadata: previous,
          }
          untrack(() => queueFolderPatch(folderId, patch, rollback, delayMs))
        }
      }

      previousChats = currentChats
      previousFolders = currentFolders
    })
  })

  watcherRefs = 1
  return () => {
    watcherRefs -= 1
    if (watcherRefs <= 0) {
      flushPendingServerBackedChatPatches()
      activeStop?.()
      activeStop = null
      watcherRefs = 0
    }
  }
}

function queueChatPatch(
  chatId: string,
  patch: ChatSnapshot,
  rollback: ChatRowMetadataSnapshot,
  delay: number,
): void {
  const pendingChatPatch = pendingChatPatches.get(chatId)
  if (pendingChatPatch?.timer) clearTimeout(pendingChatPatch.timer)

  // Keep the earliest pending rollback so a debounced merge still restores the
  // metadata as it was before the first queued change.
  const nextPatch: PendingChatPatch = pendingChatPatch
    ? {
        ...pendingChatPatch,
        patch: { ...pendingChatPatch.patch, ...patch },
        timer: null,
      }
    : {
        chatId,
        patch,
        rollback,
        timer: null,
      }

  nextPatch.timer = setTimeout(() => runPendingChatPatch(chatId), delay)
  pendingChatPatches.set(chatId, nextPatch)
}

function queueFolderPatch(
  folderId: string,
  patch: ChatFolderSnapshot,
  rollback: ChatFolderRowMetadataSnapshot,
  delay: number,
): void {
  const pendingFolderPatch = pendingFolderPatches.get(folderId)
  if (pendingFolderPatch?.timer) clearTimeout(pendingFolderPatch.timer)

  const nextPatch: PendingFolderPatch = pendingFolderPatch
    ? {
        ...pendingFolderPatch,
        patch: { ...pendingFolderPatch.patch, ...patch },
        timer: null,
      }
    : {
        folderId,
        patch,
        rollback,
        timer: null,
      }

  nextPatch.timer = setTimeout(() => runPendingFolderPatch(folderId), delay)
  pendingFolderPatches.set(folderId, nextPatch)
}

export function flushPendingServerBackedChatPatches(
  options: ServerCommandTransportOptions = {},
): void {
  for (const chatId of Array.from(pendingChatPatches.keys())) {
    runPendingChatPatch(chatId, options)
  }
  for (const folderId of Array.from(pendingFolderPatches.keys())) {
    runPendingFolderPatch(folderId, options)
  }
}

function runPendingChatPatch(chatId: string, options: ServerCommandTransportOptions = {}): void {
  const commandPatch = pendingChatPatches.get(chatId)
  if (!commandPatch) return
  if (commandPatch.timer) clearTimeout(commandPatch.timer)
  pendingChatPatches.delete(chatId)
  dispatchUpdateChatRow(commandPatch.chatId, commandPatch.patch, commandPatch.rollback, options)
}

function runPendingFolderPatch(
  folderId: string,
  options: ServerCommandTransportOptions = {},
): void {
  const commandPatch = pendingFolderPatches.get(folderId)
  if (!commandPatch) return
  if (commandPatch.timer) clearTimeout(commandPatch.timer)
  pendingFolderPatches.delete(folderId)
  dispatchUpdateChatFolderRow(
    commandPatch.folderId,
    commandPatch.patch,
    commandPatch.rollback,
    options,
  )
}

// Build the scalar metadata snapshot for one chat without ever serializing its
// `message` history or `localLore`: iterate only the allowed scalar keys and
// clone the small bounded values. The previous implementation
// `sanitizeChatPatch(cloneJsonValue(chat))` deep-cloned the whole chat (message
// history included) on every watcher fire, which also made the effect track the
// message array and re-run on every streaming chunk.
function scalarChatMetadata(chat: ChatSnapshot): ChatSnapshot {
  const metadata: ChatSnapshot = {}
  for (const key of CHAT_PATCH_ALLOWED_KEYS) {
    const value = (chat as Record<string, unknown>)[key]
    if (value === undefined) continue
    metadata[key] = cloneJsonValue(value)
  }
  return metadata
}

function scalarChatFolderMetadata(folder: ChatFolder): ChatFolderSnapshot {
  return {
    name: cloneJsonValue(folder.name),
    color: cloneJsonValue(folder.color),
    folded: cloneJsonValue(folder.folded),
  }
}

function changedFields<T extends Record<string, unknown>>(previous: T, current: T): T {
  const patch: Record<string, unknown> = {}
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)])
  for (const key of keys) {
    if (snapshotJson(previous[key]) !== snapshotJson(current[key])) {
      patch[key] = cloneJsonValue(current[key])
    }
  }
  return patch as T
}

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

export function rollbackServerBackedChatMetadata(snapshot: ChatStateSnapshot): void {
  suppressRollbackDispatch = true
  try {
    restoreChatState(snapshot)
  } finally {
    queueMicrotask(() => {
      suppressRollbackDispatch = false
    })
  }
}
