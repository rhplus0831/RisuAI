import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/util', () => ({ sleep: async () => undefined }))
vi.mock('src/ts/stores.svelte', async () => {
  return import('./PopupList.testState.svelte')
})

import PopupListTestHost from './PopupList.testHost.svelte'
import PopupList from './PopupList.svelte'
import { popupStore } from 'src/ts/stores.svelte'

let component: Parameters<typeof unmount>[0] | undefined
let target: HTMLElement

// Microtasks only: the popup renders, but the macrotask-deferred document
// listener must not have attached yet. This is the state the still-bubbling
// opening click observes in a real browser.
async function renderOnly() {
  await Promise.resolve()
  await tick()
}

async function settle() {
  await renderOnly()
  // Flush macrotasks so the deferred document listener attaches.
  await new Promise((resolve) => setTimeout(resolve, 0))
  await tick()
}

beforeEach(() => {
  popupStore.children = null
  popupStore.openId = 0
  popupStore.trigger = null
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  popupStore.children = null
  popupStore.openId = 0
  popupStore.trigger = null
})

describe('PopupList outside dismissal', () => {
  it('does not attach its deferred document listener after an immediate unmount', async () => {
    const addListener = vi.spyOn(document, 'addEventListener')
    const popup = mount(PopupList, { target })
    addListener.mockClear()

    unmount(popup)
    await settle()

    expect(addListener.mock.calls.filter(([eventName]) => eventName === 'click')).toHaveLength(0)
  })

  it('is not closed by a document click arriving before its deferred listener attaches', async () => {
    // Regression: openers that write popupStore synchronously in their click
    // handler (e.g. the reroll candidates menu) mount PopupList mid-dispatch.
    // A microtask-deferred listener attach lands while the opening click is
    // still bubbling, so the opening click itself closed the menu. The attach
    // must stay a macrotask: a document click that arrives after render but
    // before macrotasks run must leave the popup open.
    component = mount(PopupListTestHost, { target })
    await settle()
    const trigger = target.querySelector<HTMLButtonElement>('button')!

    trigger.click()
    await renderOnly()
    expect(target.querySelector('[data-testid="popup-content"]')).not.toBeNull()

    document.body.click()
    await settle()
    expect(target.querySelector('[data-testid="popup-content"]')).not.toBeNull()

    // A genuinely separate click, after the listener attached, still closes.
    document.body.click()
    await settle()
    expect(target.querySelector('[data-testid="popup-content"]')).toBeNull()
  })

  it('reopens from the same trigger with one click after an outside click', async () => {
    component = mount(PopupListTestHost, { target })
    await settle()
    const trigger = target.querySelector<HTMLButtonElement>('button')!

    trigger.click()
    await settle()
    expect(target.querySelector('[data-testid="popup-content"]')).not.toBeNull()

    document.body.click()
    await settle()
    expect(target.querySelector('[data-testid="popup-content"]')).toBeNull()
    expect(popupStore.openId).toBe(0)

    trigger.click()
    await settle()
    expect(target.querySelector('[data-testid="popup-content"]')).not.toBeNull()
  })

  it('closes an open menu when its trigger is clicked again', async () => {
    component = mount(PopupListTestHost, { target })
    await settle()
    const trigger = target.querySelector<HTMLButtonElement>('button')!

    trigger.click()
    await settle()
    expect(target.querySelector('[data-testid="popup-content"]')).not.toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    trigger.click()
    await settle()
    expect(target.querySelector('[data-testid="popup-content"]')).toBeNull()
    expect(popupStore.openId).toBe(0)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('anchors keyboard activation to the trigger and moves focus into the menu', async () => {
    component = mount(PopupListTestHost, { target })
    await settle()
    const trigger = target.querySelector<HTMLButtonElement>('button')!
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      bottom: 120,
      height: 40,
      left: 80,
      right: 120,
      top: 80,
      width: 40,
      x: 80,
      y: 80,
      toJSON: () => ({}),
    })

    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
    await settle()

    const menu = target.querySelector<HTMLElement>('[role="menu"]')!
    const firstAction = target.querySelector<HTMLButtonElement>('[data-testid="popup-content"]')!
    expect(menu.getAttribute('style')).toContain('left: 80px')
    expect(menu.getAttribute('style')).toContain('top: 120px')
    expect(firstAction.getAttribute('role')).toBe('menuitem')
    expect(document.activeElement).toBe(firstAction)
  })

  it('supports arrow navigation and restores trigger focus on Escape', async () => {
    component = mount(PopupListTestHost, { target })
    await settle()
    const trigger = target.querySelector<HTMLButtonElement>('button')!

    trigger.click()
    await settle()
    const firstAction = target.querySelector<HTMLButtonElement>('[data-testid="popup-content"]')!
    const secondAction = target.querySelector<HTMLButtonElement>('[data-testid="popup-second-action"]')!
    expect(document.activeElement).toBe(firstAction)

    firstAction.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }))
    expect(document.activeElement).toBe(secondAction)

    secondAction.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    await settle()
    expect(target.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
