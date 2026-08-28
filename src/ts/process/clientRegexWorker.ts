import { executeRegexWorkerRequest, type RegexWorkerRequest, type RegexWorkerResult } from './regexWorkerRuntime'

interface RegexWorkerLike {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
  postMessage(message: unknown): void
  terminate(): void
}

interface PendingRegexOperation {
  resolve(result: RegexWorkerResult): void
  reject(error: Error): void
  timeout: ReturnType<typeof setTimeout>
}

type RegexWorkerFactory = () => RegexWorkerLike

const DEFAULT_REGEX_TIMEOUT_MS = 15_000
const MAX_REGEX_TIMEOUT_MS = 10 * 60 * 1_000

let workerFactoryOverride: RegexWorkerFactory | null = null
let activeWorker: RegexWorkerLike | null = null
let nextRequestId = 1
const pendingOperations = new Map<number, PendingRegexOperation>()

function defaultWorkerFactory(): RegexWorkerLike | null {
  if (typeof Worker === 'undefined') return null
  return new Worker(new URL('./regex.worker.ts', import.meta.url), { type: 'module' })
}

function discardWorker(error: Error): void {
  activeWorker?.terminate()
  activeWorker = null
  for (const pending of pendingOperations.values()) {
    clearTimeout(pending.timeout)
    pending.reject(error)
  }
  pendingOperations.clear()
}

function ensureWorker(): RegexWorkerLike | null {
  if (activeWorker) return activeWorker
  const worker = workerFactoryOverride?.() ?? defaultWorkerFactory()
  if (!worker) return null

  worker.addEventListener('message', (event) => {
    const response = event.data as { id?: number; ok?: boolean; result?: RegexWorkerResult; error?: string }
    if (typeof response.id !== 'number') return
    const pending = pendingOperations.get(response.id)
    if (!pending) return
    pendingOperations.delete(response.id)
    clearTimeout(pending.timeout)
    if (response.ok && response.result) pending.resolve(response.result)
    else pending.reject(new Error(`client regex worker failed: ${response.error ?? 'unknown error'}`))
  })
  worker.addEventListener('error', (event) => {
    discardWorker(new Error(`client regex worker failed: ${event.message || 'unknown worker error'}`))
  })
  activeWorker = worker
  return worker
}

export function normalizeClientRegexTimeout(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_REGEX_TIMEOUT_MS
  return Math.max(1, Math.min(MAX_REGEX_TIMEOUT_MS, Math.floor(value)))
}

export async function runClientRegexWorker(request: RegexWorkerRequest, timeoutMs: number): Promise<RegexWorkerResult> {
  const worker = ensureWorker()
  if (!worker) {
    if (import.meta.env.MODE === 'test') return executeRegexWorkerRequest(request)
    throw new Error('client regex worker is unavailable')
  }

  const id = nextRequestId++
  return new Promise<RegexWorkerResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!pendingOperations.has(id)) return
      discardWorker(new Error(`client regex worker timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    pendingOperations.set(id, { resolve, reject, timeout })
    try {
      worker.postMessage({ id, request })
    } catch (error) {
      pendingOperations.delete(id)
      clearTimeout(timeout)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

function unexpectedResult(expected: RegexWorkerRequest['operation'], actual: RegexWorkerResult): never {
  throw new Error(`client regex worker returned ${actual.operation} for ${expected}`)
}

export async function testClientRegex(
  pattern: string,
  flags: string,
  source: string,
  timeoutMs: number,
): Promise<boolean> {
  const result = await runClientRegexWorker({ operation: 'test', pattern, flags, source }, timeoutMs)
  return result.operation === 'test' ? result.matched : unexpectedResult('test', result)
}

export async function replaceClientRegex(
  pattern: string,
  flags: string,
  source: string,
  replacement: string,
  timeoutMs: number,
): Promise<string> {
  const result = await runClientRegexWorker({ operation: 'replace', pattern, flags, source, replacement }, timeoutMs)
  return result.operation === 'replace' ? result.result : unexpectedResult('replace', result)
}

export async function testReplaceClientRegex(
  pattern: string,
  flags: string,
  source: string,
  replacement: string,
  timeoutMs: number,
): Promise<{ matched: boolean; result: string }> {
  const result = await runClientRegexWorker(
    { operation: 'testReplace', pattern, flags, source, replacement },
    timeoutMs,
  )
  return result.operation === 'testReplace' ? result : unexpectedResult('testReplace', result)
}

export async function testMoveClientRegex(
  pattern: string,
  flags: string,
  source: string,
  replacement: string,
  toTop: boolean,
  timeoutMs: number,
): Promise<{ matched: boolean; result: string }> {
  const result = await runClientRegexWorker(
    { operation: 'testMove', pattern, flags, source, replacement, toTop },
    timeoutMs,
  )
  return result.operation === 'testMove' ? result : unexpectedResult('testMove', result)
}

export async function matchFirstClientRegex(
  pattern: string,
  flags: string,
  source: string,
  timeoutMs: number,
): Promise<string | null> {
  const result = await runClientRegexWorker({ operation: 'matchFirst', pattern, flags, source }, timeoutMs)
  return result.operation === 'matchFirst' ? result.match : unexpectedResult('matchFirst', result)
}

export function setClientRegexWorkerFactoryForTesting(factory: RegexWorkerFactory | null): void {
  discardWorker(new Error('client regex worker reset'))
  workerFactoryOverride = factory
}
