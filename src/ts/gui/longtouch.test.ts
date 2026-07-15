import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { longpress } from './longtouch'

describe('longpress', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('cancels when the pointer is released outside the action node', () => {
    const node = document.createElement('button')
    const callback = vi.fn()
    longpress(node, callback)

    node.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }))
    vi.advanceTimersByTime(500)

    expect(callback).not.toHaveBeenCalled()
  })

  it('cancels pending work when the action is destroyed', () => {
    const node = document.createElement('button')
    const callback = vi.fn()
    const action = longpress(node, callback)

    node.dispatchEvent(new MouseEvent('mousedown', { button: 0 }))
    action.destroy()
    vi.advanceTimersByTime(500)

    expect(callback).not.toHaveBeenCalled()
  })

  it('runs once after an uninterrupted primary-button hold', () => {
    const node = document.createElement('button')
    const callback = vi.fn()
    longpress(node, callback)

    node.dispatchEvent(new MouseEvent('mousedown', { button: 0 }))
    vi.advanceTimersByTime(500)

    expect(callback).toHaveBeenCalledOnce()
  })
})
