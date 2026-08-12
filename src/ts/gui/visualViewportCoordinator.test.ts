import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installVisualViewportCoordinator, isTextEntryElement } from './visualViewportCoordinator'

class MockVisualViewport extends EventTarget {
  height = 420

  get offsetTop(): number {
    throw new Error('The height-only coordinator must not sample offsetTop')
  }

  get pageTop(): number {
    throw new Error('The height-only coordinator must not sample pageTop')
  }
}

describe('visual viewport coordinator', () => {
  const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
  let cleanup: (() => void) | null = null
  let visualViewport: MockVisualViewport
  let nextAnimationFrameId: number
  let animationFrames: Map<number, FrameRequestCallback>

  const flushAnimationFrame = () => {
    const pendingFrames = [...animationFrames.values()]
    animationFrames.clear()
    for (const callback of pendingFrames) callback(0)
  }

  const flushStableAdjustment = () => {
    flushAnimationFrame()
    flushAnimationFrame()
  }

  const flushAdjustmentAndReset = () => {
    flushStableAdjustment()
    flushAnimationFrame()
  }

  beforeEach(() => {
    vi.useFakeTimers()
    nextAnimationFrameId = 1
    animationFrames = new Map()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextAnimationFrameId++
      animationFrames.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      animationFrames.delete(id)
    })
    visualViewport = new MockVisualViewport()
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: visualViewport,
    })
  })

  afterEach(() => {
    cleanup?.()
    cleanup = null
    document.body.replaceChildren()
    if (originalVisualViewport) Object.defineProperty(window, 'visualViewport', originalVisualViewport)
    else delete (window as Window & { visualViewport?: VisualViewport }).visualViewport
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('applies only the visual viewport height and resets root scroll after the style frame', () => {
    const onApply = vi.fn(() => {
      expect(document.documentElement.getAttribute('data-risu-visual-viewport-active')).toBe('true')
      expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('420px')
    })
    cleanup = installVisualViewportCoordinator({ onApply })
    const textarea = document.createElement('textarea')
    document.body.append(textarea)

    textarea.focus()
    flushStableAdjustment()

    expect(document.documentElement.getAttribute('data-risu-visual-viewport-active')).toBe('true')
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('420px')
    expect(document.documentElement.hasAttribute('data-risu-visual-viewport-shifted')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-page-top')).toBe('')
    expect(onApply).not.toHaveBeenCalled()

    flushAnimationFrame()
    expect(onApply).toHaveBeenCalledOnce()

    visualViewport.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(50)
    flushAdjustmentAndReset()

    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('420px')
    expect(document.documentElement.hasAttribute('data-risu-visual-viewport-shifted')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-page-top')).toBe('')
  })

  it('revalidates at 250ms and 700ms so late viewport height settling converges', () => {
    const onApply = vi.fn()
    cleanup = installVisualViewportCoordinator({ onApply })
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    textarea.focus()
    flushAdjustmentAndReset()
    onApply.mockClear()

    visualViewport.height = 80
    visualViewport.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(49)
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('420px')

    vi.advanceTimersByTime(1)
    flushAdjustmentAndReset()
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('80px')

    visualViewport.height = 360
    vi.advanceTimersByTime(200)
    flushAdjustmentAndReset()
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('360px')

    visualViewport.height = 333
    vi.advanceTimersByTime(450)
    flushAdjustmentAndReset()
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('333px')
    expect(onApply).toHaveBeenCalledTimes(3)
    expect(document.documentElement.hasAttribute('data-risu-visual-viewport-shifted')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-page-top')).toBe('')
  })

  it('holds the height adjustment through focusout settling and invokes the release callback unchanged', () => {
    const onRelease = vi.fn()
    cleanup = installVisualViewportCoordinator({ onRelease })
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    textarea.focus()
    flushAdjustmentAndReset()

    textarea.blur()
    vi.advanceTimersByTime(699)
    expect(document.documentElement.hasAttribute('data-risu-visual-viewport-active')).toBe(true)

    vi.advanceTimersByTime(1)
    expect(document.documentElement.hasAttribute('data-risu-visual-viewport-active')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('')
    expect(document.documentElement.hasAttribute('data-risu-visual-viewport-shifted')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-page-top')).toBe('')
    expect(onRelease).toHaveBeenCalledOnce()
  })

  it('recognizes only controls that can summon a software text keyboard', () => {
    const textarea = document.createElement('textarea')
    const text = document.createElement('input')
    const checkbox = document.createElement('input')
    const readOnly = document.createElement('input')
    const editable = document.createElement('div')
    checkbox.type = 'checkbox'
    readOnly.readOnly = true
    editable.contentEditable = 'true'

    expect(isTextEntryElement(textarea)).toBe(true)
    expect(isTextEntryElement(text)).toBe(true)
    expect(isTextEntryElement(checkbox)).toBe(false)
    expect(isTextEntryElement(readOnly)).toBe(false)
    expect(isTextEntryElement(editable)).toBe(true)
  })
})
