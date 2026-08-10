import { get, writable } from 'svelte/store'
import type { ActiveChatTarget, AppendCurrentChatUserMessageResult, ChatMutationFinalOutcome } from '../chatCommands'
import { sleep } from '../util'
import { clearActiveGenerationAbortController, createActiveGenerationAbortController, sendChat } from './index.svelte'
import { chatGenerationTargetKey } from './generationActivity.svelte'

type AcceptedAppendResult = Exclude<AppendCurrentChatUserMessageResult, { status: 'error' }>

export type AcceptedSendCoordinatorResult =
  | { status: 'generated' }
  | { status: 'append_failed' }
  | { status: 'generation_failed' }

export interface AcceptedSendRecovery {
  id: string
  target: ActiveChatTarget
  messageId: string
  syntheticSayNothing: boolean
  retrying: boolean
}

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

export const acceptedSendRecoveries = writable<AcceptedSendRecovery[]>([])

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

function removeRecovery(id: string): void {
  acceptedSendRecoveries.update((recoveries) => recoveries.filter((recovery) => recovery.id !== id))
}

function recordRecovery(request: AcceptedGenerationRequest, retrying = false): void {
  acceptedSendRecoveries.update((recoveries) => [
    ...recoveries.filter((recovery) => recovery.id !== request.id),
    { ...request, retrying },
  ])
}

function setRecoveryRetrying(id: string, retrying: boolean): void {
  acceptedSendRecoveries.update((recoveries) =>
    recoveries.map((recovery) => (recovery.id === id ? { ...recovery, retrying } : recovery)),
  )
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

async function attemptGeneration(request: AcceptedGenerationRequest, delayBeforeStart: boolean): Promise<boolean> {
  if (delayBeforeStart) await sleep(10)

  const abortController = createActiveGenerationAbortController()
  try {
    return await sendChat(-1, {
      signal: abortController.signal,
      expectedTarget: request.target,
      syntheticSayNothing: request.syntheticSayNothing,
    })
  } catch (error) {
    console.error(error)
    return false
  } finally {
    clearActiveGenerationAbortController(abortController)
  }
}

async function startAcceptedGeneration(request: AcceptedGenerationRequest): Promise<AcceptedSendCoordinatorResult> {
  removeRecovery(request.id)
  if (await attemptGeneration(request, true)) {
    return { status: 'generated' }
  }

  recordRecovery(request)
  return { status: 'generation_failed' }
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
  if (await attemptGeneration(request, false)) {
    removeRecovery(id)
    return true
  }

  recordRecovery(request)
  return false
}

export function resetAcceptedSendCoordinatorForTests(): void {
  coordinatedOperations.clear()
  acceptedSendRecoveries.set([])
}
