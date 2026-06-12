export const STREAM_CLIENT_MAX_BUFFERED_BYTES = 2 * 1024 * 1024

type WritableLike = NodeJS.WritableStream & {
  readonly writableEnded?: boolean
  readonly writableLength?: number
}

interface BoundedWriteOptions {
  maxBufferedBytes?: number
  onOverflow?: () => void
}

export function getWritableBufferedBytes(raw: WritableLike): number {
  return typeof raw.writableLength === 'number' ? Math.max(0, raw.writableLength) : 0
}

export function isWritableEnded(raw: WritableLike): boolean {
  return raw.writableEnded === true
}

export function wouldExceedStreamBuffer(
  raw: WritableLike,
  text: string,
  maxBufferedBytes = STREAM_CLIENT_MAX_BUFFERED_BYTES,
): boolean {
  return getWritableBufferedBytes(raw) + Buffer.byteLength(text) > maxBufferedBytes
}

export function closeWritable(raw: WritableLike): void {
  try {
    if (!isWritableEnded(raw)) {
      raw.end()
    }
  } catch {
    // Closing a slow consumer is best-effort and must not affect domain work.
  }
}

export function writeBoundedRaw(raw: WritableLike, text: string, options: BoundedWriteOptions = {}): boolean {
  if (isWritableEnded(raw)) return false
  const maxBufferedBytes = options.maxBufferedBytes ?? STREAM_CLIENT_MAX_BUFFERED_BYTES
  if (wouldExceedStreamBuffer(raw, text, maxBufferedBytes)) {
    options.onOverflow?.()
    closeWritable(raw)
    return false
  }
  raw.write(text)
  return true
}
