import {
  currentChatGenerationSettingsSnapshot,
  currentChatScopedSnapshot,
  dispatchCharacterOwnedDurableBatch,
  dispatchOwnedDurableBatch,
  type CharacterOwnedDurableBatchResult,
  type CharacterOwnedDurableBatchStep,
  type ChatScopedSnapshot,
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
  saveChatGenerationSettingsCommand,
  updateChatCommand,
  updateModuleCommand,
  type ModuleSnapshot,
  type ServerCommandResult,
  type ServerCommandTransportOptions,
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
import { dispatchDurableMutation } from './server/durableMutationDispatch'
import { flushRegisteredPendingBridgePatches } from './server/pendingBridgeFlushRegistry'
import {
  pendingMutationChatGenerationSettingsProjectionTarget,
  pendingMutationModuleEnabledProjectionTarget,
  recordPendingMutationProjectionTargets,
  stagePendingMutation,
  type DurableMutationIntent,
} from './server/pendingMutationOutbox'
import { moduleOwnerMutationKey } from './server/resourceOwnerMutationKeys'
import { chatGenerationSettingsMutationDependencyKeys } from './server/chatGenerationSettingsMutationKeys'

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
  method: CharacterOwnedDurableBatchStep['method']
  path: string
  body: Record<string, unknown>
  dependencyKeys?: string[]
  factory: (baseRevision: number, frozenBody: Readonly<Record<string, unknown>>) => Promise<ServerCommandResult>
  rollbackEntries: GlobalModuleRollbackEntry[]
}

const MODULE_COLLECTION_MUTATION_KEY = 'module-collection'
let nextScopedModuleOperationSequence = 0
const pendingScopedModuleOperations = new Map<string, PendingScopedModuleOperation[]>()

interface PendingScopedModuleOperation {
  sequence: number
  key: string
  status: 'pending' | 'failed'
  rollbackIfLiveMatches: () => boolean
}

function issueScopedModuleOperation(key: string, rollbackIfLiveMatches: () => boolean): PendingScopedModuleOperation {
  const operation: PendingScopedModuleOperation = {
    sequence: ++nextScopedModuleOperationSequence,
    key,
    status: 'pending',
    rollbackIfLiveMatches,
  }
  const pending = pendingScopedModuleOperations.get(key) ?? []
  pending.push(operation)
  pendingScopedModuleOperations.set(key, pending)
  return operation
}

function acceptScopedModuleOperation(operation: PendingScopedModuleOperation): void {
  const pending = pendingScopedModuleOperations.get(operation.key)
  if (!pending) return
  const index = pending.findIndex((candidate) => candidate.sequence === operation.sequence)
  if (index === -1) return
  const next = pending.filter(
    (candidate, candidateIndex) =>
      candidate.sequence !== operation.sequence && !(candidateIndex < index && candidate.status === 'failed'),
  )
  if (next.length > 0) pendingScopedModuleOperations.set(operation.key, next)
  else pendingScopedModuleOperations.delete(operation.key)
}

function rejectScopedModuleOperation(operation: PendingScopedModuleOperation): void {
  const pending = pendingScopedModuleOperations.get(operation.key)
  const current = pending?.find((candidate) => candidate.sequence === operation.sequence)
  if (!pending || !current) return
  current.status = 'failed'
  let changed = false
  while (pending.at(-1)?.status === 'failed') {
    changed = pending.pop()!.rollbackIfLiveMatches() || changed
  }
  if (pending.length > 0) pendingScopedModuleOperations.set(operation.key, pending)
  else pendingScopedModuleOperations.delete(operation.key)
  if (changed) reloadGuiAfterDefinitionChange()
}

export function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

interface ModuleDraftTopLevelPatch {
  values: ModuleSnapshot
  deletedKeys: string[]
}

function moduleDraftTopLevelPatch(baseline: RisuModule, draft: RisuModule): ModuleDraftTopLevelPatch {
  const baselineRecord = baseline as RisuModule & Record<string, unknown>
  const draftRecord = draft as RisuModule & Record<string, unknown>
  const values: ModuleSnapshot = {}
  const deletedKeys: string[] = []
  const keys = new Set([...Object.keys(baselineRecord), ...Object.keys(draftRecord)])

  for (const key of keys) {
    if (MODULE_PATCH_EXCLUDED_KEYS.has(key)) continue

    const baselineHasKey = hasOwnRecordKey(baselineRecord, key)
    const draftHasKey = hasOwnRecordKey(draftRecord, key)
    if (baselineHasKey === draftHasKey && (!draftHasKey || isJsonValueEqual(baselineRecord[key], draftRecord[key]))) {
      continue
    }

    if (draftHasKey) {
      values[key] = cloneJsonValue(draftRecord[key])
    } else {
      deletedKeys.push(key)
    }
  }

  return { values, deletedKeys }
}

