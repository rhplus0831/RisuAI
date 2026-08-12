import { describe, expect, it } from 'vitest'
import { installViewportScrollGuard } from './viewportScrollGuard'

describe('viewport scroll guard', () => {
  it('resets a document root scroll back to the origin', () => {
    installViewportScrollGuard()

    const scroller = document.scrollingElement as HTMLElement
    scroller.scrollTop = 267
    scroller.scrollLeft = 12
    document.dispatchEvent(new Event('scroll', { bubbles: true }))

    expect(scroller.scrollTop).toBe(0)
    expect(scroller.scrollLeft).toBe(0)
  })

  it('leaves inner scroll containers alone', () => {
    installViewportScrollGuard()

    const inner = document.createElement('div')
    document.body.appendChild(inner)
    inner.scrollTop = 40
    // Element scroll events do not bubble; dispatch on the element itself.
    inner.dispatchEvent(new Event('scroll'))

    expect(inner.scrollTop).toBe(40)
    inner.remove()
  })

  it('allows keyboard-driven vertical document movement while a text editor is focused', () => {
    installViewportScrollGuard()
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    textarea.focus()

    const scroller = document.scrollingElement as HTMLElement
    scroller.scrollTop = 267
    scroller.scrollLeft = 12
    document.dispatchEvent(new Event('scroll', { bubbles: true }))

    expect(scroller.scrollTop).toBe(267)
    expect(scroller.scrollLeft).toBe(0)
    textarea.remove()
  })
})
