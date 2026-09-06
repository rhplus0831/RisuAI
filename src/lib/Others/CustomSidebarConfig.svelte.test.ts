import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const customSidebarMocks = vi.hoisted(() => ({
  store: { open: true },
  draft: { value: [] as Array<{ id: string; type: string; subType: string; label: string }> },
}))

vi.mock('src/ts/stores.svelte', () => ({
  customSideBarConfigDialogStore: customSidebarMocks.store,
}))
vi.mock('src/ts/server/settingsOwner.svelte', () => ({
  createServerBackedSettingDraft: vi.fn(() => customSidebarMocks.draft),
}))
vi.mock('src/ts/setting/utils', () => ({
  getFullSettingsData: vi.fn(() => []),
}))

import CustomSidebarConfig from './CustomSidebarConfig.svelte'
import { language } from 'src/lang'

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
  customSidebarMocks.store.open = true
  customSidebarMocks.draft.value = []
  opener = document.createElement('button')
  opener.textContent = 'Open configuration'
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
  vi.unstubAllGlobals()
})

describe('CustomSidebarConfig modal focus', () => {
  it('starts on the safe Close action, contains focus, and restores the opener', async () => {
    opener.focus()
    component = mount(CustomSidebarConfig, { target })
    await settle()

    const dialog = target.querySelector<HTMLElement>('[role="dialog"]')
    const backdrop = dialog?.parentElement
    const close = dialog?.querySelector<HTMLButtonElement>('[data-modal-initial-focus]')
    if (!dialog || !backdrop || !close) throw new Error('Custom Sidebar modal not found')
    expect(backdrop.hasAttribute('data-modal-root')).toBe(true)
    expect(dialog.getAttribute('aria-label')).toBe(language.customSidebarConfig)
    expect(close.textContent?.trim()).toBe('Close')
    expect(opener.inert).toBe(true)
    expect(document.activeElement).toBe(close)

    opener.focus()
    expect(document.activeElement).toBe(close)

    const escape = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })
    close.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(customSidebarMocks.store.open).toBe(false)

    unmount(component)
    component = undefined
    await settle()
    expect(opener.inert).toBe(false)
    expect(document.activeElement).toBe(opener)
  })

  it('adds a custom sidebar item when WebCrypto UUID methods are unavailable', async () => {
    vi.stubGlobal('crypto', {})
    component = mount(CustomSidebarConfig, { target })
    await settle()

    const buttonByText = (text: string) =>
      Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent?.trim() === text,
      )

    buttonByText('Add Item')?.click()
    await settle()
    buttonByText(language.model)?.click()
    await settle()

    expect(customSidebarMocks.draft.value).toHaveLength(1)
    expect(customSidebarMocks.draft.value[0]).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      type: 'model',
      subType: 'none',
      label: language.model,
    })
  })
})
