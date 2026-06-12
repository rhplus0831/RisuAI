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
import { DBState, reloadGuiAfterDefinitionChange, selectedCharID } from './stores.svelte'
import type { RisuModule } from './process/modules'
import type { character } from './storage/database.svelte'
import { get } from 'svelte/store'

export interface GlobalModuleStateSnapshot {
  modules: RisuModule[]
  enabledModules: string[]
}

export interface CharacterModuleStateSnapshot {
  characterId: string
  hasModulesField: boolean
  modules: string[] | undefined
}

const MODULE_PATCH_EXCLUDED_KEYS = new Set(['id', 'mcp', 'lorebook', 'regex', 'trigger'])

export function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export function currentGlobalModuleStateSnapshot(): GlobalModuleStateSnapshot {
  return {
    modules: cloneJsonValue(DBState.db.modules ?? []),
    enabledModules: cloneJsonValue(DBState.db.enabledModules ?? []),
  }
}

export function restoreGlobalModuleState(snapshot: GlobalModuleStateSnapshot): void {
  withTrustedServerProjectionWrite(() => {
    DBState.db.modules = cloneJsonValue(snapshot.modules)
    DBState.db.enabledModules = cloneJsonValue(snapshot.enabledModules)
    reloadGuiAfterDefinitionChange()
  })
}

function findCharacterById(characterId: string): character | undefined {
  return DBState.db.characters?.find((candidate) => candidate.chaId === characterId)
}

export function currentCharacterModuleStateSnapshot(characterId: string): CharacterModuleStateSnapshot | null {
  const character = findCharacterById(characterId)
  if (!character) return null
  return {
    characterId,
    hasModulesField: Object.prototype.hasOwnProperty.call(character, 'modules'),
    modules: cloneJsonValue(character.modules),
  }
}

export function restoreCharacterModuleState(snapshot: CharacterModuleStateSnapshot): void {
  withTrustedServerProjectionWrite(() => {
    const character = findCharacterById(snapshot.characterId)
    if (!character) return
    if (snapshot.hasModulesField) {
      character.modules = cloneJsonValue(snapshot.modules)
    } else {
      delete character.modules
    }
    reloadGuiAfterDefinitionChange()
  })
}

export function runModuleCommand<T extends Record<string, unknown>>(
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
  rollback: () => void,
): void {
  if (!canUseServerCommands()) return
  void runServerCommand({ command, rollback })
}

export function dispatchCreateModule(module: RisuModule, previous: GlobalModuleStateSnapshot): void {
  runModuleCommand(
    (baseRevision) =>
      createModuleCommand({
        baseRevision,
        module: toModuleSnapshot(module),
      }),
    () => restoreGlobalModuleState(previous),
  )
}

export function dispatchUpdateModule(
  moduleId: string,
  patch: ModuleSnapshot,
  previous: GlobalModuleStateSnapshot,
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
    () => restoreGlobalModuleState(previous),
  )
}

export function dispatchDeleteModule(moduleId: string, previous: GlobalModuleStateSnapshot): void {
  runModuleCommand(
    (baseRevision) =>
      deleteModuleCommand({
        baseRevision,
        moduleId,
      }),
    () => restoreGlobalModuleState(previous),
  )
}

export function dispatchEnableModule(moduleId: string, enabled: boolean, previous: GlobalModuleStateSnapshot): void {
  runModuleCommand(
    (baseRevision) =>
      enableModuleCommand({
        baseRevision,
        moduleId,
        enabled,
      }),
    () => restoreGlobalModuleState(previous),
  )
}

export function setGlobalModuleEnabled(moduleId: string, enabled: boolean): void {
  if (canUseServerCommands()) {
    const previous = currentGlobalModuleStateSnapshot()
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
  reloadGuiAfterDefinitionChange()
}

export function createGlobalModule(module: RisuModule): void {
  if (canUseServerCommands()) {
    const previous = currentGlobalModuleStateSnapshot()
    dispatchCreateModule(module, previous)
    return
  }

  DBState.db.modules.push(module)
  reloadGuiAfterDefinitionChange()
}

export function updateGlobalModule(moduleId: string, module: RisuModule): void {
  if (canUseServerCommands()) {
    const previous = currentGlobalModuleStateSnapshot()
    dispatchUpdateModule(moduleId, toModuleSnapshot(module), previous)
    return
  }

  const index = DBState.db.modules.findIndex((candidate) => candidate.id === moduleId)
  if (index !== -1) {
    DBState.db.modules[index] = module
    reloadGuiAfterDefinitionChange()
  }
}

export function deleteGlobalModule(moduleId: string): void {
  if (canUseServerCommands()) {
    const previous = currentGlobalModuleStateSnapshot()
    dispatchDeleteModule(moduleId, previous)
    return
  }

  DBState.db.enabledModules = DBState.db.enabledModules.filter((id) => id !== moduleId)
  DBState.db.modules = DBState.db.modules.filter((module) => module.id !== moduleId)
  reloadGuiAfterDefinitionChange()
}

export function dispatchReorderModules(previous: GlobalModuleStateSnapshot): void {
  runModuleCommand(
    (baseRevision) =>
      reorderModulesCommand({
        baseRevision,
        moduleIds: (DBState.db.modules ?? []).map((module) => module.id),
      }),
    () => restoreGlobalModuleState(previous),
  )
}

export function dispatchReorderCharacterModules(characterId: string, previous: CharacterModuleStateSnapshot): void {
  const character = findCharacterById(characterId)
  if (!character) return
  runModuleCommand(
    (baseRevision) =>
      reorderCharacterModulesCommand({
        baseRevision,
        characterId,
        moduleIds: character.modules ?? [],
      }),
    () => restoreCharacterModuleState(previous),
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
  reloadGuiAfterDefinitionChange()
}

export function toggleSelectedCharacterModule(moduleId: string): void {
  const selectedIndex = get(selectedCharID)
  const character = DBState.db.characters?.[selectedIndex]
  if (!character?.chaId) return

  const previous = currentCharacterModuleStateSnapshot(character.chaId)
  if (!previous) return
  const nextModules = toggledModuleIds(character.modules, moduleId)

  withTrustedServerProjectionWrite(() => {
    const targetCharacter = DBState.db.characters?.[selectedIndex]
    if (!targetCharacter || targetCharacter.chaId !== character.chaId) return
    targetCharacter.modules = cloneJsonValue(nextModules)
  })

  dispatchReorderCharacterModules(character.chaId, previous)
  reloadGuiAfterDefinitionChange()
}

export function toggledModuleIds(current: readonly string[] | undefined, moduleId: string): string[] {
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
