import { untrack } from 'svelte'
import { v4 } from 'uuid'
import type { RisuModule } from '../process/modules'
import { type Database, type character, type customscript, type triggerscript } from '../storage/database.svelte'
import { selectedCharID } from '../stores.svelte'
import {
  canUseServerCommands,
  replaceCharacterScriptsCommand,
  replaceCharacterTriggersCommand,
  replaceModuleScriptsCommand,
  replaceModuleTriggersCommand,
  runServerCommand,
  type ScriptDefinitionSnapshot,
  type ServerCommandResult,
  type ServerCommandTransportOptions,
  type TriggerDefinitionSnapshot,
} from './commands'
import { getServerResourceApplyEpoch, withTrustedResourceWrite } from './resourceWriteGuard.svelte'
import { getResourceDatabase as getDatabase } from './resourceState.svelte'
import { mergeProjectionIntoDirtyDraft } from './staleStateGuards'

export interface ScriptDefinitionStateSnapshot {
  characters: character[]
  modules: RisuModule[]
}

/**
 * A scoped rollback that restores only the changed row's scripts/triggers, used
 * by the watcher hot path so a failed replacement does not need the whole
 * characters+modules snapshot. The `scripts`/`triggers` value is the pre-edit
 * array (the collected per-key snapshots are always arrays, so an empty/missing
 * field restores to `[]`).
 */
export type ScopedScriptDefinitionRollback =
  | { kind: 'characterScripts'; characterId: string; scripts: customscript[]; hadScriptsField?: boolean }
  | { kind: 'characterTriggers'; characterId: string; triggers: triggerscript[]; hadTriggersField?: boolean }
  | { kind: 'moduleScripts'; moduleId: string; scripts: customscript[] }
  | { kind: 'moduleTriggers'; moduleId: string; triggers: triggerscript[] }

export type ScopedScriptDefinitionAttempt =
  | { kind: 'characterScripts'; characterId: string; scripts: customscript[] }
  | { kind: 'characterTriggers'; characterId: string; triggers: triggerscript[] }
  | { kind: 'moduleScripts'; moduleId: string; scripts: customscript[] }
  | { kind: 'moduleTriggers'; moduleId: string; triggers: triggerscript[] }

/**
 * Rollback accepted by the dispatch functions. The watcher passes a scoped
 * single-row rollback; the rarer discrete callers (module apply, MCP edits) keep
 * passing the full `ScriptDefinitionStateSnapshot`.
 */
export type ScriptDefinitionRollback = ScriptDefinitionStateSnapshot | ScopedScriptDefinitionRollback

interface PendingCollectionReplacement {
  key: string
  previous: ScriptDefinitionRollback
  timer: ReturnType<typeof setTimeout> | null
  // The command receives the coalesced rollback baseline at fire time rather than
  // closing over a per-dispatch value, so debounced same-key edits roll back to
  // the first baseline (see `queueReplacement`), not the intermediate one.
  command: (
    rollback: ScriptDefinitionRollback,
    options?: ServerCommandTransportOptions,
  ) => Promise<ServerCommandResult<Record<string, unknown>>>
}

const pendingReplacements = new Map<string, PendingCollectionReplacement>()
let suppressRollbackDispatch = false

// Mirror of the selected character id as $state so a `character`-scoped watcher
// re-runs (and re-subscribes to the newly selected character's scripts) when the
// user switches characters while the panel stays mounted. A bare
// `get(selectedCharID)` read would not re-run the effect on a switch, which could
// drop the first edit made to the newly selected character.
let selectedCharMirror = $state(-1)

/**
 * Restrict the watcher's change-detection scan to the mounting panel's rows so a
 * single script keystroke does not re-stringify every character's and module's
 * scripts/triggers on every reactive fire.
 *
 * - `all` (default): the original whole-DB scan (every character + every module).
 * - `character`: only the selected character's customscript/triggerscript (the
 *   CharConfig sidebar).
 * - `module`: only the open module's regex/trigger (the module `ModuleMenu`).
 */
export type ScriptDefinitionWatchScope = { kind: 'all' } | { kind: 'character' } | { kind: 'module'; moduleId: string }

export interface WatchServerBackedScriptDefinitionsOptions {
  delayMs?: number
  scope?: ScriptDefinitionWatchScope
}

export function currentScriptDefinitionStateSnapshot(): ScriptDefinitionStateSnapshot {
  return {
    characters: cloneJsonValue(getDatabase().characters ?? []),
    modules: cloneJsonValue((getDatabase().modules ?? []) as RisuModule[]),
  }
}

export function restoreScriptDefinitionState(snapshot: ScriptDefinitionStateSnapshot): void {
  withTrustedResourceWrite(() => {
    getDatabase().characters = cloneJsonValue(snapshot.characters)
    getDatabase().modules = cloneJsonValue(snapshot.modules) as Database['modules']
  })
}

