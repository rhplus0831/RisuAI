import type { RisuPlugin } from './plugins/plugins.svelte'
import type { Chat, character } from './storage/database.svelte'
import type { Database } from './storage/databaseTypes'
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
  type ServerCommandTransportOptions,
  type SettingsGroup,
} from './server/commands'
import { dispatchDurableMutation, registerDurableMutationSettlementListener } from './server/durableMutationDispatch'
import { PLUGIN_COLLECTION_MUTATION_KEY, PLUGIN_STORAGE_MUTATION_KEY } from './server/pluginMutationKeys'
import {
  stagePendingMutation,
  type DurableMutationIntent,
  type DurableMutationRequest,
} from './server/pendingMutationOutbox'
import {
  charactersResourceState,
  collectionsResourceState,
  getCharacterResourceOwner,
  settingsResourceState,
} from './server/resourceState.svelte'
import { SETTINGS_BRIDGE_MUTATION_KEY } from './server/settingsMutationKey'
import { applyAttemptedFieldRollback } from './server/staleStateGuards'

export interface PluginStateSnapshot {
  plugins: RisuPlugin[]
  currentPluginProvider: string
  pluginCustomStorage: Record<string, unknown>
}

export interface PluginChatOwnerSnapshot {
  characterId: string
  chatId: string
  chat: Chat
}

export type PluginStorageSnapshot = Record<string, unknown>

export interface PluginSettingsPatchRollbackSnapshot {
  previous: Record<string, unknown>
  attempted: Record<string, unknown>
}

interface PluginSettingsPatchRollbackStep {
  patch: Record<string, unknown>
  group: SettingsGroup
  rollbackSnapshot: PluginSettingsPatchRollbackSnapshot
}

export type PluginMutationFinalSettlement = { status: 'accepted' } | { status: 'failed' }

export type PluginMutationOutcome =
  | { status: 'accepted'; result: Extract<ServerCommandResult, { status: 'ok' }> }
  | {
      status: 'queued'
      result: Exclude<ServerCommandResult, { status: 'ok' }>
      mutationId: string
      settlement: Promise<PluginMutationFinalSettlement>
    }
  | { status: 'failed'; result: Exclude<ServerCommandResult, { status: 'ok' }> }

export interface PluginMutationBatchOutcome {
  status: 'accepted' | 'queued' | 'failed'
  acceptedCount: number
  outcomes: PluginMutationOutcome[]
}

const PLUGIN_PATCH_EXCLUDED_KEYS = new Set(['name'])
const PLUGIN_PATCH_DELETABLE_KEYS = new Set([
  'version',
  'displayName',
  'versionOfPlugin',
  'updateURL',
  'enabled',
  'allowedIPC',
])
let pluginWatchSuppressionVersion = 0
let nextPluginStorageOperationSequence = 0
const pendingPluginStorageOperationsByKey = new Map<string, PluginStorageOperationRecord[]>()
let nextPluginNonStorageOperationSequence = 0
const pendingPluginNonStorageOperationsByTarget = new Map<string, PluginNonStorageOperationRecord[]>()
let acceptedPluginRuntimeBaseline: RisuPlugin[] | null = null

const PLUGIN_RUNTIME_FIELDS = new Set(['script', 'enabled', 'version', 'allowedIPC'])

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

type PluginNonStorageRollbackEntry =
  | PluginCreateRollbackEntry
  | PluginFieldRollbackEntry
  | PluginDeleteRollbackEntry
  | PluginProviderRollbackEntry
  | PluginOrderRollbackEntry

interface PluginCreateRollbackEntry {
  kind: 'plugin-create'
  target: string
  pluginId: string
  attemptedPlugin: RisuPlugin
}

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

interface PluginOrderRollbackEntry {
  kind: 'plugin-order'
  target: string
  previousPluginIds: string[]
  attemptedPluginIds: string[]
}

interface PluginCollectionPatchStep {
  request: DurableMutationRequest
  factory: (baseRevision: number, signal?: AbortSignal | null) => Promise<ServerCommandResult>
  rollbackEntries: PluginNonStorageRollbackEntry[]
}

interface PendingPluginMutationExecution {
  promise: Promise<ServerCommandResult>
  disposition: () => 'retain' | 'rollback'
  mutationId: string
  settlement: Promise<PluginMutationFinalSettlement>
}

export function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

/** Read one explicit plugin collection owner without exposing the aggregate facade. */
export function currentPluginCollectionSnapshot(): RisuPlugin[] {
  const plugins = collectionsResourceState.values.plugins
  return Array.isArray(plugins) ? cloneJsonValue(plugins as RisuPlugin[]) : []
}

/** Read one explicit plugin-storage owner without exposing the aggregate facade. */
export function currentPluginStorageOwnerSnapshot(): PluginStorageSnapshot {
  const storage = collectionsResourceState.values.pluginCustomStorage
  return storage && typeof storage === 'object' && !Array.isArray(storage)
    ? cloneJsonValue(storage as Record<string, unknown>)
    : {}
}

/** Read one plugin-storage value for APIs that clone only the requested entry. */
export function currentPluginStorageValueOwner(key: string): unknown {
  const storage = collectionsResourceState.values.pluginCustomStorage
  return storage && typeof storage === 'object' && !Array.isArray(storage)
    ? (storage as Record<string, unknown>)[key]
    : undefined
}

/** Read the plugin-provider settings owner as a detached scalar. */
export function currentPluginProviderOwnerSnapshot(): string {
  const provider = (settingsResourceState.value as Record<string, unknown>).currentPluginProvider
  return typeof provider === 'string' ? provider : ''
}

/** Read selected settings owner fields as detached values. */
export function currentPluginSettingsOwnerSnapshot(keys: readonly string[]): Record<string, unknown> {
  const settings = settingsResourceState.value as Record<string, unknown>
  return Object.fromEntries(keys.map((key) => [key, cloneJsonValue(settings[key])]))
}

/** Materialize the complete plugin-facing database shape from explicit owners. */
export function currentPluginDatabaseSnapshot(): Record<string, unknown> {
  return cloneJsonValue({
    ...(settingsResourceState.value as Record<string, unknown>),
    ...(collectionsResourceState.values as Record<string, unknown>),
    characters: charactersResourceState.characters,
    characterOrder: charactersResourceState.characterOrder,
    currentChar: charactersResourceState.currentChar,
  })
}

/** Resolve a unique character owner by its visible collection index. */
export function currentPluginCharacterSnapshot(index: number): character | undefined {
  const candidate = charactersResourceState.characters[index]
  if (!candidate?.chaId) return undefined
  const owner = getCharacterResourceOwner(candidate.chaId)
  return owner === candidate ? cloneJsonValue(candidate) : undefined
}

/** Resolve a unique character owner by stable id. */
export function currentPluginCharacterOwnerSnapshot(characterId: string): character | undefined {
  const owner = getCharacterResourceOwner(characterId)
  return owner ? cloneJsonValue(owner) : undefined
}

/** Resolve a unique chat owner beneath one unique character owner. */
export function currentPluginChatOwnerSnapshot(
  characterId: string,
  chatId: string,
): PluginChatOwnerSnapshot | undefined {
  const character = getCharacterResourceOwner(characterId)
  if (!character || typeof chatId !== 'string' || chatId.trim() === '') return undefined
  const matches = (character.chats ?? []).filter((chat) => chat?.id === chatId)
  if (matches.length !== 1) return undefined
  return { characterId, chatId, chat: cloneJsonValue(matches[0]) }
}

