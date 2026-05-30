import { untrack } from 'svelte'
import { get } from 'svelte/store'
import { v4 } from 'uuid'
import type { RisuModule } from '../process/modules'
import type { character, Chat, loreBook } from '../storage/database.svelte'
import { DBState, selectedCharID } from '../stores.svelte'
import {
  canUseServerCommands,
  createGlobalLorebookCommand,
  deleteGlobalLorebookCommand,
  reorderGlobalLorebooksCommand,
  replaceCharacterLorebooksCommand,
  replaceChatLorebooksCommand,
  replaceGlobalLorebookEntriesCommand,
  replaceModuleLorebooksCommand,
  runServerCommand,
  selectGlobalLorebookCommand,
  updateGlobalLorebookCommand,
  type GlobalLorebookSnapshot,
  type LorebookEntrySnapshot,
  type ServerCommandResult,
} from './commands'
import { withTrustedServerProjectionWrite } from './projectionWriteGuard.svelte'

type GlobalLorebook = { id?: string; name: string; data: loreBook[] }

export interface LorebookStateSnapshot {
  loreBook: GlobalLorebook[]
  loreBookPage: number
  characters: character[]
  modules: RisuModule[]
  selectedCharID: number
}

interface PendingCollectionReplacement {
  key: string
  previous: LorebookStateSnapshot
  timer: ReturnType<typeof setTimeout> | null
  command: () => Promise<ServerCommandResult<Record<string, unknown>>>
}

const pendingReplacements = new Map<string, PendingCollectionReplacement>()
let suppressRollbackDispatch = false

// Lazy-projection Phase 5 (no-data-loss invariant). Character `globalLore` is
// stubbed in the projection for non-open characters and hydrated on character-open;
// `checkNewFormat` then defaults a stubbed (absent) `globalLore` to `[]`
// (bootstrap.ts), so field-presence can no longer tell a stubbed character from a
// genuinely-empty hydrated one. This registry is the source of truth instead: the
// reactive watcher only ever snapshots/persists a character whose `globalLore` is
// HYDRATED here. A character that is stubbed (or re-stubbed by a projection
// re-apply) is absent from the registry, so a `[real]`→`[]` transition can never be
// observed as a deletion and persisted — the data-loss path this phase must kill.
// (Module `lorebook` keeps using field-presence: `checkNewFormat` never defaults an
// absent module lorebook to `[]`, so a stubbed disabled module stays `Array.isArray`
// === false and is already skipped below.)
const hydratedCharacterLorebooks = new Set<string>()

/** Mark a character's `globalLore` as hydrated (real, persistable). */
export function markCharacterLorebookHydrated(characterId: string): void {
  if (characterId) hydratedCharacterLorebooks.add(characterId)
}

/** Whether a character's `globalLore` is hydrated (not a stub). */
export function isCharacterLorebookHydrated(characterId: string): boolean {
  return hydratedCharacterLorebooks.has(characterId)
}

/**
 * Forget all hydrated-character marks — call BEFORE a full projection re-apply /
 * `characters`-slice merge re-stubs every character (mirrors `resetChatHydration`),
 * so a re-stubbed character is treated as non-hydrated until it is hydrated again.
 */
export function resetLorebookHydration(): void {
  hydratedCharacterLorebooks.clear()
}

/**
 * Record which characters arrive with a REAL (resident) `globalLore` in a raw
 * projection — read from the projection bytes BEFORE `checkNewFormat` can default an
 * absent value to `[]`. The bootstrap ships the selected character's `globalLore`
 * resident; everything else is a stub (absent) and stays non-hydrated until opened.
 */
export function recordHydratedCharacterLorebooks(
  characters: ReadonlyArray<{ chaId?: string; globalLore?: unknown }> | undefined,
): void {
  for (const character of characters ?? []) {
    if (character?.chaId && Array.isArray(character.globalLore)) {
      hydratedCharacterLorebooks.add(character.chaId)
    }
  }
}

export interface WatchServerBackedLorebooksOptions {
  delayMs?: number
}

export function currentLorebookStateSnapshot(): LorebookStateSnapshot {
  ensureAllClientLorebookIds()
  return {
    loreBook: cloneJsonValue((DBState.db.loreBook ?? []) as GlobalLorebook[]),
    loreBookPage: DBState.db.loreBookPage ?? 0,
    characters: cloneJsonValue(DBState.db.characters ?? []),
    modules: cloneJsonValue((DBState.db.modules ?? []) as RisuModule[]),
    selectedCharID: get(selectedCharID),
  }
}

