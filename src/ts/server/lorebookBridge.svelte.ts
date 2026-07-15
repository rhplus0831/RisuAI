import { untrack } from 'svelte'
import { get } from 'svelte/store'
import { v4 } from 'uuid'
import type { RisuModule } from '../process/modules'
import type { character, Chat, Database, loreBook } from '../storage/database.svelte'
import { selectedCharID } from '../stores.svelte'
import {
  canUseServerCommands,
  createGlobalLorebookCommand,
  deleteCharacterLorebookEntryCommand,
  deleteChatLorebookEntryCommand,
  deleteGlobalLorebookCommand,
  deleteGlobalLorebookEntryCommand,
  deleteModuleLorebookEntryCommand,
  reorderCharacterLorebookEntriesCommand,
  reorderChatLorebookEntriesCommand,
  reorderGlobalLorebooksCommand,
  reorderGlobalLorebookEntriesCommand,
  reorderModuleLorebookEntriesCommand,
  replaceCharacterLorebooksCommand,
  replaceChatLorebooksCommand,
  replaceGlobalLorebookEntriesCommand,
  replaceModuleLorebooksCommand,
  runServerCommand,
  selectGlobalLorebookCommand,
  updateGlobalLorebookCommand,
  upsertCharacterLorebookEntryCommand,
  upsertChatLorebookEntryCommand,
  upsertGlobalLorebookEntryCommand,
  upsertModuleLorebookEntryCommand,
  type GlobalLorebookSnapshot,
  type LorebookEntrySnapshot,
  type ServerCommandResult,
  type ServerCommandTransportOptions,
  type SparseLorebookEntryUpdate,
} from './commands'
import {
  getServerResourceApplyEpoch,
  withServerResourceApply,
  withTrustedResourceWrite,
} from './resourceWriteGuard.svelte'
import {
  captureCharacterLorebookProjectionEpoch,
  captureCharacterRowProjectionEpoch,
  captureCollectionProjectionEpoch,
  captureLorebookPageProjectionEpoch,
  getResourceDatabase as getDatabase,
  hasCharacterLorebookProjectionEpochChanged,
  hasCharacterRowProjectionEpochChanged,
  hasCollectionProjectionEpochChanged,
  hasLorebookPageProjectionEpochChanged,
} from './resourceState.svelte'
import {
  applyAttemptedFieldRollback,
  applyAttemptedKeyedListRollback,
  mergeProjectionIntoDirtyDraft,
} from './staleStateGuards'

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
type LorebookReplacementSource = 'collection' | 'entry' | 'watchedCollection' | 'fullCollection'

type LorebookProjectionEpochs =
  | { kind: 'global'; collectionEpoch: number }
  | { kind: 'character'; characterId: string; rowEpoch: number; lorebookEpoch: number }
  | { kind: 'chat'; chatId: string; characterId: string | null; rowEpoch: number | null }
  | { kind: 'module' }

interface PendingCollectionReplacement {
  key: string
  previous: LorebookReplacementSnapshot
  attemptedEntries: loreBook[]
  source: LorebookReplacementSource
  projectionEpochs: LorebookProjectionEpochs
  timer: ReturnType<typeof setTimeout> | null
  command: (options?: ServerCommandTransportOptions) => Promise<ServerCommandResult<Record<string, unknown>>>
}

interface PendingLorebookEntryAttempt {
  sequence: number
  scopeKey: string
  entryId: string
  previous: LorebookEntryStateSnapshot
  attemptedEntry: loreBook
}

const pendingReplacements = new Map<string, PendingCollectionReplacement>()
const pendingLorebookEntryAttempts: PendingLorebookEntryAttempt[] = []
let nextLorebookEntryAttemptSequence = 0
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

export function resetServerBackedLorebookBridgeForTests(): void {
  for (const pending of pendingReplacements.values()) {
    if (pending.timer) clearTimeout(pending.timer)
  }
  pendingReplacements.clear()
  pendingLorebookEntryAttempts.length = 0
  nextLorebookEntryAttemptSequence = 0
  pendingEntryEditKeys.clear()
  flushedEntryEditSnapshots.clear()
  flushedEntryEditClearSnapshots.clear()
  characterScopeLocalLoreSnapshots.clear()
  lorebookEntryDraftRollbackListeners.clear()
  suppressRollbackDispatch = false
  selectedCharMirror = -1
}

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
  return {
    loreBook: cloneJsonValue((getDatabase().loreBook ?? []) as GlobalLorebook[]),
    loreBookPage: getDatabase().loreBookPage ?? 0,
    characters: cloneJsonValue(getDatabase().characters ?? []),
    modules: cloneJsonValue((getDatabase().modules ?? []) as RisuModule[]),
    selectedCharID: get(selectedCharID),
  }
}

