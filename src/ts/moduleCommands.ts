import {
  currentChatGenerationSettingsSnapshot,
  currentChatScopedSnapshot,
  dispatchUpdateChatScoped,
  restoreChatGenerationSettings,
  restoreChatScopedState,
  runOptimisticCommandSequence,
  type ChatGenerationSettingsSnapshot,
} from './chatCommands'
import {
  canUseServerCommands,
  createModuleCommand,
  deleteModuleCommand,
  enableModuleCommand,
  reorderCharacterModulesCommand,
  reorderModulesCommand,
  runServerCommand,
  runServerCommandSequence,
  saveChatGenerationSettingsCommand,
  updateChatCommand,
  updateModuleCommand,
  type ModuleSnapshot,
  type ServerCommandResult,
} from './server/commands'
import { withTrustedResourceWrite } from './server/resourceWriteGuard.svelte'
import { getResourceDatabase as getDatabase } from './server/resourceState.svelte'
import { reloadGuiAfterDefinitionChange, selectedCharID } from './stores.svelte'
import type { RisuModule } from './process/modules'
import type { character } from './storage/database.svelte'
import { get } from 'svelte/store'
import {
  fillMissingActiveChatSidebarToggleDefaults,
  resolveActiveChatGenerationSettings,
} from './activeChatGenerationSettings'
import type { ChatGenerationSettings } from './chatGenerationSettings'

export interface GlobalModuleStateSnapshot {
  modules: RisuModule[]
  enabledModules: string[]
  moduleReferences?: ModuleReferenceStateSnapshot
}

export interface CharacterModuleStateSnapshot {
  characterId: string
  hasModulesField: boolean
  modules: string[] | undefined
}

interface ModuleIdsFieldSnapshot {
  hasModulesField: boolean
  modules: string[] | undefined
}

interface ChatModuleReferenceSnapshot {
  chatId: string
  modules: ModuleIdsFieldSnapshot
}

interface CharacterModuleReferenceSnapshot {
  characterId: string
  modules?: ModuleIdsFieldSnapshot
  chats: ChatModuleReferenceSnapshot[]
}

interface LoadoutModuleReferenceSnapshot {
  loadoutId?: string
  loadoutIndex: number
  modules: ModuleIdsFieldSnapshot
}

interface ModuleReferenceStateSnapshot {
  characters: CharacterModuleReferenceSnapshot[]
  loadouts: LoadoutModuleReferenceSnapshot[]
}

const MODULE_PATCH_EXCLUDED_KEYS = new Set(['id', 'mcp', 'lorebook', 'regex', 'trigger'])
const MODULE_PATCH_DELETABLE_KEYS = new Set([
  'namespace',
  'lowLevelAccess',
  'hideIcon',
  'backgroundEmbedding',
  'customModuleToggle',
  'cjs',
  'assets',
])
let nextGlobalModuleOperationSequence = 0
const pendingGlobalModuleOperationsByTarget = new Map<string, GlobalModuleOperationRecord[]>()

interface GlobalModuleOperationToken {
  sequence: number
  targets: string[]
}

type GlobalModuleOperationStatus = 'pending' | 'failed'

interface GlobalModuleOperationRecord {
  sequence: number
  entry: GlobalModuleRollbackEntry
  status: GlobalModuleOperationStatus
}

type GlobalModuleRollbackEntry =
  | ModuleCreateRollbackEntry
  | ModuleFieldRollbackEntry
  | ModuleDeleteRowRollbackEntry
  | ModuleEnableRollbackEntry
  | ModuleReferenceRollbackEntry
  | ModuleOrderRollbackEntry

interface ModuleCreateRollbackEntry {
  kind: 'module-create'
  target: string
  moduleId: string
  attemptedModule: RisuModule
}

interface ModuleFieldRollbackEntry {
  kind: 'module-field'
  target: string
  moduleId: string
  field: string
  previousExists: boolean
  previousValue: unknown
  attemptedExists: boolean
  attemptedValue: unknown
}

interface ModuleDeleteRowRollbackEntry {
  kind: 'module-delete-row'
  target: string
  moduleId: string
  previousModule: RisuModule
  previousIndex: number
}

interface ModuleEnableRollbackEntry {
  kind: 'module-enable'
  target: string
  moduleId: string
  previousEnabled: boolean
  previousIndex: number
  attemptedEnabled: boolean
}

interface ModuleReferenceRollbackEntry {
  kind: 'module-reference'
  target: string
  previous: ModuleIdsFieldSnapshot
  attempted: ModuleIdsFieldSnapshot
  characterId?: string
  chatId?: string
  loadoutId?: string
  loadoutIndex?: number
}

interface ModuleOrderRollbackEntry {
  kind: 'module-order'
  target: string
  previousModuleIds: string[]
  attemptedModuleIds: string[]
}

interface ModuleCollectionPatchStep {
  factory: (baseRevision: number) => Promise<ServerCommandResult>
  rollbackEntries: GlobalModuleRollbackEntry[]
}

export function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export function currentGlobalModuleStateSnapshot(moduleIdForReferences?: string): GlobalModuleStateSnapshot {
  const snapshot: GlobalModuleStateSnapshot = {
    modules: cloneJsonValue(getDatabase().modules ?? []),
    enabledModules: cloneJsonValue(getDatabase().enabledModules ?? []),
  }

  if (moduleIdForReferences) {
    snapshot.moduleReferences = currentModuleReferenceStateSnapshot(moduleIdForReferences)
  }

  return snapshot
}

export function restoreGlobalModuleState(snapshot: GlobalModuleStateSnapshot): void {
  withTrustedResourceWrite(() => {
    getDatabase().modules = cloneJsonValue(snapshot.modules)
    getDatabase().enabledModules = cloneJsonValue(snapshot.enabledModules)
    if (snapshot.moduleReferences) {
      restoreModuleReferenceState(snapshot.moduleReferences)
    }
    reloadGuiAfterDefinitionChange()
  })
}

