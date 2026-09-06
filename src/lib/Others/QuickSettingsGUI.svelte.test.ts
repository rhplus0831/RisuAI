import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../Setting/Pages/BotSettings.svelte', async () => ({
  default: (await import('./QuickSettingsGUI.testStub.svelte')).default,
}))
vi.mock('../Setting/Pages/OtherBotSettings.svelte', async () => ({
  default: (await import('./QuickSettingsGUI.testStub.svelte')).default,
}))
vi.mock('../Setting/Pages/Module/ModuleSettings.svelte', async () => ({
  default: (await import('./QuickSettingsGUI.testStub.svelte')).default,
}))
vi.mock('src/ts/stores.svelte', async () => import('./QuickSettingsGUI.testState.svelte'))

import QuickSettingsGUI from './QuickSettingsGUI.svelte'
import { language } from 'src/lang'
import { QuickSettings } from 'src/ts/stores.svelte'
import { registerModuleEditorLeaveGuard } from 'src/ts/moduleEditorLeaveGuard'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

function buttonByName(name: string): HTMLButtonElement {
  const button = target.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)
  if (!button) throw new Error(`Button not found: ${name}`)
  return button
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  QuickSettings.index = 0
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  QuickSettings.index = 0
})

describe('QuickSettingsGUI tabs', () => {
  it('names each icon control and exposes the active selection', async () => {
    component = mount(QuickSettingsGUI, { target })
    await tick()

    const botButton = buttonByName(language.chatBot)
    const memoryButton = buttonByName(language.settingsNavMemory)
    const moduleButton = buttonByName(language.modules)

    expect(botButton.type).toBe('button')
    expect(botButton.getAttribute('aria-pressed')).toBe('true')
    expect(memoryButton.getAttribute('aria-pressed')).toBe('false')
    expect(moduleButton.getAttribute('aria-pressed')).toBe('false')

    moduleButton.click()
    await tick()

    expect(botButton.getAttribute('aria-pressed')).toBe('false')
    expect(memoryButton.getAttribute('aria-pressed')).toBe('false')
    expect(moduleButton.getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps the Modules tab selected when its leave guard cancels navigation', async () => {
    QuickSettings.index = 2
    const guard = vi.fn(() => false)
    const unregister = registerModuleEditorLeaveGuard(guard)
    component = mount(QuickSettingsGUI, { target })
    await tick()

    try {
      buttonByName(language.chatBot).click()
      await tick()

      expect(guard).toHaveBeenCalledOnce()
      expect(QuickSettings.index).toBe(2)
    } finally {
      unregister()
    }
  })
})
