import { get, writable } from 'svelte/store'
import {
  appendOptimisticGenerationOperationUserMessage,
  toMessageSnapshot,
  type ActiveChatTarget,
} from '../chatCommands'
import type { Message } from '../storage/database.svelte'
import { getNodeServerProxyAuth } from '../storage/fastifyStorage'
import {
  applyAcceptedSendActiveJobProjection,
  applyAcceptedSendBootstrapProjection,
  applyAcceptedSendOperationProjection,
  clearAcceptedSendRecoveryProjection,
} from '../process/acceptedSendRecoveryState'
import { activeWriterSessionHeader, handleActiveWriterStaleResponse } from './activeWriterSession'
import {
  getServerCommandBaseRevision,
  peekCachedServerCommandRevision,
  setCachedServerCommandRevision,
  SERVER_DATABASE_LINEAGE_HEADER,
} from './commands'
import { acknowledgeMessageMutationLocalEffect } from './chatMessageHydration.svelte'
import {
  beginPendingMutationDispatch,
  discardPendingMutation,
  isGenerationOperationPendingIntent,
  stagePendingMutation,
  type DurableMutationIntent,
  type PendingMutationHandle,
} from './pendingMutationOutbox'
import { parseGenerationOperations, type GenerationOperationProjection, type ServerBootstrapRuntime } from './bootstrap'

const GENERATION_OPERATIONS_ENDPOINT = '/api/v1/generation-operations'
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const MAX_REVISION_RETRIES = 3

export interface GenerationOperationGenerationIntent {
  syntheticSayNothing: boolean
  resetMessages: boolean
  loadoutId?: string
  inlayAssetRefs: unknown[]
  clientContext: unknown
  clientCapabilities: Record<string, unknown>
}

export interface GenerationOperationSubmitRequest extends Record<string, unknown> {
  protocolVersion: 1
  operationId: string
  baseRevision: number
  characterId: string
  chatId: string
  mode: 'send'
  acceptedMessageId: string
  message: Record<string, unknown> & { role?: 'user' | 'char'; data?: string; chatId?: string }
  draftGeneration: unknown
  generation: GenerationOperationGenerationIntent
}

export interface GenerationOperationStreamDescriptor {
  operationId: string
  acceptedMessageId: string
  attemptNo: number
  jobId: string
  projectionEpoch: number
  href: string
}

export interface GenerationOperationResponse {
  operation: GenerationOperationProjection
  append?: {
    disposition: 'accepted' | 'not_appended'
    messageId: string
    revision?: number
  }
  stream?: { href: string }
}

export interface StagedAcceptedSendOperation {
  target: ActiveChatTarget
  request: GenerationOperationSubmitRequest
  intent: DurableMutationIntent & { kind: 'generation-operation-submit' }
  handle: PendingMutationHandle
  optimisticMessage: Message
  rollbackOptimisticAppend: () => void
}

export type GenerationOperationDispatchResult =
  | {
      status: 'accepted'
      response: GenerationOperationResponse
      stream?: GenerationOperationStreamDescriptor
    }
  | { status: 'retained'; error: string; code?: string }
  | { status: 'rejected'; error: string; code?: string; operation?: GenerationOperationProjection }

export type GenerationOperationPendingReplayOutcome = {
  disposition: 'discarded' | 'retained' | 'succeeded'
  result?: GenerationOperationDispatchResult
}

export const generationOperationProjections = writable<GenerationOperationProjection[]>([])

let generationOperationProtocolVersion = 0
let generationOperationProjectionEpoch = 0
let generationOperationDatabaseLineage: string | null = null

export function configureGenerationOperationProtocol(
  protocol: { version: number } | undefined,
  databaseLineage?: string,
): void {
  generationOperationProtocolVersion = protocol?.version === 1 ? 1 : 0
  if (databaseLineage && generationOperationDatabaseLineage !== databaseLineage) {
    generationOperationDatabaseLineage = databaseLineage
    generationOperationProjectionEpoch = 0
    generationOperationProjections.set([])
    clearAcceptedSendRecoveryProjection()
  }
}