export function applyCharacterScriptDefinitionDraft(
  characterId: string | null | undefined,
  scripts: customscript[],
  triggers: triggerscript[],
  delayMs = 250,
): boolean {
  if (!characterId) return false
  const character = getDatabase().characters?.find((candidate) => candidate.chaId === characterId)
  if (!character) return false

  const previousScripts = cloneJsonValue(character.customscript ?? [])
  const previousTriggers = cloneJsonValue(character.triggerscript ?? [])
  const hadScriptsField = Object.prototype.hasOwnProperty.call(character, 'customscript')
  const hadTriggersField = Object.prototype.hasOwnProperty.call(character, 'triggerscript')
  const nextScripts = ensureClientScriptDefinitionIds(cloneJsonValue(scripts))
  const nextTriggers = ensureClientTriggerDefinitionIds(cloneJsonValue(triggers))
  const scriptsChanged = snapshotJson(previousScripts) !== snapshotJson(nextScripts)
  const triggersChanged = snapshotJson(previousTriggers) !== snapshotJson(nextTriggers)
  let applied = false

  suppressRollbackDispatch = true
  withTrustedResourceWrite(() => {
    const target = getDatabase().characters?.find((candidate) => candidate.chaId === characterId)
    if (!target) return
    if (scriptsChanged || hadScriptsField) {
      target.customscript = cloneJsonValue(nextScripts)
    }
    if (triggersChanged || hadTriggersField) {
      target.triggerscript = cloneJsonValue(nextTriggers)
    }
    applied = true
  })
  queueMicrotask(() => {
    suppressRollbackDispatch = false
  })

  if (applied && scriptsChanged) {
    dispatchReplaceCharacterScripts(
      characterId,
      nextScripts,
      {
        kind: 'characterScripts',
        characterId,
        scripts: previousScripts,
        hadScriptsField,
      },
      delayMs,
    )
  }
  if (applied && triggersChanged) {
    dispatchReplaceCharacterTriggers(
      characterId,
      nextTriggers,
      {
        kind: 'characterTriggers',
        characterId,
        triggers: previousTriggers,
        hadTriggersField,
      },
      delayMs,
    )
  }
  return applied
}

export function applyModuleScriptDefinitionDraft(
  moduleId: string | null | undefined,
  currentModule: RisuModule | null | undefined,
  scripts: customscript[],
  triggers: triggerscript[],
  delayMs = 250,
): boolean {
  if (!moduleId) return false

  const liveModule = findModule(moduleId)
  const draftModule = currentModule?.id === moduleId ? currentModule : null
  if (!liveModule && !draftModule) return false

  const previousScripts = cloneJsonValue(liveModule?.regex ?? [])
  const previousTriggers = cloneJsonValue(liveModule?.trigger ?? [])
  const hadLiveScriptsField = liveModule ? Object.prototype.hasOwnProperty.call(liveModule, 'regex') : false
  const hadLiveTriggersField = liveModule ? Object.prototype.hasOwnProperty.call(liveModule, 'trigger') : false
  const hadDraftScriptsField = draftModule ? Object.prototype.hasOwnProperty.call(draftModule, 'regex') : false
  const hadDraftTriggersField = draftModule ? Object.prototype.hasOwnProperty.call(draftModule, 'trigger') : false
  const nextScripts = ensureClientScriptDefinitionIds(cloneJsonValue(scripts ?? []))
  const nextTriggers = ensureClientTriggerDefinitionIds(cloneJsonValue(triggers ?? []))
  const scriptsChanged = liveModule ? snapshotJson(previousScripts) !== snapshotJson(nextScripts) : false
  const triggersChanged = liveModule ? snapshotJson(previousTriggers) !== snapshotJson(nextTriggers) : false
  const shouldAssignScripts = scriptsChanged || hadLiveScriptsField || hadDraftScriptsField
  const shouldAssignTriggers = triggersChanged || hadLiveTriggersField || hadDraftTriggersField
  let applied = false

  suppressRollbackDispatch = true
  withTrustedResourceWrite(() => {
    const targetLiveModule = findModule(moduleId)
    const targetDraftModule = currentModule?.id === moduleId ? currentModule : null
    if (!targetLiveModule && !targetDraftModule) return

    if (targetLiveModule) {
      if (shouldAssignScripts) targetLiveModule.regex = cloneJsonValue(nextScripts)
      if (shouldAssignTriggers) targetLiveModule.trigger = cloneJsonValue(nextTriggers)
    }
    if (targetDraftModule) {
      if (shouldAssignScripts) targetDraftModule.regex = cloneJsonValue(nextScripts)
      if (shouldAssignTriggers) targetDraftModule.trigger = cloneJsonValue(nextTriggers)
    }
    applied = true
  })
  queueMicrotask(() => {
    suppressRollbackDispatch = false
  })

  if (!applied) return false

  if (liveModule && scriptsChanged) {
    dispatchReplaceModuleScripts(
      moduleId,
      nextScripts,
      {
        kind: 'moduleScripts',
        moduleId,
        scripts: previousScripts,
      },
      delayMs,
    )
  }
  if (liveModule && triggersChanged) {
    dispatchReplaceModuleTriggers(
      moduleId,
      nextTriggers,
      {
        kind: 'moduleTriggers',
        moduleId,
        triggers: previousTriggers,
      },
      delayMs,
    )
  }
  return true
}

