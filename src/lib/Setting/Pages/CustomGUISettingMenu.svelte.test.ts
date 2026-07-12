import { mount, tick, unmount } from 'svelte'
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
  setDatabaseLite({} as any)
  vi.useRealTimers()
})

describe('CustomGUISettingMenu persistence', () => {
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
})
