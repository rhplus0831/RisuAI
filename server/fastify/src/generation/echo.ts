export interface EchoRequest {
  message: string
  delayMs: number
  signal: AbortSignal
}

export interface EchoResult {
  type: 'success' | 'fail'
  result: string
  aborted?: boolean
}

export interface EchoStreamFrame {
  kind: 'token' | 'done'
  content?: string
  finishReason?: 'stop'
}

const DEFAULT_MESSAGE = 'Echo Message'

export function resolveEchoRequest(input: {
  message?: unknown
  delayMs?: unknown
  signal: AbortSignal
}): EchoRequest {
  const message = typeof input.message === 'string' ? input.message : DEFAULT_MESSAGE
  const delayMs =
    typeof input.delayMs === 'number' && Number.isFinite(input.delayMs) && input.delayMs > 0
      ? input.delayMs
      : 0
  return { message, delayMs, signal: input.signal }
}

function delay(ms: number, signal: AbortSignal): Promise<{ aborted: boolean }> {
  if (ms <= 0) return Promise.resolve({ aborted: signal.aborted })
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve({ aborted: false })
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve({ aborted: true })
    }
    if (signal.aborted) {
      clearTimeout(timer)
      resolve({ aborted: true })
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export async function runEcho(req: EchoRequest): Promise<EchoResult> {
  if (req.signal.aborted) {
    return { type: 'fail', result: 'aborted', aborted: true }
  }
  const { aborted } = await delay(req.delayMs, req.signal)
  if (aborted) {
    return { type: 'fail', result: 'aborted', aborted: true }
  }
  return { type: 'success', result: req.message }
}

export async function* runEchoStream(
  req: EchoRequest,
): AsyncGenerator<EchoStreamFrame, void, void> {
  if (req.signal.aborted) return
  const { aborted } = await delay(req.delayMs, req.signal)
  if (aborted) return
  yield { kind: 'token', content: req.message }
  yield { kind: 'done', finishReason: 'stop' }
}
