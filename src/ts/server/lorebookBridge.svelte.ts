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
  scopeKey?: string
  scopedValue?: unknown
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
  ensureAllClientLorebookIds()
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

// Global-lorebook select/create/delete only touch `loreBook` / `loreBookPage`, so
// they take the narrow `GlobalLorebookStateSnapshot` and roll back via
// `restoreGlobalLorebookState` — never the whole characters + modules clone the
// `LorebookStateSnapshot` carries. The full snapshot stays for the entry-replace
// dispatchers (which can mutate character/module/chat lore).
export function dispatchCreateGlobalLorebook(
  lorebook: GlobalLorebook,
  previous: GlobalLorebookStateSnapshot,
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
    rollback: () => restoreGlobalLorebookState(previous),
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
  previous: GlobalLorebookStateSnapshot,
): void {
  if (!canUseServerCommands()) return
  void runServerCommand({
    command: (baseRevision) =>
      deleteGlobalLorebookCommand({
        baseRevision,
        lorebookId,
      }),
    rollback: () => restoreGlobalLorebookState(previous),
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
  previous: GlobalLorebookStateSnapshot,
): void {
  if (!canUseServerCommands()) return
  void runServerCommand({
    command: (baseRevision) =>
      selectGlobalLorebookCommand({
        baseRevision,
        lorebookId,
      }),
    rollback: () => restoreGlobalLorebookState(previous),
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
  // Defense in depth: when stubs are on, never persist a non-hydrated character's
  // globalLore. `entries` would be the stub `[]` and delete the real server
  // entries. A real selected-character edit is safe after hydration on open.
  if (DBState.db?.enableLorebookStubs && !hydratedCharacterLorebooks.has(characterId)) return
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
  const scope: LorebookWatchScope = options.scope ?? { kind: 'all' }
  let initialized = false
  let clientIdsInitialized = false
  let previousSnapshots = new Map<string, string>()

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
      if (!clientIdsInitialized) {
        ensureAllClientLorebookIds()
        clientIdsInitialized = true
      }
      const currentSnapshots = collectLorebookCollectionSnapshots(scope)

      if (suppressRollbackDispatch || !initialized) {
        initialized = true
        previousSnapshots = currentSnapshots
        return
      }

      for (const [key, snapshot] of currentSnapshots) {
        const previousSnapshot = previousSnapshots.get(key)
        if (previousSnapshot === undefined) continue
        if (snapshot === previousSnapshots.get(key)) continue
        const previousState = scopedLorebookStateSnapshot(key, previousSnapshot)
        untrack(() => dispatchWatchedReplacement(key, previousState, delayMs))
      }

      previousSnapshots = currentSnapshots
    })
  })

  return () => {
    unsubscribeSelected?.()
    stop()
  }
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

/**
 * Build the change-detection snapshot map for the watcher's scope. Exported for
 * the clone-cost regression test, which asserts a scoped fire covers only the
 * mounting panel's collection (O(panel scope)) instead of every chat of every
 * character and every module (O(all lore in the DB)). The `all` branch is the
 * original whole-DB scan and is byte-for-byte identical to the previous code.
 */
export function collectLorebookCollectionSnapshots(
  scope: LorebookWatchScope,
): Map<string, string> {
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
    if (character) collectCharacterLorebookSnapshots(snapshots, character)
  }

  if (scope.kind === 'all') {
    for (const module of (DBState.db.modules ?? []) as RisuModule[]) {
      collectModuleLorebookSnapshot(snapshots, module)
    }
  } else if (scope.kind === 'module') {
    const module = ((DBState.db.modules ?? []) as RisuModule[]).find(
      (candidate) => candidate.id === scope.moduleId,
    )
    if (module) collectModuleLorebookSnapshot(snapshots, module)
  }

  return snapshots
}

function collectCharacterLorebookSnapshots(
  snapshots: Map<string, string>,
  character: character,
): void {
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

function collectModuleLorebookSnapshot(snapshots: Map<string, string>, module: RisuModule): void {
  if (module.id && Array.isArray(module.lorebook)) {
    snapshots.set(`module:${module.id}`, snapshotJson(module.lorebook))
  }
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

export function scopedLorebookStateSnapshot(
  key: string,
  previousSnapshot: string,
): LorebookStateSnapshot {
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
      const module = ((DBState.db.modules ?? []) as RisuModule[]).find(
        (candidate) => candidate.id === moduleId,
      )
      if (module && Array.isArray(snapshot.scopedValue)) {
        module.lorebook = cloneJsonValue(snapshot.scopedValue) as typeof module.lorebook
      }
    }
  })
}

function parseSnapshotJson(snapshot: string): unknown {
  if (snapshot === '__undefined__') return undefined
  return JSON.parse(snapshot)
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
