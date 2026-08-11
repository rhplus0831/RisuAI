import { get, writable } from 'svelte/store'
import { selectedCharID } from '../stores.svelte'
import type { ActiveGenerationJob, GenerationOperationProjection } from '../server/bootstrap'
import { getDatabase } from '../storage/database.svelte'
import type { ActiveChatTarget } from '../chatCommands'
import type { GenerationReattachOutcome } from './generationReattachOutcome'
import { setGenerationFinalizationPersistences } from './generationPersistenceState'
import {
  activeChatGenerations,
  findChatGenerationActivity,
  findChatGenerationActivityByChatId,
} from './generationActivity.svelte'

/**
 * Durable generations still running server-side, as surfaced by the bootstrap
 * projection. A reloaded browser uses this to re-attach to the live stream of
 * the chat it opens, instead of only seeing the result once the projection
 * refreshes. Consumed once reattached.
 */
export const activeGenerationJobs = writable<ActiveGenerationJob[]>([])

export type GenerationJobProjectionSource =
  | 'startup'
  | 'full_resource_refresh'
  | 'online'
  | 'visibility'
  | 'pageshow'
  | 'status_probe'
  | 'manual_refresh'
  | 'bootstrap'

interface GenerationJobProjectionApplication {
  projectionEpoch?: number
  operations?: readonly GenerationOperationProjection[]
  source?: GenerationJobProjectionSource
}

interface ReattachProjectionCapture {
  applicationVersion: number
  projectionEpoch: number
  chatId: string
  jobId: string
  operationId?: string
  operationStateVersion?: number
  attemptNo?: number
  jobProjectionEpoch?: number
}

const authoritativeGenerationJobsById = new Map<string, ActiveGenerationJob>()
let authoritativeGenerationJobByChat = new Map<string, ActiveGenerationJob>()
const supersededGenerationJobChats = new Map<string, string>()
let activeGenerationProjectionEpoch = 0
let activeGenerationProjectionApplicationVersion = 0
const MAX_SUPERSEDED_GENERATION_JOB_CONTEXTS = 128

function rememberSupersededGenerationJob(jobId: string, chatId: string): void {
  supersededGenerationJobChats.delete(jobId)
  supersededGenerationJobChats.set(jobId, chatId)
  while (supersededGenerationJobChats.size > MAX_SUPERSEDED_GENERATION_JOB_CONTEXTS) {
    const oldest = supersededGenerationJobChats.keys().next().value
    if (typeof oldest !== 'string') break
    supersededGenerationJobChats.delete(oldest)
  }
}

export type GenerationJobLifecycleStatus = 'attached' | 'retrying' | 'exhausted-dead' | 'completed' | 'cancelled'

export interface GenerationJobLifecycle {
  chatId: string
  jobId: string
  status: GenerationJobLifecycleStatus
  reattachAttempts: number
  lastError?: string
  nextRetryAt?: number
  updatedAt: number
}

/**
 * Browser observation state for each durable generation job. Server ownership
 * remains in `activeGenerationJobs`; this projection tells UI consumers whether
 * that job is still being observed, retrying, or has exhausted its observer.
 */
export const generationJobLifecycles = writable<Record<string, GenerationJobLifecycle>>({})

const REATTACH_TRANSPORT_RETRY_DELAYS_MS = [250, 1_000, 4_000] as const
const MAX_RETAINED_TERMINAL_LIFECYCLES = 64

interface ReattachRetryState {
  transportFailures: number
  timer: ReturnType<typeof setTimeout> | null
}

const reattachRetryStates = new Map<string, ReattachRetryState>()

function isTerminalLifecycle(status: GenerationJobLifecycleStatus): boolean {
  return status === 'completed' || status === 'cancelled'
}

