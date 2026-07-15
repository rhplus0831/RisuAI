import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hotkeyMocks = vi.hoisted(() => ({
  db: {
    hotkeys: [
      {
        action: 'send',
        key: 'Enter',
        ctrl: true,
        shift: false,
        alt: true,
      },
    ],
  },
  applyServerBackedSetting: vi.fn(),
}))

vi.mock('src/ts/server/resourceState.svelte', () => ({
  getResourceDatabase: () => hotkeyMocks.db,
}))

vi.mock('src/ts/server/settingsBridge.svelte', () => ({
  applyServerBackedSetting: hotkeyMocks.applyServerBackedSetting,
}))

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

import HotkeySettings from './HotkeySettings.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

function recorder(): HTMLInputElement {
  const input = target.querySelector('input')
  if (!input) throw new Error('hotkey recorder not found')
  return input
}

function keydown(input: HTMLInputElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  input.dispatchEvent(event)
  return event
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  target = document.createElement('div')
  document.body.appendChild(target)
  hotkeyMocks.applyServerBackedSetting.mockReset()
  component = mount(HotkeySettings, { target })
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('HotkeySettings recorder keyboard behavior', () => {
  it('leaves Tab unhandled so native keyboard navigation can move focus', () => {
    const input = recorder()
    input.focus()

    const event = keydown(input, 'Tab')

    expect(event.defaultPrevented).toBe(false)
    expect(hotkeyMocks.applyServerBackedSetting).not.toHaveBeenCalled()
  })

  it('uses Escape to cancel recording and release focus without changing the hotkey', async () => {
    const input = recorder()
    const bubbled = vi.fn()
    document.addEventListener('keydown', bubbled, { once: true })
    input.focus()

    const event = keydown(input, 'Escape')
    await tick()

    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).not.toBe(input)
    expect(bubbled).not.toHaveBeenCalled()
    expect(hotkeyMocks.applyServerBackedSetting).not.toHaveBeenCalled()
    document.removeEventListener('keydown', bubbled)
  })

  it('still records ordinary keys while preserving the selected modifiers', () => {
    const input = recorder()

    const event = keydown(input, 'k', { ctrlKey: true })

    expect(event.defaultPrevented).toBe(true)
    expect(hotkeyMocks.applyServerBackedSetting).toHaveBeenCalledWith('hotkeys', [
      {
        action: 'send',
        key: 'k',
        ctrl: true,
        shift: false,
        alt: true,
      },
    ])
  })
})