export function ensureClientScriptDefinitionIds(scripts: customscript[]): customscript[] {
  for (const script of scripts ?? []) {
    script.id = typeof script.id === 'string' && script.id.trim() ? script.id : v4()
  }
  return scripts
}

export function ensureClientTriggerDefinitionIds(triggers: triggerscript[]): triggerscript[] {
  for (const trigger of triggers ?? []) {
    trigger.id = typeof trigger.id === 'string' && trigger.id.trim() ? trigger.id : v4()
  }
  return triggers
}

export function dispatchReplaceCharacterScripts(
  characterId: string,
  scripts: customscript[],
  previous: ScriptDefinitionRollback,
  delayMs = 250,
): void {
  if (!canUseServerCommands()) return
  ensureClientScriptDefinitionIds(scripts)
  const scriptPayload = cloneJsonValue(scripts) as ScriptDefinitionSnapshot[]
  const attemptedScripts = cloneJsonValue(scriptPayload) as customscript[]
  queueReplacement(
    `characterScripts:${characterId}`,
    previous,
    (rollback, options = {}) =>
      runServerCommand({
        command: (baseRevision) =>
          replaceCharacterScriptsCommand(
            {
              baseRevision,
              characterId,
              scripts: scriptPayload,
            },
            options.signal,
            options.keepalive,
          ),
        rollback: () =>
          rollbackServerBackedScriptDefinitions(rollback, {
            kind: 'characterScripts',
            characterId,
            scripts: attemptedScripts,
          }),
        signal: options.signal,
        keepalive: options.keepalive,
      }),
    delayMs,
  )
}

export function dispatchReplaceCharacterTriggers(
  characterId: string,
  triggers: triggerscript[],
  previous: ScriptDefinitionRollback,
  delayMs = 250,
): void {
  if (!canUseServerCommands()) return
  ensureClientTriggerDefinitionIds(triggers)
  const triggerPayload = cloneJsonValue(triggers) as TriggerDefinitionSnapshot[]
  const attemptedTriggers = cloneJsonValue(triggerPayload) as triggerscript[]
  queueReplacement(
    `characterTriggers:${characterId}`,
    previous,
    (rollback, options = {}) =>
      runServerCommand({
        command: (baseRevision) =>
          replaceCharacterTriggersCommand(
            {
              baseRevision,
              characterId,
              triggers: triggerPayload,
            },
            options.signal,
            options.keepalive,
          ),
        rollback: () =>
          rollbackServerBackedScriptDefinitions(rollback, {
            kind: 'characterTriggers',
            characterId,
            triggers: attemptedTriggers,
          }),
        signal: options.signal,
        keepalive: options.keepalive,
      }),
    delayMs,
  )
}

export function dispatchReplaceModuleScripts(
  moduleId: string,
  scripts: customscript[],
  previous: ScriptDefinitionRollback,
  delayMs = 250,
): void {
  if (!canUseServerCommands()) return
  ensureClientScriptDefinitionIds(scripts)
  const scriptPayload = cloneJsonValue(scripts) as ScriptDefinitionSnapshot[]
  const attemptedScripts = cloneJsonValue(scriptPayload) as customscript[]
  queueReplacement(
    `moduleScripts:${moduleId}`,
    previous,
    (rollback, options = {}) =>
      runServerCommand({
        command: (baseRevision) =>
          replaceModuleScriptsCommand(
            {
              baseRevision,
              moduleId,
              scripts: scriptPayload,
            },
            options.signal,
            options.keepalive,
          ),
        rollback: () =>
          rollbackServerBackedScriptDefinitions(rollback, {
            kind: 'moduleScripts',
            moduleId,
            scripts: attemptedScripts,
          }),
        signal: options.signal,
        keepalive: options.keepalive,
      }),
    delayMs,
  )
}

export function dispatchReplaceModuleTriggers(
  moduleId: string,
  triggers: triggerscript[],
  previous: ScriptDefinitionRollback,
  delayMs = 250,
): void {
  if (!canUseServerCommands()) return
  ensureClientTriggerDefinitionIds(triggers)
  const triggerPayload = cloneJsonValue(triggers) as TriggerDefinitionSnapshot[]
  const attemptedTriggers = cloneJsonValue(triggerPayload) as triggerscript[]
  queueReplacement(
    `moduleTriggers:${moduleId}`,
    previous,
    (rollback, options = {}) =>
      runServerCommand({
        command: (baseRevision) =>
          replaceModuleTriggersCommand(
            {
              baseRevision,
              moduleId,
              triggers: triggerPayload,
            },
            options.signal,
            options.keepalive,
          ),
        rollback: () =>
          rollbackServerBackedScriptDefinitions(rollback, {
            kind: 'moduleTriggers',
            moduleId,
            triggers: attemptedTriggers,
          }),
        signal: options.signal,
        keepalive: options.keepalive,
      }),
    delayMs,
  )
}

