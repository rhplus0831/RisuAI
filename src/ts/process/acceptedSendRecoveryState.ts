import { get, writable } from 'svelte/store'
import type { ActiveChatTarget } from '../chatCommands'
import type { ActiveGenerationJob, GenerationOperationProjection } from '../server/bootstrap'
import {
  deleteDefaultChatComposerDraft,
  isDefaultChatComposerDraftGenerationCurrent,
  type DefaultChatComposerDraftGeneration,
} from '../../lib/ChatScreens/DefaultChatScreen.composerDrafts'
import type { SendChatFailure } from './sendChatFailure'

export type AcceptedSendRecoveryCause = 'generation_failed' | SendChatFailure['cause']
export type AcceptedSendRecoveryPhase = 'retryable' | 'owned_by_job' | 'completed' | 'terminal_failed'

export interface AcceptedSendRecovery {
  id: string
  operationId?: string
  target: ActiveChatTarget
  messageId: string
  syntheticSayNothing: boolean
  cause: AcceptedSendRecoveryCause
  phase: AcceptedSendRecoveryPhase
  operationState?: GenerationOperationProjection['state']
  stateVersion?: number
  projectionEpoch?: number
  jobId?: string
  resultMessageId?: string
  providerMayHaveRun: boolean
  unrelatedSameChatJob: boolean
  retrying: boolean
}

export const acceptedSendRecoveries = writable<AcceptedSendRecovery[]>([])

let acceptedSendProjectionEpoch = 0
const acceptedDraftGenerationListeners = new Set<(generation: DefaultChatComposerDraftGeneration) => void>()

function messageField(message: unknown, field: 'chatId' | 'role' | 'generationInfo'): unknown {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return undefined
  return (message as Record<string, unknown>)[field]
}

/**
 * Protocol-v1 completion is proved by the exact result row when its id or
 * operation lineage is known. Legacy recovery keeps the adjacent-role fallback.
 */
export function transcriptHasReplyForAcceptedSend(
  messages: readonly unknown[],
  messageId: string,
  exact: { operationId?: string; resultMessageId?: string } = {},
): boolean {
  const acceptedIndex = messages.findIndex(
    (message) => messageField(message, 'chatId') === messageId && messageField(message, 'role') === 'user',
  )
  if (acceptedIndex < 0) return false
  const reply = messages[acceptedIndex + 1]
  if (messageField(reply, 'role') !== 'char') return false
  if (exact.resultMessageId && messageField(reply, 'chatId') !== exact.resultMessageId) return false
  if (exact.operationId) {
    const generationInfo = messageField(reply, 'generationInfo')
    if (
      !generationInfo ||
      typeof generationInfo !== 'object' ||
      Array.isArray(generationInfo) ||
      (generationInfo as Record<string, unknown>).operationId !== exact.operationId
    ) {
      return false
    }
  }
  return true
}

function isDraftGeneration(value: unknown): value is DefaultChatComposerDraftGeneration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.databaseLineage === 'string' &&
    typeof record.writerSessionId === 'string' &&
    typeof record.transcriptIdentity === 'string' &&
    record.transcriptIdentity.length > 0 &&
    Number.isSafeInteger(record.sequence) &&
    (record.sequence as number) > 0
  )
}

export function registerAcceptedSendDraftGenerationListener(
  listener: (generation: DefaultChatComposerDraftGeneration) => void,
): () => void {
  acceptedDraftGenerationListeners.add(listener)
  return () => acceptedDraftGenerationListeners.delete(listener)
}

