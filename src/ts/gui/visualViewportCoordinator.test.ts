import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installVisualViewportCoordinator,
  isTextEntryElement,
  isVisualViewportAdjustmentActive,
} from './visualViewportCoordinator'

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
  const originalLocalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage')
  const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth')
  const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight')
  let cleanup: (() => void) | null = null
  let visualViewport: MockVisualViewport
  let nextAnimationFrameId: number
  let animationFrames: Map<number, FrameRequestCallback>
  let storedValues: Map<string, string>
  let throwOnStorageRead: boolean
  let throwOnStorageWrite: boolean

  const setWindowSize = (width: number, height: number) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
  }

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
    storedValues = new Map()
    throwOnStorageRead = false
    throwOnStorageWrite = false
    const localStorageMock: Storage = {
      get length() {
        return storedValues.size
      },
      clear() {
        storedValues.clear()
      },
      getItem(key: string) {
        if (throwOnStorageRead) throw new Error('localStorage read unavailable')
        return storedValues.get(key) ?? null
      },
      key(index: number) {
        return [...storedValues.keys()][index] ?? null
      },
      removeItem(key: string) {
        storedValues.delete(key)
      },
      setItem(key: string, value: string) {
        if (throwOnStorageWrite) throw new Error('localStorage write unavailable')
        storedValues.set(key, value)
      },
    }
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: localStorageMock,
    })
    setWindowSize(390, 844)
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
    if (originalLocalStorage) Object.defineProperty(window, 'localStorage', originalLocalStorage)
    if (originalInnerWidth) Object.defineProperty(window, 'innerWidth', originalInnerWidth)
    if (originalInnerHeight) Object.defineProperty(window, 'innerHeight', originalInnerHeight)
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('waits for 275ms of quiet before applying and relatches after a later viewport event', () => {
    const onApply = vi.fn(() => {
      expect(document.documentElement.getAttribute('data-risu-visual-viewport-active')).toBe('true')
    })
    cleanup = installVisualViewportCoordinator({ onApply })
    const textarea = document.createElement('textarea')
    document.body.append(textarea)

    textarea.focus()
    flushStableAdjustment()
    vi.advanceTimersByTime(274)

    expect(isVisualViewportAdjustmentActive()).toBe(false)
    expect(document.documentElement.hasAttribute('data-risu-visual-viewport-active')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('')
    expect(onApply).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    flushStableAdjustment()

    expect(isVisualViewportAdjustmentActive()).toBe(true)
    expect(document.documentElement.getAttribute('data-risu-visual-viewport-active')).toBe('true')
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('420px')
    expect(document.documentElement.hasAttribute('data-risu-visual-viewport-shifted')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-page-top')).toBe('')
    expect(onApply).not.toHaveBeenCalled()

    flushAnimationFrame()
    expect(onApply).toHaveBeenCalledOnce()

    textarea.blur()
    textarea.focus()
    expect(isVisualViewportAdjustmentActive()).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('420px')

    visualViewport.height = 380
    visualViewport.dispatchEvent(new Event('scroll'))
    expect(isVisualViewportAdjustmentActive()).toBe(false)
    expect(document.documentElement.hasAttribute('data-risu-visual-viewport-active')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('')

    vi.advanceTimersByTime(274)
    flushAdjustmentAndReset()
    expect(isVisualViewportAdjustmentActive()).toBe(false)
    expect(onApply).toHaveBeenCalledOnce()

    vi.advanceTimersByTime(1)
    flushAdjustmentAndReset()

    expect(isVisualViewportAdjustmentActive()).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('380px')
    expect(onApply).toHaveBeenCalledTimes(2)
    expect(document.documentElement.hasAttribute('data-risu-visual-viewport-shifted')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-page-top')).toBe('')
  })

  it('restarts the quiet window for every event and validates late drift at 700ms', () => {
    const onApply = vi.fn()
    cleanup = installVisualViewportCoordinator({ onApply })
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    textarea.focus()

    vi.advanceTimersByTime(200)
    visualViewport.height = 80
    visualViewport.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(274)
    expect(isVisualViewportAdjustmentActive()).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('')

    visualViewport.height = 360
    visualViewport.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(274)
    expect(isVisualViewportAdjustmentActive()).toBe(false)
    expect(onApply).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    flushAdjustmentAndReset()
    expect(isVisualViewportAdjustmentActive()).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('360px')
    expect(onApply).toHaveBeenCalledOnce()

    visualViewport.height = 333
    vi.advanceTimersByTime(424)
    flushAdjustmentAndReset()
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('360px')
    expect(onApply).toHaveBeenCalledOnce()

    vi.advanceTimersByTime(1)
    flushAdjustmentAndReset()
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('333px')
    expect(onApply).toHaveBeenCalledTimes(2)
    expect(document.documentElement.hasAttribute('data-risu-visual-viewport-shifted')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-page-top')).toBe('')
  })

  it('settles keyboard-close geometry and releases 700ms after focusout', () => {
    const onApply = vi.fn()
    const onRelease = vi.fn()
    cleanup = installVisualViewportCoordinator({ onApply, onRelease })
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    textarea.focus()
    vi.advanceTimersByTime(275)
    flushAdjustmentAndReset()

    textarea.blur()
    vi.advanceTimersByTime(100)
    visualViewport.height = 500
    visualViewport.dispatchEvent(new Event('resize'))

    vi.advanceTimersByTime(274)
    expect(document.documentElement.hasAttribute('data-risu-visual-viewport-active')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('420px')

    vi.advanceTimersByTime(1)
    flushAdjustmentAndReset()
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('500px')
    expect(onApply).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(324)
    expect(document.documentElement.hasAttribute('data-risu-visual-viewport-active')).toBe(true)
    expect(onRelease).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(isVisualViewportAdjustmentActive()).toBe(false)
    expect(document.documentElement.hasAttribute('data-risu-visual-viewport-active')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('')
    expect(document.documentElement.hasAttribute('data-risu-visual-viewport-shifted')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-page-top')).toBe('')
    expect(onRelease).toHaveBeenCalledOnce()
  })

  it('retains release notification ownership while a focused adjustment is unlatched', () => {
    const onRelease = vi.fn()
    cleanup = installVisualViewportCoordinator({ onRelease })
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    textarea.focus()
    vi.advanceTimersByTime(275)
    flushAdjustmentAndReset()

    visualViewport.dispatchEvent(new Event('resize'))
    expect(isVisualViewportAdjustmentActive()).toBe(false)

    textarea.blur()
    vi.advanceTimersByTime(699)
    expect(onRelease).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onRelease).toHaveBeenCalledOnce()
  })

  it('caches a settled height only when a real keyboard-sized viewport delta exists', () => {
    cleanup = installVisualViewportCoordinator()
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    visualViewport.height = 417

    textarea.focus()
    expect(storedValues.has('risu-keyboard-viewport-height:portrait')).toBe(false)

    vi.advanceTimersByTime(275)
    flushAdjustmentAndReset()
    expect(storedValues.get('risu-keyboard-viewport-height:portrait')).toBe('417')
  })

  it.each([844, 780, 744])('does not cache a desktop-like settled height of %spx', (height) => {
    cleanup = installVisualViewportCoordinator()
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    visualViewport.height = height

    textarea.focus()
    vi.advanceTimersByTime(275)
    flushAdjustmentAndReset()

    expect(storedValues.has('risu-keyboard-viewport-height:portrait')).toBe(false)
  })

  it('pre-lifts synchronously, stays latched through motion, reconciles, and releases normally', () => {
    storedValues.set('risu-keyboard-viewport-height:portrait', '417')
    const onApply = vi.fn()
    const onRelease = vi.fn()
    cleanup = installVisualViewportCoordinator({ onApply, onRelease })
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    visualViewport.height = 390

    textarea.focus()

    expect(isVisualViewportAdjustmentActive()).toBe(true)
    expect(document.documentElement.getAttribute('data-risu-visual-viewport-active')).toBe('true')
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('417px')
    expect(onApply).toHaveBeenCalledOnce()

    visualViewport.dispatchEvent(new Event('resize'))
    expect(isVisualViewportAdjustmentActive()).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('417px')

    vi.advanceTimersByTime(274)
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('417px')

    vi.advanceTimersByTime(1)
    flushAdjustmentAndReset()
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('390px')
    expect(storedValues.get('risu-keyboard-viewport-height:portrait')).toBe('390')
    expect(onApply).toHaveBeenCalledTimes(2)

    textarea.blur()
    vi.advanceTimersByTime(699)
    expect(onRelease).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(isVisualViewportAdjustmentActive()).toBe(false)
    expect(onRelease).toHaveBeenCalledOnce()
  })

  it('restores the measured full height and drops the stale cache when no keyboard appears', () => {
    storedValues.set('risu-keyboard-viewport-height:portrait', '417')
    cleanup = installVisualViewportCoordinator()
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    visualViewport.height = 844

    textarea.focus()
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('417px')

    vi.advanceTimersByTime(275)
    flushAdjustmentAndReset()
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('844px')
    // The full-height settle proves no soft keyboard is present; the stale
    // entry must be dropped so the blip does not repeat on every focus.
    expect(storedValues.has('risu-keyboard-viewport-height:portrait')).toBe(false)
  })

  it.each(['199', '845', 'not-a-number', 'Infinity', ''])('ignores an invalid cached height of %j', (height) => {
    storedValues.set('risu-keyboard-viewport-height:portrait', height)
    cleanup = installVisualViewportCoordinator()
    const textarea = document.createElement('textarea')
    document.body.append(textarea)

    textarea.focus()

    expect(isVisualViewportAdjustmentActive()).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('')
  })

  it('treats localStorage read and write exceptions as silent cache misses', () => {
    cleanup = installVisualViewportCoordinator()
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    visualViewport.height = 417
    throwOnStorageRead = true

    expect(() => textarea.focus()).not.toThrow()
    expect(isVisualViewportAdjustmentActive()).toBe(false)

    throwOnStorageRead = false
    throwOnStorageWrite = true
    vi.advanceTimersByTime(275)
    expect(() => flushAdjustmentAndReset()).not.toThrow()
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('417px')
    expect(storedValues.size).toBe(0)
  })

  it('reads and updates separate portrait and landscape cache keys', () => {
    storedValues.set('risu-keyboard-viewport-height:portrait', '417')
    storedValues.set('risu-keyboard-viewport-height:landscape', '250')
    cleanup = installVisualViewportCoordinator()
    const portraitTextarea = document.createElement('textarea')
    document.body.append(portraitTextarea)

    portraitTextarea.focus()
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('417px')

    cleanup()
    cleanup = null
    portraitTextarea.blur()
    setWindowSize(844, 390)
    visualViewport.height = 240
    cleanup = installVisualViewportCoordinator()
    const landscapeTextarea = document.createElement('textarea')
    document.body.append(landscapeTextarea)

    landscapeTextarea.focus()
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('250px')

    visualViewport.dispatchEvent(new Event('resize'))
    expect(document.documentElement.style.getPropertyValue('--risu-visual-viewport-height')).toBe('250px')
    vi.advanceTimersByTime(275)
    flushAdjustmentAndReset()

    expect(storedValues.get('risu-keyboard-viewport-height:portrait')).toBe('417')
    expect(storedValues.get('risu-keyboard-viewport-height:landscape')).toBe('240')
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
