import type { RisuPlugin } from './plugins/plugins.svelte'
import {
  bulkPluginStorageCommand,
  canUseServerCommands,
  createPluginCommand,
  deletePluginCommand,
  deletePluginStorageCommand,
  enablePluginCommand,
  patchServerBackedSettings,
  putPluginStorageCommand,
  reorderPluginsCommand,
  runServerCommand,
  selectPluginProviderCommand,
  settingsGroupForKey,
  updatePluginCommand,
  type PluginSnapshot,
  type ServerCommandResult,
} from './server/commands'
import { withTrustedServerProjectionWrite } from './server/projectionWriteGuard.svelte'
import { DBState } from './stores.svelte'

export interface PluginStateSnapshot {
  plugins: RisuPlugin[]
  currentPluginProvider: string
  pluginCustomStorage: Record<string, unknown>
}

export type PluginStorageSnapshot = Record<string, unknown>

const PLUGIN_PATCH_EXCLUDED_KEYS = new Set(['name'])
let pluginWatchSuppressionVersion = 0
let nextPluginStorageOperationSequence = 0
const pendingPluginStorageOperationsByKey = new Map<string, PluginStorageOperationRecord[]>()
let nextPluginNonStorageOperationSequence = 0
const pendingPluginNonStorageOperationsByTarget = new Map<string, PluginNonStorageOperationRecord[]>()

interface PluginStorageOperationToken {
  sequence: number
  keys: string[]
}

type PluginStorageOperationStatus = 'pending' | 'failed'

interface PluginStorageOperationRecord {
  sequence: number
  entry: PluginStorageRollbackEntry
  status: PluginStorageOperationStatus
}

interface PluginStorageRollbackEntry {
  key: string
  previousExists: boolean
  previousValue: unknown
  attemptedExists: boolean
  attemptedValue: unknown
}

interface PluginNonStorageOperationToken {
  sequence: number
  targets: string[]
}

type PluginNonStorageOperationStatus = 'pending' | 'failed'

interface PluginNonStorageOperationRecord {
  sequence: number
  entry: PluginNonStorageRollbackEntry
  status: PluginNonStorageOperationStatus
}

type PluginNonStorageRollbackEntry = PluginFieldRollbackEntry | PluginDeleteRollbackEntry | PluginProviderRollbackEntry

interface PluginFieldRollbackEntry {
  kind: 'plugin-field'
  target: string
  pluginId: string
  field: string
  previousExists: boolean
  previousValue: unknown
  attemptedExists: boolean
  attemptedValue: unknown
}

interface PluginDeleteRollbackEntry {
  kind: 'plugin-delete'
  target: string
  pluginId: string
  previousPlugin: RisuPlugin
  previousIndex: number
  providerChanged: boolean
  previousProvider: string
  attemptedProvider: string
}

interface PluginProviderRollbackEntry {
  kind: 'plugin-provider'
  target: string
  previousProvider: string
  attemptedProvider: string
}

export function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export function currentPluginStateSnapshot(): PluginStateSnapshot {
  return {
    plugins: cloneJsonValue(DBState.db.plugins ?? []),
    currentPluginProvider: DBState.db.currentPluginProvider ?? '',
    pluginCustomStorage: cloneJsonValue(DBState.db.pluginCustomStorage ?? {}),
  }
}

export function restorePluginState(snapshot: PluginStateSnapshot): void {
  withTrustedServerProjectionWrite(() => {
    pluginWatchSuppressionVersion += 1
    DBState.db.plugins = cloneJsonValue(snapshot.plugins)
    DBState.db.currentPluginProvider = snapshot.currentPluginProvider
    DBState.db.pluginCustomStorage = cloneJsonValue(snapshot.pluginCustomStorage)
  })
}

export function currentPluginWatchSuppressionVersion(): number {
  return pluginWatchSuppressionVersion
}

