import type { CompletionStreamFrame } from '../generation/frames.js'
import type {
  DoneEvent,
  ErrorEvent,
  PostGenerationFrame,
  PromptChatEvent,
} from './sseEvents.js'

export type PromptChatEmit = (event: PromptChatEvent) => void

export interface ProviderChunkTransportResult {
  status: 'done' | 'error' | 'aborted'
  result: string
  finishReason?: CompletionStreamFrame['finishReason']
}

export type ProviderDoneMetadata = (
  result: string,
) => Omit<DoneEvent, 'type' | 'result'> | undefined

export interface ProviderChunkTransportOptions {
  doneMetadata?: ProviderDoneMetadata
  sideEffects?: (result: string) => PromptChatEvent[]
  errorRestoration?: () => ErrorEvent['restoration']
  /**
   * Slice 4 (A2): the server post-generation pass, run over the full completion
   * text after the stream succeeds and **before** the terminal `done`. Its
   * result is folded into the `done` frame's `postGeneration` field so the
   * derived scriptstate delta / final text / resend reach the browser in-band.
   * Runs only on a successful completion (never on abort / error). Returns
   * `undefined` (or throws — the route callback swallows its own failures) to
   * leave `done` untouched.
   */
  postGeneration?: (result: string) => Promise<PostGenerationFrame | undefined>
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message.length > 0) return err.message
  if (typeof err === 'string' && err.length > 0) return err
  return 'provider dispatch failed'
}

/**
 * Phase 7-12d-iii-a: map provider-agnostic completion frames onto the
 * locked `/chat` SSE taxonomy. The browser send path is wired later; this
 * helper only defines how server-side provider chunks become chat events.
 */
export async function emitProviderChunks(
  frames: AsyncIterable<CompletionStreamFrame>,
  emit: PromptChatEmit,
  signal?: AbortSignal,
  options: ProviderChunkTransportOptions | ProviderDoneMetadata = {},
): Promise<ProviderChunkTransportResult> {
  let result = ''
  const normalizedOptions: ProviderChunkTransportOptions =
    typeof options === 'function' ? { doneMetadata: options } : options
  const emitSideEffects = (): void => {
    for (const event of normalizedOptions.sideEffects?.(result) ?? []) {
      emit(event)
    }
  }
  // Slice 4 (A2): run the post-generation pass, then emit the terminal `done` with
  // its derivation folded in. Only the success paths call this; error/abort paths
  // emit a bare `done` (no post-gen). The route's callback owns its own try/catch,
  // so a post-gen failure degrades to a plain `done` rather than failing the send.
  const emitSuccessDone = async (): Promise<void> => {
    emitSideEffects()
    const postGeneration = normalizedOptions.postGeneration
      ? await normalizedOptions.postGeneration(result)
      : undefined
    emit({
      type: 'done',
      result,
      ...(normalizedOptions.doneMetadata?.(result) ?? {}),
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
        emit({
          type: 'error',
          error: frame.error ?? 'provider stream failed',
          restoration: normalizedOptions.errorRestoration?.(),
        })
        emit({ type: 'done', ...(normalizedOptions.doneMetadata?.(result) ?? {}) })
        return { status: 'error', result }
      }

      await emitSuccessDone()
      return {
        status: 'done',
        result,
        finishReason: frame.finishReason,
      }
    }
  } catch (err) {
    if (signal?.aborted) {
      return { status: 'aborted', result }
    }
    emit({
      type: 'error',
      error: errorMessage(err),
      restoration: normalizedOptions.errorRestoration?.(),
    })
    emit({ type: 'done', ...(normalizedOptions.doneMetadata?.(result) ?? {}) })
    return { status: 'error', result }
  }

  await emitSuccessDone()
  return { status: 'done', result }
}
