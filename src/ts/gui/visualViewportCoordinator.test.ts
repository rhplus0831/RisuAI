import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installVisualViewportCoordinator, isTextEntryElement } from './visualViewportCoordinator'

class MockVisualViewport extends EventTarget {
  height = 420
  offsetTop = 160
}

describe('visual viewport coordinator', () => {
  const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
  let cleanup: (() => void) | null = null
  let visualViewport: MockVisualViewport

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
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

  it('sizes and offsets the app shell to the visual viewport while a text editor is focused', () => {
    const onRelease = vi.fn()
    cleanup = installVisualViewportCoordinator({ onRelease })
    const textarea = document.createElement('textarea')
    document.body.append(textarea)

    textarea.focus()

    expect(document.documentElement.getAttribute('data-risu-visual-viewport-active')).toBe('true')
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('420px')
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-offset-top')).toBe('160px')

    visualViewport.height = 360
    visualViewport.offsetTop = 120
    visualViewport.dispatchEvent(new Event('resize'))

    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('360px')
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-offset-top')).toBe('120px')

    textarea.blur()
    vi.advanceTimersByTime(699)
    expect(document.documentElement.hasAttribute('data-risu-visual-viewport-active')).toBe(true)

    vi.advanceTimersByTime(1)
    expect(document.documentElement.hasAttribute('data-risu-visual-viewport-active')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('')
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
