import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fullscreenMocks = vi.hoisted(() => ({
  toggleFullscreen: vi.fn(),
}))

vi.mock('src/ts/globalApi.svelte', () => ({
  toggleFullscreen: fullscreenMocks.toggleFullscreen,
}))

import FullscreenToggle from './FullscreenToggle.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement
let fullscreenElement: Element | null
let originalFullscreenDescriptor: PropertyDescriptor | undefined

function checkbox(): HTMLInputElement {
  const input = target.querySelector<HTMLInputElement>('input[type="checkbox"]')
  if (!input) throw new Error('fullscreen checkbox not found')
  return input
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  fullscreenElement = null
  originalFullscreenDescriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement')
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreenElement,
  })
  fullscreenMocks.toggleFullscreen.mockReset()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  if (originalFullscreenDescriptor) {
    Object.defineProperty(document, 'fullscreenElement', originalFullscreenDescriptor)
  } else {
    delete (document as unknown as Record<string, unknown>).fullscreenElement
  }
})

describe('FullscreenToggle', () => {
  it('tracks successful entry and browser-driven exit', async () => {
    fullscreenMocks.toggleFullscreen.mockImplementationOnce(async (enabled: boolean) => {
      fullscreenElement = enabled ? document.documentElement : null
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    component = mount(FullscreenToggle, { target })
    await tick()

    checkbox().click()
    await vi.waitFor(() => expect(checkbox().checked).toBe(true))
    expect(fullscreenMocks.toggleFullscreen).toHaveBeenCalledWith(true)

    fullscreenElement = null
    document.dispatchEvent(new Event('fullscreenchange'))
    await tick()

    expect(checkbox().checked).toBe(false)
  })

  it('restores the actual browser state after a rejected transition', async () => {
    fullscreenMocks.toggleFullscreen.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
    component = mount(FullscreenToggle, { target })
    await tick()

    checkbox().click()

    await vi.waitFor(() => expect(fullscreenMocks.toggleFullscreen).toHaveBeenCalledWith(true))
    await vi.waitFor(() => expect(checkbox().checked).toBe(false))
  })
})