/**
 * Rebase an editor draft onto the newest projected module without treating
 * untouched baseline fields as user edits. Changes within the same top-level
 * parent-owned field remain last-writer-wins, matching the server's sparse
 * module patch. Split-owned fields always stay on their newest projection.
 */
export function rebaseModuleDraftOntoLatest(baseline: RisuModule, draft: RisuModule, latest: RisuModule): RisuModule {
  const patch = moduleDraftTopLevelPatch(baseline, draft)
  const rebased = cloneJsonValue(latest) as RisuModule & Record<string, unknown>

  for (const [key, value] of Object.entries(patch.values)) {
    rebased[key] = cloneJsonValue(value)
  }
  for (const key of patch.deletedKeys) {
    delete rebased[key]
  }

  rebased.id = latest.id
  return rebased
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
  options: ServerCommandTransportOptions = {},
): Promise<ServerCommandResult<T>> {
  if (!canUseServerCommands()) return Promise.resolve({ status: 'unavailable' })
  return runServerCommand({ command, rollback, ...options })
}

export function dispatchCreateModule(
  module: RisuModule,
  previous: GlobalModuleStateSnapshot,
): Promise<ServerCommandResult> {
  if (!canUseServerCommands()) return Promise.resolve({ status: 'unavailable' })
  const moduleSnapshot = toModuleSnapshot(module)
  const rollbackEntry = moduleCreateRollbackEntry(moduleSnapshot as RisuModule)
  const operation = issueGlobalModuleOperation([rollbackEntry])
  const intent: DurableMutationIntent = {
    version: 1,
    dependencyKeys: [MODULE_COLLECTION_MUTATION_KEY],
    requests: [
      {
        method: 'POST',
        path: '/modules',
        body: { module: cloneJsonValue(moduleSnapshot) },
      },
    ],
  }
  const outbox = stagePendingMutation(moduleOwnerMutationKey(module.id), intent)
  recordPendingMutationProjectionTargets(outbox, globalModuleProjectionTargets([rollbackEntry]))
  return dispatchDurableMutation(outbox, intent, (transport) =>
    runModuleCommand(
      async (baseRevision) => {
        const result = await createModuleCommand(
          { baseRevision, module: cloneJsonValue(moduleSnapshot) },
          transport.signal,
          true,
        )
        if (result.status === 'ok') {
          clearGlobalModuleOperation(operation)
        }
        return result
      },
      () => rollbackGlobalModuleEntries([rollbackEntry], operation),
      transport,
    ),
  )
}

export function dispatchUpdateModule(
  moduleId: string,
  patch: ModuleSnapshot,
  previous: GlobalModuleStateSnapshot,
): Promise<ServerCommandResult> | null {
  const commandPatch = changedModulePatch(moduleId, patch, previous, { complete: true })
  if (Object.keys(commandPatch).length === 0) return null
  if (!canUseServerCommands()) return Promise.resolve({ status: 'unavailable' })
  applyModuleDeletionSentinelsOptimistically(moduleId, commandPatch)
  const rollbackEntries = moduleFieldRollbackEntries(moduleId, commandPatch, previous)
  const operation = rollbackEntries.length > 0 ? issueGlobalModuleOperation(rollbackEntries) : null
  const intent: DurableMutationIntent = {
    version: 1,
    dependencyKeys: [MODULE_COLLECTION_MUTATION_KEY],
    requests: [
      {
        method: 'PATCH',
        path: `/modules/${encodeURIComponent(moduleId)}`,
        body: { patch: cloneJsonValue(commandPatch) },
      },
    ],
  }
  const outbox = stagePendingMutation(moduleOwnerMutationKey(moduleId), intent)
  recordPendingMutationProjectionTargets(outbox, globalModuleProjectionTargets(rollbackEntries))
  return dispatchDurableMutation(outbox, intent, (transport) =>
    runModuleCommand(
      async (baseRevision) => {
        const result = await updateModuleCommand(
          { baseRevision, moduleId, patch: cloneJsonValue(commandPatch) },
          transport.signal,
          true,
        )
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
      transport,
    ),
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
        method: 'PATCH',
        path: `/modules/${encodeURIComponent(moduleId)}`,
        body: { patch: cloneJsonValue(commandPatch) },
        dependencyKeys: [moduleOwnerMutationKey(moduleId)],
        factory: (baseRevision, body) =>
          updateModuleCommand({ baseRevision, moduleId, patch: body.patch as ModuleSnapshot }, undefined, true),
        rollbackEntries,
      })
    }
  }

  if (enabled !== null) {
    steps.push({
      method: 'POST',
      path: '/modules/enable',
      body: { moduleId, enabled },
      dependencyKeys: [moduleOwnerMutationKey(moduleId)],
      factory: (baseRevision, body) =>
        enableModuleCommand(
          { baseRevision, moduleId: body.moduleId as string, enabled: body.enabled as boolean },
          undefined,
          true,
        ),
      rollbackEntries: [moduleEnableRollbackEntry(moduleId, enabled, previous)],
    })
  }

  runModuleCollectionPatchSteps(steps)
}