export function canUseGenerationOperationProtocol(): boolean {
  return generationOperationProtocolVersion === 1
}

export function resetGenerationOperationClientForTests(): void {
  generationOperationProtocolVersion = 0
  generationOperationProjectionEpoch = 0
  generationOperationDatabaseLineage = null
  generationOperationProjections.set([])
  clearAcceptedSendRecoveryProjection()
}

function createProtocolUuid(): string {
  const id = globalThis.crypto?.randomUUID?.()
  if (!id || !UUID_V4_RE.test(id)) throw new Error('A secure UUID generator is required for accepted sends.')
  return id
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function operationIntentForSubmit(request: GenerationOperationSubmitRequest): DurableMutationIntent & {
  kind: 'generation-operation-submit'
} {
  return {
    version: 1,
    kind: 'generation-operation-submit',
    requests: [{ method: 'POST', path: '/generation-operations', body: cloneJson(request) }],
  }
}

function operationIntentForRetry(
  operationId: string,
  retryRequestId: string,
  expectedStateVersion: number,
): DurableMutationIntent & { kind: 'generation-operation-retry' } {
  return {
    version: 1,
    kind: 'generation-operation-retry',
    requests: [
      {
        method: 'POST',
        path: `/generation-operations/${encodeURIComponent(operationId)}/retries`,
        body: { retryRequestId, expectedStateVersion },
      },
    ],
  }
}

export async function stageAcceptedSendGenerationOperation(input: {
  target: ActiveChatTarget
  message: string | Message
  draftGeneration?: unknown
  generation: GenerationOperationGenerationIntent
}): Promise<StagedAcceptedSendOperation | { status: 'error'; error: string }> {
  if (!input.target.characterId || !input.target.chatId) {
    return { status: 'error', error: 'The active chat has no durable server identity.' }
  }
  const baseRevision = peekCachedServerCommandRevision() ?? (await getServerCommandBaseRevision())
  if (baseRevision === null) return { status: 'error', error: 'The server revision is unavailable.' }

  // Both identifiers exist before the complete request is staged.
  const operationId = createProtocolUuid()
  const acceptedMessageId = createProtocolUuid()
  const optimisticMessage: Message =
    typeof input.message === 'string'
      ? { role: 'user', data: input.message, time: Date.now(), chatId: acceptedMessageId }
      : { ...cloneJson(input.message), chatId: acceptedMessageId }
  const request: GenerationOperationSubmitRequest = {
    protocolVersion: 1,
    operationId,
    baseRevision,
    characterId: input.target.characterId,
    chatId: input.target.chatId,
    mode: 'send',
    acceptedMessageId,
    message: toMessageSnapshot(optimisticMessage),
    draftGeneration: cloneJson(input.draftGeneration ?? null),
    generation: cloneJson(input.generation),
  }
  const intent = operationIntentForSubmit(request)
  const handle = stagePendingMutation(`generation-operation-submit:${operationId}`, intent)
  const persistence = await handle.ready
  if (persistence !== 'persisted') {
    return { status: 'error', error: 'The accepted send could not be staged durably.' }
  }
  const optimistic = appendOptimisticGenerationOperationUserMessage(input.target, optimisticMessage)
  if (optimistic.status === 'error') {
    await discardPendingMutation(handle)
    return optimistic
  }
  return {
    target: { ...input.target },
    request,
    intent,
    handle,
    optimisticMessage,
    rollbackOptimisticAppend: optimistic.rollback,
  }
}

function errorMessage(body: unknown, response: Response): string {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const record = body as Record<string, unknown>
    if (typeof record.message === 'string' && record.message) return record.message
    if (typeof record.error === 'string' && record.error) return record.error
  }
  return `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
}

function errorCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const value = (body as Record<string, unknown>).error
  return typeof value === 'string' ? value : undefined
}

function operationFromBody(body: unknown): GenerationOperationProjection | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const record = body as Record<string, unknown>
  return parseGenerationOperations([record.operation])[0]
}

function responseFromBody(body: unknown): GenerationOperationResponse | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const record = body as Record<string, unknown>
  const operation = operationFromBody(body)
  if (!operation) return undefined
  const result: GenerationOperationResponse = { operation }
  if (record.append && typeof record.append === 'object' && !Array.isArray(record.append)) {
    const append = record.append as Record<string, unknown>
    if (
      (append.disposition === 'accepted' || append.disposition === 'not_appended') &&
      typeof append.messageId === 'string'
    ) {
      result.append = {
        disposition: append.disposition,
        messageId: append.messageId,
        ...(Number.isSafeInteger(append.revision) && (append.revision as number) >= 0
          ? { revision: append.revision as number }
          : {}),
      }
    }
  }
  if (record.stream && typeof record.stream === 'object' && !Array.isArray(record.stream)) {
    const href = (record.stream as Record<string, unknown>).href
    if (typeof href === 'string') result.stream = { href }
  }
  return result
}

function operationStreamHref(operation: GenerationOperationProjection): string | undefined {
  const attempt = operation.currentAttempt
  if (!attempt) return undefined
  return `${GENERATION_OPERATIONS_ENDPOINT}/${encodeURIComponent(operation.operationId)}/stream?attemptNo=${attempt.attemptNo}&jobId=${encodeURIComponent(attempt.jobId)}&projectionEpoch=${operation.projectionEpoch}`
}

function safeOperationStreamHref(operation: GenerationOperationProjection, supplied?: string): string | undefined {
  const expected = operationStreamHref(operation)
  if (!expected) return undefined
  return supplied === expected ? supplied : expected
}

export function generationOperationStreamDescriptor(
  response: GenerationOperationResponse,
): GenerationOperationStreamDescriptor | undefined {
  const operation = response.operation
  const attempt = operation.currentAttempt
  if (!operation.acceptedMessageId || !attempt) return undefined
  const href = safeOperationStreamHref(operation, response.stream?.href)
  if (!href) return undefined
  return {
    operationId: operation.operationId,
    acceptedMessageId: operation.acceptedMessageId,
    attemptNo: attempt.attemptNo,
    jobId: attempt.jobId,
    projectionEpoch: operation.projectionEpoch,
    href,
  }
}

export function applyGenerationOperationProjection(
  operation: GenerationOperationProjection,
  capturedTarget?: ActiveChatTarget,
): void {
  generationOperationProjectionEpoch = Math.max(generationOperationProjectionEpoch, operation.projectionEpoch)
  generationOperationProjections.update((operations) => {
    const previous = operations.find((candidate) => candidate.operationId === operation.operationId)
    if (
      previous &&
      (previous.projectionEpoch > operation.projectionEpoch ||
        (previous.projectionEpoch === operation.projectionEpoch && previous.stateVersion > operation.stateVersion))
    ) {
      return operations
    }
    return [...operations.filter((candidate) => candidate.operationId !== operation.operationId), operation].sort(
      (left, right) =>
        left.projectionEpoch - right.projectionEpoch || left.operationId.localeCompare(right.operationId),
    )
  })
  applyAcceptedSendOperationProjection(operation, capturedTarget)
}

export function applyGenerationOperationBootstrap(runtime: ServerBootstrapRuntime): void {
  configureGenerationOperationProtocol(runtime.generationOperationProtocol, runtime.databaseLineage)
  const epoch = runtime.generationOperationProjectionEpoch ?? 0
  if (epoch < generationOperationProjectionEpoch) {
    applyAcceptedSendActiveJobProjection(runtime.activeGenerationJobs ?? [])
    return
  }
  generationOperationProjectionEpoch = epoch
  const operations = runtime.generationOperations ?? []
  generationOperationProjections.set([...operations])
  applyAcceptedSendBootstrapProjection(operations, runtime.activeGenerationJobs ?? [], epoch)
}

/** Update a known operation from additive lineage carried by every protocol-v1 SSE frame. */
export function applyGenerationOperationSseEvent(data: Record<string, unknown>): void {
  if (
    typeof data.operationId !== 'string' ||
    !Number.isSafeInteger(data.operationStateVersion) ||
    !Number.isSafeInteger(data.projectionEpoch)
  ) {
    return
  }
  const previous = get(generationOperationProjections).find((operation) => operation.operationId === data.operationId)
  if (!previous) return
  const operation: GenerationOperationProjection = {
    ...previous,
    stateVersion: data.operationStateVersion as number,
    projectionEpoch: data.projectionEpoch as number,
  }
  if (typeof data.operationState === 'string') {
    operation.state = data.operationState as GenerationOperationProjection['state']
  } else if (data.type === 'job_accepted') {
    operation.state = 'owned_by_job'
  }
  if (Number.isSafeInteger(data.attemptNo) && typeof data.jobId === 'string' && operation.currentAttempt) {
    operation.currentAttempt = {
      ...operation.currentAttempt,
      attemptNo: data.attemptNo as number,
      jobId: data.jobId,
      status: operation.state === 'stopping' ? 'stopping' : 'running',
    }
  }
  if (data.type === 'done') {
    const postGeneration =
      data.postGeneration && typeof data.postGeneration === 'object' && !Array.isArray(data.postGeneration)
        ? (data.postGeneration as Record<string, unknown>)
        : undefined
    if (typeof postGeneration?.messageId === 'string') operation.resultMessageId = postGeneration.messageId
  }
  applyGenerationOperationProjection(operation)
}

function shouldDiscardOperationFailure(code: string | undefined, status: number): boolean {
  return (
    status === 400 ||
    status === 404 ||
    code === 'database_lineage_conflict' ||
    code === 'operation_id_conflict' ||
    code === 'message_id_conflict' ||
    code === 'generation_in_progress' ||
    code === 'operation_intent_missing' ||
    code === 'operation_not_retryable' ||
    code === 'operation_state_conflict' ||
    code === 'operation_target_stale' ||
    code === 'retry_request_id_conflict'
  )
}

async function dispatchPendingGenerationOperation(
  handle: PendingMutationHandle,
  intent: DurableMutationIntent,
): Promise<GenerationOperationDispatchResult> {
  if (!isGenerationOperationPendingIntent(intent) || !handle.databaseLineage) {
    return { status: 'rejected', error: 'Invalid generation operation outbox intent.' }
  }
  const persistence = await beginPendingMutationDispatch(handle)
  if (persistence !== 'persisted') {
    return { status: 'retained', error: 'The generation operation is not durably staged.' }
  }

  const request = intent.requests[0]
  const body = cloneJson(request.body)
  const auth = await getNodeServerProxyAuth()
  let revisionRetries = 0
  while (true) {
    let response: Response
    try {
      response = await fetch(`/api/v1${request.path}`, {
        method: request.method,
        headers: {
          'content-type': 'application/json',
          'risu-auth': auth,
          [SERVER_DATABASE_LINEAGE_HEADER]: handle.databaseLineage,
          ...activeWriterSessionHeader(),
        },
        body: JSON.stringify(body),
      })
    } catch (error) {
      return {
        status: 'retained',
        error: error instanceof Error ? `Network error: ${error.message}` : `Network error: ${String(error)}`,
      }
    }

    let responseBody: unknown = null
    try {
      responseBody = await response.json()
    } catch {
      // Non-JSON success is retained because the server may already have accepted it.
    }
    if (response.ok) {
      const parsed = responseFromBody(responseBody)
      if (!parsed) return { status: 'retained', error: 'Invalid generation operation response.' }
      if (parsed.append?.revision !== undefined) setCachedServerCommandRevision(parsed.append.revision)
      applyGenerationOperationProjection(parsed.operation)
      await discardPendingMutation(handle)
      return { status: 'accepted', response: parsed, stream: generationOperationStreamDescriptor(parsed) }
    }

    handleActiveWriterStaleResponse(response, responseBody)
    const code = errorCode(responseBody)
    if (
      intent.kind === 'generation-operation-submit' &&
      response.status === 409 &&
      code === 'revision_conflict' &&
      responseBody &&
      typeof responseBody === 'object' &&
      Number.isSafeInteger((responseBody as Record<string, unknown>).currentRevision) &&
      revisionRetries < MAX_REVISION_RETRIES
    ) {
      body.baseRevision = (responseBody as Record<string, unknown>).currentRevision
      setCachedServerCommandRevision(body.baseRevision as number)
      revisionRetries += 1
      continue
    }

    const operation = operationFromBody(responseBody)
    if (operation) applyGenerationOperationProjection(operation)
    const error = errorMessage(responseBody, response)
    if (shouldDiscardOperationFailure(code, response.status)) {
      await discardPendingMutation(handle)
      return { status: 'rejected', error, ...(code ? { code } : {}), ...(operation ? { operation } : {}) }
    }
    return { status: 'retained', error, ...(code ? { code } : {}) }
  }
}

export async function submitStagedAcceptedSendOperation(
  staged: StagedAcceptedSendOperation,
): Promise<GenerationOperationDispatchResult> {
  const result = await dispatchPendingGenerationOperation(staged.handle, staged.intent)
  if (result.status === 'accepted') {
    if (result.response.append?.disposition !== 'accepted') staged.rollbackOptimisticAppend()
    else if (staged.target.chatId) acknowledgeMessageMutationLocalEffect(staged.target.chatId)
  } else if (result.status === 'rejected') {
    staged.rollbackOptimisticAppend()
  }
  return result
}

export async function readGenerationOperationStatus(
  operationId: string,
  signal?: AbortSignal,
): Promise<GenerationOperationDispatchResult> {
  const auth = await getNodeServerProxyAuth()
  let response: Response
  try {
    response = await fetch(`${GENERATION_OPERATIONS_ENDPOINT}/${encodeURIComponent(operationId)}`, {
      headers: { 'risu-auth': auth },
      signal,
    })
  } catch (error) {
    return { status: 'retained', error: error instanceof Error ? error.message : String(error) }
  }
  let body: unknown = null
  try {
    body = await response.json()
  } catch {}
  if (!response.ok) {
    return {
      status: 'rejected',
      error: errorMessage(body, response),
      ...(errorCode(body) ? { code: errorCode(body) } : {}),
    }
  }
  const parsed = responseFromBody(body)
  if (!parsed) return { status: 'retained', error: 'Invalid generation operation status response.' }
  applyGenerationOperationProjection(parsed.operation)
  return { status: 'accepted', response: parsed, stream: generationOperationStreamDescriptor(parsed) }
}

export async function retryGenerationOperation(
  operationId: string,
  expectedStateVersion: number,
): Promise<GenerationOperationDispatchResult> {
  const retryRequestId = createProtocolUuid()
  const intent = operationIntentForRetry(operationId, retryRequestId, expectedStateVersion)
  const handle = stagePendingMutation(`generation-operation-retry:${operationId}`, intent)
  const persistence = await handle.ready
  if (persistence !== 'persisted') {
    return { status: 'retained', error: 'The generation retry could not be staged durably.' }
  }
  return dispatchPendingGenerationOperation(handle, intent)
}

export async function dispatchGenerationOperationPendingReplay(
  handle: PendingMutationHandle,
  intent: DurableMutationIntent,
): Promise<GenerationOperationPendingReplayOutcome> {
  const result = await dispatchPendingGenerationOperation(handle, intent)
  if (result.status === 'accepted') return { disposition: 'succeeded', result }
  if (result.status === 'rejected') return { disposition: 'discarded', result }
  return { disposition: 'retained', result }
}
