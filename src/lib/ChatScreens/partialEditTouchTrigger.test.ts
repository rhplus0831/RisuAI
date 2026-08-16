import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachPartialEditTouchTrigger } from './partialEditTouchTrigger'

interface FixtureOptions {
  resolveBlock?: (x: number, y: number) => HTMLElement | null
}

function touchEvent(
  type: string,
  points: Array<{ x: number; y: number; id?: number }>,
  cancelable = false,
  changed: Array<{ x: number; y: number; id?: number }> = [],
): Event {
  const event = new Event(type, { bubbles: true, cancelable })
  const toTouch = (point: { x: number; y: number; id?: number }) => ({
    clientX: point.x,
    clientY: point.y,
    identifier: point.id ?? 0,
  })
  Object.defineProperty(event, 'touches', { value: points.map(toTouch) })
  Object.defineProperty(event, 'changedTouches', {
    value: (changed.length > 0 ? changed : points).map(toTouch),
  })
  return event
}

describe('attachPartialEditTouchTrigger', () => {
  let bodyRoot: HTMLElement
  let block: HTMLElement
  let onLongPress: ReturnType<typeof vi.fn<(block: HTMLElement) => void>>
  let detach: (() => void) | null

  function attach(options: FixtureOptions = {}) {
    detach = attachPartialEditTouchTrigger({
      bodyRoot,
      resolveBlock: options.resolveBlock ?? (() => block),
      onLongPress,
    })
  }

  function press(x = 40, y = 40) {
    bodyRoot.dispatchEvent(touchEvent('touchstart', [{ x, y }]))
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    bodyRoot = document.createElement('div')
    block = document.createElement('p')
    bodyRoot.appendChild(block)
    document.body.appendChild(bodyRoot)
    onLongPress = vi.fn<(block: HTMLElement) => void>()
    detach = null
  })

  afterEach(() => {
    detach?.()
    bodyRoot.remove()
    vi.useRealTimers()
  })

  it('fires after the long-press delay and reports the resolved block', () => {
    attach()
    press()
    expect(bodyRoot.style.userSelect).toBe('none')
    vi.advanceTimersByTime(499)
    expect(onLongPress).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onLongPress).toHaveBeenCalledWith(block)
  })

  it('restores selection styles after the touch ends', () => {
    attach()
    press()
    vi.advanceTimersByTime(500)
    expect(bodyRoot.style.userSelect).toBe('none')
    window.dispatchEvent(touchEvent('touchend', [], true))
    expect(bodyRoot.style.userSelect).toBe('')
  })

  it('cancels when the touch moves beyond the slop radius', () => {
    attach()
    press(40, 40)
    vi.advanceTimersByTime(200)
    window.dispatchEvent(touchEvent('touchmove', [{ x: 40, y: 60 }]))
    expect(bodyRoot.style.userSelect).toBe('')
    vi.advanceTimersByTime(400)
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('tolerates movement within the slop radius', () => {
    attach()
    press(40, 40)
    window.dispatchEvent(touchEvent('touchmove', [{ x: 44, y: 44 }]))
    vi.advanceTimersByTime(500)
    expect(onLongPress).toHaveBeenCalledWith(block)
  })

  it('cancels on early touchend and on scroll', () => {
    attach()
    press()
    window.dispatchEvent(touchEvent('touchend', [], true))
    vi.advanceTimersByTime(600)
    expect(onLongPress).not.toHaveBeenCalled()

    press()
    document.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(600)
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('prevents the touchend default and swallows the synthetic click after firing', () => {
    attach()
    press()
    vi.advanceTimersByTime(500)
    const touchEnd = touchEvent('touchend', [], true)
    window.dispatchEvent(touchEnd)
    expect(touchEnd.defaultPrevented).toBe(true)

    const syntheticClick = new MouseEvent('click', { bubbles: true, cancelable: true })
    block.dispatchEvent(syntheticClick)
    expect(syntheticClick.defaultPrevented).toBe(true)

    const laterClick = new MouseEvent('click', { bubbles: true, cancelable: true })
    block.dispatchEvent(laterClick)
    expect(laterClick.defaultPrevented).toBe(false)
  })

  it('never swallows clicks landing outside the message body', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    attach()
    press()
    vi.advanceTimersByTime(500)
    window.dispatchEvent(touchEvent('touchend', [], true))

    const buttonTap = new MouseEvent('click', { bubbles: true, cancelable: true })
    outside.dispatchEvent(buttonTap)
    expect(buttonTap.defaultPrevented).toBe(false)
    outside.remove()
  })

  it('does not swallow clicks arriving after the synthetic-click window', () => {
    attach()
    press()
    vi.advanceTimersByTime(500)
    window.dispatchEvent(touchEvent('touchend', [], true))

    vi.advanceTimersByTime(400)
    const userClick = new MouseEvent('click', { bubbles: true, cancelable: true })
    block.dispatchEvent(userClick)
    expect(userClick.defaultPrevented).toBe(false)
  })

  it('does not mark the gesture fired when no block resolves', () => {
    attach({ resolveBlock: () => null })
    press()
    vi.advanceTimersByTime(500)
    expect(onLongPress).not.toHaveBeenCalled()
    const touchEnd = touchEvent('touchend', [], true)
    window.dispatchEvent(touchEnd)
    expect(touchEnd.defaultPrevented).toBe(false)
  })

  it('prevents the context menu only while a gesture is active', () => {
    attach()
    const idleMenu = new Event('contextmenu', { cancelable: true })
    bodyRoot.dispatchEvent(idleMenu)
    expect(idleMenu.defaultPrevented).toBe(false)

    press()
    const pendingMenu = new Event('contextmenu', { cancelable: true })
    bodyRoot.dispatchEvent(pendingMenu)
    expect(pendingMenu.defaultPrevented).toBe(true)
  })

  it('stops reacting after detach', () => {
    attach()
    detach?.()
    detach = null
    press()
    vi.advanceTimersByTime(600)
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('keeps release protection when the finger drifts after firing', () => {
    attach()
    press(40, 40)
    vi.advanceTimersByTime(500)
    expect(onLongPress).toHaveBeenCalled()

    window.dispatchEvent(touchEvent('touchmove', [{ x: 40, y: 90 }]))
    const touchEnd = touchEvent('touchend', [], true)
    window.dispatchEvent(touchEnd)
    expect(touchEnd.defaultPrevented).toBe(true)
  })

  it('cancels a pending press when a second finger lands anywhere', () => {
    attach()
    press()
    window.dispatchEvent(
      touchEvent('touchstart', [
        { x: 40, y: 40, id: 0 },
        { x: 200, y: 300, id: 1 },
      ]),
    )
    expect(bodyRoot.style.userSelect).toBe('')
    vi.advanceTimersByTime(600)
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('ignores another finger lifting while the press continues', () => {
    attach()
    press(40, 40)
    // A different touch id ends while ours (id 0) is still down.
    window.dispatchEvent(
      touchEvent('touchend', [{ x: 40, y: 40, id: 0 }], true, [{ x: 200, y: 300, id: 1 }]),
    )
    vi.advanceTimersByTime(500)
    expect(onLongPress).toHaveBeenCalledWith(block)
  })

  it('disarms the click swallow when a new touch begins', () => {
    attach()
    press()
    vi.advanceTimersByTime(500)
    window.dispatchEvent(touchEvent('touchend', [], true))

    press()
    const inBodyClick = new MouseEvent('click', { bubbles: true, cancelable: true })
    block.dispatchEvent(inBodyClick)
    expect(inBodyClick.defaultPrevented).toBe(false)
  })

  it('prevents descendant context menus in the capture phase during a gesture', () => {
    attach()
    press()
    const menu = new Event('contextmenu', { bubbles: true, cancelable: true })
    let reachedBlock = false
    block.addEventListener('contextmenu', () => {
      reachedBlock = true
    })
    block.dispatchEvent(menu)
    expect(menu.defaultPrevented).toBe(true)
    expect(reachedBlock).toBe(false)
  })
})
