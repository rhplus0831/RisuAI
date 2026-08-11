import { get, writable } from 'svelte/store'
import { selectedCharID } from '../stores.svelte'
import type { ActiveGenerationJob } from '../server/bootstrap'
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
  const active = get(activeGenerationJobs).find((job) => job.jobId === jobId)
  if (active) return active
  const lifecycle = get(generationJobLifecycles)[jobId]
  if (!lifecycle || isTerminalLifecycle(lifecycle.status)) return null
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

export function setActiveGenerationJobs(jobs: readonly ActiveGenerationJob[]): void {
  const nextJobIds = new Set(jobs.map((job) => job.jobId))
  for (const jobId of reattachRetryStates.keys()) {
    if (!nextJobIds.has(jobId)) clearReattachRetryState(jobId)
  }
  activeGenerationJobs.set([...jobs])

  generationJobLifecycles.update((lifecycles) => {
    const updated = { ...lifecycles }
    for (const [jobId, lifecycle] of Object.entries(updated)) {
      if (!nextJobIds.has(jobId) && !isTerminalLifecycle(lifecycle.status)) delete updated[jobId]
    }
    for (const job of jobs) {
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
}

/**
 * Retain a durable job learned from the live generation response itself. Mobile
 * browsers can discard the response body while leaving the page alive, so the
 * bootstrap-only projection is not sufficient for a same-page reconnect.
 */
export function rememberActiveGenerationJob(job: ActiveGenerationJob): void {
  let replacedJobIds: string[] = []
  activeGenerationJobs.update((jobs) => {
    replacedJobIds = jobs
      .filter((entry) => entry.jobId !== job.jobId && entry.chatId === job.chatId)
      .map((entry) => entry.jobId)
    const retained = jobs.filter((entry) => entry.jobId !== job.jobId && entry.chatId !== job.chatId)
    return [job, ...retained]
  })
  for (const replacedJobId of replacedJobIds) {
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

  reattachingJobIds.add(job.jobId)
  const previousLifecycle = get(generationJobLifecycles)[job.jobId]
  updateGenerationJobLifecycle(job, 'retrying', {
    reattachAttempts: previousLifecycle?.reattachAttempts ?? 0,
    lastError: previousLifecycle?.lastError,
  })
  try {
    const { sendChat, createActiveGenerationAbortController, clearActiveGenerationAbortController } =
      await import('./index.svelte')
    if (!isOpenChatTargetFresh(target)) {
      return
    }
    // Consume the job up front so a re-render / re-selection does not double
    // reattach while this one streams.
    activeGenerationJobs.update((jobs) => jobs.filter((entry) => entry.jobId !== job.jobId))
    // Carry the running job's mode so the replayed stream renders on the right
    // row (continue extends the existing row; regenerate targets its slot) rather
    // than as a fresh send. Older servers omit `mode` and are treated as send.
    const controller = createActiveGenerationAbortController()
    const restoreJob = () => {
      activeGenerationJobs.update((jobs) => (jobs.some((entry) => entry.jobId === job.jobId) ? jobs : [job, ...jobs]))
    }
    try {
      let outcome: GenerationReattachOutcome | undefined
      const attached = await sendChat(-1, {
        signal: controller.signal,
        reattachJobId: job.jobId,
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
        restoreJob()
        scheduleTransportReattachRetry(job, settledOutcome.error ?? 'The generation stream could not be reached.')
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
  const job = get(activeGenerationJobs).find((entry) => entry.jobId === jobId)
  const target = openChatTarget()
  if (!job || !target?.chatId || target.chatId !== job.chatId) return

  clearReattachRetryState(jobId)
  const previousLifecycle = get(generationJobLifecycles)[jobId]
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

  const jobs = runtime.bootstrap.activeGenerationJobs ?? []
  if (runtime.bootstrap.generationFinalizations) {
    setGenerationFinalizationPersistences(runtime.bootstrap.generationFinalizations)
  }
  const authoritativeJob = jobs.find((job) => job.jobId === requestedJob.jobId && job.chatId === requestedJob.chatId)
  setActiveGenerationJobs(jobs)
  if (!authoritativeJob) {
    await hydrateReconciledChats([requestedJob])
    return { status: 'absent' }
  }

  clearReattachRetryState(jobId)
  const previousLifecycle = get(generationJobLifecycles)[jobId]
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

/** Stop only the requested job; AV-01 owns acknowledged cancellation probing. */
export async function stopGenerationJob(jobId: string): Promise<void> {
  const job = get(activeGenerationJobs).find((entry) => entry.jobId === jobId)
  if (!job) return
  const { cancelServerChatGeneration } = await import('./request/serverChat')
  await cancelServerChatGeneration(job.jobId)
}

let wired = false
let reattachDisabled = false
let runtimeJobRefresh: Promise<void> | null = null
let stopSelectedCharacterSubscription: (() => void) | null = null
let stopGenerationActivitySubscription: (() => void) | null = null

const handleGenerationVisibilityChange = (): void => {
  if (!reattachDisabled && document.visibilityState === 'visible') void refreshRuntimeJobsAndTriggerReattach()
}
const handleGenerationPageShow = (): void => {
  if (!reattachDisabled) void refreshRuntimeJobsAndTriggerReattach()
}
const handleGenerationOnline = (): void => {
  if (!reattachDisabled) void refreshRuntimeJobsAndTriggerReattach()
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

export async function refreshActiveGenerationJobsFromBootstrap(signal?: AbortSignal | null): Promise<void> {
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
        const jobs = runtime.bootstrap.activeGenerationJobs ?? []
        if (runtime.bootstrap.generationFinalizations) {
          setGenerationFinalizationPersistences(runtime.bootstrap.generationFinalizations)
        }
        const activeJobIds = new Set(jobs.map((job) => job.jobId))
        setActiveGenerationJobs(jobs)
        await hydrateReconciledChats(previousJobs.filter((job) => !activeJobIds.has(job.jobId)))
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

async function refreshRuntimeJobsAndTriggerReattach(): Promise<void> {
  try {
    await refreshActiveGenerationJobsFromBootstrap()
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
  clearAllReattachRetryStates()
  generationJobLifecycles.set({})
}
