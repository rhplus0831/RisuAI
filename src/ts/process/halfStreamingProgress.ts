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

const MAX_ACTIVE_HALF_STREAMING_PROGRESS = 16

export const halfStreamingProgress = writable<ActiveHalfStreamingProgress[]>([])

interface HalfStreamingProgressSession extends HalfStreamingProgressTarget {
  firstSample?: Required<HalfStreamingTokenSample>
  latestSample?: Required<HalfStreamingTokenSample>
}

const activeTargets = new Map<string, HalfStreamingProgressSession>()

function targetKey(target: HalfStreamingProgressTarget): string {
  return JSON.stringify([target.characterId, target.chatId, target.generationId])
}

function sameTarget(
  progress: ActiveHalfStreamingProgress,
  target: HalfStreamingProgressTarget,
): progress is ActiveHalfStreamingProgress {
  return (
    progress?.characterId === target.characterId &&
    progress.chatId === target.chatId &&
    progress.generationId === target.generationId
  )
}

function sameChat(
  target: Pick<HalfStreamingProgressTarget, 'characterId' | 'chatId'>,
  characterId: string,
  chatId: string,
): boolean {
  return target.characterId === characterId && target.chatId === chatId
}

function trimActiveTargets(): void {
  while (activeTargets.size > MAX_ACTIVE_HALF_STREAMING_PROGRESS) {
    const oldestKey = activeTargets.keys().next().value
    if (oldestKey === undefined) return
    const oldestTarget = activeTargets.get(oldestKey)
    activeTargets.delete(oldestKey)
    if (oldestTarget) {
      halfStreamingProgress.update((entries) => entries.filter((entry) => !sameTarget(entry, oldestTarget)))
    }
  }
}

export function beginHalfStreamingProgress(target: HalfStreamingProgressTarget): void {
  for (const [key, activeTarget] of activeTargets) {
    if (sameChat(activeTarget, target.characterId, target.chatId)) activeTargets.delete(key)
  }
  const key = targetKey(target)
  activeTargets.set(key, { ...target })
  halfStreamingProgress.update((entries) => [
    ...entries.filter((entry) => !sameChat(entry, target.characterId, target.chatId)),
    {
      ...target,
      generatedTokens: 0,
      tokensPerSecond: 0,
      updatedAt: Date.now(),
    },
  ])
  trimActiveTargets()
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
  const key = targetKey(target)
  if (!activeTargets.has(key)) return
  const activeTarget = activeTargets.get(key)!
  activeTargets.delete(key)
  activeTargets.set(key, activeTarget)
  halfStreamingProgress.update((current) => {
    const active = current.find((entry) => sameTarget(entry, target))
    if (!active) return current
    const sampledTokens = sample?.generatedTokens
    const sampledElapsedMs = sample?.elapsedMs
    if (
      typeof sampledTokens === 'number' &&
      Number.isFinite(sampledTokens) &&
      sampledTokens >= 0 &&
      typeof sampledElapsedMs === 'number' &&
      Number.isFinite(sampledElapsedMs) &&
      sampledElapsedMs >= 0
    ) {
      const generatedTokens = Math.floor(sampledTokens)
      const latestSample = activeTarget.latestSample
      if (
        latestSample &&
        (generatedTokens < latestSample.generatedTokens || sampledElapsedMs < latestSample.elapsedMs)
      ) {
        return current
      }
      const currentSample = { generatedTokens, elapsedMs: sampledElapsedMs }
      // Start at the first output sample, excluding prompt processing and the
      // entire first batch from both sides of the rate calculation. Server time
      // keeps buffered delivery/replay from looking faster than generation.
      if (generatedTokens > 0) activeTarget.firstSample ??= currentSample
      activeTarget.latestSample = currentSample
      const firstSample = activeTarget.firstSample
      const elapsedMs = firstSample ? sampledElapsedMs - firstSample.elapsedMs : 0
      const next = {
        ...active,
        generatedTokens,
        tokensPerSecond:
          firstSample && elapsedMs > 0 ? (generatedTokens - firstSample.generatedTokens) / (elapsedMs / 1000) : 0,
        firstTokenAt: active.firstTokenAt ?? (generatedTokens > 0 ? now : undefined),
        updatedAt: now,
      }
      return current.map((entry) => (sameTarget(entry, target) ? next : entry))
    }
    // Once tokenizer-aware progress is available, incomplete metadata must not
    // turn cumulative token totals back into frame counts.
    if (activeTarget.latestSample) return current
    const firstTokenAt = active.firstTokenAt ?? now
    const generatedTokens = active.generatedTokens + 1
    const elapsedSeconds = (now - firstTokenAt) / 1000
    const tokensPerSecond = elapsedSeconds > 0 ? (generatedTokens - 1) / elapsedSeconds : 0
    const next = {
      ...active,
      generatedTokens,
      tokensPerSecond,
      firstTokenAt,
      updatedAt: now,
    }
    return current.map((entry) => (sameTarget(entry, target) ? next : entry))
  })
}

export function clearHalfStreamingProgress(target: HalfStreamingProgressTarget): void {
  const key = targetKey(target)
  if (!activeTargets.has(key)) return
  activeTargets.delete(key)
  halfStreamingProgress.update((entries) => entries.filter((entry) => !sameTarget(entry, target)))
}

export function clearHalfStreamingProgressForChat(characterId: string, chatId: string): void {
  for (const [key, target] of activeTargets) {
    if (sameChat(target, characterId, chatId)) activeTargets.delete(key)
  }
  halfStreamingProgress.update((entries) => entries.filter((entry) => !sameChat(entry, characterId, chatId)))
}

export function resetHalfStreamingProgressForTests(): void {
  activeTargets.clear()
  halfStreamingProgress.set([])
}