export function restoreLorebookState(snapshot: LorebookStateSnapshot): void {
  if (snapshot.scopeKey) {
    restoreScopedLorebookState(snapshot)
    return
  }

  withTrustedResourceWrite(() => {
    getDatabase().loreBook = cloneJsonValue(snapshot.loreBook) as Database['loreBook']
    getDatabase().loreBookPage = snapshot.loreBookPage
    getDatabase().characters = cloneJsonValue(snapshot.characters)
    getDatabase().modules = cloneJsonValue(snapshot.modules) as Database['modules']
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

type GlobalLorebookListRollbackEntry = {
  key: string
  previous: GlobalLorebook | null
  attempted: GlobalLorebook | null
  previousIndex?: number
}

type GlobalLorebookNameRollback = {
  lorebookId: string
  previous: Partial<Pick<GlobalLorebook, 'name'>>
  attempted: Pick<GlobalLorebook, 'name'>
}

type GlobalLorebookOrderRollback = {
  previousIds: string[]
  attemptedIds: string[]
}

type GlobalLorebookSelectionRollback = {
  previousPage: number
  previousLorebookId: string | null
  attemptedPage: number
  attemptedLorebookId: string | null
}

export function currentGlobalLorebookStateSnapshot(): GlobalLorebookStateSnapshot {
  return {
    loreBook: cloneJsonValue((getDatabase().loreBook ?? []) as GlobalLorebook[]),
    loreBookPage: getDatabase().loreBookPage ?? 0,
    selectedCharID: get(selectedCharID),
  }
}

export function restoreGlobalLorebookState(snapshot: GlobalLorebookStateSnapshot): void {
  withTrustedResourceWrite(() => {
    getDatabase().loreBook = cloneJsonValue(snapshot.loreBook) as Database['loreBook']
    getDatabase().loreBookPage = snapshot.loreBookPage
  })
}

export function ensureClientLorebookEntryIds(entries: loreBook[]): loreBook[] {
  for (const entry of entries ?? []) {
    // Only write when an id is actually missing. An unconditional assignment
    // would trip the read-only resource guard's set trap even when the value
    // is unchanged, which breaks dispatch paths that pass projection-owned
    // entry arrays.
    if (typeof entry.id !== 'string' || !entry.id.trim()) {
      entry.id = v4()
    }
  }
  return entries
}

function lorebookEntryIdsNeedNormalization(entries: loreBook[] | undefined): boolean {
  return (entries ?? []).some((entry) => typeof entry.id !== 'string' || !entry.id.trim())
}

export function ensureAllClientLorebookIds(): void {
  if (!allClientLorebookIdsNeedNormalization()) return

  withTrustedResourceWrite(() => {
    assignGlobalLorebookListIds()
    for (const character of getDatabase().characters ?? []) {
      // Only touch a HYDRATED character's globalLore — assigning ids to a stubbed
      // one would default its absent globalLore to `[]` and mask the stub.
      if (character.chaId && hydratedCharacterLorebooks.has(character.chaId)) {
        if (!Array.isArray(character.globalLore)) {
          character.globalLore = []
        } else {
          ensureClientLorebookEntryIds(character.globalLore)
        }
      }
      // Chat localLore stays resident, not stubbed.
      for (const chat of character.chats ?? []) {
        if (!Array.isArray(chat.localLore)) {
          chat.localLore = []
        } else {
          ensureClientLorebookEntryIds(chat.localLore)
        }
      }
    }
    for (const module of (getDatabase().modules ?? []) as RisuModule[]) {
      if (Array.isArray(module.lorebook)) {
        ensureClientLorebookEntryIds(module.lorebook)
      }
    }
  })
}

function allClientLorebookIdsNeedNormalization(): boolean {
  if (globalLorebookListIdsNeedNormalization()) return true

  for (const character of getDatabase().characters ?? []) {
    if (
      character.chaId &&
      hydratedCharacterLorebooks.has(character.chaId) &&
      (!Array.isArray(character.globalLore) || lorebookEntryIdsNeedNormalization(character.globalLore))
    ) {
      return true
    }
    for (const chat of character.chats ?? []) {
      if (!Array.isArray(chat.localLore) || lorebookEntryIdsNeedNormalization(chat.localLore)) {
        return true
      }
    }
  }

  for (const module of (getDatabase().modules ?? []) as RisuModule[]) {
    if (Array.isArray(module.lorebook) && lorebookEntryIdsNeedNormalization(module.lorebook)) {
      return true
    }
  }

  return false
}

// Shared by the whole-DB ensure above and the global-list-only ensure below.
// Must run inside a trusted write scope (it re-reads the resource-backed database itself).
function assignGlobalLorebookListIds(): void {
  for (const lorebook of (getDatabase().loreBook ?? []) as GlobalLorebook[]) {
    if (typeof lorebook.id !== 'string' || !lorebook.id.trim()) {
      lorebook.id = v4()
    }
    if (!Array.isArray(lorebook.data)) {
      lorebook.data = []
    } else {
      ensureClientLorebookEntryIds(lorebook.data)
    }
  }
}

/** Assign ids on the global lorebook list only (book ids + entry ids). */
export function ensureGlobalLorebookListIds(): void {
  if (!globalLorebookListIdsNeedNormalization()) return

  withTrustedResourceWrite(() => {
    assignGlobalLorebookListIds()
  })
}

export function globalLorebookListIdsNeedNormalization(): boolean {
  return ((getDatabase().loreBook ?? []) as GlobalLorebook[]).some(
    (lorebook) =>
      typeof lorebook.id !== 'string' ||
      !lorebook.id.trim() ||
      !Array.isArray(lorebook.data) ||
      lorebookEntryIdsNeedNormalization(lorebook.data),
  )
}

/**
 * Scoped pre-edit rollback for a DISCRETE editor action on ONE collection:
 * a global lorebook's entries, a character's globalLore, or a chat's localLore.
 * Builds the same `scopeKey`+`scopedValue` rollback the watcher uses, so a failed
 * command restores only the edited collection — without the whole-DB id-assign
 * write older broad snapshots used to perform and without cloning the
 * characters+modules graph. Ids are ensured on the edited collection only. The
 * broad snapshot stays for the genuine multi-collection callers (module apply,
 * MCP edits).
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
      const character = getDatabase().characters?.find((candidate) => candidate.chaId === scope.characterId)
      return scopedLorebookStateSnapshot(`character:${scope.characterId}`, snapshotJson(character?.globalLore ?? []))
    }
    case 'chat': {
      const chat = findChat(scope.chatId)
      return scopedLorebookStateSnapshot(`chat:${scope.chatId}`, snapshotJson(chat?.localLore ?? []))
    }
    case 'global': {
      const lorebook = ((getDatabase().loreBook ?? []) as GlobalLorebook[]).find(
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
  if (!existing || hasLorebookProjectionEpochChanged(existing.projectionEpochs)) {
    return currentLorebookEntryScopedSnapshot(scope, index)
  }
  if (existing.source === 'collection' || !isLorebookEntryStateSnapshot(existing.previous)) {
    return existing.previous
  }
  if (existing.previous.index === index) {
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
    getDatabase()?.enableLorebookStubs &&
    !hydratedCharacterLorebooks.has(scope.characterId)
  ) {
    return false
  }

  const key = lorebookCollectionScopeKey(scope)
  const existing = pendingReplacements.get(key)
  const previous = entryDraftRollbackSnapshot(scope, existing, index)

  let entries: loreBook[] | null = null
  withTrustedResourceWrite(() => {
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

export function replaceCharacterLorebookCollection(characterId: string, entries: loreBook[], delayMs = 250): boolean {
  if (!characterId) return false
  return replaceLorebookCollection({ kind: 'character', characterId }, entries, delayMs)
}

export function replaceCharacterLorebookCollectionFull(
  characterId: string,
  entries: loreBook[],
  delayMs = 250,
): boolean {
  if (!characterId) return false
  return replaceLorebookCollection({ kind: 'character', characterId }, entries, delayMs, 'fullCollection')
}

export function replaceChatLorebookCollection(chatId: string, entries: loreBook[], delayMs = 250): boolean {
  if (!chatId) return false
  return replaceLorebookCollection({ kind: 'chat', chatId }, entries, delayMs)
}

function getCurrentChatFromResources(): Chat | undefined {
  const character = getDatabase().characters?.[get(selectedCharID)]
  return character?.chats?.[character.chatPage ?? 0]
}

export function applyServerCharacterLorebookResource(characterId: string, globalLore: unknown[]): boolean {
  return withServerResourceApply(() => {
    const character = getDatabase().characters?.find((candidate) => candidate.chaId === characterId)
    if (!character) return false
    character.globalLore = globalLore as typeof character.globalLore
    return true
  })
}

export function setActiveChatLorebookLocalActivation(book: loreBook, active: boolean, delayMs = 250): boolean {
  const chatId = getCurrentChatFromResources()?.id
  const previous = chatId ? currentLorebookCollectionScopedSnapshot({ kind: 'chat', chatId }) : null
  if (!chatId || !previous) return false

  let entries: loreBook[] | null = null
  const applied = withTrustedResourceWrite(() => {
    const chat = getCurrentChatFromResources()
    if (!chat || chat.id !== chatId) return false

    if (!Array.isArray(chat.localLore)) {
      chat.localLore = []
    }

    if (active) {
      if (!book.id) {
        book.id = v4()
      }

      const childLore: loreBook = {
        key: '',
        comment: '',
        content: '',
        mode: 'child',
        insertorder: 100,
        alwaysActive: true,
        secondkey: '',
        selective: false,
        id: book.id,
      }
      chat.localLore.push(childLore)
    } else if (book.id) {
      const childLore = chat.localLore.find((entry) => entry.id === book.id)
      if (childLore) {
        chat.localLore = chat.localLore.filter((entry) => entry.id !== book.id)
      }
    }

    entries = cloneJsonValue(chat.localLore ?? [])
    return true
  })

  if (!applied || !entries) return false
  dispatchReplaceChatLorebooks(chatId, entries, previous, delayMs)
  return true
}

export function replaceGlobalLorebookEntryCollection(lorebookId: string, entries: loreBook[], delayMs = 250): boolean {
  if (!lorebookId) return false
  return replaceLorebookCollection({ kind: 'global', lorebookId }, entries, delayMs)
}

export function replaceModuleLorebookCollectionDraft(
  moduleId: string | null | undefined,
  currentModule: RisuModule | null | undefined,
  entries: loreBook[],
  delayMs = 250,
): boolean {
  if (!moduleId) return false

  const previous = currentLorebookCollectionScopedSnapshot({ kind: 'module', moduleId })
  const hasLiveModule = Boolean(findModule(moduleId))
  const cloned = cloneJsonValue(entries ?? [])
  ensureClientLorebookEntryIds(cloned)
  const commandEntries = cloneJsonValue(cloned)

  const applied = withTrustedResourceWrite(() => {
    const liveModule = findModule(moduleId)
    const draftModule = currentModule?.id === moduleId ? currentModule : null
    if (!liveModule && !draftModule) return false

    if (liveModule) liveModule.lorebook = cloned
    if (draftModule) draftModule.lorebook = cloned
    return true
  })
  if (!applied) return false

  if (hasLiveModule) dispatchReplaceModuleLorebooks(moduleId, commandEntries, previous, delayMs)
  return true
}

type ReplaceableLorebookCollectionScope =
  | { kind: 'character'; characterId: string }
  | { kind: 'chat'; chatId: string }
  | { kind: 'global'; lorebookId: string }

function replaceLorebookCollection(
  scope: ReplaceableLorebookCollectionScope,
  entries: loreBook[],
  delayMs: number,
  source: LorebookReplacementSource = 'collection',
): boolean {
  const previous = currentLorebookCollectionScopedSnapshot(scope)
  const cloned = cloneJsonValue(entries ?? [])
  const applied = withTrustedResourceWrite(() => assignLorebookCollection(scope, cloned))
  if (!applied) return false

  switch (scope.kind) {
    case 'character':
      dispatchReplaceCharacterLorebooks(scope.characterId, cloned, previous, delayMs, source)
      return true
    case 'chat':
      dispatchReplaceChatLorebooks(scope.chatId, cloned, previous, delayMs)
      return true
    case 'global':
      dispatchReplaceGlobalLorebookEntries(scope.lorebookId, cloned, previous, delayMs)
      return true
  }
}

function assignLorebookCollection(scope: ReplaceableLorebookCollectionScope, entries: loreBook[]): boolean {
  switch (scope.kind) {
    case 'character': {
      const character = getDatabase().characters?.find((candidate) => candidate.chaId === scope.characterId)
      if (!character) return false
      character.globalLore = entries
      return true
    }
    case 'chat': {
      const chat = findChat(scope.chatId)
      if (!chat) return false
      chat.localLore = entries
      return true
    }
    case 'global': {
      const lorebook = ((getDatabase().loreBook ?? []) as GlobalLorebook[]).find(
        (candidate) => candidate.id === scope.lorebookId,
      )
      if (!lorebook) return false
      lorebook.data = entries
      return true
    }
  }
}

// Assign missing ids on the edited collection only. The target is re-read inside
// the trusted write scope — a reference captured outside it would still be the
// read-only projection and throw on assignment.
function ensureScopedClientLorebookIds(scope: DiscreteLorebookEditScope): void {
  if (!scopedClientLorebookIdsNeedNormalization(scope)) return

  withTrustedResourceWrite(() => {
    switch (scope.kind) {
      case 'character': {
        const character = getDatabase().characters?.find((candidate) => candidate.chaId === scope.characterId)
        // Mirror the whole-DB ensure's no-data-loss guard: only touch a HYDRATED
        // character's globalLore — assigning ids to a stubbed one would default
        // its absent globalLore to `[]` and mask the stub.
        if (character?.chaId && hydratedCharacterLorebooks.has(character.chaId)) {
          if (!Array.isArray(character.globalLore)) {
            character.globalLore = []
          } else {
            ensureClientLorebookEntryIds(character.globalLore)
          }
        }
        return
      }
      case 'chat': {
        const chat = findChat(scope.chatId)
        if (chat) {
          if (!Array.isArray(chat.localLore)) {
            chat.localLore = []
          } else {
            ensureClientLorebookEntryIds(chat.localLore)
          }
        }
        return
      }
      case 'global': {
        const lorebook = ((getDatabase().loreBook ?? []) as GlobalLorebook[]).find(
          (candidate) => candidate.id === scope.lorebookId,
        )
        if (lorebook) {
          if (!Array.isArray(lorebook.data)) {
            lorebook.data = []
          } else {
            ensureClientLorebookEntryIds(lorebook.data)
          }
        }
        return
      }
      case 'module': {
        const module = findModule(scope.moduleId)
        if (module && Array.isArray(module.lorebook)) {
          ensureClientLorebookEntryIds(module.lorebook)
        }
        return
      }
    }
  })
}

function scopedClientLorebookIdsNeedNormalization(scope: DiscreteLorebookEditScope): boolean {
  switch (scope.kind) {
    case 'character': {
      const character = getDatabase().characters?.find((candidate) => candidate.chaId === scope.characterId)
      return !!(
        character?.chaId &&
        hydratedCharacterLorebooks.has(character.chaId) &&
        (!Array.isArray(character.globalLore) || lorebookEntryIdsNeedNormalization(character.globalLore))
      )
    }
    case 'chat': {
      const chat = findChat(scope.chatId)
      return !!chat && (!Array.isArray(chat.localLore) || lorebookEntryIdsNeedNormalization(chat.localLore))
    }
    case 'global': {
      const lorebook = ((getDatabase().loreBook ?? []) as GlobalLorebook[]).find(
        (candidate) => candidate.id === scope.lorebookId,
      )
      return !!lorebook && (!Array.isArray(lorebook.data) || lorebookEntryIdsNeedNormalization(lorebook.data))
    }
    case 'module': {
      const module = findModule(scope.moduleId)
      return !!(module && Array.isArray(module.lorebook) && lorebookEntryIdsNeedNormalization(module.lorebook))
    }
  }
}

function ensureScopedClientLorebookEntryId(scope: DiscreteLorebookEditScope, index: number): void {
  withTrustedResourceWrite(() => {
    if (
      scope.kind === 'character' &&
      getDatabase()?.enableLorebookStubs &&
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
      const character = getDatabase().characters?.find((candidate) => candidate.chaId === scope.characterId)
      return character ? { entries: character.globalLore ?? [] } : null
    }
    case 'chat': {
      const chat = findChat(scope.chatId)
      return chat ? { entries: chat.localLore ?? [] } : null
    }
    case 'global': {
      const lorebook = ((getDatabase().loreBook ?? []) as GlobalLorebook[]).find(
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

export function selectGlobalLorebook(index: number): boolean {
  const previous = currentGlobalLorebookStateSnapshot()
  const lorebookId = ((getDatabase().loreBook ?? []) as GlobalLorebook[])[index]?.id

  withTrustedResourceWrite(() => {
    getDatabase().loreBookPage = index
  })
  if (canUseServerCommands() && lorebookId) {
    dispatchSelectGlobalLorebook(lorebookId, previous)
  }
  return true
}

export function createGlobalLorebook(): boolean {
  const previous = currentGlobalLorebookStateSnapshot()
  const lorebook: GlobalLorebook = {
    id: v4(),
    name: 'New LoreBook',
    data: [],
  }

  withTrustedResourceWrite(() => {
    const loreBooks = (getDatabase().loreBook ?? []) as GlobalLorebook[]
    loreBooks.push(lorebook)
    getDatabase().loreBook = loreBooks as Database['loreBook']
    dispatchCreateGlobalLorebook(lorebook, previous)
  })

  return true
}

export function renameGlobalLorebook(index: number, name: string): boolean {
  if (!((getDatabase().loreBook ?? []) as GlobalLorebook[])[index]) return false

  withTrustedResourceWrite(() => {
    const lorebook = ((getDatabase().loreBook ?? []) as GlobalLorebook[])[index]
    if (lorebook) lorebook.name = name
  })

  return true
}

export function deleteGlobalLorebook(index: number): boolean {
  const loreBooks = (getDatabase().loreBook ?? []) as GlobalLorebook[]
  if (loreBooks.length <= 1 || !loreBooks[index]) return false

  const previous = currentGlobalLorebookStateSnapshot()
  const lorebookId = ((getDatabase().loreBook ?? []) as GlobalLorebook[])[index]?.id
  withTrustedResourceWrite(() => {
    const current = (getDatabase().loreBook ?? []) as GlobalLorebook[]
    if (current.length <= 1 || !current[index]) return
    current.splice(index, 1)
    getDatabase().loreBookPage = 0
    getDatabase().loreBook = current as Database['loreBook']
    if (lorebookId) {
      dispatchDeleteGlobalLorebook(lorebookId, previous)
    }
  })

  return true
}

// Global-lorebook list operations roll back only the attempted row/order/page
// state. The broad snapshot exports remain for direct callers, but command
// failures must not restore an old full list over newer sibling rows or
// selection changes.
export function dispatchCreateGlobalLorebook(lorebook: GlobalLorebook, previous: GlobalLorebookStateSnapshot): void {
  if (!canUseServerCommands()) return
  const collectionProjectionEpoch = captureCollectionProjectionEpoch('loreBook')
  lorebook.id = typeof lorebook.id === 'string' && lorebook.id.trim() ? lorebook.id : v4()
  lorebook.data = ensureClientLorebookEntryIds(lorebook.data ?? [])
  const attempted = cloneJsonValue(lorebook)
  const rollbackEntry: GlobalLorebookListRollbackEntry = {
    key: attempted.id as string,
    previous: null,
    attempted,
    previousIndex: previous.loreBook.length,
  }
  void runServerCommand({
    command: (baseRevision) =>
      createGlobalLorebookCommand({
        baseRevision,
        lorebook: cloneJsonValue(attempted) as GlobalLorebookSnapshot,
        acknowledgeOptimistic: true,
        optimisticCollectionEpoch: collectionProjectionEpoch,
      }),
    rollback: () => {
      if (!hasCollectionProjectionEpochChanged('loreBook', collectionProjectionEpoch)) {
        rollbackGlobalLorebookListEntry(rollbackEntry)
      }
    },
  })
}

export function dispatchUpdateGlobalLorebook(
  lorebookId: string,
  patch: Pick<GlobalLorebook, 'name'>,
  previous: LorebookStateSnapshot,
): void {
  if (!canUseServerCommands()) return
  const collectionProjectionEpoch = captureCollectionProjectionEpoch('loreBook')
  const attempted = cloneJsonValue(patch)
  const rollback = globalLorebookNameRollbackFromSnapshot(lorebookId, previous, attempted)
  void runServerCommand({
    command: (baseRevision) =>
      updateGlobalLorebookCommand({
        baseRevision,
        lorebookId,
        patch: cloneJsonValue(attempted),
        acknowledgeOptimistic: true,
        optimisticCollectionEpoch: collectionProjectionEpoch,
      }),
    rollback: () => {
      if (!hasCollectionProjectionEpochChanged('loreBook', collectionProjectionEpoch)) {
        rollbackGlobalLorebookName(rollback)
      }
    },
  })
}

export function dispatchDeleteGlobalLorebook(lorebookId: string, previous: GlobalLorebookStateSnapshot): void {
  if (!canUseServerCommands()) return
  const collectionProjectionEpoch = captureCollectionProjectionEpoch('loreBook')
  const pageProjectionEpoch = captureLorebookPageProjectionEpoch()
  const previousIndex = previous.loreBook.findIndex((lorebook) => lorebook.id === lorebookId)
  const previousLorebook = previousIndex >= 0 ? previous.loreBook[previousIndex] : null
  const rollbackEntry: GlobalLorebookListRollbackEntry | null = previousLorebook
    ? {
        key: lorebookId,
        previous: cloneJsonValue(previousLorebook),
        attempted: null,
        previousIndex,
      }
    : null
  const selectionRollback = globalLorebookSelectionRollbackFromSnapshot(previous)
  void runServerCommand({
    command: (baseRevision) =>
      deleteGlobalLorebookCommand({
        baseRevision,
        lorebookId,
        acknowledgeOptimistic: true,
        optimisticCollectionEpoch: collectionProjectionEpoch,
        optimisticPageEpoch: pageProjectionEpoch,
      }),
    rollback: () =>
      rollbackDeletedGlobalLorebook(rollbackEntry, selectionRollback, {
        restoreRow: !hasCollectionProjectionEpochChanged('loreBook', collectionProjectionEpoch),
        restoreSelection: !hasLorebookPageProjectionEpochChanged(pageProjectionEpoch),
      }),
  })
}

export function dispatchReorderGlobalLorebooks(previous: LorebookStateSnapshot): void {
  if (!canUseServerCommands()) return
  const collectionProjectionEpoch = captureCollectionProjectionEpoch('loreBook')
  const pageProjectionEpoch = captureLorebookPageProjectionEpoch()
  const lorebookIds = ((getDatabase().loreBook ?? []) as GlobalLorebook[]).map((lorebook) => lorebook.id)
  if (!hasStableUniqueCommandIds(lorebookIds)) return
  const previousIds = previous.loreBook.map((lorebook) => lorebook.id)
  if (!hasStableUniqueCommandIds(previousIds)) return
  const previousPage = previous.loreBookPage ?? 0
  const selectedLorebookId = stableGlobalLorebookId(previous.loreBook[previousPage]?.id)
  const selectedIndex = selectedLorebookId ? (lorebookIds as string[]).indexOf(selectedLorebookId) : -1
  const acknowledgeOptimistic = selectedLorebookId !== null && selectedIndex >= 0
  if (acknowledgeOptimistic) {
    withSuppressedLorebookWatcher(() => {
      withTrustedResourceWrite(() => {
        getDatabase().loreBookPage = selectedIndex
      })
    })
  }
  const rollback: GlobalLorebookOrderRollback = {
    previousIds: previousIds as string[],
    attemptedIds: lorebookIds as string[],
  }
  const selectionRollback = globalLorebookSelectionRollbackFromSnapshot(previous)
  void runServerCommand({
    command: (baseRevision) =>
      reorderGlobalLorebooksCommand({
        baseRevision,
        lorebookIds: cloneJsonValue(rollback.attemptedIds),
        acknowledgeOptimistic,
        optimisticCollectionEpoch: collectionProjectionEpoch,
        optimisticPageEpoch: pageProjectionEpoch,
        optimisticSelectedLorebookId: acknowledgeOptimistic ? selectedLorebookId : undefined,
      }),
    rollback: () => {
      if (!hasCollectionProjectionEpochChanged('loreBook', collectionProjectionEpoch)) {
        rollbackGlobalLorebookOrder(rollback)
      }
      if (!hasLorebookPageProjectionEpochChanged(pageProjectionEpoch)) {
        rollbackGlobalLorebookSelection(selectionRollback)
      }
    },
  })
}

export function dispatchSelectGlobalLorebook(lorebookId: string, previous: GlobalLorebookStateSnapshot): void {
  if (!canUseServerCommands()) return
  const pageProjectionEpoch = captureLorebookPageProjectionEpoch()
  const stableIds = globalLorebookStableIds((getDatabase().loreBook ?? []) as GlobalLorebook[])
  const rollback = globalLorebookSelectionRollbackFromSnapshot(previous, lorebookId)
  void runServerCommand({
    command: (baseRevision) =>
      selectGlobalLorebookCommand({
        baseRevision,
        lorebookId,
        acknowledgeOptimistic: !!stableIds?.includes(lorebookId),
        optimisticPageEpoch: pageProjectionEpoch,
      }),
    rollback: () => {
      if (!hasLorebookPageProjectionEpochChanged(pageProjectionEpoch)) {
        rollbackGlobalLorebookSelection(rollback)
      }
    },
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
  if (source === 'collection' || source === 'fullCollection') ensureClientLorebookEntryIds(entries)
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
  if (getDatabase()?.enableLorebookStubs && !hydratedCharacterLorebooks.has(characterId)) return
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
  const attemptedEntries = cloneJsonValue(entries ?? []) as loreBook[]
  const projectionEpochs = captureLorebookProjectionEpochs(scope)
  queueReplacement(
    key,
    previous,
    (rollbackSnapshot, effectiveProjectionEpochs, options = {}) => {
      const isWatchedCollection = source === 'watchedCollection'
      if (isWatchedCollection) {
        const liveEntries = resolveLorebookCollection(scope)?.entries
        if (!hasStableUniqueLorebookEntryIds(liveEntries)) {
          return Promise.resolve({ status: 'unavailable' })
        }
      }

      const entrySnapshots = isWatchedCollection
        ? (cloneJsonValue(attemptedEntries ?? []) as LorebookEntrySnapshot[])
        : cloneLorebookEntriesForCommand(attemptedEntries)
      const optimisticMetadata = lorebookOptimisticCommandMetadata(scope, effectiveProjectionEpochs, entrySnapshots)
      const entryAttempt = registerLorebookEntryAttempt(rollbackSnapshot, attemptedEntries)

      const result = runServerCommand({
        command: (baseRevision): Promise<ServerCommandResult<Record<string, unknown>>> => {
          if (source === 'entry' && isLorebookEntryStateSnapshot(rollbackSnapshot)) {
            const entryCommand = lorebookEntryUpsertCommand(
              scope,
              attemptedEntries,
              rollbackSnapshot,
              baseRevision,
              options,
              optimisticMetadata,
            )
            if (entryCommand) return entryCommand
          }
          if (isLorebookCollectionReplacementSource(source) && !isLorebookEntryStateSnapshot(rollbackSnapshot)) {
            const collectionCommand = lorebookCollectionDeltaCommand(
              scope,
              attemptedEntries,
              rollbackSnapshot,
              baseRevision,
              options,
              optimisticMetadata,
            )
            if (collectionCommand) return collectionCommand
          }
          switch (scope.kind) {
            case 'character':
              return replaceCharacterLorebooksCommand(
                {
                  baseRevision,
                  characterId: scope.characterId,
                  entries: entrySnapshots,
                  ...optimisticMetadata,
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
                  ...optimisticMetadata,
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
                  ...optimisticMetadata,
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
                true,
              ) as Promise<ServerCommandResult<Record<string, unknown>>>
          }
        },
        rollback: () => {
          if (hasLorebookProjectionEpochChanged(effectiveProjectionEpochs)) return
          if (entryAttempt) {
            rollbackLorebookEntryAttempt(entryAttempt)
          } else {
            rollbackLorebookReplacement(scope, rollbackSnapshot, attemptedEntries)
          }
        },
        signal: options.signal,
        keepalive: options.keepalive,
      })
      if (entryAttempt) {
        void result.then(
          () => clearLorebookEntryAttempt(entryAttempt),
          () => clearLorebookEntryAttempt(entryAttempt),
        )
      }
      return result
    },
    delayMs,
    source,
    projectionEpochs,
    attemptedEntries,
  )
}

type LorebookCollectionDelta =
  | { type: 'upsert'; entry: loreBook }
  | { type: 'delete'; entryId: string }
  | { type: 'reorder'; entryIds: string[] }

type LorebookOptimisticCommandMetadata = {
  acknowledgeOptimistic?: boolean
  optimisticEntries?: LorebookEntrySnapshot[]
  optimisticCollectionEpoch?: number
  optimisticCharacterId?: string
  optimisticRowEpoch?: number
  optimisticLorebookEpoch?: number
  optimisticEntryIndex?: number
  optimisticEntryCreated?: boolean
}

function lorebookOptimisticCommandMetadata(
  scope: DiscreteLorebookEditScope,
  epochs: LorebookProjectionEpochs,
  optimisticEntries: LorebookEntrySnapshot[],
): LorebookOptimisticCommandMetadata {
  if (scope.kind === 'global' && epochs.kind === 'global') {
    return {
      acknowledgeOptimistic: true,
      optimisticEntries,
      optimisticCollectionEpoch: epochs.collectionEpoch,
    }
  }
  if (scope.kind === 'character' && epochs.kind === 'character' && epochs.characterId === scope.characterId) {
    return {
      acknowledgeOptimistic: true,
      optimisticEntries,
      optimisticRowEpoch: epochs.rowEpoch,
      optimisticLorebookEpoch: epochs.lorebookEpoch,
    }
  }
  if (
    scope.kind === 'chat' &&
    epochs.kind === 'chat' &&
    epochs.chatId === scope.chatId &&
    epochs.characterId &&
    epochs.rowEpoch !== null
  ) {
    return {
      acknowledgeOptimistic: true,
      optimisticEntries,
      optimisticCharacterId: epochs.characterId,
      optimisticRowEpoch: epochs.rowEpoch,
    }
  }
  return {}
}

function lorebookCollectionDeltaCommand(
  scope: DiscreteLorebookEditScope,
  entries: loreBook[],
  rollbackSnapshot: LorebookStateSnapshot,
  baseRevision: number,
  options: ServerCommandTransportOptions,
  optimisticMetadata: LorebookOptimisticCommandMetadata,
): Promise<ServerCommandResult<Record<string, unknown>>> | null {
  const delta = detectLorebookCollectionDelta(rollbackSnapshot.scopedValue, entries)
  if (!delta) return null

  switch (delta.type) {
    case 'upsert': {
      const entryId = delta.entry.id
      if (typeof entryId !== 'string' || entryId.trim() === '') return null
      const previousEntries = rollbackSnapshot.scopedValue as loreBook[]
      const previousEntry = previousEntries.find((entry) => entry.id === entryId)
      const optimisticEntryIndex = entries.findIndex((entry) => entry.id === entryId)
      const entrySnapshot = cloneJsonValue(delta.entry) as LorebookEntrySnapshot
      const sparseUpdate = previousEntry ? sparseLorebookEntryUpdate(previousEntry, delta.entry) : null
      return lorebookScopedEntryCommand(
        scope,
        'upsert',
        baseRevision,
        options,
        {
          ...optimisticMetadata,
          optimisticEntryIndex,
          optimisticEntryCreated: !previousEntries.some((entry) => entry.id === entryId),
        },
        {
          entryId,
          entry: entrySnapshot,
          ...(sparseUpdate ? { sparseUpdate } : {}),
        },
      )
    }
    case 'delete': {
      const previousEntries = rollbackSnapshot.scopedValue as loreBook[]
      const optimisticEntryIndex = previousEntries.findIndex((entry) => entry.id === delta.entryId)
      return lorebookScopedEntryCommand(
        scope,
        'delete',
        baseRevision,
        options,
        { ...optimisticMetadata, optimisticEntryIndex },
        { entryId: delta.entryId },
      )
    }
    case 'reorder':
      return lorebookScopedEntryCommand(scope, 'reorder', baseRevision, options, optimisticMetadata, {
        entryIds: delta.entryIds,
      })
  }
}

function detectLorebookCollectionDelta(
  previousValue: unknown,
  currentEntries: loreBook[],
): LorebookCollectionDelta | null {
  if (!Array.isArray(previousValue)) return null
  const previousEntries = previousValue as loreBook[]
  const previousIds = lorebookEntryIds(previousEntries)
  const currentIds = lorebookEntryIds(currentEntries)
  if (!previousIds || !currentIds) return null

  if (previousEntries.length === currentEntries.length) {
    if (sameStringArray(previousIds, currentIds)) {
      const changed = currentEntries.filter(
        (entry, index) => snapshotJson(entry) !== snapshotJson(previousEntries[index]),
      )
      return changed.length === 1 ? { type: 'upsert', entry: changed[0] } : null
    }
    if (sameStringSet(previousIds, currentIds) && sameEntriesById(previousEntries, currentEntries)) {
      return { type: 'reorder', entryIds: currentIds }
    }
    return null
  }

  if (
    currentEntries.length === previousEntries.length + 1 &&
    sameStringArray(previousIds, currentIds.slice(0, -1)) &&
    sameSharedEntriesById(previousEntries, currentEntries)
  ) {
    return { type: 'upsert', entry: currentEntries[currentEntries.length - 1] }
  }

  if (currentEntries.length + 1 === previousEntries.length) {
    const removedIds = previousIds.filter((id) => !currentIds.includes(id))
    if (removedIds.length !== 1) return null
    const withoutRemoved = previousIds.filter((id) => id !== removedIds[0])
    return sameStringArray(withoutRemoved, currentIds) && sameSharedEntriesById(previousEntries, currentEntries)
      ? { type: 'delete', entryId: removedIds[0] }
      : null
  }

  return null
}

function sparseLorebookEntryUpdate(
  previousEntry: loreBook,
  attemptedEntry: loreBook,
): SparseLorebookEntryUpdate | null {
  if (
    !isStableCommandId(previousEntry.id) ||
    !isStableCommandId(attemptedEntry.id) ||
    previousEntry.id !== attemptedEntry.id
  ) {
    return null
  }

  const previous = previousEntry as unknown as Record<string, unknown>
  const attempted = attemptedEntry as unknown as Record<string, unknown>
  const patch: LorebookEntrySnapshot = {}
  const deleteKeys: string[] = []
  const keys = new Set([...Object.keys(previous), ...Object.keys(attempted)])

  for (const key of keys) {
    if (key === 'id') continue
    const previousHasKey = Object.prototype.hasOwnProperty.call(previous, key)
    const attemptedHasKey = Object.prototype.hasOwnProperty.call(attempted, key)
    if (!attemptedHasKey || attempted[key] === undefined) {
      if (previousHasKey) deleteKeys.push(key)
      continue
    }
    if (!previousHasKey || snapshotJson(previous[key]) !== snapshotJson(attempted[key])) {
      patch[key] = cloneJsonValue(attempted[key])
    }
  }

  if (Object.keys(patch).length === 0 && deleteKeys.length === 0) return null
  return { patch, ...(deleteKeys.length > 0 ? { deleteKeys } : {}) }
}

function lorebookEntryIds(entries: loreBook[]): string[] | null {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (!isStableCommandId(entry.id)) return null
    if (seen.has(entry.id)) return null
    seen.add(entry.id)
    ids.push(entry.id)
  }
  return ids
}

function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const setA = new Set(a)
  const setB = new Set(b)
  return setA.size === a.length && setB.size === b.length && b.every((value) => setA.has(value))
}

function sameEntriesById(previousEntries: loreBook[], currentEntries: loreBook[]): boolean {
  const previousById = new Map(previousEntries.map((entry) => [entry.id, snapshotJson(entry)]))
  return currentEntries.every((entry) => previousById.get(entry.id) === snapshotJson(entry))
}

function sameSharedEntriesById(previousEntries: loreBook[], currentEntries: loreBook[]): boolean {
  const currentById = new Map(currentEntries.map((entry) => [entry.id, snapshotJson(entry)]))
  return previousEntries.every((entry) => {
    const currentSnapshot = currentById.get(entry.id)
    return currentSnapshot === undefined || currentSnapshot === snapshotJson(entry)
  })
}

function isStableCommandId(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function hasStableUniqueCommandIds(values: readonly unknown[]): values is string[] {
  const seen = new Set<string>()
  for (const value of values) {
    if (!isStableCommandId(value)) return false
    if (seen.has(value)) return false
    seen.add(value)
  }
  return true
}

function hasStableUniqueLorebookEntryIds(entries: unknown): entries is loreBook[] {
  if (!Array.isArray(entries)) return false
  return hasStableUniqueCommandIds(entries.map((entry) => (entry as { id?: unknown }).id))
}

function uniqueStableGlobalLorebookIds(lorebooks: readonly GlobalLorebook[]): Set<string> {
  const counts = new Map<string, number>()
  for (const lorebook of lorebooks) {
    if (!isStableCommandId(lorebook.id)) continue
    counts.set(lorebook.id, (counts.get(lorebook.id) ?? 0) + 1)
  }
  return new Set([...counts].filter(([, count]) => count === 1).map(([id]) => id))
}

function lorebookScopedEntryCommand(
  scope: DiscreteLorebookEditScope,
  action: 'upsert',
  baseRevision: number,
  options: ServerCommandTransportOptions,
  optimisticMetadata: LorebookOptimisticCommandMetadata,
  payload: { entryId: string; entry: LorebookEntrySnapshot; sparseUpdate?: SparseLorebookEntryUpdate },
): Promise<ServerCommandResult<Record<string, unknown>>>
function lorebookScopedEntryCommand(
  scope: DiscreteLorebookEditScope,
  action: 'delete',
  baseRevision: number,
  options: ServerCommandTransportOptions,
  optimisticMetadata: LorebookOptimisticCommandMetadata,
  payload: { entryId: string },
): Promise<ServerCommandResult<Record<string, unknown>>>
function lorebookScopedEntryCommand(
  scope: DiscreteLorebookEditScope,
  action: 'reorder',
  baseRevision: number,
  options: ServerCommandTransportOptions,
  optimisticMetadata: LorebookOptimisticCommandMetadata,
  payload: { entryIds: string[] },
): Promise<ServerCommandResult<Record<string, unknown>>>
function lorebookScopedEntryCommand(
  scope: DiscreteLorebookEditScope,
  action: 'upsert' | 'delete' | 'reorder',
  baseRevision: number,
  options: ServerCommandTransportOptions,
  optimisticMetadata: LorebookOptimisticCommandMetadata,
  payload: {
    entryId?: string
    entry?: LorebookEntrySnapshot
    sparseUpdate?: SparseLorebookEntryUpdate
    entryIds?: string[]
  },
): Promise<ServerCommandResult<Record<string, unknown>>> {
  switch (scope.kind) {
    case 'character':
      if (action === 'upsert') {
        return upsertCharacterLorebookEntryCommand(
          {
            baseRevision,
            characterId: scope.characterId,
            entryId: payload.entryId!,
            entry: payload.entry!,
            sparseUpdate: payload.sparseUpdate,
            ...optimisticMetadata,
          },
          options.signal,
          options.keepalive,
        ) as Promise<ServerCommandResult<Record<string, unknown>>>
      }
      if (action === 'delete') {
        return deleteCharacterLorebookEntryCommand(
          { baseRevision, characterId: scope.characterId, entryId: payload.entryId!, ...optimisticMetadata },
          options.signal,
          options.keepalive,
        ) as Promise<ServerCommandResult<Record<string, unknown>>>
      }
      return reorderCharacterLorebookEntriesCommand(
        { baseRevision, characterId: scope.characterId, entryIds: payload.entryIds!, ...optimisticMetadata },
        options.signal,
        options.keepalive,
      ) as Promise<ServerCommandResult<Record<string, unknown>>>
    case 'chat':
      if (action === 'upsert') {
        return upsertChatLorebookEntryCommand(
          {
            baseRevision,
            chatId: scope.chatId,
            entryId: payload.entryId!,
            entry: payload.entry!,
            sparseUpdate: payload.sparseUpdate,
            ...optimisticMetadata,
          },
          options.signal,
          options.keepalive,
        ) as Promise<ServerCommandResult<Record<string, unknown>>>
      }
      if (action === 'delete') {
        return deleteChatLorebookEntryCommand(
          { baseRevision, chatId: scope.chatId, entryId: payload.entryId!, ...optimisticMetadata },
          options.signal,
          options.keepalive,
        ) as Promise<ServerCommandResult<Record<string, unknown>>>
      }
      return reorderChatLorebookEntriesCommand(
        { baseRevision, chatId: scope.chatId, entryIds: payload.entryIds!, ...optimisticMetadata },
        options.signal,
        options.keepalive,
      ) as Promise<ServerCommandResult<Record<string, unknown>>>
    case 'global':
      if (action === 'upsert') {
        return upsertGlobalLorebookEntryCommand(
          {
            baseRevision,
            lorebookId: scope.lorebookId,
            entryId: payload.entryId!,
            entry: payload.entry!,
            sparseUpdate: payload.sparseUpdate,
            ...optimisticMetadata,
          },
          options.signal,
          options.keepalive,
        ) as Promise<ServerCommandResult<Record<string, unknown>>>
      }
      if (action === 'delete') {
        return deleteGlobalLorebookEntryCommand(
          { baseRevision, lorebookId: scope.lorebookId, entryId: payload.entryId!, ...optimisticMetadata },
          options.signal,
          options.keepalive,
        ) as Promise<ServerCommandResult<Record<string, unknown>>>
      }
      return reorderGlobalLorebookEntriesCommand(
        { baseRevision, lorebookId: scope.lorebookId, entryIds: payload.entryIds!, ...optimisticMetadata },
        options.signal,
        options.keepalive,
      ) as Promise<ServerCommandResult<Record<string, unknown>>>
    case 'module':
      if (action === 'upsert') {
        return upsertModuleLorebookEntryCommand(
          {
            baseRevision,
            moduleId: scope.moduleId,
            entryId: payload.entryId!,
            entry: payload.entry!,
            sparseUpdate: payload.sparseUpdate,
          },
          options.signal,
          options.keepalive,
          true,
        ) as Promise<ServerCommandResult<Record<string, unknown>>>
      }
      if (action === 'delete') {
        return deleteModuleLorebookEntryCommand(
          {
            baseRevision,
            moduleId: scope.moduleId,
            entryId: payload.entryId!,
          },
          options.signal,
          options.keepalive,
          true,
        ) as Promise<ServerCommandResult<Record<string, unknown>>>
      }
      return reorderModuleLorebookEntriesCommand(
        { baseRevision, moduleId: scope.moduleId, entryIds: payload.entryIds! },
        options.signal,
        options.keepalive,
        true,
      ) as Promise<ServerCommandResult<Record<string, unknown>>>
  }
}

function lorebookEntryUpsertCommand(
  scope: DiscreteLorebookEditScope,
  entries: loreBook[],
  rollbackSnapshot: LorebookEntryStateSnapshot,
  baseRevision: number,
  options: ServerCommandTransportOptions,
  optimisticMetadata: LorebookOptimisticCommandMetadata,
): Promise<ServerCommandResult<Record<string, unknown>>> | null {
  const entry = currentEditedLorebookEntry(entries, rollbackSnapshot)
  const entryId = entry?.id
  if (typeof entryId !== 'string' || entryId.trim() === '') return null
  const entrySnapshot = cloneJsonValue(entry) as LorebookEntrySnapshot
  const sparseUpdate = rollbackSnapshot.previousEntry
    ? sparseLorebookEntryUpdate(rollbackSnapshot.previousEntry, entry)
    : null
  const optimisticEntryIndex = entries.findIndex((candidate) => candidate.id === entryId)
  if (optimisticEntryIndex < 0) return null
  const entryOptimisticMetadata: LorebookOptimisticCommandMetadata = {
    ...optimisticMetadata,
    optimisticEntryIndex,
    optimisticEntryCreated: rollbackSnapshot.previousEntry === null,
  }

  return lorebookScopedEntryCommand(scope, 'upsert', baseRevision, options, entryOptimisticMetadata, {
    entryId,
    entry: entrySnapshot,
    ...(sparseUpdate ? { sparseUpdate } : {}),
  })
}

function currentEditedLorebookEntry(
  entries: loreBook[],
  rollbackSnapshot: LorebookEntryStateSnapshot,
): loreBook | undefined {
  if (rollbackSnapshot.entryId) {
    const byId = entries.find((entry) => entry.id === rollbackSnapshot.entryId)
    if (byId) return byId
  }
  return entries[rollbackSnapshot.index]
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
  let previousSnapshots = new Map<string, string>()
  let previousResourceApplyEpoch = getServerResourceApplyEpoch()

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
      const resourceApplyEpoch = getServerResourceApplyEpoch()
      const currentSnapshots = collectLorebookCollectionSnapshots(scope)

      if (suppressRollbackDispatch || !initialized || resourceApplyEpoch !== previousResourceApplyEpoch) {
        initialized = true
        previousResourceApplyEpoch = resourceApplyEpoch
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
    if (!isStableCommandId(lorebookId)) return
    const lorebook = ((getDatabase().loreBook ?? []) as GlobalLorebook[]).find(
      (candidate) => candidate.id === lorebookId,
    )
    if (lorebook && hasStableUniqueLorebookEntryIds(lorebook.data)) {
      queueWatchedLorebookReplacement({ kind: 'global', lorebookId }, lorebook.data, previous, delayMs)
    }
    return
  }
  if (key.startsWith('globalMeta:')) {
    const lorebookId = key.slice('globalMeta:'.length)
    if (!isStableCommandId(lorebookId)) return
    const lorebook = ((getDatabase().loreBook ?? []) as GlobalLorebook[]).find(
      (candidate) => candidate.id === lorebookId,
    )
    if (typeof lorebook?.name === 'string') dispatchUpdateGlobalLorebook(lorebookId, { name: lorebook.name }, previous)
    return
  }
  if (key.startsWith('character:')) {
    const characterId = key.slice('character:'.length)
    if (!isStableCommandId(characterId)) return
    // Hard guard (defence in depth): never persist a non-hydrated character's
    // globalLore, even if a snapshot somehow slipped through.
    if (!hydratedCharacterLorebooks.has(characterId)) return
    const character = getDatabase().characters?.find((candidate) => candidate.chaId === characterId)
    if (character && hasStableUniqueLorebookEntryIds(character.globalLore)) {
      queueWatchedLorebookReplacement({ kind: 'character', characterId }, character.globalLore, previous, delayMs)
    }
    return
  }
  if (key.startsWith('chat:')) {
    const chatId = key.slice('chat:'.length)
    if (!isStableCommandId(chatId)) return
    const chat = findChat(chatId)
    if (chat && hasStableUniqueLorebookEntryIds(chat.localLore)) {
      queueWatchedLorebookReplacement({ kind: 'chat', chatId }, chat.localLore, previous, delayMs)
    }
    return
  }
  if (key.startsWith('module:')) {
    const moduleId = key.slice('module:'.length)
    if (!isStableCommandId(moduleId)) return
    const module = ((getDatabase().modules ?? []) as RisuModule[]).find((candidate) => candidate.id === moduleId)
    if (module && hasStableUniqueLorebookEntryIds(module.lorebook)) {
      queueWatchedLorebookReplacement({ kind: 'module', moduleId }, module.lorebook, previous, delayMs)
    }
  }
}

function queueWatchedLorebookReplacement(
  scope: DiscreteLorebookEditScope,
  entries: loreBook[],
  previous: LorebookStateSnapshot,
  delayMs: number,
): void {
  if (!hasStableUniqueLorebookEntryIds(entries)) return
  queueScopedLorebookReplacement(scope, entries, previous, delayMs, 'watchedCollection')
}

/**
 * Build the change-detection snapshot map for the watcher's scope. Exported for
 * the clone-cost regression test, which asserts a scoped fire covers only the
 * mounting panel's collection (O(panel scope)) instead of every chat of every
 * character and every module (O(all lore in the DB)). Malformed collections
 * without stable command IDs are left out of the watcher baseline.
 */
export function collectLorebookCollectionSnapshots(scope: LorebookWatchScope): Map<string, string> {
  const snapshots = new Map<string, string>()

  if (scope.kind === 'all' || scope.kind === 'global') {
    const lorebooks = (getDatabase().loreBook ?? []) as GlobalLorebook[]
    const stableGlobalLorebookIds = uniqueStableGlobalLorebookIds(lorebooks)
    for (const lorebook of lorebooks) {
      if (lorebook.id && stableGlobalLorebookIds.has(lorebook.id)) {
        if (hasStableUniqueLorebookEntryIds(lorebook.data)) {
          snapshots.set(`global:${lorebook.id}`, snapshotJson(lorebook.data))
        }
        snapshots.set(`globalMeta:${lorebook.id}`, snapshotJson({ name: lorebook.name }))
      }
    }
  }

  if (scope.kind === 'all') {
    for (const character of getDatabase().characters ?? []) {
      collectCharacterLorebookSnapshots(snapshots, character)
    }
  } else if (scope.kind === 'character') {
    // Track only the selected character's lore. Reading the $state mirror (not a
    // bare get()) re-runs the effect on a character switch, so the first edit to
    // the newly selected character is never dropped.
    const character = getDatabase().characters?.[selectedCharMirror]
    if (character) {
      collectCharacterLorebookSnapshots(snapshots, character, characterScopeLocalLoreSnapshots)
    }
  }

  if (scope.kind === 'all') {
    for (const module of (getDatabase().modules ?? []) as RisuModule[]) {
      collectModuleLorebookSnapshot(snapshots, module)
    }
  } else if (scope.kind === 'module') {
    const module = ((getDatabase().modules ?? []) as RisuModule[]).find((candidate) => candidate.id === scope.moduleId)
    if (module) collectModuleLorebookSnapshot(snapshots, module)
  }

  return snapshots
}

export type LorebookEntryDirtyField = keyof loreBook & string

export interface LorebookEntryDraftRollbackEvent {
  scopeKey: string
  entryId: string
  previousEntry: loreBook
  attemptedEntry: loreBook
  restoredFields: LorebookEntryDirtyField[]
}

export interface LorebookEntryDraftRollbackResult {
  draft: loreBook
  restoredFields: LorebookEntryDirtyField[]
}

type LorebookEntryDraftRollbackListener = (event: LorebookEntryDraftRollbackEvent) => void

const lorebookEntryDraftRollbackListeners = new Set<LorebookEntryDraftRollbackListener>()

export function subscribeLorebookEntryDraftRollbacks(listener: LorebookEntryDraftRollbackListener): () => void {
  lorebookEntryDraftRollbackListeners.add(listener)
  return () => lorebookEntryDraftRollbackListeners.delete(listener)
}

export function applyLorebookEntryDraftRollback(
  draft: loreBook,
  event: LorebookEntryDraftRollbackEvent,
  scopeKey: string | undefined,
): LorebookEntryDraftRollbackResult {
  if (!scopeKey || scopeKey !== event.scopeKey || draft.id !== event.entryId) {
    return { draft, restoredFields: [] }
  }
  const nextDraft = cloneJsonValue(draft)
  const restoredFields = restoreAttemptedLorebookEntryFields(
    nextDraft,
    event.previousEntry,
    event.attemptedEntry,
    event.restoredFields,
  )
  return { draft: restoredFields.length > 0 ? nextDraft : draft, restoredFields }
}

export function changedLorebookEntryDraftFields(
  previousEntry: loreBook,
  currentEntry: loreBook,
): LorebookEntryDirtyField[] {
  const previous = previousEntry as unknown as Record<string, unknown>
  const current = currentEntry as unknown as Record<string, unknown>
  const changedFields: LorebookEntryDirtyField[] = []
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)])

  for (const key of keys) {
    if (key === 'id') continue
    if (
      Object.prototype.hasOwnProperty.call(previous, key) !== Object.prototype.hasOwnProperty.call(current, key) ||
      snapshotJson(previous[key]) !== snapshotJson(current[key])
    ) {
      changedFields.push(key as LorebookEntryDirtyField)
    }
  }

  return changedFields
}

