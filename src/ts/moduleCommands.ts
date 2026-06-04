import { currentChatScopedSnapshot, dispatchUpdateChatScoped } from './chatCommands'
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
import { withTrustedServerProjectionWrite } from './server/projectionWriteGuard.svelte'
import { DBState, ReloadGUIPointer, selectedCharID } from './stores.svelte'
import type { RisuModule } from './process/modules'
import type { character } from './storage/database.svelte'
import { get } from 'svelte/store'

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
  withTrustedServerProjectionWrite(() => {
    DBState.db.modules = cloneJsonValue(snapshot.modules)
    DBState.db.enabledModules = cloneJsonValue(snapshot.enabledModules)
    DBState.db.characters = cloneJsonValue(snapshot.characters)
    ReloadGUIPointer.set(Math.random())
  })
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

export function setGlobalModuleEnabled(moduleId: string, enabled: boolean): void {
  const previous = currentModuleStateSnapshot()
  if (canUseServerCommands()) {
    dispatchEnableModule(moduleId, enabled, previous)
    return
  }

  if (enabled) {
    if (!DBState.db.enabledModules.includes(moduleId)) {
      DBState.db.enabledModules.push(moduleId)
    }
  } else {
    DBState.db.enabledModules = DBState.db.enabledModules.filter((id) => id !== moduleId)
  }
  ReloadGUIPointer.set(Math.random())
}

export function createGlobalModule(module: RisuModule): void {
  const previous = currentModuleStateSnapshot()
  if (canUseServerCommands()) {
    dispatchCreateModule(module, previous)
    return
  }

  DBState.db.modules.push(module)
  ReloadGUIPointer.set(Math.random())
}

export function updateGlobalModule(moduleId: string, module: RisuModule): void {
  const previous = currentModuleStateSnapshot()
  if (canUseServerCommands()) {
    dispatchUpdateModule(moduleId, toModuleSnapshot(module), previous)
    return
  }

  const index = DBState.db.modules.findIndex((candidate) => candidate.id === moduleId)
  if (index !== -1) {
    DBState.db.modules[index] = module
    ReloadGUIPointer.set(Math.random())
  }
}

export function deleteGlobalModule(moduleId: string): void {
  const previous = currentModuleStateSnapshot()
  if (canUseServerCommands()) {
    dispatchDeleteModule(moduleId, previous)
    return
  }

  DBState.db.enabledModules = DBState.db.enabledModules.filter((id) => id !== moduleId)
  DBState.db.modules = DBState.db.modules.filter((module) => module.id !== moduleId)
  ReloadGUIPointer.set(Math.random())
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

export function toggleSelectedChatModule(moduleId: string): void {
  const selectedIndex = get(selectedCharID)
  const character = DBState.db.characters?.[selectedIndex]
  const chatIndex = character?.chatPage
  const chat = Number.isInteger(chatIndex) ? character?.chats?.[chatIndex] : undefined
  if (!chat?.id) return

  // Toggling a chat's module link mutates only the active chat row, so the
  // rollback needs just that one chat — not a deep clone of every character
  // with every hydrated history (L34).
  const previous = currentChatScopedSnapshot()
  const nextModules = toggledModuleIds(chat.modules, moduleId)

  withTrustedServerProjectionWrite(() => {
    const targetCharacter = DBState.db.characters?.[selectedIndex]
    const targetChat = Number.isInteger(chatIndex) ? targetCharacter?.chats?.[chatIndex] : undefined
    if (!targetChat || targetChat.id !== chat.id) return
    targetChat.modules = cloneJsonValue(nextModules)
  })

  dispatchUpdateChatScoped(chat.id, { modules: nextModules }, previous)
  ReloadGUIPointer.set(Math.random())
}

export function toggleSelectedCharacterModule(moduleId: string): void {
  const selectedIndex = get(selectedCharID)
  const character = DBState.db.characters?.[selectedIndex]
  if (!character?.chaId) return

  const previous = currentModuleStateSnapshot()
  const nextModules = toggledModuleIds(character.modules, moduleId)

  withTrustedServerProjectionWrite(() => {
    const targetCharacter = DBState.db.characters?.[selectedIndex]
    if (!targetCharacter || targetCharacter.chaId !== character.chaId) return
    targetCharacter.modules = cloneJsonValue(nextModules)
  })

  dispatchReorderCharacterModules(character.chaId, previous)
  ReloadGUIPointer.set(Math.random())
}

export function toggledModuleIds(
  current: readonly string[] | undefined,
  moduleId: string,
): string[] {
  const existing = current ?? []
  if (existing.includes(moduleId)) {
    return existing.filter((candidate) => candidate !== moduleId)
  }
  return [...existing, moduleId]
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