export function watchServerBackedScriptDefinitions(
  options: WatchServerBackedScriptDefinitionsOptions = {},
): () => void {
  if (!canUseServerCommands()) return () => {}
  const delayMs = options.delayMs ?? 300
  const scope: ScriptDefinitionWatchScope = options.scope ?? { kind: 'all' }
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
      // The per-key stringify map is the only change-detection input and the only
      // per-fire clone: each value is one row's small scripts/triggers array, not
      // the whole characters+modules graph (which carries hydrated histories).
      const currentSnapshots = collectScriptDefinitionCollectionSnapshots(scope)

      if (suppressRollbackDispatch || !initialized || resourceApplyEpoch !== previousResourceApplyEpoch) {
        initialized = true
        previousResourceApplyEpoch = resourceApplyEpoch
        previousSnapshots = currentSnapshots
        return
      }

      for (const [key, snapshot] of currentSnapshots) {
        const previousSnapshot = previousSnapshots.get(key)
        if (previousSnapshot === undefined) continue
        if (snapshot === previousSnapshot) continue
        // Build the rollback lazily from the prior per-key snapshot string, so a
        // failed replacement restores only this row — no whole-collection clone.
        untrack(() => dispatchWatchedReplacement(key, previousSnapshot, delayMs))
      }

      previousSnapshots = currentSnapshots
    })
  })

  return () => {
    flushPendingServerBackedScriptDefinitionPatches()
    unsubscribeSelected?.()
    stop()
  }
}

function dispatchWatchedReplacement(key: string, previousSnapshot: string, delayMs: number): void {
  if (key.startsWith('characterScripts:')) {
    const characterId = key.slice('characterScripts:'.length)
    if (currentCharacterScriptsForWatchedCommand(characterId)) {
      queueWatchedCharacterScripts(characterId, previousSnapshot, delayMs)
    }
    return
  }
  if (key.startsWith('characterTriggers:')) {
    const characterId = key.slice('characterTriggers:'.length)
    if (currentCharacterTriggersForWatchedCommand(characterId)) {
      queueWatchedCharacterTriggers(characterId, previousSnapshot, delayMs)
    }
    return
  }
  if (key.startsWith('moduleScripts:')) {
    const moduleId = key.slice('moduleScripts:'.length)
    if (currentModuleScriptsForWatchedCommand(moduleId)) {
      queueWatchedModuleScripts(moduleId, previousSnapshot, delayMs)
    }
    return
  }
  if (key.startsWith('moduleTriggers:')) {
    const moduleId = key.slice('moduleTriggers:'.length)
    if (currentModuleTriggersForWatchedCommand(moduleId)) {
      queueWatchedModuleTriggers(moduleId, previousSnapshot, delayMs)
    }
  }
}

/**
 * Build the change-detection snapshot map for the watcher's scope. Exported for
 * the clone-cost regression test, which asserts a scoped fire stringifies
 * only the mounting panel's rows (O(panel scope)) instead of every character's
 * and module's scripts/triggers (O(all scripts in the DB)). Collections without
 * stable scope IDs and stable unique script/trigger IDs are left out of the
 * watcher baseline.
 */
export function collectScriptDefinitionCollectionSnapshots(
  scope: ScriptDefinitionWatchScope = { kind: 'all' },
): Map<string, string> {
  const snapshots = new Map<string, string>()

  if (scope.kind === 'character') {
    // Track only the selected character's rows. Reading the $state mirror (not a
    // bare get()) re-runs the effect on a character switch, so the first edit to
    // the newly selected character is never dropped.
    const characters = getDatabase().characters ?? []
    const stableCharacterIds = uniqueStableCharacterIds(characters)
    const character = characters[selectedCharMirror]
    if (character?.chaId && stableCharacterIds.has(character.chaId)) {
      collectCharacterScriptDefinitionSnapshots(snapshots, character)
    }
    return snapshots
  }

  if (scope.kind === 'module') {
    const modules = (getDatabase().modules ?? []) as RisuModule[]
    const stableModuleIds = uniqueStableModuleIds(modules)
    const module = modules.find((candidate) => candidate.id === scope.moduleId)
    if (module?.id && stableModuleIds.has(module.id)) collectModuleScriptDefinitionSnapshots(snapshots, module)
    return snapshots
  }

  const stableCharacterIds = uniqueStableCharacterIds(getDatabase().characters ?? [])
  for (const character of getDatabase().characters ?? []) {
    if (character.chaId && stableCharacterIds.has(character.chaId)) {
      collectCharacterScriptDefinitionSnapshots(snapshots, character)
    }
  }
  const modules = (getDatabase().modules ?? []) as RisuModule[]
  const stableModuleIds = uniqueStableModuleIds(modules)
  for (const module of modules) {
    if (module.id && stableModuleIds.has(module.id)) {
      collectModuleScriptDefinitionSnapshots(snapshots, module)
    }
  }
  return snapshots
}

export type ScriptDefinitionDirtyFieldsById = Map<string, Set<string>>
type ScriptDefinitionRow = customscript | triggerscript
type ScriptDefinitionRowRecord = Record<string, unknown> & { id?: unknown }