export function runPluginCommand<T extends Record<string, unknown>>(
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
  rollback: () => void,
): void {
  if (!canUseServerCommands()) return
  void runServerCommand({ command, rollback })
}

export function dispatchCreatePlugin(plugin: RisuPlugin, previous: PluginStateSnapshot): void {
  runPluginCommand(
    (baseRevision) =>
      createPluginCommand({
        baseRevision,
        plugin: toPluginSnapshot(plugin),
      }),
    () => restorePluginState(previous),
  )
}

export function dispatchUpdatePlugin(pluginId: string, patch: PluginSnapshot, previous: PluginStateSnapshot): void {
  const commandPatch = sanitizePluginPatch(patch)
  if (Object.keys(commandPatch).length === 0) return
  if (!canUseServerCommands()) return
  const rollbackEntry = realArgPluginFieldRollbackEntry(pluginId, commandPatch, previous)
  const operation = rollbackEntry ? issuePluginNonStorageOperation([rollbackEntry]) : null
  runPluginCommand(
    async (baseRevision) => {
      const result = await updatePluginCommand({
        baseRevision,
        pluginId,
        patch: commandPatch,
      })
      if (operation && result.status === 'ok') {
        clearPluginNonStorageOperation(operation)
      }
      return result
    },
    () => {
      if (rollbackEntry && operation) {
        rollbackPluginNonStorageEntries([rollbackEntry], operation)
      } else {
        restorePluginState(previous)
      }
    },
  )
}

export function dispatchDeletePlugin(pluginId: string, previous: PluginStateSnapshot): void {
  if (!canUseServerCommands()) return
  const rollbackEntry = deletePluginRollbackEntry(pluginId, previous)
  const operation = rollbackEntry ? issuePluginNonStorageOperation([rollbackEntry]) : null
  runPluginCommand(
    async (baseRevision) => {
      const result = await deletePluginCommand({
        baseRevision,
        pluginId,
      })
      if (operation && result.status === 'ok') {
        clearPluginNonStorageOperation(operation)
      }
      return result
    },
    () => {
      if (rollbackEntry && operation) {
        rollbackPluginNonStorageEntries([rollbackEntry], operation)
      } else {
        restorePluginState(previous)
      }
    },
  )
}

export function dispatchEnablePlugin(pluginId: string, enabled: boolean, previous: PluginStateSnapshot): void {
  if (!canUseServerCommands()) return
  const rollbackEntry = pluginFieldRollbackEntry(pluginId, 'enabled', previous, true, enabled)
  const operation = rollbackEntry ? issuePluginNonStorageOperation([rollbackEntry]) : null
  runPluginCommand(
    async (baseRevision) => {
      const result = await enablePluginCommand({
        baseRevision,
        pluginId,
        enabled,
      })
      if (operation && result.status === 'ok') {
        clearPluginNonStorageOperation(operation)
      }
      return result
    },
    () => {
      if (rollbackEntry && operation) {
        rollbackPluginNonStorageEntries([rollbackEntry], operation)
      } else {
        restorePluginState(previous)
      }
    },
  )
}

function findPluginByName(pluginName: string): { plugin: RisuPlugin; index: number } | null {
  const plugins = DBState.db.plugins ?? []
  const index = plugins.findIndex((plugin) => plugin.name === pluginName)
  if (index === -1) return null
  return { plugin: plugins[index], index }
}

export function setPluginArgument(pluginName: string, arg: string, value: number | string): boolean {
  const current = findPluginByName(pluginName)
  if (!current) return false

  const { plugin } = current
  const previous = currentPluginStateSnapshot()
  const nextRealArg = cloneJsonValue({
    ...(plugin.realArg ?? {}),
    [arg]: value,
  })

  withTrustedServerProjectionWrite(() => {
    const target = findPluginByName(pluginName)
    if (!target) return
    DBState.db.plugins[target.index] = {
      ...target.plugin,
      realArg: nextRealArg,
    }
  })
  dispatchUpdatePlugin(plugin.name, { realArg: nextRealArg }, previous)
  return true
}

