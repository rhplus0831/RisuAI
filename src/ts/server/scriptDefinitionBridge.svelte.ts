import { untrack } from 'svelte'
import { v4 } from 'uuid'
import type { RisuModule } from '../process/modules'
import type { character, customscript, triggerscript } from '../storage/database.svelte'
import { DBState } from '../stores.svelte'
import {
  canUseServerCommands,
  replaceCharacterScriptsCommand,
  replaceCharacterTriggersCommand,
  replaceModuleScriptsCommand,
  replaceModuleTriggersCommand,
  runServerCommand,
  type ScriptDefinitionSnapshot,
  type ServerCommandResult,
  type TriggerDefinitionSnapshot,
} from './commands'
import {
  getServerProjectionApplyEpoch,
  withTrustedServerProjectionWrite,
} from './projectionWriteGuard.svelte'

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
  | { kind: 'characterScripts'; characterId: string; scripts: customscript[] }
  | { kind: 'characterTriggers'; characterId: string; triggers: triggerscript[] }
  | { kind: 'moduleScripts'; moduleId: string; scripts: customscript[] }
  | { kind: 'moduleTriggers'; moduleId: string; triggers: triggerscript[] }

/**
 * Rollback accepted by the dispatch functions. The watcher passes a scoped
 * single-row rollback; the rarer discrete callers (module apply, MCP edits) keep
 * passing the full `ScriptDefinitionStateSnapshot`.
 */
export type ScriptDefinitionRollback =
  | ScriptDefinitionStateSnapshot
  | ScopedScriptDefinitionRollback

interface PendingCollectionReplacement {
  key: string
  previous: ScriptDefinitionRollback
  timer: ReturnType<typeof setTimeout> | null
  // The command receives the coalesced rollback baseline at fire time rather than
  // closing over a per-dispatch value, so debounced same-key edits roll back to
  // the first baseline (see `queueReplacement`), not the intermediate one.
  command: (rollback: ScriptDefinitionRollback) => Promise<ServerCommandResult<Record<string, unknown>>>
}

const pendingReplacements = new Map<string, PendingCollectionReplacement>()
let suppressRollbackDispatch = false

export interface WatchServerBackedScriptDefinitionsOptions {
  delayMs?: number
}