export function clearDirtyLorebookEntryFieldsMatchingProjection(
  dirtyFields: Set<LorebookEntryDirtyField>,
  draft: loreBook,
  projection: loreBook,
): void {
  const draftRecord = draft as unknown as Record<string, unknown>
  const projectionRecord = projection as unknown as Record<string, unknown>

  for (const field of Array.from(dirtyFields)) {
    if (snapshotJson(draftRecord[field]) === snapshotJson(projectionRecord[field])) {
      dirtyFields.delete(field)
    }
  }
}

export function mergeLorebookEntryProjectionDraft(
  draft: loreBook,
  projection: loreBook,
  dirtyFields: ReadonlySet<LorebookEntryDirtyField>,
): loreBook {
  return mergeProjectionIntoDirtyDraft({
    draft: cloneJsonValue(draft) as unknown as Record<string, unknown>,
    projection: projection as unknown as Record<string, unknown>,
    dirtyFields,
  }) as unknown as loreBook
}

function emitLorebookEntryDraftRollback(event: LorebookEntryDraftRollbackEvent): void {
  for (const listener of lorebookEntryDraftRollbackListeners) {
    try {
      listener(event)
    } catch (error) {
      console.warn('Lorebook entry draft rollback listener failed', error)
    }
  }
}

function restoreAttemptedLorebookEntryFields(
  target: loreBook,
  previousEntry: loreBook,
  attemptedEntry: loreBook,
  fields: readonly LorebookEntryDirtyField[],
): LorebookEntryDirtyField[] {
  const targetRecord = target as unknown as Record<string, unknown>
  const previousRecord = previousEntry as unknown as Record<string, unknown>
  const restoredFields: LorebookEntryDirtyField[] = []

  for (const field of fields) {
    if (!sameLorebookEntryFieldValue(target, attemptedEntry, field)) continue
    if (Object.prototype.hasOwnProperty.call(previousRecord, field)) {
      targetRecord[field] = cloneJsonValue(previousRecord[field])
    } else {
      delete targetRecord[field]
    }
    restoredFields.push(field)
  }
  return restoredFields
}

