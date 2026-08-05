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

export interface HalfStreamingTokenSample {
  /** Cumulative generated-token count measured by the streaming server. */
  generatedTokens?: number
  /** Milliseconds elapsed since provider dispatch began. */
  elapsedMs?: number
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
 * Record one provider token frame. Server streams can supply tokenizer-aware
 * cumulative progress so batched gateway deltas still report useful throughput;
 * local and older server streams retain the frame-counting fallback.
 */
export function recordHalfStreamingToken(
  target: HalfStreamingProgressTarget,
  now = Date.now(),
  sample?: HalfStreamingTokenSample,
): void {
  halfStreamingProgress.update((current) => {
    const active = sameTarget(current, target)
      ? current
      : {
          ...target,
          generatedTokens: 0,
          tokensPerSecond: 0,
          updatedAt: now,
        }
    const sampledTokens = sample?.generatedTokens
    const sampledElapsedMs = sample?.elapsedMs
    if (
      typeof sampledTokens === 'number' &&
      Number.isFinite(sampledTokens) &&
      sampledTokens > 0 &&
      typeof sampledElapsedMs === 'number' &&
      Number.isFinite(sampledElapsedMs) &&
      sampledElapsedMs > 0
    ) {
      const generatedTokens = Math.max(active.generatedTokens, Math.floor(sampledTokens))
      return {
        ...active,
        generatedTokens,
        tokensPerSecond: generatedTokens / (sampledElapsedMs / 1000),
        firstTokenAt: active.firstTokenAt ?? now - sampledElapsedMs,
        updatedAt: now,
      }
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
