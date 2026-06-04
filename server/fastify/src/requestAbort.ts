import { PROXY_STREAM_DEFAULT_TIMEOUT_MS } from './streamJobs.js'

/**
 * Per-request abort plumbing for the non-durable generation paths (audit M8).
 *
 * The returned signal fires on client disconnect (`req.raw` close) — the
 * pre-existing behavior — and now also at a generous wall-clock deadline
 * mirroring the durable path's 600s `deadlineAt`, so buffered and streaming
 * provider work is bounded even when the client never goes away. The deadline
 * lives here, at the signal source, so every adapter inherits it instead of
 * each of the ~10 adapters carrying its own timer.
 */
export const NON_DURABLE_REQUEST_DEADLINE_MS = PROXY_STREAM_DEFAULT_TIMEOUT_MS

export interface RequestAbort {
  signal: AbortSignal
  abort: () => void
  cleanup: () => void
}

/** The `req.raw` close-event surface we need (structural, so unit tests can
 *  hand in a bare EventEmitter). */
interface CloseEmitter {
  on(event: 'close', listener: () => void): unknown
  off(event: 'close', listener: () => void): unknown
}

export function attachAbort(
  req: { raw: CloseEmitter },
  opts: { deadlineMs?: number } = {},
): RequestAbort {
  const deadlineMs = opts.deadlineMs ?? NON_DURABLE_REQUEST_DEADLINE_MS
  const controller = new AbortController()
  const onClose = (): void => controller.abort()
  req.raw.on('close', onClose)
  const deadline = setTimeout(() => controller.abort(), deadlineMs)
  // The backstop must not hold the process open on shutdown.
  deadline.unref?.()
  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    cleanup: () => {
      req.raw.off('close', onClose)
      clearTimeout(deadline)
    },
  }
}