function currentModuleReferenceStateSnapshot(moduleId: string): ModuleReferenceStateSnapshot {
  const characters: CharacterModuleReferenceSnapshot[] = []
  const loadouts: LoadoutModuleReferenceSnapshot[] = []

  for (const candidate of getDatabase().characters ?? []) {
    if (!candidate?.chaId) continue

    const characterModules = moduleIdsFieldSnapshot(candidate, moduleId)
    const chats: ChatModuleReferenceSnapshot[] = []

    for (const chat of candidate.chats ?? []) {
      if (!chat?.id) continue
      const chatModules = moduleIdsFieldSnapshot(chat, moduleId)
      if (chatModules) {
        chats.push({
          chatId: chat.id,
          modules: chatModules,
        })
      }
    }

    if (characterModules || chats.length > 0) {
      characters.push({
        characterId: candidate.chaId,
        modules: characterModules,
        chats,
      })
    }
  }

  for (const [loadoutIndex, candidate] of (getDatabase().loadouts ?? []).entries()) {
    if (!candidate || typeof candidate !== 'object') continue
    const loadoutModules = moduleIdsFieldSnapshot(candidate, moduleId)
    if (!loadoutModules) continue
    const loadoutId = typeof candidate.id === 'string' ? candidate.id : undefined
    loadouts.push({
      loadoutId,
      loadoutIndex,
      modules: loadoutModules,
    })
  }

  return { characters, loadouts }
}

function moduleIdsFieldSnapshot(value: { modules?: unknown }, moduleId: string): ModuleIdsFieldSnapshot | undefined {
  if (!Array.isArray(value.modules) || !value.modules.includes(moduleId)) return undefined
  return {
    hasModulesField: Object.prototype.hasOwnProperty.call(value, 'modules'),
    modules: cloneJsonValue(value.modules.filter((id): id is string => typeof id === 'string')),
  }
}

function restoreModuleReferenceState(snapshot: ModuleReferenceStateSnapshot): void {
  for (const characterSnapshot of snapshot.characters) {
    const character = findCharacterById(characterSnapshot.characterId)
    if (!character) continue

    if (characterSnapshot.modules) {
      restoreModulesField(character, characterSnapshot.modules)
    }

    for (const chatSnapshot of characterSnapshot.chats) {
      const chat = character.chats?.find((candidate) => candidate.id === chatSnapshot.chatId)
      if (!chat) continue
      restoreModulesField(chat, chatSnapshot.modules)
    }
  }

  for (const loadoutSnapshot of snapshot.loadouts) {
    const loadout = findLoadoutForReference(loadoutSnapshot)
    if (!loadout) continue
    restoreModulesField(loadout, loadoutSnapshot.modules)
  }
}

function restoreModulesField(target: { modules?: string[] }, snapshot: ModuleIdsFieldSnapshot): void {
  if (snapshot.hasModulesField) {
    target.modules = cloneJsonValue(snapshot.modules)
  } else {
    delete target.modules
  }
}

function findCharacterById(characterId: string): character | undefined {
  return getDatabase().characters?.find((candidate) => candidate.chaId === characterId)
}