export function markDirtyScriptDefinitionRowFields<T extends ScriptDefinitionRow>(
  dirtyFieldsById: ScriptDefinitionDirtyFieldsById,
  previousRows: T[],
  currentRows: T[],
): void {
  const previousRowsById = scriptDefinitionRowsById(previousRows)
  const currentRowIds = new Set<string>()

  for (const currentRow of currentRows ?? []) {
    const rowId = scriptDefinitionRowId(currentRow)
    if (!rowId) continue
    currentRowIds.add(rowId)

    const previousRow = previousRowsById.get(rowId)
    if (!previousRow) continue

    const changedFields = changedScriptDefinitionRowFields(previousRow, currentRow)
    if (changedFields.length === 0) continue

    let dirtyFields = dirtyFieldsById.get(rowId)
    if (!dirtyFields) {
      dirtyFields = new Set()
      dirtyFieldsById.set(rowId, dirtyFields)
    }

    for (const field of changedFields) {
      dirtyFields.add(field)
    }
  }

  pruneDirtyScriptDefinitionRows(dirtyFieldsById, currentRowIds)
}

export function clearDirtyScriptDefinitionFieldsMatchingProjection<T extends ScriptDefinitionRow>(
  dirtyFieldsById: ScriptDefinitionDirtyFieldsById,
  draftRows: T[],
  projectionRows: T[],
): void {
  const draftRowsById = scriptDefinitionRowsById(draftRows)
  const projectionRowsById = scriptDefinitionRowsById(projectionRows)

  for (const [rowId, dirtyFields] of Array.from(dirtyFieldsById.entries())) {
    const draftRow = draftRowsById.get(rowId)
    const projectionRow = projectionRowsById.get(rowId)

    if (!draftRow || !projectionRow) {
      dirtyFieldsById.delete(rowId)
      continue
    }

    const draftRecord = scriptDefinitionRowAsRecord(draftRow)
    const projectionRecord = scriptDefinitionRowAsRecord(projectionRow)
    for (const field of Array.from(dirtyFields)) {
      if (snapshotJson(draftRecord[field]) === snapshotJson(projectionRecord[field])) {
        dirtyFields.delete(field)
      }
    }

    if (dirtyFields.size === 0) {
      dirtyFieldsById.delete(rowId)
    }
  }
}

export function pruneDirtyScriptDefinitionRows(
  dirtyFieldsById: ScriptDefinitionDirtyFieldsById,
  currentRowIds: ReadonlySet<string>,
): void {
  for (const rowId of Array.from(dirtyFieldsById.keys())) {
    if (!currentRowIds.has(rowId)) {
      dirtyFieldsById.delete(rowId)
    }
  }
}

export function mergeScriptDefinitionProjectionRows<T extends ScriptDefinitionRow>(
  draftRows: T[],
  projectionRows: T[],
  dirtyFieldsById: ScriptDefinitionDirtyFieldsById,
): T[] | null {
  if (!sameUniqueScriptDefinitionRowIdSet(draftRows, projectionRows)) return null

  const draftRowsById = scriptDefinitionRowsById(draftRows)
  return projectionRows.map((projectionRow) => {
    const rowId = scriptDefinitionRowId(projectionRow)
    const dirtyFields = rowId ? dirtyFieldsById.get(rowId) : undefined
    const draftRow = rowId ? draftRowsById.get(rowId) : undefined

    if (!rowId || !dirtyFields || dirtyFields.size === 0 || !draftRow) {
      return cloneJsonValue(projectionRow)
    }

    return mergeProjectionIntoDirtyDraft({
      draft: cloneJsonValue(scriptDefinitionRowAsRecord(draftRow)),
      projection: scriptDefinitionRowAsRecord(projectionRow),
      dirtyFields,
    }) as T
  })
}

function changedScriptDefinitionRowFields<T extends ScriptDefinitionRow>(previousRow: T, currentRow: T): string[] {
  const previous = scriptDefinitionRowAsRecord(previousRow)
  const current = scriptDefinitionRowAsRecord(currentRow)
  const changedFields: string[] = []
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)])

  for (const key of keys) {
    if (key === 'id') continue
    if (snapshotJson(previous[key]) !== snapshotJson(current[key])) {
      changedFields.push(key)
    }
  }

  return changedFields
}

function sameUniqueScriptDefinitionRowIdSet<T extends ScriptDefinitionRow>(leftRows: T[], rightRows: T[]): boolean {
  if (leftRows.length !== rightRows.length) return false

  const leftIds = uniqueScriptDefinitionRowIdSet(leftRows)
  const rightIds = uniqueScriptDefinitionRowIdSet(rightRows)
  if (!leftIds || !rightIds || leftIds.size !== rightIds.size) return false

  for (const leftId of leftIds) {
    if (!rightIds.has(leftId)) return false
  }

  return true
}

function uniqueScriptDefinitionRowIdSet<T extends ScriptDefinitionRow>(rows: T[]): Set<string> | null {
  const rowIds = new Set<string>()
  for (const row of rows) {
    const rowId = scriptDefinitionRowId(row)
    if (!rowId || rowIds.has(rowId)) {
      return null
    }
    rowIds.add(rowId)
  }

  return rowIds
}

