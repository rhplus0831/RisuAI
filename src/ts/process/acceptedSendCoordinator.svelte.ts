import { get } from 'svelte/store'
import type { ActiveChatTarget, AppendCurrentChatUserMessageResult, ChatMutationFinalOutcome } from '../chatCommands'
import { fetchServerGenerationChatMessages } from '../server/hydrationReads'
import { sleep } from '../util'
import { clearActiveGenerationAbortController, createActiveGenerationAbortController, sendChat } from './index.svelte'
import { chatGenerationTargetKey } from './generationActivity.svelte'
import {
  acceptedSendRecoveries,
  recordAcceptedSendRecovery,
  removeAcceptedSendRecovery,
  setAcceptedSendRecoveryRetrying,
  transcriptHasReplyForAcceptedSend,
  type AcceptedSendRecovery,
  type AcceptedSendRecoveryCause,
} from './acceptedSendRecoveryState'
import { isChatGenerationKnown, refreshActiveGenerationJobsFromBootstrap } from './reattach'

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
 * the chat still has an active job or the accepted row already has its durable
 * assistant reply.
 */
async function acceptedGenerationReachedServer(
  request: AcceptedGenerationRequest,
  cause: AcceptedSendRecoveryCause,
): Promise<boolean> {
  const chatId = request.target.chatId
  if (!chatId) return false

  await refreshActiveGenerationJobsFromBootstrap()
  // A known job in this case belongs to the generation that rejected this new
  // accepted message. Keep the dedicated wait-and-retry warning visible.
  if (cause === 'generation_in_progress') return false
  if (isChatGenerationKnown(chatId)) return true

  try {
    const transcript = await fetchServerGenerationChatMessages(chatId, request.messageId)
    return transcript.status === 'ok' && transcriptHasReplyForAcceptedSend(transcript.message, request.messageId)
  } catch {
    return false
  }
}

async function startAcceptedGeneration(request: AcceptedGenerationRequest): Promise<AcceptedSendCoordinatorResult> {
  removeAcceptedSendRecovery(request.id)
  const attempt = await attemptGeneration(request, true)
  if (attempt.generated) {
    return { status: 'generated' }
  }

  if (await acceptedGenerationReachedServer(request, attempt.cause)) {
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
  const attempt = await attemptGeneration(request, false)
  if (attempt.generated) {
    removeAcceptedSendRecovery(id)
    return true
  }

  if (await acceptedGenerationReachedServer(request, attempt.cause)) {
    removeAcceptedSendRecovery(id)
    return true
  }

  recordRecovery(request, attempt.cause, true)
  recordRecovery(request, attempt.cause)
  return false
}

export function resetAcceptedSendCoordinatorForTests(): void {
  coordinatedOperations.clear()
  acceptedSendRecoveries.set([])
}
