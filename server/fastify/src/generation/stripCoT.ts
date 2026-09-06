import { createInternalReasoningStream, stripInternalReasoning } from '@risuai/shared-core/internal-reasoning'
import type { CompletionStreamFrame } from './frames.js'

function stripText(text: string): string {
  return stripInternalReasoning(text, { preserveUnchanged: true })
}

/** Filter before history and downstream consumers; progress never carries hidden text. */
export async function* stripCoTFromCompletionFrames(
  frames: AsyncIterable<CompletionStreamFrame>,
  options: { buffered?: boolean; countTokens?: (content: string) => number } = {},
): AsyncGenerator<CompletionStreamFrame> {
  const filter = createInternalReasoningStream()
  let content = ''

  const visibleContent = (): CompletionStreamFrame | undefined => {
    const visible = options.buffered ? stripText(content) : filter.finish()
    content = ''
    return visible.length > 0
      ? { kind: 'token', content: visible, ...(options.countTokens ? { tokenCount: 0 } : {}) }
      : undefined
  }

  try {
    for await (const frame of frames) {
      if (frame.kind === 'token') {
        const raw = frame.content ?? ''
        let tokenCount: number | undefined
        if (options.countTokens) {
          tokenCount = raw.length > 0 ? 1 : 0
          if (raw.length > 0) {
            try {
              const counted = options.countTokens(raw)
              if (Number.isFinite(counted)) tokenCount = Math.max(1, Math.floor(counted))
            } catch {
              // Progress cannot interrupt a valid provider response.
            }
          }
        }
        const visible = options.buffered ? '' : filter.push(raw)
        if (options.buffered) content += raw
        if (visible.length > 0 || (tokenCount ?? 0) > 0) {
          yield { kind: 'token', content: visible, ...(tokenCount !== undefined ? { tokenCount } : {}) }
        }
        continue
      }

      const visible = visibleContent()
      if (visible) yield visible

      if (frame.kind === 'done' && frame.alternates) {
        yield { ...frame, alternates: frame.alternates.map(stripText) }
      } else {
        yield frame
      }
    }
  } catch (error) {
    const visible = visibleContent()
    if (visible) yield visible
    throw error
  }

  const visible = visibleContent()
  if (visible) yield visible
}