/** Replace one unique character owner after validating its stable id. */
export function replacePluginCharacterOwnerAt(index: number, characterId: string, nextCharacter: character): boolean {
  const owner = getCharacterResourceOwner(characterId)
  if (!owner || owner !== charactersResourceState.characters[index] || nextCharacter?.chaId !== characterId)
    return false
  charactersResourceState.characters[index] = cloneJsonValue(nextCharacter)
  return true
}

/** Replace the explicit character-list owner for local compatibility writes. */
export function replacePluginCharactersOwner(characters: readonly character[]): void {
  charactersResourceState.characters = cloneJsonValue([...characters])
}

/** Apply the explicit character-order/selection owners for local compatibility writes. */
export function applyPluginCharacterPointerOwner(key: 'characterOrder' | 'currentChar', value: unknown): void {
  const settings = settingsResourceState.value as Record<string, unknown>
  if (key === 'characterOrder' && Array.isArray(value)) {
    const order = cloneJsonValue(value) as Database['characterOrder']
    charactersResourceState.characterOrder = order
    settings.characterOrder = cloneJsonValue(order)
  } else if (key === 'currentChar' && Number.isInteger(value)) {
    charactersResourceState.currentChar = value as number
    settings.currentChar = value as number
  }
}

/** Replace one unique chat owner after validating both stable ids. */
export function replacePluginChatOwner(characterId: string, chatId: string, nextChat: Chat): boolean {
  const character = getCharacterResourceOwner(characterId)
  if (!character || nextChat?.id !== chatId) return false
  const matches = (character.chats ?? []).filter((chat) => chat?.id === chatId)
  if (matches.length !== 1) return false
  const index = character.chats.indexOf(matches[0])
  if (index < 0) return false
  character.chats[index] = cloneJsonValue(nextChat)
  return true
}

/** Replace the explicit plugin collection owner with an immutable snapshot. */
export function replacePluginCollectionOwner(plugins: readonly RisuPlugin[]): void {
  collectionsResourceState.values.plugins = cloneJsonValue(plugins) as typeof collectionsResourceState.values.plugins
}

/** Replace the explicit plugin-storage owner with an immutable snapshot. */
export function replacePluginStorageOwner(storage: Record<string, unknown>): void {
  collectionsResourceState.values.pluginCustomStorage = cloneJsonValue(
    storage,
  ) as typeof collectionsResourceState.values.pluginCustomStorage
}

/** Apply a settings-owner patch without entering the aggregate write guard. */
export function applyPluginSettingsOwnerPatch(patch: Record<string, unknown>): void {
  const settings = settingsResourceState.value as Record<string, unknown>
  for (const [key, value] of Object.entries(patch)) settings[key] = cloneJsonValue(value)
}

/** Apply the provider owner as a scoped settings write. */
export function applyPluginProviderOwner(provider: string): void {
  ;(settingsResourceState.value as Record<string, unknown>).currentPluginProvider = provider
}

export function currentPluginStateSnapshot(): PluginStateSnapshot {
  return {
    plugins: currentPluginCollectionSnapshot(),
    currentPluginProvider: currentPluginProviderOwnerSnapshot(),
    pluginCustomStorage: currentPluginStorageOwnerSnapshot(),
  }
}

export function restorePluginState(snapshot: PluginStateSnapshot): void {
  pluginWatchSuppressionVersion += 1
  replacePluginCollectionOwner(snapshot.plugins)
  applyPluginProviderOwner(snapshot.currentPluginProvider)
  replacePluginStorageOwner(snapshot.pluginCustomStorage)
}

export function currentPluginWatchSuppressionVersion(): number {
  return pluginWatchSuppressionVersion
}

export function currentPluginSettingsPatchRollbackSnapshot(
  patch: Record<string, unknown>,
): PluginSettingsPatchRollbackSnapshot {
  const snapshot = emptyPluginSettingsPatchRollbackSnapshot()
  captureCurrentPluginSettingsPatchRollbackEntries(snapshot, patch)
  return snapshot
}

export function runPluginCommand<T extends Record<string, unknown>>(
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
  rollback: () => void,
  options: ServerCommandTransportOptions = {},
): Promise<ServerCommandResult<T>> | null {
  if (!canUseServerCommands()) return null
  return runServerCommand({ command, rollback, ...options })
}

function dispatchPluginDurableMutation<T extends Record<string, unknown>>(
  key: string,
  intent: DurableMutationIntent,
  command: (baseRevision: number, signal?: AbortSignal | null) => Promise<ServerCommandResult<T>>,
  rollback: () => void,
  options: PluginDurableTransportOptions<T> = {},
): PendingPluginMutationExecution {
  return dispatchPluginDurableTransport(
    key,
    intent,
    (transport) => {
      return (
        runPluginCommand((baseRevision) => command(baseRevision, transport.signal), rollback, transport) ??
        Promise.resolve({ status: 'unavailable' as const })
      )
    },
    {
      ...options,
      onReplayDiscarded: options.onReplayDiscarded ?? rollback,
    },
  )
}

function dispatchPluginDurableTransport<T extends Record<string, unknown>>(
  key: string,
  intent: DurableMutationIntent,
  dispatch: (transport: ServerCommandTransportOptions) => Promise<ServerCommandResult<T>>,
  options: PluginDurableTransportOptions<T> = {},
): PendingPluginMutationExecution {
  const outbox = stagePendingMutation(key, intent)
  let disposition: 'retain' | 'rollback' = 'rollback'
  let failureRollbackDisposition: ServerCommandTransportOptions['failureRollbackDisposition']
  let resolveSettlement!: (settlement: PluginMutationFinalSettlement) => void
  let finalSettlementPublished = false
  let removeSettlementListener = () => {}
  const settlement = new Promise<PluginMutationFinalSettlement>((resolve) => {
    resolveSettlement = resolve
  })
  const publishFinalSettlement = (status: PluginMutationFinalSettlement['status']) => {
    if (finalSettlementPublished) return
    finalSettlementPublished = true
    removeSettlementListener()
    resolveSettlement({ status })
  }
  removeSettlementListener = registerDurableMutationSettlementListener(outbox.mutationId, (finalSettlement) => {
    try {
      if (finalSettlement === 'accepted') options.onReplayAccepted?.()
      else options.onReplayDiscarded?.()
    } finally {
      publishFinalSettlement(finalSettlement === 'accepted' ? 'accepted' : 'failed')
    }
  })
  const promise = dispatchDurableMutation(
    outbox,
    intent,
    (transport) => {
      failureRollbackDisposition = transport.failureRollbackDisposition
      const executionWrapper = transport.executionWrapper
      if (!options.observeExecutionResult || !executionWrapper) return dispatch(transport)
      return dispatch({
        ...transport,
        executionWrapper: (execute) =>
          executionWrapper(async () => {
            const result = await execute()
            options.observeExecutionResult?.(result)
            return result
          }),
      })
    },
    options,
  ).then(
    (result) => {
      // The durable dispatcher settles the outbox before the public command
      // promise resolves, so this resolver now reports the final retain/rollback
      // decision for the exact attempted body.
      disposition = result.status === 'ok' ? 'rollback' : (failureRollbackDisposition?.(result) ?? disposition)
      if (result.status === 'ok') publishFinalSettlement('accepted')
      else if (disposition === 'rollback') publishFinalSettlement('failed')
      return result
    },
    (error) => {
      // Transport exceptions retain a persisted row just like retryable error
      // results. Preserve that decision for the public queued/failed outcome.
      disposition = failureRollbackDisposition?.({ status: 'unavailable' }) ?? disposition
      if (disposition === 'rollback') publishFinalSettlement('failed')
      throw error
    },
  )
  return {
    promise,
    disposition: () => disposition,
    mutationId: outbox.mutationId,
    settlement,
  }
}

