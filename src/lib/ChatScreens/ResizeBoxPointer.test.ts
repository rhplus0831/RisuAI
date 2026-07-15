import { describe, expect, it } from 'vitest'
import { clampResizeBoxSize, MIN_RESIZE_BOX_SIZE, readResizePointer } from './ResizeBoxPointer'

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

describe('clampResizeBoxSize', () => {
  it('prevents a reverse drag from producing a negative or unusably small panel', () => {
    expect(clampResizeBoxSize(-500, 1000)).toBe(MIN_RESIZE_BOX_SIZE)
    expect(clampResizeBoxSize(20, 1000)).toBe(MIN_RESIZE_BOX_SIZE)
  })

  it('retains the existing eighty-percent viewport maximum', () => {
    expect(clampResizeBoxSize(900, 1000)).toBe(800)
    expect(clampResizeBoxSize(300, 1000)).toBe(300)
  })

  it('keeps the minimum usable size on very small viewports', () => {
    expect(clampResizeBoxSize(100, 40)).toBe(MIN_RESIZE_BOX_SIZE)
  })
})