function scriptDefinitionRowsById<T extends ScriptDefinitionRow>(rows: T[]): Map<string, T> {
  const rowsById = new Map<string, T>()
  for (const row of rows ?? []) {
    const rowId = scriptDefinitionRowId(row)
    if (rowId) rowsById.set(rowId, row)
  }
  return rowsById
}

function scriptDefinitionRowId(row: ScriptDefinitionRow | undefined): string | null {
  const id = row ? scriptDefinitionRowAsRecord(row).id : null
  return typeof id === 'string' && id.trim() ? id : null
}

function scriptDefinitionRowAsRecord(row: ScriptDefinitionRow): ScriptDefinitionRowRecord {
  return row as unknown as ScriptDefinitionRowRecord
}

function collectCharacterScriptDefinitionSnapshots(snapshots: Map<string, string>, character: character): void {
  if (hasStableUniqueScriptDefinitionIds(character.customscript)) {
    snapshots.set(`characterScripts:${character.chaId}`, snapshotJson(character.customscript))
  }
  if (hasStableUniqueTriggerDefinitionIds(character.triggerscript)) {
    snapshots.set(`characterTriggers:${character.chaId}`, snapshotJson(character.triggerscript))
  }
}

function collectModuleScriptDefinitionSnapshots(snapshots: Map<string, string>, module: RisuModule): void {
  if (module.id && hasStableUniqueScriptDefinitionIds(module.regex)) {
    snapshots.set(`moduleScripts:${module.id}`, snapshotJson(module.regex))
  }
  if (module.id && hasStableUniqueTriggerDefinitionIds(module.trigger)) {
    snapshots.set(`moduleTriggers:${module.id}`, snapshotJson(module.trigger))
  }
}

function queueReplacement(
  key: string,
  previous: ScriptDefinitionRollback,
  command: (
    rollback: ScriptDefinitionRollback,
    options?: ServerCommandTransportOptions,
  ) => Promise<ServerCommandResult<Record<string, unknown>>>,
  delay: number,
): void {
  const existing = pendingReplacements.get(key)
  if (existing?.timer) clearTimeout(existing.timer)

  // Coalesced same-key edits keep the first dispatch's baseline, so a failed
  // final command rolls back to the pre-first-edit value rather than an
  // intermediate edit that was never durably committed.
  const pending: PendingCollectionReplacement = {
    key,
    previous: existing?.previous ?? previous,
    command,
    timer: null,
  }
  pending.timer = setTimeout(() => runPendingScriptDefinitionReplacement(key), delay)
  pendingReplacements.set(key, pending)
}

function queueWatchedCharacterScripts(characterId: string, previousSnapshot: string, delayMs: number): void {
  queueReplacement(
    `characterScripts:${characterId}`,
    {
      kind: 'characterScripts',
      characterId,
      scripts: parseSnapshotArray<customscript>(previousSnapshot),
    },
    (rollback, options = {}) => {
      const scripts = currentCharacterScriptsForWatchedCommand(characterId)
      if (!scripts) return Promise.resolve({ status: 'unavailable' })
      const scriptPayload = cloneJsonValue(scripts) as ScriptDefinitionSnapshot[]
      const attemptedScripts = cloneJsonValue(scriptPayload) as customscript[]
      return runServerCommand({
        command: (baseRevision) =>
          replaceCharacterScriptsCommand(
            {
              baseRevision,
              characterId,
              scripts: scriptPayload,
            },
            options.signal,
            options.keepalive,
          ),
        rollback: () =>
          rollbackServerBackedScriptDefinitions(rollback, {
            kind: 'characterScripts',
            characterId,
            scripts: attemptedScripts,
          }),
        signal: options.signal,
        keepalive: options.keepalive,
      })
    },
    delayMs,
  )
}

function queueWatchedCharacterTriggers(characterId: string, previousSnapshot: string, delayMs: number): void {
  queueReplacement(
    `characterTriggers:${characterId}`,
    {
      kind: 'characterTriggers',
      characterId,
      triggers: parseSnapshotArray<triggerscript>(previousSnapshot),
    },
    (rollback, options = {}) => {
      const triggers = currentCharacterTriggersForWatchedCommand(characterId)
      if (!triggers) return Promise.resolve({ status: 'unavailable' })
      const triggerPayload = cloneJsonValue(triggers) as TriggerDefinitionSnapshot[]
      const attemptedTriggers = cloneJsonValue(triggerPayload) as triggerscript[]
      return runServerCommand({
        command: (baseRevision) =>
          replaceCharacterTriggersCommand(
            {
              baseRevision,
              characterId,
              triggers: triggerPayload,
            },
            options.signal,
            options.keepalive,
          ),
        rollback: () =>
          rollbackServerBackedScriptDefinitions(rollback, {
            kind: 'characterTriggers',
            characterId,
            triggers: attemptedTriggers,
          }),
        signal: options.signal,
        keepalive: options.keepalive,
      })
    },
    delayMs,
  )
}

