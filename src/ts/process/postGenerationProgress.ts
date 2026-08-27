import { writable } from 'svelte/store'
import type { PostGenerationProgressEvent } from '@risuai/protocol/generation-sse'

export type ActivePostGenerationProgress = Omit<PostGenerationProgressEvent, 'type'> & {
  target: PostGenerationProgressTarget
  startedAt: number
  updatedAt: number
}

export interface PostGenerationProgressTarget {
  characterId: string
  chatId: string
}

export interface PostGenerationProgressSession {
  readonly target: PostGenerationProgressTarget
}

const TERMINAL_PROGRESS_STATUSES = new Set<PostGenerationProgressEvent['status']>(['finished', 'error'])
const MAX_ACTIVE_POST_GENERATION_PROGRESS = 16

export const postGenerationProgress = writable<ActivePostGenerationProgress[]>([])

const activeSessions = new Map<string, PostGenerationProgressSession>()

function targetKey(target: PostGenerationProgressTarget): string {
  return JSON.stringify([target.characterId, target.chatId])
}

function removeProgressForTarget(target: PostGenerationProgressTarget): void {
  postGenerationProgress.update((entries) =>
    entries.filter((entry) => entry.target.characterId !== target.characterId || entry.target.chatId !== target.chatId),
  )
}

function touchSession(session: PostGenerationProgressSession): boolean {
  const key = targetKey(session.target)
  if (activeSessions.get(key) !== session) return false
  activeSessions.delete(key)
  activeSessions.set(key, session)
  return true
}

function trimActiveSessions(): void {
  while (activeSessions.size > MAX_ACTIVE_POST_GENERATION_PROGRESS) {
    const oldestKey = activeSessions.keys().next().value
    if (oldestKey === undefined) return
    const oldestSession = activeSessions.get(oldestKey)
    activeSessions.delete(oldestKey)
    if (oldestSession) removeProgressForTarget(oldestSession.target)
  }
}

export function beginPostGenerationProgress(target: PostGenerationProgressTarget): PostGenerationProgressSession {
  const session = {
    target: { ...target },
  }
  const key = targetKey(target)
  activeSessions.delete(key)
  activeSessions.set(key, session)
  removeProgressForTarget(target)
  trimActiveSessions()
  return session
}

export function clearPostGenerationProgress(session?: PostGenerationProgressSession): void {
  if (!session) {
    activeSessions.clear()
    postGenerationProgress.set([])
    return
  }
  const key = targetKey(session.target)
  if (activeSessions.get(key) !== session) return
  activeSessions.delete(key)
  removeProgressForTarget(session.target)
}

export function updatePostGenerationProgress(
  session: PostGenerationProgressSession,
  event: PostGenerationProgressEvent,
): void {
  if (!touchSession(session)) return
  if (TERMINAL_PROGRESS_STATUSES.has(event.status)) {
    clearPostGenerationProgress(session)
    return
  }

  const now = Date.now()
  const { type: _type, ...progress } = event
  void _type
  postGenerationProgress.update((entries) => {
    const current = entries.find(
      (entry) =>
        entry.target.characterId === session.target.characterId && entry.target.chatId === session.target.chatId,
    )
    const sameRun = current?.runSeq === event.runSeq && current.phase === event.phase
    const next = {
      ...progress,
      target: session.target,
      startedAt: sameRun ? current.startedAt : now,
      updatedAt: now,
    }
    return [
      ...entries.filter(
        (entry) =>
          entry.target.characterId !== session.target.characterId || entry.target.chatId !== session.target.chatId,
      ),
      next,
    ]
  })
}
