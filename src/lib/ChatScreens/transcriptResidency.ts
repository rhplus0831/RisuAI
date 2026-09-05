export const TRANSCRIPT_WORKING_ROWS = 60
export const TRANSCRIPT_MAX_RESIDENT_ROWS = 76
export const TRANSCRIPT_HEIGHT_ENTRIES = 2048
export const TRANSCRIPT_ESTIMATED_ROW_HEIGHT = 360

/** Geometry belongs to the displayed chat, never to the hydrated message owner. */
export class TranscriptHeightCache {
  private readonly entries = new Map<string, number>()

  get size() {
    return this.entries.size
  }

  get(id: string): number {
    return this.entries.get(id) ?? TRANSCRIPT_ESTIMATED_ROW_HEIGHT
  }

  set(id: string, height: number): boolean {
    if (!Number.isFinite(height) || height < 0 || id.length > 2048) return false
    const previous = this.entries.get(id)
    // Keep fractional CSS pixels; cumulative rounding otherwise moves anchors.
    this.entries.delete(id)
    this.entries.set(id, height)
    while (this.entries.size > TRANSCRIPT_HEIGHT_ENTRIES) {
      this.entries.delete(this.entries.keys().next().value!)
    }
    return previous === undefined || Math.abs(previous - height) > 0.01
  }

  clear() {
    this.entries.clear()
  }
}

export function transcriptRowOffsets(ids: readonly string[], heights: TranscriptHeightCache): number[] {
  const offsets = [0]
  for (const id of ids) offsets.push(offsets[offsets.length - 1] + heights.get(id))
  return offsets
}

/** Coordinates increase from the newest row toward older history (reverse flex). */
export function transcriptRowAtOffset(offsets: readonly number[], offset: number): number {
  let low = 0
  let high = Math.max(0, offsets.length - 2)
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (offsets[middle + 1] <= offset) low = middle + 1
    else high = middle
  }
  return low
}

export type TranscriptResidencyEntry<T> =
  | { key: string; kind: 'row'; row: T; id: string }
  | { key: string; kind: 'spacer'; height: number; start: number; end: number }

export function buildTranscriptResidency<T extends { key: string }>(
  rows: readonly T[],
  ids: readonly string[],
  offsets: readonly number[],
  start: number,
  pinned: ReadonlySet<string>,
  full: boolean,
): TranscriptResidencyEntry<T>[] {
  // Transitional generation can briefly expose old/new presentation IDs
  // together. Protected owners consume the shared row budget before the
  // working window, so that overlap never increases the hard limit.
  const workingRows = Math.max(0, Math.min(TRANSCRIPT_WORKING_ROWS, TRANSCRIPT_MAX_RESIDENT_ROWS - pinned.size))
  const windowStart = Math.max(0, Math.min(start, rows.length - workingRows))
  const windowEnd = windowStart + workingRows
  const entries: TranscriptResidencyEntry<T>[] = []
  let gapStart = -1
  function flushGap(end: number) {
    if (gapStart < 0) return
    entries.push({
      key: `spacer:${ids[gapStart]}`,
      kind: 'spacer',
      height: offsets[end] - offsets[gapStart],
      start: gapStart,
      end,
    })
    gapStart = -1
  }
  for (let index = 0; index < rows.length; index++) {
    if (full || (index >= windowStart && index < windowEnd) || pinned.has(ids[index])) {
      flushGap(index)
      entries.push({ key: rows[index].key, kind: 'row', row: rows[index], id: ids[index] })
    } else if (gapStart < 0) gapStart = index
  }
  flushGap(rows.length)
  return entries
}
