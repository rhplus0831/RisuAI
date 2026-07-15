export interface BeforeTTSContext {
  text: string
  ttsMode: string
  characterId: string
}

export interface BeforeTTSResult {
  text?: string
  skip?: boolean
}

export interface AfterTTSContext {
  audio: ArrayBuffer
  mimeType: string
  ttsMode: string
  characterId: string
}

export interface AfterTTSResult {
  audio?: ArrayBuffer
  mimeType?: string
  skip?: boolean
}

export type TTSHookFn<Ctx, Res> = (ctx: Ctx) => Promise<Res | void> | Res | void

export interface TTSHookPipelineOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

const preprocessors: TTSHookFn<BeforeTTSContext, BeforeTTSResult>[] = []
const postprocessors: TTSHookFn<AfterTTSContext, AfterTTSResult>[] = []

export function registerTTSPreprocessor(fn: TTSHookFn<BeforeTTSContext, BeforeTTSResult>): void {
  preprocessors.push(fn)
}

export function unregisterTTSPreprocessor(fn: TTSHookFn<BeforeTTSContext, BeforeTTSResult>): void {
  const idx = preprocessors.indexOf(fn)
  if (idx !== -1) preprocessors.splice(idx, 1)
}

export function registerTTSPostprocessor(fn: TTSHookFn<AfterTTSContext, AfterTTSResult>): void {
  postprocessors.push(fn)
}

export function unregisterTTSPostprocessor(fn: TTSHookFn<AfterTTSContext, AfterTTSResult>): void {
  const idx = postprocessors.indexOf(fn)
  if (idx !== -1) postprocessors.splice(idx, 1)
}

export function getTTSPreprocessors(): ReadonlyArray<TTSHookFn<BeforeTTSContext, BeforeTTSResult>> {
  // Defensive copy: callers iterate over this while hooks may be registered
  // or unregistered mid-flight (e.g. a plugin unloading). Handing out the
  // backing array would let such mutations skip or duplicate iterations.
  return preprocessors.slice()
}

export function getTTSPostprocessors(): ReadonlyArray<TTSHookFn<AfterTTSContext, AfterTTSResult>> {
  return postprocessors.slice()
}

export async function runHookPipeline<Ctx extends object, Res extends { skip?: boolean }>(
  hooks: ReadonlyArray<TTSHookFn<Ctx, Res>>,
  ctx: Ctx,
  timeoutOrOptions?: number | TTSHookPipelineOptions,
): Promise<{ ctx: Ctx; skip: boolean; aborted: boolean }> {
  const TIMEOUT = Symbol('TIMEOUT')
  const ABORTED = Symbol('ABORTED')
  const options = typeof timeoutOrOptions === 'number' ? { timeoutMs: timeoutOrOptions } : (timeoutOrOptions ?? {})
  let current: Ctx = { ...ctx }

  for (const hook of hooks) {
    if (options.signal?.aborted) {
      return { ctx: current, skip: true, aborted: true }
    }

    let result: Res | void | typeof TIMEOUT | typeof ABORTED
    let timeout: ReturnType<typeof setTimeout> | undefined
    let removeAbortListener = () => {}
    try {
      const hookPromise = Promise.resolve().then(() => hook(current))
      const races: Array<Promise<Res | void | typeof TIMEOUT | typeof ABORTED>> = [hookPromise]
      if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
        races.push(
          new Promise((resolve) => {
            timeout = setTimeout(() => resolve(TIMEOUT), options.timeoutMs)
          }),
        )
      }
      if (options.signal) {
        races.push(
          new Promise((resolve) => {
            const onAbort = () => resolve(ABORTED)
            options.signal?.addEventListener('abort', onAbort, { once: true })
            removeAbortListener = () => options.signal?.removeEventListener('abort', onAbort)
            if (options.signal?.aborted) onAbort()
          }),
        )
      }
      result = await Promise.race(races)
    } catch (err) {
      console.error('[TTS hook] threw, continuing with next hook:', err)
      continue
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
      removeAbortListener()
    }

    if (result === ABORTED) {
      return { ctx: current, skip: true, aborted: true }
    }

    if (result === TIMEOUT) {
      console.error('[TTS hook] timed out, continuing with next hook')
      continue
    }

    if (!result) continue

    if (result.skip) {
      return { ctx: current, skip: true, aborted: false }
    }

    for (const key of Object.keys(result) as (keyof Res)[]) {
      if (key === 'skip') continue
      const v = (result as any)[key]
      if (v !== undefined) (current as any)[key] = v
    }
  }

  return { ctx: current, skip: false, aborted: false }
}
