import { afterEach, describe, expect, it, vi } from 'vitest'

const coordinatorState = vi.hoisted(() => ({ adjustmentActive: false }))

vi.mock('./visualViewportCoordinator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./visualViewportCoordinator')>()
  return {
    ...actual,
    isVisualViewportAdjustmentActive: () => coordinatorState.adjustmentActive,
  }
})

import { installViewportScrollGuard } from './viewportScrollGuard'

describe('viewport scroll guard', () => {
  afterEach(() => {
    coordinatorState.adjustmentActive = false
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    document.body.replaceChildren()
    const scroller = document.scrollingElement as HTMLElement
    scroller.scrollTop = 0
    scroller.scrollLeft = 0
  })

  it('resets a document root scroll back to the origin', () => {
    installViewportScrollGuard()

    const scroller = document.scrollingElement as HTMLElement
    scroller.scrollTop = 267
    scroller.scrollLeft = 12
    window.dispatchEvent(new Event('scroll'))

    expect(scroller.scrollTop).toBe(0)
    expect(scroller.scrollLeft).toBe(0)
  })

  it('leaves inner scroll containers alone', () => {
    installViewportScrollGuard()

    const inner = document.createElement('div')
    document.body.appendChild(inner)
    inner.scrollTop = 40
    inner.dispatchEvent(new Event('scroll'))

    expect(inner.scrollTop).toBe(40)
  })

  it('allows keyboard pan while the focused editor settle latch is inactive', () => {
    installViewportScrollGuard()
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    textarea.focus()

    const scroller = document.scrollingElement as HTMLElement
    scroller.scrollTop = 267
    scroller.scrollLeft = 12
    window.dispatchEvent(new Event('scroll'))

    expect(scroller.scrollTop).toBe(267)
    expect(scroller.scrollLeft).toBe(0)
  })

  it('resumes vertical enforcement once the focused editor has a viewport adjustment', () => {
    installViewportScrollGuard()
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    textarea.focus()
    coordinatorState.adjustmentActive = true

    const scroller = document.scrollingElement as HTMLElement
    scroller.scrollTop = 267
    scroller.scrollLeft = 12
    window.dispatchEvent(new Event('scroll'))

    expect(scroller.scrollTop).toBe(0)
    expect(scroller.scrollLeft).toBe(0)
  })
})
