import { untrack } from 'svelte'
import { get } from 'svelte/store'
import {
  cloneJsonValue,
  currentChatStateSnapshot,
  dispatchUpdateChat,
  dispatchUpdateChatFolder,
  restoreChatState,
  sanitizeChatPatch,
  type ChatStateSnapshot,
} from '../chatCommands'
import { canUseServerCommands, type ChatFolderSnapshot, type ChatSnapshot } from './commands'
import { DBState, selectedCharID } from '../stores.svelte'
import type { ChatFolder } from '../storage/database.svelte'

interface PendingChatPatch {
  chatId: string
  patch: ChatSnapshot
  previous: ChatStateSnapshot
  timer: ReturnType<typeof setTimeout> | null
}

interface PendingFolderPatch {
  folderId: string
  patch: ChatFolderSnapshot
  previous: ChatStateSnapshot
  timer: ReturnType<typeof setTimeout> | null
}

let pendingChatPatch: PendingChatPatch | null = null
let pendingFolderPatch: PendingFolderPatch | null = null
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
  let previousState = currentChatStateSnapshot()

  activeStop = $effect.root(() => {
    $effect(() => {
      const character = DBState.db.characters?.[get(selectedCharID)]
      const currentState = currentChatStateSnapshot()
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

      if (suppressRollbackDispatch || !initialized) {
        initialized = true
        previousChats = currentChats
        previousFolders = currentFolders
        previousState = currentState
        return
      }

      for (const [chatId, current] of currentChats) {
        const previous = previousChats.get(chatId)
        if (!previous) continue
        const patch = changedFields(previous, current)
        if (Object.keys(patch).length > 0) {
          untrack(() => queueChatPatch(chatId, patch, previousState, delayMs))
        }
      }

      for (const [folderId, current] of currentFolders) {
        const previous = previousFolders.get(folderId)
        if (!previous) continue
        const patch = changedFields(previous, current)
        if (Object.keys(patch).length > 0) {
          untrack(() => queueFolderPatch(folderId, patch, previousState, delayMs))
        }
      }

      previousChats = currentChats
      previousFolders = currentFolders
      previousState = currentState
    })
  })

  watcherRefs = 1
  return () => {
    watcherRefs -= 1
    if (watcherRefs <= 0) {
      activeStop?.()
      activeStop = null
      watcherRefs = 0
    }
  }
}

function queueChatPatch(
  chatId: string,
  patch: ChatSnapshot,
  previous: ChatStateSnapshot,
  delay: number,
): void {
  if (pendingChatPatch?.timer) clearTimeout(pendingChatPatch.timer)

  pendingChatPatch =
    pendingChatPatch && pendingChatPatch.chatId === chatId
      ? {
          ...pendingChatPatch,
          patch: { ...pendingChatPatch.patch, ...patch },
          timer: null,
        }
      : {
          chatId,
          patch,
          previous,
          timer: null,
        }

  pendingChatPatch.timer = setTimeout(() => {
    const commandPatch = pendingChatPatch
    pendingChatPatch = null
    if (!commandPatch) return
    dispatchUpdateChat(commandPatch.chatId, commandPatch.patch, commandPatch.previous)
  }, delay)
}

function queueFolderPatch(
  folderId: string,
  patch: ChatFolderSnapshot,
  previous: ChatStateSnapshot,
  delay: number,
): void {
  if (pendingFolderPatch?.timer) clearTimeout(pendingFolderPatch.timer)

  pendingFolderPatch =
    pendingFolderPatch && pendingFolderPatch.folderId === folderId
      ? {
          ...pendingFolderPatch,
          patch: { ...pendingFolderPatch.patch, ...patch },
          timer: null,
        }
      : {
          folderId,
          patch,
          previous,
          timer: null,
        }

  pendingFolderPatch.timer = setTimeout(() => {
    const commandPatch = pendingFolderPatch
    pendingFolderPatch = null
    if (!commandPatch) return
    dispatchUpdateChatFolder(commandPatch.folderId, commandPatch.patch, commandPatch.previous)
  }, delay)
}

function scalarChatMetadata(chat: ChatSnapshot): ChatSnapshot {
  return sanitizeChatPatch(cloneJsonValue(chat))
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
