import { mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const commandSpies = vi.hoisted(() => ({
  patchServerBackedSettings: vi.fn(async (input: { patch: Record<string, unknown> }) => ({
    status: 'ok',
    revision: 1,
    input,
  })),
}))

vi.mock('src/ts/server/commands', () => ({
  canUseServerCommands: () => true,
  patchServerBackedSettings: commandSpies.patchServerBackedSettings,
  settingsGroupForKey: (key: string) => (key === 'guiHTML' ? 'display' : undefined),
}))

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

import CustomGUISettingMenu from './CustomGUISettingMenu.svelte'
import { flushPendingServerBackedSettingsPatch } from 'src/ts/server/settingsBridge.svelte'
import { getDatabase, setDatabaseLite } from 'src/ts/storage/database.svelte'
import { CustomGUISettingMenuStore } from 'src/ts/stores.svelte'
import { language } from 'src/lang'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined
let previousSafeStructuredClone: unknown

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(target.querySelectorAll('button')).find((candidate) => candidate.textContent === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

beforeEach(() => {
  vi.useFakeTimers()
  commandSpies.patchServerBackedSettings.mockClear()
  CustomGUISettingMenuStore.set(true)
  setDatabaseLite({
    guiHTML: '',
  } as any)
  previousSafeStructuredClone = (globalThis as { safeStructuredClone?: unknown }).safeStructuredClone
  ;(globalThis as { safeStructuredClone?: <T>(value: T) => T }).safeStructuredClone = structuredClone
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  flushPendingServerBackedSettingsPatch()
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  ;(globalThis as { safeStructuredClone?: unknown }).safeStructuredClone = previousSafeStructuredClone
  CustomGUISettingMenuStore.set(false)
  setDatabaseLite({} as any)
  vi.useRealTimers()
})

describe('CustomGUISettingMenu persistence', () => {
  it('exposes tree semantics and supports keyboard selection and deletion', async () => {
    getDatabase().guiHTML = `
      <div class="flex" data-risu-type="leftToRightContainer"></div>
      <div class="flex" data-risu-type="topToBottomContainer"></div>
    `
    component = mount(CustomGUISettingMenu, { target })
    await tick()

    const tree = target.querySelector<HTMLElement>('[role="tree"]')
    const firstNode = target.querySelector<HTMLElement>('[x-tree="0"]')
    expect(tree?.getAttribute('aria-label')).toBe(language.defineCustomGUI)
    expect(firstNode?.getAttribute('role')).toBe('treeitem')
    expect(firstNode?.getAttribute('aria-label')).toBe('leftToRightContainer')
    expect(firstNode?.getAttribute('aria-selected')).toBe('false')

    firstNode!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await tick()
    await Promise.resolve()

    const selectedNode = target.querySelector<HTMLElement>('[x-tree="0"]')
    expect(selectedNode?.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(selectedNode)

    selectedNode!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
    await tick()

    expect(getDatabase().guiHTML).not.toContain('leftToRightContainer')
    expect(target.querySelector('[x-tree="0"]')?.getAttribute('aria-label')).toBe('topToBottomContainer')
  })

  it('loads the editor tree from the server-backed guiHTML setting', async () => {
    getDatabase().guiHTML = '<component class="flex flex-col flex-1" data-risu-type="fullWidthChat">\n</component>\n'

    component = mount(CustomGUISettingMenu, { target })
    await tick()

    expect(target.textContent).toContain('fullWidthChat')
    expect(commandSpies.patchServerBackedSettings).not.toHaveBeenCalled()
  })

  it('persists added GUI nodes through the server-backed guiHTML setting', async () => {
    component = mount(CustomGUISettingMenu, { target })
    await tick()

    buttonByText('Menu').click()
    await tick()
    buttonByText('fullWidthChat').click()
    await tick()

    expect(getDatabase().guiHTML).toContain('data-risu-type="fullWidthChat"')
    expect(getDatabase().guiHTML).toContain('<component')

    await vi.advanceTimersByTimeAsync(250)
    await tick()

    expect(commandSpies.patchServerBackedSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: {
          guiHTML: expect.stringContaining('data-risu-type="fullWidthChat"'),
        },
      }),
    )
  })

  it('keeps the selected container when a preceding sibling is deleted', async () => {
    getDatabase().guiHTML = `
      <div class="flex" data-risu-type="leftToRightContainer"></div>
      <div class="flex" data-risu-type="topToBottomContainer"></div>
    `
    component = mount(CustomGUISettingMenu, { target })
    await tick()

    buttonByText('Menu').click()
    await tick()
    const secondContainer = target.querySelector<HTMLElement>('[x-tree="1"]')
    if (!secondContainer) throw new Error('Second GUI container not found')
    secondContainer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))

    const firstContainer = target.querySelector<HTMLElement>('[x-tree="0"]')
    if (!firstContainer) throw new Error('First GUI container not found')
    firstContainer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 2 }))
    await tick()

    expect(() => buttonByText('fullWidthChat').click()).not.toThrow()
    await tick()

    const saved = new DOMParser().parseFromString(getDatabase().guiHTML, 'text/html').body
    expect(saved.children).toHaveLength(1)
    expect(saved.children[0].getAttribute('data-risu-type')).toBe('topToBottomContainer')
    expect(saved.children[0].children).toHaveLength(1)
    expect(saved.children[0].children[0].getAttribute('data-risu-type')).toBe('fullWidthChat')
  })

  it('returns through the back button without waiting to save the latest edit', async () => {
    component = mount(CustomGUISettingMenu, { target })
    await tick()

    buttonByText('Menu').click()
    await tick()

    buttonByText('fullWidthChat').click()
    buttonByText(language.goback).click()
    await tick()

    expect(get(CustomGUISettingMenuStore)).toBe(false)
    expect(getDatabase().guiHTML).toContain('data-risu-type="fullWidthChat"')
    expect(commandSpies.patchServerBackedSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: {
          guiHTML: expect.stringContaining('data-risu-type="fullWidthChat"'),
        },
      }),
    )
  })

  it('returns through Escape without waiting to save the latest edit', async () => {
    component = mount(CustomGUISettingMenu, { target })
    await tick()

    buttonByText('Menu').click()
    await tick()

    buttonByText('fullWidthChat').click()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await tick()

    expect(get(CustomGUISettingMenuStore)).toBe(false)
    expect(getDatabase().guiHTML).toContain('data-risu-type="fullWidthChat"')
    expect(commandSpies.patchServerBackedSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: {
          guiHTML: expect.stringContaining('data-risu-type="fullWidthChat"'),
        },
      }),
    )
  })
})