export function togglePluginEnabled(pluginName: string): boolean {
  const current = findPluginByName(pluginName)
  if (!current) return false

  const { plugin } = current
  const previous = currentPluginStateSnapshot()
  const enabled = !plugin.enabled

  withTrustedServerProjectionWrite(() => {
    const target = findPluginByName(pluginName)
    if (!target) return
    DBState.db.plugins[target.index] = {
      ...target.plugin,
      enabled,
    }
  })
  dispatchEnablePlugin(plugin.name, enabled, previous)
  return true
}

export function deletePlugin(pluginName: string): boolean {
  const current = findPluginByName(pluginName)
  if (!current) return false

  const { plugin } = current
  const previous = currentPluginStateSnapshot()

  withTrustedServerProjectionWrite(() => {
    if (DBState.db.currentPluginProvider === plugin.name) {
      DBState.db.currentPluginProvider = ''
    }
    DBState.db.plugins = (DBState.db.plugins ?? []).filter((candidate) => candidate.name !== plugin.name)
  })
  dispatchDeletePlugin(plugin.name, previous)
  return true
}

export function dispatchSelectPluginProvider(provider: string, previous: PluginStateSnapshot): void {
  if (!canUseServerCommands()) return
  const rollbackEntry = pluginProviderRollbackEntry(provider, previous)
  const operation = issuePluginNonStorageOperation([rollbackEntry])
  runPluginCommand(
    async (baseRevision) => {
      const result = await selectPluginProviderCommand({
        baseRevision,
        provider,
      })
      if (result.status === 'ok') {
        clearPluginNonStorageOperation(operation)
      }
      return result
    },
    () => rollbackPluginNonStorageEntries([rollbackEntry], operation),
  )
}

export function dispatchReorderPlugins(previous: PluginStateSnapshot): void {
  runPluginCommand(
    (baseRevision) =>
      reorderPluginsCommand({
        baseRevision,
        pluginIds: (DBState.db.plugins ?? []).map((plugin) => plugin.name),
      }),
    () => restorePluginState(previous),
  )
}

function realArgPluginFieldRollbackEntry(
  pluginId: string,
  patch: PluginSnapshot,
  previous: PluginStateSnapshot,
): PluginFieldRollbackEntry | null {
  const patchKeys = Object.keys(patch)
  if (patchKeys.length !== 1 || !hasOwnRecordKey(patch as Record<string, unknown>, 'realArg')) return null
  return pluginFieldRollbackEntry(pluginId, 'realArg', previous, true, patch.realArg)
}

function pluginFieldRollbackEntry(
  pluginId: string,
  field: string,
  previous: PluginStateSnapshot,
  attemptedExists: boolean,
  attemptedValue: unknown,
): PluginFieldRollbackEntry | null {
  const previousPlugin = previous.plugins.find((plugin) => plugin.name === pluginId)
  if (!previousPlugin) return null
  const previousRecord = previousPlugin as unknown as Record<string, unknown>
  return {
    kind: 'plugin-field',
    target: pluginFieldRollbackTarget(pluginId, field),
    pluginId,
    field,
    previousExists: hasOwnRecordKey(previousRecord, field),
    previousValue: cloneJsonValue(previousRecord[field]),
    attemptedExists,
    attemptedValue: cloneJsonValue(attemptedValue),
  }
}

function deletePluginRollbackEntry(pluginId: string, previous: PluginStateSnapshot): PluginDeleteRollbackEntry | null {
  const previousIndex = previous.plugins.findIndex((plugin) => plugin.name === pluginId)
  if (previousIndex === -1) return null
  const providerChanged = previous.currentPluginProvider === pluginId
  return {
    kind: 'plugin-delete',
    target: pluginDeleteRollbackTarget(pluginId),
    pluginId,
    previousPlugin: cloneJsonValue(previous.plugins[previousIndex]),
    previousIndex,
    providerChanged,
    previousProvider: previous.currentPluginProvider,
    attemptedProvider: providerChanged ? '' : previous.currentPluginProvider,
  }
}

