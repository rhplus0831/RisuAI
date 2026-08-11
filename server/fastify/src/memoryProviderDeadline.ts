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

export function createMemoryProviderAbortScope(
  parentSignal?: AbortSignal,
  deadlineMs?: number,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const forwardParentAbort = (): void => controller.abort(parentSignal?.reason)
  if (parentSignal?.aborted) {
    forwardParentAbort()
  } else {
    parentSignal?.addEventListener('abort', forwardParentAbort, { once: true })
  }
  const clearDeadline = armMemoryProviderFetchDeadline(controller, deadlineMs)
  return {
    signal: controller.signal,
    dispose: () => {
      clearDeadline()
      parentSignal?.removeEventListener('abort', forwardParentAbort)
    },
  }
}

export function throwIfMemoryProviderAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error('memory provider request aborted')
}
