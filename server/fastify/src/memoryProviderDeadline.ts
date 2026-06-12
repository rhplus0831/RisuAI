export const MEMORY_PROVIDER_FETCH_DEADLINE_MS = 90_000

export function resolveMemoryProviderFetchDeadlineMs(override?: number): number {
  if (typeof override !== 'number' || !Number.isFinite(override) || override <= 0) {
    return MEMORY_PROVIDER_FETCH_DEADLINE_MS
  }
  return Math.max(1, Math.floor(override))
}

export function armMemoryProviderFetchDeadline(controller: AbortController, deadlineMs?: number): () => void {
  const timer = setTimeout(() => controller.abort(), resolveMemoryProviderFetchDeadlineMs(deadlineMs))
  timer.unref?.()
  return () => clearTimeout(timer)
}
