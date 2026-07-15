import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/util', () => ({ sleep: async () => undefined }))
vi.mock('src/ts/stores.svelte', async () => {
  return import('./PopupList.testState.svelte')
})

import PopupListTestHost from './PopupList.testHost.svelte'
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
})

describe('PopupList outside dismissal', () => {
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
})