function queueWatchedModuleScripts(moduleId: string, previousSnapshot: string, delayMs: number): void {
  queueReplacement(
    `moduleScripts:${moduleId}`,
    {
      kind: 'moduleScripts',
      moduleId,
      scripts: parseSnapshotArray<customscript>(previousSnapshot),
    },
    (rollback, options = {}) => {
      const scripts = currentModuleScriptsForWatchedCommand(moduleId)
      if (!scripts) return Promise.resolve({ status: 'unavailable' })
      const scriptPayload = cloneJsonValue(scripts) as ScriptDefinitionSnapshot[]
      const attemptedScripts = cloneJsonValue(scriptPayload) as customscript[]
      return runServerCommand({
        command: (baseRevision) =>
          replaceModuleScriptsCommand(
            {
              baseRevision,
              moduleId,
              scripts: scriptPayload,
            },
            options.signal,
            options.keepalive,
          ),
        rollback: () =>
          rollbackServerBackedScriptDefinitions(rollback, {
            kind: 'moduleScripts',
            moduleId,
            scripts: attemptedScripts,
          }),
        signal: options.signal,
        keepalive: options.keepalive,
      })
    },
    delayMs,
  )
}

function queueWatchedModuleTriggers(moduleId: string, previousSnapshot: string, delayMs: number): void {
  queueReplacement(
    `moduleTriggers:${moduleId}`,
    {
      kind: 'moduleTriggers',
      moduleId,
      triggers: parseSnapshotArray<triggerscript>(previousSnapshot),
    },
    (rollback, options = {}) => {
      const triggers = currentModuleTriggersForWatchedCommand(moduleId)
      if (!triggers) return Promise.resolve({ status: 'unavailable' })
      const triggerPayload = cloneJsonValue(triggers) as TriggerDefinitionSnapshot[]
      const attemptedTriggers = cloneJsonValue(triggerPayload) as triggerscript[]
      return runServerCommand({
        command: (baseRevision) =>
          replaceModuleTriggersCommand(
            {
              baseRevision,
              moduleId,
              triggers: triggerPayload,
            },
            options.signal,
            options.keepalive,
          ),
        rollback: () =>
          rollbackServerBackedScriptDefinitions(rollback, {
            kind: 'moduleTriggers',
            moduleId,
            triggers: attemptedTriggers,
          }),
        signal: options.signal,
        keepalive: options.keepalive,
      })
    },
    delayMs,
  )
}

export function flushPendingServerBackedScriptDefinitionPatches(options: ServerCommandTransportOptions = {}): void {
  for (const key of Array.from(pendingReplacements.keys())) {
    runPendingScriptDefinitionReplacement(key, options)
  }
}

function runPendingScriptDefinitionReplacement(key: string, options: ServerCommandTransportOptions = {}): void {
  const pending = pendingReplacements.get(key)
  if (!pending) return
  if (pending.timer) clearTimeout(pending.timer)
  pendingReplacements.delete(key)
  void pending.command(pending.previous, options)
}

function rollbackServerBackedScriptDefinitions(
  rollback: ScriptDefinitionRollback,
  attempted?: ScopedScriptDefinitionAttempt,
): void {
  suppressRollbackDispatch = true
  let suppressUntilMicrotask = true
  try {
    if ('kind' in rollback) {
      const restored = restoreScopedScriptDefinition(rollback, attempted)
      if (!restored) {
        suppressRollbackDispatch = false
        suppressUntilMicrotask = false
      }
    } else {
      restoreScriptDefinitionState(rollback)
    }
  } finally {
    if (suppressUntilMicrotask) {
      queueMicrotask(() => {
        suppressRollbackDispatch = false
      })
    }
  }
}

export function rollbackScopedScriptDefinitionReplacement(
  rollback: ScopedScriptDefinitionRollback,
  attempted: ScopedScriptDefinitionAttempt,
): void {
  rollbackServerBackedScriptDefinitions(rollback, attempted)
}

