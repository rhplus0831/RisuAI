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
  runPluginCommand(
    (baseRevision) =>
      updatePluginCommand({
        baseRevision,
        pluginId,
        patch: commandPatch,
      }),
    () => restorePluginState(previous),
  )
}

export function dispatchDeletePlugin(pluginId: string, previous: PluginStateSnapshot): void {
  runPluginCommand(
    (baseRevision) =>
      deletePluginCommand({
        baseRevision,
        pluginId,
      }),
    () => restorePluginState(previous),
  )
}

export function dispatchEnablePlugin(pluginId: string, enabled: boolean, previous: PluginStateSnapshot): void {
  runPluginCommand(
    (baseRevision) =>
      enablePluginCommand({
        baseRevision,
        pluginId,
        enabled,
      }),
    () => restorePluginState(previous),
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
  runPluginCommand(
    (baseRevision) =>
      selectPluginProviderCommand({
        baseRevision,
        provider,
      }),
    () => restorePluginState(previous),
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
