/**
 * Streaming render coalescer.
 *
 * During a streamed response every provider delta used to write the full
 * accumulated string into `message[msgIndex].data` and bump `reloadKeys`,
 * re-running `risuChatParser` + `ParseMarkdown` (markdown, CBS, display
 * scripts, sanitize) over the whole growing message — ~O(length²) total work
 * per generation. The coalescer bounds that: callers mark the newest payload
 * with `notify()`, and the expensive `apply` runs at most once per animation
 * frame, always on the newest payload. `settle()` guarantees a final
 * full-fidelity apply before the stream consumer returns.
 *
 * Invariants:
 * - `apply` runs serialized (never overlapping), each run sees the newest
 *   payload at apply time.
 * - After `settle()` resolves, the last notified payload has been applied.
 * - The first `apply` rejection is surfaced on `failed`/rethrown by `settle()`
 *   so the read loop can fail fast like the old per-chunk await did.
 */

export type RenderFlushScheduler = (flush: () => void) => void

/** Timer fallback when no `requestAnimationFrame` exists (workers, tests). */
const FRAME_FALLBACK_MS = 33

export const defaultRenderFlushScheduler: RenderFlushScheduler = (flush) => {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    globalThis.requestAnimationFrame(() => flush())
  } else {
    setTimeout(flush, FRAME_FALLBACK_MS)
  }
}

export interface StreamRenderCoalescer {
  /** A newer payload exists; schedules (at most) one frame flush. */
  notify(): void
  /** True once an `apply` has rejected; `settle()` rethrows that error. */
  readonly failed: boolean
  /**
   * Apply the newest payload now: waits for any in-flight apply, then applies
   * once more if a `notify()` arrived since. Rethrows the first apply failure.
   */
  settle(): Promise<void>
}

export function createStreamRenderCoalescer(
  apply: () => Promise<void> | void,
  schedule: RenderFlushScheduler = defaultRenderFlushScheduler,
): StreamRenderCoalescer {
  let dirty = false
  let scheduled = false
  let failure: { error: unknown } | null = null
  // Serializes applies; also what `settle()` awaits.
  let chain: Promise<void> = Promise.resolve()

  const flushNow = (): Promise<void> => {
    if (!dirty || failure !== null) return chain
    dirty = false
    chain = chain.then(async () => {
      try {
        await apply()
      } catch (error) {
        failure ??= { error }
      }
    })
    return chain
  }

  return {
    notify(): void {
      dirty = true
      if (scheduled || failure !== null) return
      scheduled = true
      schedule(() => {
        scheduled = false
        // Rejections are captured into `failure`; nothing floats unhandled.
        void flushNow()
      })
    },
    get failed(): boolean {
      return failure !== null
    },
    async settle(): Promise<void> {
      await flushNow()
      if (failure !== null) throw failure.error
    },
  }
}