function updateGenerationJobLifecycle(
  job: Pick<ActiveGenerationJob, 'chatId' | 'jobId'>,
  status: GenerationJobLifecycleStatus,
  options: {
    reattachAttempts?: number
    lastError?: string
    nextRetryAt?: number
  } = {},
): void {
  generationJobLifecycles.update((lifecycles) => {
    const previous = lifecycles[job.jobId]
    const next: GenerationJobLifecycle = {
      chatId: job.chatId,
      jobId: job.jobId,
      status,
      reattachAttempts: options.reattachAttempts ?? previous?.reattachAttempts ?? 0,
      updatedAt: Date.now(),
    }
    const lastError = options.lastError ?? previous?.lastError
    if (lastError) next.lastError = lastError
    if (options.nextRetryAt !== undefined) next.nextRetryAt = options.nextRetryAt

    const updated = { ...lifecycles, [job.jobId]: next }
    const terminal = Object.values(updated)
      .filter((entry) => isTerminalLifecycle(entry.status))
      .sort((left, right) => right.updatedAt - left.updatedAt)
    for (const expired of terminal.slice(MAX_RETAINED_TERMINAL_LIFECYCLES)) {
      delete updated[expired.jobId]
    }
    return updated
  })
}

function removeNonterminalGenerationJobLifecycle(jobId: string): void {
  generationJobLifecycles.update((lifecycles) => {
    const lifecycle = lifecycles[jobId]
    if (!lifecycle || isTerminalLifecycle(lifecycle.status)) return lifecycles
    const updated = { ...lifecycles }
    delete updated[jobId]
    return updated
  })
}

function knownGenerationJob(jobId: string): ActiveGenerationJob | null {
  const authoritative = authoritativeGenerationJobsById.get(jobId)
  if (authoritative) return authoritative
  const active = get(activeGenerationJobs).find((job) => job.jobId === jobId)
  if (active) return active
  const lifecycle = get(generationJobLifecycles)[jobId]
  if (!lifecycle || isTerminalLifecycle(lifecycle.status)) {
    const chatId = supersededGenerationJobChats.get(jobId)
    return chatId ? { chatId, jobId } : null
  }
  return { chatId: lifecycle.chatId, jobId: lifecycle.jobId }
}

function clearReattachRetryState(jobId: string): void {
  const state = reattachRetryStates.get(jobId)
  if (state?.timer !== null && state?.timer !== undefined) clearTimeout(state.timer)
  reattachRetryStates.delete(jobId)
}

function clearAllReattachRetryStates(): void {
  for (const jobId of reattachRetryStates.keys()) clearReattachRetryState(jobId)
}

function isProtocolOperationLive(operation: GenerationOperationProjection): boolean {
  return operation.state === 'owned_by_job' || operation.state === 'stopping'
}

function normalizeGenerationJob(
  job: ActiveGenerationJob,
  operations: ReadonlyMap<string, GenerationOperationProjection>,
): ActiveGenerationJob | null {
  if (!job.operationId) return { ...job }
  const operation = operations.get(job.operationId)
  if (!operation || operation.protocolVersion !== 1) return { ...job }
  const attempt = operation.currentAttempt
  if (!isProtocolOperationLive(operation) || !attempt || attempt.jobId !== job.jobId) return null
  return {
    ...job,
    chatId: operation.chatId ?? job.chatId,
    mode: operation.mode ?? job.mode,
    ...(operation.mode === 'regenerate' && operation.targetMessageId
      ? { regenerateMessageId: operation.targetMessageId }
      : {}),
    operationId: operation.operationId,
    operationStateVersion: operation.stateVersion,
    projectionEpoch: operation.projectionEpoch,
    attemptNo: attempt.attemptNo,
    ...(operation.acceptedMessageId ? { acceptedMessageId: operation.acceptedMessageId } : {}),
    ...(operation.targetMessageId ? { targetMessageId: operation.targetMessageId } : {}),
  }
}

function hasProtocolOrdering(job: ActiveGenerationJob): boolean {
  return (
    typeof job.operationId === 'string' &&
    Number.isSafeInteger(job.projectionEpoch) &&
    Number.isSafeInteger(job.operationStateVersion) &&
    Number.isSafeInteger(job.attemptNo)
  )
}

/**
 * Section 6's total order for malformed/conflicting same-chat projections.
 * A complete protocol lineage outranks compatibility data; job-id order is
 * only the final deterministic tie-breaker.
 */