// Restore only the changed row's scripts/triggers from a scoped rollback, leaving
// every other character/module untouched. The full-collection
// `restoreScriptDefinitionState` is reserved for the rarer discrete callers.
function restoreScopedScriptDefinition(
  rollback: ScopedScriptDefinitionRollback,
  attempted?: ScopedScriptDefinitionAttempt,
): boolean {
  return withTrustedResourceWrite(() => {
    switch (rollback.kind) {
      case 'characterScripts': {
        const character = getDatabase().characters?.find((candidate) => candidate.chaId === rollback.characterId)
        if (!character) return false
        if (
          attempted &&
          (attempted.kind !== 'characterScripts' ||
            attempted.characterId !== rollback.characterId ||
            snapshotJson(character.customscript) !== snapshotJson(attempted.scripts))
        ) {
          return false
        }
        if (rollback.hadScriptsField === false) {
          delete character.customscript
        } else {
          character.customscript = cloneJsonValue(rollback.scripts)
        }
        return true
      }
      case 'characterTriggers': {
        const character = getDatabase().characters?.find((candidate) => candidate.chaId === rollback.characterId)
        if (!character) return false
        if (
          attempted &&
          (attempted.kind !== 'characterTriggers' ||
            attempted.characterId !== rollback.characterId ||
            snapshotJson(character.triggerscript) !== snapshotJson(attempted.triggers))
        ) {
          return false
        }
        if (rollback.hadTriggersField === false) {
          delete character.triggerscript
        } else {
          character.triggerscript = cloneJsonValue(rollback.triggers)
        }
        return true
      }
      case 'moduleScripts': {
        const module = ((getDatabase().modules ?? []) as RisuModule[]).find(
          (candidate) => candidate.id === rollback.moduleId,
        )
        if (!module) return false
        if (
          attempted &&
          (attempted.kind !== 'moduleScripts' ||
            attempted.moduleId !== rollback.moduleId ||
            snapshotJson(module.regex) !== snapshotJson(attempted.scripts))
        ) {
          return false
        }
        module.regex = cloneJsonValue(rollback.scripts)
        return true
      }
      case 'moduleTriggers': {
        const module = ((getDatabase().modules ?? []) as RisuModule[]).find(
          (candidate) => candidate.id === rollback.moduleId,
        )
        if (!module) return false
        if (
          attempted &&
          (attempted.kind !== 'moduleTriggers' ||
            attempted.moduleId !== rollback.moduleId ||
            snapshotJson(module.trigger) !== snapshotJson(attempted.triggers))
        ) {
          return false
        }
        module.trigger = cloneJsonValue(rollback.triggers)
        return true
      }
    }
  })
}

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

// Parse a per-key snapshot string back into the pre-edit scripts/triggers array.
// Watched snapshots stringify arrays only; a non-array or `'__undefined__'`
// marker restores to `[]` defensively.
function parseSnapshotArray<T>(snapshot: string): T[] {
  if (snapshot === '__undefined__') return []
  const parsed = JSON.parse(snapshot) as unknown
  return Array.isArray(parsed) ? (parsed as T[]) : []
}

function currentCharacterScriptsForWatchedCommand(characterId: string): customscript[] | null {
  if (!uniqueStableCharacterIds(getDatabase().characters ?? []).has(characterId)) return null
  const character = getDatabase().characters?.find((candidate) => candidate.chaId === characterId)
  if (!character || !hasStableUniqueScriptDefinitionIds(character.customscript)) return null
  return character.customscript
}

function currentCharacterTriggersForWatchedCommand(characterId: string): triggerscript[] | null {
  if (!uniqueStableCharacterIds(getDatabase().characters ?? []).has(characterId)) return null
  const character = getDatabase().characters?.find((candidate) => candidate.chaId === characterId)
  if (!character || !hasStableUniqueTriggerDefinitionIds(character.triggerscript)) return null
  return character.triggerscript
}

function currentModuleScriptsForWatchedCommand(moduleId: string): customscript[] | null {
  const modules = (getDatabase().modules ?? []) as RisuModule[]
  if (!uniqueStableModuleIds(modules).has(moduleId)) return null
  const module = modules.find((candidate) => candidate.id === moduleId)
  if (!module || !hasStableUniqueScriptDefinitionIds(module.regex)) return null
  return module.regex
}

function currentModuleTriggersForWatchedCommand(moduleId: string): triggerscript[] | null {
  const modules = (getDatabase().modules ?? []) as RisuModule[]
  if (!uniqueStableModuleIds(modules).has(moduleId)) return null
  const module = modules.find((candidate) => candidate.id === moduleId)
  if (!module || !hasStableUniqueTriggerDefinitionIds(module.trigger)) return null
  return module.trigger
}

function findModule(moduleId: string): RisuModule | undefined {
  return ((getDatabase().modules ?? []) as RisuModule[]).find((candidate) => candidate.id === moduleId)
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

function hasStableUniqueScriptDefinitionIds(scripts: unknown): scripts is customscript[] {
  if (!Array.isArray(scripts)) return false
  return hasStableUniqueCommandIds(scripts.map((script) => (script as { id?: unknown }).id))
}

function hasStableUniqueTriggerDefinitionIds(triggers: unknown): triggers is triggerscript[] {
  if (!Array.isArray(triggers)) return false
  return hasStableUniqueCommandIds(triggers.map((trigger) => (trigger as { id?: unknown }).id))
}

function uniqueStableCharacterIds(characters: readonly character[]): Set<string> {
  const counts = new Map<string, number>()
  for (const character of characters) {
    if (!isStableCommandId(character.chaId)) continue
    counts.set(character.chaId, (counts.get(character.chaId) ?? 0) + 1)
  }
  return new Set([...counts].filter(([, count]) => count === 1).map(([id]) => id))
}

function uniqueStableModuleIds(modules: readonly RisuModule[]): Set<string> {
  const counts = new Map<string, number>()
  for (const module of modules) {
    if (!isStableCommandId(module.id)) continue
    counts.set(module.id, (counts.get(module.id) ?? 0) + 1)
  }
  return new Set([...counts].filter(([, count]) => count === 1).map(([id]) => id))
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