function pluginProviderRollbackEntry(provider: string, previous: PluginStateSnapshot): PluginProviderRollbackEntry {
  return {
    kind: 'plugin-provider',
    target: 'plugin-provider:current',
    previousProvider: previous.currentPluginProvider,
    attemptedProvider: provider,
  }
}

function issuePluginNonStorageOperation(entries: PluginNonStorageRollbackEntry[]): PluginNonStorageOperationToken {
  const token = {
    sequence: ++nextPluginNonStorageOperationSequence,
    targets: [...new Set(entries.map((entry) => entry.target))],
  }

  for (const entry of entries) {
    const pendingOperations = pendingPluginNonStorageOperationsByTarget.get(entry.target) ?? []
    pendingOperations.push({
      sequence: token.sequence,
      entry,
      status: 'pending',
    })
    pendingPluginNonStorageOperationsByTarget.set(entry.target, pendingOperations)
  }

  return token
}

function rollbackPluginNonStorageEntries(
  entries: PluginNonStorageRollbackEntry[],
  operation: PluginNonStorageOperationToken,
): void {
  let changed = false

  withTrustedServerProjectionWrite(() => {
    for (const entry of entries) {
      const pendingOperations = pendingPluginNonStorageOperationsByTarget.get(entry.target)
      const operationRecord = pendingOperations?.find((record) => record.sequence === operation.sequence)
      if (!pendingOperations || !operationRecord) continue

      operationRecord.status = 'failed'
      changed = cascadeFailedPluginNonStorageOperationsForTarget(entry.target, pendingOperations) || changed

      if (pendingOperations.length > 0) {
        pendingPluginNonStorageOperationsByTarget.set(entry.target, pendingOperations)
      } else {
        pendingPluginNonStorageOperationsByTarget.delete(entry.target)
      }
    }

    if (changed) {
      pluginWatchSuppressionVersion += 1
    }
  })
}

function cascadeFailedPluginNonStorageOperationsForTarget(
  target: string,
  pendingOperations: PluginNonStorageOperationRecord[],
): boolean {
  let changed = false

  while (pendingOperations.length > 0) {
    const latestOperation = pendingOperations[pendingOperations.length - 1]
    if (latestOperation.status !== 'failed') break

    if (rollbackPluginNonStorageEntryIfLiveMatches(latestOperation.entry)) {
      changed = true
    }
    pendingOperations.pop()
  }

  if (pendingOperations.length > 0) {
    pendingPluginNonStorageOperationsByTarget.set(target, pendingOperations)
  } else {
    pendingPluginNonStorageOperationsByTarget.delete(target)
  }

  return changed
}

function rollbackPluginNonStorageEntryIfLiveMatches(entry: PluginNonStorageRollbackEntry): boolean {
  if (entry.kind === 'plugin-field') {
    return rollbackPluginFieldIfLiveMatches(entry)
  }
  if (entry.kind === 'plugin-delete') {
    return rollbackPluginDeleteIfLiveMatches(entry)
  }
  return rollbackPluginProviderIfLiveMatches(entry)
}

function rollbackPluginFieldIfLiveMatches(entry: PluginFieldRollbackEntry): boolean {
  const plugins = DBState.db.plugins ?? []
  const index = plugins.findIndex((plugin) => plugin.name === entry.pluginId)
  if (index === -1) return false

  const livePlugin = plugins[index] as RisuPlugin & Record<string, unknown>
  const liveExists = hasOwnRecordKey(livePlugin, entry.field)
  if (entry.attemptedExists) {
    if (!liveExists || !isJsonValueEqual(livePlugin[entry.field], entry.attemptedValue)) return false
  } else if (liveExists) {
    return false
  }

  const nextPlugin = {
    ...livePlugin,
  }

  if (entry.previousExists) {
    nextPlugin[entry.field] = cloneJsonValue(entry.previousValue)
  } else {
    delete nextPlugin[entry.field]
  }

  DBState.db.plugins[index] = nextPlugin
  return true
}

