import { get, writable } from 'svelte/store'
import { registerRetainedChatProjection } from '../server/chatRetainedProjection'
import type {
  GenerationFinalizationProjection,
  GenerationFinalizationProjectionFence,
  GenerationFinalizationState,
} from '../server/bootstrap'
import { getDatabase, type Message } from '../storage/database.svelte'
import { withTrustedResourceWrite } from '../server/resourceWriteGuard.svelte'

export interface QueuedGenerationPersistence {
  chatId: string
  messageId: string
  generationId: string
  mode?: 'send' | 'continue' | 'regenerate'
  state?: GenerationFinalizationState
  failureCount?: number
  nextAttemptAt?: string
  provisionalMessage?: Message
  projectionFence?: GenerationFinalizationProjectionFence
}

export type GenerationPersistenceIndicatorState = 'queued' | 'stalled' | 'terminal' | 'stalled_legacy'

export const generationFinalizationPersistences = writable<QueuedGenerationPersistence[]>([])
/** Compatibility alias for callers that only knew about the original live queued state. */
export const queuedGenerationPersistences = generationFinalizationPersistences

const retainedProjectionReleases = new Map<string, () => void>()
const GENERATION_FINALIZATION_REFRESH_INTERVAL_MS = 5_000
let refreshEnabled = false
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let refreshInFlight = false

function hasReplayableFinalizations(entries: readonly QueuedGenerationPersistence[]): boolean {
  return entries.some((entry) => entry.state === undefined || entry.state === 'queued' || entry.state === 'stalled')
}

function scheduleGenerationFinalizationRefresh(entries: readonly QueuedGenerationPersistence[]): void {
  if (!refreshEnabled || refreshTimer || refreshInFlight || !hasReplayableFinalizations(entries)) return
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void refreshGenerationFinalizationPersistences()
  }, GENERATION_FINALIZATION_REFRESH_INTERVAL_MS)
}

async function refreshGenerationFinalizationPersistences(): Promise<void> {
  if (!refreshEnabled || refreshInFlight) return
  refreshInFlight = true
  try {
    const { fetchServerBootstrapReadOnly } = await import('../server/bootstrap')
    const result = await fetchServerBootstrapReadOnly(null, { cacheRevision: false })
    if (refreshEnabled && result.status === 'ok' && result.bootstrap.generationFinalizations) {
      setGenerationFinalizationPersistences(result.bootstrap.generationFinalizations)
    }
  } catch {
    // Keep the last truthful projection; the next bounded refresh can retry.
  } finally {
    refreshInFlight = false
    scheduleGenerationFinalizationRefresh(get(generationFinalizationPersistences))
  }
}

function releaseRetainedFinalizationProjections(): void {
  for (const release of retainedProjectionReleases.values()) release()
  retainedProjectionReleases.clear()
}

function messageMatches(left: Message | undefined, right: Message | undefined): boolean {
  if (!left || !right) return left === right
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

function findChatMessages(chatId: string): Message[] | null {
  const matches = getDatabase()
    .characters?.flatMap((character) => character.chats ?? [])
    .filter((chat) => chat.id === chatId)
  if (matches?.length !== 1) return null
  return matches[0].message ?? null
}

function reapplyGenerationFinalizationProjection(entry: QueuedGenerationPersistence): void {
  const message = entry.provisionalMessage
  const fence = entry.projectionFence
  if (!message || !fence) return
  withTrustedResourceWrite(() => {
    const messages = findChatMessages(entry.chatId)
    if (!messages) return
    if (
      messages.some(
        (candidate) =>
          candidate.generationInfo?.generationId === entry.generationId ||
          (candidate.chatId === entry.messageId && messageMatches(candidate, message)),
      )
    ) {
      return
    }
    if (messages.length !== fence.transcriptLength) return
    const tail = messages.at(-1)
    if (fence.kind === 'target-tail') {
      if (!messageMatches(tail, fence.target.message)) return
      messages[messages.length - 1] = structuredClone(message)
      return
    }
    if (fence.tail ? !messageMatches(tail, fence.tail.message) : tail !== undefined) return
    messages.push(structuredClone(message))
  })
}

/** Replace the writer-scoped bootstrap projection and retain its safe provisional rows across hydration. */
export function setGenerationFinalizationPersistences(entries: readonly GenerationFinalizationProjection[]): void {
  releaseRetainedFinalizationProjections()
  const next = entries.map((entry) => structuredClone(entry))
  generationFinalizationPersistences.set(next)
  for (const entry of next) {
    if (!entry.provisionalMessage || !entry.projectionFence || entry.state === 'committed_cleanup_pending') continue
    const release = registerRetainedChatProjection({ kind: 'chat-body', chatId: entry.chatId }, () =>
      reapplyGenerationFinalizationProjection(entry),
    )
    retainedProjectionReleases.set(entry.generationId, release)
  }
  scheduleGenerationFinalizationRefresh(next)
}

export function markGenerationPersistenceQueued(entry: QueuedGenerationPersistence): void {
  generationFinalizationPersistences.update((entries) => [
    ...entries.filter(
      (candidate) => candidate.chatId !== entry.chatId || candidate.generationId !== entry.generationId,
    ),
    entry,
  ])
  scheduleGenerationFinalizationRefresh([entry])
}

export function clearGenerationPersistence(chatId: string, generationId: string): void {
  retainedProjectionReleases.get(generationId)?.()
  retainedProjectionReleases.delete(generationId)
  generationFinalizationPersistences.update((entries) =>
    entries.filter((entry) => entry.chatId !== chatId || entry.generationId !== generationId),
  )
}

export function generationPersistenceStateForMessage(
  entries: readonly QueuedGenerationPersistence[],
  chatId: string | undefined,
  message: Message,
): GenerationPersistenceIndicatorState | null {
  if (!chatId) return null
  const entry = entries.find(
    (candidate) =>
      candidate.chatId === chatId &&
      (candidate.messageId === message.chatId || candidate.generationId === message.generationInfo?.generationId),
  )
  const state = entry?.state ?? (entry ? 'queued' : undefined)
  return state === 'queued' || state === 'stalled' || state === 'terminal' || state === 'stalled_legacy' ? state : null
}

/** Clear provisional badges only when an authoritative hydration contains the queued generation. */
export function acknowledgeHydratedGenerationPersistences(chatId: string, messages: readonly Message[]): void {
  generationFinalizationPersistences.update((entries) =>
    entries.filter((entry) => {
      if (entry.chatId !== chatId || entry.state === 'terminal' || entry.state === 'stalled_legacy') return true
      const acknowledged = messages.some(
        (message) =>
          message.generationInfo?.generationId === entry.generationId ||
          (entry.messageId === entry.generationId && message.chatId === entry.generationId),
      )
      if (acknowledged) {
        retainedProjectionReleases.get(entry.generationId)?.()
        retainedProjectionReleases.delete(entry.generationId)
      }
      return !acknowledged
    }),
  )
}

export function resetGenerationFinalizationPersistencesForTests(): void {
  stopGenerationFinalizationPersistenceRefresh()
  releaseRetainedFinalizationProjections()
  generationFinalizationPersistences.set([])
}

export function startGenerationFinalizationPersistenceRefresh(): void {
  refreshEnabled = true
  scheduleGenerationFinalizationRefresh(get(generationFinalizationPersistences))
}

export function stopGenerationFinalizationPersistenceRefresh(): void {
  refreshEnabled = false
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = null
}