export function compareActiveGenerationJobAuthority(left: ActiveGenerationJob, right: ActiveGenerationJob): number {
  const leftProtocol = hasProtocolOrdering(left)
  const rightProtocol = hasProtocolOrdering(right)
  if (leftProtocol !== rightProtocol) return leftProtocol ? 1 : -1
  if (leftProtocol && rightProtocol) {
    return (
      left.projectionEpoch! - right.projectionEpoch! ||
      left.operationStateVersion! - right.operationStateVersion! ||
      left.attemptNo! - right.attemptNo! ||
      left.jobId.localeCompare(right.jobId)
    )
  }
  return left.jobId.localeCompare(right.jobId)
}

function deduplicateGenerationJobs(
  jobs: readonly ActiveGenerationJob[],
  operations: readonly GenerationOperationProjection[] = [],
): ActiveGenerationJob[] {
  const operationById = new Map(operations.map((operation) => [operation.operationId, operation]))
  const byChat = new Map<string, ActiveGenerationJob>()
  for (const rawJob of jobs) {
    const job = normalizeGenerationJob(rawJob, operationById)
    if (!job) continue
    const previous = byChat.get(job.chatId)
    if (!previous || compareActiveGenerationJobAuthority(job, previous) > 0) byChat.set(job.chatId, job)
  }
  return [...byChat.values()].sort(
    (left, right) => left.chatId.localeCompare(right.chatId) || compareActiveGenerationJobAuthority(left, right),
  )
}

function replaceAuthoritativeGenerationJobs(jobs: readonly ActiveGenerationJob[]): void {
  authoritativeGenerationJobsById.clear()
  authoritativeGenerationJobByChat = new Map()
  for (const job of jobs) {
    authoritativeGenerationJobsById.set(job.jobId, job)
    authoritativeGenerationJobByChat.set(job.chatId, job)
  }
}

export function authoritativeGenerationJobForChat(chatId: string | null | undefined): ActiveGenerationJob | undefined {
  return chatId ? authoritativeGenerationJobByChat.get(chatId) : undefined
}

export function setActiveGenerationJobs(
  jobs: readonly ActiveGenerationJob[],
  application: GenerationJobProjectionApplication = {},
): boolean {
  const incomingEpoch = application.projectionEpoch
  if (incomingEpoch !== undefined && incomingEpoch < activeGenerationProjectionEpoch) return false
  if (incomingEpoch !== undefined) activeGenerationProjectionEpoch = incomingEpoch
  activeGenerationProjectionApplicationVersion += 1
  const normalizedJobs = deduplicateGenerationJobs(jobs, application.operations)
  for (const previous of authoritativeGenerationJobsById.values()) {
    if (!normalizedJobs.some((job) => job.jobId === previous.jobId)) {
      rememberSupersededGenerationJob(previous.jobId, previous.chatId)
    }
  }
  replaceAuthoritativeGenerationJobs(normalizedJobs)
  const nextJobIds = new Set(normalizedJobs.map((job) => job.jobId))
  for (const jobId of reattachRetryStates.keys()) {
    if (!nextJobIds.has(jobId)) clearReattachRetryState(jobId)
  }
  activeGenerationJobs.set(normalizedJobs)

  generationJobLifecycles.update((lifecycles) => {
    const updated = { ...lifecycles }
    for (const [jobId, lifecycle] of Object.entries(updated)) {
      if (!nextJobIds.has(jobId) && !isTerminalLifecycle(lifecycle.status)) delete updated[jobId]
    }
    for (const job of normalizedJobs) {
      const previous = updated[job.jobId]
      if (previous && previous.chatId === job.chatId && !isTerminalLifecycle(previous.status)) continue
      updated[job.jobId] = {
        chatId: job.chatId,
        jobId: job.jobId,
        status: 'retrying',
        reattachAttempts: 0,
        updatedAt: Date.now(),
      }
    }
    return updated
  })
  return true
}

export function clearActiveGenerationJobProjection(): void {
  clearAllReattachRetryStates()
  authoritativeGenerationJobsById.clear()
  authoritativeGenerationJobByChat = new Map()
  supersededGenerationJobChats.clear()
  activeGenerationProjectionEpoch = 0
  activeGenerationProjectionApplicationVersion += 1
  activeGenerationJobs.set([])
  generationJobLifecycles.set({})
}

/**
 * Retain a durable job learned from the live generation response itself. Mobile
 * browsers can discard the response body while leaving the page alive, so the
 * bootstrap-only projection is not sufficient for a same-page reconnect.
 */
