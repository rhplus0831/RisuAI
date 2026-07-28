import { stripInternalReasoning } from '../../../../src/ts/process/internalReasoning.js'
import type { CompletionStreamFrame } from './frames.js'

function stripText(text: string): string {
  return stripInternalReasoning(text, { preserveUnchanged: true })
}

/**
 * Buffer one provider completion so known reasoning blocks never reach a
 * streaming consumer before they can be recognized across chunk boundaries.
 */
export async function* stripCoTFromCompletionFrames(
  frames: AsyncIterable<CompletionStreamFrame>,
): AsyncGenerator<CompletionStreamFrame> {
  let content = ''

  const visibleContent = (): CompletionStreamFrame | undefined => {
    const visible = stripText(content)
    content = ''
    return visible.length > 0 ? { kind: 'token', content: visible } : undefined
  }

  for await (const frame of frames) {
    if (frame.kind === 'token') {
      content += frame.content ?? ''
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

  const visible = visibleContent()
  if (visible) yield visible
}
