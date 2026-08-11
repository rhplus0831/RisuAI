import type { CompletionStreamFrame } from '../generation/frames.js'
import type { DoneEvent, ErrorEvent, PostGenerationFrame, PromptChatEvent } from './sseEvents.js'

export type PromptChatEmit = (event: PromptChatEvent) => void

export interface ProviderChunkTransportResult {
  status: 'done' | 'error' | 'aborted'
  result: string
  finishReason?: CompletionStreamFrame['finishReason']
  alternates?: string[]
}

export type ProviderDoneMetadata = (result: string) => Omit<DoneEvent, 'type' | 'result'> | undefined

export interface ProviderTokenProgressOptions {
  /** Wall-clock time immediately before provider dispatch. */
  startedAt: number
  /** Count tokenizer tokens in one non-empty provider delta. */
  countTokens: (content: string) => number
  /** Injectable clock for deterministic transport tests. */
  now?: () => number
}

export interface ProviderPostGenerationResult {
  frame?: PostGenerationFrame
  /** Derived primary text used by post-generation side effects such as TTS. */
  primary?: string
  /** Final per-choice text to expose on the terminal done event. */
  alternates?: readonly string[]
  /** The post-generation callback already emitted a terminal error. */
  terminalStatus?: 'error'
  /** Successful commit with deferred retry-journal cleanup. */
  persistenceDisposition?: DoneEvent['persistenceDisposition']
}

export interface ProviderChunkTransportOptions {
  doneMetadata?: ProviderDoneMetadata
  /**
   * Omit `done.result` after non-empty token frames already delivered the same
   * completion. This is safe only for a negotiated, connection-scoped stream;
   * durable/replayable transports must retain the terminal result.
   */
  omitResultWhenStreamed?: boolean
  /** Optional batching-safe token throughput metadata for half streaming. */
  tokenProgress?: ProviderTokenProgressOptions
  /** Receives post-generation primary + alternates in provider choice order. */
  sideEffects?: (results: readonly string[]) => PromptChatEvent[]
  errorRestoration?: () => ErrorEvent['restoration']
  /**
   * Server post-generation pass, run over the full completion text after the
   * stream succeeds and before the terminal `done`. Its result is folded into
   * `done.postGeneration` so derived state reaches the browser in-band.
   * Runs only on a successful completion (never on abort / error). Returns
   * `undefined` (or throws — the route callback swallows its own failures) to
   * leave `done` untouched.
   */
  postGeneration?: (
    result: string,
    alternates: readonly string[],
  ) => Promise<PostGenerationFrame | ProviderPostGenerationResult | undefined>
}

function isProviderPostGenerationResult(
  value: PostGenerationFrame | ProviderPostGenerationResult,
): value is ProviderPostGenerationResult {
  return (
    Object.prototype.hasOwnProperty.call(value, 'frame') ||
    Object.prototype.hasOwnProperty.call(value, 'primary') ||
    Object.prototype.hasOwnProperty.call(value, 'alternates') ||
    Object.prototype.hasOwnProperty.call(value, 'terminalStatus') ||
    Object.prototype.hasOwnProperty.call(value, 'persistenceDisposition')
  )
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message.length > 0) return err.message
  if (typeof err === 'string' && err.length > 0) return err
  return 'Provider stream failed before returning an error message.'
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Map provider-agnostic completion frames onto the locked `/chat` SSE taxonomy.
 * This helper defines how server-side provider chunks become chat events.
 */