export function rememberActiveGenerationJob(job: ActiveGenerationJob): void {
  if (job.projectionEpoch !== undefined) {
    activeGenerationProjectionEpoch = Math.max(activeGenerationProjectionEpoch, job.projectionEpoch)
  }
  const previous = authoritativeGenerationJobByChat.get(job.chatId)
  if (
    previous &&
    previous.jobId !== job.jobId &&
    hasProtocolOrdering(previous) &&
    (!hasProtocolOrdering(job) || compareActiveGenerationJobAuthority(job, previous) <= 0)
  ) {
    return
  }
  if (previous?.jobId === job.jobId && compareActiveGenerationJobAuthority(job, previous) <= 0) {
    const remembered = { ...previous, ...job }
    authoritativeGenerationJobsById.set(job.jobId, remembered)
    authoritativeGenerationJobByChat.set(job.chatId, remembered)
    activeGenerationJobs.update((jobs) => jobs.map((entry) => (entry.jobId === job.jobId ? remembered : entry)))
    updateGenerationJobLifecycle(remembered, 'attached')
    return
  }
  const replacedJobIds = previous && previous.jobId !== job.jobId ? [previous.jobId] : []
  activeGenerationProjectionApplicationVersion += 1
  if (previous) authoritativeGenerationJobsById.delete(previous.jobId)
  const remembered = { ...job }
  authoritativeGenerationJobsById.set(job.jobId, remembered)
  authoritativeGenerationJobByChat.set(job.chatId, remembered)
  activeGenerationJobs.update((jobs) => [
    remembered,
    ...jobs.filter((entry) => entry.jobId !== job.jobId && entry.chatId !== job.chatId),
  ])
  for (const replacedJobId of replacedJobIds) {
    rememberSupersededGenerationJob(replacedJobId, job.chatId)
    clearReattachRetryState(replacedJobId)
    removeNonterminalGenerationJobLifecycle(replacedJobId)
  }
  updateGenerationJobLifecycle(job, 'attached')
}

/** Remove a locally/bootstrap-known job once its terminal frame is observed. */
export function forgetActiveGenerationJob(jobId: string, terminalStatus?: 'completed' | 'cancelled'): void {
  if (!jobId) return
  const knownJob = knownGenerationJob(jobId)
  clearReattachRetryState(jobId)
  const authoritative = authoritativeGenerationJobsById.get(jobId)
  if (authoritative) {
    authoritativeGenerationJobsById.delete(jobId)
    if (authoritativeGenerationJobByChat.get(authoritative.chatId)?.jobId === jobId) {
      authoritativeGenerationJobByChat.delete(authoritative.chatId)
    }
    activeGenerationProjectionApplicationVersion += 1
  }
  activeGenerationJobs.update((jobs) => jobs.filter((entry) => entry.jobId !== jobId))
  if (terminalStatus && knownJob) {
    updateGenerationJobLifecycle(knownJob, terminalStatus)
  } else {
    removeNonterminalGenerationJobLifecycle(jobId)
  }
}

export function isChatGenerationKnown(chatId: string | null | undefined): boolean {
  if (!chatId) return false
  return (
    findChatGenerationActivityByChatId(chatId)?.kind === 'message' ||
    get(activeGenerationJobs).some((job) => job.chatId === chatId)
  )
}

function openChatTarget(): ActiveChatTarget | null {
  const selectedChar = get(selectedCharID)
  if (selectedChar < 0) return null
  const character = getDatabase().characters?.[selectedChar]
  if (!character) return null
  const chatPage = character.chatPage ?? 0
  const chat = character.chats?.[chatPage]
  if (!chat) return null
  return {
    selectedCharID: selectedChar,
    chatPage,
    characterId: character.chaId,
    chatId: chat.id,
  }
}

function isOpenChatTargetFresh(target: ActiveChatTarget): boolean {
  const current = openChatTarget()
  if (!current) return false
  if (target.characterId !== undefined || current.characterId !== undefined) {
    if (target.characterId !== current.characterId) return false
  } else if (target.selectedCharID !== current.selectedCharID) {
    return false
  }
  if (target.chatId !== undefined || current.chatId !== undefined) {
    return target.chatId === current.chatId
  }
  return target.chatPage === current.chatPage
}

const reattachingJobIds = new Set<string>()
let reattachQueued = false