export function restoreLorebookState(snapshot: LorebookStateSnapshot): void {
  withTrustedServerProjectionWrite(() => {
    DBState.db.loreBook = cloneJsonValue(snapshot.loreBook) as typeof DBState.db.loreBook
    DBState.db.loreBookPage = snapshot.loreBookPage
    DBState.db.characters = cloneJsonValue(snapshot.characters)
    DBState.db.modules = cloneJsonValue(snapshot.modules) as typeof DBState.db.modules
    selectedCharID.set(snapshot.selectedCharID)
  })
}

export function ensureClientLorebookEntryIds(entries: loreBook[]): loreBook[] {
  for (const entry of entries ?? []) {
    // Only write when an id is actually missing. An unconditional assignment
    // would trip the read-only projection guard's set trap even when the value
    // is unchanged, which breaks dispatch paths that pass projection-owned
    // entry arrays.
    if (typeof entry.id !== 'string' || !entry.id.trim()) {
      entry.id = v4()
    }
  }
  return entries
}

export function ensureAllClientLorebookIds(): void {
  withTrustedServerProjectionWrite(() => {
    for (const lorebook of (DBState.db.loreBook ?? []) as GlobalLorebook[]) {
      lorebook.id = typeof lorebook.id === 'string' && lorebook.id.trim() ? lorebook.id : v4()
      lorebook.data = ensureClientLorebookEntryIds(lorebook.data ?? [])
    }
    for (const character of DBState.db.characters ?? []) {
      // Only touch a HYDRATED character's globalLore — assigning ids to a stubbed
      // one would default its absent globalLore to `[]` and mask the stub.
      if (character.chaId && hydratedCharacterLorebooks.has(character.chaId)) {
        character.globalLore = ensureClientLorebookEntryIds(character.globalLore ?? [])
      }
      // Chat localLore stays resident (not stubbed in Phase 5).
      for (const chat of character.chats ?? []) {
        chat.localLore = ensureClientLorebookEntryIds(chat.localLore ?? [])
      }
    }
    for (const module of (DBState.db.modules ?? []) as RisuModule[]) {
      if (Array.isArray(module.lorebook)) {
        module.lorebook = ensureClientLorebookEntryIds(module.lorebook)
      }
    }
  })
}

export function dispatchCreateGlobalLorebook(
  lorebook: GlobalLorebook,
  previous: LorebookStateSnapshot,
): void {
  if (!canUseServerCommands()) return
  lorebook.id = typeof lorebook.id === 'string' && lorebook.id.trim() ? lorebook.id : v4()
  lorebook.data = ensureClientLorebookEntryIds(lorebook.data ?? [])
  void runServerCommand({
    command: (baseRevision) =>
      createGlobalLorebookCommand({
        baseRevision,
        lorebook: cloneJsonValue(lorebook) as GlobalLorebookSnapshot,
      }),
    rollback: () => restoreLorebookState(previous),
  })
}

export function dispatchUpdateGlobalLorebook(
  lorebookId: string,
  patch: Pick<GlobalLorebook, 'name'>,
  previous: LorebookStateSnapshot,
): void {
  if (!canUseServerCommands()) return
  void runServerCommand({
    command: (baseRevision) =>
      updateGlobalLorebookCommand({
        baseRevision,
        lorebookId,
        patch,
      }),
    rollback: () => restoreLorebookState(previous),
  })
}

export function dispatchDeleteGlobalLorebook(
  lorebookId: string,
  previous: LorebookStateSnapshot,
): void {
  if (!canUseServerCommands()) return
  void runServerCommand({
    command: (baseRevision) =>
      deleteGlobalLorebookCommand({
        baseRevision,
        lorebookId,
      }),
    rollback: () => restoreLorebookState(previous),
  })
}

export function dispatchReorderGlobalLorebooks(previous: LorebookStateSnapshot): void {
  if (!canUseServerCommands()) return
  const lorebookIds = ((DBState.db.loreBook ?? []) as GlobalLorebook[])
    .map((lorebook) => lorebook.id)
    .filter((id): id is string => typeof id === 'string' && id.trim() !== '')
  void runServerCommand({
    command: (baseRevision) =>
      reorderGlobalLorebooksCommand({
        baseRevision,
        lorebookIds,
      }),
    rollback: () => restoreLorebookState(previous),
  })
}

