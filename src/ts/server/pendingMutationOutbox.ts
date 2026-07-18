import { clearRetainedChatProjections } from './chatRetainedProjection'

export type DurableMutationRequestMethod = 'DELETE' | 'PATCH' | 'POST' | 'PUT'

export interface DurableMutationRequest {
  method: DurableMutationRequestMethod
  /** Command path below `/api/v1/commands`, including the leading slash. */
  path: string
  /** Request fields excluding the enqueue-time `baseRevision`. */
  body: Record<string, unknown>
}

export interface DurableMutationIntent {
  version: 1
  requests: DurableMutationRequest[]
  /**
   * Additional semantic lanes that must settle before this intent. The keys
   * are encrypted with the request payload and are used only for client-side
   * ordering; they are never sent to the command API.
   */
  dependencyKeys?: string[]
}

type PendingMutationPhase = 'dispatching' | 'staged' | 'superseded'

export type PendingMutationPersistenceStatus = 'persisted' | 'superseded' | 'unavailable'
export type PendingMutationAcknowledgement = 'deleted' | 'superseded' | 'unavailable'

export interface PendingMutationHandle {
  readonly key: string
  readonly mutationId: string
  readonly sequence: number
  readonly ownerWriterSessionId: string | null
  readonly writerEpoch: number | null
  readonly databaseLineage: string | null
  readonly ready: Promise<PendingMutationPersistenceStatus>
  phase: PendingMutationPhase
}

export interface PendingMutationProjectionFence {
  readonly target: string
  readonly generationId: string
  readonly ordinal: number
  readonly ownerWriterSessionId: string
  readonly writerEpoch: number
  readonly databaseLineage: string
}

export interface PendingMutationLocalProjectionToken {
  readonly generationId: string
}

export interface PendingMutationOutboxEntry {
  handle: PendingMutationHandle
  intent: DurableMutationIntent
}

export type PendingMutationPredecessorResult =
  | { status: 'ok'; entries: PendingMutationOutboxEntry[]; semanticKeys: string[] }
  | { status: 'superseded' | 'unavailable' }

export type PendingMutationIntentReplacementResult =
  | { status: 'replaced' | 'successor'; handle: PendingMutationHandle }
  | { status: 'superseded' | 'unavailable' }

export interface PendingMutationReceiptAcknowledgement {
  mutationId: string
  requestCount: number
  databaseLineage: string
  queuedAt: number
}

export interface PreparePendingMutationOutboxInput {
  writerSessionId: string
  writerEpoch: number
  databaseLineage: string
  requestedWriterWasActive: boolean
  /** Runs synchronously before a changed scope can admit replacement-owner writes. */
  onOwnershipChange?: () => void
}

export interface PreparePendingMutationOutboxSummary {
  discarded: number
}

export type PendingMutationDiscardListener = (mutationId: string) => void

export interface PendingMutationOwnerCandidate {
  writerSessionId: string
  writerEpoch: number
  databaseLineage: string
}

interface PendingMutationScope {
  writerSessionId: string
  writerEpoch: number
  databaseLineage: string
}

interface LivePendingMutationProjectionGeneration {
  id: string
  ordinal: number
  scope: PendingMutationScope
  targetKeys: Set<string>
}

interface StoredPendingMutation {
  mutationId: string
  semanticKey: string
  sequence: number
  order: number
  /** Plaintext transaction fence; missing v3 rows are treated as unstarted. */
  dispatchStarted?: boolean
  ownerWriterSessionId: string
  writerEpoch: number
  databaseLineage: string
  updatedAt: number
  iv: ArrayBuffer
  ciphertext: ArrayBuffer
}

interface EncryptedPendingMutationPayload {
  intent: DurableMutationIntent
}

const OUTBOX_DATABASE_NAME = 'risu-pending-mutations-v1'
const OUTBOX_DATABASE_VERSION = 3
const OUTBOX_MUTATION_STORE = 'mutations'
const OUTBOX_KEY_STORE = 'keys'
const OUTBOX_ORDER_STORE = 'orders'
const OUTBOX_RECEIPT_ACK_STORE = 'receiptAcks'
const OUTBOX_ENCRYPTION_KEY_ID = 'pending-mutation-aes-gcm-v1'
const MAX_DURABLE_MUTATION_REQUESTS = 100
const MAX_DURABLE_MUTATION_DEPENDENCY_KEYS = 32
export const MAX_DURABLE_MUTATION_PAYLOAD_BYTES = 16 * 1024 * 1024
const MAX_PENDING_MUTATION_KEY_LENGTH = 2_048
const MUTATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,96}$/
const SCOPE_VALUE_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

