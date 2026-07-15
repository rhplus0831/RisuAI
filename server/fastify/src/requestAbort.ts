import { PROXY_STREAM_DEFAULT_TIMEOUT_MS, normalizeStreamTimeoutMs } from './streamJobs.js'

/**
 * Per-request abort plumbing for the non-durable generation paths.
 *
 * The returned signal fires on client disconnect and at a generous sliding
 * deadline mirroring the durable path's bounded timeout window,
 * so buffered and streaming provider work is bounded even when the client never
 * goes away. The deadline lives here,
 * at the signal source, so every adapter inherits it instead of each of the ~10
 * adapters carrying its own timer.
 */
export const NON_DURABLE_REQUEST_DEADLINE_MS = PROXY_STREAM_DEFAULT_TIMEOUT_MS

export interface RequestAbort {
  signal: AbortSignal
  refresh: () => void
  abort: () => void
  cleanup: () => void
}

interface CloseEmitter {
  on(event: 'close', listener: () => void): unknown
  off(event: 'close', listener: () => void): unknown
}

/** Structural request/reply close-event surfaces so unit tests can use bare
 * EventEmitters while production passes Fastify's IncomingMessage/ServerResponse. */
interface RequestCloseEmitter extends CloseEmitter {
  complete: boolean
}

interface ResponseCloseEmitter extends CloseEmitter {
  writableEnded: boolean
}

function createDeadlineAbort(opts: { deadlineMs?: number } = {}): RequestAbort {
  const deadlineMs = normalizeStreamTimeoutMs(opts.deadlineMs ?? NON_DURABLE_REQUEST_DEADLINE_MS)
  const controller = new AbortController()
  const armDeadline = (): ReturnType<typeof setTimeout> => {
    const deadline = setTimeout(() => controller.abort(), deadlineMs)
    // The backstop must not hold the process open on shutdown.
    deadline.unref?.()
    return deadline
  }
  let deadline = armDeadline()
  const refresh = (): void => {
    if (controller.signal.aborted) return
    clearTimeout(deadline)
    deadline = armDeadline()
  }
  return {
    signal: controller.signal,
    refresh,
    abort: () => controller.abort(),
    cleanup: () => {
      clearTimeout(deadline)
    },
  }
}

export function createDetachedAbort(opts: { deadlineMs?: number } = {}): RequestAbort {
  return createDeadlineAbort(opts)
}

export function attachAbort(
  req: { raw: RequestCloseEmitter },
  reply: { raw: ResponseCloseEmitter },
  opts: { deadlineMs?: number } = {},
): RequestAbort {
  const requestAbort = createDeadlineAbort(opts)
  const onRequestClose = (): void => {
    if (!req.raw.complete) requestAbort.abort()
  }
  const onResponseClose = (): void => {
    if (!reply.raw.writableEnded) requestAbort.abort()
  }
  req.raw.on('close', onRequestClose)
  reply.raw.on('close', onResponseClose)
  return {
    ...requestAbort,
    cleanup: () => {
      req.raw.off('close', onRequestClose)
      reply.raw.off('close', onResponseClose)
      requestAbort.cleanup()
    },
  }
}