function captureReattachProjection(job: ActiveGenerationJob): ReattachProjectionCapture {
  return {
    applicationVersion: activeGenerationProjectionApplicationVersion,
    projectionEpoch: activeGenerationProjectionEpoch,
    chatId: job.chatId,
    jobId: job.jobId,
    ...(job.operationId ? { operationId: job.operationId } : {}),
    ...(job.operationStateVersion !== undefined ? { operationStateVersion: job.operationStateVersion } : {}),
    ...(job.attemptNo !== undefined ? { attemptNo: job.attemptNo } : {}),
    ...(job.projectionEpoch !== undefined ? { jobProjectionEpoch: job.projectionEpoch } : {}),
  }
}

function reattachProjectionStillCurrent(capture: ReattachProjectionCapture): boolean {
  if (
    capture.applicationVersion !== activeGenerationProjectionApplicationVersion ||
    capture.projectionEpoch !== activeGenerationProjectionEpoch
  ) {
    return false
  }
  const current = authoritativeGenerationJobByChat.get(capture.chatId)
  return (
    current?.jobId === capture.jobId &&
    current.operationId === capture.operationId &&
    current.operationStateVersion === capture.operationStateVersion &&
    current.attemptNo === capture.attemptNo &&
    current.projectionEpoch === capture.jobProjectionEpoch
  )
}

function consumePresentedGenerationJob(jobId: string): void {
  activeGenerationJobs.update((jobs) => jobs.filter((entry) => entry.jobId !== jobId))
}

function restorePresentedGenerationJob(job: ActiveGenerationJob, capture: ReattachProjectionCapture): boolean {
  if (!reattachProjectionStillCurrent(capture)) return false
  activeGenerationJobs.update((jobs) => {
    const sameChat = jobs.find((entry) => entry.chatId === job.chatId)
    if (sameChat && compareActiveGenerationJobAuthority(sameChat, job) > 0) return jobs
    return [job, ...jobs.filter((entry) => entry.jobId !== job.jobId && entry.chatId !== job.chatId)]
  })
  return true
}

function isReattachRetryBlocked(jobId: string): boolean {
  const state = reattachRetryStates.get(jobId)
  return (
    state !== undefined && (state.timer !== null || state.transportFailures > REATTACH_TRANSPORT_RETRY_DELAYS_MS.length)
  )
}

function scheduleTransportReattachRetry(job: ActiveGenerationJob, lastError: string): void {
  const jobId = job.jobId
  const state = reattachRetryStates.get(jobId) ?? { transportFailures: 0, timer: null }
  state.transportFailures += 1
  const delay = REATTACH_TRANSPORT_RETRY_DELAYS_MS[state.transportFailures - 1]
  state.timer = null
  reattachRetryStates.set(jobId, state)
  if (delay === undefined) {
    updateGenerationJobLifecycle(job, 'exhausted-dead', {
      reattachAttempts: state.transportFailures,
      lastError,
    })
    return
  }

  updateGenerationJobLifecycle(job, 'retrying', {
    reattachAttempts: state.transportFailures,
    lastError,
    nextRetryAt: Date.now() + delay,
  })

  state.timer = setTimeout(() => {
    state.timer = null
    if (reattachDisabled) return
    if (!get(activeGenerationJobs).some((job) => job.jobId === jobId)) {
      clearReattachRetryState(jobId)
      return
    }
    triggerOpenChatGenerationReattach()
  }, delay)
}

/**
 * Request a delayed reattach probe after projection state has settled. This
 * coalesces bursts from selected-character changes, active-chat projection
 * updates, and full resyncs into one guarded `maybeReattachOpenChatGeneration`.
 */
export function triggerOpenChatGenerationReattach(): void {
  if (reattachDisabled || reattachQueued) return
  reattachQueued = true
  queueMicrotask(() => {
    reattachQueued = false
    void maybeReattachOpenChatGeneration()
  })
}

/**
 * If the currently-open chat has a live server generation, re-attach to it and
 * render the replayed stream. No-op when nothing is open, no job matches, or a
 * generation is already in flight locally. Terminal outcomes consume the job;
 * transport failures receive a small, bounded retry budget.
 */
