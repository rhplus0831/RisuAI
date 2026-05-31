/**
 * Shared SSE frame parsing for the server-backed generation adapters.
 *
 * The Fastify generation routes encode each event as one `event: <name>`
 * line plus one or more `data: <chunk>` lines, terminated by a blank line
 * (`\n\n`). Both `/completion` (`serverCompletion.ts`) and `/chat`
 * (`serverChat.ts`) decode that same wire shape, so the block parser lives here
 * once.
 */

export interface ParsedSseEvent {
  event: string
  data: string
  id?: string
}

/** Parse one SSE block (text between blank-line separators) into its event name + data. */
export function parseSseEvent(block: string): ParsedSseEvent {
  let event = 'message'
  let id: string | undefined
  const dataLines: string[] = []

  for (const line of normalizeSseLineEndings(block).split('\n')) {
    if (line.length === 0 || line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    let value = separator === -1 ? '' : line.slice(separator + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    if (field === 'event') event = value.trim()
    else if (field === 'data') dataLines.push(value)
    else if (field === 'id') id = value
  }

  return {
    event,
    data: dataLines.join('\n'),
    ...(id !== undefined ? { id } : {}),
  }
}

/**
 * Read an SSE response body and yield decoded `{ event, data }` frames as
 * they arrive. Honors `signal`: an abort cancels the underlying reader and
 * ends iteration. The caller decides what each event name means.
 */
export async function* iterateSseEvents(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | null,
): AsyncGenerator<ParsedSseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let aborted = false

  const cancel = (): void => {
    aborted = true
    reader.cancel().catch(() => {
      // swallow
    })
  }
  const onAbort = (): void => cancel()
  if (signal) {
    if (signal.aborted) cancel()
    else signal.addEventListener('abort', onAbort, { once: true })
  }

  try {
    while (!aborted) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let separator = findSseSeparator(buf)
      while (separator) {
        const block = buf.slice(0, separator.index)
        buf = buf.slice(separator.index + separator.length)
        yield parseSseEvent(block)
        separator = findSseSeparator(buf)
      }
    }

    buf += decoder.decode()
    if (!aborted && buf.trim().length > 0) {
      yield parseSseEvent(buf)
    }
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

function normalizeSseLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function findSseSeparator(value: string): { index: number; length: number } | null {
  let best: { index: number; length: number } | null = null
  for (const separator of ['\r\n\r\n', '\n\n', '\r\r']) {
    const index = value.indexOf(separator)
    if (index !== -1 && (best === null || index < best.index)) {
      best = { index, length: separator.length }
    }
  }
  return best
}