function rollbackPluginDeleteIfLiveMatches(entry: PluginDeleteRollbackEntry): boolean {
  let changed = false
  const plugins = DBState.db.plugins ?? []
  const liveIndex = plugins.findIndex((plugin) => plugin.name === entry.pluginId)

  if (liveIndex === -1) {
    const nextPlugins = [...plugins]
    const insertIndex = boundedInsertIndex(entry.previousIndex, nextPlugins.length)
    nextPlugins.splice(insertIndex, 0, cloneJsonValue(entry.previousPlugin))
    DBState.db.plugins = nextPlugins
    changed = true
  }

  if (entry.providerChanged && (DBState.db.currentPluginProvider ?? '') === entry.attemptedProvider) {
    DBState.db.currentPluginProvider = entry.previousProvider
    changed = true
  }

  return changed
}

function rollbackPluginProviderIfLiveMatches(entry: PluginProviderRollbackEntry): boolean {
  if ((DBState.db.currentPluginProvider ?? '') !== entry.attemptedProvider) return false
  DBState.db.currentPluginProvider = entry.previousProvider
  return true
}

function clearPluginNonStorageOperation(operation: PluginNonStorageOperationToken): void {
  for (const target of operation.targets) {
    const pendingOperations = pendingPluginNonStorageOperationsByTarget.get(target)
    if (!pendingOperations) continue

    const operationIndex = pendingOperations.findIndex((record) => record.sequence === operation.sequence)
    if (operationIndex === -1) continue

    const nextPendingOperations = pendingOperations.filter(
      (record, index) =>
        record.sequence !== operation.sequence && !(index < operationIndex && record.status === 'failed'),
    )
    if (nextPendingOperations.length > 0) {
      pendingPluginNonStorageOperationsByTarget.set(target, nextPendingOperations)
    } else {
      pendingPluginNonStorageOperationsByTarget.delete(target)
    }
  }
}

function pluginFieldRollbackTarget(pluginId: string, field: string): string {
  return `plugin-field:${pluginId}:${field}`
}

function pluginDeleteRollbackTarget(pluginId: string): string {
  return `plugin-delete:${pluginId}`
}

function boundedInsertIndex(index: number, length: number): number {
  if (index < 0) return 0
  if (index > length) return length
  return index
}

export function currentPluginStorageSnapshot(): PluginStorageSnapshot {
  return cloneJsonValue(DBState.db.pluginCustomStorage ?? {})
}

export function restorePluginStorage(snapshot: PluginStorageSnapshot): void {
  withTrustedServerProjectionWrite(() => {
    pluginWatchSuppressionVersion += 1
    DBState.db.pluginCustomStorage = cloneJsonValue(snapshot)
  })
}

export function dispatchPutPluginStorage(key: string, value: unknown, previous: PluginStorageSnapshot): void {
  const attemptedValue = cloneJsonValue(value)
  const rollbackEntry = pluginStorageRollbackEntryForKey(previous, key, true, attemptedValue)
  const operation = issuePluginStorageOperation([rollbackEntry])
  runPluginCommand(
    async (baseRevision) => {
      const result = await putPluginStorageCommand({
        baseRevision,
        key,
        value: attemptedValue,
      })
      if (result.status === 'ok') {
        clearPluginStorageOperation(operation)
      }
      return result
    },
    () => rollbackPluginStorageEntries([rollbackEntry], operation),
  )
}

