import { get } from 'svelte/store'
import type { ActiveChatTarget, AppendCurrentChatUserMessageResult, ChatMutationFinalOutcome } from '../chatCommands'
import { reconcileAcceptedSendCompletion } from '../server/chatMessageHydration.svelte'
import { sleep } from '../util'
import { clearActiveGenerationAbortController, createActiveGenerationAbortController, sendChat } from './index.svelte'
import { chatGenerationTargetKey } from './generationActivity.svelte'
import {
  acceptedSendRecoveries,
  recordAcceptedSendRecovery,
  removeAcceptedSendRecovery,
  setAcceptedSendRecoveryRetrying,
  type AcceptedSendRecovery,
  type AcceptedSendRecoveryCause,
} from './acceptedSendRecoveryState'
import { refreshActiveGenerationJobsFromBootstrap } from './reattach'

export {
  acceptedSendRecoveries,
  type AcceptedSendRecovery,
  type AcceptedSendRecoveryCause,
} from './acceptedSendRecoveryState'

type AcceptedAppendResult = Exclude<AppendCurrentChatUserMessageResult, { status: 'error' }>

export type AcceptedSendCoordinatorResult =
  | { status: 'generated' }
  | { status: 'append_failed' }
  | { status: 'generation_failed'; cause: AcceptedSendRecoveryCause }

export interface CoordinateAcceptedChatSendInput {
  target: ActiveChatTarget
  append: AcceptedAppendResult
  syntheticSayNothing?: boolean
  onAppendAccepted?: () => void
  onAppendFailed?: (outcome?: ChatMutationFinalOutcome) => void
}

interface AcceptedGenerationRequest {
  id: string
  target: ActiveChatTarget
  messageId: string
  syntheticSayNothing: boolean
}

interface CoordinatedOperation {
  promise: Promise<AcceptedSendCoordinatorResult>
  settled: boolean
}

const MAX_REMEMBERED_OPERATIONS = 256
export const ACCEPTED_SEND_AUTHORITY_PROBE_TIMEOUT_MS = 10_000
const coordinatedOperations = new Map<string, CoordinatedOperation>()

function acceptedSendOperationId(target: ActiveChatTarget, messageId: string): string {
  return `${chatGenerationTargetKey(target) ?? 'missing-target'}:message:${messageId}`
}

function trimRememberedOperations(): void {
  while (coordinatedOperations.size > MAX_REMEMBERED_OPERATIONS) {
    const oldestId = [...coordinatedOperations].find(([, operation]) => operation.settled)?.[0]
    if (oldestId === undefined) return
    coordinatedOperations.delete(oldestId)
  }
}

function rememberOperation(id: string, promise: Promise<AcceptedSendCoordinatorResult>): void {
  const operation: CoordinatedOperation = { promise, settled: false }
  coordinatedOperations.set(id, operation)
  void promise.then(
    () => {
      operation.settled = true
      trimRememberedOperations()
    },
    () => {
      operation.settled = true
      trimRememberedOperations()
    },
  )
  trimRememberedOperations()
}

function recordRecovery(request: AcceptedGenerationRequest, cause: AcceptedSendRecoveryCause, retrying = false): void {
  recordAcceptedSendRecovery(request, cause, retrying)
}

function setRecoveryRetrying(id: string, retrying: boolean): void {
  setAcceptedSendRecoveryRetrying(id, retrying)
}

function notifyAppendAccepted(callback: (() => void) | undefined): void {
  try {
    callback?.()
  } catch (error) {
    console.error(error)
  }
}

function notifyAppendFailed(
  callback: ((outcome?: ChatMutationFinalOutcome) => void) | undefined,
  outcome?: ChatMutationFinalOutcome,
): void {
  try {
    callback?.(outcome)
  } catch (error) {
    console.error(error)
  }
}

interface AcceptedGenerationAttempt {
  generated: boolean
  cause: AcceptedSendRecoveryCause
}

async function attemptGeneration(
  request: AcceptedGenerationRequest,
  delayBeforeStart: boolean,
): Promise<AcceptedGenerationAttempt> {
  if (delayBeforeStart) await sleep(10)

  const abortController = createActiveGenerationAbortController()
  let cause: AcceptedSendRecoveryCause = 'generation_failed'
  try {
    const generated = await sendChat(-1, {
      signal: abortController.signal,
      expectedTarget: request.target,
      syntheticSayNothing: request.syntheticSayNothing,
      onFailure: (failure) => {
        cause = failure.cause
      },
    })
    return { generated, cause }
  } catch (error) {
    console.error(error)
    return { generated: false, cause }
  } finally {
    clearActiveGenerationAbortController(abortController)
  }
}

/**
 * A mobile browser can lose its viewer stream while the detached server job
 * continues. Before calling that a generation failure, ask the server whether
 * the accepted row already has its durable assistant reply. Chat-level job
 * activity is not proof that the job belongs to this accepted message.
 */
type AcceptedGenerationAuthorityOutcome = 'reconciled' | 'not_reconciled' | 'authority_unknown'

