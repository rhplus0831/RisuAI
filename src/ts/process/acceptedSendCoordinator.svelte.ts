import { get } from 'svelte/store'
import type { ActiveChatTarget, AppendCurrentChatUserMessageResult, ChatMutationFinalOutcome } from '../chatCommands'
import { waitForPendingChatGenerationSettingsSave } from '../chatCommands'
import {
  guardActiveChatGenerationSettingsForSend,
  resolveActiveChatGenerationSettings,
} from '../activeChatGenerationSettings'
import { reconcileAcceptedSendCompletion } from '../server/chatMessageHydration.svelte'
import { sleep } from '../util'
import { clearActiveGenerationAbortController, createActiveGenerationAbortController, sendChat } from './index.svelte'
import { chatGenerationTargetKey } from './generationActivity.svelte'
import type { Message } from '../storage/database.svelte'
import { getDatabase } from '../storage/database.svelte'
import { flushPendingSelectedPersonaUpdate } from '../persona'
import { alertConfirm, alertError } from '../alert'
import { language } from '../../lang'
import { collectServerInlayAssetRefs } from './serverBackedSendChat'
import { readBrowserClientContext } from './request/clientContext'
import { SERVER_CHAT_CLIENT_CAPABILITIES } from './request/serverChat'
import {
  readGenerationOperationStatus,
  retryGenerationOperation,
  stageAcceptedSendGenerationOperation,
  submitStagedAcceptedSendOperation,
  type GenerationOperationStreamDescriptor,
} from '../server/generationOperations'
import {
  acceptedSendRecoveries,
  recordAcceptedSendRecovery,
  removeAcceptedSendRecovery,
  resetAcceptedSendRecoveryStateForTests,
  setAcceptedSendRecoveryRetrying,
  type AcceptedSendRecovery,
  type AcceptedSendRecoveryCause,
} from './acceptedSendRecoveryState'
import { refreshActiveGenerationJobsFromBootstrap } from './reattach'
import { reconcileAcceptedSendGenerationEffects } from './recoveredGenerationEffects'
import { waitForPendingCharacterScriptDefinitionSave } from '../server/scriptDefinitionBridge.svelte'

export {
  acceptedSendRecoveries,
  type AcceptedSendRecovery,
  type AcceptedSendRecoveryCause,
} from './acceptedSendRecoveryState'

type AcceptedAppendResult = Exclude<AppendCurrentChatUserMessageResult, { status: 'error' }>

export type AcceptedSendCoordinatorResult =
  | { status: 'generated' }
  | { status: 'generated'; operationId: string; acceptedMessageId: string }
  | { status: 'append_failed' }
  | { status: 'generation_failed'; cause: AcceptedSendRecoveryCause }

export interface CoordinateAcceptedChatSendInput {
  target: ActiveChatTarget
  /** Compatibility append, used only when protocol v1 was not advertised. */
  append?: AcceptedAppendResult
  /** Protocol-v1 send payload; the coordinator creates both UUIDs before staging. */
  message?: string | Message
  draftGeneration?: unknown
  syntheticSayNothing?: boolean
  onAppendAccepted?: () => void
  onAppendFailed?: (outcome?: ChatMutationFinalOutcome) => void
}

interface AcceptedGenerationRequest {
  id: string
  operationId?: string
  target: ActiveChatTarget
  messageId: string
  resultMessageId?: string
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
      reconcileAcceptedSendCompletion(request.target, request.messageId, {
        signal: controller.signal,
        ...(request.operationId ? { operationId: request.operationId } : {}),
        ...(request.resultMessageId ? { resultMessageId: request.resultMessageId } : {}),
      }),
      controller.signal,
    )
    if (completion.status === 'aborted' || controller.signal.aborted) return 'authority_unknown'
    if (completion.value.status !== 'reconciled') return 'not_reconciled'
    const effects = await settleBeforeAbort(
      reconcileAcceptedSendGenerationEffects(request.target, request.messageId),
      controller.signal,
    )
    if (effects.status === 'aborted' || controller.signal.aborted) return 'authority_unknown'
    return effects.value.durableEffectsReconciled ? 'reconciled' : 'not_reconciled'
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

