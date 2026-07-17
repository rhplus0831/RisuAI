import { afterEach, describe, expect, it, vi } from 'vitest'
import { scrollElementToContainerStart } from './chatScroll'

afterEach(() => {
  document.body.replaceChildren()
  document.documentElement.scrollTop = 0
  document.body.scrollTop = 0
  vi.restoreAllMocks()
})

describe('scrollElementToContainerStart', () => {
  it('aligns the element by scrolling only its container', () => {
    const container = document.createElement('div')
    const element = document.createElement('div')
    container.append(element)
    document.body.append(container)

    container.scrollTop = -20
    Object.defineProperty(container, 'clientTop', { configurable: true, value: 2 })
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect)
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ top: 52 } as DOMRect)
    document.documentElement.scrollTop = 11
    document.body.scrollTop = 17

    scrollElementToContainerStart(element, container)

    expect(container.scrollTop).toBe(-70)
    expect(document.documentElement.scrollTop).toBe(11)
    expect(document.body.scrollTop).toBe(17)
  })

  it('ignores an element that is no longer in the requested container', () => {
    const container = document.createElement('div')
    const element = document.createElement('div')
    container.scrollTop = 25

    scrollElementToContainerStart(element, container)

    expect(container.scrollTop).toBe(25)
  })
})
