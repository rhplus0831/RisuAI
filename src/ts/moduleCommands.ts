import {
  canUseServerCommands,
  createModuleCommand,
  deleteModuleCommand,
  enableModuleCommand,
  reorderCharacterModulesCommand,
  reorderModulesCommand,
  runServerCommand,
  updateModuleCommand,
  type ModuleSnapshot,
  type ServerCommandResult,
} from './server/commands'
import { DBState, ReloadGUIPointer } from './stores.svelte'
import type { RisuModule } from './process/modules'
import type { character } from './storage/database.svelte'

export interface ModuleStateSnapshot {
  modules: RisuModule[]
  enabledModules: string[]
  characters: character[]
}

const MODULE_PATCH_EXCLUDED_KEYS = new Set(['id', 'mcp', 'lorebook', 'regex', 'trigger'])

export function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export function currentModuleStateSnapshot(): ModuleStateSnapshot {
  return {
    modules: cloneJsonValue(DBState.db.modules ?? []),
    enabledModules: cloneJsonValue(DBState.db.enabledModules ?? []),
    characters: cloneJsonValue(DBState.db.characters ?? []),
  }
}

export function restoreModuleState(snapshot: ModuleStateSnapshot): void {
  DBState.db.modules = cloneJsonValue(snapshot.modules)
  DBState.db.enabledModules = cloneJsonValue(snapshot.enabledModules)
  DBState.db.characters = cloneJsonValue(snapshot.characters)
  ReloadGUIPointer.set(Math.random())
}

export function runModuleCommand<T extends Record<string, unknown>>(
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
  rollback: () => void,
): void {
  if (!canUseServerCommands()) return
  void runServerCommand({ command, rollback })
}

export function dispatchCreateModule(module: RisuModule, previous: ModuleStateSnapshot): void {
  runModuleCommand(
    (baseRevision) =>
      createModuleCommand({
        baseRevision,
        module: toModuleSnapshot(module),
      }),
    () => restoreModuleState(previous),
  )
}

export function dispatchUpdateModule(
  moduleId: string,
  patch: ModuleSnapshot,
  previous: ModuleStateSnapshot,
): void {
  const commandPatch = sanitizeModulePatch(patch)
  if (Object.keys(commandPatch).length === 0) return
  runModuleCommand(
    (baseRevision) =>
      updateModuleCommand({
        baseRevision,
        moduleId,
        patch: commandPatch,
      }),
    () => restoreModuleState(previous),
  )
}

export function dispatchDeleteModule(moduleId: string, previous: ModuleStateSnapshot): void {
  runModuleCommand(
    (baseRevision) =>
      deleteModuleCommand({
        baseRevision,
        moduleId,
      }),
    () => restoreModuleState(previous),
  )
}

export function dispatchEnableModule(
  moduleId: string,
  enabled: boolean,
  previous: ModuleStateSnapshot,
): void {
  runModuleCommand(
    (baseRevision) =>
      enableModuleCommand({
        baseRevision,
        moduleId,
        enabled,
      }),
    () => restoreModuleState(previous),
  )
}

export function dispatchReorderModules(previous: ModuleStateSnapshot): void {
  runModuleCommand(
    (baseRevision) =>
      reorderModulesCommand({
        baseRevision,
        moduleIds: (DBState.db.modules ?? []).map((module) => module.id),
      }),
    () => restoreModuleState(previous),
  )
}

export function dispatchReorderCharacterModules(
  characterId: string,
  previous: ModuleStateSnapshot,
): void {
  const character = DBState.db.characters?.find((candidate) => candidate.chaId === characterId)
  if (!character) return
  runModuleCommand(
    (baseRevision) =>
      reorderCharacterModulesCommand({
        baseRevision,
        characterId,
        moduleIds: character.modules ?? [],
      }),
    () => restoreModuleState(previous),
  )
}

export function toModuleSnapshot(module: RisuModule): ModuleSnapshot {
  return cloneJsonValue(module) as ModuleSnapshot
}

export function sanitizeModulePatch(patch: ModuleSnapshot): ModuleSnapshot {
  const sanitized: ModuleSnapshot = {}
  for (const [key, value] of Object.entries(patch)) {
    if (MODULE_PATCH_EXCLUDED_KEYS.has(key) || value === undefined) continue
    sanitized[key] = value
  }
  return sanitized
}
