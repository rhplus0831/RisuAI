import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const moduleMenuDatabase = vi.hoisted(() => ({
  characters: [
    {
      chatPage: 0,
      chats: [{ modules: [] as string[] }],
      modules: [] as string[],
    },
  ],
  enabledModules: [] as string[],
  modules: [] as Array<{ id: string; name: string; mcp?: unknown }>,
}))

const moduleMenuMocks = vi.hoisted(() => ({
  toggleSelectedCharacterModule: vi.fn(),
  toggleSelectedChatModule: vi.fn(),
}))

const moduleMenuStores = vi.hoisted(() => {
  function writable<T>(initial: T) {
    let value = initial
    const subscribers = new Set<(next: T) => void>()
    return {
      set(next: T) {
        value = next
        for (const subscriber of subscribers) subscriber(value)
      },
      subscribe(subscriber: (next: T) => void) {
        subscribers.add(subscriber)
        subscriber(value)
        return () => subscribers.delete(subscriber)
      },
    }
  }

  return {
    selectedCharID: writable(0),
    SettingsMenuIndex: writable(0),
    settingsOpen: writable(false),
  }
})

vi.mock('src/ts/moduleCommands', () => moduleMenuMocks)
vi.mock('src/ts/server/resourceState.svelte', () => ({
  getResourceDatabase: () => moduleMenuDatabase,
}))
vi.mock('src/ts/stores.svelte', () => moduleMenuStores)

import ModuleChatMenu from './ModuleChatMenu.svelte'

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
  moduleMenuDatabase.modules = []
  moduleMenuDatabase.enabledModules = []
  moduleMenuMocks.toggleSelectedCharacterModule.mockReset()
  moduleMenuMocks.toggleSelectedChatModule.mockReset()
  opener = document.createElement('button')
  opener.textContent = 'Open modules'
  target = document.createElement('div')
  document.body.append(opener, target)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  document.body.innerHTML = ''
})

describe('ModuleChatMenu modal behavior', () => {
  it('names the per-chat module toggle and removes the globally enabled placeholder button', async () => {
    moduleMenuDatabase.modules = [{ id: 'module-a', name: 'Module A' }]
    component = mount(ModuleChatMenu, { target, props: { close: vi.fn() } })
    await settle()

    const toggle = target.querySelector<HTMLButtonElement>('button[aria-label="Module: Module A"]')
    expect(toggle).toBeTruthy()
    expect(toggle!.getAttribute('aria-pressed')).toBe('false')

    unmount(component)
    component = undefined
    moduleMenuDatabase.enabledModules = ['module-a']
    component = mount(ModuleChatMenu, { target, props: { close: vi.fn() } })
    await settle()

    expect(target.querySelector('[aria-labelledby="disabled"]')).toBeNull()
    expect(target.querySelector('button[aria-label="Module: Module A"]')).toBeNull()
  })

  it('contains focus, owns Escape, and restores the opener', async () => {
    const close = vi.fn()
    opener.focus()
    component = mount(ModuleChatMenu, { target, props: { close } })
    await settle()

    const dialog = target.querySelector<HTMLElement>('[role="dialog"]')
    const backdrop = dialog?.closest<HTMLElement>('[data-modal-root]')
    const initialFocus = dialog?.querySelector<HTMLButtonElement>('[data-modal-initial-focus]')
    if (!dialog || !backdrop || !initialFocus) throw new Error('Module chat menu dialog not found')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBe('risu-module-chat-menu-title')
    expect(opener.inert).toBe(true)
    expect(document.activeElement).toBe(initialFocus)

    const last = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')).at(
      -1,
    )
    if (!last) throw new Error('Module chat menu focus target not found')
    last.focus()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    last.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(initialFocus)

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    initialFocus.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(close).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledWith('')

    unmount(component)
    component = undefined
    await settle()
    expect(opener.inert).toBe(false)
    expect(document.activeElement).toBe(opener)
  })

  it('closes only from the backdrop surface and keeps alert selection values', async () => {
    moduleMenuDatabase.modules = [{ id: 'module-a', name: 'Module A' }]
    const close = vi.fn()
    component = mount(ModuleChatMenu, { target, props: { alertMode: true, close } })
    await settle()

    const dialog = target.querySelector<HTMLElement>('[role="dialog"]')
    const backdrop = dialog?.closest<HTMLElement>('[data-modal-root]')
    if (!dialog || !backdrop) throw new Error('Module chat menu dialog not found')

    dialog.click()
    expect(close).not.toHaveBeenCalled()
    backdrop.click()
    expect(close).toHaveBeenCalledOnce()
    expect(close).toHaveBeenLastCalledWith('')

    close.mockClear()
    const select = dialog.querySelector<HTMLButtonElement>('[aria-label$="Module A"]')
    if (!select) throw new Error('Alert-mode module selection not found')
    select.click()
    expect(close).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledWith('module-a')
  })
})