/** MS-01 Addendum B: acceptance clears only its opaque, exact draft generation. */
export function reconcileAcceptedSendDraftGeneration(operation: GenerationOperationProjection): boolean {
  if (
    operation.requestOrigin !== 'accepted_send' ||
    operation.mode !== 'send' ||
    operation.acceptedRevision === undefined ||
    !isDraftGeneration(operation.clientDraftGeneration) ||
    !isDefaultChatComposerDraftGenerationCurrent(operation.clientDraftGeneration)
  ) {
    return false
  }

  for (const listener of acceptedDraftGenerationListeners) {
    try {
      listener(operation.clientDraftGeneration)
    } catch (error) {
      console.error(error)
    }
  }
  return deleteDefaultChatComposerDraft(
    operation.clientDraftGeneration.transcriptIdentity,
    operation.clientDraftGeneration,
  )
}

function recoveryPhase(state: GenerationOperationProjection['state']): AcceptedSendRecoveryPhase | null {
  if (state === 'retryable' || state === 'abandoned') return 'retryable'
  if (state === 'completed') return 'completed'
  if (state === 'terminal_failed') return 'terminal_failed'
  if (
    state === 'accepted' ||
    state === 'launching' ||
    state === 'owned_by_job' ||
    state === 'stopping' ||
    state === 'finalizing'
  ) {
    return 'owned_by_job'
  }
  return null
}

function targetForOperation(
  operation: GenerationOperationProjection,
  previous?: AcceptedSendRecovery,
  capturedTarget?: ActiveChatTarget,
): ActiveChatTarget {
  if (capturedTarget) return { ...capturedTarget }
  if (previous) return previous.target
  return {
    selectedCharID: -1,
    chatPage: -1,
    characterId: operation.characterId,
    chatId: operation.chatId,
  }
}

function operationIsNewer(operation: GenerationOperationProjection, previous: AcceptedSendRecovery): boolean {
  const previousEpoch = previous.projectionEpoch ?? 0
  const previousVersion = previous.stateVersion ?? 0
  return (
    operation.projectionEpoch > previousEpoch ||
    (operation.projectionEpoch === previousEpoch && operation.stateVersion >= previousVersion)
  )
}

/** Apply one submit/status/retry/SSE projection without using chat activity as authority. */
export function applyAcceptedSendOperationProjection(
  operation: GenerationOperationProjection,
  capturedTarget?: ActiveChatTarget,
): void {
  acceptedSendProjectionEpoch = Math.max(acceptedSendProjectionEpoch, operation.projectionEpoch)
  reconcileAcceptedSendDraftGeneration(operation)
  if (
    operation.protocolVersion !== 1 ||
    operation.requestOrigin !== 'accepted_send' ||
    operation.mode !== 'send' ||
    !operation.acceptedMessageId ||
    !operation.chatId
  ) {
    return
  }

  const phase = recoveryPhase(operation.state)
  acceptedSendRecoveries.update((recoveries) => {
    const previous = recoveries.find((candidate) => candidate.operationId === operation.operationId)
    if (previous && !operationIsNewer(operation, previous)) return recoveries
    const retained = recoveries.filter((candidate) => candidate.operationId !== operation.operationId)
    if (!phase) return retained
    const recovery: AcceptedSendRecovery = {
      id: operation.operationId,
      operationId: operation.operationId,
      target: targetForOperation(operation, previous, capturedTarget),
      messageId: operation.acceptedMessageId!,
      syntheticSayNothing: previous?.syntheticSayNothing ?? false,
      cause:
        previous?.unrelatedSameChatJob || operation.failureCode === 'generation_in_progress'
          ? 'generation_in_progress'
          : 'generation_failed',
      phase,
      operationState: operation.state,
      stateVersion: operation.stateVersion,
      projectionEpoch: operation.projectionEpoch,
      jobId: operation.currentAttempt?.jobId,
      resultMessageId: operation.resultMessageId,
      providerMayHaveRun: operation.providerMayHaveRun,
      unrelatedSameChatJob: previous?.unrelatedSameChatJob ?? false,
      retrying: previous?.retrying ?? false,
    }
    return [...retained, recovery].sort(
      (left, right) => (left.projectionEpoch ?? 0) - (right.projectionEpoch ?? 0) || left.id.localeCompare(right.id),
    )
  })
}

