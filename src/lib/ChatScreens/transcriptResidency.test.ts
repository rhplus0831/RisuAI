import { describe, expect, it } from 'vitest'
import {
  buildTranscriptResidency,
  TranscriptHeightCache,
  TRANSCRIPT_HEIGHT_ENTRIES,
  TRANSCRIPT_MAX_RESIDENT_ROWS,
  transcriptRowAtOffset,
  transcriptRowOffsets,
} from './transcriptResidency'

describe('transcript residency geometry', () => {
  it('bounds ordinary traversal independently of history and accounts for every omitted pixel', () => {
    for (const count of [30, 180, 600, 10000]) {
      const rows = Array.from({ length: count }, (_, index) => ({ key: `row-${index}` }))
      const ids = rows.map((row) => row.key)
      const heights = new TranscriptHeightCache()
      ids.slice(0, 600).forEach((id, index) => heights.set(id, 20.125 + (index % 700)))
      const offsets = transcriptRowOffsets(ids, heights)
      for (const start of [0, 60, 155, 550, 9950]) {
        const pins = new Set(ids.slice(0, 16))
        const entries = buildTranscriptResidency(rows, ids, offsets, start, pins, false)
        const resident = entries.filter((entry) => entry.kind === 'row')
        expect(resident.length).toBeLessThanOrEqual(TRANSCRIPT_MAX_RESIDENT_ROWS)
        expect(new Set(resident.map((entry) => entry.id)).size).toBe(resident.length)
        for (const id of pins) expect(resident.some((entry) => entry.id === id)).toBe(true)
        expect(
          entries.reduce((sum, entry) => sum + (entry.kind === 'row' ? heights.get(entry.id) : entry.height), 0),
        ).toBe(offsets.at(-1))
      }
    }
  })

  it('absorbs overlapping old/new generation identities within the same hard row budget', () => {
    const rows = Array.from({ length: 600 }, (_, index) => ({ key: `id-${index}` }))
    const ids = rows.map((row) => row.key)
    const offsets = transcriptRowOffsets(ids, new TranscriptHeightCache())
    const pins = new Set(ids.slice(0, 18))
    const entries = buildTranscriptResidency(rows, ids, offsets, 100, pins, false)
    const resident = entries.filter((entry) => entry.kind === 'row')
    expect(resident).toHaveLength(76)
    for (const id of pins) expect(resident.some((entry) => entry.id === id)).toBe(true)
    expect(resident.filter((entry) => !pins.has(entry.id))).toHaveLength(58)
  })

  it('keeps a finite measurement cache and restores estimates on width/chat reset', () => {
    const heights = new TranscriptHeightCache()
    for (let index = 0; index < TRANSCRIPT_HEIGHT_ENTRIES + 10; index++) heights.set(`${index}`, index + 0.125)
    expect(heights.size).toBe(TRANSCRIPT_HEIGHT_ENTRIES)
    expect(heights.get('0')).toBe(360)
    expect(heights.get('10')).toBe(10.125)
    expect(heights.set('invalid', NaN)).toBe(false)
    expect(heights.set('invalid', -1)).toBe(false)
    heights.clear()
    expect(heights.size).toBe(0)
    expect(heights.get('10')).toBe(360)
  })

  it('locates reverse-flow rows at fractional boundaries and clamps out-of-range offsets', () => {
    const offsets = [0, 20.125, 400.5, 400.5, 701.25]
    expect(transcriptRowAtOffset(offsets, -100)).toBe(0)
    expect(transcriptRowAtOffset(offsets, 20.124)).toBe(0)
    expect(transcriptRowAtOffset(offsets, 20.125)).toBe(1)
    expect(transcriptRowAtOffset(offsets, 400.5)).toBe(3)
    expect(transcriptRowAtOffset(offsets, 10000)).toBe(3)
  })

  it('materializes capture explicitly and returns to the ordinary bound with the same stable row keys', () => {
    const rows = Array.from({ length: 600 }, (_, index) => ({ key: `id-${index}` }))
    const ids = rows.map((row) => row.key)
    const offsets = transcriptRowOffsets(ids, new TranscriptHeightCache())
    const capture = buildTranscriptResidency(rows, ids, offsets, 100, new Set(), true)
    expect(capture.map((entry) => entry.key)).toEqual(ids)
    const restored = buildTranscriptResidency(rows, ids, offsets, 100, new Set(), false)
    expect(restored.filter((entry) => entry.kind === 'row').map((entry) => entry.key)).toEqual(ids.slice(100, 160))
  })
})