function chatForTarget(target: ActiveChatTarget) {
  const character = target.characterId
    ? getDatabase().characters?.find((candidate) => candidate.chaId === target.characterId)
    : getDatabase().characters?.[target.selectedCharID]
  return target.chatId
    ? character?.chats?.find((candidate) => candidate.id === target.chatId)
    : character?.chats?.[target.chatPage]
}

async function prepareAtomicSendGenerationIntent(input: CoordinateAcceptedChatSendInput) {
  const readiness = guardActiveChatGenerationSettingsForSend(
    resolveActiveChatGenerationSettings({ target: input.target }),
  )
  if (readiness.status === 'error') return { status: 'error' as const, error: readiness.error }
  if (input.target.chatId) {
    const settings = await waitForPendingChatGenerationSettingsSave(input.target.chatId)
    if (settings && settings.status !== 'ok') {
      return { status: 'error' as const, error: 'Chat generation settings could not be saved.' }
    }
  }
  const persona = await flushPendingSelectedPersonaUpdate()
  if (persona && persona.status !== 'ok') {
    return { status: 'error' as const, error: 'Persona settings could not be saved.' }
  }
  const scripts = await waitForPendingCharacterScriptDefinitionSave(input.target.characterId)
  if (scripts === 'queued' || scripts === 'failed') {
    return { status: 'error' as const, error: 'Character scripts could not be saved.' }
  }
  const chat = chatForTarget(input.target)
  if (!chat) return { status: 'error' as const, error: 'No active chat found.' }
  const inlayAssetRefs = await collectServerInlayAssetRefs(chat)
  return {
    status: 'ok' as const,
    generation: {
      syntheticSayNothing: input.syntheticSayNothing === true,
      resetMessages: false,
      inlayAssetRefs,
      clientContext: readBrowserClientContext(),
      clientCapabilities: { ...SERVER_CHAT_CLIENT_CAPABILITIES },
    },
  }
}

async function observeAcceptedOperationStream(
  target: ActiveChatTarget,
  stream: GenerationOperationStreamDescriptor,
): Promise<boolean> {
  const controller = createActiveGenerationAbortController()
  try {
    return await sendChat(-1, {
      signal: controller.signal,
      expectedTarget: target,
      generationOperationStream: stream,
    })
  } finally {
    clearActiveGenerationAbortController(controller)
  }
}