interface PluginDurableTransportOptions<T extends Record<string, unknown>> {
  beforeExecuteResult?: () => Exclude<ServerCommandResult<T>, { status: 'ok' }> | undefined
  observeExecutionResult?: (result: ServerCommandResult<T>) => void
  onReplayAccepted?: () => void
  onReplayDiscarded?: () => void
}

async function pluginMutationOutcome(execution: PendingPluginMutationExecution): Promise<PluginMutationOutcome> {
  let result: ServerCommandResult
  try {
    result = await execution.promise
  } catch (error) {
    console.error('Plugin mutation command rejected:', error)
    result = { status: 'unavailable' }
  }
  if (result.status === 'ok') return { status: 'accepted', result }
  return execution.disposition() === 'retain'
    ? {
        status: 'queued',
        result,
        mutationId: execution.mutationId,
        settlement: execution.settlement,
      }
    : { status: 'failed', result }
}

function pluginMutationBatchOutcome(outcomes: PluginMutationOutcome[]): PluginMutationBatchOutcome {
  const lastAcceptedIndex = outcomes.findLastIndex((outcome) => outcome.status === 'accepted')
  const lastQueuedIndex = outcomes.findLastIndex((outcome) => outcome.status === 'queued')
  const failed = outcomes.some((outcome) => outcome.status === 'failed')
  // An accepted successor on the same semantic lane first replays every
  // retained predecessor. Treat that accepted suffix as proof that the queued
  // prefix also reached the server before this batch promise completed.
  const acceptedCount = failed
    ? outcomes.filter((outcome) => outcome.status === 'accepted').length
    : lastAcceptedIndex >= lastQueuedIndex
      ? outcomes.length
      : lastAcceptedIndex + 1
  return {
    status: failed ? 'failed' : lastQueuedIndex > lastAcceptedIndex ? 'queued' : 'accepted',
    acceptedCount,
    outcomes,
  }
}

export function dispatchCreatePlugin(
  plugin: RisuPlugin,
  previous: PluginStateSnapshot,
): Promise<PluginMutationOutcome> | null {
  return runCreatePluginCommand(plugin, previous)
}

export function runCreatePluginCommand(
  plugin: RisuPlugin,
  previous: PluginStateSnapshot,
): Promise<PluginMutationOutcome> | null {
  if (!canUseServerCommands()) return null
  const pluginSnapshot = toPluginSnapshot(plugin)
  const rollbackEntry = pluginCreateRollbackEntry(plugin)
  const operation = issuePluginNonStorageOperation([rollbackEntry], previous.plugins)
  const intent: DurableMutationIntent = {
    version: 1,
    requests: [{ method: 'POST', path: '/plugins', body: { plugin: cloneJsonValue(pluginSnapshot) } }],
  }
  return pluginMutationOutcome(
    dispatchPluginDurableMutation(
      PLUGIN_COLLECTION_MUTATION_KEY,
      intent,
      async (baseRevision, signal) => {
        const result = await createPluginCommand(
          {
            baseRevision,
            plugin: cloneJsonValue(pluginSnapshot),
          },
          signal,
        )
        if (result.status === 'ok') {
          clearPluginNonStorageOperation(operation)
        }
        return result
      },
      () => rollbackPluginNonStorageEntries([rollbackEntry], operation),
      {
        onReplayAccepted: () => clearPluginNonStorageOperation(operation),
      },
    ),
  )
}

export function dispatchUpdatePlugin(
  pluginId: string,
  patch: PluginSnapshot,
  previous: PluginStateSnapshot,
): Promise<PluginMutationOutcome> | null {
  return runUpdatePluginCommand(pluginId, patch, previous)
}

export function runUpdatePluginCommand(
  pluginId: string,
  patch: PluginSnapshot,
  previous: PluginStateSnapshot,
): Promise<PluginMutationOutcome> | null {
  const commandPatch = changedPluginPatch(pluginId, patch, previous)
  if (Object.keys(commandPatch).length === 0) return null
  if (!canUseServerCommands()) return null
  const rollbackEntries = pluginFieldRollbackEntries(pluginId, commandPatch, previous)
  const operation =
    rollbackEntries.length > 0 ? issuePluginNonStorageOperation(rollbackEntries, previous.plugins) : null
  const intent: DurableMutationIntent = {
    version: 1,
    requests: [
      {
        method: 'PATCH',
        path: `/plugins/${encodeURIComponent(pluginId)}`,
        body: { patch: cloneJsonValue(commandPatch) },
      },
    ],
  }
  return pluginMutationOutcome(
    dispatchPluginDurableMutation(
      PLUGIN_COLLECTION_MUTATION_KEY,
      intent,
      async (baseRevision, signal) => {
        const result = await updatePluginCommand(
          {
            baseRevision,
            pluginId,
            patch: cloneJsonValue(commandPatch),
          },
          signal,
        )
        if (operation && result.status === 'ok') {
          clearPluginNonStorageOperation(operation)
        }
        return result
      },
      () => {
        if (operation) {
          rollbackPluginNonStorageEntries(rollbackEntries, operation)
        }
      },
      {
        onReplayAccepted: () => {
          if (operation) clearPluginNonStorageOperation(operation)
        },
      },
    ),
  )
}

export function dispatchDeletePlugin(
  pluginId: string,
  previous: PluginStateSnapshot,
): Promise<PluginMutationOutcome> | null {
  if (!canUseServerCommands()) return null
  const rollbackEntry = deletePluginRollbackEntry(pluginId, previous)
  const operation = rollbackEntry ? issuePluginNonStorageOperation([rollbackEntry], previous.plugins) : null
  const intent: DurableMutationIntent = {
    version: 1,
    requests: [{ method: 'DELETE', path: `/plugins/${encodeURIComponent(pluginId)}`, body: {} }],
  }
  return pluginMutationOutcome(
    dispatchPluginDurableMutation(
      PLUGIN_COLLECTION_MUTATION_KEY,
      intent,
      async (baseRevision, signal) => {
        const result = await deletePluginCommand(
          {
            baseRevision,
            pluginId,
          },
          signal,
        )
        if (operation && result.status === 'ok') {
          clearPluginNonStorageOperation(operation)
        }
        return result
      },
      () => {
        if (rollbackEntry && operation) {
          rollbackPluginNonStorageEntries([rollbackEntry], operation)
        }
      },
      {
        onReplayAccepted: () => {
          if (operation) clearPluginNonStorageOperation(operation)
        },
      },
    ),
  )
}

export function dispatchEnablePlugin(
  pluginId: string,
  enabled: boolean,
  previous: PluginStateSnapshot,
): Promise<PluginMutationOutcome> | null {
  if (!canUseServerCommands()) return null
  const rollbackEntry = pluginFieldRollbackEntry(pluginId, 'enabled', previous, true, enabled)
  const operation = rollbackEntry ? issuePluginNonStorageOperation([rollbackEntry], previous.plugins) : null
  const intent: DurableMutationIntent = {
    version: 1,
    requests: [{ method: 'POST', path: `/plugins/${encodeURIComponent(pluginId)}/enable`, body: { enabled } }],
  }
  return pluginMutationOutcome(
    dispatchPluginDurableMutation(
      PLUGIN_COLLECTION_MUTATION_KEY,
      intent,
      async (baseRevision, signal) => {
        const result = await enablePluginCommand(
          {
            baseRevision,
            pluginId,
            enabled,
          },
          signal,
        )
        if (operation && result.status === 'ok') {
          clearPluginNonStorageOperation(operation)
        }
        return result
      },
      () => {
        if (rollbackEntry && operation) {
          rollbackPluginNonStorageEntries([rollbackEntry], operation)
        }
      },
      {
        onReplayAccepted: () => {
          if (operation) clearPluginNonStorageOperation(operation)
        },
      },
    ),
  )
}

