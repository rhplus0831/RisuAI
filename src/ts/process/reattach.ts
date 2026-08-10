import { get, writable } from 'svelte/store'
import { selectedCharID } from '../stores.svelte'
import type { ActiveGenerationJob } from '../server/bootstrap'
import { getDatabase } from '../storage/database.svelte'
import type { ActiveChatTarget } from '../chatCommands'
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

export function setActiveGenerationJobs(jobs: readonly ActiveGenerationJob[]): void {
  activeGenerationJobs.set([...jobs])
}

/**
 * Retain a durable job learned from the live generation response itself. Mobile
 * browsers can discard the response body while leaving the page alive, so the
 * bootstrap-only projection is not sufficient for a same-page reconnect.
 */
export function rememberActiveGenerationJob(job: ActiveGenerationJob): void {
  activeGenerationJobs.update((jobs) => {
    const retained = jobs.filter((entry) => entry.jobId !== job.jobId && entry.chatId !== job.chatId)
    return [job, ...retained]
  })
}

/** Remove a locally/bootstrap-known job once its terminal frame is observed. */
export function forgetActiveGenerationJob(jobId: string): void {
  if (!jobId) return
  activeGenerationJobs.update((jobs) => jobs.filter((entry) => entry.jobId !== jobId))
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
 * generation is already in flight locally. Each job is reattached at most once.
 */
export async function maybeReattachOpenChatGeneration(): Promise<void> {
  if (reattachDisabled) return
  const target = openChatTarget()
  if (!target?.chatId) return
  const job = get(activeGenerationJobs).find((entry) => entry.chatId === target.chatId)
  if (!job || reattachingJobIds.has(job.jobId) || findChatGenerationActivity(target)) return

  reattachingJobIds.add(job.jobId)
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
      const attached = await sendChat(-1, {
        signal: controller.signal,
        reattachJobId: job.jobId,
        expectedTarget: target,
        continue: job.mode === 'continue' ? true : undefined,
        regenerateMessageId: job.mode === 'regenerate' ? job.regenerateMessageId : undefined,
      })
      if (!attached && !controller.signal.aborted) {
        // sendChat reports HTTP/SSE/transport failures as `false`. Keep the
        // durable job retryable until the next server projection confirms it is
        // complete or gone. An explicit user abort is final and must not re-arm.
        restoreJob()
      }
    } catch (error) {
      // A transport/import failure does not mean the durable server job has
      // stopped. Put it back so a later selection/SSE probe can retry instead of
      // silently losing the only local record of the running generation.
      restoreJob()
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

export async function refreshActiveGenerationJobsFromBootstrap(): Promise<void> {
  if (reattachDisabled) return
  if (runtimeJobRefresh) return runtimeJobRefresh
  runtimeJobRefresh = (async () => {
    try {
      const { fetchServerBootstrapReadOnly } = await import('../server/bootstrap')
      const runtime = await fetchServerBootstrapReadOnly(null, { cacheRevision: false })
      if (!reattachDisabled && runtime.status === 'ok') {
        setActiveGenerationJobs(runtime.bootstrap.activeGenerationJobs ?? [])
      }
    } catch {
      // Keep the locally remembered job; a later lifecycle event can retry.
    } finally {
      runtimeJobRefresh = null
    }
  })()
  return runtimeJobRefresh
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
