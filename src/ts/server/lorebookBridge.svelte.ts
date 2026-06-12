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
  type ServerCommandTransportOptions,
} from './commands'
import { getServerProjectionApplyEpoch, withTrustedServerProjectionWrite } from './projectionWriteGuard.svelte'

type GlobalLorebook = { id?: string; name: string; data: loreBook[] }

export interface LorebookStateSnapshot {
  scopeKey?: string
  scopedValue?: unknown
  loreBook: GlobalLorebook[]
  loreBookPage: number
  characters: character[]
  modules: RisuModule[]
  selectedCharID: number
}

export interface LorebookEntryStateSnapshot {
  kind: 'entry'
  scopeKey: string
  entryId?: string
  index: number
  previousEntry: loreBook | null
  selectedCharID: number
}

type LorebookReplacementSnapshot = LorebookStateSnapshot | LorebookEntryStateSnapshot
type LorebookReplacementSource = 'collection' | 'entry'

interface PendingCollectionReplacement {
  key: string
  previous: LorebookReplacementSnapshot
  source: LorebookReplacementSource
  timer: ReturnType<typeof setTimeout> | null
  command: (options?: ServerCommandTransportOptions) => Promise<ServerCommandResult<Record<string, unknown>>>
}

const pendingReplacements = new Map<string, PendingCollectionReplacement>()
const pendingEntryEditKeys = new Set<string>()
const flushedEntryEditSnapshots = new Map<string, string>()
const flushedEntryEditClearSnapshots = new Map<string, string>()
let suppressRollbackDispatch = false

interface LocalLoreSnapshotCacheEntry {
  entries: loreBook[]
  snapshot: string
}

const characterScopeLocalLoreSnapshots = new Map<string, LocalLoreSnapshotCacheEntry>()

// Mirror of the selected character id as $state so a `character`-scoped watcher
// re-runs (and re-subscribes to the newly selected character's lore) when the
// user switches characters while the panel stays mounted. A bare
// `get(selectedCharID)` read would not re-run the effect on a switch, which could
// drop the first edit made to the newly selected character.
let selectedCharMirror = $state(-1)

// No-data-loss guard for character `globalLore` stubs. `checkNewFormat` defaults
// absent character lore to `[]`, so field presence cannot distinguish a stub from
// an empty hydrated lorebook. The watcher only snapshots/persists ids in this
// registry; re-stubbed characters are absent until hydrated again. Module
// lorebooks still use field presence because absent module lorebooks are not
// defaulted.
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
 * Forget all hydrated-character marks before a full projection re-apply or
 * `characters` merge re-stubs every character, so each re-stubbed character stays
 * non-hydrated until it is fetched again.
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

/**
 * Restrict the watcher's change-detection snapshot to the mounting panel's
 * collection so a single lorebook keystroke does not rebuild a DB-wide lore map
 * on every reactive fire.
 *
 * - `all` (default): the original whole-DB scan (global + every character's
 *   globalLore/chats + every module). Used by callers with no narrower scope and
 *   by the no-data-loss tests.
 * - `global`: only the global `loreBook` list (the `lorepreset` modal and the
 *   global-mode `LoreBookSetting`).
 * - `character`: only the selected character's globalLore and its chats'
 *   localLore (the character `LoreBookSetting` sidebar).
 * - `module`: only the open module's lorebook (the module `ModuleMenu`).
 */
export type LorebookWatchScope =
  | { kind: 'all' }
  | { kind: 'global' }
  | { kind: 'character' }
  | { kind: 'module'; moduleId: string }

export interface WatchServerBackedLorebooksOptions {
  delayMs?: number
  scope?: LorebookWatchScope
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
  if (snapshot.scopeKey) {
    restoreScopedLorebookState(snapshot)
    return
  }

  withTrustedServerProjectionWrite(() => {
    DBState.db.loreBook = cloneJsonValue(snapshot.loreBook) as typeof DBState.db.loreBook
    DBState.db.loreBookPage = snapshot.loreBookPage
    DBState.db.characters = cloneJsonValue(snapshot.characters)
    DBState.db.modules = cloneJsonValue(snapshot.modules) as typeof DBState.db.modules
    selectedCharID.set(snapshot.selectedCharID)
  })
}

// Narrow global-lorebook rollback. Global-lorebook select/create/delete only
// touch `loreBook` and `loreBookPage`, so the snapshot omits the whole
// `characters` and `modules` collections that the heavy `LorebookStateSnapshot`
// clones. The full snapshot stays for paths that can mutate character/module
// lore alongside the global list.
export interface GlobalLorebookStateSnapshot {
  loreBook: GlobalLorebook[]
  loreBookPage: number
  selectedCharID: number
}

export function currentGlobalLorebookStateSnapshot(): GlobalLorebookStateSnapshot {
  // This narrow snapshot restores only `loreBook`/`loreBookPage`, so it only
  // needs ids on the global list — the whole-DB id-assign (every character's
  // globalLore, every chat's localLore, every module) was pure overhead (L32).
  ensureGlobalLorebookListIds()
  return {
    loreBook: cloneJsonValue((DBState.db.loreBook ?? []) as GlobalLorebook[]),
    loreBookPage: DBState.db.loreBookPage ?? 0,
    selectedCharID: get(selectedCharID),
  }
}

