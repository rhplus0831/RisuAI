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

export interface ProviderPostGenerationResult {
  frame?: PostGenerationFrame
  /** Final per-choice text to expose on the terminal done event. */
  alternates?: readonly string[]
}

export interface ProviderChunkTransportOptions {
  doneMetadata?: ProviderDoneMetadata
  sideEffects?: (result: string) => PromptChatEvent[]
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
    Object.prototype.hasOwnProperty.call(value, 'frame') || Object.prototype.hasOwnProperty.call(value, 'alternates')
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
  const normalizedOptions: ProviderChunkTransportOptions =
    typeof options === 'function' ? { doneMetadata: options } : options
  const emitSideEffects = (): void => {
    for (const event of normalizedOptions.sideEffects?.(result) ?? []) {
      emit(event)
    }
  }
  // Run the post-generation pass before the terminal `done`; thrown errors are
  // handled by the streaming route's provider-error path.
  const emitSuccessDone = async (): Promise<void> => {
    emitSideEffects()
    const postGenerationResult = normalizedOptions.postGeneration
      ? await normalizedOptions.postGeneration(result, alternates)
      : undefined
    let postGeneration: PostGenerationFrame | undefined
    if (postGenerationResult) {
      if (isProviderPostGenerationResult(postGenerationResult)) {
        postGeneration = postGenerationResult.frame
        alternates = [...(postGenerationResult.alternates ?? alternates)]
      } else {
        postGeneration = postGenerationResult as PostGenerationFrame
      }
    }
    emit({
      type: 'done',
      result,
      ...(normalizedOptions.doneMetadata?.(result) ?? {}),
      ...(alternates.length > 0 ? { alternates } : {}),
      ...(postGeneration ? { postGeneration } : {}),
    })
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
        emit({ type: 'token', content })
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
      await emitSuccessDone()
      return {
        status: 'done',
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

  await emitSuccessDone()
  return { status: 'done', result }
}
