import { writable } from 'svelte/store'
import type { PostGenerationProgressEvent } from './request/serverChatEvents'

export type ActivePostGenerationProgress = Omit<PostGenerationProgressEvent, 'type'> & {
  startedAt: number
  updatedAt: number
}

const TERMINAL_PROGRESS_STATUSES = new Set<PostGenerationProgressEvent['status']>(['finished', 'error'])

export const postGenerationProgress = writable<ActivePostGenerationProgress | null>(null)

export function clearPostGenerationProgress(): void {
  postGenerationProgress.set(null)
}

export function updatePostGenerationProgress(event: PostGenerationProgressEvent): void {
  if (TERMINAL_PROGRESS_STATUSES.has(event.status)) {
    clearPostGenerationProgress()
    return
  }

  const now = Date.now()
  const { type: _type, ...progress } = event
  void _type
  postGenerationProgress.update((current) => {
    const sameRun = current?.runSeq === event.runSeq && current.phase === event.phase
    return {
      ...progress,
      startedAt: sameRun ? current.startedAt : now,
      updatedAt: now,
    }
  })
}
