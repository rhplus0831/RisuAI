import { applyAdditionalParameters } from './additionalParams.js'
import type { CompletionResult, CompletionStreamFrame } from './frames.js'

export interface EchoRequest {
  message: string
  delayMs: number
  signal: AbortSignal
}

export type EchoResult = CompletionResult
export type EchoStreamFrame = CompletionStreamFrame

const DEFAULT_MESSAGE = 'Echo Message'

export function resolveEchoRequest(input: {
  message?: unknown
  delayMs?: unknown
  additionalParams?: Array<[string, string]>
  signal: AbortSignal
}): EchoRequest {
  const message = typeof input.message === 'string' ? input.message : DEFAULT_MESSAGE
  const delayMs =
    typeof input.delayMs === 'number' && Number.isFinite(input.delayMs) && input.delayMs > 0 ? input.delayMs : 0
  const body: Record<string, unknown> = { message, delayMs }
  if (input.additionalParams !== undefined && input.additionalParams.length > 0) {
    applyAdditionalParameters(body, {}, input.additionalParams)
  }
  return {
    message: typeof body.message === 'string' ? body.message : message,
    delayMs: typeof body.delayMs === 'number' && Number.isFinite(body.delayMs) && body.delayMs > 0 ? body.delayMs : 0,
    signal: input.signal,
  }
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

export async function* runEchoStream(req: EchoRequest): AsyncGenerator<EchoStreamFrame, void, void> {
  if (req.signal.aborted) return
  const { aborted } = await delay(req.delayMs, req.signal)
  if (aborted) return
  yield { kind: 'token', content: req.message }
  yield { kind: 'done', finishReason: 'stop' }
}
