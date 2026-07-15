import { describe, expect, it } from 'vitest'
import { readResizePointer } from './ResizeBoxPointer'

describe('readResizePointer', () => {
  it('keeps valid mouse coordinates at the viewport origin', () => {
    expect(readResizePointer({ clientX: 0, clientY: 0 })).toEqual({ x: 0, y: 0 })
  })

  it('reads touch coordinates when mouse coordinates are absent', () => {
    expect(readResizePointer({ touches: [{ clientX: 12, clientY: 34 }] })).toEqual({ x: 12, y: 34 })
  })

  it('returns null instead of dereferencing a missing touch', () => {
    expect(readResizePointer({ touches: [] })).toBeNull()
    expect(readResizePointer({})).toBeNull()
  })
})
