/**
 * Shared SSE frame parsing for the server-backed generation adapters.
 *
 * The Fastify generation routes encode each event as one `event: <name>`
 * line plus one or more `data: <chunk>` lines, terminated by a blank line
 * (`\n\n`). Both `/completion` (`serverCompletion.ts`) and `/chat`
 * (`serverChat.ts`) decode that same wire shape, so the block parser lives here
 * once.
 */

/** Parse one SSE block (text between `\n\n` separators) into its event name + data. */
export function parseSseEvent(block: string): { event: string; data: string } {
  let event = 'message'
  let data = ''
  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim()
    else if (line.startsWith('data: ')) data += line.slice(6)
  }
  return { event, data }
}

/**
 * Read an SSE response body and yield decoded `{ event, data }` frames as
 * they arrive. Honors `signal`: an abort cancels the underlying reader and
 * ends iteration. The caller decides what each event name means.
 */
export async function* iterateSseEvents(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | null,
): AsyncGenerator<{ event: string; data: string }> {
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
      let sepIdx = buf.indexOf('\n\n')
      while (sepIdx !== -1) {
        const block = buf.slice(0, sepIdx)
        buf = buf.slice(sepIdx + 2)
        yield parseSseEvent(block)
        sepIdx = buf.indexOf('\n\n')
      }
    }
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}
