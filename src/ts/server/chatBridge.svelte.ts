import { untrack } from 'svelte'
import { get } from 'svelte/store'
import {
  CHAT_PATCH_ALLOWED_KEYS,
  cloneJsonValue,
  dispatchUpdateChatFolderRow,
  dispatchUpdateChatRow,
  restoreChatFolderRowMetadata,
  restoreChatRowMetadata,
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
import { selectedCharID } from '../stores.svelte'
import type { Chat, ChatFolder } from '../storage/database.svelte'
import { getServerResourceApplyEpoch, withTrustedResourceWrite } from './resourceWriteGuard.svelte'
import { getResourceDatabase as getDatabase } from './resourceState.svelte'
import { dispatchDurableMutation } from './durableMutationDispatch'
import { registerPendingBridgePatchFlusher } from './pendingBridgeFlushRegistry'
import {
  acknowledgePendingMutation,
  stagePendingMutation,
  type DurableMutationIntent,
  type PendingMutationHandle,
} from './pendingMutationOutbox'
import { chatResourceOwnerMutationKey } from './resourceOwnerMutationKeys'

interface PendingChatPatch {
  chatId: string
  patch: ChatSnapshot
  rollback: ChatRowMetadataSnapshot
  timer: ReturnType<typeof setTimeout> | null
  intent: DurableMutationIntent
  outbox: PendingMutationHandle
}

interface PendingFolderPatch {
  folderId: string
  patch: ChatFolderSnapshot
  rollback: ChatFolderRowMetadataSnapshot
  timer: ReturnType<typeof setTimeout> | null
  intent: DurableMutationIntent
  outbox: PendingMutationHandle
}

interface InFlightChatPatch {
  sequence: number
  characterId: string | undefined
  selectedCharID: number
  patch: ChatSnapshot
}

interface InFlightFolderPatch {
  sequence: number
  characterId: string | undefined
  selectedCharID: number
  patch: ChatFolderSnapshot
}

const pendingChatPatches = new Map<string, PendingChatPatch>()
const pendingFolderPatches = new Map<string, PendingFolderPatch>()
const inFlightChatPatches = new Map<string, InFlightChatPatch[]>()
const inFlightFolderPatches = new Map<string, InFlightFolderPatch[]>()
let nextInFlightPatchSequence = 0
let suppressRollbackDispatch = false
let activeStop: (() => void) | null = null
let resetActiveChatMetadataBaselines: (() => void) | null = null
let watcherRefs = 0

export interface WatchServerBackedChatMetadataOptions {
  delayMs?: number
}

export interface ChatMetadataBaselines {
  selectedChar: number
  characterId: string | undefined
  chats: Map<string, ChatSnapshot>
  folders: Map<string, ChatFolderSnapshot>
}

export function watchServerBackedChatMetadata(options: WatchServerBackedChatMetadataOptions = {}): () => void {
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
  let previousSelectedChar = get(selectedCharID)
  let previousCharacterId = getDatabase().characters?.[previousSelectedChar]?.chaId
  let previousResourceApplyEpoch = getServerResourceApplyEpoch()

  resetActiveChatMetadataBaselines = () => {
    const current = currentChatMetadataBaselines()
    previousChats = current.chats
    previousFolders = current.folders
    previousSelectedChar = current.selectedChar
    previousCharacterId = current.characterId
    previousResourceApplyEpoch = getServerResourceApplyEpoch()
    initialized = true
  }

  activeStop = $effect.root(() => {
    $effect(() => {
      const resourceApplyEpoch = getServerResourceApplyEpoch()
      const resourceApplyChanged = resourceApplyEpoch !== previousResourceApplyEpoch
      if (resourceApplyChanged) {
        untrack(reassertPendingChatMetadataPatches)
      }
      const current = currentChatMetadataBaselines({
        selectedChar: previousSelectedChar,
        characterId: previousCharacterId,
        chats: previousChats,
        folders: previousFolders,
      })

      if (suppressRollbackDispatch || !initialized || resourceApplyChanged) {
        initialized = true
        previousResourceApplyEpoch = resourceApplyEpoch
        previousChats = current.chats
        previousFolders = current.folders
        previousSelectedChar = current.selectedChar
        previousCharacterId = current.characterId
        return
      }

      if (current.chats === previousChats && current.folders === previousFolders) {
        return
      }

      for (const [chatId, currentChat] of current.chats) {
        const previous = previousChats.get(chatId)
        if (!previous) continue
        if (previous === currentChat) continue
        const patch = changedFields(previous, currentChat)
        if (Object.keys(patch).length > 0) {
          // Capture the rollback lazily, only when there is a real change: the
          // per-row scalar baseline (`previous`) is exactly what a failed patch
          // must restore. No whole-characters clone.
          const rollback: ChatRowMetadataSnapshot = {
            selectedCharID: current.selectedChar,
            characterId: current.characterId,
            chatId,
            metadata: previous,
          }
          untrack(() => queueChatPatch(chatId, patch, rollback, delayMs))
        }
      }

      for (const [folderId, currentFolder] of current.folders) {
        const previous = previousFolders.get(folderId)
        if (!previous) continue
        if (previous === currentFolder) continue
        const patch = changedFields(previous, currentFolder)
        if (Object.keys(patch).length > 0) {
          const rollback: ChatFolderRowMetadataSnapshot = {
            selectedCharID: current.selectedChar,
            characterId: current.characterId,
            folderId,
            metadata: previous,
          }
          untrack(() => queueFolderPatch(folderId, patch, rollback, delayMs))
        }
      }

      previousChats = current.chats
      previousFolders = current.folders
      previousSelectedChar = current.selectedChar
      previousCharacterId = current.characterId
    })
  })

  watcherRefs = 1
  return () => {
    watcherRefs -= 1
    if (watcherRefs <= 0) {
      flushPendingServerBackedChatPatches()
      activeStop?.()
      activeStop = null
      resetActiveChatMetadataBaselines = null
      watcherRefs = 0
    }
  }
}

/**
 * A caller that persists a metadata mutation directly can advance the watcher
 * baseline synchronously so the compatibility bridge does not enqueue the same
 * optimistic write a second time.
 */
export function syncServerBackedChatMetadataBaselines(): void {
  resetActiveChatMetadataBaselines?.()
}

function queueChatPatch(chatId: string, patch: ChatSnapshot, rollback: ChatRowMetadataSnapshot, delay: number): void {
  const pendingChatPatch = pendingChatPatches.get(chatId)
  if (pendingChatPatch?.timer) clearTimeout(pendingChatPatch.timer)

  const commandPatch = sanitizeBridgeChatPatch({ ...(pendingChatPatch?.patch ?? {}), ...patch })
  if (Object.keys(commandPatch).length === 0) {
    if (pendingChatPatch) void acknowledgePendingMutation(pendingChatPatch.outbox)
    pendingChatPatches.delete(chatId)
    return
  }

  // Keep the earliest pending rollback so a debounced merge still restores the
  // metadata as it was before the first queued change.
  const intent = chatPatchDurableIntent(chatId, commandPatch)
  const nextPatch: PendingChatPatch = {
    chatId,
    patch: commandPatch,
    rollback: pendingChatPatch?.rollback ?? rollback,
    timer: null,
    intent,
    outbox: stagePendingMutation(
      chatResourceOwnerMutationKey(chatId, rollback.characterId),
      intent,
      pendingChatPatch?.outbox,
    ),
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

  const commandPatch = cloneJsonValue({ ...(pendingFolderPatch?.patch ?? {}), ...patch })
  if (Object.keys(commandPatch).length === 0) {
    if (pendingFolderPatch) void acknowledgePendingMutation(pendingFolderPatch.outbox)
    pendingFolderPatches.delete(folderId)
    return
  }

  const intent = chatFolderPatchDurableIntent(folderId, commandPatch)
  const nextPatch: PendingFolderPatch = {
    folderId,
    patch: commandPatch,
    rollback: pendingFolderPatch?.rollback ?? rollback,
    timer: null,
    intent,
    outbox: stagePendingMutation(`chat-folder-metadata:${folderId}`, intent, pendingFolderPatch?.outbox),
  }

  nextPatch.timer = setTimeout(() => runPendingFolderPatch(folderId), delay)
  pendingFolderPatches.set(folderId, nextPatch)
}

export function flushPendingServerBackedChatPatches(options: ServerCommandTransportOptions = {}): void {
  for (const chatId of Array.from(pendingChatPatches.keys())) {
    runPendingChatPatch(chatId, options)
  }
  for (const folderId of Array.from(pendingFolderPatches.keys())) {
    runPendingFolderPatch(folderId, options)
  }
}

registerPendingBridgePatchFlusher('chat-metadata', flushPendingServerBackedChatPatches)

function runPendingChatPatch(chatId: string, options: ServerCommandTransportOptions = {}): void {
  const commandPatch = pendingChatPatches.get(chatId)
  if (!commandPatch) return
  if (commandPatch.timer) clearTimeout(commandPatch.timer)
  pendingChatPatches.delete(chatId)
  const inFlight = registerInFlightChatPatch(commandPatch)
  const result = dispatchDurableMutation(commandPatch.outbox, commandPatch.intent, (transport) => {
    const dispatched = dispatchUpdateChatRow(
      commandPatch.chatId,
      commandPatch.patch,
      commandPatch.rollback,
      { ...options, ...transport },
      (snapshot) => {
        clearInFlightChatPatch(commandPatch.chatId, inFlight.sequence)
        rollbackServerBackedChatRowMetadata(snapshot)
      },
    )
    return dispatched ?? Promise.resolve({ status: 'unavailable' as const })
  })
  void result.then(
    () => clearInFlightChatPatch(commandPatch.chatId, inFlight.sequence),
    () => clearInFlightChatPatch(commandPatch.chatId, inFlight.sequence),
  )
}

function runPendingFolderPatch(folderId: string, options: ServerCommandTransportOptions = {}): void {
  const commandPatch = pendingFolderPatches.get(folderId)
  if (!commandPatch) return
  if (commandPatch.timer) clearTimeout(commandPatch.timer)
  pendingFolderPatches.delete(folderId)
  const inFlight = registerInFlightFolderPatch(commandPatch)
  const result = dispatchDurableMutation(commandPatch.outbox, commandPatch.intent, (transport) => {
    const dispatched = dispatchUpdateChatFolderRow(
      commandPatch.folderId,
      commandPatch.patch,
      commandPatch.rollback,
      { ...options, ...transport },
      (snapshot) => {
        clearInFlightFolderPatch(commandPatch.folderId, inFlight.sequence)
        rollbackServerBackedChatFolderRowMetadata(snapshot)
      },
    )
    return dispatched ?? Promise.resolve({ status: 'unavailable' as const })
  })
  void result.then(
    () => clearInFlightFolderPatch(commandPatch.folderId, inFlight.sequence),
    () => clearInFlightFolderPatch(commandPatch.folderId, inFlight.sequence),
  )
}

function sanitizeBridgeChatPatch(patch: ChatSnapshot): ChatSnapshot {
  const sanitized: ChatSnapshot = {}
  for (const [key, value] of Object.entries(patch)) {
    if (!CHAT_PATCH_ALLOWED_KEYS.has(key) || value === undefined) continue
    sanitized[key] = cloneJsonValue(value)
  }
  return sanitized
}

function chatPatchDurableIntent(chatId: string, patch: ChatSnapshot): DurableMutationIntent {
  return {
    version: 1,
    requests: [
      {
        method: 'PATCH',
        path: `/chats/${encodeURIComponent(chatId)}`,
        body: { patch: cloneJsonValue(patch), select: false },
      },
    ],
  }
}

function chatFolderPatchDurableIntent(folderId: string, patch: ChatFolderSnapshot): DurableMutationIntent {
  return {
    version: 1,
    requests: [
      {
        method: 'PATCH',
        path: `/chat-folders/${encodeURIComponent(folderId)}`,
        body: { patch: cloneJsonValue(patch) },
      },
    ],
  }
}

function registerInFlightChatPatch(pending: PendingChatPatch): InFlightChatPatch {
  const patch: InFlightChatPatch = {
    sequence: ++nextInFlightPatchSequence,
    characterId: pending.rollback.characterId,
    selectedCharID: pending.rollback.selectedCharID,
    patch: cloneJsonValue(pending.patch),
  }
  const inFlight = inFlightChatPatches.get(pending.chatId) ?? []
  inFlight.push(patch)
  inFlightChatPatches.set(pending.chatId, inFlight)
  return patch
}

function registerInFlightFolderPatch(pending: PendingFolderPatch): InFlightFolderPatch {
  const patch: InFlightFolderPatch = {
    sequence: ++nextInFlightPatchSequence,
    characterId: pending.rollback.characterId,
    selectedCharID: pending.rollback.selectedCharID,
    patch: cloneJsonValue(pending.patch),
  }
  const inFlight = inFlightFolderPatches.get(pending.folderId) ?? []
  inFlight.push(patch)
  inFlightFolderPatches.set(pending.folderId, inFlight)
  return patch
}

function clearInFlightChatPatch(chatId: string, sequence: number): void {
  clearInFlightPatch(inFlightChatPatches, chatId, sequence)
}

function clearInFlightFolderPatch(folderId: string, sequence: number): void {
  clearInFlightPatch(inFlightFolderPatches, folderId, sequence)
}

function clearInFlightPatch<T extends { sequence: number }>(
  patches: Map<string, T[]>,
  id: string,
  sequence: number,
): void {
  const current = patches.get(id)
  if (!current) return
  const next = current.filter((patch) => patch.sequence !== sequence)
  if (next.length === 0) {
    patches.delete(id)
  } else {
    patches.set(id, next)
  }
}

function reassertPendingChatMetadataPatches(): void {
  if (
    pendingChatPatches.size === 0 &&
    pendingFolderPatches.size === 0 &&
    inFlightChatPatches.size === 0 &&
    inFlightFolderPatches.size === 0
  ) {
    return
  }

  withTrustedResourceWrite(() => {
    for (const [chatId, patches] of inFlightChatPatches) {
      for (const pending of patches) {
        applyChatMetadataPatch(chatId, pending.characterId, pending.selectedCharID, pending.patch)
      }
    }
    for (const [chatId, pending] of pendingChatPatches) {
      applyChatMetadataPatch(chatId, pending.rollback.characterId, pending.rollback.selectedCharID, pending.patch)
    }
    for (const [folderId, patches] of inFlightFolderPatches) {
      for (const pending of patches) {
        applyFolderMetadataPatch(folderId, pending.characterId, pending.selectedCharID, pending.patch)
      }
    }
    for (const [folderId, pending] of pendingFolderPatches) {
      applyFolderMetadataPatch(folderId, pending.rollback.characterId, pending.rollback.selectedCharID, pending.patch)
    }
  })
}

function applyChatMetadataPatch(
  chatId: string,
  characterId: string | undefined,
  selectedChar: number,
  patch: ChatSnapshot,
): void {
  const character = resolveMetadataCharacter(characterId, selectedChar)
  const chat = character?.chats?.find((candidate) => candidate.id === chatId)
  if (chat) applyMetadataPatch(chat as unknown as Record<string, unknown>, patch)
}

function applyFolderMetadataPatch(
  folderId: string,
  characterId: string | undefined,
  selectedChar: number,
  patch: ChatFolderSnapshot,
): void {
  const character = resolveMetadataCharacter(characterId, selectedChar)
  const folder = character?.chatFolders?.find((candidate) => candidate.id === folderId)
  if (folder) applyMetadataPatch(folder as unknown as Record<string, unknown>, patch)
}

function resolveMetadataCharacter(characterId: string | undefined, selectedChar: number) {
  return (
    getDatabase().characters?.find((candidate) => Boolean(characterId) && candidate.chaId === characterId) ??
    getDatabase().characters?.[selectedChar]
  )
}

function applyMetadataPatch(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete target[key]
    } else {
      target[key] = cloneJsonValue(value)
    }
  }
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

export function currentChatMetadataBaselines(previous?: ChatMetadataBaselines): ChatMetadataBaselines {
  const selectedChar = get(selectedCharID)
  const character = getDatabase().characters?.[selectedChar]
  const characterId = character?.chaId
  const chats = (character?.chats ?? []).filter(hasStringId)
  const folders = (character?.chatFolders ?? []).filter(hasStringId)
  if (!previous || previous.selectedChar !== selectedChar || previous.characterId !== characterId) {
    return {
      selectedChar,
      characterId,
      chats: new Map<string, ChatSnapshot>(
        chats.map((chat): [string, ChatSnapshot] => [chat.id, scalarChatMetadata(chat as unknown as ChatSnapshot)]),
      ),
      folders: new Map<string, ChatFolderSnapshot>(
        folders.map((folder): [string, ChatFolderSnapshot] => [
          folder.id,
          scalarChatFolderMetadata(folder as unknown as ChatFolder),
        ]),
      ),
    }
  }

  return {
    selectedChar,
    characterId,
    chats: reconcileChatMetadataMap(previous.chats, chats),
    folders: reconcileFolderMetadataMap(previous.folders, folders),
  }
}

function hasStringId<T extends { id?: unknown }>(row: T): row is T & { id: string } {
  return typeof row.id === 'string' && row.id.length > 0
}

function reconcileChatMetadataMap(
  previous: Map<string, ChatSnapshot>,
  chats: Array<Chat & { id: string }>,
): Map<string, ChatSnapshot> {
  let next: Map<string, ChatSnapshot> | null = null
  const liveIds = new Set<string>()
  for (const chat of chats) {
    liveIds.add(chat.id)
    const previousSnapshot = previous.get(chat.id)
    if (previousSnapshot && chatMetadataMatches(previousSnapshot, chat)) continue
    next ??= new Map(previous)
    next.set(chat.id, scalarChatMetadata(chat as unknown as ChatSnapshot))
  }
  if (liveIds.size !== previous.size) {
    next ??= new Map(previous)
    for (const chatId of previous.keys()) {
      if (!liveIds.has(chatId)) next.delete(chatId)
    }
  }
  return next ?? previous
}

function reconcileFolderMetadataMap(
  previous: Map<string, ChatFolderSnapshot>,
  folders: Array<ChatFolder & { id: string }>,
): Map<string, ChatFolderSnapshot> {
  let next: Map<string, ChatFolderSnapshot> | null = null
  const liveIds = new Set<string>()
  for (const folder of folders) {
    liveIds.add(folder.id)
    const previousSnapshot = previous.get(folder.id)
    if (previousSnapshot && folderMetadataMatches(previousSnapshot, folder)) continue
    next ??= new Map(previous)
    next.set(folder.id, scalarChatFolderMetadata(folder as unknown as ChatFolder))
  }
  if (liveIds.size !== previous.size) {
    next ??= new Map(previous)
    for (const folderId of previous.keys()) {
      if (!liveIds.has(folderId)) next.delete(folderId)
    }
  }
  return next ?? previous
}

function chatMetadataMatches(previous: ChatSnapshot, chat: Chat): boolean {
  const row = chat as unknown as Record<string, unknown>
  for (const key of CHAT_PATCH_ALLOWED_KEYS) {
    const currentValue = row[key]
    if (currentValue === undefined) {
      if (key in previous) return false
      continue
    }
    if (snapshotJson(previous[key]) !== snapshotJson(currentValue)) return false
  }
  return true
}

function folderMetadataMatches(previous: ChatFolderSnapshot, folder: ChatFolder): boolean {
  return (
    snapshotJson(previous.name) === snapshotJson(folder.name) &&
    snapshotJson(previous.color) === snapshotJson(folder.color) &&
    snapshotJson(previous.folded) === snapshotJson(folder.folded)
  )
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
    resetActiveChatMetadataBaselines?.()
  } finally {
    queueMicrotask(() => {
      suppressRollbackDispatch = false
    })
  }
}

export function rollbackServerBackedChatRowMetadata(snapshot: ChatRowMetadataSnapshot): void {
  suppressRollbackDispatch = true
  try {
    restoreChatRowMetadata(snapshot)
    resetActiveChatMetadataBaselines?.()
  } finally {
    queueMicrotask(() => {
      suppressRollbackDispatch = false
    })
  }
}

export function rollbackServerBackedChatFolderRowMetadata(snapshot: ChatFolderRowMetadataSnapshot): void {
  suppressRollbackDispatch = true
  try {
    restoreChatFolderRowMetadata(snapshot)
    resetActiveChatMetadataBaselines?.()
  } finally {
    queueMicrotask(() => {
      suppressRollbackDispatch = false
    })
  }
}
