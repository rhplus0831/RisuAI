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

async function settle() {
  await Promise.resolve()
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