function findPluginByName(pluginName: string): { plugin: RisuPlugin; index: number } | null {
  const plugins = currentPluginCollectionSnapshot()
  const matches = plugins.map((plugin, index) => ({ plugin, index })).filter(({ plugin }) => plugin.name === pluginName)
  if (matches.length !== 1) return null
  const [{ plugin, index }] = matches
  return { plugin, index }
}

export function setPluginArgument(
  pluginName: string,
  arg: string,
  value: number | string,
): Promise<PluginMutationOutcome> | null {
  const current = findPluginByName(pluginName)
  if (!current) return null

  const { plugin } = current
  const previous = currentPluginStateSnapshot()
  const nextRealArg = cloneJsonValue({
    ...(plugin.realArg ?? {}),
    [arg]: value,
  })

  const target = findPluginByName(pluginName)
  if (!target) return null
  const nextPlugins = currentPluginCollectionSnapshot()
  nextPlugins[target.index] = {
    ...target.plugin,
    realArg: nextRealArg,
  }
  replacePluginCollectionOwner(nextPlugins)
  return dispatchUpdatePlugin(plugin.name, { realArg: nextRealArg }, previous)
}

export function togglePluginEnabled(pluginName: string): Promise<PluginMutationOutcome> | null {
  const current = findPluginByName(pluginName)
  if (!current) return null

  const { plugin } = current
  const previous = currentPluginStateSnapshot()
  const enabled = !plugin.enabled

  const target = findPluginByName(pluginName)
  if (!target) return null
  const nextPlugins = currentPluginCollectionSnapshot()
  nextPlugins[target.index] = {
    ...target.plugin,
    enabled,
  }
  replacePluginCollectionOwner(nextPlugins)
  return dispatchEnablePlugin(plugin.name, enabled, previous)
}

export function deletePlugin(pluginName: string): Promise<PluginMutationOutcome> | null {
  const current = findPluginByName(pluginName)
  if (!current) return null

  const { plugin } = current
  const previous = currentPluginStateSnapshot()

  if (currentPluginProviderOwnerSnapshot() === plugin.name) applyPluginProviderOwner('')
  replacePluginCollectionOwner(currentPluginCollectionSnapshot().filter((candidate) => candidate.name !== plugin.name))
  return dispatchDeletePlugin(plugin.name, previous)
}

export function dispatchSelectPluginProvider(
  provider: string,
  previous: PluginStateSnapshot,
): Promise<PluginMutationOutcome> | null {
  if (!canUseServerCommands()) return null
  const rollbackEntry = pluginProviderRollbackEntry(provider, previous)
  const operation = issuePluginNonStorageOperation([rollbackEntry], previous.plugins)
  const intent: DurableMutationIntent = {
    version: 1,
    requests: [{ method: 'POST', path: '/plugins/provider', body: { provider } }],
  }
  return pluginMutationOutcome(
    dispatchPluginDurableMutation(
      PLUGIN_COLLECTION_MUTATION_KEY,
      intent,
      async (baseRevision, signal) => {
        const result = await selectPluginProviderCommand({ baseRevision, provider }, signal)
        if (result.status === 'ok') {
          clearPluginNonStorageOperation(operation)
        }
        return result
      },
      () => rollbackPluginNonStorageEntries([rollbackEntry], operation),
      {
        onReplayAccepted: () => clearPluginNonStorageOperation(operation),
      },
    ),
  )
}

export function dispatchReorderPlugins(previous: PluginStateSnapshot): Promise<PluginMutationOutcome> | null {
  if (!canUseServerCommands()) return null
  const attemptedPluginIds = currentPluginCollectionSnapshot().map((plugin) => plugin.name)
  const rollbackEntry = pluginOrderRollbackEntry(previous, attemptedPluginIds)
  const operation = issuePluginNonStorageOperation([rollbackEntry], previous.plugins)
  const intent: DurableMutationIntent = {
    version: 1,
    requests: [{ method: 'POST', path: '/plugins/reorder', body: { pluginIds: [...attemptedPluginIds] } }],
  }
  return pluginMutationOutcome(
    dispatchPluginDurableMutation(
      PLUGIN_COLLECTION_MUTATION_KEY,
      intent,
      async (baseRevision, signal) => {
        const result = await reorderPluginsCommand({ baseRevision, pluginIds: attemptedPluginIds }, signal)
        if (result.status === 'ok') {
          clearPluginNonStorageOperation(operation)
        }
        return result
      },
      () => rollbackPluginNonStorageEntries([rollbackEntry], operation),
      {
        onReplayAccepted: () => clearPluginNonStorageOperation(operation),
      },
    ),
  )
}

