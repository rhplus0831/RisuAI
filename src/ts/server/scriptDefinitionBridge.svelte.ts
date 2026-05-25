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

export interface ScriptDefinitionStateSnapshot {
  characters: character[]
  modules: RisuModule[]
}

interface PendingCollectionReplacement {
  key: string
  previous: ScriptDefinitionStateSnapshot
  timer: ReturnType<typeof setTimeout> | null
  command: () => Promise<ServerCommandResult<Record<string, unknown>>>
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
  DBState.db.characters = cloneJsonValue(snapshot.characters)
  DBState.db.modules = cloneJsonValue(snapshot.modules) as typeof DBState.db.modules
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
}

export function dispatchReplaceCharacterScripts(
  characterId: string,
  scripts: customscript[],
  previous: ScriptDefinitionStateSnapshot,
  delayMs = 250,
): void {
  if (!canUseServerCommands()) return
  ensureClientScriptDefinitionIds(scripts)
  queueReplacement(
    `characterScripts:${characterId}`,
    previous,
    () =>
      runServerCommand({
        command: (baseRevision) =>
          replaceCharacterScriptsCommand({
            baseRevision,
            characterId,
            scripts: cloneJsonValue(scripts) as ScriptDefinitionSnapshot[],
          }),
        rollback: () => rollbackServerBackedScriptDefinitions(previous),
      }),
    delayMs,
  )
}

export function dispatchReplaceCharacterTriggers(
  characterId: string,
  triggers: triggerscript[],
  previous: ScriptDefinitionStateSnapshot,
  delayMs = 250,
): void {
  if (!canUseServerCommands()) return
  ensureClientTriggerDefinitionIds(triggers)
  queueReplacement(
    `characterTriggers:${characterId}`,
    previous,
    () =>
      runServerCommand({
        command: (baseRevision) =>
          replaceCharacterTriggersCommand({
            baseRevision,
            characterId,
            triggers: cloneJsonValue(triggers) as TriggerDefinitionSnapshot[],
          }),
        rollback: () => rollbackServerBackedScriptDefinitions(previous),
      }),
    delayMs,
  )
}

export function dispatchReplaceModuleScripts(
  moduleId: string,
  scripts: customscript[],
  previous: ScriptDefinitionStateSnapshot,
  delayMs = 250,
): void {
  if (!canUseServerCommands()) return
  ensureClientScriptDefinitionIds(scripts)
  queueReplacement(
    `moduleScripts:${moduleId}`,
    previous,
    () =>
      runServerCommand({
        command: (baseRevision) =>
          replaceModuleScriptsCommand({
            baseRevision,
            moduleId,
            scripts: cloneJsonValue(scripts) as ScriptDefinitionSnapshot[],
          }),
        rollback: () => rollbackServerBackedScriptDefinitions(previous),
      }),
    delayMs,
  )
}

export function dispatchReplaceModuleTriggers(
  moduleId: string,
  triggers: triggerscript[],
  previous: ScriptDefinitionStateSnapshot,
  delayMs = 250,
): void {
  if (!canUseServerCommands()) return
  ensureClientTriggerDefinitionIds(triggers)
  queueReplacement(
    `moduleTriggers:${moduleId}`,
    previous,
    () =>
      runServerCommand({
        command: (baseRevision) =>
          replaceModuleTriggersCommand({
            baseRevision,
            moduleId,
            triggers: cloneJsonValue(triggers) as TriggerDefinitionSnapshot[],
          }),
        rollback: () => rollbackServerBackedScriptDefinitions(previous),
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
  let previousState = currentScriptDefinitionStateSnapshot()

  const stop = $effect.root(() => {
    $effect(() => {
      ensureAllClientScriptDefinitionIds()
      const currentState = currentScriptDefinitionStateSnapshot()
      const currentSnapshots = collectScriptDefinitionCollectionSnapshots()

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
  previous: ScriptDefinitionStateSnapshot,
  delayMs: number,
): void {
  if (key.startsWith('characterScripts:')) {
    const characterId = key.slice('characterScripts:'.length)
    const character = DBState.db.characters?.find((candidate) => candidate.chaId === characterId)
    if (character) {
      dispatchReplaceCharacterScripts(characterId, character.customscript ?? [], previous, delayMs)
    }
    return
  }
  if (key.startsWith('characterTriggers:')) {
    const characterId = key.slice('characterTriggers:'.length)
    const character = DBState.db.characters?.find((candidate) => candidate.chaId === characterId)
    if (character) {
      dispatchReplaceCharacterTriggers(
        characterId,
        character.triggerscript ?? [],
        previous,
        delayMs,
      )
    }
    return
  }
  if (key.startsWith('moduleScripts:')) {
    const moduleId = key.slice('moduleScripts:'.length)
    const module = ((DBState.db.modules ?? []) as RisuModule[]).find(
      (candidate) => candidate.id === moduleId,
    )
    if (module?.regex) dispatchReplaceModuleScripts(moduleId, module.regex, previous, delayMs)
    return
  }
  if (key.startsWith('moduleTriggers:')) {
    const moduleId = key.slice('moduleTriggers:'.length)
    const module = ((DBState.db.modules ?? []) as RisuModule[]).find(
      (candidate) => candidate.id === moduleId,
    )
    if (module?.trigger) dispatchReplaceModuleTriggers(moduleId, module.trigger, previous, delayMs)
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
  previous: ScriptDefinitionStateSnapshot,
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

function rollbackServerBackedScriptDefinitions(snapshot: ScriptDefinitionStateSnapshot): void {
  suppressRollbackDispatch = true
  try {
    restoreScriptDefinitionState(snapshot)
  } finally {
    queueMicrotask(() => {
      suppressRollbackDispatch = false
    })
  }
}

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