export async function maybeReattachOpenChatGeneration(): Promise<void> {
  if (reattachDisabled) return
  const target = openChatTarget()
  if (!target?.chatId) return
  const job = get(activeGenerationJobs).find((entry) => entry.chatId === target.chatId)
  if (!job) return
  await reattachGenerationJob(job, target)
}

async function reattachGenerationJob(job: ActiveGenerationJob, target: ActiveChatTarget): Promise<void> {
  if (reattachingJobIds.has(job.jobId) || isReattachRetryBlocked(job.jobId) || findChatGenerationActivity(target))
    return

  const capture = captureReattachProjection(job)
  reattachingJobIds.add(job.jobId)
  const previousLifecycle = get(generationJobLifecycles)[job.jobId]
  updateGenerationJobLifecycle(job, 'retrying', {
    reattachAttempts: previousLifecycle?.reattachAttempts ?? 0,
    lastError: previousLifecycle?.lastError,
  })
  try {
    const { sendChat, createActiveGenerationAbortController, clearActiveGenerationAbortController } =
      await import('./index.svelte')
    const { generationOperationStreamForActiveJob, isProtocolGenerationOperationJob } =
      await import('../server/generationOperations')
    if (!isOpenChatTargetFresh(target) || !reattachProjectionStillCurrent(capture)) {
      return
    }
    // Consume the job up front so a re-render / re-selection does not double
    // reattach while this one streams.
    consumePresentedGenerationJob(job.jobId)
    // Carry the running job's mode so the replayed stream renders on the right
    // row (continue extends the existing row; regenerate targets its slot) rather
    // than as a fresh send. Older servers omit `mode` and are treated as send.
    const controller = createActiveGenerationAbortController()
    try {
      const operationStream = generationOperationStreamForActiveJob(job)
      if (isProtocolGenerationOperationJob(job) && !operationStream) return
      let outcome: GenerationReattachOutcome | undefined
      const attached = await sendChat(-1, {
        signal: controller.signal,
        ...(operationStream ? { generationOperationStream: operationStream } : { reattachJobId: job.jobId }),
        expectedTarget: target,
        continue: job.mode === 'continue' ? true : undefined,
        regenerateMessageId: job.mode === 'regenerate' ? job.regenerateMessageId : undefined,
        onReattachOutcome: (value) => {
          outcome = value
        },
      })
      const settledOutcome: GenerationReattachOutcome =
        outcome ??
        (controller.signal.aborted
          ? { status: 'aborted' }
          : attached
            ? { status: 'completed' }
            : { status: 'terminal_failure' })
      if (settledOutcome.status === 'retryable_transport_failure') {
        if (restorePresentedGenerationJob(job, capture)) {
          scheduleTransportReattachRetry(job, settledOutcome.error ?? 'The generation stream could not be reached.')
        }
      } else if (settledOutcome.status === 'completed' || settledOutcome.status === 'cancelled') {
        forgetActiveGenerationJob(job.jobId, settledOutcome.status)
      } else {
        // The request layer may have remembered the job again after opening its
        // stream. Terminal outcomes still own final removal, even if bootstrap
        // or the response header refreshed the local projection mid-attempt.
        forgetActiveGenerationJob(job.jobId)
      }
    } catch (error) {
      // Untyped exceptions are not transport failures. Consume any copy that
      // the request layer may have remembered and let bootstrap be the only
      // authority that can offer the job again later.
      forgetActiveGenerationJob(job.jobId)
      throw error
    } finally {
      clearActiveGenerationAbortController(controller)
    }
  } catch {
    // Reattach is an optimization; the persisted result still surfaces via the
    // projection refresh.
  } finally {
    reattachingJobIds.delete(job.jobId)
  }
}

/** Reset the retry budget and reattach only the requested durable job. */
export async function retryGenerationJobReattach(jobId: string): Promise<void> {
  if (reattachDisabled) return
  const requestedJob = knownGenerationJob(jobId)
  const job = requestedJob ? authoritativeGenerationJobForChat(requestedJob.chatId) : undefined
  const target = openChatTarget()
  if (!job || !target?.chatId || target.chatId !== job.chatId) return

  clearReattachRetryState(job.jobId)
  const previousLifecycle = get(generationJobLifecycles)[job.jobId]
  updateGenerationJobLifecycle(job, 'retrying', {
    reattachAttempts: 0,
    lastError: previousLifecycle?.lastError,
  })
  await reattachGenerationJob(job, target)
}

