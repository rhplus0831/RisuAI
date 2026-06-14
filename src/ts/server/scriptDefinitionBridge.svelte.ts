import { untrack } from 'svelte'
import { v4 } from 'uuid'
import type { RisuModule } from '../process/modules'
import type { character, customscript, triggerscript } from '../storage/database.svelte'
import { DBState, selectedCharID } from '../stores.svelte'
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
import { getServerProjectionApplyEpoch, withTrustedServerProjectionWrite } from './projectionWriteGuard.svelte'

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
    characters: cloneJsonValue(DBState.db.characters ?? []),
    modules: cloneJsonValue((DBState.db.modules ?? []) as RisuModule[]),
  }
}

export function restoreScriptDefinitionState(snapshot: ScriptDefinitionStateSnapshot): void {
  withTrustedServerProjectionWrite(() => {
    DBState.db.characters = cloneJsonValue(snapshot.characters)
    DBState.db.modules = cloneJsonValue(snapshot.modules) as typeof DBState.db.modules
  })
}

export function applyCharacterScriptDefinitionDraft(
  characterId: string | null | undefined,
  scripts: customscript[],
  triggers: triggerscript[],
  delayMs = 250,
): boolean {
  if (!characterId) return false
  const character = DBState.db.characters?.find((candidate) => candidate.chaId === characterId)
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
  withTrustedServerProjectionWrite(() => {
    const target = DBState.db.characters?.find((candidate) => candidate.chaId === characterId)
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
        rollback: () => rollbackServerBackedScriptDefinitions(rollback),
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
        rollback: () => rollbackServerBackedScriptDefinitions(rollback),
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
        rollback: () => rollbackServerBackedScriptDefinitions(rollback),
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
        rollback: () => rollbackServerBackedScriptDefinitions(rollback),
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
      // The per-key stringify map is the only change-detection input and the only
      // per-fire clone: each value is one row's small scripts/triggers array, not
      // the whole characters+modules graph (which carries hydrated histories).
      const currentSnapshots = collectScriptDefinitionCollectionSnapshots(scope)

      if (suppressRollbackDispatch || !initialized || projectionApplyEpoch !== previousProjectionApplyEpoch) {
        initialized = true
        previousProjectionApplyEpoch = projectionApplyEpoch
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
    const characters = DBState.db.characters ?? []
    const stableCharacterIds = uniqueStableCharacterIds(characters)
    const character = characters[selectedCharMirror]
    if (character?.chaId && stableCharacterIds.has(character.chaId)) {
      collectCharacterScriptDefinitionSnapshots(snapshots, character)
    }
    return snapshots
  }

  if (scope.kind === 'module') {
    const modules = (DBState.db.modules ?? []) as RisuModule[]
    const stableModuleIds = uniqueStableModuleIds(modules)
    const module = modules.find((candidate) => candidate.id === scope.moduleId)
    if (module?.id && stableModuleIds.has(module.id)) collectModuleScriptDefinitionSnapshots(snapshots, module)
    return snapshots
  }

  const stableCharacterIds = uniqueStableCharacterIds(DBState.db.characters ?? [])
  for (const character of DBState.db.characters ?? []) {
    if (character.chaId && stableCharacterIds.has(character.chaId)) {
      collectCharacterScriptDefinitionSnapshots(snapshots, character)
    }
  }
  const modules = (DBState.db.modules ?? []) as RisuModule[]
  const stableModuleIds = uniqueStableModuleIds(modules)
  for (const module of modules) {
    if (module.id && stableModuleIds.has(module.id)) {
      collectModuleScriptDefinitionSnapshots(snapshots, module)
    }
  }
  return snapshots
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
        rollback: () => rollbackServerBackedScriptDefinitions(rollback),
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
        rollback: () => rollbackServerBackedScriptDefinitions(rollback),
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
        rollback: () => rollbackServerBackedScriptDefinitions(rollback),
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
        rollback: () => rollbackServerBackedScriptDefinitions(rollback),
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

function rollbackServerBackedScriptDefinitions(rollback: ScriptDefinitionRollback): void {
  suppressRollbackDispatch = true
  try {
    if ('kind' in rollback) {
      restoreScopedScriptDefinition(rollback)
    } else {
      restoreScriptDefinitionState(rollback)
    }
  } finally {
    queueMicrotask(() => {
      suppressRollbackDispatch = false
    })
  }
}

// Restore only the changed row's scripts/triggers from a scoped rollback, leaving
// every other character/module untouched. The full-collection
// `restoreScriptDefinitionState` is reserved for the rarer discrete callers.
function restoreScopedScriptDefinition(rollback: ScopedScriptDefinitionRollback): void {
  withTrustedServerProjectionWrite(() => {
    switch (rollback.kind) {
      case 'characterScripts': {
        const character = DBState.db.characters?.find((candidate) => candidate.chaId === rollback.characterId)
        if (!character) return
        if (rollback.hadScriptsField === false) {
          delete character.customscript
        } else {
          character.customscript = cloneJsonValue(rollback.scripts)
        }
        return
      }
      case 'characterTriggers': {
        const character = DBState.db.characters?.find((candidate) => candidate.chaId === rollback.characterId)
        if (!character) return
        if (rollback.hadTriggersField === false) {
          delete character.triggerscript
        } else {
          character.triggerscript = cloneJsonValue(rollback.triggers)
        }
        return
      }
      case 'moduleScripts': {
        const module = ((DBState.db.modules ?? []) as RisuModule[]).find(
          (candidate) => candidate.id === rollback.moduleId,
        )
        if (module) module.regex = cloneJsonValue(rollback.scripts)
        return
      }
      case 'moduleTriggers': {
        const module = ((DBState.db.modules ?? []) as RisuModule[]).find(
          (candidate) => candidate.id === rollback.moduleId,
        )
        if (module) module.trigger = cloneJsonValue(rollback.triggers)
        return
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
  if (!uniqueStableCharacterIds(DBState.db.characters ?? []).has(characterId)) return null
  const character = DBState.db.characters?.find((candidate) => candidate.chaId === characterId)
  if (!character || !hasStableUniqueScriptDefinitionIds(character.customscript)) return null
  return character.customscript
}

function currentCharacterTriggersForWatchedCommand(characterId: string): triggerscript[] | null {
  if (!uniqueStableCharacterIds(DBState.db.characters ?? []).has(characterId)) return null
  const character = DBState.db.characters?.find((candidate) => candidate.chaId === characterId)
  if (!character || !hasStableUniqueTriggerDefinitionIds(character.triggerscript)) return null
  return character.triggerscript
}

function currentModuleScriptsForWatchedCommand(moduleId: string): customscript[] | null {
  const modules = (DBState.db.modules ?? []) as RisuModule[]
  if (!uniqueStableModuleIds(modules).has(moduleId)) return null
  const module = modules.find((candidate) => candidate.id === moduleId)
  if (!module || !hasStableUniqueScriptDefinitionIds(module.regex)) return null
  return module.regex
}

function currentModuleTriggersForWatchedCommand(moduleId: string): triggerscript[] | null {
  const modules = (DBState.db.modules ?? []) as RisuModule[]
  if (!uniqueStableModuleIds(modules).has(moduleId)) return null
  const module = modules.find((candidate) => candidate.id === moduleId)
  if (!module || !hasStableUniqueTriggerDefinitionIds(module.trigger)) return null
  return module.trigger
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