export async function emitProviderChunks(
  frames: AsyncIterable<CompletionStreamFrame>,
  emit: PromptChatEmit,
  signal?: AbortSignal,
  options: ProviderChunkTransportOptions | ProviderDoneMetadata = {},
): Promise<ProviderChunkTransportResult> {
  let result = ''
  let alternates: string[] = []
  let generatedTokens = 0
  const normalizedOptions: ProviderChunkTransportOptions =
    typeof options === 'function' ? { doneMetadata: options } : options
  const emitSideEffects = (results: readonly string[]): void => {
    for (const event of normalizedOptions.sideEffects?.(results) ?? []) {
      emit(event)
    }
  }
  // Run the post-generation pass before the terminal `done`; thrown errors are
  // handled by the streaming route's provider-error path.
  const emitSuccessDone = async (): Promise<'done' | 'error'> => {
    const postGenerationResult = normalizedOptions.postGeneration
      ? await normalizedOptions.postGeneration(result, alternates)
      : undefined
    let postGeneration: PostGenerationFrame | undefined
    let primary = result
    let terminalStatus: ProviderPostGenerationResult['terminalStatus']
    let persistenceDisposition: ProviderPostGenerationResult['persistenceDisposition']
    if (postGenerationResult) {
      if (isProviderPostGenerationResult(postGenerationResult)) {
        postGeneration = postGenerationResult.frame
        primary = postGenerationResult.primary ?? postGeneration?.finalText ?? result
        alternates = [...(postGenerationResult.alternates ?? alternates)]
        terminalStatus = postGenerationResult.terminalStatus
        persistenceDisposition = postGenerationResult.persistenceDisposition
      } else {
        postGeneration = postGenerationResult as PostGenerationFrame
        primary = postGeneration.finalText ?? result
      }
    }
    if (terminalStatus === 'error') return 'error'
    emitSideEffects([primary, ...alternates])
    const omitStreamedResult = normalizedOptions.omitResultWhenStreamed === true && result.length > 0
    emit({
      type: 'done',
      ...(!omitStreamedResult ? { result } : {}),
      ...(normalizedOptions.doneMetadata?.(result) ?? {}),
      ...(alternates.length > 0 ? { alternates } : {}),
      ...(postGeneration ? { postGeneration } : {}),
      ...(persistenceDisposition ? { persistenceDisposition } : {}),
    })
    return 'done'
  }

  if (signal?.aborted) {
    return { status: 'aborted', result }
  }

  try {
    for await (const frame of frames) {
      if (signal?.aborted) {
        return { status: 'aborted', result }
      }
      if (frame.kind === 'token') {
        const content = frame.content ?? ''
        result += content
        const tokenProgress = normalizedOptions.tokenProgress
        if (content.length > 0 && tokenProgress) {
          let deltaTokens = 1
          try {
            const counted = tokenProgress.countTokens(content)
            if (Number.isFinite(counted)) deltaTokens = Math.max(1, Math.floor(counted))
          } catch {
            // Throughput telemetry must never interrupt the provider stream.
          }
          generatedTokens += deltaTokens
          const elapsedMs = Math.max(1, Math.round((tokenProgress.now?.() ?? Date.now()) - tokenProgress.startedAt))
          emit({ type: 'token', content, generatedTokens, elapsedMs })
        } else {
          emit({ type: 'token', content })
        }
        continue
      }
      if (frame.kind === 'error') {
        const providerError = nonEmptyString(frame.error) ? frame.error : undefined
        const status = typeof frame.status === 'number' ? frame.status : undefined
        const statusText = nonEmptyString(frame.statusText) ? frame.statusText : undefined
        const code = nonEmptyString(frame.code) ? frame.code : undefined
        emit({
          type: 'error',
          error: providerError ?? 'Provider stream failed without an error message.',
          reason:
            typeof frame.reason === 'string' && frame.reason.length > 0
              ? frame.reason
              : providerError
                ? 'provider_stream_error_frame'
                : 'provider_stream_error_frame_empty',
          ...(status !== undefined ? { status } : {}),
          ...(statusText ? { statusText } : {}),
          ...(code ? { code } : {}),
          restoration: normalizedOptions.errorRestoration?.(),
        })
        emit({ type: 'done', ...(normalizedOptions.doneMetadata?.(result) ?? {}) })
        return { status: 'error', result }
      }

      if (signal?.aborted) {
        return { status: 'aborted', result }
      }

      alternates = Array.isArray(frame.alternates) ? [...frame.alternates] : []
      const terminalStatus = await emitSuccessDone()
      return {
        status: terminalStatus,
        result,
        finishReason: frame.finishReason,
        ...(alternates.length > 0 ? { alternates } : {}),
      }
    }
  } catch (err) {
    if (signal?.aborted) {
      return { status: 'aborted', result }
    }
    emit({
      type: 'error',
      error: errorMessage(err),
      reason: 'provider_stream_exception',
      restoration: normalizedOptions.errorRestoration?.(),
    })
    emit({ type: 'done', ...(normalizedOptions.doneMetadata?.(result) ?? {}) })
    return { status: 'error', result }
  }

  if (signal?.aborted) {
    return { status: 'aborted', result }
  }

  const terminalStatus = await emitSuccessDone()
  return { status: terminalStatus, result }
}