export function dispatchDeletePluginStorage(key: string, previous: PluginStorageSnapshot): void {
  const rollbackEntry = pluginStorageRollbackEntryForKey(previous, key, false, undefined)
  const operation = issuePluginStorageOperation([rollbackEntry])
  runPluginCommand(
    async (baseRevision) => {
      const result = await deletePluginStorageCommand({
        baseRevision,
        key,
      })
      if (result.status === 'ok') {
        clearPluginStorageOperation(operation)
      }
      return result
    },
    () => rollbackPluginStorageEntries([rollbackEntry], operation),
  )
}

export function dispatchBulkPluginStorage(
  input: {
    values?: Record<string, unknown>
    deleteKeys?: string[]
    clear?: boolean
  },
  previous: PluginStorageSnapshot,
): void {
  const values = cloneJsonValue(input.values ?? {})
  const deleteKeys = [...(input.deleteKeys ?? [])]
  if (!input.clear && Object.keys(values).length === 0 && deleteKeys.length === 0) return
  const rollbackEntries = buildBulkPluginStorageRollbackEntries(
    {
      values,
      deleteKeys,
      clear: input.clear ?? false,
    },
    previous,
  )
  const operation = issuePluginStorageOperation(rollbackEntries)
  runPluginCommand(
    async (baseRevision) => {
      const result = await bulkPluginStorageCommand({
        baseRevision,
        values,
        deleteKeys,
        clear: input.clear,
      })
      if (result.status === 'ok') {
        clearPluginStorageOperation(operation)
      }
      return result
    },
    () => rollbackPluginStorageEntries(rollbackEntries, operation),
  )
}

function pluginStorageRollbackEntryForKey(
  previous: PluginStorageSnapshot,
  key: string,
  attemptedExists: boolean,
  attemptedValue: unknown,
): PluginStorageRollbackEntry {
  return {
    key,
    previousExists: hasOwnRecordKey(previous, key),
    previousValue: cloneJsonValue(previous[key]),
    attemptedExists,
    attemptedValue: cloneJsonValue(attemptedValue),
  }
}

function buildBulkPluginStorageRollbackEntries(
  input: {
    values: Record<string, unknown>
    deleteKeys: string[]
    clear: boolean
  },
  previous: PluginStorageSnapshot,
): PluginStorageRollbackEntry[] {
  const affectedKeys = new Set<string>()
  const attempted = input.clear ? {} : cloneJsonValue(previous)

  if (input.clear) {
    for (const key of Object.keys(previous)) {
      affectedKeys.add(key)
    }
  }

  for (const key of input.deleteKeys) {
    affectedKeys.add(key)
    delete attempted[key]
  }

  for (const [key, value] of Object.entries(input.values)) {
    affectedKeys.add(key)
    attempted[key] = cloneJsonValue(value)
  }

  return [...affectedKeys].map((key) =>
    pluginStorageRollbackEntryForKey(previous, key, hasOwnRecordKey(attempted, key), attempted[key]),
  )
}

function rollbackPluginStorageEntries(
  entries: PluginStorageRollbackEntry[],
  operation: PluginStorageOperationToken,
): void {
  let changed = false

  withTrustedServerProjectionWrite(() => {
    const liveStorage = ensureLivePluginStorage()

    for (const entry of entries) {
      const pendingOperations = pendingPluginStorageOperationsByKey.get(entry.key)
      const operationRecord = pendingOperations?.find((record) => record.sequence === operation.sequence)
      if (!pendingOperations || !operationRecord) continue

      operationRecord.status = 'failed'
      changed = cascadeFailedPluginStorageOperationsForKey(entry.key, pendingOperations, liveStorage) || changed

      if (pendingOperations.length > 0) {
        pendingPluginStorageOperationsByKey.set(entry.key, pendingOperations)
      } else {
        pendingPluginStorageOperationsByKey.delete(entry.key)
      }
    }

    if (changed) {
      pluginWatchSuppressionVersion += 1
    }
  })
}

function ensureLivePluginStorage(): Record<string, unknown> {
  if (!DBState.db.pluginCustomStorage || typeof DBState.db.pluginCustomStorage !== 'object') {
    DBState.db.pluginCustomStorage = {}
  }
  return DBState.db.pluginCustomStorage as Record<string, unknown>
}

