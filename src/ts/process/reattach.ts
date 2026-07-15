import { get, writable } from 'svelte/store'
import { selectedCharID } from '../stores.svelte'
import type { ActiveGenerationJob } from '../server/bootstrap'
import { getDatabase } from '../storage/database.svelte'
import type { ActiveChatTarget } from '../chatCommands'

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

let reattaching = false
let reattachQueued = false
// A trigger that arrived while a reattach was streaming the user
// switched to another chat with its own live job. Re-arm one probe after the
// in-flight reattach settles instead of dropping the request.
let reattachDeferred = false

/**
 * Request a delayed reattach probe after projection state has settled. This
 * coalesces bursts from selected-character changes, active-chat projection
 * updates, and full resyncs into one guarded `maybeReattachOpenChatGeneration`.
 */
export function triggerOpenChatGenerationReattach(): void {
  if (reattachQueued) return
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
  if (reattaching) {
    reattachDeferred = true
    return
  }
  const target = openChatTarget()
  if (!target?.chatId) return
  const job = get(activeGenerationJobs).find((entry) => entry.chatId === target.chatId)
  if (!job) return

  reattaching = true
  try {
    const { sendChat, doingChat, createActiveGenerationAbortController, clearActiveGenerationAbortController } =
      await import('./index.svelte')
    if (!isOpenChatTargetFresh(target)) {
      reattachDeferred = true
      return
    }
    if (get(doingChat)) return
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
    reattaching = false
    // Re-arm a probe requested mid-stream targets whatever chat is
    // open NOW — without this, switching between two chats with live jobs left
    // the second un-reattached until another selection change.
    if (reattachDeferred) {
      reattachDeferred = false
      triggerOpenChatGenerationReattach()
    }
  }
}

let wired = false

/**
 * Wire the reattach trigger: whenever the selected character changes (the
 * reload-resume entry point — the user opens the chat that was generating), try
 * to re-attach. Idempotent; safe to call once at startup.
 */
export function startActiveGenerationReattach(): void {
  if (wired) return
  wired = true
  selectedCharID.subscribe(() => {
    triggerOpenChatGenerationReattach()
  })
}
