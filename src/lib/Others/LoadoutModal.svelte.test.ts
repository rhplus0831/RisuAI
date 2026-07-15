import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loadoutStore = vi.hoisted(() => ({ open: true }))

vi.mock('src/ts/stores.svelte', () => ({
  loadoutModalStore: loadoutStore,
}))
vi.mock('src/ts/server/resourceState.svelte', () => ({
  getResourceDatabase: vi.fn(() => ({ loadouts: [] })),
}))
vi.mock('src/ts/loadout', () => ({
  applyLoadout: vi.fn(),
  deleteLoadout: vi.fn(),
  saveCurrentLoadout: vi.fn(),
  toggleLoadoutFavorite: vi.fn(),
}))
vi.mock('src/ts/storage/database.svelte', () => ({
  getCurrentCharacter: vi.fn(() => null),
}))

import LoadoutModal from './LoadoutModal.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let opener: HTMLButtonElement
let target: HTMLElement

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await tick()
}

beforeEach(() => {
  loadoutStore.open = true
  opener = document.createElement('button')
  opener.textContent = 'Open loadouts'
  target = document.createElement('div')
  document.body.append(opener, target)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  opener.remove()
  target.remove()
  document.body.innerHTML = ''
})

describe('LoadoutModal focus', () => {
  it('contains focus, closes on owned Escape, and restores the opener', async () => {
    opener.focus()
    component = mount(LoadoutModal, { target })
    await settle()

    const dialog = target.querySelector<HTMLElement>('[role="dialog"]')
    const backdrop = dialog?.parentElement
    const close = dialog?.querySelector<HTMLButtonElement>('[data-modal-initial-focus]')
    if (!dialog || !backdrop || !close) throw new Error('Loadout modal not found')
    expect(backdrop.hasAttribute('data-modal-root')).toBe(true)
    expect(dialog.getAttribute('aria-labelledby')).toBe('risu-loadout-modal-title')
    expect(opener.inert).toBe(true)
    expect(document.activeElement).toBe(close)

    opener.focus()
    expect(document.activeElement).toBe(close)

    const escape = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })
    close.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(loadoutStore.open).toBe(false)

    unmount(component)
    component = undefined
    await settle()
    expect(opener.inert).toBe(false)
    expect(document.activeElement).toBe(opener)
  })
})
