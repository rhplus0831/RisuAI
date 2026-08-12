import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installVisualViewportCoordinator, isTextEntryElement } from './visualViewportCoordinator'

class MockVisualViewport extends EventTarget {
  height = 420
  offsetTop = 160
  pageTop = 240
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

  it('sizes and offsets the app shell from a stable visual viewport reading while a text editor is focused', () => {
    const onRelease = vi.fn()
    cleanup = installVisualViewportCoordinator({ onRelease })
    const textarea = document.createElement('textarea')
    document.body.append(textarea)

    textarea.focus()
    flushStableAdjustment()

    expect(document.documentElement.getAttribute('data-risu-visual-viewport-active')).toBe('true')
    expect(document.documentElement.getAttribute('data-risu-visual-viewport-shifted')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('420px')
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-page-top')).toBe('240px')

    // WebKit can expose an early, incorrect coordinate from the viewport event.
    // Do not project that transient value into the app shell.
    visualViewport.height = 80
    visualViewport.pageTop = 0
    visualViewport.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(49)

    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('420px')
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-page-top')).toBe('240px')

    visualViewport.height = 360
    visualViewport.pageTop = 300
    vi.advanceTimersByTime(1)
    flushStableAdjustment()

    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('360px')
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-page-top')).toBe('300px')

    visualViewport.pageTop = 320
    window.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(50)
    flushStableAdjustment()

    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-page-top')).toBe('320px')

    textarea.blur()
    vi.advanceTimersByTime(699)
    expect(document.documentElement.hasAttribute('data-risu-visual-viewport-active')).toBe(true)

    vi.advanceTimersByTime(1)
    expect(document.documentElement.hasAttribute('data-risu-visual-viewport-active')).toBe(false)
    expect(document.documentElement.hasAttribute('data-risu-visual-viewport-shifted')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-page-top')).toBe('')
    expect(onRelease).toHaveBeenCalledOnce()
  })

  it('falls back to layout scroll plus offsetTop when pageTop is unavailable', () => {
    visualViewport.pageTop = Number.NaN
    vi.stubGlobal('scrollY', 40)
    cleanup = installVisualViewportCoordinator()
    const textarea = document.createElement('textarea')
    document.body.append(textarea)

    textarea.focus()
    flushStableAdjustment()

    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-page-top')).toBe('200px')
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