async function settleBeforeAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<{ status: 'settled'; value: T } | { status: 'aborted' }> {
  if (signal.aborted) return { status: 'aborted' }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      resolve({ status: 'aborted' })
    }
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    void promise.then(
      (value) => {
        cleanup()
        resolve({ status: 'settled', value })
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}

async function acceptedGenerationReachedServer(
  request: AcceptedGenerationRequest,
): Promise<AcceptedGenerationAuthorityOutcome> {
  if (!request.target.chatId) return 'not_reconciled'

  const controller = new AbortController()
  const deadline = setTimeout(() => controller.abort(), ACCEPTED_SEND_AUTHORITY_PROBE_TIMEOUT_MS)
  try {
    const bootstrap = await settleBeforeAbort(
      refreshActiveGenerationJobsFromBootstrap(controller.signal),
      controller.signal,
    )
    if (bootstrap.status === 'aborted' || controller.signal.aborted) return 'authority_unknown'

    const completion = await settleBeforeAbort(
      reconcileAcceptedSendCompletion(request.target, request.messageId, { signal: controller.signal }),
      controller.signal,
    )
    if (completion.status === 'aborted' || controller.signal.aborted) return 'authority_unknown'
    return completion.value.status === 'reconciled' ? 'reconciled' : 'not_reconciled'
  } catch {
    return controller.signal.aborted ? 'authority_unknown' : 'not_reconciled'
  } finally {
    clearTimeout(deadline)
  }
}

async function startAcceptedGeneration(request: AcceptedGenerationRequest): Promise<AcceptedSendCoordinatorResult> {
  removeAcceptedSendRecovery(request.id)
  const attempt = await attemptGeneration(request, true)
  if (attempt.generated) {
    return { status: 'generated' }
  }

  if ((await acceptedGenerationReachedServer(request)) === 'reconciled') {
    return { status: 'generated' }
  }

  recordRecovery(request, attempt.cause)
  return { status: 'generation_failed', cause: attempt.cause }
}

/**
 * Own a user-message append after dispatch. An immediately accepted append is
 * handed to generation now; a retained append stays here until its durable
 * settlement is accepted. In either case, this module starts generation once
 * for the captured target and never re-appends the user message.
 */
export function coordinateAcceptedChatSend(
  input: CoordinateAcceptedChatSendInput,
): Promise<AcceptedSendCoordinatorResult> {
  const id = acceptedSendOperationId(input.target, input.append.messageId)
  const existing = coordinatedOperations.get(id)
  if (existing) return existing.promise

  const request: AcceptedGenerationRequest = {
    id,
    target: input.target,
    messageId: input.append.messageId,
    syntheticSayNothing: input.syntheticSayNothing === true,
  }
  const operation = (async (): Promise<AcceptedSendCoordinatorResult> => {
    if (input.append.status === 'queued') {
      let settlement: ChatMutationFinalOutcome
      try {
        settlement = await input.append.settlement
      } catch {
        notifyAppendFailed(input.onAppendFailed)
        return { status: 'append_failed' }
      }
      if (settlement.status !== 'accepted') {
        notifyAppendFailed(input.onAppendFailed, settlement)
        return { status: 'append_failed' }
      }
    }

    notifyAppendAccepted(input.onAppendAccepted)
    return startAcceptedGeneration(request)
  })()

  rememberOperation(id, operation)
  return operation
}

export function findAcceptedSendRecovery(
  recoveries: readonly AcceptedSendRecovery[],
  target: ActiveChatTarget | null | undefined,
): AcceptedSendRecovery | undefined {
  const targetKey = chatGenerationTargetKey(target)
  if (!targetKey) return undefined
  return recoveries.find((recovery) => chatGenerationTargetKey(recovery.target) === targetKey)
}

export async function retryAcceptedChatSend(id: string): Promise<boolean> {
  const recovery = get(acceptedSendRecoveries).find((candidate) => candidate.id === id)
  if (!recovery || recovery.retrying) return false

  setRecoveryRetrying(id, true)
  const request: AcceptedGenerationRequest = {
    id: recovery.id,
    target: recovery.target,
    messageId: recovery.messageId,
    syntheticSayNothing: recovery.syntheticSayNothing,
  }
  try {
    const attempt = await attemptGeneration(request, false)
    if (attempt.generated) {
      removeAcceptedSendRecovery(id)
      return true
    }

    // Preserve the warning while authority is checked. The shared deadline can
    // classify a timeout only as unknown, never as generation success/failure.
    recordRecovery(request, attempt.cause, true)
    if ((await acceptedGenerationReachedServer(request)) === 'reconciled') {
      removeAcceptedSendRecovery(id)
      return true
    }
    return false
  } finally {
    // A stalled or throwing authority read must never strand the Retry control.
    setRecoveryRetrying(id, false)
  }
}

export function resetAcceptedSendCoordinatorForTests(): void {
  coordinatedOperations.clear()
  acceptedSendRecoveries.set([])
}