export function restoreGlobalLorebookState(snapshot: GlobalLorebookStateSnapshot): void {
  withTrustedServerProjectionWrite(() => {
    DBState.db.loreBook = cloneJsonValue(snapshot.loreBook) as typeof DBState.db.loreBook
    DBState.db.loreBookPage = snapshot.loreBookPage
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
    assignGlobalLorebookListIds()
    for (const character of DBState.db.characters ?? []) {
      // Only touch a HYDRATED character's globalLore — assigning ids to a stubbed
      // one would default its absent globalLore to `[]` and mask the stub.
      if (character.chaId && hydratedCharacterLorebooks.has(character.chaId)) {
        character.globalLore = ensureClientLorebookEntryIds(character.globalLore ?? [])
      }
      // Chat localLore stays resident, not stubbed.
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

function ensureWatchScopeClientLorebookIds(scope: LorebookWatchScope): void {
  switch (scope.kind) {
    case 'all':
      ensureAllClientLorebookIds()
      return
    case 'global':
      ensureGlobalLorebookListIds()
      return
    case 'character':
      ensureSelectedCharacterLorebookIds()
      return
    case 'module':
      ensureModuleLorebookIds(scope.moduleId)
      return
  }
}

function lorebookWatchScopeIdKey(scope: LorebookWatchScope): string {
  switch (scope.kind) {
    case 'all':
      return 'all'
    case 'global':
      return 'global'
    case 'character': {
      const character = DBState.db.characters?.[selectedCharMirror]
      return `character:${selectedCharMirror}:${character?.chaId ?? ''}`
    }
    case 'module':
      return `module:${scope.moduleId}`
  }
}

function ensureSelectedCharacterLorebookIds(): void {
  withTrustedServerProjectionWrite(() => {
    const character = DBState.db.characters?.[selectedCharMirror]
    if (!character) return
    if (character.chaId && hydratedCharacterLorebooks.has(character.chaId)) {
      character.globalLore = ensureClientLorebookEntryIds(character.globalLore ?? [])
    }
    for (const chat of character.chats ?? []) {
      chat.localLore = ensureClientLorebookEntryIds(chat.localLore ?? [])
    }
  })
}

function ensureModuleLorebookIds(moduleId: string): void {
  withTrustedServerProjectionWrite(() => {
    const module = ((DBState.db.modules ?? []) as RisuModule[]).find((candidate) => candidate.id === moduleId)
    if (module && Array.isArray(module.lorebook)) {
      module.lorebook = ensureClientLorebookEntryIds(module.lorebook)
    }
  })
}

// Shared by the whole-DB ensure above and the global-list-only ensure below.
// Must run inside a trusted write scope (it re-reads `DBState.db` itself).
function assignGlobalLorebookListIds(): void {
  for (const lorebook of (DBState.db.loreBook ?? []) as GlobalLorebook[]) {
    lorebook.id = typeof lorebook.id === 'string' && lorebook.id.trim() ? lorebook.id : v4()
    lorebook.data = ensureClientLorebookEntryIds(lorebook.data ?? [])
  }
}

/** Assign ids on the global lorebook list only (book ids + entry ids). */
export function ensureGlobalLorebookListIds(): void {
  withTrustedServerProjectionWrite(() => {
    assignGlobalLorebookListIds()
  })
}

/**
 * Scoped pre-edit rollback for a DISCRETE editor action on ONE collection (L32):
 * a global lorebook's entries, a character's globalLore, or a chat's localLore.
 * Builds the same `scopeKey`+`scopedValue` rollback the watcher uses, so a failed
 * command restores only the edited collection — without the whole-DB id-assign
 * write and the characters+modules deep clone the broad
 * `currentLorebookStateSnapshot` performs. Ids are ensured on the edited
 * collection only. The broad snapshot stays for the genuine multi-collection
 * callers (module apply, MCP edits).
 */
export type DiscreteLorebookEditScope =
  | { kind: 'character'; characterId: string }
  | { kind: 'chat'; chatId: string }
  | { kind: 'global'; lorebookId: string }
  | { kind: 'module'; moduleId: string }

export function currentLorebookCollectionScopedSnapshot(scope: DiscreteLorebookEditScope): LorebookStateSnapshot {
  ensureScopedClientLorebookIds(scope)
  switch (scope.kind) {
    case 'character': {
      const character = DBState.db.characters?.find((candidate) => candidate.chaId === scope.characterId)
      return scopedLorebookStateSnapshot(`character:${scope.characterId}`, snapshotJson(character?.globalLore ?? []))
    }
    case 'chat': {
      const chat = findChat(scope.chatId)
      return scopedLorebookStateSnapshot(`chat:${scope.chatId}`, snapshotJson(chat?.localLore ?? []))
    }
    case 'global': {
      const lorebook = ((DBState.db.loreBook ?? []) as GlobalLorebook[]).find(
        (candidate) => candidate.id === scope.lorebookId,
      )
      return scopedLorebookStateSnapshot(`global:${scope.lorebookId}`, snapshotJson(lorebook?.data ?? []))
    }
    case 'module': {
      const module = findModule(scope.moduleId)
      return scopedLorebookStateSnapshot(`module:${scope.moduleId}`, snapshotJson(module?.lorebook ?? []))
    }
  }
}

export function currentLorebookEntryScopedSnapshot(
  scope: DiscreteLorebookEditScope,
  index: number,
): LorebookEntryStateSnapshot {
  ensureScopedClientLorebookEntryId(scope, index)
  const target = resolveLorebookCollection(scope)
  const entry = target?.entries[index] ?? null
  return {
    kind: 'entry',
    scopeKey: lorebookCollectionScopeKey(scope),
    entryId: entry?.id,
    index,
    previousEntry: entry ? cloneJsonValue(entry) : null,
    selectedCharID: get(selectedCharID),
  }
}

function entryDraftRollbackSnapshot(
  scope: DiscreteLorebookEditScope,
  existing: PendingCollectionReplacement | undefined,
  index: number,
): LorebookReplacementSnapshot {
  if (!existing) return currentLorebookEntryScopedSnapshot(scope, index)
  if (existing.source === 'collection' || !isLorebookEntryStateSnapshot(existing.previous)) {
    return existing.previous
  }
  return promoteEntryRollbackToCollectionSnapshot(scope, existing.previous)
}

function promoteEntryRollbackToCollectionSnapshot(
  scope: DiscreteLorebookEditScope,
  entrySnapshot: LorebookEntryStateSnapshot,
): LorebookStateSnapshot {
  const collectionSnapshot = currentLorebookCollectionScopedSnapshot(scope)
  if (!Array.isArray(collectionSnapshot.scopedValue)) return collectionSnapshot

  const entries = collectionSnapshot.scopedValue as loreBook[]
  const index =
    entrySnapshot.entryId && entrySnapshot.entryId.trim()
      ? entries.findIndex((entry) => entry.id === entrySnapshot.entryId)
      : -1
  const restoreIndex = index >= 0 ? index : entrySnapshot.index

  if (!entrySnapshot.previousEntry) {
    if (restoreIndex >= 0 && restoreIndex < entries.length) {
      entries.splice(restoreIndex, 1)
    }
    return collectionSnapshot
  }

  const previous = cloneJsonValue(entrySnapshot.previousEntry)
  const current = entries[restoreIndex]
  if (current) {
    replaceLorebookEntryInPlace(current, previous)
  } else {
    entries.splice(Math.max(0, Math.min(restoreIndex, entries.length)), 0, previous)
  }
  return collectionSnapshot
}

export function applyLorebookEntryDraftEdit(
  scope: DiscreteLorebookEditScope,
  index: number,
  value: loreBook,
  delayMs = 250,
): boolean {
  if (
    scope.kind === 'character' &&
    DBState.db?.enableLorebookStubs &&
    !hydratedCharacterLorebooks.has(scope.characterId)
  ) {
    return false
  }

  const key = lorebookCollectionScopeKey(scope)
  const existing = pendingReplacements.get(key)
  const previous = entryDraftRollbackSnapshot(scope, existing, index)

  let entries: loreBook[] | null = null
  withTrustedServerProjectionWrite(() => {
    const target = resolveLorebookCollection(scope)
    if (!target) return
    entries = target.entries
    const current = target.entries[index]
    const next = cloneJsonValue(value)
    if (current?.id && (typeof next.id !== 'string' || !next.id.trim())) {
      next.id = current.id
    }
    if (current) {
      replaceLorebookEntryInPlace(current, next)
    } else {
      target.entries[index] = next
    }
  })

  if (!entries) return false
  if (!canUseServerCommands()) return true
  queueScopedLorebookReplacement(scope, entries, previous, delayMs, 'entry')
  return true
}

export function flushPendingLorebookEntryDraftEdit(
  scope: DiscreteLorebookEditScope,
  options: ServerCommandTransportOptions = {},
): void {
  const key = lorebookCollectionScopeKey(scope)
  runPendingReplacement(key, options)
}

// Assign missing ids on the edited collection only. The target is re-read inside
// the trusted write scope — a reference captured outside it would still be the
// read-only projection and throw on assignment.
function ensureScopedClientLorebookIds(scope: DiscreteLorebookEditScope): void {
  withTrustedServerProjectionWrite(() => {
    switch (scope.kind) {
      case 'character': {
        const character = DBState.db.characters?.find((candidate) => candidate.chaId === scope.characterId)
        // Mirror the whole-DB ensure's no-data-loss guard: only touch a HYDRATED
        // character's globalLore — assigning ids to a stubbed one would default
        // its absent globalLore to `[]` and mask the stub.
        if (character?.chaId && hydratedCharacterLorebooks.has(character.chaId)) {
          character.globalLore = ensureClientLorebookEntryIds(character.globalLore ?? [])
        }
        return
      }
      case 'chat': {
        const chat = findChat(scope.chatId)
        if (chat) chat.localLore = ensureClientLorebookEntryIds(chat.localLore ?? [])
        return
      }
      case 'global': {
        const lorebook = ((DBState.db.loreBook ?? []) as GlobalLorebook[]).find(
          (candidate) => candidate.id === scope.lorebookId,
        )
        if (lorebook) lorebook.data = ensureClientLorebookEntryIds(lorebook.data ?? [])
        return
      }
      case 'module': {
        const module = findModule(scope.moduleId)
        if (module && Array.isArray(module.lorebook)) {
          module.lorebook = ensureClientLorebookEntryIds(module.lorebook)
        }
        return
      }
    }
  })
}

function ensureScopedClientLorebookEntryId(scope: DiscreteLorebookEditScope, index: number): void {
  withTrustedServerProjectionWrite(() => {
    if (
      scope.kind === 'character' &&
      DBState.db?.enableLorebookStubs &&
      !hydratedCharacterLorebooks.has(scope.characterId)
    ) {
      return
    }
    const entry = resolveLorebookCollection(scope)?.entries[index]
    if (entry && (typeof entry.id !== 'string' || !entry.id.trim())) {
      entry.id = v4()
    }
  })
}

function lorebookCollectionScopeKey(scope: DiscreteLorebookEditScope): string {
  switch (scope.kind) {
    case 'character':
      return `character:${scope.characterId}`
    case 'chat':
      return `chat:${scope.chatId}`
    case 'global':
      return `global:${scope.lorebookId}`
    case 'module':
      return `module:${scope.moduleId}`
  }
}

function resolveLorebookCollection(scope: DiscreteLorebookEditScope): { entries: loreBook[] } | null {
  switch (scope.kind) {
    case 'character': {
      const character = DBState.db.characters?.find((candidate) => candidate.chaId === scope.characterId)
      return character ? { entries: character.globalLore ?? [] } : null
    }
    case 'chat': {
      const chat = findChat(scope.chatId)
      return chat ? { entries: chat.localLore ?? [] } : null
    }
    case 'global': {
      const lorebook = ((DBState.db.loreBook ?? []) as GlobalLorebook[]).find(
        (candidate) => candidate.id === scope.lorebookId,
      )
      return lorebook ? { entries: lorebook.data ?? [] } : null
    }
    case 'module': {
      const module = findModule(scope.moduleId)
      return module && Array.isArray(module.lorebook) ? { entries: module.lorebook } : null
    }
  }
}

function replaceLorebookEntryInPlace(target: loreBook, next: loreBook): void {
  const writableTarget = target as unknown as Record<string, unknown>
  const writableNext = next as unknown as Record<string, unknown>
  for (const key of Object.keys(writableTarget)) {
    if (!(key in writableNext)) delete writableTarget[key]
  }
  Object.assign(writableTarget, writableNext)
}

// Global-lorebook select/create/delete only touch `loreBook` / `loreBookPage`, so
// they take the narrow `GlobalLorebookStateSnapshot` and roll back via
// `restoreGlobalLorebookState` — never the whole characters + modules clone the
// `LorebookStateSnapshot` carries. The full snapshot stays for the entry-replace
// dispatchers (which can mutate character/module/chat lore).
export function dispatchCreateGlobalLorebook(lorebook: GlobalLorebook, previous: GlobalLorebookStateSnapshot): void {
  if (!canUseServerCommands()) return
  lorebook.id = typeof lorebook.id === 'string' && lorebook.id.trim() ? lorebook.id : v4()
  lorebook.data = ensureClientLorebookEntryIds(lorebook.data ?? [])
  void runServerCommand({
    command: (baseRevision) =>
      createGlobalLorebookCommand({
        baseRevision,
        lorebook: cloneJsonValue(lorebook) as GlobalLorebookSnapshot,
      }),
    rollback: () => rollbackServerBackedGlobalLorebooks(previous),
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
    rollback: () => rollbackServerBackedLorebooks(previous),
  })
}

export function dispatchDeleteGlobalLorebook(lorebookId: string, previous: GlobalLorebookStateSnapshot): void {
  if (!canUseServerCommands()) return
  void runServerCommand({
    command: (baseRevision) =>
      deleteGlobalLorebookCommand({
        baseRevision,
        lorebookId,
      }),
    rollback: () => rollbackServerBackedGlobalLorebooks(previous),
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
    rollback: () => rollbackServerBackedLorebooks(previous),
  })
}

export function dispatchSelectGlobalLorebook(lorebookId: string, previous: GlobalLorebookStateSnapshot): void {
  if (!canUseServerCommands()) return
  void runServerCommand({
    command: (baseRevision) =>
      selectGlobalLorebookCommand({
        baseRevision,
        lorebookId,
      }),
    rollback: () => rollbackServerBackedGlobalLorebooks(previous),
  })
}

export function dispatchReplaceGlobalLorebookEntries(
  lorebookId: string,
  entries: loreBook[],
  previous: LorebookStateSnapshot,
  delayMs = 250,
  source: LorebookReplacementSource = 'collection',
): void {
  if (!canUseServerCommands()) return
  if (source === 'collection') ensureClientLorebookEntryIds(entries)
  queueScopedLorebookReplacement({ kind: 'global', lorebookId }, entries, previous, delayMs, source)
}

export function dispatchReplaceCharacterLorebooks(
  characterId: string,
  entries: loreBook[],
  previous: LorebookStateSnapshot,
  delayMs = 250,
  source: LorebookReplacementSource = 'collection',
): void {
  if (!canUseServerCommands()) return
  // Defense in depth: when stubs are on, never persist a non-hydrated character's
  // globalLore. `entries` would be the stub `[]` and delete the real server
  // entries. A real selected-character edit is safe after hydration on open.
  if (DBState.db?.enableLorebookStubs && !hydratedCharacterLorebooks.has(characterId)) return
  if (source === 'collection') ensureClientLorebookEntryIds(entries)
  queueScopedLorebookReplacement({ kind: 'character', characterId }, entries, previous, delayMs, source)
}

export function dispatchReplaceChatLorebooks(
  chatId: string,
  entries: loreBook[],
  previous: LorebookStateSnapshot,
  delayMs = 250,
  source: LorebookReplacementSource = 'collection',
): void {
  if (!canUseServerCommands()) return
  if (source === 'collection') ensureClientLorebookEntryIds(entries)
  queueScopedLorebookReplacement({ kind: 'chat', chatId }, entries, previous, delayMs, source)
}

function queueScopedLorebookReplacement(
  scope: DiscreteLorebookEditScope,
  entries: loreBook[],
  previous: LorebookReplacementSnapshot,
  delayMs: number,
  source: LorebookReplacementSource,
): void {
  const key = lorebookCollectionScopeKey(scope)
  queueReplacement(
    key,
    previous,
    (rollbackSnapshot, options = {}) =>
      runServerCommand({
        command: (baseRevision): Promise<ServerCommandResult<Record<string, unknown>>> => {
          const entrySnapshots = cloneLorebookEntriesForCommand(entries)
          switch (scope.kind) {
            case 'character':
              return replaceCharacterLorebooksCommand(
                {
                  baseRevision,
                  characterId: scope.characterId,
                  entries: entrySnapshots,
                },
                options.signal,
                options.keepalive,
              ) as Promise<ServerCommandResult<Record<string, unknown>>>
            case 'chat':
              return replaceChatLorebooksCommand(
                {
                  baseRevision,
                  chatId: scope.chatId,
                  entries: entrySnapshots,
                },
                options.signal,
                options.keepalive,
              ) as Promise<ServerCommandResult<Record<string, unknown>>>
            case 'global':
              return replaceGlobalLorebookEntriesCommand(
                {
                  baseRevision,
                  lorebookId: scope.lorebookId,
                  entries: entrySnapshots,
                },
                options.signal,
                options.keepalive,
              ) as Promise<ServerCommandResult<Record<string, unknown>>>
            case 'module':
              return replaceModuleLorebooksCommand(
                {
                  baseRevision,
                  moduleId: scope.moduleId,
                  entries: entrySnapshots,
                },
                options.signal,
                options.keepalive,
              ) as Promise<ServerCommandResult<Record<string, unknown>>>
          }
        },
        rollback: () => rollbackLorebookReplacement(rollbackSnapshot),
        signal: options.signal,
        keepalive: options.keepalive,
      }),
    delayMs,
    source,
  )
}

export function dispatchReplaceModuleLorebooks(
  moduleId: string,
  entries: loreBook[],
  previous: LorebookStateSnapshot,
  delayMs = 250,
  source: LorebookReplacementSource = 'collection',
): void {
  if (!canUseServerCommands()) return
  if (source === 'collection') ensureClientLorebookEntryIds(entries)
  queueScopedLorebookReplacement({ kind: 'module', moduleId }, entries, previous, delayMs, source)
}

export function watchServerBackedLorebooks(options: WatchServerBackedLorebooksOptions = {}): () => void {
  if (!canUseServerCommands()) return () => {}
  const delayMs = options.delayMs ?? 300
  const scope: LorebookWatchScope = options.scope ?? { kind: 'all' }
  let initialized = false
  let clientIdsInitializedFor: string | null = null
  let previousSnapshots = new Map<string, string>()
  let previousProjectionApplyEpoch = getServerProjectionApplyEpoch()

  // A character-scoped watcher must re-run when the selected character changes,
  // so mirror the store into the $state the collector reads. Other scopes do not
  // read the mirror, so they never re-fire on a selection change.
  const unsubscribeSelected =
    scope.kind === 'character'
      ? selectedCharID.subscribe((value) => {
          selectedCharMirror = value
        })
      : null

  const stop = $effect.root(() => {
    $effect(() => {
      const projectionApplyEpoch = getServerProjectionApplyEpoch()
      const clientIdsScopeKey = lorebookWatchScopeIdKey(scope)
      if (clientIdsInitializedFor !== clientIdsScopeKey) {
        ensureWatchScopeClientLorebookIds(scope)
        clientIdsInitializedFor = clientIdsScopeKey
      }
      const currentSnapshots = collectLorebookCollectionSnapshots(scope)

      if (suppressRollbackDispatch || !initialized || projectionApplyEpoch !== previousProjectionApplyEpoch) {
        initialized = true
        previousProjectionApplyEpoch = projectionApplyEpoch
        previousSnapshots = currentSnapshots
        reconcileFlushedEntrySuppressions(currentSnapshots)
        return
      }

      for (const [key, snapshot] of currentSnapshots) {
        const previousSnapshot = previousSnapshots.get(key)
        if (previousSnapshot === undefined) continue
        const flushedEntrySnapshot = flushedEntryEditSnapshots.get(key)
        if (snapshot === previousSnapshot) {
          if (flushedEntrySnapshot === snapshot) {
            scheduleFlushedEntrySuppressionClear(key, snapshot)
          }
          continue
        }
        if (pendingEntryEditKeys.has(key)) continue
        if (flushedEntrySnapshot !== undefined) {
          if (flushedEntrySnapshot === snapshot) {
            scheduleFlushedEntrySuppressionClear(key, snapshot)
            continue
          }
          flushedEntryEditSnapshots.delete(key)
          flushedEntryEditClearSnapshots.delete(key)
        }
        const previousState = scopedLorebookStateSnapshot(key, previousSnapshot)
        untrack(() => dispatchWatchedReplacement(key, previousState, delayMs))
      }

      reconcileFlushedEntrySuppressions(currentSnapshots)
      previousSnapshots = currentSnapshots
    })
  })

  return () => {
    flushPendingServerBackedLorebookPatches()
    unsubscribeSelected?.()
    stop()
  }
}

function dispatchWatchedReplacement(key: string, previous: LorebookStateSnapshot, delayMs: number): void {
  if (key.startsWith('global:')) {
    const lorebookId = key.slice('global:'.length)
    const lorebook = ((DBState.db.loreBook ?? []) as GlobalLorebook[]).find((candidate) => candidate.id === lorebookId)
    if (lorebook) dispatchReplaceGlobalLorebookEntries(lorebookId, lorebook.data ?? [], previous)
    return
  }
  if (key.startsWith('globalMeta:')) {
    const lorebookId = key.slice('globalMeta:'.length)
    const lorebook = ((DBState.db.loreBook ?? []) as GlobalLorebook[]).find((candidate) => candidate.id === lorebookId)
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
    const module = ((DBState.db.modules ?? []) as RisuModule[]).find((candidate) => candidate.id === moduleId)
    if (module?.lorebook) {
      dispatchReplaceModuleLorebooks(moduleId, module.lorebook, previous, delayMs)
    }
  }
}

/**
 * Build the change-detection snapshot map for the watcher's scope. Exported for
 * the clone-cost regression test, which asserts a scoped fire covers only the
 * mounting panel's collection (O(panel scope)) instead of every chat of every
 * character and every module (O(all lore in the DB)). The `all` branch is the
 * original whole-DB scan and is byte-for-byte identical to the previous code.
 */
export function collectLorebookCollectionSnapshots(scope: LorebookWatchScope): Map<string, string> {
  const snapshots = new Map<string, string>()

  if (scope.kind === 'all' || scope.kind === 'global') {
    for (const lorebook of (DBState.db.loreBook ?? []) as GlobalLorebook[]) {
      if (lorebook.id) {
        snapshots.set(`global:${lorebook.id}`, snapshotJson(lorebook.data ?? []))
        snapshots.set(`globalMeta:${lorebook.id}`, snapshotJson({ name: lorebook.name }))
      }
    }
  }

  if (scope.kind === 'all') {
    for (const character of DBState.db.characters ?? []) {
      collectCharacterLorebookSnapshots(snapshots, character)
    }
  } else if (scope.kind === 'character') {
    // Track only the selected character's lore. Reading the $state mirror (not a
    // bare get()) re-runs the effect on a character switch, so the first edit to
    // the newly selected character is never dropped.
    const character = DBState.db.characters?.[selectedCharMirror]
    if (character) {
      collectCharacterLorebookSnapshots(snapshots, character, characterScopeLocalLoreSnapshots)
    }
  }

  if (scope.kind === 'all') {
    for (const module of (DBState.db.modules ?? []) as RisuModule[]) {
      collectModuleLorebookSnapshot(snapshots, module)
    }
  } else if (scope.kind === 'module') {
    const module = ((DBState.db.modules ?? []) as RisuModule[]).find((candidate) => candidate.id === scope.moduleId)
    if (module) collectModuleLorebookSnapshot(snapshots, module)
  }

  return snapshots
}

function collectCharacterLorebookSnapshots(
  snapshots: Map<string, string>,
  character: character,
  localLoreCache?: Map<string, LocalLoreSnapshotCacheEntry>,
): void {
  // Snapshot a character's globalLore ONLY when it is hydrated; a stubbed /
  // not-yet-hydrated character is never tracked, so a re-stub can't be diffed into
  // a deletion (the no-data-loss invariant).
  if (character.chaId && hydratedCharacterLorebooks.has(character.chaId)) {
    snapshots.set(`character:${character.chaId}`, snapshotJson(character.globalLore ?? []))
  }
  const liveChatIds = localLoreCache ? new Set<string>() : null
  for (const chat of character.chats ?? []) {
    if (!chat.id) continue
    liveChatIds?.add(chat.id)
    snapshots.set(`chat:${chat.id}`, snapshotChatLocalLore(chat.id, chat.localLore ?? [], localLoreCache))
  }
  if (localLoreCache && liveChatIds) {
    for (const chatId of localLoreCache.keys()) {
      if (!liveChatIds.has(chatId)) localLoreCache.delete(chatId)
    }
  }
}

function snapshotChatLocalLore(
  chatId: string,
  localLore: loreBook[],
  localLoreCache?: Map<string, LocalLoreSnapshotCacheEntry>,
): string {
  if (!localLoreCache) return snapshotJson(localLore)
  const key = `chat:${chatId}`
  const shouldRefreshEntryEditSnapshot = pendingEntryEditKeys.has(key) || flushedEntryEditSnapshots.has(key)
  const cached = localLoreCache.get(chatId)
  if (!shouldRefreshEntryEditSnapshot && cached?.entries === localLore) return cached.snapshot
  const snapshot = snapshotJson(localLore)
  localLoreCache.set(chatId, { entries: localLore, snapshot })
  return snapshot
}

function collectModuleLorebookSnapshot(snapshots: Map<string, string>, module: RisuModule): void {
  if (module.id && Array.isArray(module.lorebook)) {
    snapshots.set(`module:${module.id}`, snapshotJson(module.lorebook))
  }
}

function queueReplacement(
  key: string,
  previous: LorebookReplacementSnapshot,
  command: (
    previous: LorebookReplacementSnapshot,
    options?: ServerCommandTransportOptions,
  ) => Promise<ServerCommandResult<Record<string, unknown>>>,
  delay: number,
  source: LorebookReplacementSource,
): void {
  const existing = pendingReplacements.get(key)
  if (existing?.timer) clearTimeout(existing.timer)

  const useExisting =
    existing?.source === 'collection' ||
    (existing?.source === 'entry' && source === 'entry' && isLorebookEntryStateSnapshot(previous))
  const effectivePrevious = useExisting ? existing.previous : previous
  const effectiveSource = existing?.source === 'collection' ? 'collection' : source

  const pending: PendingCollectionReplacement = {
    key,
    previous: effectivePrevious,
    source: effectiveSource,
    command: (options = {}) => command(effectivePrevious, options),
    timer: null,
  }
  if (effectiveSource === 'entry') {
    pendingEntryEditKeys.add(key)
    flushedEntryEditSnapshots.delete(key)
    flushedEntryEditClearSnapshots.delete(key)
  } else {
    pendingEntryEditKeys.delete(key)
    flushedEntryEditSnapshots.delete(key)
    flushedEntryEditClearSnapshots.delete(key)
  }
  pending.timer = setTimeout(() => runPendingReplacement(key), delay)
  pendingReplacements.set(key, pending)
}

export function flushPendingServerBackedLorebookPatches(options: ServerCommandTransportOptions = {}): void {
  for (const key of Array.from(pendingReplacements.keys())) {
    runPendingReplacement(key, options)
  }
}

function runPendingReplacement(key: string, options: ServerCommandTransportOptions = {}): void {
  const pending = pendingReplacements.get(key)
  if (!pending) return
  if (pending.timer) clearTimeout(pending.timer)
  pendingReplacements.delete(key)
  if (pending.source === 'entry') {
    pendingEntryEditKeys.delete(key)
    const snapshot = currentLorebookCollectionSnapshotForKey(key)
    if (snapshot === null) {
      flushedEntryEditSnapshots.delete(key)
      flushedEntryEditClearSnapshots.delete(key)
    } else {
      flushedEntryEditSnapshots.set(key, snapshot)
    }
  }
  void pending.command(options)
}

function scheduleFlushedEntrySuppressionClear(key: string, snapshot: string): void {
  if (flushedEntryEditClearSnapshots.get(key) === snapshot) return
  flushedEntryEditClearSnapshots.set(key, snapshot)
  queueMicrotask(() => {
    if (flushedEntryEditSnapshots.get(key) === snapshot) {
      flushedEntryEditSnapshots.delete(key)
    }
    if (flushedEntryEditClearSnapshots.get(key) === snapshot) {
      flushedEntryEditClearSnapshots.delete(key)
    }
  })
}

function reconcileFlushedEntrySuppressions(currentSnapshots: Map<string, string>): void {
  for (const [key, flushedSnapshot] of flushedEntryEditSnapshots) {
    const currentSnapshot = currentSnapshots.get(key)
    if (currentSnapshot === flushedSnapshot) {
      scheduleFlushedEntrySuppressionClear(key, flushedSnapshot)
    } else {
      flushedEntryEditSnapshots.delete(key)
      flushedEntryEditClearSnapshots.delete(key)
    }
  }
}

function rollbackLorebookReplacement(snapshot: LorebookReplacementSnapshot): void {
  if (isLorebookEntryStateSnapshot(snapshot)) {
    rollbackServerBackedLorebookEntry(snapshot)
    return
  }
  rollbackServerBackedLorebooks(snapshot)
}

function rollbackServerBackedLorebooks(snapshot: LorebookStateSnapshot): void {
  withSuppressedLorebookWatcher(() => {
    restoreLorebookState(snapshot)
  })
}

function rollbackServerBackedGlobalLorebooks(snapshot: GlobalLorebookStateSnapshot): void {
  withSuppressedLorebookWatcher(() => {
    restoreGlobalLorebookState(snapshot)
  })
}

function rollbackServerBackedLorebookEntry(snapshot: LorebookEntryStateSnapshot): void {
  withSuppressedLorebookWatcher(() => {
    restoreLorebookEntryState(snapshot)
  })
}

function withSuppressedLorebookWatcher(fn: () => void): void {
  suppressRollbackDispatch = true
  try {
    fn()
  } finally {
    queueMicrotask(() => {
      suppressRollbackDispatch = false
    })
  }
}

function isLorebookEntryStateSnapshot(snapshot: LorebookReplacementSnapshot): snapshot is LorebookEntryStateSnapshot {
  return (snapshot as LorebookEntryStateSnapshot).kind === 'entry'
}

function findChat(chatId: string): Chat | null {
  for (const character of DBState.db.characters ?? []) {
    const chat = character.chats?.find((candidate) => candidate.id === chatId)
    if (chat) return chat
  }
  return null
}

function findModule(moduleId: string): RisuModule | null {
  return ((DBState.db.modules ?? []) as RisuModule[]).find((candidate) => candidate.id === moduleId) ?? null
}

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

export function scopedLorebookStateSnapshot(key: string, previousSnapshot: string): LorebookStateSnapshot {
  return {
    scopeKey: key,
    scopedValue: parseSnapshotJson(previousSnapshot),
    loreBook: [],
    loreBookPage: DBState.db.loreBookPage ?? 0,
    characters: [],
    modules: [],
    selectedCharID: get(selectedCharID),
  }
}

export function restoreScopedLorebookState(snapshot: LorebookStateSnapshot): void {
  const key = snapshot.scopeKey
  if (!key) return

  withTrustedServerProjectionWrite(() => {
    if (key.startsWith('global:')) {
      const lorebookId = key.slice('global:'.length)
      const lorebook = ((DBState.db.loreBook ?? []) as GlobalLorebook[]).find(
        (candidate) => candidate.id === lorebookId,
      )
      if (lorebook && Array.isArray(snapshot.scopedValue)) {
        lorebook.data = cloneJsonValue(snapshot.scopedValue) as loreBook[]
      }
      return
    }

    if (key.startsWith('globalMeta:')) {
      const lorebookId = key.slice('globalMeta:'.length)
      const lorebook = ((DBState.db.loreBook ?? []) as GlobalLorebook[]).find(
        (candidate) => candidate.id === lorebookId,
      )
      const value = snapshot.scopedValue
      if (
        lorebook &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof (value as { name?: unknown }).name === 'string'
      ) {
        lorebook.name = (value as { name: string }).name
      }
      return
    }

    if (key.startsWith('character:')) {
      const characterId = key.slice('character:'.length)
      const character = DBState.db.characters?.find((candidate) => candidate.chaId === characterId)
      if (character && Array.isArray(snapshot.scopedValue)) {
        character.globalLore = cloneJsonValue(snapshot.scopedValue) as typeof character.globalLore
      }
      return
    }

    if (key.startsWith('chat:')) {
      const chatId = key.slice('chat:'.length)
      const chat = findChat(chatId)
      if (chat && Array.isArray(snapshot.scopedValue)) {
        chat.localLore = cloneJsonValue(snapshot.scopedValue) as typeof chat.localLore
      }
      return
    }

    if (key.startsWith('module:')) {
      const moduleId = key.slice('module:'.length)
      const module = ((DBState.db.modules ?? []) as RisuModule[]).find((candidate) => candidate.id === moduleId)
      if (module && Array.isArray(snapshot.scopedValue)) {
        module.lorebook = cloneJsonValue(snapshot.scopedValue) as typeof module.lorebook
      }
    }
  })
}

export function restoreLorebookEntryState(snapshot: LorebookEntryStateSnapshot): void {
  withTrustedServerProjectionWrite(() => {
    const target = resolveLorebookCollectionFromKey(snapshot.scopeKey)
    if (!target) return

    const index =
      snapshot.entryId && snapshot.entryId.trim()
        ? target.entries.findIndex((entry) => entry.id === snapshot.entryId)
        : -1
    const restoreIndex = index >= 0 ? index : snapshot.index

    if (!snapshot.previousEntry) {
      if (restoreIndex >= 0 && restoreIndex < target.entries.length) {
        target.entries.splice(restoreIndex, 1)
      }
      return
    }

    const previous = cloneJsonValue(snapshot.previousEntry)
    const current = target.entries[restoreIndex]
    if (current) {
      replaceLorebookEntryInPlace(current, previous)
    } else {
      target.entries.splice(Math.max(0, Math.min(restoreIndex, target.entries.length)), 0, previous)
    }
  })
}

function resolveLorebookCollectionFromKey(scopeKey: string): { entries: loreBook[] } | null {
  if (scopeKey.startsWith('global:')) {
    const lorebookId = scopeKey.slice('global:'.length)
    return resolveLorebookCollection({ kind: 'global', lorebookId })
  }
  if (scopeKey.startsWith('character:')) {
    const characterId = scopeKey.slice('character:'.length)
    return resolveLorebookCollection({ kind: 'character', characterId })
  }
  if (scopeKey.startsWith('chat:')) {
    const chatId = scopeKey.slice('chat:'.length)
    return resolveLorebookCollection({ kind: 'chat', chatId })
  }
  if (scopeKey.startsWith('module:')) {
    const moduleId = scopeKey.slice('module:'.length)
    return resolveLorebookCollection({ kind: 'module', moduleId })
  }
  return null
}

function currentLorebookCollectionSnapshotForKey(scopeKey: string): string | null {
  const collection = resolveLorebookCollectionFromKey(scopeKey)
  return collection ? snapshotJson(collection.entries ?? []) : null
}

function parseSnapshotJson(snapshot: string): unknown {
  if (snapshot === '__undefined__') return undefined
  return JSON.parse(snapshot)
}

function cloneLorebookEntriesForCommand(entries: loreBook[]): LorebookEntrySnapshot[] {
  const cloned = cloneJsonValue(entries ?? [])
  ensureClientLorebookEntryIds(cloned)
  return cloned as LorebookEntrySnapshot[]
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