export function currentScriptDefinitionStateSnapshot(): ScriptDefinitionStateSnapshot {
  ensureAllClientScriptDefinitionIds()
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

export function ensureAllClientScriptDefinitionIds(): void {
  let needsUpdate = false
  for (const character of DBState.db.characters ?? []) {
    needsUpdate ||= needsScriptDefinitionIds(character.customscript ?? [])
    needsUpdate ||= needsTriggerDefinitionIds(character.triggerscript ?? [])
    if (needsUpdate) break
  }
  if (!needsUpdate) {
    for (const module of (DBState.db.modules ?? []) as RisuModule[]) {
      if (Array.isArray(module.regex)) {
        needsUpdate ||= needsScriptDefinitionIds(module.regex)
      }
      if (Array.isArray(module.trigger)) {
        needsUpdate ||= needsTriggerDefinitionIds(module.trigger)
      }
      if (needsUpdate) break
    }
  }
  if (!needsUpdate) return

  withTrustedServerProjectionWrite(() => {
    for (const character of DBState.db.characters ?? []) {
      character.customscript = ensureClientScriptDefinitionIds(character.customscript ?? [])
      character.triggerscript = ensureClientTriggerDefinitionIds(character.triggerscript ?? [])
    }
    for (const module of (DBState.db.modules ?? []) as RisuModule[]) {
      if (Array.isArray(module.regex)) {
        module.regex = ensureClientScriptDefinitionIds(module.regex)
      }
      if (Array.isArray(module.trigger)) {
        module.trigger = ensureClientTriggerDefinitionIds(module.trigger)
      }
    }
  })
}

function needsScriptDefinitionIds(scripts: customscript[]): boolean {
  return (scripts ?? []).some((script) => !(typeof script.id === 'string' && script.id.trim()))
}

function needsTriggerDefinitionIds(triggers: triggerscript[]): boolean {
  return (triggers ?? []).some((trigger) => !(typeof trigger.id === 'string' && trigger.id.trim()))
}

export function dispatchReplaceCharacterScripts(
  characterId: string,
  scripts: customscript[],
  previous: ScriptDefinitionRollback,
  delayMs = 250,
): void {
  if (!canUseServerCommands()) return
  ensureClientScriptDefinitionIds(scripts)
  queueReplacement(
    `characterScripts:${characterId}`,
    previous,
    (rollback) =>
      runServerCommand({
        command: (baseRevision) =>
          replaceCharacterScriptsCommand({
            baseRevision,
            characterId,
            scripts: cloneJsonValue(scripts) as ScriptDefinitionSnapshot[],
          }),
        rollback: () => rollbackServerBackedScriptDefinitions(rollback),
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
  queueReplacement(
    `characterTriggers:${characterId}`,
    previous,
    (rollback) =>
      runServerCommand({
        command: (baseRevision) =>
          replaceCharacterTriggersCommand({
            baseRevision,
            characterId,
            triggers: cloneJsonValue(triggers) as TriggerDefinitionSnapshot[],
          }),
        rollback: () => rollbackServerBackedScriptDefinitions(rollback),
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
  queueReplacement(
    `moduleScripts:${moduleId}`,
    previous,
    (rollback) =>
      runServerCommand({
        command: (baseRevision) =>
          replaceModuleScriptsCommand({
            baseRevision,
            moduleId,
            scripts: cloneJsonValue(scripts) as ScriptDefinitionSnapshot[],
          }),
        rollback: () => rollbackServerBackedScriptDefinitions(rollback),
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
  queueReplacement(
    `moduleTriggers:${moduleId}`,
    previous,
    (rollback) =>
      runServerCommand({
        command: (baseRevision) =>
          replaceModuleTriggersCommand({
            baseRevision,
            moduleId,
            triggers: cloneJsonValue(triggers) as TriggerDefinitionSnapshot[],
          }),
        rollback: () => rollbackServerBackedScriptDefinitions(rollback),
      }),
    delayMs,
  )
}

export function watchServerBackedScriptDefinitions(
  options: WatchServerBackedScriptDefinitionsOptions = {},
): () => void {
  if (!canUseServerCommands()) return () => {}
  const delayMs = options.delayMs ?? 300
  let initialized = false
  let previousSnapshots = new Map<string, string>()
  let previousProjectionApplyEpoch = getServerProjectionApplyEpoch()

  const stop = $effect.root(() => {
    $effect(() => {
      const projectionApplyEpoch = getServerProjectionApplyEpoch()
      ensureAllClientScriptDefinitionIds()
      // The per-key stringify map is the only change-detection input and the only
      // per-fire clone: each value is one row's small scripts/triggers array, not
      // the whole characters+modules graph (which carries hydrated histories).
      const currentSnapshots = collectScriptDefinitionCollectionSnapshots()

      if (
        suppressRollbackDispatch ||
        !initialized ||
        projectionApplyEpoch !== previousProjectionApplyEpoch
      ) {
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

  return stop
}

function dispatchWatchedReplacement(
  key: string,
  previousSnapshot: string,
  delayMs: number,
): void {
  if (key.startsWith('characterScripts:')) {
    const characterId = key.slice('characterScripts:'.length)
    const character = DBState.db.characters?.find((candidate) => candidate.chaId === characterId)
    if (character) {
      dispatchReplaceCharacterScripts(characterId, character.customscript ?? [], {
        kind: 'characterScripts',
        characterId,
        scripts: parseSnapshotArray<customscript>(previousSnapshot),
      }, delayMs)
    }
    return
  }
  if (key.startsWith('characterTriggers:')) {
    const characterId = key.slice('characterTriggers:'.length)
    const character = DBState.db.characters?.find((candidate) => candidate.chaId === characterId)
    if (character) {
      dispatchReplaceCharacterTriggers(characterId, character.triggerscript ?? [], {
        kind: 'characterTriggers',
        characterId,
        triggers: parseSnapshotArray<triggerscript>(previousSnapshot),
      }, delayMs)
    }
    return
  }
  if (key.startsWith('moduleScripts:')) {
    const moduleId = key.slice('moduleScripts:'.length)
    const module = ((DBState.db.modules ?? []) as RisuModule[]).find(
      (candidate) => candidate.id === moduleId,
    )
    if (module?.regex) {
      dispatchReplaceModuleScripts(moduleId, module.regex, {
        kind: 'moduleScripts',
        moduleId,
        scripts: parseSnapshotArray<customscript>(previousSnapshot),
      }, delayMs)
    }
    return
  }
  if (key.startsWith('moduleTriggers:')) {
    const moduleId = key.slice('moduleTriggers:'.length)
    const module = ((DBState.db.modules ?? []) as RisuModule[]).find(
      (candidate) => candidate.id === moduleId,
    )
    if (module?.trigger) {
      dispatchReplaceModuleTriggers(moduleId, module.trigger, {
        kind: 'moduleTriggers',
        moduleId,
        triggers: parseSnapshotArray<triggerscript>(previousSnapshot),
      }, delayMs)
    }
  }
}

function collectScriptDefinitionCollectionSnapshots(): Map<string, string> {
  const snapshots = new Map<string, string>()
  for (const character of DBState.db.characters ?? []) {
    if (character.chaId) {
      snapshots.set(
        `characterScripts:${character.chaId}`,
        snapshotJson(character.customscript ?? []),
      )
      snapshots.set(
        `characterTriggers:${character.chaId}`,
        snapshotJson(character.triggerscript ?? []),
      )
    }
  }
  for (const module of (DBState.db.modules ?? []) as RisuModule[]) {
    if (module.id && Array.isArray(module.regex)) {
      snapshots.set(`moduleScripts:${module.id}`, snapshotJson(module.regex))
    }
    if (module.id && Array.isArray(module.trigger)) {
      snapshots.set(`moduleTriggers:${module.id}`, snapshotJson(module.trigger))
    }
  }
  return snapshots
}

function queueReplacement(
  key: string,
  previous: ScriptDefinitionRollback,
  command: (rollback: ScriptDefinitionRollback) => Promise<ServerCommandResult<Record<string, unknown>>>,
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
  pending.timer = setTimeout(() => {
    pendingReplacements.delete(key)
    void pending.command(pending.previous)
  }, delay)
  pendingReplacements.set(key, pending)
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
        const character = DBState.db.characters?.find(
          (candidate) => candidate.chaId === rollback.characterId,
        )
        if (character) character.customscript = cloneJsonValue(rollback.scripts)
        return
      }
      case 'characterTriggers': {
        const character = DBState.db.characters?.find(
          (candidate) => candidate.chaId === rollback.characterId,
        )
        if (character) character.triggerscript = cloneJsonValue(rollback.triggers)
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
// `collectScriptDefinitionCollectionSnapshots` always stringifies an array
// (`?? []`), so a non-array or `'__undefined__'` marker restores to `[]`.
function parseSnapshotArray<T>(snapshot: string): T[] {
  if (snapshot === '__undefined__') return []
  const parsed = JSON.parse(snapshot) as unknown
  return Array.isArray(parsed) ? (parsed as T[]) : []
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