export function dispatchDeleteModule(moduleId: string, previous: GlobalModuleStateSnapshot): void {
  if (!canUseServerCommands()) return
  flushRegisteredPendingBridgePatches({})
  const rollbackEntries = moduleDeleteRollbackEntries(moduleId, previous)
  const operation = rollbackEntries.length > 0 ? issueGlobalModuleOperation(rollbackEntries) : null
  const intent: DurableMutationIntent = {
    version: 1,
    dependencyKeys: [MODULE_COLLECTION_MUTATION_KEY],
    requests: [
      {
        method: 'DELETE',
        path: `/modules/${encodeURIComponent(moduleId)}`,
        body: {},
      },
    ],
  }
  const outbox = stagePendingMutation(moduleOwnerMutationKey(moduleId), intent)
  recordPendingMutationProjectionTargets(outbox, globalModuleProjectionTargets(rollbackEntries))
  void dispatchDurableMutation(outbox, intent, (transport) =>
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
      transport,
    ),
  )
}

export function dispatchEnableModule(moduleId: string, enabled: boolean, previous: GlobalModuleStateSnapshot): void {
  if (!canUseServerCommands()) return
  const rollbackEntry = moduleEnableRollbackEntry(moduleId, enabled, previous)
  const operation = issueGlobalModuleOperation([rollbackEntry])
  const intent: DurableMutationIntent = {
    version: 1,
    dependencyKeys: [MODULE_COLLECTION_MUTATION_KEY],
    requests: [
      {
        method: 'POST',
        path: '/modules/enable',
        body: { moduleId, enabled },
      },
    ],
  }
  const outbox = stagePendingMutation(moduleOwnerMutationKey(moduleId), intent)
  recordPendingMutationProjectionTargets(outbox, globalModuleProjectionTargets([rollbackEntry]))
  void dispatchDurableMutation(outbox, intent, (transport) =>
    runModuleCommand(
      async (baseRevision) => {
        const result = await enableModuleCommand({ baseRevision, moduleId, enabled }, undefined, true)
        if (result.status === 'ok') {
          clearGlobalModuleOperation(operation)
        }
        return result
      },
      () => rollbackGlobalModuleEntries([rollbackEntry], operation),
      transport,
    ),
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

export async function createGlobalModule(module: RisuModule): Promise<ServerCommandResult | null> {
  if (canUseServerCommands()) {
    const previous = currentGlobalModuleStateSnapshot()
    applyOptimisticCreatedGlobalModule(module)
    return dispatchCreateModule(module, previous)
  }

  getDatabase().modules.push(module)
  reloadGuiAfterDefinitionChange()
  return null
}

export async function updateGlobalModule(moduleId: string, module: RisuModule): Promise<ServerCommandResult | null> {
  if (canUseServerCommands()) {
    const previous = currentGlobalModuleStateSnapshot()
    const moduleSnapshot = toModuleSnapshot(module)
    const commandPatch = changedModulePatch(moduleId, moduleSnapshot, previous, { complete: true })
    const applied = applyOptimisticGlobalModulePatch(moduleId, commandPatch)
    if (applied) reloadGuiAfterDefinitionChange()
    return dispatchUpdateModule(moduleId, moduleSnapshot, previous)
  }

  const index = getDatabase().modules.findIndex((candidate) => candidate.id === moduleId)
  if (index !== -1) {
    getDatabase().modules[index] = module
    reloadGuiAfterDefinitionChange()
  }
  return null
}

function applyOptimisticGlobalModulePatch(moduleId: string, patch: ModuleSnapshot): boolean {
  if (Object.keys(patch).length === 0) return false

  return withTrustedResourceWrite(() => {
    const modules = getDatabase().modules
    const index = modules.findIndex((candidate) => candidate.id === moduleId)
    if (index === -1) return false
    const nextModule = cloneJsonValue(modules[index]) as RisuModule & Record<string, unknown>

    for (const [field, value] of Object.entries(patch)) {
      if (value === null && MODULE_PATCH_DELETABLE_KEYS.has(field)) {
        delete nextModule[field]
      } else {
        nextModule[field] = cloneJsonValue(value)
      }
    }
    modules[index] = nextModule
    return true
  })
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
  runModuleCollectionPatchSteps([
    {
      method: 'POST',
      path: '/modules/reorder',
      body: { moduleIds: cloneJsonValue(attemptedModuleIds) },
      dependencyKeys: attemptedModuleIds.map(moduleOwnerMutationKey),
      factory: (baseRevision, body) =>
        reorderModulesCommand({ baseRevision, moduleIds: body.moduleIds as string[] }, undefined, true),
      rollbackEntries: [rollbackEntry],
    },
  ])
}

export function dispatchModuleCollectionPatch(
  modules: RisuModule[],
  previous: GlobalModuleStateSnapshot,
): Promise<CharacterOwnedDurableBatchResult> | null {
  if (!canUseServerCommands()) return null

  const beforeModules = new Map(previous.modules.map((module) => [module.id, module]))
  const nextModules = new Map(modules.map((module) => [module.id, module]))
  const steps: ModuleCollectionPatchStep[] = []

  for (const module of modules) {
    if (typeof module.id !== 'string' || module.id.trim() === '') continue
    const before = beforeModules.get(module.id)
    if (!before) {
      const moduleSnapshot = toModuleSnapshot(module)
      steps.push({
        method: 'POST',
        path: '/modules',
        body: { module: cloneJsonValue(moduleSnapshot) },
        dependencyKeys: [moduleOwnerMutationKey(module.id)],
        factory: (baseRevision, body) =>
          createModuleCommand({ baseRevision, module: body.module as ModuleSnapshot }, undefined, true),
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
      method: 'PATCH',
      path: `/modules/${encodeURIComponent(moduleId)}`,
      body: { patch: cloneJsonValue(commandPatch) },
      dependencyKeys: [moduleOwnerMutationKey(moduleId)],
      factory: (baseRevision, body) =>
        updateModuleCommand({ baseRevision, moduleId, patch: body.patch as ModuleSnapshot }, undefined, true),
      rollbackEntries,
    })
  }

  for (const module of previous.modules) {
    if (typeof module.id === 'string' && module.id.trim() && !nextModules.has(module.id)) {
      const moduleId = module.id
      const rollbackEntries = moduleDeleteRollbackEntries(moduleId, previous)
      if (rollbackEntries.length > 0) {
        steps.push({
          method: 'DELETE',
          path: `/modules/${encodeURIComponent(moduleId)}`,
          body: {},
          dependencyKeys: [moduleOwnerMutationKey(moduleId)],
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
      method: 'POST',
      path: '/modules/reorder',
      body: { moduleIds: cloneJsonValue(attemptedModuleIds) },
      dependencyKeys: attemptedModuleIds.map(moduleOwnerMutationKey),
      factory: (baseRevision, body) => reorderModulesCommand({ baseRevision, moduleIds: body.moduleIds as string[] }),
      rollbackEntries: [moduleOrderRollbackEntry(previous, attemptedModuleIds)],
    })
  }

  return runModuleCollectionPatchSteps(steps)
}

export function dispatchEnabledModulesPatch(
  enabledModules: unknown[],
  previous: GlobalModuleStateSnapshot,
  modules: RisuModule[],
): Promise<CharacterOwnedDurableBatchResult> | null {
  if (!canUseServerCommands()) return null

  const before = new Set(previous.enabledModules)
  const next = new Set(enabledModules.filter((id): id is string => typeof id === 'string'))
  const knownModules = new Set(modules.map((module) => module.id))
  const steps: ModuleCollectionPatchStep[] = []

  for (const moduleId of next) {
    if (!before.has(moduleId) && knownModules.has(moduleId)) {
      steps.push({
        method: 'POST',
        path: '/modules/enable',
        body: { moduleId, enabled: true },
        dependencyKeys: [moduleOwnerMutationKey(moduleId)],
        factory: (baseRevision, body) =>
          enableModuleCommand({
            baseRevision,
            moduleId: body.moduleId as string,
            enabled: body.enabled as boolean,
          }),
        rollbackEntries: [moduleEnableRollbackEntry(moduleId, true, previous)],
      })
    }
  }
  for (const moduleId of before) {
    if (!next.has(moduleId) && knownModules.has(moduleId)) {
      steps.push({
        method: 'POST',
        path: '/modules/enable',
        body: { moduleId, enabled: false },
        dependencyKeys: [moduleOwnerMutationKey(moduleId)],
        factory: (baseRevision, body) =>
          enableModuleCommand({
            baseRevision,
            moduleId: body.moduleId as string,
            enabled: body.enabled as boolean,
          }),
        rollbackEntries: [moduleEnableRollbackEntry(moduleId, false, previous)],
      })
    }
  }

  return runModuleCollectionPatchSteps(steps)
}

function runModuleCollectionPatchSteps(
  steps: ModuleCollectionPatchStep[],
): Promise<CharacterOwnedDurableBatchResult> | null {
  if (steps.length === 0) return null

  const operationSteps = steps.map((step) => ({
    ...step,
    operation: issueGlobalModuleOperation(step.rollbackEntries),
  }))

  const result = dispatchOwnedDurableBatch(
    MODULE_COLLECTION_MUTATION_KEY,
    operationSteps.map((step) => {
      const projectionTargets = globalModuleProjectionTargets(step.rollbackEntries)
      return {
        method: step.method,
        path: step.path,
        body: step.body,
        dependencyKeys: step.dependencyKeys,
        projectionTargets,
        command: async (baseRevision: number, body: Readonly<Record<string, unknown>>) => {
          const result = await step.factory(baseRevision, body)
          if (result.status === 'ok') clearGlobalModuleOperation(step.operation)
          return result
        },
        rollback: () => rollbackGlobalModuleEntries(step.rollbackEntries, step.operation),
        reapply: (isTargetCurrent: (target: string) => boolean) =>
          reapplyGlobalModuleEntries(step.rollbackEntries, isTargetCurrent),
      }
    }),
  )
  void result.then((outcome) => {
    // A retryable suffix is now an encrypted, replayable baseline. Remove its
    // in-memory rollback records so a later edit rolls back to that queued
    // projection instead of treating it as a failed local write.
    if (outcome.status !== 'retained') return
    for (const step of operationSteps.slice(outcome.acceptedCount)) {
      clearGlobalModuleOperation(step.operation)
    }
  })
  return result
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

function globalModuleProjectionTarget(entry: GlobalModuleRollbackEntry): string {
  if (entry.kind === 'module-enable') return pendingMutationModuleEnabledProjectionTarget(entry.moduleId)
  return entry.target
}

function globalModuleProjectionTargets(entries: readonly GlobalModuleRollbackEntry[]): string[] {
  return [
    ...new Set(
      entries.flatMap((entry) => [
        globalModuleProjectionTarget(entry),
        ...(entry.kind === 'module-field' ? [moduleRowRollbackTarget(entry.moduleId)] : []),
      ]),
    ),
  ]
}

function reapplyGlobalModuleEntries(
  entries: readonly GlobalModuleRollbackEntry[],
  isTargetCurrent: (target: string) => boolean,
): void {
  let changed = false
  withTrustedResourceWrite(() => {
    for (const entry of entries) {
      if (!isTargetCurrent(globalModuleProjectionTarget(entry))) continue
      changed = reapplyGlobalModuleEntryIfLiveMatchesPrevious(entry) || changed
    }
  })
  if (changed) reloadGuiAfterDefinitionChange()
}

function reapplyGlobalModuleEntryIfLiveMatchesPrevious(entry: GlobalModuleRollbackEntry): boolean {
  if (entry.kind === 'module-create') {
    const modules = getDatabase().modules ?? []
    if (modules.some((module) => module.id === entry.moduleId)) return false
    getDatabase().modules = [...modules, cloneJsonValue(entry.attemptedModule)]
    return true
  }
  if (entry.kind === 'module-field') {
    const module = getDatabase().modules?.find((candidate) => candidate.id === entry.moduleId) as
      | (RisuModule & Record<string, unknown>)
      | undefined
    if (!module) return false
    const liveExists = hasOwnRecordKey(module, entry.field)
    if (liveExists !== entry.previousExists) return false
    if (liveExists && !isJsonValueEqual(module[entry.field], entry.previousValue)) return false
    if (entry.attemptedExists) module[entry.field] = cloneJsonValue(entry.attemptedValue)
    else delete module[entry.field]
    return true
  }
  if (entry.kind === 'module-delete-row') {
    const modules = getDatabase().modules ?? []
    const index = modules.findIndex((module) => module.id === entry.moduleId)
    if (index === -1 || !isJsonValueEqual(modules[index], entry.previousModule)) return false
    getDatabase().modules = modules.filter((_, moduleIndex) => moduleIndex !== index)
    return true
  }
  if (entry.kind === 'module-enable') {
    const enabledModules = getDatabase().enabledModules ?? []
    const liveEnabled = enabledModules.includes(entry.moduleId)
    if (liveEnabled !== entry.previousEnabled || liveEnabled === entry.attemptedEnabled) return false
    if (entry.attemptedEnabled) getDatabase().enabledModules = [...enabledModules, entry.moduleId]
    else getDatabase().enabledModules = enabledModules.filter((moduleId) => moduleId !== entry.moduleId)
    return true
  }
  if (entry.kind === 'module-reference') {
    const target = findModuleReferenceTarget(entry)
    if (!target || !modulesFieldMatches(target, entry.previous)) return false
    restoreModulesField(target, entry.attempted)
    return true
  }

  const modules = getDatabase().modules ?? []
  if (
    !isStringArrayEqual(
      modules.map((module) => module.id),
      entry.previousModuleIds,
    )
  )
    return false
  const byId = new Map(modules.map((module) => [module.id, module]))
  const reordered = entry.attemptedModuleIds.map((moduleId) => byId.get(moduleId))
  if (reordered.some((module) => !module)) return false
  getDatabase().modules = reordered as RisuModule[]
  return true
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

interface ScopedModuleDurableBatchStep extends CharacterOwnedDurableBatchStep {
  operation: PendingScopedModuleOperation
}

function dispatchScopedModuleDurableBatch(
  characterId: string | undefined,
  steps: ScopedModuleDurableBatchStep[],
): void {
  void dispatchCharacterOwnedDurableBatch(characterId, steps).then((outcome) => {
    if (outcome.status !== 'retained') return
    for (const step of steps.slice(outcome.acceptedCount)) acceptScopedModuleOperation(step.operation)
  })
}

function chatForScopedModuleMutation(
  chatId: string,
  characterId?: string,
): { modules?: string[]; generationSettings?: ChatGenerationSettings } | null {
  const preferred = characterId ? findCharacterById(characterId) : undefined
  const preferredChat = preferred?.chats?.find((chat) => chat.id === chatId)
  if (preferredChat) return preferredChat
  for (const character of getDatabase().characters ?? []) {
    const chat = character.chats?.find((candidate) => candidate.id === chatId)
    if (chat) return chat
  }
  return null
}

function modulesFieldMatchesAttempt(target: { modules?: string[] }, attempted: readonly string[]): boolean {
  return (
    Object.prototype.hasOwnProperty.call(target, 'modules') && isStringArrayEqual(target.modules ?? [], [...attempted])
  )
}

function rollbackChatModuleAttempt(previous: ChatScopedSnapshot, attempted: readonly string[]): boolean {
  if (!previous.chatId || !previous.chat) return false
  let changed = false
  withTrustedResourceWrite(() => {
    const chat = chatForScopedModuleMutation(previous.chatId!, previous.characterId)
    if (!chat || !modulesFieldMatchesAttempt(chat, attempted)) return
    if (Object.prototype.hasOwnProperty.call(previous.chat, 'modules')) {
      chat.modules = cloneJsonValue(previous.chat!.modules)
    } else {
      delete chat.modules
    }
    changed = true
  })
  return changed
}

function rollbackCharacterModuleAttempt(previous: CharacterModuleStateSnapshot, attempted: readonly string[]): boolean {
  let changed = false
  withTrustedResourceWrite(() => {
    const character = findCharacterById(previous.characterId)
    if (!character || !modulesFieldMatchesAttempt(character, attempted)) return
    if (previous.hasModulesField) character.modules = cloneJsonValue(previous.modules)
    else delete character.modules
    changed = true
  })
  return changed
}

function rollbackGenerationSettingsAttempt(snapshot: ChatGenerationSettingsSnapshot): boolean {
  if (!snapshot.attemptedGenerationSettings) return false
  let changed = false
  withTrustedResourceWrite(() => {
    const chat = chatForScopedModuleMutation(snapshot.chatId, snapshot.characterId)
    if (!chat) return
    const row = chat as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(row, 'generationSettings')) return
    if (!isJsonValueEqual(chat.generationSettings, snapshot.attemptedGenerationSettings)) return
    if (snapshot.hadGenerationSettings) chat.generationSettings = cloneJsonValue(snapshot.generationSettings)
    else delete chat.generationSettings
    changed = true
  })
  return changed
}

function changedModuleProjectionTargets(previous: readonly string[], attempted: readonly string[]): string[] {
  const before = new Set(previous)
  const after = new Set(attempted)
  return [...new Set([...previous, ...attempted])]
    .filter((moduleId) => before.has(moduleId) !== after.has(moduleId))
    .map(pendingMutationModuleEnabledProjectionTarget)
}

function reapplyChatModuleAttempt(
  previous: ChatScopedSnapshot,
  attempted: readonly string[],
  isTargetCurrent: (target: string) => boolean,
): void {
  if (!previous.chatId || !previous.chat) return
  const chat = chatForScopedModuleMutation(previous.chatId, previous.characterId)
  if (!chat) return
  const previousModules = previous.chat.modules ?? []
  const before = new Set(previousModules)
  const after = new Set(attempted)
  let next = [...(chat.modules ?? [])]
  let changed = false
  for (const moduleId of new Set([...previousModules, ...attempted])) {
    if (before.has(moduleId) === after.has(moduleId)) continue
    if (!isTargetCurrent(pendingMutationModuleEnabledProjectionTarget(moduleId))) continue
    const liveHas = next.includes(moduleId)
    if (liveHas === after.has(moduleId) || liveHas !== before.has(moduleId)) continue
    if (after.has(moduleId)) {
      next.splice(boundedInsertIndex(attempted.indexOf(moduleId), next.length), 0, moduleId)
    } else {
      next = next.filter((candidate) => candidate !== moduleId)
    }
    changed = true
  }
  if (!changed) return
  withTrustedResourceWrite(() => {
    chat.modules = next
  })
  reloadGuiAfterDefinitionChange()
}

function reapplyCharacterModuleAttempt(
  previous: CharacterModuleStateSnapshot,
  attempted: readonly string[],
  projectionTarget: string,
  isTargetCurrent: (target: string) => boolean,
): void {
  if (!isTargetCurrent(projectionTarget)) return
  const character = findCharacterById(previous.characterId)
  if (!character) return
  const liveMatchesPrevious = previous.hasModulesField
    ? Object.prototype.hasOwnProperty.call(character, 'modules') &&
      isStringArrayEqual(character.modules ?? [], previous.modules ?? [])
    : !Object.prototype.hasOwnProperty.call(character, 'modules')
  if (!liveMatchesPrevious || modulesFieldMatchesAttempt(character, attempted)) return
  withTrustedResourceWrite(() => {
    character.modules = cloneJsonValue([...attempted])
  })
  reloadGuiAfterDefinitionChange()
}

function reapplyGenerationSettingsAttempt(
  snapshot: ChatGenerationSettingsSnapshot,
  projectionTarget: string,
  isTargetCurrent: (target: string) => boolean,
): void {
  if (!snapshot.attemptedGenerationSettings || !isTargetCurrent(projectionTarget)) return
  const chat = chatForScopedModuleMutation(snapshot.chatId, snapshot.characterId)
  if (!chat) return
  const hasLive = Object.prototype.hasOwnProperty.call(chat, 'generationSettings')
  const liveMatchesPrevious = snapshot.hadGenerationSettings
    ? hasLive && isJsonValueEqual(chat.generationSettings, snapshot.generationSettings)
    : !hasLive
  if (!liveMatchesPrevious || isJsonValueEqual(chat.generationSettings, snapshot.attemptedGenerationSettings)) return
  withTrustedResourceWrite(() => {
    chat.generationSettings = cloneJsonValue(snapshot.attemptedGenerationSettings)
  })
  reloadGuiAfterDefinitionChange()
}

function chatModuleDurableStep(
  chatId: string,
  nextModules: string[],
  previous: ChatScopedSnapshot,
): ScopedModuleDurableBatchStep {
  const commandModules = cloneJsonValue(nextModules)
  const operation = issueScopedModuleOperation(`chat-modules:${chatId}`, () =>
    rollbackChatModuleAttempt(previous, commandModules),
  )
  return {
    operation,
    method: 'PATCH',
    path: `/chats/${encodeURIComponent(chatId)}`,
    body: { patch: { modules: commandModules }, select: false },
    projectionTargets: changedModuleProjectionTargets(previous.chat?.modules ?? [], commandModules),
    command: async (baseRevision, body) => {
      const result = await updateChatCommand({
        baseRevision,
        chatId,
        patch: body.patch as ModuleSnapshot,
        select: body.select as boolean,
      })
      if (result.status === 'ok') acceptScopedModuleOperation(operation)
      return result
    },
    rollback: () => rejectScopedModuleOperation(operation),
    reapply: (isTargetCurrent) => reapplyChatModuleAttempt(previous, commandModules, isTargetCurrent),
  }
}

function characterModuleDurableStep(
  characterId: string,
  nextModules: string[],
  previous: CharacterModuleStateSnapshot,
): ScopedModuleDurableBatchStep {
  const commandModules = cloneJsonValue(nextModules)
  const path = `/characters/${encodeURIComponent(characterId)}/modules/reorder`
  const projectionTarget = `request:POST:${path}`
  const operation = issueScopedModuleOperation(`character-modules:${characterId}`, () =>
    rollbackCharacterModuleAttempt(previous, commandModules),
  )
  return {
    operation,
    method: 'POST',
    path,
    body: { moduleIds: commandModules },
    projectionTargets: [projectionTarget],
    command: async (baseRevision, body) => {
      const result = await reorderCharacterModulesCommand(
        { baseRevision, characterId, moduleIds: body.moduleIds as string[] },
        undefined,
        true,
      )
      if (result.status === 'ok') acceptScopedModuleOperation(operation)
      return result
    },
    rollback: () => rejectScopedModuleOperation(operation),
    reapply: (isTargetCurrent) =>
      reapplyCharacterModuleAttempt(previous, commandModules, projectionTarget, isTargetCurrent),
  }
}

function generationSettingsDurableStep(update: ActiveChatSidebarToggleDefaultUpdate): ScopedModuleDurableBatchStep {
  const commandSettings = cloneJsonValue(update.generationSettings)
  const rollback: ChatGenerationSettingsSnapshot = {
    ...update.rollback,
    attemptedGenerationSettings: commandSettings,
  }
  const projectionTarget = pendingMutationChatGenerationSettingsProjectionTarget(update.chatId)
  const operation = issueScopedModuleOperation(`chat-generation-settings:${update.chatId}`, () =>
    rollbackGenerationSettingsAttempt(rollback),
  )
  return {
    operation,
    method: 'PUT',
    path: `/chats/${encodeURIComponent(update.chatId)}/generation-settings`,
    body: { generationSettings: commandSettings },
    dependencyKeys: chatGenerationSettingsMutationDependencyKeys(commandSettings),
    projectionTargets: [projectionTarget],
    command: async (baseRevision, body) => {
      const result = await saveChatGenerationSettingsCommand({
        baseRevision,
        chatId: update.chatId,
        generationSettings: body.generationSettings as ChatGenerationSettings,
      })
      if (result.status === 'ok') acceptScopedModuleOperation(operation)
      return result
    },
    rollback: () => rejectScopedModuleOperation(operation),
    reapply: (isTargetCurrent) => reapplyGenerationSettingsAttempt(rollback, projectionTarget, isTargetCurrent),
  }
}

function dispatchUpdateChatScopedWithGenerationSettings(
  chatId: string,
  nextModules: string[],
  generationUpdate: ActiveChatSidebarToggleDefaultUpdate | null,
  previous: ChatScopedSnapshot,
): void {
  const steps = [chatModuleDurableStep(chatId, nextModules, previous)]
  if (generationUpdate) steps.push(generationSettingsDurableStep(generationUpdate))
  dispatchScopedModuleDurableBatch(previous.characterId, steps)
}

function dispatchReorderCharacterModulesWithGenerationSettings(
  characterId: string,
  nextModules: string[],
  previous: CharacterModuleStateSnapshot,
  generationUpdate: ActiveChatSidebarToggleDefaultUpdate | null,
): void {
  const steps = [characterModuleDurableStep(characterId, nextModules, previous)]
  if (generationUpdate) steps.push(generationSettingsDurableStep(generationUpdate))
  dispatchScopedModuleDurableBatch(characterId, steps)
}

export function dispatchReorderCharacterModules(characterId: string, previous: CharacterModuleStateSnapshot): void {
  const character = findCharacterById(characterId)
  if (!character) return
  dispatchReorderCharacterModulesWithGenerationSettings(characterId, character.modules ?? [], previous, null)
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
  dispatchUpdateChatScopedWithGenerationSettings(chat.id, nextModules, generationUpdate, previous)
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
  dispatchReorderCharacterModulesWithGenerationSettings(character.chaId, nextModules, previous, generationUpdate)
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