export function dispatchPluginCollectionPatch(
  plugins: RisuPlugin[],
  previous: PluginStateSnapshot,
): Promise<PluginMutationBatchOutcome> {
  if (!canUseServerCommands()) return Promise.resolve(pluginMutationBatchOutcome([]))

  const beforePlugins = new Map(previous.plugins.map((plugin) => [plugin.name, plugin]))
  const nextPlugins = new Map(plugins.map((plugin) => [plugin.name, plugin]))

  const steps: PluginCollectionPatchStep[] = []

  for (const plugin of plugins) {
    const before = beforePlugins.get(plugin.name)
    if (!before) {
      const pluginSnapshot = toPluginSnapshot(plugin)
      steps.push({
        request: { method: 'POST', path: '/plugins', body: { plugin: cloneJsonValue(pluginSnapshot) } },
        factory: (baseRevision, signal) =>
          createPluginCommand({ baseRevision, plugin: cloneJsonValue(pluginSnapshot) }, signal),
        rollbackEntries: [pluginCreateRollbackEntry(plugin)],
      })
      continue
    }
    const pluginId = plugin.name
    const commandPatch = changedPluginPatch(pluginId, toPluginSnapshot(plugin), previous)
    if (Object.keys(commandPatch).length === 0) continue
    const rollbackEntries = pluginFieldRollbackEntries(pluginId, commandPatch, previous)
    if (rollbackEntries.length === 0) continue
    steps.push({
      request: {
        method: 'PATCH',
        path: `/plugins/${encodeURIComponent(pluginId)}`,
        body: { patch: cloneJsonValue(commandPatch) },
      },
      factory: (baseRevision, signal) =>
        updatePluginCommand({ baseRevision, pluginId, patch: cloneJsonValue(commandPatch) }, signal),
      rollbackEntries,
    })
  }

  for (const plugin of previous.plugins) {
    if (!nextPlugins.has(plugin.name)) {
      const pluginId = plugin.name
      const rollbackEntry = deletePluginRollbackEntry(pluginId, previous)
      if (rollbackEntry) {
        steps.push({
          request: { method: 'DELETE', path: `/plugins/${encodeURIComponent(pluginId)}`, body: {} },
          factory: (baseRevision, signal) => deletePluginCommand({ baseRevision, pluginId }, signal),
          rollbackEntries: [rollbackEntry],
        })
      }
    }
  }

  const attemptedPluginIds = plugins.map((plugin) => plugin.name)
  const expectedOrderAfterCreateDelete = previous.plugins
    .map((plugin) => plugin.name)
    .filter((pluginId) => nextPlugins.has(pluginId))
  for (const plugin of plugins) {
    if (!beforePlugins.has(plugin.name)) {
      expectedOrderAfterCreateDelete.push(plugin.name)
    }
  }
  if (!isStringArrayEqual(expectedOrderAfterCreateDelete, attemptedPluginIds)) {
    steps.push({
      request: { method: 'POST', path: '/plugins/reorder', body: { pluginIds: [...attemptedPluginIds] } },
      factory: (baseRevision, signal) => reorderPluginsCommand({ baseRevision, pluginIds: attemptedPluginIds }, signal),
      rollbackEntries: [pluginOrderRollbackEntry(previous, attemptedPluginIds)],
    })
  }

  if (steps.length === 0) return Promise.resolve(pluginMutationBatchOutcome([]))

  const operationSteps = steps.map((step) => ({
    ...step,
    operation: issuePluginNonStorageOperation(step.rollbackEntries, previous.plugins),
    rollbackRequested: false,
  }))

  // Stage and reserve every exact row synchronously. A later row shares the
  // plugin collection lane, so it must drain a retained prefix before it can
  // reach the server; accepted receipt indices remain idempotent on replay.
  let firstFailure: Exclude<ServerCommandResult, { status: 'ok' }> | undefined
  const outcomes = operationSteps.map((step) => {
    const intent: DurableMutationIntent = { version: 1, requests: [cloneJsonValue(step.request)] }
    return pluginMutationOutcome(
      dispatchPluginDurableMutation(
        PLUGIN_COLLECTION_MUTATION_KEY,
        intent,
        async (baseRevision, signal) => {
          let result: ServerCommandResult
          try {
            result = await step.factory(baseRevision, signal)
          } catch (error) {
            firstFailure ??= { status: 'unavailable' }
            throw error
          }
          if (result.status === 'ok') clearPluginNonStorageOperation(step.operation)
          else firstFailure ??= result
          return result
        },
        () => {
          // Collection rows affect one shared projection (especially create,
          // delete, and reorder), so restore a failed suffix in reverse order
          // after every reserved row has settled. Rolling back forward here
          // can make the reorder guard miss the still-optimistic collection.
          step.rollbackRequested = true
        },
        {
          beforeExecuteResult: () => firstFailure,
          onReplayAccepted: () => clearPluginNonStorageOperation(step.operation),
          onReplayDiscarded: () => rollbackPluginNonStorageEntries(step.rollbackEntries, step.operation),
        },
      ),
    )
  })
  return Promise.all(outcomes).then((settledOutcomes) => {
    for (let index = operationSteps.length - 1; index >= 0; index -= 1) {
      const step = operationSteps[index]
      if (step.rollbackRequested) {
        rollbackPluginNonStorageEntries(step.rollbackEntries, step.operation)
      }
    }
    return pluginMutationBatchOutcome(settledOutcomes)
  })
}

function pluginCreateRollbackEntry(plugin: RisuPlugin): PluginCreateRollbackEntry {
  return {
    kind: 'plugin-create',
    target: pluginCreateRollbackTarget(plugin.name),
    pluginId: plugin.name,
    attemptedPlugin: cloneJsonValue(plugin),
  }
}

