import { writable } from 'svelte/store'
import type { PostGenerationProgressEvent } from './request/serverChatEvents'

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

export const postGenerationProgress = writable<ActivePostGenerationProgress | null>(null)

let activeSession: PostGenerationProgressSession | null = null

export function beginPostGenerationProgress(target: PostGenerationProgressTarget): PostGenerationProgressSession {
  const session = {
    target: { ...target },
  }
  activeSession = session
  postGenerationProgress.set(null)
  return session
}

export function clearPostGenerationProgress(session?: PostGenerationProgressSession): void {
  if (session && activeSession !== session) return
  activeSession = null
  postGenerationProgress.set(null)
}

export function updatePostGenerationProgress(
  session: PostGenerationProgressSession,
  event: PostGenerationProgressEvent,
): void {
  if (activeSession !== session) return
  if (TERMINAL_PROGRESS_STATUSES.has(event.status)) {
    clearPostGenerationProgress(session)
    return
  }

  const now = Date.now()
  const { type: _type, ...progress } = event
  void _type
  postGenerationProgress.update((current) => {
    const sameRun = current?.runSeq === event.runSeq && current.phase === event.phase
    return {
      ...progress,
      target: session.target,
      startedAt: sameRun ? current.startedAt : now,
      updatedAt: now,
    }
  })
}