const ALLOWED_DURABLE_COMMANDS: ReadonlyArray<{
  method: DurableMutationRequestMethod
  path: RegExp
}> = [
  { method: 'PATCH', path: /^\/settings\/[a-z][a-z-]*$/ },
  { method: 'PATCH', path: /^\/settings\/[a-z][a-z-]*\/objects\/[^/?#]+$/ },
  { method: 'POST', path: /^\/characters$/ },
  { method: 'POST', path: /^\/characters\/create-and-select$/ },
  { method: 'PATCH', path: /^\/characters\/[^/?#]+\/alternate-greetings$/ },
  { method: 'PATCH', path: /^\/characters\/[^/?#]+$/ },
  { method: 'DELETE', path: /^\/characters\/[^/?#]+$/ },
  { method: 'POST', path: /^\/characters\/select$/ },
  { method: 'POST', path: /^\/characters\/reorder$/ },
  { method: 'POST', path: /^\/characters\/[^/?#]+\/chats$/ },
  { method: 'POST', path: /^\/characters\/[^/?#]+\/chats\/reorder$/ },
  { method: 'POST', path: /^\/characters\/[^/?#]+\/chat-folders$/ },
  { method: 'POST', path: /^\/characters\/[^/?#]+\/chat-folders\/reorder$/ },
  { method: 'POST', path: /^\/characters\/[^/?#]+\/modules\/reorder$/ },
  { method: 'PATCH', path: /^\/chats\/[^/?#]+$/ },
  { method: 'PATCH', path: /^\/chats\/[^/?#]+\/scriptstate$/ },
  { method: 'DELETE', path: /^\/chats\/[^/?#]+$/ },
  { method: 'POST', path: /^\/chats\/[^/?#]+\/fork$/ },
  { method: 'POST', path: /^\/chats\/[^/?#]+\/messages$/ },
  { method: 'POST', path: /^\/chats\/[^/?#]+\/messages\/truncate$/ },
  { method: 'POST', path: /^\/chats\/[^/?#]+\/messages\/tail$/ },
  { method: 'PUT', path: /^\/chats\/[^/?#]+\/messages$/ },
  { method: 'PUT', path: /^\/chats\/[^/?#]+\/generation-settings$/ },
  { method: 'PATCH', path: /^\/messages\/[^/?#]+$/ },
  { method: 'DELETE', path: /^\/messages\/[^/?#]+$/ },
  { method: 'PATCH', path: /^\/chat-folders\/[^/?#]+$/ },
  { method: 'DELETE', path: /^\/chat-folders\/[^/?#]+$/ },
  { method: 'POST', path: /^\/prompt-items$/ },
  { method: 'POST', path: /^\/prompt-items\/reorder$/ },
  { method: 'PATCH', path: /^\/prompt-items\/[^/?#]+$/ },
  { method: 'DELETE', path: /^\/prompt-items\/[^/?#]+$/ },
  { method: 'POST', path: /^\/prompt-items\/enable$/ },
  { method: 'PATCH', path: /^\/personas\/[^/?#]+$/ },
  { method: 'DELETE', path: /^\/personas\/[^/?#]+$/ },
  { method: 'POST', path: /^\/personas$/ },
  { method: 'POST', path: /^\/personas\/select$/ },
  { method: 'POST', path: /^\/personas\/reorder$/ },
  { method: 'POST', path: /^\/presets$/ },
  { method: 'PATCH', path: /^\/presets\/[^/?#]+$/ },
  { method: 'DELETE', path: /^\/presets\/[^/?#]+$/ },
  { method: 'POST', path: /^\/presets\/[^/?#]+\/copy$/ },
  { method: 'POST', path: /^\/presets\/select$/ },
  { method: 'POST', path: /^\/presets\/reorder$/ },
  { method: 'POST', path: /^\/model-presets$/ },
  { method: 'PATCH', path: /^\/model-presets\/[^/?#]+$/ },
  { method: 'DELETE', path: /^\/model-presets\/[^/?#]+$/ },
  { method: 'POST', path: /^\/model-presets\/select$/ },
  { method: 'POST', path: /^\/model-presets\/reorder$/ },
  { method: 'POST', path: /^\/model-profiles$/ },
  { method: 'PATCH', path: /^\/model-profiles\/[^/?#]+$/ },
  { method: 'DELETE', path: /^\/model-profiles\/[^/?#]+$/ },
  { method: 'POST', path: /^\/model-profiles\/[^/?#]+\/duplicate$/ },
  { method: 'POST', path: /^\/model-profiles\/convert-legacy$/ },
  { method: 'PUT', path: /^\/model-role-profiles$/ },
  { method: 'PUT', path: /^\/model-runtime-defaults$/ },
  { method: 'POST', path: /^\/agent-presets$/ },
  { method: 'PATCH', path: /^\/agent-presets\/[^/?#]+$/ },
  { method: 'DELETE', path: /^\/agent-presets\/[^/?#]+$/ },
  { method: 'POST', path: /^\/agent-presets\/[^/?#]+\/duplicate$/ },
  { method: 'POST', path: /^\/agent-presets\/reorder$/ },
  { method: 'POST', path: /^\/agent-presets\/default$/ },
  { method: 'POST', path: /^\/agent-presets\/[^/?#]+\/steps$/ },
  { method: 'PATCH', path: /^\/agent-presets\/[^/?#]+\/steps\/[^/?#]+$/ },
  { method: 'DELETE', path: /^\/agent-presets\/[^/?#]+\/steps\/[^/?#]+$/ },
  { method: 'POST', path: /^\/agent-presets\/[^/?#]+\/steps\/[^/?#]+\/duplicate$/ },
  { method: 'POST', path: /^\/agent-presets\/[^/?#]+\/steps\/reorder$/ },
  { method: 'POST', path: /^\/prompt-presets$/ },
  { method: 'PATCH', path: /^\/prompt-presets\/[^/?#]+$/ },
  { method: 'DELETE', path: /^\/prompt-presets\/[^/?#]+$/ },
  { method: 'POST', path: /^\/prompt-presets\/select$/ },
  { method: 'POST', path: /^\/prompt-presets\/reorder$/ },
  { method: 'POST', path: /^\/legacy-bot-presets\/[^/?#]+\/extract$/ },
  { method: 'POST', path: /^\/translator-presets$/ },
  { method: 'PATCH', path: /^\/translator-presets\/[^/?#]+$/ },
  { method: 'DELETE', path: /^\/translator-presets\/[^/?#]+$/ },
  { method: 'POST', path: /^\/translator-presets\/select$/ },
  { method: 'POST', path: /^\/modules$/ },
  { method: 'PATCH', path: /^\/modules\/[^/?#]+$/ },
  { method: 'DELETE', path: /^\/modules\/[^/?#]+$/ },
  { method: 'POST', path: /^\/modules\/enable$/ },
  { method: 'POST', path: /^\/modules\/reorder$/ },
  { method: 'POST', path: /^\/plugins$/ },
  { method: 'PATCH', path: /^\/plugins\/[^/?#]+$/ },
  { method: 'DELETE', path: /^\/plugins\/[^/?#]+$/ },
  { method: 'POST', path: /^\/plugins\/[^/?#]+\/enable$/ },
  { method: 'POST', path: /^\/plugins\/provider$/ },
  { method: 'POST', path: /^\/plugins\/reorder$/ },
  { method: 'PUT', path: /^\/plugin-storage\/[^/?#]+$/ },
  { method: 'DELETE', path: /^\/plugin-storage\/[^/?#]+$/ },
  { method: 'POST', path: /^\/plugin-storage\/bulk$/ },
  { method: 'POST', path: /^\/loadouts$/ },
  { method: 'DELETE', path: /^\/loadouts\/[^/?#]+$/ },
  { method: 'POST', path: /^\/loadouts\/[^/?#]+\/favorite$/ },
  { method: 'POST', path: /^\/loadouts\/[^/?#]+\/touch$/ },
  { method: 'PATCH', path: /^\/settings\/advanced\/global-scripts$/ },
  { method: 'PUT', path: /^\/(?:characters|modules)\/[^/?#]+\/(?:scripts|triggers)$/ },
  { method: 'PATCH', path: /^\/(?:characters|modules)\/[^/?#]+\/(?:scripts|triggers)$/ },
  { method: 'POST', path: /^\/lorebooks$/ },
  { method: 'POST', path: /^\/lorebooks\/reorder$/ },
  { method: 'PATCH', path: /^\/lorebooks\/[^/?#]+$/ },
  { method: 'DELETE', path: /^\/lorebooks\/[^/?#]+$/ },
  { method: 'POST', path: /^\/lorebooks\/[^/?#]+\/select$/ },
  { method: 'PUT', path: /^\/lorebooks\/[^/?#]+\/entries$/ },
  { method: 'PUT', path: /^\/lorebooks\/[^/?#]+\/entries\/[^/?#]+$/ },
  { method: 'DELETE', path: /^\/lorebooks\/[^/?#]+\/entries\/[^/?#]+$/ },
  { method: 'POST', path: /^\/lorebooks\/[^/?#]+\/entries\/reorder$/ },
  { method: 'PUT', path: /^\/(?:characters|chats|modules)\/[^/?#]+\/lorebooks$/ },
  { method: 'PUT', path: /^\/(?:characters|chats|modules)\/[^/?#]+\/lorebooks\/entries\/[^/?#]+$/ },
  { method: 'DELETE', path: /^\/(?:characters|chats|modules)\/[^/?#]+\/lorebooks\/entries\/[^/?#]+$/ },
  { method: 'POST', path: /^\/(?:characters|chats|modules)\/[^/?#]+\/lorebooks\/entries\/reorder$/ },
]

let outboxDatabasePromise: Promise<IDBDatabase | null> | null = null
let outboxEncryptionKeyPromise: Promise<CryptoKey | null> | null = null
let nextSequenceOffset = 0
let nextProjectionGenerationOrdinal = 0
let persistenceWarningReported = false
let pendingMutationScope: PendingMutationScope | null = null
const liveProjectionGenerations = new Map<string, LivePendingMutationProjectionGeneration>()
const liveProjectionGenerationStacks = new Map<string, string[]>()
const pendingMutationDiscardListeners = new Set<PendingMutationDiscardListener>()

export function pendingMutationSettingsFieldProjectionTarget(field: string): string {
  return `settings-field:${encodeProjectionTargetPart(field)}`
}

export function pendingMutationModuleEnabledProjectionTarget(moduleId: string): string {
  return `module-enabled:${encodeProjectionTargetPart(moduleId)}`
}

export function pendingMutationPluginRowProjectionTarget(pluginId: string): string {
  return `plugin-row:${encodeProjectionTargetPart(pluginId)}`
}

export function pendingMutationPluginProviderProjectionTarget(): string {
  return 'plugin-provider:current'
}

export function pendingMutationPluginOrderProjectionTarget(): string {
  return 'plugin-order:current'
}

export function pendingMutationPluginStorageProjectionTarget(key: string): string {
  return `plugin-storage:${encodeProjectionTargetPart(key)}`
}

export function pendingMutationAgentPresetRowProjectionTarget(presetId: string): string {
  return `agent-preset-row:${encodeProjectionTargetPart(presetId)}`
}

export function pendingMutationAgentPresetCollectionProjectionTarget(): string {
  return 'agent-preset-collection'
}

export function pendingMutationAgentPresetStepsProjectionTarget(presetId: string): string {
  return `agent-preset-steps:${encodeProjectionTargetPart(presetId)}`
}

export function pendingMutationAgentPresetStepProjectionTarget(presetId: string, stepId: string): string {
  return `agent-preset-step:${encodeProjectionTargetPart(presetId)}:${encodeProjectionTargetPart(stepId)}`
}

export function pendingMutationAgentPresetOrderProjectionTarget(): string {
  return 'agent-preset-order'
}

export function pendingMutationAgentPresetDefaultProjectionTarget(): string {
  return 'agent-preset-default'
}

export function pendingMutationLoadoutRowProjectionTarget(loadoutId: string): string {
  return `loadout-row:${encodeProjectionTargetPart(loadoutId)}`
}

export function pendingMutationChatGenerationSettingsProjectionTarget(chatId: string): string {
  return `chat-generation-settings:${encodeProjectionTargetPart(chatId)}`
}

export function pendingMutationCharacterLorebooksProjectionTarget(characterId: string): string {
  return `character-lorebooks:${encodeProjectionTargetPart(characterId)}`
}

export function pendingMutationCharacterScriptsProjectionTarget(characterId: string): string {
  return `character-scripts:${encodeProjectionTargetPart(characterId)}`
}

export function pendingMutationCharacterTriggersProjectionTarget(characterId: string): string {
  return `character-triggers:${encodeProjectionTargetPart(characterId)}`
}

export function pendingMutationCharacterOrderProjectionTarget(): string {
  return 'character-order'
}

export function pendingMutationPersonaRowProjectionTarget(personaId: string): string {
  return `persona-row:${encodeProjectionTargetPart(personaId)}`
}

export function pendingMutationPresetRowProjectionTarget(
  kind: 'legacy' | 'model' | 'prompt',
  presetId: string,
): string {
  return `preset-row:${kind}:${encodeProjectionTargetPart(presetId)}`
}

export function pendingMutationSelectionProjectionTarget(
  kind: 'legacyPreset' | 'modelPreset' | 'persona' | 'promptPreset',
): string {
  return `selection:${kind}`
}

/**
 * Record additional concrete projection fields owned by an already-staged
 * durable generation. Registration preserves its original stage ordinal, so
 * late intent preparation cannot jump ahead of a newer user action.
 */
export function recordPendingMutationProjectionTargets(
  handle: PendingMutationHandle,
  targets: readonly string[],
): void {
  const scope = pendingMutationScopeFromHandle(handle)
  if (!scope) return
  recordLiveProjectionGeneration(projectionGenerationId(scope, handle.mutationId), scope, targets)
}

/** Advance concrete projection fields for optimistic writers without an outbox row. */
export function advancePendingMutationProjectionTargets(
  targets: readonly string[],
): PendingMutationLocalProjectionToken | null {
  const scope = pendingMutationScope
  if (!scope || targets.length === 0) return null
  const generationId = projectionGenerationId(scope, `local-${createMutationId()}`)
  recordLiveProjectionGeneration(generationId, scope, targets)
  return { generationId }
}

export function retirePendingMutationLocalProjectionToken(token: PendingMutationLocalProjectionToken | null): void {
  if (token) retireLiveProjectionGeneration(token.generationId)
}

export function acceptPendingMutationLocalProjectionToken(token: PendingMutationLocalProjectionToken | null): void {
  if (token) compactAcceptedLiveProjectionGeneration(token.generationId)
}

export function pendingMutationProjectionTargets(intent: DurableMutationIntent): string[] {
  const normalized = normalizeIntent(intent)
  const targets = new Set<string>()
  for (const request of normalized.requests) {
    for (const target of pendingMutationRequestProjectionTargets(request)) targets.add(target)
  }
  if (normalized.requests.some((request) => request.path === '/personas/select')) {
    for (const dependencyKey of normalized.dependencyKeys ?? []) {
      if (dependencyKey.startsWith('persona-profile:')) {
        targets.add(pendingMutationPersonaRowProjectionTarget(dependencyKey.slice('persona-profile:'.length)))
      }
    }
  }
  return Array.from(targets).sort()
}

export function pendingMutationProjectionFence(
  handle: PendingMutationHandle,
  target: string,
): PendingMutationProjectionFence | null {
  const scope = pendingMutationScopeFromHandle(handle)
  if (!scope) return null
  return liveProjectionFence(projectionGenerationId(scope, handle.mutationId), target)
}

export function pendingMutationLocalProjectionFence(
  token: PendingMutationLocalProjectionToken | null,
  target: string,
): PendingMutationProjectionFence | null {
  return token ? liveProjectionFence(token.generationId, target) : null
}

/** Test/support hook for asserting accepted-generation compaction. */
export function pendingMutationProjectionGenerationCountForTests(): number {
  return liveProjectionGenerations.size
}

function liveProjectionFence(generationId: string, target: string): PendingMutationProjectionFence | null {
  const generation = liveProjectionGenerations.get(generationId)
  if (!generation) return null
  const normalizedTarget = normalizeProjectionTarget(target)
  const targetKey = projectionTargetKey(generation.scope, normalizedTarget)
  if (!generation.targetKeys.has(targetKey)) return null
  return {
    target: normalizedTarget,
    generationId,
    ordinal: generation.ordinal,
    ownerWriterSessionId: generation.scope.writerSessionId,
    writerEpoch: generation.scope.writerEpoch,
    databaseLineage: generation.scope.databaseLineage,
  }
}

export function isPendingMutationProjectionFenceCurrent(fence: PendingMutationProjectionFence): boolean {
  const currentScope = pendingMutationScope
  if (
    !currentScope ||
    currentScope.writerSessionId !== fence.ownerWriterSessionId ||
    currentScope.writerEpoch !== fence.writerEpoch ||
    currentScope.databaseLineage !== fence.databaseLineage
  ) {
    return false
  }
  const targetKey = projectionTargetKey(
    {
      writerSessionId: fence.ownerWriterSessionId,
      writerEpoch: fence.writerEpoch,
      databaseLineage: fence.databaseLineage,
    },
    fence.target,
  )
  return liveProjectionGenerationStacks.get(targetKey)?.at(-1) === fence.generationId
}

export function retirePendingMutationProjectionTargets(handle: PendingMutationHandle): void {
  retirePendingMutationProjectionGeneration(handle)
}

/**
 * Recover a single unambiguous owner before writer-intent bootstrap when a
 * browser restart lost sessionStorage but retained IndexedDB.
 */
export async function readSinglePendingMutationOwner(): Promise<PendingMutationOwnerCandidate | null> {
  const database = await openOutboxDatabase()
  if (!database) return null
  try {
    const transaction = database.transaction(OUTBOX_MUTATION_STORE, 'readonly')
    const mutations = await requestResult<StoredPendingMutation[]>(
      transaction.objectStore(OUTBOX_MUTATION_STORE).getAll(),
    )
    await transactionDone(transaction)
    const owners = new Map<string, PendingMutationOwnerCandidate>()
    for (const mutation of mutations) {
      if (
        !SCOPE_VALUE_PATTERN.test(mutation.ownerWriterSessionId) ||
        !Number.isSafeInteger(mutation.writerEpoch) ||
        mutation.writerEpoch < 0 ||
        !SCOPE_VALUE_PATTERN.test(mutation.databaseLineage)
      ) {
        continue
      }
      const owner = {
        writerSessionId: mutation.ownerWriterSessionId,
        writerEpoch: mutation.writerEpoch,
        databaseLineage: mutation.databaseLineage,
      }
      owners.set(`${owner.writerSessionId}\u0000${owner.writerEpoch}\u0000${owner.databaseLineage}`, owner)
      if (owners.size > 1) return null
    }
    return owners.values().next().value ?? null
  } catch (error) {
    reportPersistenceWarning('Unable to recover pending-mutation ownership', error)
    return null
  }
}

/**
 * Bind subsequent staging and replay to the authenticated writer and the
 * concrete server database. A writer takeover quarantines that writer's old
 * drafts instead of replaying a mutation that was already rejected with 423.
 */
export async function preparePendingMutationOutbox(
  input: PreparePendingMutationOutboxInput,
): Promise<PreparePendingMutationOutboxSummary> {
  const scope = normalizeScope(input.writerSessionId, input.writerEpoch, input.databaseLineage)
  const ownershipChanged =
    pendingMutationScope !== null &&
    (pendingMutationScope.writerSessionId !== scope.writerSessionId ||
      pendingMutationScope.writerEpoch !== scope.writerEpoch ||
      pendingMutationScope.databaseLineage !== scope.databaseLineage)
  if (ownershipChanged) input.onOwnershipChange?.()
  if (!input.requestedWriterWasActive || ownershipChanged) {
    clearLivePendingMutationProjectionGenerations()
    clearRetainedChatProjections()
  }
  pendingMutationScope = scope
  const [database, encryptionKey] = await Promise.all([openOutboxDatabase(), getOutboxEncryptionKey()])
  if (!database || !encryptionKey) return { discarded: 0 }

  const discardedMutationIds: string[] = []
  try {
    const transaction = database.transaction([OUTBOX_MUTATION_STORE, OUTBOX_RECEIPT_ACK_STORE], 'readwrite')
    const mutationStore = transaction.objectStore(OUTBOX_MUTATION_STORE)
    const receiptStore = transaction.objectStore(OUTBOX_RECEIPT_ACK_STORE)
    const [mutations, receipts] = await Promise.all([
      requestResult<StoredPendingMutation[]>(mutationStore.getAll()),
      requestResult<PendingMutationReceiptAcknowledgement[]>(receiptStore.getAll()),
    ])
    for (const mutation of mutations) {
      const lineageMismatch = mutation.databaseLineage !== scope.databaseLineage
      const writerEpochMismatch = mutation.writerEpoch !== scope.writerEpoch
      const rejectedWriterDraft =
        !input.requestedWriterWasActive && mutation.ownerWriterSessionId === scope.writerSessionId
      if (lineageMismatch || writerEpochMismatch || rejectedWriterDraft) {
        mutationStore.delete(mutation.mutationId)
        discardedMutationIds.push(mutation.mutationId)
      }
    }
    for (const receipt of receipts) {
      if (receipt.databaseLineage !== scope.databaseLineage) receiptStore.delete(receipt.mutationId)
    }
    await transactionDone(transaction)
    for (const mutationId of discardedMutationIds) publishPendingMutationDiscard(mutationId)
  } catch (error) {
    reportPersistenceWarning('Unable to prepare the pending-mutation outbox', error)
    return { discarded: 0 }
  }
  return { discarded: discardedMutationIds.length }
}

/**
 * Observe rows removed while authenticated database ownership is prepared.
 * The durable dispatcher uses this hook to publish terminal settlements
 * without making the outbox import its higher-level dispatch module.
 */
export function registerPendingMutationDiscardListener(listener: PendingMutationDiscardListener): () => void {
  pendingMutationDiscardListeners.add(listener)
  return () => pendingMutationDiscardListeners.delete(listener)
}

function publishPendingMutationDiscard(mutationId: string): void {
  for (const listener of pendingMutationDiscardListeners) {
    try {
      listener(mutationId)
    } catch (error) {
      console.error('Pending mutation discard listener rejected:', error)
    }
  }
}

/**
 * Persist a coalesced autosave intent before its network debounce settles.
 *
 * Every generation gets a fresh receipt id. Restaging transactionally removes
 * an exact predecessor only while its persisted dispatch marker is still
 * false; otherwise both ordered rows remain durable for predecessor draining.
 */
export function stagePendingMutation(
  key: string,
  intent: DurableMutationIntent,
  previous?: PendingMutationHandle | null,
): PendingMutationHandle {
  const semanticKey = normalizeOutboxKey(key)
  const normalizedIntent = normalizeIntent(intent)
  const scope = pendingMutationScope
  const replacePrevious =
    !!scope &&
    previous?.phase === 'staged' &&
    previous.key === semanticKey &&
    previous.ownerWriterSessionId === scope.writerSessionId &&
    previous.writerEpoch === scope.writerEpoch &&
    previous.databaseLineage === scope.databaseLineage
  // A server receipt permanently binds an id to one semantic fingerprint.
  // Restaging therefore always gets a fresh id; the persistence transaction
  // below may still atomically remove an exact predecessor that never started.
  const mutationId = createMutationId()
  const sequence = nextMutationSequence()

  if (replacePrevious && previous) previous.phase = 'superseded'

  const ready = scope
    ? persistPendingMutation(
        semanticKey,
        mutationId,
        sequence,
        scope,
        reservePendingMutationOrder(),
        normalizedIntent,
        replacePrevious ? previous : null,
      )
    : Promise.resolve('unavailable' as const)
  if (!scope) reportPersistenceWarning('Pending mutation staged before server database ownership was established')

  const handle: PendingMutationHandle = {
    key: semanticKey,
    mutationId,
    sequence,
    ownerWriterSessionId: scope?.writerSessionId ?? null,
    writerEpoch: scope?.writerEpoch ?? null,
    databaseLineage: scope?.databaseLineage ?? null,
    phase: 'staged',
    ready,
  }
  recordPendingMutationProjectionTargets(handle, pendingMutationProjectionTargets(normalizedIntent))
  void ready.then((status) => {
    if (status !== 'persisted') retirePendingMutationProjectionGeneration(handle)
  })
  return handle
}

/** Exact encrypted JSON envelope size used by the persisted outbox row. */
export function pendingMutationIntentPayloadByteLength(intent: DurableMutationIntent): number {
  return serializePendingMutationIntent(normalizeIntent(intent)).byteLength
}

/** Freeze this exact payload/id for dispatch. Later edits must stage a new id. */
export async function beginPendingMutationDispatch(
  handle: PendingMutationHandle,
): Promise<PendingMutationPersistenceStatus> {
  if (handle.phase === 'superseded') return 'superseded'
  handle.phase = 'dispatching'
  const persistence = await handle.ready
  if (persistence !== 'persisted') return persistence
  return markPendingMutationDispatchStarted(handle)
}

/**
 * Replace a queued placeholder with its exact prepared request without moving
 * its durable order. The sequence changes so a replay that already decrypted
 * the placeholder cannot send it after this transaction wins. If dispatch
 * marked the placeholder first, preserve it and return a fresh successor.
 */
export async function replaceStagedPendingMutationIntent(
  handle: PendingMutationHandle,
  intent: DurableMutationIntent,
): Promise<PendingMutationIntentReplacementResult> {
  if (handle.phase !== 'staged') return { status: 'superseded' }
  const normalizedIntent = normalizeIntent(intent)
  const replacement = await replacePendingMutationIntentExact(handle, normalizedIntent)
  if (replacement.status === 'replaced') {
    handle.phase = 'superseded'
    recordPendingMutationProjectionTargets(replacement.handle, pendingMutationProjectionTargets(normalizedIntent))
    return replacement
  }
  if (replacement.status === 'unavailable') return { status: 'unavailable' }

  const scope = pendingMutationScope
  if (!scope || !pendingMutationScopeMatchesHandle(scope, handle)) return { status: 'superseded' }
  handle.phase = 'superseded'
  const successor = stagePendingMutation(handle.key, normalizedIntent)
  const persistence = await successor.ready
  return persistence === 'persisted' ? { status: 'successor', handle: successor } : { status: persistence }
}

/** Verify the exact encrypted generation still exists before starting a request. */
export async function isPendingMutationCurrent(handle: PendingMutationHandle): Promise<boolean> {
  const database = await openOutboxDatabase()
  if (!database || !handle.ownerWriterSessionId || handle.writerEpoch === null || !handle.databaseLineage) return false
  try {
    const transaction = database.transaction(OUTBOX_MUTATION_STORE, 'readonly')
    const current = await requestResult<StoredPendingMutation | undefined>(
      transaction.objectStore(OUTBOX_MUTATION_STORE).get(handle.mutationId),
    )
    await transactionDone(transaction)
    return storedMutationMatchesHandle(current, handle)
  } catch (error) {
    reportPersistenceWarning('Unable to verify a pending server mutation', error)
    return false
  }
}

async function markPendingMutationDispatchStarted(
  handle: PendingMutationHandle,
): Promise<PendingMutationPersistenceStatus> {
  const database = await openOutboxDatabase()
  if (!database) return 'unavailable'
  try {
    const transaction = database.transaction(OUTBOX_MUTATION_STORE, 'readwrite')
    const store = transaction.objectStore(OUTBOX_MUTATION_STORE)
    const current = await requestResult<StoredPendingMutation | undefined>(store.get(handle.mutationId))
    const matches = storedMutationMatchesHandle(current, handle)
    if (matches && current && current.dispatchStarted !== true) {
      store.put({ ...current, dispatchStarted: true } satisfies StoredPendingMutation)
    }
    await transactionDone(transaction)
    return matches ? 'persisted' : 'superseded'
  } catch (error) {
    reportPersistenceWarning('Unable to mark a pending server mutation for dispatch', error)
    return 'unavailable'
  }
}

/** Delete a no-op or terminally rejected intent without creating a receipt ACK. */
export async function discardPendingMutation(handle: PendingMutationHandle): Promise<PendingMutationAcknowledgement> {
  const persistence = await handle.ready
  if (persistence === 'unavailable') {
    retirePendingMutationProjectionGeneration(handle)
    return 'unavailable'
  }
  const database = await openOutboxDatabase()
  if (!database) return 'unavailable'

  try {
    const transaction = database.transaction(OUTBOX_MUTATION_STORE, 'readwrite')
    const store = transaction.objectStore(OUTBOX_MUTATION_STORE)
    const current = await requestResult<StoredPendingMutation | undefined>(store.get(handle.mutationId))
    const matches = storedMutationMatchesHandle(current, handle)
    if (matches) store.delete(handle.mutationId)
    await transactionDone(transaction)
    if (matches) retirePendingMutationProjectionGeneration(handle)
    return matches ? 'deleted' : 'superseded'
  } catch (error) {
    reportPersistenceWarning('Unable to discard a pending server mutation', error)
    return 'unavailable'
  }
}

/** Compatibility name for callers cancelling a staged/no-op mutation. */
export const acknowledgePendingMutation = discardPendingMutation

/**
 * Atomically remove an accepted intent and queue its server receipt cleanup.
 * A crash at any later point can leak neither the domain intent nor the ACK.
 */
export async function completePendingMutation(
  handle: PendingMutationHandle,
  requestCount: number,
): Promise<PendingMutationAcknowledgement> {
  if (!Number.isInteger(requestCount) || requestCount < 1 || requestCount > MAX_DURABLE_MUTATION_REQUESTS) {
    throw new RangeError('Pending mutation receipt request count is invalid')
  }
  const persistence = await handle.ready
  if (persistence === 'unavailable' || !handle.databaseLineage) return 'unavailable'
  const database = await openOutboxDatabase()
  if (!database) return 'unavailable'

  try {
    const transaction = database.transaction([OUTBOX_MUTATION_STORE, OUTBOX_RECEIPT_ACK_STORE], 'readwrite')
    const mutationStore = transaction.objectStore(OUTBOX_MUTATION_STORE)
    const current = await requestResult<StoredPendingMutation | undefined>(mutationStore.get(handle.mutationId))
    const matches = storedMutationMatchesHandle(current, handle)
    if (matches) {
      mutationStore.delete(handle.mutationId)
      transaction.objectStore(OUTBOX_RECEIPT_ACK_STORE).put({
        mutationId: handle.mutationId,
        requestCount,
        databaseLineage: handle.databaseLineage,
        queuedAt: Date.now(),
      } satisfies PendingMutationReceiptAcknowledgement)
    }
    await transactionDone(transaction)
    if (matches) compactAcceptedPendingMutationProjectionGeneration(handle)
    return matches ? 'deleted' : 'superseded'
  } catch (error) {
    reportPersistenceWarning('Unable to complete a pending server mutation', error)
    return 'unavailable'
  }
}

export async function listPendingMutations(): Promise<PendingMutationOutboxEntry[]> {
  const scope = pendingMutationScope
  const [database, encryptionKey] = await Promise.all([openOutboxDatabase(), getOutboxEncryptionKey()])
  if (!database || !encryptionKey || !scope) return []

  let stored: StoredPendingMutation[]
  try {
    const transaction = database.transaction(OUTBOX_MUTATION_STORE, 'readonly')
    stored = await requestResult<StoredPendingMutation[]>(transaction.objectStore(OUTBOX_MUTATION_STORE).getAll())
    await transactionDone(transaction)
  } catch (error) {
    reportPersistenceWarning('Unable to read pending server mutations', error)
    return []
  }

  const entries: PendingMutationOutboxEntry[] = []
  for (const record of stored
    .filter(
      (candidate) =>
        candidate.ownerWriterSessionId === scope.writerSessionId && candidate.databaseLineage === scope.databaseLineage,
    )
    .filter((candidate) => candidate.writerEpoch === scope.writerEpoch)
    .sort((left, right) => left.order - right.order)) {
    try {
      const intent = await decryptIntent(record, encryptionKey)
      const handle: PendingMutationHandle = {
        key: record.semanticKey,
        mutationId: record.mutationId,
        sequence: record.sequence,
        ownerWriterSessionId: record.ownerWriterSessionId,
        writerEpoch: record.writerEpoch,
        databaseLineage: record.databaseLineage,
        phase: 'staged',
        ready: Promise.resolve('persisted'),
      }
      entries.push({ handle, intent })
    } catch (error) {
      reportPersistenceWarning(`Unable to decrypt pending server mutation ${record.semanticKey}`, error)
    }
  }
  return entries
}

/**
 * Count the current writer/database's raw encrypted rows without decrypting
 * them. Startup uses this after replay so an unreadable intent cannot be
 * mistaken for an empty outbox and followed by stale authoritative hydration.
 */
export async function countPendingMutationRecords(): Promise<number | null> {
  const scope = pendingMutationScope
  if (!scope) return 0
  if (typeof globalThis.indexedDB === 'undefined') return 0
  const database = await openOutboxDatabase()
  if (!database) return null

  try {
    const transaction = database.transaction(OUTBOX_MUTATION_STORE, 'readonly')
    const stored = await requestResult<StoredPendingMutation[]>(transaction.objectStore(OUTBOX_MUTATION_STORE).getAll())
    await transactionDone(transaction)
    return stored.filter(
      (candidate) =>
        candidate.ownerWriterSessionId === scope.writerSessionId &&
        candidate.writerEpoch === scope.writerEpoch &&
        candidate.databaseLineage === scope.databaseLineage,
    ).length
  } catch (error) {
    reportPersistenceWarning('Unable to count pending server mutations', error)
    return null
  }
}

/**
 * Read the transitive closure of older generations that this mutation owns or
 * depends on. A dependency introduced by an older predecessor only reaches
 * rows older than that predecessor, preserving the durable global-order
 * cutoff instead of pulling unrelated newer work into the chain.
 */
export async function listPendingMutationPredecessors(
  handle: PendingMutationHandle,
  additionalDependencyKeys: readonly string[] = [],
): Promise<PendingMutationPredecessorResult> {
  const persistence = await handle.ready
  if (persistence !== 'persisted') return { status: persistence }
  const [database, encryptionKey] = await Promise.all([openOutboxDatabase(), getOutboxEncryptionKey()])
  if (!database || !encryptionKey) return { status: 'unavailable' }

  let records: StoredPendingMutation[]
  try {
    const transaction = database.transaction(OUTBOX_MUTATION_STORE, 'readonly')
    records = await requestResult<StoredPendingMutation[]>(transaction.objectStore(OUTBOX_MUTATION_STORE).getAll())
    await transactionDone(transaction)
  } catch (error) {
    reportPersistenceWarning('Unable to read pending server mutation predecessors', error)
    return { status: 'unavailable' }
  }

  const current = records.find((record) => record.mutationId === handle.mutationId)
  if (!current || !storedMutationMatchesHandle(current, handle)) return { status: 'superseded' }
  const scopedPredecessors = records
    .filter(
      (record) =>
        record.ownerWriterSessionId === current.ownerWriterSessionId &&
        record.writerEpoch === current.writerEpoch &&
        record.databaseLineage === current.databaseLineage &&
        record.order < current.order,
    )
    .sort((left, right) => left.order - right.order)

  try {
    const currentIntent = await decryptIntent(current, encryptionKey)
    const orderCutoffByKey = new Map<string, number>([[current.semanticKey, current.order]])
    for (const dependencyKey of [
      ...(currentIntent.dependencyKeys ?? []),
      ...normalizeDependencyKeys(additionalDependencyKeys, false),
    ]) {
      orderCutoffByKey.set(dependencyKey, current.order)
    }

    const selected = new Map<string, PendingMutationOutboxEntry>()
    let expanded = true
    while (expanded) {
      expanded = false
      for (const record of scopedPredecessors) {
        if (selected.has(record.mutationId)) continue
        const cutoff = orderCutoffByKey.get(record.semanticKey)
        if (cutoff === undefined || record.order >= cutoff) continue

        const intent = await decryptIntent(record, encryptionKey)
        selected.set(record.mutationId, {
          handle: {
            key: record.semanticKey,
            mutationId: record.mutationId,
            sequence: record.sequence,
            ownerWriterSessionId: record.ownerWriterSessionId,
            writerEpoch: record.writerEpoch,
            databaseLineage: record.databaseLineage,
            phase: 'staged',
            ready: Promise.resolve('persisted'),
          },
          intent,
        })
        expanded = true

        for (const dependencyKey of intent.dependencyKeys ?? []) {
          const previousCutoff = orderCutoffByKey.get(dependencyKey)
          if (previousCutoff === undefined || previousCutoff < record.order) {
            orderCutoffByKey.set(dependencyKey, record.order)
          }
        }
      }
    }

    const entries = scopedPredecessors
      .map((record) => selected.get(record.mutationId))
      .filter((entry): entry is PendingMutationOutboxEntry => entry !== undefined)
    return {
      status: 'ok',
      entries,
      semanticKeys: Array.from(orderCutoffByKey.keys()).sort(),
    }
  } catch (error) {
    reportPersistenceWarning(`Unable to decrypt pending predecessor ${current.semanticKey}`, error)
    return { status: 'unavailable' }
  }
}

export async function listPendingMutationReceiptAcknowledgements(): Promise<PendingMutationReceiptAcknowledgement[]> {
  const database = await openOutboxDatabase()
  const lineage = pendingMutationScope?.databaseLineage
  if (!database || !lineage) return []
  try {
    const transaction = database.transaction(OUTBOX_RECEIPT_ACK_STORE, 'readonly')
    const records = await requestResult<PendingMutationReceiptAcknowledgement[]>(
      transaction.objectStore(OUTBOX_RECEIPT_ACK_STORE).getAll(),
    )
    await transactionDone(transaction)
    return records
      .filter((record) => record.databaseLineage === lineage)
      .sort((left, right) => left.queuedAt - right.queuedAt)
  } catch (error) {
    reportPersistenceWarning('Unable to read pending mutation receipt acknowledgements', error)
    return []
  }
}

export async function deletePendingMutationReceiptAcknowledgement(
  acknowledgement: PendingMutationReceiptAcknowledgement,
): Promise<boolean> {
  const database = await openOutboxDatabase()
  if (!database) return false
  try {
    const transaction = database.transaction(OUTBOX_RECEIPT_ACK_STORE, 'readwrite')
    const store = transaction.objectStore(OUTBOX_RECEIPT_ACK_STORE)
    const current = await requestResult<PendingMutationReceiptAcknowledgement | undefined>(
      store.get(acknowledgement.mutationId),
    )
    const matches =
      current?.requestCount === acknowledgement.requestCount &&
      current.databaseLineage === acknowledgement.databaseLineage
    if (matches) store.delete(acknowledgement.mutationId)
    await transactionDone(transaction)
    return matches
  } catch (error) {
    reportPersistenceWarning('Unable to delete a pending mutation receipt acknowledgement', error)
    return false
  }
}

/** Test/support hook. Production callers should delete exact handles. */
export async function clearPendingMutationOutbox(): Promise<void> {
  clearLivePendingMutationProjectionGenerations()
  clearRetainedChatProjections()
  const database = await openOutboxDatabase()
  if (!database) return
  const transaction = database.transaction([OUTBOX_MUTATION_STORE, OUTBOX_RECEIPT_ACK_STORE], 'readwrite')
  transaction.objectStore(OUTBOX_MUTATION_STORE).clear()
  transaction.objectStore(OUTBOX_RECEIPT_ACK_STORE).clear()
  await transactionDone(transaction)
}

export function resetPendingMutationOutboxForTests(): void {
  outboxDatabasePromise = null
  outboxEncryptionKeyPromise = null
  nextSequenceOffset = 0
  nextProjectionGenerationOrdinal = 0
  persistenceWarningReported = false
  pendingMutationScope = null
  clearLivePendingMutationProjectionGenerations()
  clearRetainedChatProjections()
}

async function persistPendingMutation(
  semanticKey: string,
  mutationId: string,
  sequence: number,
  scope: PendingMutationScope,
  reservedOrder: Promise<number | null>,
  intent: DurableMutationIntent,
  replacement: PendingMutationHandle | null,
): Promise<PendingMutationPersistenceStatus> {
  if (!pendingMutationScopeEquals(scope)) return 'superseded'
  const replacementPersistence = replacement ? await replacement.ready : null
  const persistedReplacement = replacementPersistence === 'persisted' ? replacement : null
  if (!pendingMutationScopeEquals(scope)) return 'superseded'
  const [database, encryptionKey, order] = await Promise.all([
    openOutboxDatabase(),
    getOutboxEncryptionKey(),
    reservedOrder,
  ])
  if (!database || !encryptionKey || order === null) return 'unavailable'

  try {
    const payload = serializePendingMutationIntent(intent)
    if (payload.byteLength > MAX_DURABLE_MUTATION_PAYLOAD_BYTES) {
      throw new RangeError('Pending mutation payload is too large')
    }
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)))
    const ciphertext = await globalThis.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: mutationAdditionalData(semanticKey, mutationId, sequence, order, scope),
      },
      encryptionKey,
      payload,
    )
    const transaction = database.transaction(OUTBOX_MUTATION_STORE, 'readwrite')
    const store = transaction.objectStore(OUTBOX_MUTATION_STORE)
    const [current, replaced] = await Promise.all([
      requestResult<StoredPendingMutation | undefined>(store.get(mutationId)),
      persistedReplacement
        ? requestResult<StoredPendingMutation | undefined>(store.get(persistedReplacement.mutationId))
        : Promise.resolve(undefined),
    ])
    if (current) {
      await transactionDone(transaction)
      return 'superseded'
    }
    if (!pendingMutationScopeEquals(scope)) {
      await transactionDone(transaction)
      return 'superseded'
    }
    store.put({
      mutationId,
      semanticKey,
      sequence,
      order,
      dispatchStarted: false,
      ownerWriterSessionId: scope.writerSessionId,
      writerEpoch: scope.writerEpoch,
      databaseLineage: scope.databaseLineage,
      updatedAt: Date.now(),
      iv: iv.buffer,
      ciphertext,
    } satisfies StoredPendingMutation)
    const replacementDeleted =
      persistedReplacement &&
      storedMutationMatchesHandle(replaced, persistedReplacement) &&
      replaced?.dispatchStarted !== true
    if (replacementDeleted && persistedReplacement) {
      store.delete(persistedReplacement.mutationId)
    }
    await transactionDone(transaction)
    if (replacementDeleted && persistedReplacement) {
      retirePendingMutationProjectionGeneration(persistedReplacement)
    }
    return 'persisted'
  } catch (error) {
    reportPersistenceWarning('Unable to persist a pending server mutation', error)
    return 'unavailable'
  }
}

type ExactPendingMutationIntentReplacementResult =
  | { status: 'replaced'; handle: PendingMutationHandle }
  | { status: 'started' | 'superseded' | 'unavailable' }

async function replacePendingMutationIntentExact(
  handle: PendingMutationHandle,
  intent: DurableMutationIntent,
): Promise<ExactPendingMutationIntentReplacementResult> {
  const persistence = await handle.ready
  if (persistence !== 'persisted') return { status: persistence }
  const [database, encryptionKey] = await Promise.all([openOutboxDatabase(), getOutboxEncryptionKey()])
  if (!database || !encryptionKey) return { status: 'unavailable' }

  try {
    const readTransaction = database.transaction(OUTBOX_MUTATION_STORE, 'readonly')
    const candidate = await requestResult<StoredPendingMutation | undefined>(
      readTransaction.objectStore(OUTBOX_MUTATION_STORE).get(handle.mutationId),
    )
    await transactionDone(readTransaction)
    if (!candidate || !storedMutationMatchesHandle(candidate, handle)) return { status: 'superseded' }
    if (candidate.dispatchStarted === true) return { status: 'started' }

    const sequence = nextMutationSequence()
    const payload = serializePendingMutationIntent(intent)
    if (payload.byteLength > MAX_DURABLE_MUTATION_PAYLOAD_BYTES) {
      throw new RangeError('Pending mutation payload is too large')
    }
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)))
    const scope: PendingMutationScope = {
      writerSessionId: candidate.ownerWriterSessionId,
      writerEpoch: candidate.writerEpoch,
      databaseLineage: candidate.databaseLineage,
    }
    const ciphertext = await globalThis.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: mutationAdditionalData(
          candidate.semanticKey,
          candidate.mutationId,
          sequence,
          candidate.order,
          scope,
        ),
      },
      encryptionKey,
      payload,
    )

    const transaction = database.transaction(OUTBOX_MUTATION_STORE, 'readwrite')
    const store = transaction.objectStore(OUTBOX_MUTATION_STORE)
    const current = await requestResult<StoredPendingMutation | undefined>(store.get(handle.mutationId))
    if (!current || !storedMutationMatchesHandle(current, handle)) {
      await transactionDone(transaction)
      return { status: 'superseded' }
    }
    if (current.dispatchStarted === true) {
      await transactionDone(transaction)
      return { status: 'started' }
    }
    store.put({
      ...current,
      sequence,
      dispatchStarted: false,
      updatedAt: Date.now(),
      iv: iv.buffer,
      ciphertext,
    } satisfies StoredPendingMutation)
    await transactionDone(transaction)
    return {
      status: 'replaced',
      handle: {
        key: current.semanticKey,
        mutationId: current.mutationId,
        sequence,
        ownerWriterSessionId: current.ownerWriterSessionId,
        writerEpoch: current.writerEpoch,
        databaseLineage: current.databaseLineage,
        phase: 'staged',
        ready: Promise.resolve('persisted'),
      },
    }
  } catch (error) {
    reportPersistenceWarning('Unable to replace a staged pending server mutation', error)
    return { status: 'unavailable' }
  }
}

async function decryptIntent(record: StoredPendingMutation, encryptionKey: CryptoKey): Promise<DurableMutationIntent> {
  const plaintext = await globalThis.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: new Uint8Array(record.iv),
      additionalData: mutationAdditionalData(record.semanticKey, record.mutationId, record.sequence, record.order, {
        writerSessionId: record.ownerWriterSessionId,
        writerEpoch: record.writerEpoch,
        databaseLineage: record.databaseLineage,
      }),
    },
    encryptionKey,
    record.ciphertext,
  )
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<EncryptedPendingMutationPayload>
  return normalizeIntent(parsed.intent)
}

function normalizeIntent(value: unknown): DurableMutationIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Pending mutation intent must be an object')
  }
  const record = value as Partial<DurableMutationIntent>
  if (record.version !== 1 || !Array.isArray(record.requests)) {
    throw new TypeError('Unsupported pending mutation intent')
  }
  if (record.requests.length === 0 || record.requests.length > MAX_DURABLE_MUTATION_REQUESTS) {
    throw new RangeError('Pending mutation request count is invalid')
  }
  let dependencyKeys: string[] = []
  if (record.dependencyKeys !== undefined) {
    if (!Array.isArray(record.dependencyKeys)) {
      throw new TypeError('Pending mutation dependency keys must be an array')
    }
    dependencyKeys = normalizeDependencyKeys(record.dependencyKeys)
  }
  return {
    version: 1,
    requests: record.requests.map(normalizeRequest),
    ...(dependencyKeys.length === 0 ? {} : { dependencyKeys }),
  }
}

function serializePendingMutationIntent(intent: DurableMutationIntent): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify({ intent } satisfies EncryptedPendingMutationPayload))
}

function normalizeRequest(value: unknown): DurableMutationRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Pending mutation request must be an object')
  }
  const request = value as Partial<DurableMutationRequest>
  if (!['DELETE', 'PATCH', 'POST', 'PUT'].includes(request.method ?? '')) {
    throw new TypeError('Pending mutation request method is invalid')
  }
  if (
    typeof request.path !== 'string' ||
    !request.path.startsWith('/') ||
    request.path.startsWith('//') ||
    request.path.includes('..') ||
    request.path.length > 2_048
  ) {
    throw new TypeError('Pending mutation command path is invalid')
  }
  const method = request.method as DurableMutationRequestMethod
  if (
    !ALLOWED_DURABLE_COMMANDS.some((candidate) => candidate.method === method && candidate.path.test(request.path!))
  ) {
    throw new TypeError('Pending mutation command path is not allowlisted')
  }
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
    throw new TypeError('Pending mutation request body must be an object')
  }
  if (Object.prototype.hasOwnProperty.call(request.body, 'baseRevision')) {
    throw new TypeError('Pending mutation intent must not persist a base revision')
  }
  return {
    method,
    path: request.path,
    body: isImmutableJsonSnapshot(request.body) ? request.body : cloneJsonValue(request.body),
  }
}

function isImmutableJsonSnapshot(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0)
  if (!value || typeof value !== 'object' || !Object.isFrozen(value) || ancestors.has(value)) return false

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const keys = Object.keys(value)
      const ownKeys = Reflect.ownKeys(value)
      if (keys.length !== value.length || ownKeys.length !== value.length + 1 || !ownKeys.includes('length')) {
        return false
      }
      for (let index = 0; index < value.length; index += 1) {
        if (keys[index] !== String(index)) return false
      }
      return value.every((entry) => isImmutableJsonSnapshot(entry, ancestors))
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return false
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) return false
      if (!isImmutableJsonSnapshot(descriptor.value, ancestors)) return false
    }
    return true
  } finally {
    ancestors.delete(value)
  }
}

function pendingMutationRequestProjectionTargets(request: DurableMutationRequest): string[] {
  if (request.method === 'PATCH' && request.path.startsWith('/settings/')) {
    const patch = request.body.patch
    if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
      const fields = Object.keys(patch as Record<string, unknown>)
      if (fields.length > 0) return fields.map(pendingMutationSettingsFieldProjectionTarget)
    }
  }

  if (request.method === 'POST' && request.path === '/modules/enable') {
    return typeof request.body.moduleId === 'string'
      ? [pendingMutationModuleEnabledProjectionTarget(request.body.moduleId)]
      : []
  }

  if (request.method === 'POST' && request.path === '/characters/reorder') {
    return [pendingMutationCharacterOrderProjectionTarget()]
  }

  if (request.method === 'POST' && request.path === '/plugins') {
    const plugin = request.body.plugin
    const pluginId =
      plugin && typeof plugin === 'object' && !Array.isArray(plugin)
        ? (plugin as Record<string, unknown>).name
        : undefined
    return typeof pluginId === 'string' ? [pendingMutationPluginRowProjectionTarget(pluginId)] : []
  }

  if (request.method === 'POST' && request.path === '/plugins/provider') {
    return [pendingMutationPluginProviderProjectionTarget()]
  }
  if (request.method === 'POST' && request.path === '/plugins/reorder') {
    return [pendingMutationPluginOrderProjectionTarget()]
  }

  const pluginEnable = request.method === 'POST' ? /^\/plugins\/([^/]+)\/enable$/.exec(request.path) : null
  if (pluginEnable) {
    return [pendingMutationPluginRowProjectionTarget(decodeProjectionTargetPart(pluginEnable[1]!))]
  }

  const pluginRow =
    request.method === 'PATCH' || request.method === 'DELETE' ? /^\/plugins\/([^/]+)$/.exec(request.path) : null
  if (pluginRow) {
    const targets = [pendingMutationPluginRowProjectionTarget(decodeProjectionTargetPart(pluginRow[1]!))]
    if (request.method === 'DELETE') targets.push(pendingMutationPluginProviderProjectionTarget())
    return targets
  }

  const pluginStorageKey =
    request.method === 'PUT' || request.method === 'DELETE' ? /^\/plugin-storage\/([^/]+)$/.exec(request.path) : null
  if (pluginStorageKey) {
    return [pendingMutationPluginStorageProjectionTarget(decodeProjectionTargetPart(pluginStorageKey[1]!))]
  }

  if (request.method === 'POST' && request.path === '/plugin-storage/bulk') {
    const keys = new Set<string>()
    const values = request.body.values
    if (values && typeof values === 'object' && !Array.isArray(values)) {
      for (const key of Object.keys(values as Record<string, unknown>)) keys.add(key)
    }
    const deleteKeys = request.body.deleteKeys
    if (Array.isArray(deleteKeys)) {
      for (const key of deleteKeys) if (typeof key === 'string') keys.add(key)
    }
    return keys.size > 0 ? [...keys].map(pendingMutationPluginStorageProjectionTarget) : ['plugin-storage:collection']
  }

  if (request.method === 'POST' && request.path === '/agent-presets') {
    return [pendingMutationAgentPresetCollectionProjectionTarget()]
  }
  if (request.method === 'POST' && request.path === '/agent-presets/reorder') {
    return [pendingMutationAgentPresetOrderProjectionTarget()]
  }
  if (request.method === 'POST' && request.path === '/agent-presets/default') {
    return [pendingMutationAgentPresetDefaultProjectionTarget()]
  }

  const agentPresetStepDuplicate =
    request.method === 'POST' ? /^\/agent-presets\/([^/]+)\/steps\/([^/]+)\/duplicate$/.exec(request.path) : null
  if (agentPresetStepDuplicate) {
    return [pendingMutationAgentPresetStepsProjectionTarget(decodeProjectionTargetPart(agentPresetStepDuplicate[1]!))]
  }

  const agentPresetStepReorder =
    request.method === 'POST' ? /^\/agent-presets\/([^/]+)\/steps\/reorder$/.exec(request.path) : null
  if (agentPresetStepReorder) {
    return [pendingMutationAgentPresetStepsProjectionTarget(decodeProjectionTargetPart(agentPresetStepReorder[1]!))]
  }

  const agentPresetStepCollection =
    request.method === 'POST' ? /^\/agent-presets\/([^/]+)\/steps$/.exec(request.path) : null
  if (agentPresetStepCollection) {
    return [pendingMutationAgentPresetStepsProjectionTarget(decodeProjectionTargetPart(agentPresetStepCollection[1]!))]
  }

  const agentPresetStepRow =
    request.method === 'PATCH' || request.method === 'DELETE'
      ? /^\/agent-presets\/([^/]+)\/steps\/([^/]+)$/.exec(request.path)
      : null
  if (agentPresetStepRow) {
    const presetId = decodeProjectionTargetPart(agentPresetStepRow[1]!)
    const targets = [
      pendingMutationAgentPresetStepProjectionTarget(presetId, decodeProjectionTargetPart(agentPresetStepRow[2]!)),
    ]
    if (request.method === 'DELETE') targets.push(pendingMutationAgentPresetStepsProjectionTarget(presetId))
    return targets
  }

  const agentPresetDuplicate =
    request.method === 'POST' ? /^\/agent-presets\/([^/]+)\/duplicate$/.exec(request.path) : null
  if (agentPresetDuplicate) return [pendingMutationAgentPresetCollectionProjectionTarget()]

  const agentPresetRow =
    request.method === 'PATCH' || request.method === 'DELETE' ? /^\/agent-presets\/([^/]+)$/.exec(request.path) : null
  if (agentPresetRow) {
    const targets = [pendingMutationAgentPresetRowProjectionTarget(decodeProjectionTargetPart(agentPresetRow[1]!))]
    if (request.method === 'DELETE') {
      targets.push(
        pendingMutationAgentPresetOrderProjectionTarget(),
        pendingMutationAgentPresetDefaultProjectionTarget(),
      )
    }
    return targets
  }

  const deletedModule = request.method === 'DELETE' ? /^\/modules\/([^/]+)$/.exec(request.path) : null
  if (deletedModule) {
    return [pendingMutationModuleEnabledProjectionTarget(decodeProjectionTargetPart(deletedModule[1]!))]
  }

  const chatGenerationSettings = /^\/chats\/([^/]+)\/generation-settings$/.exec(request.path)
  if (request.method === 'PUT' && chatGenerationSettings) {
    return [
      pendingMutationChatGenerationSettingsProjectionTarget(decodeProjectionTargetPart(chatGenerationSettings[1]!)),
    ]
  }

  const characterLorebooksCollection =
    request.method === 'PUT' ? /^\/characters\/([^/]+)\/lorebooks$/.exec(request.path) : null
  const characterLorebookEntry =
    request.method === 'PUT' || request.method === 'DELETE'
      ? /^\/characters\/([^/]+)\/lorebooks\/entries\/[^/]+$/.exec(request.path)
      : null
  const characterLorebookReorder =
    request.method === 'POST' ? /^\/characters\/([^/]+)\/lorebooks\/entries\/reorder$/.exec(request.path) : null
  const characterLorebooks = characterLorebooksCollection ?? characterLorebookEntry ?? characterLorebookReorder
  if (characterLorebooks) {
    return [pendingMutationCharacterLorebooksProjectionTarget(decodeProjectionTargetPart(characterLorebooks[1]!))]
  }

  const characterDefinitions =
    request.method === 'PUT' || request.method === 'PATCH'
      ? /^\/characters\/([^/]+)\/(scripts|triggers)$/.exec(request.path)
      : null
  if (characterDefinitions) {
    const characterId = decodeProjectionTargetPart(characterDefinitions[1]!)
    return [
      characterDefinitions[2] === 'scripts'
        ? pendingMutationCharacterScriptsProjectionTarget(characterId)
        : pendingMutationCharacterTriggersProjectionTarget(characterId),
    ]
  }

  const loadoutTouch = request.method === 'POST' ? /^\/loadouts\/([^/]+)\/touch$/.exec(request.path) : null
  if (loadoutTouch) {
    return [
      pendingMutationLoadoutRowProjectionTarget(decodeProjectionTargetPart(loadoutTouch[1]!)),
      pendingMutationSettingsFieldProjectionTarget('lastLoadedLoadoutName'),
    ]
  }

  if (request.method === 'POST' && request.path === '/loadouts') {
    const loadout = request.body.loadout
    if (loadout && typeof loadout === 'object' && !Array.isArray(loadout)) {
      const loadoutId = (loadout as Record<string, unknown>).id
      if (typeof loadoutId === 'string') return [pendingMutationLoadoutRowProjectionTarget(loadoutId)]
    }
  }

  const loadoutRow = /^\/loadouts\/([^/]+)(?:\/favorite)?$/.exec(request.path)
  if ((request.method === 'DELETE' || request.method === 'POST') && loadoutRow) {
    return [pendingMutationLoadoutRowProjectionTarget(decodeProjectionTargetPart(loadoutRow[1]!))]
  }

  const personaPatch = request.method === 'PATCH' ? /^\/personas\/([^/]+)$/.exec(request.path) : null
  if (personaPatch) {
    return [pendingMutationPersonaRowProjectionTarget(decodeProjectionTargetPart(personaPatch[1]!))]
  }

  const presetRow = /^\/(presets|model-presets|prompt-presets)\/([^/]+)$/.exec(request.path)
  if ((request.method === 'PATCH' || request.method === 'DELETE') && presetRow) {
    const kind = presetRow[1] === 'presets' ? 'legacy' : presetRow[1] === 'model-presets' ? 'model' : 'prompt'
    return [pendingMutationPresetRowProjectionTarget(kind, decodeProjectionTargetPart(presetRow[2]!))]
  }

  const selectionTarget =
    request.path === '/personas/select'
      ? pendingMutationSelectionProjectionTarget('persona')
      : request.path === '/presets/select'
        ? pendingMutationSelectionProjectionTarget('legacyPreset')
        : request.path === '/model-presets/select'
          ? pendingMutationSelectionProjectionTarget('modelPreset')
          : request.path === '/prompt-presets/select'
            ? pendingMutationSelectionProjectionTarget('promptPreset')
            : null
  if (selectionTarget) return [selectionTarget]

  return [`request:${request.method}:${request.path}`]
}

function encodeProjectionTargetPart(value: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError('Pending mutation projection target part is invalid')
  return encodeURIComponent(normalized)
}

function decodeProjectionTargetPart(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function normalizeProjectionTarget(target: string): string {
  const normalized = target.trim()
  if (!normalized || normalized.length > MAX_PENDING_MUTATION_KEY_LENGTH) {
    throw new TypeError('Pending mutation projection target is invalid')
  }
  return normalized
}

function pendingMutationScopeFromHandle(handle: PendingMutationHandle): PendingMutationScope | null {
  if (!handle.ownerWriterSessionId || handle.writerEpoch === null || !handle.databaseLineage) return null
  return {
    writerSessionId: handle.ownerWriterSessionId,
    writerEpoch: handle.writerEpoch,
    databaseLineage: handle.databaseLineage,
  }
}

function projectionGenerationId(scope: PendingMutationScope, mutationId: string): string {
  return JSON.stringify([scope.writerSessionId, scope.writerEpoch, scope.databaseLineage, mutationId])
}

function projectionTargetKey(scope: PendingMutationScope, target: string): string {
  return JSON.stringify([
    scope.writerSessionId,
    scope.writerEpoch,
    scope.databaseLineage,
    normalizeProjectionTarget(target),
  ])
}

function recordLiveProjectionGeneration(
  generationId: string,
  scope: PendingMutationScope,
  targets: readonly string[],
): void {
  let generation = liveProjectionGenerations.get(generationId)
  if (!generation) {
    generation = {
      id: generationId,
      ordinal: ++nextProjectionGenerationOrdinal,
      scope,
      targetKeys: new Set<string>(),
    }
    liveProjectionGenerations.set(generationId, generation)
  }

  for (const target of new Set(targets.map(normalizeProjectionTarget))) {
    const targetKey = projectionTargetKey(scope, target)
    if (generation.targetKeys.has(targetKey)) continue
    generation.targetKeys.add(targetKey)
    const stack = liveProjectionGenerationStacks.get(targetKey) ?? []
    stack.push(generationId)
    stack.sort(
      (left, right) =>
        (liveProjectionGenerations.get(left)?.ordinal ?? -1) - (liveProjectionGenerations.get(right)?.ordinal ?? -1),
    )
    liveProjectionGenerationStacks.set(targetKey, stack)
  }
}

function retirePendingMutationProjectionGeneration(handle: PendingMutationHandle): void {
  const scope = pendingMutationScopeFromHandle(handle)
  if (!scope) return
  retireLiveProjectionGeneration(projectionGenerationId(scope, handle.mutationId))
}

function compactAcceptedPendingMutationProjectionGeneration(handle: PendingMutationHandle): void {
  const scope = pendingMutationScopeFromHandle(handle)
  if (!scope) return
  compactAcceptedLiveProjectionGeneration(projectionGenerationId(scope, handle.mutationId))
}

/**
 * Keep an accepted writer as the baseline for every field it owns while
 * removing older writers for those fields. A newer optimistic writer stays on
 * top and can still retire back to this accepted generation.
 */
function compactAcceptedLiveProjectionGeneration(generationId: string): void {
  const generation = liveProjectionGenerations.get(generationId)
  if (!generation) return

  for (const targetKey of generation.targetKeys) {
    const stack = liveProjectionGenerationStacks.get(targetKey)
    const acceptedIndex = stack?.indexOf(generationId) ?? -1
    if (!stack || acceptedIndex < 0) continue

    for (const obsoleteGenerationId of stack.slice(0, acceptedIndex)) {
      const obsolete = liveProjectionGenerations.get(obsoleteGenerationId)
      if (!obsolete) continue
      obsolete.targetKeys.delete(targetKey)
      if (obsolete.targetKeys.size === 0) liveProjectionGenerations.delete(obsoleteGenerationId)
    }
    liveProjectionGenerationStacks.set(targetKey, stack.slice(acceptedIndex))
  }
}

function retireLiveProjectionGeneration(generationId: string): void {
  const generation = liveProjectionGenerations.get(generationId)
  if (!generation) return
  for (const targetKey of generation.targetKeys) {
    const stack = liveProjectionGenerationStacks.get(targetKey)
    if (!stack) continue
    const retained = stack.filter((candidate) => candidate !== generationId)
    if (retained.length === 0) liveProjectionGenerationStacks.delete(targetKey)
    else liveProjectionGenerationStacks.set(targetKey, retained)
  }
  liveProjectionGenerations.delete(generationId)
}

function clearLivePendingMutationProjectionGenerations(): void {
  liveProjectionGenerations.clear()
  liveProjectionGenerationStacks.clear()
}

function normalizeOutboxKey(key: string): string {
  const normalized = key.trim()
  if (normalized.length === 0 || normalized.length > MAX_PENDING_MUTATION_KEY_LENGTH) {
    throw new TypeError('Pending mutation key is invalid')
  }
  return normalized
}

function normalizeDependencyKeys(value: readonly unknown[], enforceCount = true): string[] {
  if (enforceCount && value.length > MAX_DURABLE_MUTATION_DEPENDENCY_KEYS) {
    throw new RangeError('Pending mutation dependency key count is invalid')
  }
  return Array.from(
    new Set(
      value.map((dependencyKey) => {
        if (typeof dependencyKey !== 'string') {
          throw new TypeError('Pending mutation dependency key is invalid')
        }
        return normalizeOutboxKey(dependencyKey)
      }),
    ),
  )
}

function normalizeScope(writerSessionId: string, writerEpoch: number, databaseLineage: string): PendingMutationScope {
  const writer = writerSessionId.trim()
  const lineage = databaseLineage.trim()
  if (
    !SCOPE_VALUE_PATTERN.test(writer) ||
    !Number.isSafeInteger(writerEpoch) ||
    writerEpoch < 0 ||
    !SCOPE_VALUE_PATTERN.test(lineage)
  ) {
    throw new TypeError('Pending mutation ownership scope is invalid')
  }
  return { writerSessionId: writer, writerEpoch, databaseLineage: lineage }
}

function pendingMutationScopeMatchesHandle(scope: PendingMutationScope, handle: PendingMutationHandle): boolean {
  return (
    handle.ownerWriterSessionId === scope.writerSessionId &&
    handle.writerEpoch === scope.writerEpoch &&
    handle.databaseLineage === scope.databaseLineage
  )
}

function pendingMutationScopeEquals(scope: PendingMutationScope): boolean {
  return (
    pendingMutationScope?.writerSessionId === scope.writerSessionId &&
    pendingMutationScope.writerEpoch === scope.writerEpoch &&
    pendingMutationScope.databaseLineage === scope.databaseLineage
  )
}

function nextMutationSequence(): number {
  const base = Date.now() * 1_000
  nextSequenceOffset = (nextSequenceOffset + 1) % 1_000
  return base + nextSequenceOffset
}

function createMutationId(): string {
  const cryptoApi = globalThis.crypto
  const id = cryptoApi?.randomUUID?.()
  if (id && MUTATION_ID_PATTERN.test(id)) return id
  if (!cryptoApi?.getRandomValues) throw new Error('WebCrypto is unavailable')
  const bytes = cryptoApi.getRandomValues(new Uint8Array(18))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function mutationAdditionalData(
  semanticKey: string,
  mutationId: string,
  sequence: number,
  order: number,
  scope: PendingMutationScope,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    `${scope.writerSessionId}\u0000${scope.writerEpoch}\u0000${scope.databaseLineage}\u0000${semanticKey}\u0000${mutationId}\u0000${sequence}\u0000${order}`,
  )
}

function storedMutationMatchesHandle(
  current: StoredPendingMutation | undefined,
  handle: PendingMutationHandle,
): boolean {
  return (
    current?.mutationId === handle.mutationId &&
    current.sequence === handle.sequence &&
    current.semanticKey === handle.key &&
    current.ownerWriterSessionId === handle.ownerWriterSessionId &&
    current.writerEpoch === handle.writerEpoch &&
    current.databaseLineage === handle.databaseLineage
  )
}

async function getOutboxEncryptionKey(): Promise<CryptoKey | null> {
  if (!globalThis.crypto?.subtle) return null
  if (outboxEncryptionKeyPromise) return outboxEncryptionKeyPromise
  outboxEncryptionKeyPromise = loadOrCreateOutboxEncryptionKey()
  return outboxEncryptionKeyPromise
}

async function loadOrCreateOutboxEncryptionKey(): Promise<CryptoKey | null> {
  const database = await openOutboxDatabase()
  if (!database) return null

  try {
    const readTransaction = database.transaction(OUTBOX_KEY_STORE, 'readonly')
    const existing = await requestResult<CryptoKey | undefined>(
      readTransaction.objectStore(OUTBOX_KEY_STORE).get(OUTBOX_ENCRYPTION_KEY_ID),
    )
    await transactionDone(readTransaction)
    if (existing) return existing

    const generated = await globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'decrypt',
      'encrypt',
    ])
    try {
      const createTransaction = database.transaction(OUTBOX_KEY_STORE, 'readwrite')
      createTransaction.objectStore(OUTBOX_KEY_STORE).add(generated, OUTBOX_ENCRYPTION_KEY_ID)
      await transactionDone(createTransaction)
      return generated
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'ConstraintError') throw error
      const retryTransaction = database.transaction(OUTBOX_KEY_STORE, 'readonly')
      const raced = await requestResult<CryptoKey | undefined>(
        retryTransaction.objectStore(OUTBOX_KEY_STORE).get(OUTBOX_ENCRYPTION_KEY_ID),
      )
      await transactionDone(retryTransaction)
      return raced ?? null
    }
  } catch (error) {
    reportPersistenceWarning('Unable to initialize pending-mutation encryption', error)
    return null
  }
}

async function reservePendingMutationOrder(): Promise<number | null> {
  const database = await openOutboxDatabase()
  if (!database) return null
  try {
    const transaction = database.transaction(OUTBOX_ORDER_STORE, 'readwrite')
    const store = transaction.objectStore(OUTBOX_ORDER_STORE)
    const request = store.add({ reservedAt: Date.now() })
    let order: number | null = null
    request.onsuccess = () => {
      order = typeof request.result === 'number' ? request.result : null
      store.delete(request.result)
    }
    await transactionDone(transaction)
    return order
  } catch (error) {
    reportPersistenceWarning('Unable to reserve pending-mutation order', error)
    return null
  }
}

async function openOutboxDatabase(): Promise<IDBDatabase | null> {
  if (!globalThis.indexedDB || !globalThis.crypto?.subtle) return null
  if (outboxDatabasePromise) return outboxDatabasePromise

  const opening = new Promise<IDBDatabase | null>((resolve) => {
    const request = globalThis.indexedDB.open(OUTBOX_DATABASE_NAME, OUTBOX_DATABASE_VERSION)
    request.onupgradeneeded = (event) => {
      const database = request.result
      // Versions 1/2 used one row per semantic key, which cannot preserve an
      // in-flight generation and its successor. They were never shipped.
      if (event.oldVersion < 3 && database.objectStoreNames.contains(OUTBOX_MUTATION_STORE)) {
        database.deleteObjectStore(OUTBOX_MUTATION_STORE)
      }
      if (!database.objectStoreNames.contains(OUTBOX_MUTATION_STORE)) {
        database.createObjectStore(OUTBOX_MUTATION_STORE, { keyPath: 'mutationId' })
      }
      if (!database.objectStoreNames.contains(OUTBOX_KEY_STORE)) {
        database.createObjectStore(OUTBOX_KEY_STORE)
      }
      if (!database.objectStoreNames.contains(OUTBOX_ORDER_STORE)) {
        database.createObjectStore(OUTBOX_ORDER_STORE, { autoIncrement: true })
      }
      if (!database.objectStoreNames.contains(OUTBOX_RECEIPT_ACK_STORE)) {
        database.createObjectStore(OUTBOX_RECEIPT_ACK_STORE, { keyPath: 'mutationId' })
      }
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => {
        database.close()
        if (outboxDatabasePromise === opening) {
          outboxDatabasePromise = null
          outboxEncryptionKeyPromise = null
        }
      }
      resolve(database)
    }
    request.onerror = () => {
      reportPersistenceWarning('Unable to open the pending-mutation outbox', request.error)
      resolve(null)
    }
    request.onblocked = () => {
      reportPersistenceWarning('Pending-mutation outbox upgrade is blocked')
    }
  })
  outboxDatabasePromise = opening
  return opening
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
  })
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function reportPersistenceWarning(message: string, error?: unknown): void {
  if (persistenceWarningReported) return
  persistenceWarningReported = true
  console.warn(message, error)
}