export function dispatchSelectGlobalLorebook(
  lorebookId: string,
  previous: LorebookStateSnapshot,
): void {
  if (!canUseServerCommands()) return
  void runServerCommand({
    command: (baseRevision) =>
      selectGlobalLorebookCommand({
        baseRevision,
        lorebookId,
      }),
    rollback: () => restoreLorebookState(previous),
  })
}

export function dispatchReplaceGlobalLorebookEntries(
  lorebookId: string,
  entries: loreBook[],
  previous: LorebookStateSnapshot,
): void {
  if (!canUseServerCommands()) return
  ensureClientLorebookEntryIds(entries)
  queueReplacement(
    `global:${lorebookId}`,
    previous,
    () =>
      runServerCommand({
        command: (baseRevision) =>
          replaceGlobalLorebookEntriesCommand({
            baseRevision,
            lorebookId,
            entries: cloneJsonValue(entries) as LorebookEntrySnapshot[],
          }),
        rollback: () => rollbackServerBackedLorebooks(previous),
      }),
    250,
  )
}

export function dispatchReplaceCharacterLorebooks(
  characterId: string,
  entries: loreBook[],
  previous: LorebookStateSnapshot,
  delayMs = 250,
): void {
  if (!canUseServerCommands()) return
  ensureClientLorebookEntryIds(entries)
  queueReplacement(
    `character:${characterId}`,
    previous,
    () =>
      runServerCommand({
        command: (baseRevision) =>
          replaceCharacterLorebooksCommand({
            baseRevision,
            characterId,
            entries: cloneJsonValue(entries) as LorebookEntrySnapshot[],
          }),
        rollback: () => rollbackServerBackedLorebooks(previous),
      }),
    delayMs,
  )
}

export function dispatchReplaceChatLorebooks(
  chatId: string,
  entries: loreBook[],
  previous: LorebookStateSnapshot,
  delayMs = 250,
): void {
  if (!canUseServerCommands()) return
  ensureClientLorebookEntryIds(entries)
  queueReplacement(
    `chat:${chatId}`,
    previous,
    () =>
      runServerCommand({
        command: (baseRevision) =>
          replaceChatLorebooksCommand({
            baseRevision,
            chatId,
            entries: cloneJsonValue(entries) as LorebookEntrySnapshot[],
          }),
        rollback: () => rollbackServerBackedLorebooks(previous),
      }),
    delayMs,
  )
}

export function dispatchReplaceModuleLorebooks(
  moduleId: string,
  entries: loreBook[],
  previous: LorebookStateSnapshot,
  delayMs = 250,
): void {
  if (!canUseServerCommands()) return
  ensureClientLorebookEntryIds(entries)
  queueReplacement(
    `module:${moduleId}`,
    previous,
    () =>
      runServerCommand({
        command: (baseRevision) =>
          replaceModuleLorebooksCommand({
            baseRevision,
            moduleId,
            entries: cloneJsonValue(entries) as LorebookEntrySnapshot[],
          }),
        rollback: () => rollbackServerBackedLorebooks(previous),
      }),
    delayMs,
  )
}

export function watchServerBackedLorebooks(
  options: WatchServerBackedLorebooksOptions = {},
): () => void {
  if (!canUseServerCommands()) return () => {}
  const delayMs = options.delayMs ?? 300
  let initialized = false
  let previousSnapshots = new Map<string, string>()
  let previousState = currentLorebookStateSnapshot()

  const stop = $effect.root(() => {
    $effect(() => {
      ensureAllClientLorebookIds()
      const currentState = currentLorebookStateSnapshot()
      const currentSnapshots = collectLorebookCollectionSnapshots()

      if (suppressRollbackDispatch || !initialized) {
        initialized = true
        previousSnapshots = currentSnapshots
        previousState = currentState
        return
      }

      for (const [key, snapshot] of currentSnapshots) {
        if (!previousSnapshots.has(key)) continue
        if (snapshot === previousSnapshots.get(key)) continue
        untrack(() => dispatchWatchedReplacement(key, previousState, delayMs))
      }

      previousSnapshots = currentSnapshots
      previousState = currentState
    })
  })

  return stop
}