function findLoadoutForReference(snapshot: LoadoutModuleReferenceSnapshot): { modules?: string[] } | undefined {
  const loadouts = getDatabase().loadouts ?? []
  if (snapshot.loadoutId) {
    const byId = loadouts.find((candidate) => candidate?.id === snapshot.loadoutId)
    if (byId) return byId
  }
  return loadouts[snapshot.loadoutIndex]
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
  withTrustedResourceWrite(() => {
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
  if (!canUseServerCommands()) return
  const moduleSnapshot = toModuleSnapshot(module)
  const rollbackEntry = moduleCreateRollbackEntry(moduleSnapshot as RisuModule)
  const operation = issueGlobalModuleOperation([rollbackEntry])
  runModuleCommand(
    async (baseRevision) => {
      const result = await createModuleCommand({ baseRevision, module: moduleSnapshot }, undefined, true)
      if (result.status === 'ok') {
        clearGlobalModuleOperation(operation)
      }
      return result
    },
    () => rollbackGlobalModuleEntries([rollbackEntry], operation),
  )
}

export function dispatchUpdateModule(
  moduleId: string,
  patch: ModuleSnapshot,
  previous: GlobalModuleStateSnapshot,
): void {
  const commandPatch = changedModulePatch(moduleId, patch, previous, { complete: true })
  if (Object.keys(commandPatch).length === 0) return
  if (!canUseServerCommands()) return
  applyModuleDeletionSentinelsOptimistically(moduleId, commandPatch)
  const rollbackEntries = moduleFieldRollbackEntries(moduleId, commandPatch, previous)
  const operation = rollbackEntries.length > 0 ? issueGlobalModuleOperation(rollbackEntries) : null
  runModuleCommand(
    async (baseRevision) => {
      const result = await updateModuleCommand({ baseRevision, moduleId, patch: commandPatch }, undefined, true)
      if (operation && result.status === 'ok') {
        clearGlobalModuleOperation(operation)
      }
      return result
    },
    () => {
      if (operation) {
        rollbackGlobalModuleEntries(rollbackEntries, operation)
      }
    },
  )
}

export function dispatchModuleInfoPatch(
  moduleId: string,
  patch: ModuleSnapshot,
  enabled: boolean | null,
  previous: GlobalModuleStateSnapshot,
): void {
  if (!canUseServerCommands()) return

  const steps: ModuleCollectionPatchStep[] = []
  const commandPatch = changedModulePatch(moduleId, patch, previous)

  if (Object.keys(commandPatch).length > 0) {
    applyModuleDeletionSentinelsOptimistically(moduleId, commandPatch)
    const rollbackEntries = moduleFieldRollbackEntries(moduleId, commandPatch, previous)
    if (rollbackEntries.length > 0) {
      steps.push({
        factory: (baseRevision) =>
          updateModuleCommand({ baseRevision, moduleId, patch: commandPatch }, undefined, true),
        rollbackEntries,
      })
    }
  }

  if (enabled !== null) {
    steps.push({
      factory: (baseRevision) => enableModuleCommand({ baseRevision, moduleId, enabled }, undefined, true),
      rollbackEntries: [moduleEnableRollbackEntry(moduleId, enabled, previous)],
    })
  }

  runModuleCollectionPatchSteps(steps)
}

export function dispatchDeleteModule(moduleId: string, previous: GlobalModuleStateSnapshot): void {
  if (!canUseServerCommands()) return
  const rollbackEntries = moduleDeleteRollbackEntries(moduleId, previous)
  const operation = rollbackEntries.length > 0 ? issueGlobalModuleOperation(rollbackEntries) : null
  runModuleCommand(
    async (baseRevision) => {
      const result = await deleteModuleCommand({
        baseRevision,
        moduleId,
      })
      if (operation && result.status === 'ok') {
        clearGlobalModuleOperation(operation)
      }
      return result
    },
    () => {
      if (operation) {
        rollbackGlobalModuleEntries(rollbackEntries, operation)
      }
    },
  )
}

export function dispatchEnableModule(moduleId: string, enabled: boolean, previous: GlobalModuleStateSnapshot): void {
  if (!canUseServerCommands()) return
  const rollbackEntry = moduleEnableRollbackEntry(moduleId, enabled, previous)
  const operation = issueGlobalModuleOperation([rollbackEntry])
  runModuleCommand(
    async (baseRevision) => {
      const result = await enableModuleCommand({ baseRevision, moduleId, enabled }, undefined, true)
      if (result.status === 'ok') {
        clearGlobalModuleOperation(operation)
      }
      return result
    },
    () => rollbackGlobalModuleEntries([rollbackEntry], operation),
  )
}

export function setGlobalModuleEnabled(moduleId: string, enabled: boolean): void {
  if (canUseServerCommands()) {
    const previous = currentGlobalModuleStateSnapshot()
    applyOptimisticGlobalModuleEnabled(moduleId, enabled)
    dispatchEnableModule(moduleId, enabled, previous)
    return
  }

  if (enabled) {
    if (!getDatabase().enabledModules.includes(moduleId)) {
      getDatabase().enabledModules.push(moduleId)
    }
  } else {
    getDatabase().enabledModules = getDatabase().enabledModules.filter((id) => id !== moduleId)
  }
  reloadGuiAfterDefinitionChange()
}

export function createGlobalModule(module: RisuModule): void {
  if (canUseServerCommands()) {
    const previous = currentGlobalModuleStateSnapshot()
    applyOptimisticCreatedGlobalModule(module)
    dispatchCreateModule(module, previous)
    return
  }

  getDatabase().modules.push(module)
  reloadGuiAfterDefinitionChange()
}

export function updateGlobalModule(moduleId: string, module: RisuModule): void {
  if (canUseServerCommands()) {
    const previous = currentGlobalModuleStateSnapshot()
    const nextModule = cloneJsonValue(module)
    let applied = false
    withTrustedResourceWrite(() => {
      const index = getDatabase().modules.findIndex((candidate) => candidate.id === moduleId)
      if (index !== -1) {
        getDatabase().modules[index] = nextModule
        applied = true
      }
    })
    if (applied) reloadGuiAfterDefinitionChange()
    dispatchUpdateModule(moduleId, toModuleSnapshot(module), previous)
    return
  }

  const index = getDatabase().modules.findIndex((candidate) => candidate.id === moduleId)
  if (index !== -1) {
    getDatabase().modules[index] = module
    reloadGuiAfterDefinitionChange()
  }
}

export function deleteGlobalModule(moduleId: string): void {
  if (canUseServerCommands()) {
    const previous = currentGlobalModuleStateSnapshot(moduleId)
    applyOptimisticDeletedGlobalModule(moduleId)
    dispatchDeleteModule(moduleId, previous)
    return
  }

  getDatabase().enabledModules = getDatabase().enabledModules.filter((id) => id !== moduleId)
  getDatabase().modules = getDatabase().modules.filter((module) => module.id !== moduleId)
  removeProjectedModuleReferences(moduleId)
  reloadGuiAfterDefinitionChange()
}

function applyOptimisticGlobalModuleEnabled(moduleId: string, enabled: boolean): void {
  withTrustedResourceWrite(() => {
    const enabledModules = new Set(getDatabase().enabledModules ?? [])
    if (enabled) {
      enabledModules.add(moduleId)
    } else {
      enabledModules.delete(moduleId)
    }
    getDatabase().enabledModules = Array.from(enabledModules)
  })
  reloadGuiAfterDefinitionChange()
}

function applyOptimisticCreatedGlobalModule(module: RisuModule): void {
  withTrustedResourceWrite(() => {
    getDatabase().modules = [...(getDatabase().modules ?? []), cloneJsonValue(module)]
  })
  reloadGuiAfterDefinitionChange()
}

function applyOptimisticDeletedGlobalModule(moduleId: string): void {
  withTrustedResourceWrite(() => {
    getDatabase().enabledModules = (getDatabase().enabledModules ?? []).filter((id) => id !== moduleId)
    getDatabase().modules = (getDatabase().modules ?? []).filter((module) => module.id !== moduleId)
    removeProjectedModuleReferences(moduleId)
  })
  reloadGuiAfterDefinitionChange()
}

function removeProjectedModuleReferences(moduleId: string): void {
  for (const character of getDatabase().characters ?? []) {
    if (Array.isArray(character.modules)) {
      character.modules = character.modules.filter((id) => id !== moduleId)
    }

    for (const chat of character.chats ?? []) {
      if (Array.isArray(chat.modules)) {
        chat.modules = chat.modules.filter((id) => id !== moduleId)
      }
    }
  }

  for (const loadout of getDatabase().loadouts ?? []) {
    if (Array.isArray(loadout.modules)) {
      loadout.modules = loadout.modules.filter((id) => id !== moduleId)
    }
  }
}

export function dispatchReorderModules(previous: GlobalModuleStateSnapshot): void {
  if (!canUseServerCommands()) return
  const attemptedModuleIds = (getDatabase().modules ?? []).map((module) => module.id)
  const rollbackEntry = moduleOrderRollbackEntry(previous, attemptedModuleIds)
  const operation = issueGlobalModuleOperation([rollbackEntry])
  runModuleCommand(
    async (baseRevision) => {
      const result = await reorderModulesCommand({ baseRevision, moduleIds: attemptedModuleIds }, undefined, true)
      if (result.status === 'ok') {
        clearGlobalModuleOperation(operation)
      }
      return result
    },
    () => rollbackGlobalModuleEntries([rollbackEntry], operation),
  )
}

export function dispatchModuleCollectionPatch(modules: RisuModule[], previous: GlobalModuleStateSnapshot): void {
  if (!canUseServerCommands()) return

  const beforeModules = new Map(previous.modules.map((module) => [module.id, module]))
  const nextModules = new Map(modules.map((module) => [module.id, module]))
  const steps: ModuleCollectionPatchStep[] = []

  for (const module of modules) {
    if (typeof module.id !== 'string' || module.id.trim() === '') continue
    const before = beforeModules.get(module.id)
    if (!before) {
      const moduleSnapshot = toModuleSnapshot(module)
      steps.push({
        factory: (baseRevision) => createModuleCommand({ baseRevision, module: moduleSnapshot }, undefined, true),
        rollbackEntries: [moduleCreateRollbackEntry(moduleSnapshot as RisuModule)],
      })
      continue
    }
    const moduleId = module.id
    const commandPatch = changedModulePatch(moduleId, toModuleSnapshot(module), previous, { complete: true })
    if (Object.keys(commandPatch).length === 0) continue
    applyModuleDeletionSentinelsOptimistically(moduleId, commandPatch)
    const rollbackEntries = moduleFieldRollbackEntries(moduleId, commandPatch, previous)
    if (rollbackEntries.length === 0) continue
    steps.push({
      factory: (baseRevision) => updateModuleCommand({ baseRevision, moduleId, patch: commandPatch }, undefined, true),
      rollbackEntries,
    })
  }

  for (const module of previous.modules) {
    if (typeof module.id === 'string' && module.id.trim() && !nextModules.has(module.id)) {
      const moduleId = module.id
      const rollbackEntries = moduleDeleteRollbackEntries(moduleId, previous)
      if (rollbackEntries.length > 0) {
        steps.push({
          factory: (baseRevision) => deleteModuleCommand({ baseRevision, moduleId }),
          rollbackEntries,
        })
      }
    }
  }

  const attemptedModuleIds = modules.map((module) => module.id)
  const expectedOrderAfterCreateDelete = previous.modules
    .map((module) => module.id)
    .filter((moduleId) => nextModules.has(moduleId))
  for (const module of modules) {
    if (!beforeModules.has(module.id)) {
      expectedOrderAfterCreateDelete.push(module.id)
    }
  }
  if (!isStringArrayEqual(expectedOrderAfterCreateDelete, attemptedModuleIds)) {
    steps.push({
      // A preceding authoritative delete refresh can temporarily restore the
      // server's pre-reorder projection. Keep this sequence's final reorder
      // authoritative so it cannot fence that intermediate order as current.
      factory: (baseRevision) => reorderModulesCommand({ baseRevision, moduleIds: attemptedModuleIds }),
      rollbackEntries: [moduleOrderRollbackEntry(previous, attemptedModuleIds)],
    })
  }

  runModuleCollectionPatchSteps(steps)
}

export function dispatchEnabledModulesPatch(
  enabledModules: unknown[],
  previous: GlobalModuleStateSnapshot,
  modules: RisuModule[],
): void {
  if (!canUseServerCommands()) return

  const before = new Set(previous.enabledModules)
  const next = new Set(enabledModules.filter((id): id is string => typeof id === 'string'))
  const knownModules = new Set(modules.map((module) => module.id))
  const steps: ModuleCollectionPatchStep[] = []

  for (const moduleId of next) {
    if (!before.has(moduleId) && knownModules.has(moduleId)) {
      steps.push({
        factory: (baseRevision) => enableModuleCommand({ baseRevision, moduleId, enabled: true }),
        rollbackEntries: [moduleEnableRollbackEntry(moduleId, true, previous)],
      })
    }
  }
  for (const moduleId of before) {
    if (!next.has(moduleId) && knownModules.has(moduleId)) {
      steps.push({
        factory: (baseRevision) => enableModuleCommand({ baseRevision, moduleId, enabled: false }),
        rollbackEntries: [moduleEnableRollbackEntry(moduleId, false, previous)],
      })
    }
  }

  runModuleCollectionPatchSteps(steps)
}

function runModuleCollectionPatchSteps(steps: ModuleCollectionPatchStep[]): void {
  if (steps.length === 0) return

  const operationSteps = steps.map((step) => ({
    ...step,
    operation: issueGlobalModuleOperation(step.rollbackEntries),
  }))

  void (async () => {
    let currentStepIndex = 0
    try {
      await runServerCommandSequence(
        operationSteps.map((step, index) => async (baseRevision) => {
          currentStepIndex = index
          const result = await step.factory(baseRevision)
          if (result.status === 'ok') {
            clearGlobalModuleOperation(step.operation)
          }
          return result
        }),
        () => {
          rollbackModuleCollectionPatchSteps(operationSteps, currentStepIndex)
        },
      )
    } catch (error) {
      console.error('Module collection command sequence rejected:', error)
      rollbackModuleCollectionPatchSteps(operationSteps, currentStepIndex)
    }
  })()
}

function rollbackModuleCollectionPatchSteps(
  steps: Array<ModuleCollectionPatchStep & { operation: GlobalModuleOperationToken }>,
  failedStepIndex: number,
): void {
  for (let index = steps.length - 1; index >= failedStepIndex; index -= 1) {
    const step = steps[index]
    rollbackGlobalModuleEntries(step.rollbackEntries, step.operation)
  }
}

function moduleCreateRollbackEntry(module: RisuModule): ModuleCreateRollbackEntry {
  return {
    kind: 'module-create',
    target: moduleRowRollbackTarget(module.id),
    moduleId: module.id,
    attemptedModule: cloneJsonValue(module),
  }
}

function moduleFieldRollbackEntries(
  moduleId: string,
  patch: ModuleSnapshot,
  previous: GlobalModuleStateSnapshot,
): ModuleFieldRollbackEntry[] {
  return Object.entries(patch)
    .map(([field, value]) => {
      const deletesField = value === null && MODULE_PATCH_DELETABLE_KEYS.has(field)
      return moduleFieldRollbackEntry(moduleId, field, previous, !deletesField, deletesField ? undefined : value)
    })
    .filter((entry): entry is ModuleFieldRollbackEntry => entry !== null)
}

function applyModuleDeletionSentinelsOptimistically(moduleId: string, patch: ModuleSnapshot): void {
  const deletedFields = Object.entries(patch)
    .filter(([field, value]) => value === null && MODULE_PATCH_DELETABLE_KEYS.has(field))
    .map(([field]) => field)
  if (deletedFields.length === 0) return

  withTrustedResourceWrite(() => {
    const module = getDatabase().modules?.find((candidate) => candidate.id === moduleId) as
      | (RisuModule & Record<string, unknown>)
      | undefined
    if (!module) return
    for (const field of deletedFields) {
      if (module[field] === null) delete module[field]
    }
  })
}

function moduleFieldRollbackEntry(
  moduleId: string,
  field: string,
  previous: GlobalModuleStateSnapshot,
  attemptedExists: boolean,
  attemptedValue: unknown,
): ModuleFieldRollbackEntry | null {
  const previousModule = previous.modules.find((module) => module.id === moduleId)
  if (!previousModule) return null
  const previousRecord = previousModule as unknown as Record<string, unknown>
  return {
    kind: 'module-field',
    target: moduleFieldRollbackTarget(moduleId, field),
    moduleId,
    field,
    previousExists: hasOwnRecordKey(previousRecord, field),
    previousValue: cloneJsonValue(previousRecord[field]),
    attemptedExists,
    attemptedValue: cloneJsonValue(attemptedValue),
  }
}

function moduleDeleteRollbackEntries(
  moduleId: string,
  previous: GlobalModuleStateSnapshot,
): GlobalModuleRollbackEntry[] {
  const entries: GlobalModuleRollbackEntry[] = []
  const previousIndex = previous.modules.findIndex((module) => module.id === moduleId)
  if (previousIndex !== -1) {
    entries.push({
      kind: 'module-delete-row',
      target: moduleRowRollbackTarget(moduleId),
      moduleId,
      previousModule: cloneJsonValue(previous.modules[previousIndex]),
      previousIndex,
    })
  }

  const enableEntry = moduleEnableRollbackEntry(moduleId, false, previous)
  if (enableEntry.previousEnabled) {
    entries.push(enableEntry)
  }

  if (previous.moduleReferences) {
    entries.push(...moduleReferenceRollbackEntries(moduleId, previous.moduleReferences))
  }

  return entries
}

function moduleEnableRollbackEntry(
  moduleId: string,
  attemptedEnabled: boolean,
  previous: GlobalModuleStateSnapshot,
): ModuleEnableRollbackEntry {
  const previousIndex = previous.enabledModules.indexOf(moduleId)
  return {
    kind: 'module-enable',
    target: moduleEnableRollbackTarget(moduleId),
    moduleId,
    previousEnabled: previousIndex !== -1,
    previousIndex,
    attemptedEnabled,
  }
}

function moduleReferenceRollbackEntries(
  moduleId: string,
  snapshot: ModuleReferenceStateSnapshot,
): ModuleReferenceRollbackEntry[] {
  const entries: ModuleReferenceRollbackEntry[] = []

  for (const characterSnapshot of snapshot.characters) {
    if (characterSnapshot.modules) {
      entries.push({
        kind: 'module-reference',
        target: moduleCharacterReferenceRollbackTarget(characterSnapshot.characterId),
        characterId: characterSnapshot.characterId,
        previous: cloneJsonValue(characterSnapshot.modules),
        attempted: moduleReferenceAttemptAfterDelete(characterSnapshot.modules, moduleId),
      })
    }

    for (const chatSnapshot of characterSnapshot.chats) {
      entries.push({
        kind: 'module-reference',
        target: moduleChatReferenceRollbackTarget(characterSnapshot.characterId, chatSnapshot.chatId),
        characterId: characterSnapshot.characterId,
        chatId: chatSnapshot.chatId,
        previous: cloneJsonValue(chatSnapshot.modules),
        attempted: moduleReferenceAttemptAfterDelete(chatSnapshot.modules, moduleId),
      })
    }
  }

  for (const loadoutSnapshot of snapshot.loadouts) {
    entries.push({
      kind: 'module-reference',
      target: moduleLoadoutReferenceRollbackTarget(loadoutSnapshot),
      loadoutId: loadoutSnapshot.loadoutId,
      loadoutIndex: loadoutSnapshot.loadoutIndex,
      previous: cloneJsonValue(loadoutSnapshot.modules),
      attempted: moduleReferenceAttemptAfterDelete(loadoutSnapshot.modules, moduleId),
    })
  }

  return entries
}

function moduleReferenceAttemptAfterDelete(snapshot: ModuleIdsFieldSnapshot, moduleId: string): ModuleIdsFieldSnapshot {
  return {
    hasModulesField: snapshot.hasModulesField,
    modules: snapshot.modules?.filter((id) => id !== moduleId),
  }
}

function moduleOrderRollbackEntry(
  previous: GlobalModuleStateSnapshot,
  attemptedModuleIds: string[],
): ModuleOrderRollbackEntry {
  return {
    kind: 'module-order',
    target: 'module-order:current',
    previousModuleIds: previous.modules.map((module) => module.id),
    attemptedModuleIds: [...attemptedModuleIds],
  }
}

function issueGlobalModuleOperation(entries: GlobalModuleRollbackEntry[]): GlobalModuleOperationToken {
  const targets = [...new Set(entries.flatMap((entry) => globalModuleRollbackTargets(entry)))]
  const token = {
    sequence: ++nextGlobalModuleOperationSequence,
    targets,
  }

  for (const entry of entries) {
    for (const target of globalModuleRollbackTargets(entry)) {
      const pendingOperations = pendingGlobalModuleOperationsByTarget.get(target) ?? []
      pendingOperations.push({
        sequence: token.sequence,
        entry,
        status: 'pending',
      })
      pendingGlobalModuleOperationsByTarget.set(target, pendingOperations)
    }
  }

  return token
}

function rollbackGlobalModuleEntries(
  entries: GlobalModuleRollbackEntry[],
  operation: GlobalModuleOperationToken,
): void {
  let changed = false

  withTrustedResourceWrite(() => {
    void entries
    for (const target of operation.targets) {
      const pendingOperations = pendingGlobalModuleOperationsByTarget.get(target)
      const operationRecords = pendingOperations?.filter((record) => record.sequence === operation.sequence) ?? []
      if (!pendingOperations || operationRecords.length === 0) continue

      for (const operationRecord of operationRecords) {
        operationRecord.status = 'failed'
      }
      changed = cascadeFailedGlobalModuleOperationsForTarget(target, pendingOperations) || changed

      if (pendingOperations.length > 0) {
        pendingGlobalModuleOperationsByTarget.set(target, pendingOperations)
      } else {
        pendingGlobalModuleOperationsByTarget.delete(target)
      }
    }
  })

  if (changed) {
    reloadGuiAfterDefinitionChange()
  }
}

function cascadeFailedGlobalModuleOperationsForTarget(
  target: string,
  pendingOperations: GlobalModuleOperationRecord[],
): boolean {
  let changed = false

  while (pendingOperations.length > 0) {
    const latestOperation = pendingOperations[pendingOperations.length - 1]
    if (latestOperation.status !== 'failed') break

    if (rollbackGlobalModuleEntryIfLiveMatches(latestOperation.entry)) {
      changed = true
    }
    pendingOperations.pop()
  }

  if (pendingOperations.length > 0) {
    pendingGlobalModuleOperationsByTarget.set(target, pendingOperations)
  } else {
    pendingGlobalModuleOperationsByTarget.delete(target)
  }

  return changed
}

function rollbackGlobalModuleEntryIfLiveMatches(entry: GlobalModuleRollbackEntry): boolean {
  if (entry.kind === 'module-create') {
    return rollbackModuleCreateIfLiveMatches(entry)
  }
  if (entry.kind === 'module-field') {
    return rollbackModuleFieldIfLiveMatches(entry)
  }
  if (entry.kind === 'module-delete-row') {
    return rollbackModuleDeleteRowIfLiveMatches(entry)
  }
  if (entry.kind === 'module-enable') {
    return rollbackModuleEnableIfLiveMatches(entry)
  }
  if (entry.kind === 'module-reference') {
    return rollbackModuleReferenceIfLiveMatches(entry)
  }
  return rollbackModuleOrderIfLiveMatches(entry)
}

function rollbackModuleCreateIfLiveMatches(entry: ModuleCreateRollbackEntry): boolean {
  const modules = getDatabase().modules ?? []
  const index = modules.findIndex((module) => module.id === entry.moduleId)
  if (index === -1 || !isJsonValueEqual(modules[index], entry.attemptedModule)) return false

  getDatabase().modules = modules.filter((_, moduleIndex) => moduleIndex !== index)
  return true
}

function rollbackModuleFieldIfLiveMatches(entry: ModuleFieldRollbackEntry): boolean {
  const modules = getDatabase().modules ?? []
  const index = modules.findIndex((module) => module.id === entry.moduleId)
  if (index === -1) return false

  const liveModule = modules[index] as RisuModule & Record<string, unknown>
  const liveExists = hasOwnRecordKey(liveModule, entry.field)
  if (entry.attemptedExists) {
    if (!liveExists || !isJsonValueEqual(liveModule[entry.field], entry.attemptedValue)) return false
  } else if (liveExists && liveModule[entry.field] !== undefined) {
    return false
  }

  const nextModule = {
    ...liveModule,
  }

  if (entry.previousExists) {
    nextModule[entry.field] = cloneJsonValue(entry.previousValue)
  } else {
    delete nextModule[entry.field]
  }

  getDatabase().modules[index] = nextModule
  return true
}

function rollbackModuleDeleteRowIfLiveMatches(entry: ModuleDeleteRowRollbackEntry): boolean {
  const modules = getDatabase().modules ?? []
  if (modules.some((module) => module.id === entry.moduleId)) return false

  const nextModules = [...modules]
  const insertIndex = boundedInsertIndex(entry.previousIndex, nextModules.length)
  nextModules.splice(insertIndex, 0, cloneJsonValue(entry.previousModule))
  getDatabase().modules = nextModules
  return true
}

function rollbackModuleEnableIfLiveMatches(entry: ModuleEnableRollbackEntry): boolean {
  const enabledModules = getDatabase().enabledModules ?? []
  const liveIndex = enabledModules.indexOf(entry.moduleId)
  const liveEnabled = liveIndex !== -1
  if (liveEnabled !== entry.attemptedEnabled) return false
  if (liveEnabled === entry.previousEnabled) return false

  if (entry.previousEnabled) {
    const nextEnabledModules = enabledModules.filter((id) => id !== entry.moduleId)
    const insertIndex = boundedInsertIndex(entry.previousIndex, nextEnabledModules.length)
    nextEnabledModules.splice(insertIndex, 0, entry.moduleId)
    getDatabase().enabledModules = nextEnabledModules
    return true
  }

  getDatabase().enabledModules = enabledModules.filter((id) => id !== entry.moduleId)
  return true
}

function rollbackModuleReferenceIfLiveMatches(entry: ModuleReferenceRollbackEntry): boolean {
  const target = findModuleReferenceTarget(entry)
  if (!target || !modulesFieldMatches(target, entry.attempted)) return false
  restoreModulesField(target, entry.previous)
  return true
}

function findModuleReferenceTarget(entry: ModuleReferenceRollbackEntry): { modules?: string[] } | undefined {
  if (entry.characterId && entry.chatId) {
    const character = findCharacterById(entry.characterId)
    return character?.chats?.find((candidate) => candidate.id === entry.chatId)
  }
  if (entry.characterId) {
    return findCharacterById(entry.characterId)
  }
  const loadouts = getDatabase().loadouts ?? []
  if (entry.loadoutId) {
    const byId = loadouts.find((candidate) => candidate?.id === entry.loadoutId)
    if (byId) return byId
  }
  return typeof entry.loadoutIndex === 'number' ? loadouts[entry.loadoutIndex] : undefined
}

function modulesFieldMatches(target: { modules?: string[] }, snapshot: ModuleIdsFieldSnapshot): boolean {
  const hasModulesField = Object.prototype.hasOwnProperty.call(target, 'modules')
  if (hasModulesField !== snapshot.hasModulesField) return false
  const liveModules = Array.isArray(target.modules)
    ? target.modules.filter((id): id is string => typeof id === 'string')
    : undefined
  return isJsonValueEqual(liveModules, snapshot.modules)
}

function rollbackModuleOrderIfLiveMatches(entry: ModuleOrderRollbackEntry): boolean {
  const modules = getDatabase().modules ?? []
  const liveModuleIds = modules.map((module) => module.id)
  if (!isStringArrayEqual(liveModuleIds, entry.attemptedModuleIds)) return false

  const modulesById = new Map(modules.map((module) => [module.id, module]))
  const usedModuleIds = new Set<string>()
  const reorderedModules: RisuModule[] = []

  for (const moduleId of entry.previousModuleIds) {
    const module = modulesById.get(moduleId)
    if (!module) continue
    reorderedModules.push(module)
    usedModuleIds.add(moduleId)
  }

  for (const module of modules) {
    if (usedModuleIds.has(module.id)) continue
    reorderedModules.push(module)
  }

  if (
    isStringArrayEqual(
      reorderedModules.map((module) => module.id),
      liveModuleIds,
    )
  )
    return false
  getDatabase().modules = reorderedModules
  return true
}

function clearGlobalModuleOperation(operation: GlobalModuleOperationToken): void {
  for (const target of operation.targets) {
    const pendingOperations = pendingGlobalModuleOperationsByTarget.get(target)
    if (!pendingOperations) continue

    const operationIndex = pendingOperations.findIndex((record) => record.sequence === operation.sequence)
    if (operationIndex === -1) continue

    const nextPendingOperations = pendingOperations.filter(
      (record, index) =>
        record.sequence !== operation.sequence && !(index < operationIndex && record.status === 'failed'),
    )
    if (nextPendingOperations.length > 0) {
      pendingGlobalModuleOperationsByTarget.set(target, nextPendingOperations)
    } else {
      pendingGlobalModuleOperationsByTarget.delete(target)
    }
  }
}

function moduleFieldRollbackTarget(moduleId: string, field: string): string {
  return `module-field:${moduleId}:${field}`
}

function moduleRowRollbackTarget(moduleId: string): string {
  return `module-row:${moduleId}`
}

function moduleEnableRollbackTarget(moduleId: string): string {
  return `module-enable:${moduleId}`
}

function moduleCharacterReferenceRollbackTarget(characterId: string): string {
  return `module-reference:character:${characterId}`
}

function moduleChatReferenceRollbackTarget(characterId: string, chatId: string): string {
  return `module-reference:chat:${characterId}:${chatId}`
}

function moduleLoadoutReferenceRollbackTarget(snapshot: LoadoutModuleReferenceSnapshot): string {
  if (snapshot.loadoutId) return `module-reference:loadout:${snapshot.loadoutId}`
  return `module-reference:loadout-index:${snapshot.loadoutIndex}`
}

function globalModuleRollbackTargets(entry: GlobalModuleRollbackEntry): string[] {
  if (entry.kind === 'module-field') {
    return [entry.target, moduleRowRollbackTarget(entry.moduleId)]
  }
  return [entry.target]
}

function boundedInsertIndex(index: number, length: number): number {
  if (index < 0) return 0
  if (index > length) return length
  return index
}

interface ActiveChatSidebarToggleDefaultUpdate {
  chatId: string
  generationSettings: ChatGenerationSettings
  rollback: ChatGenerationSettingsSnapshot
}

function applyMissingActiveChatSidebarToggleDefaults(): ActiveChatSidebarToggleDefaultUpdate | null {
  const state = resolveActiveChatGenerationSettings()
  const chatId = state.identity.chatId
  const generationSettings = fillMissingActiveChatSidebarToggleDefaults(state)
  if (!chatId || !generationSettings || isJsonValueEqual(generationSettings, state.settings)) return null
  if (hasBlockingGenerationSettingsSaveReason(state)) return null

  const rollbackSnapshot = currentChatGenerationSettingsSnapshot(chatId)
  if (!rollbackSnapshot) return null

  const commandSettings = cloneJsonValue(generationSettings)
  let applied = false
  withTrustedResourceWrite(() => {
    const character = getDatabase().characters?.[state.identity.selectedCharIndex]
    const chat =
      state.identity.chatIndex >= 0 && Number.isInteger(state.identity.chatIndex)
        ? character?.chats?.[state.identity.chatIndex]
        : undefined
    if (!chat || chat.id !== chatId) return
    chat.generationSettings = cloneJsonValue(commandSettings)
    applied = true
  })

  if (!applied) return null
  return {
    chatId,
    generationSettings: commandSettings,
    rollback: {
      ...rollbackSnapshot,
      attemptedGenerationSettings: commandSettings,
    },
  }
}

function hasBlockingGenerationSettingsSaveReason(
  state: ReturnType<typeof resolveActiveChatGenerationSettings>,
): boolean {
  return state.readiness.missing.some((reason) => {
    switch (reason.code) {
      case 'persona_missing':
      case 'model_preset_missing':
      case 'prompt_preset_missing':
      case 'jailbreak_toggle_missing':
      case 'jailbreak_toggle_invalid':
        return true
      default:
        return false
    }
  })
}

function dispatchUpdateChatScopedWithGenerationSettings(
  chatId: string,
  nextModules: string[],
  generationUpdate: ActiveChatSidebarToggleDefaultUpdate,
  previous: ReturnType<typeof currentChatScopedSnapshot>,
): void {
  const commandModules = cloneJsonValue(nextModules)
  const commandSettings = cloneJsonValue(generationUpdate.generationSettings)
  runOptimisticCommandSequence(
    [
      (baseRevision) =>
        updateChatCommand({
          baseRevision,
          chatId,
          patch: { modules: commandModules },
          select: false,
        }),
      (baseRevision) =>
        saveChatGenerationSettingsCommand({
          baseRevision,
          chatId,
          generationSettings: commandSettings,
        }),
    ],
    () => restoreChatScopedState(previous),
  )
}

function dispatchReorderCharacterModulesWithGenerationSettings(
  characterId: string,
  nextModules: string[],
  previous: CharacterModuleStateSnapshot,
  generationUpdate: ActiveChatSidebarToggleDefaultUpdate,
): void {
  const commandModules = cloneJsonValue(nextModules)
  const commandSettings = cloneJsonValue(generationUpdate.generationSettings)
  const rollback: ChatGenerationSettingsSnapshot = {
    ...generationUpdate.rollback,
    attemptedGenerationSettings: commandSettings,
  }

  runOptimisticCommandSequence(
    [
      (baseRevision) =>
        reorderCharacterModulesCommand(
          {
            baseRevision,
            characterId,
            moduleIds: commandModules,
          },
          undefined,
          true,
        ),
      (baseRevision) =>
        saveChatGenerationSettingsCommand({
          baseRevision,
          chatId: generationUpdate.chatId,
          generationSettings: commandSettings,
        }),
    ],
    () => {
      restoreCharacterModuleState(previous)
      restoreChatGenerationSettings(rollback)
    },
  )
}

export function dispatchReorderCharacterModules(characterId: string, previous: CharacterModuleStateSnapshot): void {
  const character = findCharacterById(characterId)
  if (!character) return
  runModuleCommand(
    (baseRevision) =>
      reorderCharacterModulesCommand(
        {
          baseRevision,
          characterId,
          moduleIds: character.modules ?? [],
        },
        undefined,
        true,
      ),
    () => restoreCharacterModuleState(previous),
  )
}

export function toggleSelectedChatModule(moduleId: string): void {
  const selectedIndex = get(selectedCharID)
  const character = getDatabase().characters?.[selectedIndex]
  const chatIndex = character?.chatPage
  const chat = Number.isInteger(chatIndex) ? character?.chats?.[chatIndex] : undefined
  if (!chat?.id) return

  // Toggling a chat's module link mutates only the active chat row, so the
  // rollback needs just that one chat — not a deep clone of every character
  // with every hydrated history.
  const previous = currentChatScopedSnapshot()
  const enabling = !(chat.modules ?? []).includes(moduleId)
  const nextModules = toggledModuleIds(chat.modules, moduleId)

  withTrustedResourceWrite(() => {
    const targetCharacter = getDatabase().characters?.[selectedIndex]
    const targetChat = Number.isInteger(chatIndex) ? targetCharacter?.chats?.[chatIndex] : undefined
    if (!targetChat || targetChat.id !== chat.id) return
    targetChat.modules = cloneJsonValue(nextModules)
  })

  const generationUpdate = enabling ? applyMissingActiveChatSidebarToggleDefaults() : null
  if (generationUpdate) {
    dispatchUpdateChatScopedWithGenerationSettings(chat.id, nextModules, generationUpdate, previous)
  } else {
    dispatchUpdateChatScoped(chat.id, { modules: nextModules }, previous)
  }
  reloadGuiAfterDefinitionChange()
}

export function toggleSelectedCharacterModule(moduleId: string): void {
  const selectedIndex = get(selectedCharID)
  const character = getDatabase().characters?.[selectedIndex]
  if (!character?.chaId) return

  const previous = currentCharacterModuleStateSnapshot(character.chaId)
  if (!previous) return
  const enabling = !(character.modules ?? []).includes(moduleId)
  const nextModules = toggledModuleIds(character.modules, moduleId)

  withTrustedResourceWrite(() => {
    const targetCharacter = getDatabase().characters?.[selectedIndex]
    if (!targetCharacter || targetCharacter.chaId !== character.chaId) return
    targetCharacter.modules = cloneJsonValue(nextModules)
  })

  const generationUpdate = enabling ? applyMissingActiveChatSidebarToggleDefaults() : null
  if (generationUpdate) {
    dispatchReorderCharacterModulesWithGenerationSettings(character.chaId, nextModules, previous, generationUpdate)
  } else {
    dispatchReorderCharacterModules(character.chaId, previous)
  }
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
  return Object.fromEntries(
    Object.entries(module as RisuModule & Record<string, unknown>).map(([key, value]) => [key, cloneJsonValue(value)]),
  ) as ModuleSnapshot
}

export function sanitizeModulePatch(patch: ModuleSnapshot): ModuleSnapshot {
  const sanitized: ModuleSnapshot = {}
  for (const [key, value] of Object.entries(patch)) {
    if (MODULE_PATCH_EXCLUDED_KEYS.has(key) || value === undefined) continue
    sanitized[key] = value
  }
  return sanitized
}

function changedModulePatch(
  moduleId: string,
  patch: ModuleSnapshot,
  previous: GlobalModuleStateSnapshot,
  options: { complete?: boolean } = {},
): ModuleSnapshot {
  const sanitized = sanitizeModulePatch(patch)
  const before = previous.modules.find((module) => module.id === moduleId) as
    | (RisuModule & Record<string, unknown>)
    | undefined
  if (!before) return cloneJsonValue(sanitized)

  const changed = Object.fromEntries(
    Object.entries(sanitized)
      .filter(([key, value]) => !hasOwnRecordKey(before, key) || !isJsonValueEqual(before[key], value))
      .map(([key, value]) => [key, cloneJsonValue(value)]),
  ) as Record<string, unknown>

  for (const key of MODULE_PATCH_DELETABLE_KEYS) {
    const explicitlyRemoved = hasOwnRecordKey(patch, key) && patch[key] === undefined
    const omittedFromCompleteSnapshot = options.complete === true && !hasOwnRecordKey(patch, key)
    if (hasOwnRecordKey(before, key) && (explicitlyRemoved || omittedFromCompleteSnapshot)) {
      changed[key] = null
    }
  }

  return changed as ModuleSnapshot
}

function hasOwnRecordKey(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function isJsonValueEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isStringArrayEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}
