import { describe, expect, it } from 'vitest'
import { mergeChatMessageRange } from './chatMessageRangeMerge'

interface Row {
  id: string
  placeholder?: boolean
}

const placeholder = (): Row => ({ id: 'placeholder', placeholder: true })

describe('mergeChatMessageRange', () => {
  it('appends one incoming row without copying the resident prefix or allocating a placeholder', () => {
    const first = { id: 'first' }
    const second = { id: 'second' }
    const existing = [first, second]
    const appended = { id: 'appended' }

    const result = mergeChatMessageRange(
      existing,
      [appended],
      { start: 2, total: 3, preserveExistingOnGrowth: true },
      placeholder,
    )

    expect(result).toMatchObject({
      messages: [first, second, appended],
      changed: true,
      replacedArray: false,
      assignedRows: 1,
      allocatedPlaceholders: 0,
    })
    expect(result?.messages).toBe(existing)
    expect(existing[0]).toBe(first)
    expect(existing[1]).toBe(second)
  })

  it('replaces only changed indexes and keeps unchanged object identity', () => {
    const first = { id: 'first' }
    const second = { id: 'second' }
    const third = { id: 'third' }
    const existing = [first, second, third]
    const replacement = { id: 'second-replaced' }

    const result = mergeChatMessageRange(existing, [replacement, { id: 'third' }], { start: 1, total: 3 }, placeholder)

    expect(result).toMatchObject({ changed: true, replacedArray: false, assignedRows: 1 })
    expect(existing[0]).toBe(first)
    expect(existing[1]).toBe(replacement)
    expect(existing[2]).toBe(third)
  })

  it('truncates an authoritative generation range in place', () => {
    const existing = [{ id: 'first' }, { id: 'second' }, { id: 'stale-tail' }]

    const result = mergeChatMessageRange(
      existing,
      [{ id: 'second' }],
      { start: 1, total: 2, preserveExistingOnGrowth: true },
      placeholder,
    )

    expect(result).toMatchObject({ changed: true, replacedArray: false, assignedRows: 0 })
    expect(existing.map((row) => row.id)).toEqual(['first', 'second'])
  })

  it('allocates placeholders only for genuinely missing indexes', () => {
    const existing: Row[] = []
    const tail: Row = { id: 'tail' }

    const result = mergeChatMessageRange<Row>(existing, [tail], { start: 3, total: 4 }, placeholder)

    expect(result).toMatchObject({ replacedArray: true, assignedRows: 1, allocatedPlaceholders: 3 })
    expect(result?.messages.slice(0, 3).every((row) => row.placeholder)).toBe(true)
    expect(result?.messages[3]).toBe(tail)
  })

  it('turns an exact replay into a no-op', () => {
    const first = { id: 'first' }
    const second = { id: 'second' }
    const existing = [first, second]

    const result = mergeChatMessageRange(existing, [{ id: 'second' }], { start: 1, total: 2 }, placeholder)

    expect(result).toMatchObject({ changed: false, replacedArray: false, assignedRows: 0, allocatedPlaceholders: 0 })
    expect(existing[1]).toBe(second)
  })

  it('rejects malformed ranges', () => {
    expect(mergeChatMessageRange([], [{ id: 'overflow' }], { start: 1, total: 1 }, placeholder)).toBeNull()
    expect(mergeChatMessageRange([], [], { start: -1, total: 0 }, placeholder)).toBeNull()
  })
})