async function coordinateAtomicAcceptedChatSend(
  input: CoordinateAcceptedChatSendInput & { message: string | Message },
): Promise<AcceptedSendCoordinatorResult> {
  let preparedIntent: Awaited<ReturnType<typeof prepareAtomicSendGenerationIntent>>
  try {
    preparedIntent = await prepareAtomicSendGenerationIntent(input)
  } catch (error) {
    console.error(error)
    notifyAppendFailed(input.onAppendFailed)
    return { status: 'append_failed' }
  }
  if (preparedIntent.status === 'error') {
    notifyAppendFailed(input.onAppendFailed)
    return { status: 'append_failed' }
  }
  let staged: Awaited<ReturnType<typeof stageAcceptedSendGenerationOperation>>
  try {
    staged = await stageAcceptedSendGenerationOperation({
      target: input.target,
      message: input.message,
      draftGeneration: input.draftGeneration,
      generation: preparedIntent.generation,
    })
  } catch (error) {
    console.error(error)
    notifyAppendFailed(input.onAppendFailed)
    return { status: 'append_failed' }
  }
  if ('status' in staged) {
    notifyAppendFailed(input.onAppendFailed)
    return { status: 'append_failed' }
  }

  let submitted: Awaited<ReturnType<typeof submitStagedAcceptedSendOperation>>
  try {
    submitted = await submitStagedAcceptedSendOperation(staged)
  } catch (error) {
    console.error(error)
    return { status: 'generation_failed', cause: 'generation_failed' }
  }
  if (submitted.status === 'retained') {
    // The complete intent and optimistic row remain durable. Bootstrap/outbox
    // replay will project the eventual acceptance without appending again.
    return { status: 'generation_failed', cause: 'generation_failed' }
  }
  if (submitted.status === 'rejected' && submitted.code === 'generation_finalization_pending') {
    alertError(language.errors.replyStillSaving)
    return { status: 'append_failed' }
  }
  if (submitted.status !== 'accepted' || submitted.response.append?.disposition !== 'accepted') {
    notifyAppendFailed(input.onAppendFailed)
    return { status: 'append_failed' }
  }
  notifyAppendAccepted(input.onAppendAccepted)

  const operationId = submitted.response.operation.operationId
  const acceptedMessageId = submitted.response.operation.acceptedMessageId ?? staged.request.acceptedMessageId
  let stream = submitted.stream
  if (
    !stream &&
    (submitted.response.operation.state === 'accepted' || submitted.response.operation.state === 'launching')
  ) {
    const status = await readGenerationOperationStatus(operationId)
    if (status.status === 'accepted') stream = status.stream
  }
  if (stream) await observeAcceptedOperationStream(input.target, stream)

  const status = await readGenerationOperationStatus(operationId)
  if (status.status === 'accepted' && status.response.operation.state === 'completed') {
    const completion = await acceptedGenerationReachedServer({
      id: operationId,
      operationId,
      target: input.target,
      messageId: acceptedMessageId,
      resultMessageId: status.response.operation.resultMessageId,
      syntheticSayNothing: input.syntheticSayNothing === true,
    })
    if (completion === 'reconciled') return { status: 'generated', operationId, acceptedMessageId }
  }
  return { status: 'generation_failed', cause: 'generation_failed' }
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
  if (input.message !== undefined) {
    return coordinateAtomicAcceptedChatSend(input as CoordinateAcceptedChatSendInput & { message: string | Message })
  }
  if (!input.append) return Promise.resolve({ status: 'append_failed' })
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
  return recoveries.find(
    (recovery) => recovery.phase === 'retryable' && chatGenerationTargetKey(recovery.target) === targetKey,
  )
}

export function findAcceptedSendRecoveries(
  recoveries: readonly AcceptedSendRecovery[],
  target: ActiveChatTarget | null | undefined,
): AcceptedSendRecovery[] {
  const targetKey = chatGenerationTargetKey(target)
  if (!targetKey) return []
  return recoveries.filter(
    (recovery) => recovery.phase === 'retryable' && chatGenerationTargetKey(recovery.target) === targetKey,
  )
}

export async function retryAcceptedChatSend(id: string): Promise<boolean> {
  const recovery = get(acceptedSendRecoveries).find((candidate) => candidate.id === id)
  if (!recovery || recovery.retrying) return false

  if (recovery.operationId) {
    if (recovery.phase !== 'retryable' || recovery.stateVersion === undefined) return false
    if (recovery.providerMayHaveRun && !(await alertConfirm(language.acceptedSendRecovery.providerMayHaveRunConfirm))) {
      return false
    }
    setRecoveryRetrying(id, true)
    try {
      const retried = await retryGenerationOperation(recovery.operationId, recovery.stateVersion)
      if (retried.status !== 'accepted') return false
      if (retried.stream) await observeAcceptedOperationStream(recovery.target, retried.stream)
      const status = await readGenerationOperationStatus(recovery.operationId)
      if (status.status !== 'accepted' || status.response.operation.state !== 'completed') return false
      return (
        (await acceptedGenerationReachedServer({
          id: recovery.operationId,
          operationId: recovery.operationId,
          target: recovery.target,
          messageId: recovery.messageId,
          resultMessageId: status.response.operation.resultMessageId,
          syntheticSayNothing: recovery.syntheticSayNothing,
        })) === 'reconciled'
      )
    } finally {
      setRecoveryRetrying(id, false)
    }
  }

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
  resetAcceptedSendRecoveryStateForTests()
}