/**
 * Apply an epoch-fenced bootstrap projection, then relate active jobs only by
 * exact operation and accepted-message lineage. Same-chat jobs remain warnings.
 */
export function applyAcceptedSendBootstrapProjection(
  operations: readonly GenerationOperationProjection[],
  jobs: readonly ActiveGenerationJob[],
  projectionEpoch: number,
): void {
  if (projectionEpoch < acceptedSendProjectionEpoch) return
  acceptedSendProjectionEpoch = projectionEpoch
  for (const operation of operations) applyAcceptedSendOperationProjection(operation)
  applyAcceptedSendActiveJobProjection(jobs)
}

export function applyAcceptedSendActiveJobProjection(jobs: readonly ActiveGenerationJob[]): void {
  acceptedSendRecoveries.update((recoveries) =>
    recoveries.map((recovery) => {
      if (!recovery.operationId) return recovery
      const exact = jobs.find(
        (job) =>
          job.operationId === recovery.operationId &&
          job.acceptedMessageId === recovery.messageId &&
          job.chatId === recovery.target.chatId,
      )
      if (exact && recovery.phase !== 'completed' && recovery.phase !== 'terminal_failed') {
        return {
          ...recovery,
          phase: 'owned_by_job',
          operationState: 'owned_by_job',
          jobId: exact.jobId,
          unrelatedSameChatJob: false,
        }
      }
      const unrelatedSameChatJob = jobs.some((job) => job.chatId === recovery.target.chatId)
      if (recovery.phase !== 'retryable') return { ...recovery, unrelatedSameChatJob }
      return {
        ...recovery,
        cause: unrelatedSameChatJob ? 'generation_in_progress' : recovery.cause,
        unrelatedSameChatJob,
      }
    }),
  )
}

export function removeAcceptedSendRecovery(id: string): void {
  acceptedSendRecoveries.update((recoveries) => recoveries.filter((recovery) => recovery.id !== id))
}

/** Compatibility projection for the pre-protocol append/send route. */
export function recordAcceptedSendRecovery(
  recovery: Omit<AcceptedSendRecovery, 'cause' | 'phase' | 'providerMayHaveRun' | 'retrying' | 'unrelatedSameChatJob'>,
  cause: AcceptedSendRecoveryCause,
  retrying = false,
): void {
  acceptedSendRecoveries.update((recoveries) => [
    ...recoveries.filter((candidate) => candidate.id !== recovery.id),
    {
      ...recovery,
      cause,
      phase: 'retryable',
      providerMayHaveRun: false,
      unrelatedSameChatJob: cause === 'generation_in_progress',
      retrying,
    },
  ])
}

export function setAcceptedSendRecoveryRetrying(id: string, retrying: boolean): void {
  acceptedSendRecoveries.update((recoveries) =>
    recoveries.map((recovery) => (recovery.id === id ? { ...recovery, retrying } : recovery)),
  )
}

/** Clear only completed protocol operations (or legacy recoveries) after exact transcript proof. */
export function acknowledgeHydratedAcceptedSendRecoveries(chatId: string, messages: readonly unknown[]): void {
  if (!chatId) return
  acceptedSendRecoveries.update((recoveries) =>
    recoveries.filter((recovery) => {
      if (recovery.target.chatId !== chatId) return true
      if (recovery.operationId && recovery.phase !== 'completed') return true
      return !transcriptHasReplyForAcceptedSend(messages, recovery.messageId, {
        operationId: recovery.operationId,
        resultMessageId: recovery.resultMessageId,
      })
    }),
  )
}

export function clearAcceptedSendRecoveryProjection(): void {
  acceptedSendProjectionEpoch = 0
  acceptedSendRecoveries.set([])
}

export const resetAcceptedSendRecoveryStateForTests = clearAcceptedSendRecoveryProjection

export function acceptedSendRecoveryById(id: string): AcceptedSendRecovery | undefined {
  return get(acceptedSendRecoveries).find((recovery) => recovery.id === id)
}