function dispatchWatchedReplacement(
  key: string,
  previous: LorebookStateSnapshot,
  delayMs: number,
): void {
  if (key.startsWith('global:')) {
    const lorebookId = key.slice('global:'.length)
    const lorebook = ((DBState.db.loreBook ?? []) as GlobalLorebook[]).find(
      (candidate) => candidate.id === lorebookId,
    )
    if (lorebook) dispatchReplaceGlobalLorebookEntries(lorebookId, lorebook.data ?? [], previous)
    return
  }
  if (key.startsWith('globalMeta:')) {
    const lorebookId = key.slice('globalMeta:'.length)
    const lorebook = ((DBState.db.loreBook ?? []) as GlobalLorebook[]).find(
      (candidate) => candidate.id === lorebookId,
    )
    if (lorebook?.name) dispatchUpdateGlobalLorebook(lorebookId, { name: lorebook.name }, previous)
    return
  }
  if (key.startsWith('character:')) {
    const characterId = key.slice('character:'.length)
    // Hard guard (defence in depth): never persist a non-hydrated character's
    // globalLore, even if a snapshot somehow slipped through.
    if (!hydratedCharacterLorebooks.has(characterId)) return
    const character = DBState.db.characters?.find((candidate) => candidate.chaId === characterId)
    if (character) {
      dispatchReplaceCharacterLorebooks(characterId, character.globalLore ?? [], previous, delayMs)
    }
    return
  }
  if (key.startsWith('chat:')) {
    const chatId = key.slice('chat:'.length)
    const chat = findChat(chatId)
    if (chat) dispatchReplaceChatLorebooks(chatId, chat.localLore ?? [], previous, delayMs)
    return
  }
  if (key.startsWith('module:')) {
    const moduleId = key.slice('module:'.length)
    const module = ((DBState.db.modules ?? []) as RisuModule[]).find(
      (candidate) => candidate.id === moduleId,
    )
    if (module?.lorebook) {
      dispatchReplaceModuleLorebooks(moduleId, module.lorebook, previous, delayMs)
    }
  }
}

function collectLorebookCollectionSnapshots(): Map<string, string> {
  const snapshots = new Map<string, string>()
  for (const lorebook of (DBState.db.loreBook ?? []) as GlobalLorebook[]) {
    if (lorebook.id) {
      snapshots.set(`global:${lorebook.id}`, snapshotJson(lorebook.data ?? []))
      snapshots.set(`globalMeta:${lorebook.id}`, snapshotJson({ name: lorebook.name }))
    }
  }
  for (const character of DBState.db.characters ?? []) {
    // Snapshot a character's globalLore ONLY when it is hydrated; a stubbed /
    // not-yet-hydrated character is never tracked, so a re-stub can't be diffed into
    // a deletion (the no-data-loss invariant).
    if (character.chaId && hydratedCharacterLorebooks.has(character.chaId)) {
      snapshots.set(`character:${character.chaId}`, snapshotJson(character.globalLore ?? []))
    }
    for (const chat of character.chats ?? []) {
      if (chat.id) snapshots.set(`chat:${chat.id}`, snapshotJson(chat.localLore ?? []))
    }
  }
  for (const module of (DBState.db.modules ?? []) as RisuModule[]) {
    if (module.id && Array.isArray(module.lorebook)) {
      snapshots.set(`module:${module.id}`, snapshotJson(module.lorebook))
    }
  }
  return snapshots
}

function queueReplacement(
  key: string,
  previous: LorebookStateSnapshot,
  command: () => Promise<ServerCommandResult<Record<string, unknown>>>,
  delay: number,
): void {
  const existing = pendingReplacements.get(key)
  if (existing?.timer) clearTimeout(existing.timer)

  const pending: PendingCollectionReplacement = {
    key,
    previous: existing?.previous ?? previous,
    command,
    timer: null,
  }
  pending.timer = setTimeout(() => {
    pendingReplacements.delete(key)
    void pending.command()
  }, delay)
  pendingReplacements.set(key, pending)
}

function rollbackServerBackedLorebooks(snapshot: LorebookStateSnapshot): void {
  suppressRollbackDispatch = true
  try {
    restoreLorebookState(snapshot)
  } finally {
    queueMicrotask(() => {
      suppressRollbackDispatch = false
    })
  }
}

function findChat(chatId: string): Chat | null {
  for (const character of DBState.db.characters ?? []) {
    const chat = character.chats?.find((candidate) => candidate.id === chatId)
    if (chat) return chat
  }
  return null
}

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
