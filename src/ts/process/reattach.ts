import { get, writable } from 'svelte/store'
import { DBState, selectedCharID } from '../stores.svelte'
import type { ActiveGenerationJob } from '../server/bootstrap'

/**
 * lazy-projection Phase 7: durable generations still running server-side, as
 * surfaced by the bootstrap projection. A reloaded browser uses this to
 * re-attach to the live stream of the chat it opens, instead of only seeing the
 * result once the projection refreshes. Consumed (removed) once reattached.
 */
export const activeGenerationJobs = writable<ActiveGenerationJob[]>([])

export function setActiveGenerationJobs(jobs: readonly ActiveGenerationJob[]): void {
  activeGenerationJobs.set([...jobs])
}

function openChatId(): string | undefined {
  const selId = get(selectedCharID)
  if (selId < 0) return undefined
  const character = DBState.db?.characters?.[selId]
  if (!character) return undefined
  const chat = character.chats?.[character.chatPage ?? 0]
  return chat?.id
}

let reattaching = false

/**
 * If the currently-open chat has a live server generation, re-attach to it and
 * render the replayed stream. No-op when nothing is open, no job matches, or a
 * generation is already in flight locally. Each job is reattached at most once.
 */
export async function maybeReattachOpenChatGeneration(): Promise<void> {
  if (reattaching) return
  const chatId = openChatId()
  if (!chatId) return
  const job = get(activeGenerationJobs).find((entry) => entry.chatId === chatId)
  if (!job) return

  reattaching = true
  try {
    const { sendChat, doingChat } = await import('./index.svelte')
    if (get(doingChat)) return
    // Consume the job up front so a re-render / re-selection does not double
    // reattach while this one streams.
    activeGenerationJobs.update((jobs) => jobs.filter((entry) => entry.jobId !== job.jobId))
    // Phase 6b: carry the running job's mode so the replayed stream renders on the
    // right row (continue → extend the existing row; regenerate → its target slot)
    // rather than as a fresh send. Older servers omit `mode` → treated as send.
    await sendChat(-1, {
      reattachJobId: job.jobId,
      continue: job.mode === 'continue' ? true : undefined,
      regenerateMessageId: job.mode === 'regenerate' ? job.regenerateMessageId : undefined,
    })
  } catch {
    // Reattach is an optimization; the persisted result still surfaces via the
    // projection refresh.
  } finally {
    reattaching = false
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
    void maybeReattachOpenChatGeneration()
  })
}