function sameLorebookEntryFieldValue(left: loreBook, right: loreBook, field: LorebookEntryDirtyField): boolean {
  const leftRecord = left as unknown as Record<string, unknown>
  const rightRecord = right as unknown as Record<string, unknown>
  return (
    Object.prototype.hasOwnProperty.call(leftRecord, field) ===
      Object.prototype.hasOwnProperty.call(rightRecord, field) &&
    snapshotJson(leftRecord[field]) === snapshotJson(rightRecord[field])
  )
}

function copyLorebookEntryFieldValue(target: loreBook, source: loreBook, field: LorebookEntryDirtyField): void {
  const targetRecord = target as unknown as Record<string, unknown>
  const sourceRecord = source as unknown as Record<string, unknown>
  if (Object.prototype.hasOwnProperty.call(sourceRecord, field)) {
    targetRecord[field] = cloneJsonValue(sourceRecord[field])
  } else {
    delete targetRecord[field]
  }
}

function collectCharacterLorebookSnapshots(
  snapshots: Map<string, string>,
  character: character,
  localLoreCache?: Map<string, LocalLoreSnapshotCacheEntry>,
): void {
  // Snapshot a character's globalLore ONLY when it is hydrated; a stubbed /
  // unhydrated character is never tracked, so a re-stub can't be diffed into
  // a deletion (the no-data-loss invariant).
  if (
    isStableCommandId(character.chaId) &&
    hydratedCharacterLorebooks.has(character.chaId) &&
    hasStableUniqueLorebookEntryIds(character.globalLore)
  ) {
    snapshots.set(`character:${character.chaId}`, snapshotJson(character.globalLore))
  }
  const liveChatIds = localLoreCache ? new Set<string>() : null
  for (const chat of character.chats ?? []) {
    if (!isStableCommandId(chat.id) || !hasStableUniqueLorebookEntryIds(chat.localLore)) continue
    liveChatIds?.add(chat.id)
    snapshots.set(`chat:${chat.id}`, snapshotChatLocalLore(chat.id, chat.localLore, localLoreCache))
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
  if (isStableCommandId(module.id) && hasStableUniqueLorebookEntryIds(module.lorebook)) {
    snapshots.set(`module:${module.id}`, snapshotJson(module.lorebook))
  }
}

function captureLorebookProjectionEpochs(scope: DiscreteLorebookEditScope): LorebookProjectionEpochs {
  switch (scope.kind) {
    case 'global':
      return { kind: 'global', collectionEpoch: captureCollectionProjectionEpoch('loreBook') }
    case 'character':
      return {
        kind: 'character',
        characterId: scope.characterId,
        rowEpoch: captureCharacterRowProjectionEpoch(scope.characterId),
        lorebookEpoch: captureCharacterLorebookProjectionEpoch(scope.characterId),
      }
    case 'chat': {
      const characterId = uniqueCharacterIdForChat(scope.chatId)
      return {
        kind: 'chat',
        chatId: scope.chatId,
        characterId,
        rowEpoch: characterId ? captureCharacterRowProjectionEpoch(characterId) : null,
      }
    }
    case 'module':
      return { kind: 'module' }
  }
}

function hasLorebookProjectionEpochChanged(epochs: LorebookProjectionEpochs): boolean {
  switch (epochs.kind) {
    case 'global':
      return hasCollectionProjectionEpochChanged('loreBook', epochs.collectionEpoch)
    case 'character':
      return (
        hasCharacterRowProjectionEpochChanged(epochs.characterId, epochs.rowEpoch) ||
        hasCharacterLorebookProjectionEpochChanged(epochs.characterId, epochs.lorebookEpoch)
      )
    case 'chat':
      return (
        !epochs.characterId ||
        epochs.rowEpoch === null ||
        hasCharacterRowProjectionEpochChanged(epochs.characterId, epochs.rowEpoch)
      )
    case 'module':
      return false
  }
}

function queueReplacement(
  key: string,
  previous: LorebookReplacementSnapshot,
  command: (
    previous: LorebookReplacementSnapshot,
    projectionEpochs: LorebookProjectionEpochs,
    options?: ServerCommandTransportOptions,
  ) => Promise<ServerCommandResult<Record<string, unknown>>>,
  delay: number,
  source: LorebookReplacementSource,
  projectionEpochs: LorebookProjectionEpochs,
  attemptedEntries: loreBook[],
): void {
  const existing = pendingReplacements.get(key)
  if (existing?.timer) clearTimeout(existing.timer)

  const existingProjectionIsCurrent = !!existing && !hasLorebookProjectionEpochChanged(existing.projectionEpochs)
  const useExisting =
    existingProjectionIsCurrent &&
    (isLorebookCollectionReplacementSource(existing?.source) ||
      (existing?.source === 'entry' && source === 'entry' && isLorebookEntryStateSnapshot(previous)))
  const effectivePrevious = useExisting ? existing.previous : previous
  const effectiveSource = useExisting && existing?.source === 'collection' ? 'collection' : source
  const effectiveProjectionEpochs = useExisting ? existing.projectionEpochs : projectionEpochs

  const pending: PendingCollectionReplacement = {
    key,
    previous: effectivePrevious,
    attemptedEntries,
    source: effectiveSource,
    projectionEpochs: effectiveProjectionEpochs,
    command: (options = {}) => command(effectivePrevious, effectiveProjectionEpochs, options),
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

function isLorebookCollectionReplacementSource(
  source: LorebookReplacementSource | undefined,
): source is 'collection' | 'watchedCollection' {
  return source === 'collection' || source === 'watchedCollection'
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
      if (key.startsWith('chat:')) {
        const chatId = key.slice('chat:'.length)
        const chat = findChat(chatId)
        if (chat) {
          characterScopeLocalLoreSnapshots.set(chatId, { entries: chat.localLore ?? [], snapshot })
        }
      }
    }
  }
  void pending.command(options)
}

function registerLorebookEntryAttempt(
  snapshot: LorebookReplacementSnapshot,
  attemptedEntries: loreBook[],
): PendingLorebookEntryAttempt | null {
  if (
    !isLorebookEntryStateSnapshot(snapshot) ||
    !snapshot.previousEntry ||
    !isStableCommandId(snapshot.entryId) ||
    snapshot.previousEntry.id !== snapshot.entryId
  ) {
    return null
  }

  const attemptedEntry = attemptedLorebookEntryForSnapshot(attemptedEntries, snapshot)
  if (!attemptedEntry || attemptedEntry.id !== snapshot.entryId) return null
  if (!sparseLorebookEntryUpdate(snapshot.previousEntry, attemptedEntry)) return null

  const attempt: PendingLorebookEntryAttempt = {
    sequence: ++nextLorebookEntryAttemptSequence,
    scopeKey: snapshot.scopeKey,
    entryId: snapshot.entryId,
    previous: snapshot,
    attemptedEntry: cloneJsonValue(attemptedEntry),
  }
  pendingLorebookEntryAttempts.push(attempt)
  return attempt
}

function rollbackLorebookEntryAttempt(attempt: PendingLorebookEntryAttempt): void {
  rollbackLorebookEntryByAttempt(attempt.previous, attempt.attemptedEntry)
  rebaseLaterLorebookEntryAttempts(attempt)
  clearLorebookEntryAttempt(attempt)
}

function rebaseLaterLorebookEntryAttempts(failed: PendingLorebookEntryAttempt): void {
  const failedPrevious = failed.previous.previousEntry
  if (!failedPrevious) return

  for (const field of changedLorebookEntryDraftFields(failedPrevious, failed.attemptedEntry)) {
    let rebased = false
    for (const later of pendingLorebookEntryAttempts) {
      const laterPrevious = later.previous.previousEntry
      if (
        later.sequence <= failed.sequence ||
        later.scopeKey !== failed.scopeKey ||
        later.entryId !== failed.entryId ||
        !laterPrevious
      ) {
        continue
      }
      if (!changedLorebookEntryDraftFields(laterPrevious, later.attemptedEntry).includes(field)) continue
      if (!sameLorebookEntryFieldValue(laterPrevious, failed.attemptedEntry, field)) continue
      copyLorebookEntryFieldValue(laterPrevious, failedPrevious, field)
      rebased = true
      break
    }

    if (rebased) continue
    const queued = pendingReplacements.get(failed.scopeKey)
    if (
      !queued ||
      queued.source !== 'entry' ||
      !isLorebookEntryStateSnapshot(queued.previous) ||
      queued.previous.entryId !== failed.entryId ||
      !queued.previous.previousEntry
    ) {
      continue
    }
    const queuedAttemptedEntry = attemptedLorebookEntryForSnapshot(queued.attemptedEntries, queued.previous)
    if (!queuedAttemptedEntry || queuedAttemptedEntry.id !== failed.entryId) continue
    if (!changedLorebookEntryDraftFields(queued.previous.previousEntry, queuedAttemptedEntry).includes(field)) continue
    if (!sameLorebookEntryFieldValue(queued.previous.previousEntry, failed.attemptedEntry, field)) continue
    copyLorebookEntryFieldValue(queued.previous.previousEntry, failedPrevious, field)
  }
}

function clearLorebookEntryAttempt(attempt: PendingLorebookEntryAttempt): void {
  const index = pendingLorebookEntryAttempts.findIndex((candidate) => candidate.sequence === attempt.sequence)
  if (index !== -1) pendingLorebookEntryAttempts.splice(index, 1)
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

function rollbackLorebookReplacement(
  scope: DiscreteLorebookEditScope,
  snapshot: LorebookReplacementSnapshot,
  attemptedEntries: loreBook[],
): void {
  if (isLorebookEntryStateSnapshot(snapshot)) {
    rollbackServerBackedLorebookEntry(snapshot, attemptedEntries)
    return
  }
  rollbackServerBackedLorebookCollection(scope, snapshot, attemptedEntries)
}

export function rollbackCharacterLorebookReplacement(
  characterId: string,
  snapshot: LorebookStateSnapshot,
  attemptedEntries: loreBook[],
): void {
  rollbackLorebookReplacement({ kind: 'character', characterId }, snapshot, attemptedEntries)
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

function rollbackGlobalLorebookListEntry(rollbackEntry: GlobalLorebookListRollbackEntry | null): void {
  if (!rollbackEntry) return
  if (!canApplyGlobalLorebookListRollback(rollbackEntry)) return
  const selectedLorebookId = currentSelectedGlobalLorebookId()

  withSuppressedLorebookWatcher(() => {
    withTrustedResourceWrite(() => {
      const lorebooks = mutableGlobalLorebookList()
      if (!canApplyGlobalLorebookListRollback(rollbackEntry, lorebooks)) return
      const rolledBack = applyAttemptedKeyedListRollback<GlobalLorebook, string>({
        list: lorebooks,
        entries: [rollbackEntry],
        getKey: globalLorebookKey,
      })
      if (rolledBack.length === 0) return
      getDatabase().loreBook = lorebooks as Database['loreBook']
      restoreGlobalLorebookSelectionById(selectedLorebookId)
    })
  })
}

function rollbackDeletedGlobalLorebook(
  rollbackEntry: GlobalLorebookListRollbackEntry | null,
  selectionRollback: GlobalLorebookSelectionRollback,
  options: { restoreRow: boolean; restoreSelection: boolean } = { restoreRow: true, restoreSelection: true },
): void {
  const shouldRestoreRow =
    options.restoreRow && rollbackEntry ? canApplyGlobalLorebookListRollback(rollbackEntry) : false
  const shouldRestoreSelection = options.restoreSelection && canApplyGlobalLorebookSelectionRollback(selectionRollback)
  if (!shouldRestoreRow && !shouldRestoreSelection) return

  const selectedLorebookId = currentSelectedGlobalLorebookId()
  let restoredRow = false

  if (shouldRestoreRow && rollbackEntry) {
    withTrustedResourceWrite(() => {
      const lorebooks = mutableGlobalLorebookList()
      const canRestoreRow = rollbackEntry ? canApplyGlobalLorebookListRollback(rollbackEntry, lorebooks) : false
      if (!canRestoreRow) return

      withSuppressedLorebookWatcher(() => {
        restoredRow =
          applyAttemptedKeyedListRollback<GlobalLorebook, string>({
            list: lorebooks,
            entries: [rollbackEntry],
            getKey: globalLorebookKey,
          }).length > 0
        if (restoredRow) getDatabase().loreBook = lorebooks as Database['loreBook']
      })
    })
  }

  withTrustedResourceWrite(() => {
    const canRestoreSelection = options.restoreSelection && canApplyGlobalLorebookSelectionRollback(selectionRollback)
    if (canRestoreSelection) {
      restoreGlobalLorebookSelection(selectionRollback)
    } else if (restoredRow) {
      restoreGlobalLorebookSelectionById(selectedLorebookId)
    }
  })
}

function canApplyGlobalLorebookListRollback(
  rollbackEntry: GlobalLorebookListRollbackEntry,
  lorebooks = (getDatabase().loreBook ?? []) as GlobalLorebook[],
): boolean {
  const liveIndex = lorebooks.findIndex((lorebook) => globalLorebookKey(lorebook) === rollbackEntry.key)
  const liveValue = liveIndex === -1 ? null : lorebooks[liveIndex]
  return snapshotJson(liveValue) === snapshotJson(rollbackEntry.attempted)
}

function rollbackGlobalLorebookName(rollback: GlobalLorebookNameRollback): void {
  if (!canApplyGlobalLorebookNameRollback(rollback)) return

  withSuppressedLorebookWatcher(() => {
    withTrustedResourceWrite(() => {
      const lorebooks = mutableGlobalLorebookList()
      if (!canApplyGlobalLorebookNameRollback(rollback, lorebooks)) return
      const lorebook = lorebooks.find((candidate) => candidate.id === rollback.lorebookId)
      if (!lorebook) return
      applyAttemptedFieldRollback({
        target: lorebook as unknown as Record<string, unknown>,
        previous: rollback.previous,
        attempted: rollback.attempted,
        keys: ['name'],
      })
    })
  })
}

function canApplyGlobalLorebookNameRollback(
  rollback: GlobalLorebookNameRollback,
  lorebooks = (getDatabase().loreBook ?? []) as GlobalLorebook[],
): boolean {
  if (!Object.prototype.hasOwnProperty.call(rollback.attempted, 'name')) return false
  if (!Object.prototype.hasOwnProperty.call(rollback.previous, 'name')) return false
  const lorebook = lorebooks.find((candidate) => candidate.id === rollback.lorebookId)
  return !!lorebook && snapshotJson(lorebook.name) === snapshotJson(rollback.attempted.name)
}

function rollbackGlobalLorebookOrder(rollback: GlobalLorebookOrderRollback): void {
  const liveIds = globalLorebookStableIds((getDatabase().loreBook ?? []) as GlobalLorebook[])
  if (!liveIds || !sameStringArray(liveIds, rollback.attemptedIds)) return
  const selectedLorebookId = currentSelectedGlobalLorebookId()

  withSuppressedLorebookWatcher(() => {
    withTrustedResourceWrite(() => {
      const lorebooks = mutableGlobalLorebookList()
      const currentIds = globalLorebookStableIds(lorebooks)
      if (!currentIds || !sameStringArray(currentIds, rollback.attemptedIds)) return

      const lorebooksById = new Map(lorebooks.map((lorebook) => [lorebook.id, lorebook]))
      const reordered = rollback.previousIds
        .map((lorebookId) => lorebooksById.get(lorebookId))
        .filter((lorebook): lorebook is GlobalLorebook => !!lorebook)
      if (reordered.length !== lorebooks.length) return

      lorebooks.splice(0, lorebooks.length, ...reordered)
      restoreGlobalLorebookSelectionById(selectedLorebookId)
    })
  })
}

function rollbackGlobalLorebookSelection(rollback: GlobalLorebookSelectionRollback): void {
  if (!canApplyGlobalLorebookSelectionRollback(rollback)) return

  withSuppressedLorebookWatcher(() => {
    withTrustedResourceWrite(() => {
      if (!canApplyGlobalLorebookSelectionRollback(rollback)) return
      restoreGlobalLorebookSelection(rollback)
    })
  })
}

function globalLorebookNameRollbackFromSnapshot(
  lorebookId: string,
  previous: LorebookStateSnapshot,
  attempted: Pick<GlobalLorebook, 'name'>,
): GlobalLorebookNameRollback {
  return {
    lorebookId,
    previous: previousGlobalLorebookNamePatch(lorebookId, previous),
    attempted: cloneJsonValue(attempted),
  }
}

function previousGlobalLorebookNamePatch(
  lorebookId: string,
  previous: LorebookStateSnapshot,
): Partial<Pick<GlobalLorebook, 'name'>> {
  if (previous.scopeKey === `globalMeta:${lorebookId}`) {
    const value = previous.scopedValue
    if (value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string') {
      return { name: (value as { name: string }).name }
    }
    return {}
  }

  const lorebook = previous.loreBook.find((candidate) => candidate.id === lorebookId)
  return typeof lorebook?.name === 'string' ? { name: lorebook.name } : {}
}

function globalLorebookSelectionRollbackFromSnapshot(
  previous: GlobalLorebookStateSnapshot,
  attemptedLorebookId = currentSelectedGlobalLorebookId(),
): GlobalLorebookSelectionRollback {
  const previousPage = previous.loreBookPage ?? 0
  const previousLorebookId = stableGlobalLorebookId(previous.loreBook[previousPage]?.id)
  const attemptedPage = getDatabase().loreBookPage ?? 0
  return {
    previousPage,
    previousLorebookId,
    attemptedPage,
    attemptedLorebookId: stableGlobalLorebookId(attemptedLorebookId),
  }
}

function canApplyGlobalLorebookSelectionRollback(rollback: GlobalLorebookSelectionRollback): boolean {
  if (rollback.attemptedLorebookId) {
    return currentSelectedGlobalLorebookId() === rollback.attemptedLorebookId
  }
  return (getDatabase().loreBookPage ?? 0) === rollback.attemptedPage
}

function restoreGlobalLorebookSelection(rollback: GlobalLorebookSelectionRollback): void {
  const lorebooks = (getDatabase().loreBook ?? []) as GlobalLorebook[]
  if (rollback.previousLorebookId) {
    restoreGlobalLorebookSelectionById(rollback.previousLorebookId)
    return
  }

  if (rollback.previousPage >= 0 && rollback.previousPage < lorebooks.length) {
    getDatabase().loreBookPage = rollback.previousPage
  }
}

function restoreGlobalLorebookSelectionById(lorebookId: string | null): void {
  if (!lorebookId) return
  const lorebooks = (getDatabase().loreBook ?? []) as GlobalLorebook[]
  const index = lorebooks.findIndex((lorebook) => lorebook.id === lorebookId)
  if (index >= 0) getDatabase().loreBookPage = index
}

function currentSelectedGlobalLorebookId(): string | null {
  const lorebooks = (getDatabase().loreBook ?? []) as GlobalLorebook[]
  const page = getDatabase().loreBookPage ?? 0
  return stableGlobalLorebookId(lorebooks[page]?.id)
}

function stableGlobalLorebookId(value: unknown): string | null {
  return isStableCommandId(value) ? value : null
}

function globalLorebookKey(lorebook: GlobalLorebook): string | null {
  return stableGlobalLorebookId(lorebook.id)
}

function globalLorebookStableIds(lorebooks: GlobalLorebook[]): string[] | null {
  const ids = lorebooks.map((lorebook) => lorebook.id)
  return hasStableUniqueCommandIds(ids) ? ids : null
}

function mutableGlobalLorebookList(): GlobalLorebook[] {
  if (!Array.isArray(getDatabase().loreBook)) {
    getDatabase().loreBook = [] as Database['loreBook']
  }
  return getDatabase().loreBook as GlobalLorebook[]
}

function rollbackServerBackedLorebookEntry(snapshot: LorebookEntryStateSnapshot, attemptedEntries?: loreBook[]): void {
  if (attemptedEntries) {
    const attemptedEntry = attemptedLorebookEntryForSnapshot(attemptedEntries, snapshot)
    if (!attemptedEntry) return
    rollbackLorebookEntryByAttempt(snapshot, attemptedEntry)
    return
  }

  withSuppressedLorebookWatcher(() => {
    restoreLorebookEntryState(snapshot)
  })
}

type LorebookListRollbackEntry = {
  key: string
  previous: loreBook | null
  attempted: loreBook | null
  previousIndex?: number
}

function rollbackServerBackedLorebookCollection(
  scope: DiscreteLorebookEditScope,
  snapshot: LorebookStateSnapshot,
  attemptedEntries: loreBook[],
): void {
  const previousEntries = previousLorebookEntriesForScope(scope, snapshot)
  if (!previousEntries) return

  const delta = detectLorebookCollectionDelta(previousEntries, attemptedEntries)
  if (delta) {
    switch (delta.type) {
      case 'upsert':
        rollbackLorebookCollectionUpsert(scope, previousEntries, delta.entry)
        return
      case 'delete':
        rollbackLorebookCollectionDelete(scope, previousEntries, delta.entryId)
        return
      case 'reorder':
        rollbackLorebookCollectionReorder(scope, lorebookEntryIds(previousEntries), delta.entryIds)
        return
    }
  }

  rollbackLorebookCollectionFullReplace(scope, previousEntries, attemptedEntries)
}

function rollbackLorebookEntryByAttempt(snapshot: LorebookEntryStateSnapshot, attemptedEntry: loreBook): void {
  const entryId =
    typeof attemptedEntry.id === 'string' && attemptedEntry.id.trim() ? attemptedEntry.id : snapshot.entryId
  if (!entryId) return
  if (snapshot.previousEntry) {
    const changedFields = changedLorebookEntryDraftFields(snapshot.previousEntry, attemptedEntry)
    if (changedFields.length === 0) return

    let restoredFields: LorebookEntryDirtyField[] = []
    withSuppressedLorebookWatcher(() => {
      withTrustedResourceWrite(() => {
        const target = resolveLorebookCollectionFromKey(snapshot.scopeKey)
        const liveEntry = target?.entries.find((entry) => entry.id === entryId)
        if (!liveEntry) return
        restoredFields = restoreAttemptedLorebookEntryFields(
          liveEntry,
          snapshot.previousEntry as loreBook,
          attemptedEntry,
          changedFields,
        )
      })
    })
    if (restoredFields.length > 0) {
      emitLorebookEntryDraftRollback({
        scopeKey: snapshot.scopeKey,
        entryId,
        previousEntry: cloneJsonValue(snapshot.previousEntry),
        attemptedEntry: cloneJsonValue(attemptedEntry),
        restoredFields,
      })
    }
    return
  }

  const rollbackEntry: LorebookListRollbackEntry = {
    key: entryId,
    previous: null,
    attempted: cloneJsonValue(attemptedEntry),
    previousIndex: snapshot.index,
  }
  applyScopedLorebookKeyedRollback(snapshot.scopeKey, rollbackEntry)
}

function rollbackLorebookCollectionUpsert(
  scope: DiscreteLorebookEditScope,
  previousEntries: loreBook[],
  attemptedEntry: loreBook,
): void {
  const entryId = attemptedEntry.id
  if (!isStableCommandId(entryId)) return

  const previousIndex = previousEntries.findIndex((entry) => entry.id === entryId)
  const previousEntry = previousIndex >= 0 ? previousEntries[previousIndex] : null
  const rollbackEntry: LorebookListRollbackEntry = {
    key: entryId,
    previous: previousEntry ? cloneJsonValue(previousEntry) : null,
    attempted: cloneJsonValue(attemptedEntry),
    previousIndex: previousIndex >= 0 ? previousIndex : undefined,
  }
  applyScopedLorebookKeyedRollback(lorebookCollectionScopeKey(scope), rollbackEntry)
}

function rollbackLorebookCollectionDelete(
  scope: DiscreteLorebookEditScope,
  previousEntries: loreBook[],
  entryId: string,
): void {
  if (!isStableCommandId(entryId)) return
  const previousIndex = previousEntries.findIndex((entry) => entry.id === entryId)
  if (previousIndex < 0) return
  const rollbackEntry: LorebookListRollbackEntry = {
    key: entryId,
    previous: cloneJsonValue(previousEntries[previousIndex]),
    attempted: null,
    previousIndex,
  }
  applyScopedLorebookKeyedRollback(lorebookCollectionScopeKey(scope), rollbackEntry)
}

function applyScopedLorebookKeyedRollback(scopeKey: string, rollbackEntry: LorebookListRollbackEntry): void {
  const target = resolveLorebookCollectionFromKey(scopeKey)
  if (!target || !canApplyLorebookKeyedRollback(target.entries, rollbackEntry)) return

  withSuppressedLorebookWatcher(() => {
    withTrustedResourceWrite(() => {
      const liveTarget = resolveLorebookCollectionFromKey(scopeKey)
      if (!liveTarget) return
      applyAttemptedKeyedListRollback<loreBook, string>({
        list: liveTarget.entries,
        entries: [rollbackEntry],
        getKey: lorebookEntryKey,
      })
    })
  })
}

function canApplyLorebookKeyedRollback(entries: loreBook[], rollbackEntry: LorebookListRollbackEntry): boolean {
  const liveIndex = entries.findIndex((entry) => lorebookEntryKey(entry) === rollbackEntry.key)
  const liveValue = liveIndex === -1 ? null : entries[liveIndex]
  return snapshotJson(liveValue) === snapshotJson(rollbackEntry.attempted)
}

function rollbackLorebookCollectionReorder(
  scope: DiscreteLorebookEditScope,
  previousIds: string[] | null,
  attemptedIds: string[],
): void {
  if (!previousIds) return
  const scopeKey = lorebookCollectionScopeKey(scope)
  const target = resolveLorebookCollectionFromKey(scopeKey)
  const liveIds = target ? lorebookEntryIds(target.entries) : null
  if (!liveIds || !sameStringArray(liveIds, attemptedIds)) return

  withSuppressedLorebookWatcher(() => {
    withTrustedResourceWrite(() => {
      const liveTarget = resolveLorebookCollectionFromKey(scopeKey)
      if (!liveTarget) return
      const currentIds = lorebookEntryIds(liveTarget.entries)
      if (!currentIds || !sameStringArray(currentIds, attemptedIds)) return

      const entriesById = new Map(liveTarget.entries.map((entry) => [entry.id, entry]))
      const reordered = previousIds
        .map((entryId) => entriesById.get(entryId))
        .filter((entry): entry is loreBook => !!entry)
      if (reordered.length !== liveTarget.entries.length) return
      liveTarget.entries.splice(0, liveTarget.entries.length, ...reordered)
    })
  })
}

function rollbackLorebookCollectionFullReplace(
  scope: DiscreteLorebookEditScope,
  previousEntries: loreBook[],
  attemptedEntries: loreBook[],
): void {
  const scopeKey = lorebookCollectionScopeKey(scope)
  const target = resolveLorebookCollectionFromKey(scopeKey)
  if (!target || snapshotJson(target.entries) !== snapshotJson(attemptedEntries)) return

  withSuppressedLorebookWatcher(() => {
    withTrustedResourceWrite(() => {
      const liveTarget = resolveLorebookCollectionFromKey(scopeKey)
      if (!liveTarget || snapshotJson(liveTarget.entries) !== snapshotJson(attemptedEntries)) return
      assignScopedLorebookCollection(scope, cloneJsonValue(previousEntries))
    })
  })
}

function attemptedLorebookEntryForSnapshot(
  attemptedEntries: loreBook[],
  snapshot: LorebookEntryStateSnapshot,
): loreBook | null {
  if (snapshot.entryId) {
    const byId = attemptedEntries.find((entry) => entry.id === snapshot.entryId)
    if (byId) return byId
  }
  return attemptedEntries[snapshot.index] ?? null
}

function previousLorebookEntriesForScope(
  scope: DiscreteLorebookEditScope,
  snapshot: LorebookStateSnapshot,
): loreBook[] | null {
  const scopeKey = lorebookCollectionScopeKey(scope)
  if (snapshot.scopeKey) {
    if (snapshot.scopeKey !== scopeKey || !Array.isArray(snapshot.scopedValue)) return null
    return cloneJsonValue(snapshot.scopedValue) as loreBook[]
  }

  switch (scope.kind) {
    case 'character': {
      const character = snapshot.characters.find((candidate) => candidate.chaId === scope.characterId)
      return Array.isArray(character?.globalLore) ? (cloneJsonValue(character.globalLore) as loreBook[]) : null
    }
    case 'chat': {
      for (const character of snapshot.characters) {
        const chat = character.chats?.find((candidate) => candidate.id === scope.chatId)
        if (chat) return Array.isArray(chat.localLore) ? (cloneJsonValue(chat.localLore) as loreBook[]) : null
      }
      return null
    }
    case 'global': {
      const lorebook = snapshot.loreBook.find((candidate) => candidate.id === scope.lorebookId)
      return Array.isArray(lorebook?.data) ? (cloneJsonValue(lorebook.data) as loreBook[]) : null
    }
    case 'module': {
      const module = snapshot.modules.find((candidate) => candidate.id === scope.moduleId)
      return Array.isArray(module?.lorebook) ? (cloneJsonValue(module.lorebook) as loreBook[]) : null
    }
  }
}

function assignScopedLorebookCollection(scope: DiscreteLorebookEditScope, entries: loreBook[]): boolean {
  switch (scope.kind) {
    case 'character': {
      const character = getDatabase().characters?.find((candidate) => candidate.chaId === scope.characterId)
      if (!character) return false
      character.globalLore = entries as typeof character.globalLore
      return true
    }
    case 'chat': {
      const chat = findChat(scope.chatId)
      if (!chat) return false
      chat.localLore = entries as typeof chat.localLore
      return true
    }
    case 'global': {
      const lorebook = ((getDatabase().loreBook ?? []) as GlobalLorebook[]).find(
        (candidate) => candidate.id === scope.lorebookId,
      )
      if (!lorebook) return false
      lorebook.data = entries
      return true
    }
    case 'module': {
      const module = findModule(scope.moduleId)
      if (!module) return false
      module.lorebook = entries as typeof module.lorebook
      return true
    }
  }
}

function lorebookEntryKey(entry: loreBook): string | null {
  return isStableCommandId(entry.id) ? entry.id : null
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
  for (const character of getDatabase().characters ?? []) {
    const chat = character.chats?.find((candidate) => candidate.id === chatId)
    if (chat) return chat
  }
  return null
}

function uniqueCharacterIdForChat(chatId: string): string | null {
  let characterId: string | null = null
  let matches = 0
  for (const character of getDatabase().characters ?? []) {
    for (const chat of character.chats ?? []) {
      if (chat.id !== chatId) continue
      matches += 1
      characterId = character.chaId
    }
  }
  return matches === 1 && isStableCommandId(characterId) ? characterId : null
}

function findModule(moduleId: string): RisuModule | null {
  return ((getDatabase().modules ?? []) as RisuModule[]).find((candidate) => candidate.id === moduleId) ?? null
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
    loreBookPage: getDatabase().loreBookPage ?? 0,
    characters: [],
    modules: [],
    selectedCharID: get(selectedCharID),
  }
}

export function restoreScopedLorebookState(snapshot: LorebookStateSnapshot): void {
  const key = snapshot.scopeKey
  if (!key) return

  withTrustedResourceWrite(() => {
    if (key.startsWith('global:')) {
      const lorebookId = key.slice('global:'.length)
      const lorebook = ((getDatabase().loreBook ?? []) as GlobalLorebook[]).find(
        (candidate) => candidate.id === lorebookId,
      )
      if (lorebook && Array.isArray(snapshot.scopedValue)) {
        lorebook.data = cloneJsonValue(snapshot.scopedValue) as loreBook[]
      }
      return
    }

    if (key.startsWith('globalMeta:')) {
      const lorebookId = key.slice('globalMeta:'.length)
      const lorebook = ((getDatabase().loreBook ?? []) as GlobalLorebook[]).find(
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
      const character = getDatabase().characters?.find((candidate) => candidate.chaId === characterId)
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
      const module = ((getDatabase().modules ?? []) as RisuModule[]).find((candidate) => candidate.id === moduleId)
      if (module && Array.isArray(snapshot.scopedValue)) {
        module.lorebook = cloneJsonValue(snapshot.scopedValue) as typeof module.lorebook
      }
    }
  })
}

export function restoreLorebookEntryState(snapshot: LorebookEntryStateSnapshot): void {
  withTrustedResourceWrite(() => {
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