function issuePluginStorageOperation(entries: PluginStorageRollbackEntry[]): PluginStorageOperationToken {
  const token = {
    sequence: ++nextPluginStorageOperationSequence,
    keys: [...new Set(entries.map((entry) => entry.key))],
  }

  for (const entry of entries) {
    const pendingOperations = pendingPluginStorageOperationsByKey.get(entry.key) ?? []
    pendingOperations.push({
      sequence: token.sequence,
      entry,
      status: 'pending',
    })
    pendingPluginStorageOperationsByKey.set(entry.key, pendingOperations)
  }

  return token
}

function cascadeFailedPluginStorageOperationsForKey(
  key: string,
  pendingOperations: PluginStorageOperationRecord[],
  liveStorage: Record<string, unknown>,
): boolean {
  let changed = false

  while (pendingOperations.length > 0) {
    const latestOperation = pendingOperations[pendingOperations.length - 1]
    if (latestOperation.status !== 'failed') break

    if (rollbackPluginStorageEntryIfLiveMatches(liveStorage, latestOperation.entry)) {
      changed = true
    }
    pendingOperations.pop()
  }

  if (pendingOperations.length > 0) {
    pendingPluginStorageOperationsByKey.set(key, pendingOperations)
  } else {
    pendingPluginStorageOperationsByKey.delete(key)
  }

  return changed
}

function rollbackPluginStorageEntryIfLiveMatches(
  liveStorage: Record<string, unknown>,
  entry: PluginStorageRollbackEntry,
): boolean {
  const liveExists = hasOwnRecordKey(liveStorage, entry.key)
  if (entry.attemptedExists) {
    if (!liveExists || !isJsonValueEqual(liveStorage[entry.key], entry.attemptedValue)) return false
  } else if (liveExists) {
    return false
  }

  if (entry.previousExists) {
    liveStorage[entry.key] = cloneJsonValue(entry.previousValue)
    return true
  }

  if (liveExists) {
    delete liveStorage[entry.key]
    return true
  }

  return false
}

function clearPluginStorageOperation(operation: PluginStorageOperationToken): void {
  for (const key of operation.keys) {
    const pendingOperations = pendingPluginStorageOperationsByKey.get(key)
    if (!pendingOperations) continue

    const operationIndex = pendingOperations.findIndex((record) => record.sequence === operation.sequence)
    if (operationIndex === -1) continue

    const nextPendingOperations = pendingOperations.filter(
      (record, index) =>
        record.sequence !== operation.sequence && !(index < operationIndex && record.status === 'failed'),
    )
    if (nextPendingOperations.length > 0) {
      pendingPluginStorageOperationsByKey.set(key, nextPendingOperations)
    } else {
      pendingPluginStorageOperationsByKey.delete(key)
    }
  }
}

function hasOwnRecordKey(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function isJsonValueEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function dispatchPluginSettingsPatch(patch: Record<string, unknown>, previous: PluginStateSnapshot): void {
  if (!canUseServerCommands()) return
  const settingsPatch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (settingsGroupForKey(key) && value !== undefined) {
      settingsPatch[key] = cloneJsonValue(value)
    }
  }
  if (Object.keys(settingsPatch).length === 0) return
  void patchServerBackedSettings({
    patch: settingsPatch,
    rollback: () => restorePluginState(previous),
  })
}

export function toPluginSnapshot(plugin: RisuPlugin): PluginSnapshot {
  return cloneJsonValue(plugin) as PluginSnapshot
}

export function sanitizePluginPatch(patch: PluginSnapshot): PluginSnapshot {
  const sanitized: PluginSnapshot = {}
  for (const [key, value] of Object.entries(patch)) {
    if (PLUGIN_PATCH_EXCLUDED_KEYS.has(key) || value === undefined) continue
    sanitized[key] = value
  }
  return sanitized
}