function pluginFieldRollbackEntries(
  pluginId: string,
  patch: PluginSnapshot,
  previous: PluginStateSnapshot,
): PluginFieldRollbackEntry[] {
  return Object.entries(patch)
    .map(([field, value]) => {
      const deletesField = value === null && PLUGIN_PATCH_DELETABLE_KEYS.has(field)
      return pluginFieldRollbackEntry(pluginId, field, previous, !deletesField, deletesField ? undefined : value)
    })
    .filter((entry): entry is PluginFieldRollbackEntry => entry !== null)
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

function pluginOrderRollbackEntry(
  previous: PluginStateSnapshot,
  attemptedPluginIds: string[],
): PluginOrderRollbackEntry {
  return {
    kind: 'plugin-order',
    target: 'plugin-order:current',
    previousPluginIds: previous.plugins.map((plugin) => plugin.name),
    attemptedPluginIds: [...attemptedPluginIds],
  }
}

function issuePluginNonStorageOperation(
  entries: PluginNonStorageRollbackEntry[],
  acceptedPlugins: readonly RisuPlugin[],
): PluginNonStorageOperationToken {
  if (acceptedPluginRuntimeBaseline === null && entries.some(pluginNonStorageEntryChangesRuntime)) {
    acceptedPluginRuntimeBaseline = acceptedPlugins.map((plugin) => cloneJsonValue(plugin))
  }
  const targets = [...new Set(entries.flatMap((entry) => pluginNonStorageRollbackTargets(entry)))]
  const token = {
    sequence: ++nextPluginNonStorageOperationSequence,
    targets,
  }

  for (const entry of entries) {
    for (const target of pluginNonStorageRollbackTargets(entry)) {
      const pendingOperations = pendingPluginNonStorageOperationsByTarget.get(target) ?? []
      pendingOperations.push({
        sequence: token.sequence,
        entry,
        status: 'pending',
      })
      pendingPluginNonStorageOperationsByTarget.set(target, pendingOperations)
    }
  }

  return token
}

function rollbackPluginNonStorageEntries(
  entries: PluginNonStorageRollbackEntry[],
  operation: PluginNonStorageOperationToken,
): void {
  let changed = false

  void entries
  for (const target of operation.targets) {
    const pendingOperations = pendingPluginNonStorageOperationsByTarget.get(target)
    const operationRecords = pendingOperations?.filter((record) => record.sequence === operation.sequence) ?? []
    if (!pendingOperations || operationRecords.length === 0) continue

    for (const operationRecord of operationRecords) {
      operationRecord.status = 'failed'
    }
    changed = cascadeFailedPluginNonStorageOperationsForTarget(target, pendingOperations) || changed

    if (pendingOperations.length > 0) {
      pendingPluginNonStorageOperationsByTarget.set(target, pendingOperations)
    } else {
      pendingPluginNonStorageOperationsByTarget.delete(target)
    }
  }

  if (changed) {
    pluginWatchSuppressionVersion += 1
  }
  releaseAcceptedPluginRuntimeBaselineIfSettled()
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
  if (entry.kind === 'plugin-create') {
    return rollbackPluginCreateIfLiveMatches(entry)
  }
  if (entry.kind === 'plugin-field') {
    return rollbackPluginFieldIfLiveMatches(entry)
  }
  if (entry.kind === 'plugin-delete') {
    return rollbackPluginDeleteIfLiveMatches(entry)
  }
  if (entry.kind === 'plugin-provider') {
    return rollbackPluginProviderIfLiveMatches(entry)
  }
  return rollbackPluginOrderIfLiveMatches(entry)
}

function rollbackPluginCreateIfLiveMatches(entry: PluginCreateRollbackEntry): boolean {
  const plugins = currentPluginCollectionSnapshot()
  const index = plugins.findIndex((plugin) => plugin.name === entry.pluginId)
  if (index === -1 || !isJsonValueEqual(plugins[index], entry.attemptedPlugin)) return false

  replacePluginCollectionOwner(plugins.filter((_, pluginIndex) => pluginIndex !== index))
  return true
}

function rollbackPluginFieldIfLiveMatches(entry: PluginFieldRollbackEntry): boolean {
  const plugins = currentPluginCollectionSnapshot()
  const index = plugins.findIndex((plugin) => plugin.name === entry.pluginId)
  if (index === -1) return false

  const livePlugin = plugins[index] as RisuPlugin & Record<string, unknown>
  const liveExists = hasOwnRecordKey(livePlugin, entry.field)
  if (entry.attemptedExists) {
    if (!liveExists || !isJsonValueEqual(livePlugin[entry.field], entry.attemptedValue)) return false
  } else if (liveExists && livePlugin[entry.field] !== undefined) {
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

  plugins[index] = nextPlugin
  replacePluginCollectionOwner(plugins)
  return true
}

function rollbackPluginDeleteIfLiveMatches(entry: PluginDeleteRollbackEntry): boolean {
  let changed = false
  const plugins = currentPluginCollectionSnapshot()
  const liveIndex = plugins.findIndex((plugin) => plugin.name === entry.pluginId)

  if (liveIndex === -1) {
    const nextPlugins = [...plugins]
    const insertIndex = boundedInsertIndex(entry.previousIndex, nextPlugins.length)
    nextPlugins.splice(insertIndex, 0, cloneJsonValue(entry.previousPlugin))
    replacePluginCollectionOwner(nextPlugins)
    changed = true
  }

  if (entry.providerChanged && currentPluginProviderOwnerSnapshot() === entry.attemptedProvider) {
    applyPluginProviderOwner(entry.previousProvider)
    changed = true
  }

  return changed
}

function rollbackPluginProviderIfLiveMatches(entry: PluginProviderRollbackEntry): boolean {
  if (currentPluginProviderOwnerSnapshot() !== entry.attemptedProvider) return false
  applyPluginProviderOwner(entry.previousProvider)
  return true
}

function rollbackPluginOrderIfLiveMatches(entry: PluginOrderRollbackEntry): boolean {
  const plugins = currentPluginCollectionSnapshot()
  const livePluginIds = plugins.map((plugin) => plugin.name)
  if (!isStringArrayEqual(livePluginIds, entry.attemptedPluginIds)) return false

  const pluginsById = new Map(plugins.map((plugin) => [plugin.name, plugin]))
  const usedPluginIds = new Set<string>()
  const reorderedPlugins: RisuPlugin[] = []

  for (const pluginId of entry.previousPluginIds) {
    const plugin = pluginsById.get(pluginId)
    if (!plugin) continue
    reorderedPlugins.push(plugin)
    usedPluginIds.add(pluginId)
  }

  for (const plugin of plugins) {
    if (usedPluginIds.has(plugin.name)) continue
    reorderedPlugins.push(plugin)
  }

  if (
    isStringArrayEqual(
      reorderedPlugins.map((plugin) => plugin.name),
      livePluginIds,
    )
  )
    return false
  replacePluginCollectionOwner(reorderedPlugins)
  return true
}

function clearPluginNonStorageOperation(operation: PluginNonStorageOperationToken): void {
  const acceptedEntries = pendingPluginNonStorageEntries().filter((record) => record.sequence <= operation.sequence)
  if (acceptedPluginRuntimeBaseline) {
    for (const record of acceptedEntries) {
      acceptedPluginRuntimeBaseline = applyPluginCollectionEntry(acceptedPluginRuntimeBaseline, record.entry)
    }
  }

  for (const target of [...pendingPluginNonStorageOperationsByTarget.keys()]) {
    const pendingOperations = pendingPluginNonStorageOperationsByTarget.get(target)
    if (!pendingOperations) continue

    const nextPendingOperations = pendingOperations.filter((record) => record.sequence > operation.sequence)
    if (nextPendingOperations.length > 0) {
      pendingPluginNonStorageOperationsByTarget.set(target, nextPendingOperations)
    } else {
      pendingPluginNonStorageOperationsByTarget.delete(target)
    }
  }
  releaseAcceptedPluginRuntimeBaselineIfSettled()
}

function pluginNonStorageEntryChangesRuntime(entry: PluginNonStorageRollbackEntry): boolean {
  return (
    entry.kind === 'plugin-create' ||
    entry.kind === 'plugin-delete' ||
    (entry.kind === 'plugin-field' && PLUGIN_RUNTIME_FIELDS.has(entry.field))
  )
}

function releaseAcceptedPluginRuntimeBaselineIfSettled(): void {
  if (!pendingPluginNonStorageEntries().some((record) => pluginNonStorageEntryChangesRuntime(record.entry))) {
    acceptedPluginRuntimeBaseline = null
  }
}

/** Runtime code executes only server-accepted plugin records, never a retained optimistic script. */
export function acceptedPluginRuntimeProjection(plugins: readonly RisuPlugin[]): RisuPlugin[] {
  return (acceptedPluginRuntimeBaseline ?? plugins).map((plugin) => cloneJsonValue(plugin))
}

function pluginFieldRollbackTarget(pluginId: string, field: string): string {
  return `plugin-field:${pluginId}:${field}`
}

function pluginRowRollbackTarget(pluginId: string): string {
  return `plugin-row:${pluginId}`
}

function pluginCreateRollbackTarget(pluginId: string): string {
  return `plugin-create:${pluginId}`
}

function pluginDeleteRollbackTarget(pluginId: string): string {
  return `plugin-delete:${pluginId}`
}

function pluginNonStorageRollbackTargets(entry: PluginNonStorageRollbackEntry): string[] {
  if (entry.kind === 'plugin-field') {
    return [entry.target, pluginRowRollbackTarget(entry.pluginId)]
  }
  if (entry.kind === 'plugin-create' || entry.kind === 'plugin-delete') {
    return [pluginRowRollbackTarget(entry.pluginId)]
  }
  return [entry.target]
}

function boundedInsertIndex(index: number, length: number): number {
  if (index < 0) return 0
  if (index > length) return length
  return index
}

export function currentPluginStorageSnapshot(): PluginStorageSnapshot {
  return currentPluginStorageOwnerSnapshot()
}

export function restorePluginStorage(snapshot: PluginStorageSnapshot): void {
  pluginWatchSuppressionVersion += 1
  replacePluginStorageOwner(snapshot)
}

export function dispatchPutPluginStorage(
  key: string,
  value: unknown,
  previous: PluginStorageSnapshot,
): Promise<PluginMutationOutcome> | null {
  if (!canUseServerCommands()) return null
  const attemptedValue = cloneJsonValue(value)
  const rollbackEntry = pluginStorageRollbackEntryForKey(previous, key, true, attemptedValue)
  const operation = issuePluginStorageOperation([rollbackEntry])
  const intent: DurableMutationIntent = {
    version: 1,
    requests: [
      {
        method: 'PUT',
        path: `/plugin-storage/${encodeURIComponent(key)}`,
        body: { value: cloneJsonValue(attemptedValue) },
      },
    ],
  }
  return pluginMutationOutcome(
    dispatchPluginDurableMutation(
      PLUGIN_STORAGE_MUTATION_KEY,
      intent,
      async (baseRevision, signal) => {
        const result = await putPluginStorageCommand(
          {
            baseRevision,
            key,
            value: cloneJsonValue(attemptedValue),
          },
          signal,
        )
        if (result.status === 'ok') clearPluginStorageOperation(operation)
        return result
      },
      () => rollbackPluginStorageEntries([rollbackEntry], operation),
      {
        onReplayAccepted: () => clearPluginStorageOperation(operation),
      },
    ),
  )
}

export function dispatchDeletePluginStorage(
  key: string,
  previous: PluginStorageSnapshot,
): Promise<PluginMutationOutcome> | null {
  if (!canUseServerCommands()) return null
  const rollbackEntry = pluginStorageRollbackEntryForKey(previous, key, false, undefined)
  const operation = issuePluginStorageOperation([rollbackEntry])
  const intent: DurableMutationIntent = {
    version: 1,
    requests: [{ method: 'DELETE', path: `/plugin-storage/${encodeURIComponent(key)}`, body: {} }],
  }
  return pluginMutationOutcome(
    dispatchPluginDurableMutation(
      PLUGIN_STORAGE_MUTATION_KEY,
      intent,
      async (baseRevision, signal) => {
        const result = await deletePluginStorageCommand({ baseRevision, key }, signal)
        if (result.status === 'ok') clearPluginStorageOperation(operation)
        return result
      },
      () => rollbackPluginStorageEntries([rollbackEntry], operation),
      {
        onReplayAccepted: () => clearPluginStorageOperation(operation),
      },
    ),
  )
}

export function dispatchBulkPluginStorage(
  input: {
    values?: Record<string, unknown>
    deleteKeys?: string[]
    clear?: boolean
  },
  previous: PluginStorageSnapshot,
): Promise<PluginMutationOutcome> | null {
  if (!canUseServerCommands()) return null
  const minimized = minimizePluginStoragePatch(input, previous)
  const values = minimized.values
  const deleteKeys = minimized.deleteKeys
  if (Object.keys(values).length === 0 && deleteKeys.length === 0) return null
  const rollbackEntries = buildBulkPluginStorageRollbackEntries(
    {
      values,
      deleteKeys,
      clear: false,
    },
    previous,
  )
  const operation = issuePluginStorageOperation(rollbackEntries)
  const intent: DurableMutationIntent = {
    version: 1,
    requests: [
      {
        method: 'POST',
        path: '/plugin-storage/bulk',
        body: { values: cloneJsonValue(values), deleteKeys: [...deleteKeys], clear: false },
      },
    ],
  }
  return pluginMutationOutcome(
    dispatchPluginDurableMutation(
      PLUGIN_STORAGE_MUTATION_KEY,
      intent,
      async (baseRevision, signal) => {
        const result = await bulkPluginStorageCommand(
          {
            baseRevision,
            values: cloneJsonValue(values),
            deleteKeys: [...deleteKeys],
            clear: false,
          },
          signal,
        )
        if (result.status === 'ok') clearPluginStorageOperation(operation)
        return result
      },
      () => rollbackPluginStorageEntries(rollbackEntries, operation),
      {
        onReplayAccepted: () => clearPluginStorageOperation(operation),
      },
    ),
  )
}

function minimizePluginStoragePatch(
  input: {
    values?: Record<string, unknown>
    deleteKeys?: string[]
    clear?: boolean
  },
  previous: PluginStorageSnapshot,
): { values: Record<string, unknown>; deleteKeys: string[] } {
  const requestedValues = cloneJsonValue(input.values ?? {})
  if (!input.clear) {
    return {
      values: requestedValues,
      deleteKeys: [...new Set(input.deleteKeys ?? [])],
    }
  }

  // Full replacements originate from an already-applied optimistic snapshot.
  // Express the exact same result as a delta so unchanged, potentially large
  // plugin values do not cross the wire again.
  const values = Object.fromEntries(
    Object.entries(requestedValues).filter(
      ([key, value]) => !Object.prototype.hasOwnProperty.call(previous, key) || !isJsonValueEqual(previous[key], value),
    ),
  )
  const deleteKeys = Object.keys(previous).filter((key) => !Object.prototype.hasOwnProperty.call(requestedValues, key))
  return { values, deleteKeys }
}

/**
 * Replays the latest optimistic per-key storage intent over an authoritative
 * resource value. Operation records remain pending until the command's public
 * promise finishes resource reconciliation, so a response that started
 * earlier cannot erase a newer put/delete/bulk edit.
 */
export function mergePendingPluginStorageResource(
  resource: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const merged = cloneJsonValue(resource ?? {})
  for (const [key, operations] of pendingPluginStorageOperationsByKey) {
    const latest = operations.at(-1)
    if (!latest) continue
    if (latest.entry.attemptedExists) {
      merged[key] = cloneJsonValue(latest.entry.attemptedValue)
    } else {
      delete merged[key]
    }
  }
  return merged
}

export function preservePendingPluginStorageInDatabase<T extends { pluginCustomStorage?: unknown }>(database: T): T {
  if (pendingPluginStorageOperationsByKey.size === 0) return database
  const serverStorage =
    database.pluginCustomStorage &&
    typeof database.pluginCustomStorage === 'object' &&
    !Array.isArray(database.pluginCustomStorage)
      ? (database.pluginCustomStorage as Record<string, unknown>)
      : {}
  database.pluginCustomStorage = mergePendingPluginStorageResource(serverStorage)
  return database
}

/** Overlay retained plugin record/order intents on an authoritative collection read. */
export function mergePendingPluginCollectionResource(resource: RisuPlugin[] | null | undefined): RisuPlugin[] {
  let plugins = cloneJsonValue(resource ?? [])
  for (const operation of pendingPluginNonStorageEntries()) {
    plugins = applyPluginCollectionEntry(plugins, operation.entry)
  }
  return plugins
}

/** Overlay retained provider selections (including active-plugin deletes). */
export function mergePendingPluginProviderResource(provider: unknown): string {
  let merged = typeof provider === 'string' ? provider : ''
  for (const operation of pendingPluginNonStorageEntries()) {
    const entry = operation.entry
    if (entry.kind === 'plugin-provider') merged = entry.attemptedProvider
    else if (entry.kind === 'plugin-delete' && entry.providerChanged) merged = entry.attemptedProvider
  }
  return merged
}

function pendingPluginNonStorageEntries(): PluginNonStorageOperationRecord[] {
  const entries = new Map<string, PluginNonStorageOperationRecord>()
  for (const operations of pendingPluginNonStorageOperationsByTarget.values()) {
    for (const operation of operations) {
      // A rejected operation can remain underneath a newer target operation
      // until that successor settles. It is bookkeeping for rollback cascade,
      // not an optimistic value that should still be overlaid or folded into
      // the accepted runtime baseline.
      if (operation.status === 'failed') continue
      entries.set(`${operation.sequence}:${operation.entry.kind}:${operation.entry.target}`, operation)
    }
  }
  return [...entries.values()].sort((left, right) => left.sequence - right.sequence)
}

function reorderPluginRows(plugins: RisuPlugin[], pluginIds: readonly string[]): RisuPlugin[] {
  const byId = new Map(plugins.map((plugin) => [plugin.name, plugin]))
  const used = new Set<string>()
  const reordered: RisuPlugin[] = []
  for (const pluginId of pluginIds) {
    const plugin = byId.get(pluginId)
    if (!plugin || used.has(pluginId)) continue
    reordered.push(plugin)
    used.add(pluginId)
  }
  for (const plugin of plugins) {
    if (!used.has(plugin.name)) reordered.push(plugin)
  }
  return reordered
}

function applyPluginCollectionEntry(plugins: RisuPlugin[], entry: PluginNonStorageRollbackEntry): RisuPlugin[] {
  if (entry.kind === 'plugin-create') {
    const next = [...plugins]
    const index = next.findIndex((plugin) => plugin.name === entry.pluginId)
    if (index === -1) next.push(cloneJsonValue(entry.attemptedPlugin))
    else next[index] = cloneJsonValue(entry.attemptedPlugin)
    return next
  }
  if (entry.kind === 'plugin-field') {
    const index = plugins.findIndex((plugin) => plugin.name === entry.pluginId)
    if (index === -1) return plugins
    const next = [...plugins]
    const plugin = { ...next[index] } as RisuPlugin & Record<string, unknown>
    if (entry.attemptedExists) plugin[entry.field] = cloneJsonValue(entry.attemptedValue)
    else delete plugin[entry.field]
    next[index] = plugin
    return next
  }
  if (entry.kind === 'plugin-delete') {
    return plugins.filter((plugin) => plugin.name !== entry.pluginId)
  }
  if (entry.kind === 'plugin-order') return reorderPluginRows(plugins, entry.attemptedPluginIds)
  return plugins
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

  const liveStorage = currentPluginStorageOwnerSnapshot()
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
    replacePluginStorageOwner(liveStorage)
  }
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
  for (const key of [...pendingPluginStorageOperationsByKey.keys()]) {
    const pendingOperations = pendingPluginStorageOperationsByKey.get(key)
    if (!pendingOperations) continue

    // Every storage mutation uses one durable semantic lane. Acceptance of a
    // successor proves any retained predecessor was replayed first, even when
    // the predecessor touched a different key in a bulk request.
    const nextPendingOperations = pendingOperations.filter((record) => record.sequence > operation.sequence)
    if (nextPendingOperations.length > 0) {
      pendingPluginStorageOperationsByKey.set(key, nextPendingOperations)
    } else {
      pendingPluginStorageOperationsByKey.delete(key)
    }
  }
}

function hasOwnRecordKey(record: Record<string, unknown>, key: string): boolean {
  // Svelte's deep-state proxy can retain a descriptor for a deleted key even
  // after excluding it from enumeration. Plugin storage follows JSON object
  // semantics, so enumerable membership is the authoritative existence check.
  return Object.keys(record).includes(key)
}

function isJsonValueEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isStringArrayEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

export function dispatchPluginSettingsPatch(
  patch: Record<string, unknown>,
  rollbackSnapshot: PluginSettingsPatchRollbackSnapshot,
): Promise<PluginMutationBatchOutcome> {
  if (!canUseServerCommands()) return Promise.resolve(pluginMutationBatchOutcome([]))
  const stepsByGroup = new Map<SettingsGroup, PluginSettingsPatchRollbackStep>()

  for (const [key, value] of Object.entries(patch)) {
    const group = settingsGroupForKey(key)
    if (group && value !== undefined) {
      let step = stepsByGroup.get(group)
      if (!step) {
        step = {
          group,
          patch: {},
          rollbackSnapshot: emptyPluginSettingsPatchRollbackSnapshot(),
        }
        stepsByGroup.set(group, step)
      }
      step.patch[key] = cloneJsonValue(value)
      if (hasOwnRecordKey(rollbackSnapshot.previous, key) && hasOwnRecordKey(rollbackSnapshot.attempted, key)) {
        step.rollbackSnapshot.previous[key] = cloneJsonValue(rollbackSnapshot.previous[key])
        step.rollbackSnapshot.attempted[key] = cloneJsonValue(rollbackSnapshot.attempted[key])
      }
    }
  }
  const steps = Array.from(stepsByGroup.values())
  if (steps.length === 0) return Promise.resolve(pluginMutationBatchOutcome([]))
  return dispatchPluginSettingsPatchSteps(steps)
}

async function dispatchPluginSettingsPatchSteps(
  steps: PluginSettingsPatchRollbackStep[],
): Promise<PluginMutationBatchOutcome> {
  let firstFailure: Exclude<ServerCommandResult, { status: 'ok' }> | undefined
  const outcomes = steps.map((step) => {
    const frozenPatch = cloneJsonValue(step.patch)
    const intent: DurableMutationIntent = {
      version: 1,
      requests: [{ method: 'PATCH', path: `/settings/${step.group}`, body: { patch: frozenPatch } }],
    }
    return pluginMutationOutcome(
      dispatchPluginDurableTransport<Record<string, unknown>>(
        SETTINGS_BRIDGE_MUTATION_KEY,
        intent,
        (transport) =>
          patchServerBackedSettings({
            patch: cloneJsonValue(frozenPatch),
            acknowledgeOptimistic: true,
            rollback: () => rollbackPluginSettingsPatch(step.rollbackSnapshot),
            ...transport,
          }),
        {
          beforeExecuteResult: () => firstFailure,
          observeExecutionResult: (result) => {
            if (result.status !== 'ok') firstFailure ??= result
          },
          onReplayDiscarded: () => rollbackPluginSettingsPatch(step.rollbackSnapshot),
        },
      ),
    )
  })
  return pluginMutationBatchOutcome(await Promise.all(outcomes))
}

function emptyPluginSettingsPatchRollbackSnapshot(): PluginSettingsPatchRollbackSnapshot {
  return {
    previous: {},
    attempted: {},
  }
}

function captureCurrentPluginSettingsPatchRollbackEntries(
  snapshot: PluginSettingsPatchRollbackSnapshot,
  patch: Record<string, unknown>,
): void {
  const currentSettings = settingsResourceState.value as Record<string, unknown>

  for (const [key, value] of Object.entries(patch)) {
    if (!settingsGroupForKey(key) || value === undefined) continue
    snapshot.previous[key] = cloneJsonValue(currentSettings[key])
    snapshot.attempted[key] = cloneJsonValue(value)
  }
}

function rollbackPluginSettingsPatch(snapshot: PluginSettingsPatchRollbackSnapshot): void {
  if (Object.keys(snapshot.attempted).length === 0) return

  applyAttemptedFieldRollback({
    target: settingsResourceState.value as Record<string, unknown>,
    previous: snapshot.previous,
    attempted: snapshot.attempted,
  })
}

/** Roll back only fields that still carry this plugin operation's attempt. */
export function rollbackPluginSettingsOwner(
  previous: Record<string, unknown>,
  attempted: Record<string, unknown>,
): string[] {
  return applyAttemptedFieldRollback({
    target: settingsResourceState.value as Record<string, unknown>,
    previous,
    attempted,
  })
}

export function toPluginSnapshot(plugin: RisuPlugin): PluginSnapshot {
  // Preserve top-level `undefined` on optional fields. The delta builder turns
  // an explicitly removed field into the JSON-safe `null` deletion sentinel.
  // A JSON clone here would erase that distinction before diffing.
  return Object.fromEntries(
    Object.entries(plugin as RisuPlugin & Record<string, unknown>).map(([key, value]) => [key, cloneJsonValue(value)]),
  ) as PluginSnapshot
}

export function sanitizePluginPatch(patch: PluginSnapshot): PluginSnapshot {
  const sanitized: PluginSnapshot = {}
  for (const [key, value] of Object.entries(patch)) {
    if (PLUGIN_PATCH_EXCLUDED_KEYS.has(key) || value === undefined) continue
    sanitized[key] = value
  }
  return sanitized
}

function changedPluginPatch(pluginId: string, patch: PluginSnapshot, previous: PluginStateSnapshot): PluginSnapshot {
  const sanitized = sanitizePluginPatch(patch)
  const before = previous.plugins.find((plugin) => plugin.name === pluginId) as
    | (RisuPlugin & Record<string, unknown>)
    | undefined
  if (!before) return cloneJsonValue(sanitized)

  const changed = Object.fromEntries(
    Object.entries(sanitized)
      .filter(
        ([key, value]) => !Object.prototype.hasOwnProperty.call(before, key) || !isJsonValueEqual(before[key], value),
      )
      .map(([key, value]) => [key, cloneJsonValue(value)]),
  ) as Record<string, unknown>

  for (const [key, value] of Object.entries(patch)) {
    if (
      value === undefined &&
      PLUGIN_PATCH_DELETABLE_KEYS.has(key) &&
      Object.prototype.hasOwnProperty.call(before, key)
    ) {
      // Plugin fields cannot otherwise contain null. The server interprets it
      // as an explicit delete, keeping sparse full-record updates compact.
      changed[key] = null
    }
  }

  return changed as PluginSnapshot
}
