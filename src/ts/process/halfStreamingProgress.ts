import { writable } from 'svelte/store'

export interface HalfStreamingProgressTarget {
  characterId: string
  chatId: string
  generationId: string
}

export interface ActiveHalfStreamingProgress extends HalfStreamingProgressTarget {
  generatedTokens: number
  tokensPerSecond: number
  firstTokenAt?: number
  updatedAt: number
}

export const halfStreamingProgress = writable<ActiveHalfStreamingProgress | null>(null)

function sameTarget(
  progress: ActiveHalfStreamingProgress | null,
  target: HalfStreamingProgressTarget,
): progress is ActiveHalfStreamingProgress {
  return (
    progress?.characterId === target.characterId &&
    progress.chatId === target.chatId &&
    progress.generationId === target.generationId
  )
}

export function beginHalfStreamingProgress(target: HalfStreamingProgressTarget): void {
  halfStreamingProgress.set({
    ...target,
    generatedTokens: 0,
    tokensPerSecond: 0,
    updatedAt: Date.now(),
  })
}

/**
 * Record one provider token frame. Providers may batch more than one tokenizer
 * token into a frame, but this keeps the live rate transport-neutral and avoids
 * blocking the response reader on a full re-tokenization after every delta.
 */
export function recordHalfStreamingToken(target: HalfStreamingProgressTarget, now = Date.now()): void {
  halfStreamingProgress.update((current) => {
    const active = sameTarget(current, target)
      ? current
      : {
          ...target,
          generatedTokens: 0,
          tokensPerSecond: 0,
          updatedAt: now,
        }
    const firstTokenAt = active.firstTokenAt ?? now
    const generatedTokens = active.generatedTokens + 1
    const elapsedSeconds = (now - firstTokenAt) / 1000
    const tokensPerSecond = elapsedSeconds > 0 ? (generatedTokens - 1) / elapsedSeconds : 0
    return {
      ...active,
      generatedTokens,
      tokensPerSecond,
      firstTokenAt,
      updatedAt: now,
    }
  })
}

export function clearHalfStreamingProgress(target: HalfStreamingProgressTarget): void {
  halfStreamingProgress.update((current) => (sameTarget(current, target) ? null : current))
}

export function clearHalfStreamingProgressForChat(characterId: string, chatId: string): void {
  halfStreamingProgress.update((current) =>
    current?.characterId === characterId && current.chatId === chatId ? null : current,
  )
}