export type GenerationJobRefreshResult =
  | { status: 'active' }
  | { status: 'absent' }
  | { status: 'error'; error: string }

function bootstrapRefreshError(result: { status: 'error'; error: string } | { status: 'unavailable' }): string {
  return result.status === 'error' ? result.error : 'Server bootstrap is unavailable.'
}

async function hydrateReconciledChats(jobs: readonly Pick<ActiveGenerationJob, 'chatId'>[]): Promise<void> {
  if (jobs.length === 0) return
  const { hydrateChatMessages } = await import('../server/chatMessageHydration.svelte')
  await Promise.all(
    [...new Set(jobs.map((job) => job.chatId))].map((chatId) =>
      hydrateChatMessages(chatId, { force: true }).catch(() => undefined),
    ),
  )
}

/** Reconcile and retry only the requested job against authoritative bootstrap state. */
export async function refreshGenerationJobFromBootstrap(jobId: string): Promise<GenerationJobRefreshResult> {
  if (reattachDisabled) return { status: 'error', error: 'Generation reattach is disabled.' }
  const requestedJob = knownGenerationJob(jobId)
  if (!requestedJob) return { status: 'absent' }

  const { fetchServerBootstrapReadOnly } = await import('../server/bootstrap')
  const runtime = await fetchServerBootstrapReadOnly(null, { cacheRevision: false })
  if (runtime.status !== 'ok') {
    const error = bootstrapRefreshError(runtime)
    updateGenerationJobLifecycle(requestedJob, 'exhausted-dead', { lastError: error })
    return { status: 'error', error }
  }

  const { applyGenerationOperationBootstrap } = await import('../server/generationOperations')
  applyGenerationOperationBootstrap(runtime.bootstrap, 'manual_refresh')
  if (runtime.bootstrap.generationFinalizations) {
    setGenerationFinalizationPersistences(runtime.bootstrap.generationFinalizations)
  }
  const authoritativeJob = authoritativeGenerationJobForChat(requestedJob.chatId)
  if (!authoritativeJob) {
    await hydrateReconciledChats([requestedJob])
    return { status: 'absent' }
  }

  clearReattachRetryState(authoritativeJob.jobId)
  const previousLifecycle = get(generationJobLifecycles)[authoritativeJob.jobId]
  updateGenerationJobLifecycle(authoritativeJob, 'retrying', {
    reattachAttempts: 0,
    lastError: previousLifecycle?.lastError,
  })
  const target = openChatTarget()
  if (target?.chatId === authoritativeJob.chatId) {
    await reattachGenerationJob(authoritativeJob, target)
  }
  return { status: 'active' }
}

/** Stop only the requested job, preferring its durable operation identity when available. */
export async function stopGenerationJob(jobId: string) {
  const requestedJob = knownGenerationJob(jobId)
  if (!requestedJob) return
  const job = authoritativeGenerationJobForChat(requestedJob.chatId)
  if (!job) return
  if (job.operationId) {
    const { isProtocolGenerationOperationJob, stopGenerationOperation } = await import('../server/generationOperations')
    if (!isProtocolGenerationOperationJob(job)) {
      const { cancelServerChatGeneration } = await import('./request/serverChat')
      return cancelServerChatGeneration(job.jobId)
    }
    return stopGenerationOperation(job.operationId)
  }
  const { cancelServerChatGeneration } = await import('./request/serverChat')
  return cancelServerChatGeneration(job.jobId)
}

let wired = false
let reattachDisabled = false
let runtimeJobRefresh: Promise<void> | null = null
let stopSelectedCharacterSubscription: (() => void) | null = null
let stopGenerationActivitySubscription: (() => void) | null = null

const handleGenerationVisibilityChange = (): void => {
  if (!reattachDisabled && document.visibilityState === 'visible') {
    void refreshRuntimeJobsAndTriggerReattach('visibility')
  }
}
const handleGenerationPageShow = (): void => {
  if (!reattachDisabled) void refreshRuntimeJobsAndTriggerReattach('pageshow')
}
const handleGenerationOnline = (): void => {
  if (!reattachDisabled) void refreshRuntimeJobsAndTriggerReattach('online')
}

function waitForRuntimeJobRefresh(promise: Promise<void>, signal: AbortSignal | null | undefined): Promise<void> {
  if (!signal) return promise
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const settle = () => {
      signal.removeEventListener('abort', settle)
      resolve()
    }
    signal.addEventListener('abort', settle, { once: true })
    void promise.then(settle, settle)
  })
}

export async function refreshActiveGenerationJobsFromBootstrap(
  signal?: AbortSignal | null,
  source: GenerationJobProjectionSource = 'status_probe',
): Promise<void> {
  if (reattachDisabled) return
  if (runtimeJobRefresh) return waitForRuntimeJobRefresh(runtimeJobRefresh, signal)
  let request: Promise<void>
  request = (async () => {
    try {
      const { fetchServerBootstrapReadOnly } = await import('../server/bootstrap')
      const runtime = await fetchServerBootstrapReadOnly(signal ?? null, { cacheRevision: false })
      if (!reattachDisabled && !signal?.aborted && runtime.status === 'ok') {
        const previousJobs = Object.values(get(generationJobLifecycles)).filter(
          (lifecycle) => !isTerminalLifecycle(lifecycle.status),
        )
        const { applyGenerationOperationBootstrap } = await import('../server/generationOperations')
        const applied = applyGenerationOperationBootstrap(runtime.bootstrap, source)
        if (runtime.bootstrap.generationFinalizations) {
          setGenerationFinalizationPersistences(runtime.bootstrap.generationFinalizations)
        }
        if (applied) {
          const activeJobIds = new Set(authoritativeGenerationJobsById.keys())
          await hydrateReconciledChats(previousJobs.filter((job) => !activeJobIds.has(job.jobId)))
        }
      }
    } catch {
      // Keep the locally remembered job; a later lifecycle event can retry.
    } finally {
      if (runtimeJobRefresh === request) runtimeJobRefresh = null
    }
  })()
  runtimeJobRefresh = request
  await waitForRuntimeJobRefresh(request, signal)
  // An auth/provider mock can ignore AbortSignal. Release only the request this
  // bounded caller started so a later lifecycle probe can make fresh progress;
  // the identity-checked finally above cannot clear that newer request.
  if (signal?.aborted && runtimeJobRefresh === request) runtimeJobRefresh = null
}

async function refreshRuntimeJobsAndTriggerReattach(source: GenerationJobProjectionSource): Promise<void> {
  try {
    await refreshActiveGenerationJobsFromBootstrap(undefined, source)
  } finally {
    if (!reattachDisabled) triggerOpenChatGenerationReattach()
  }
}

/**
 * Wire the reattach trigger: whenever the selected character changes (the
 * reload-resume entry point — the user opens the chat that was generating), try
 * to re-attach. Idempotent; safe to call once at startup.
 */
export function startActiveGenerationReattach(): void {
  if (wired) return
  wired = true
  reattachDisabled = false
  stopSelectedCharacterSubscription = selectedCharID.subscribe(() => {
    triggerOpenChatGenerationReattach()
  })
  stopGenerationActivitySubscription = activeChatGenerations.subscribe(() => {
    triggerOpenChatGenerationReattach()
  })

  // A mobile tab can remain mounted while its fetch/SSE sockets are discarded.
  // Refresh the server's active-job projection when the page or network returns
  // so even a request dropped before its job-id header arrived can recover.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleGenerationVisibilityChange)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pageshow', handleGenerationPageShow)
    window.addEventListener('online', handleGenerationOnline)
  }
}

export function stopActiveGenerationReattach(): void {
  reattachDisabled = true
  wired = false
  reattachQueued = false
  reattachingJobIds.clear()
  clearAllReattachRetryStates()
  stopSelectedCharacterSubscription?.()
  stopSelectedCharacterSubscription = null
  stopGenerationActivitySubscription?.()
  stopGenerationActivitySubscription = null
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleGenerationVisibilityChange)
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('pageshow', handleGenerationPageShow)
    window.removeEventListener('online', handleGenerationOnline)
  }
}

export function resetGenerationJobLifecyclesForTests(): void {
  clearActiveGenerationJobProjection()
  activeGenerationProjectionApplicationVersion = 0
  generationJobLifecycles.set({})
}
