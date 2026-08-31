import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const displaySettingsMocks = vi.hoisted(() => ({ setLegacyGUI: (_value: boolean) => {} }))

vi.mock('src/ts/setting/displaySettingsData.svelte', () => ({
  displayNonRendererServerSettingKeys: [],
  displayOtherSettingsItems: [],
  displaySizeSettingsItems: [],
  displayThemeSettingsItems: [],
}))

vi.mock('src/ts/server/settingsBridge.svelte', () => ({
  watchServerBackedSettings: () => () => {},
}))

vi.mock('../SettingRenderer.svelte', async () => {
  const { default: SettingRendererPropsProbe } =
    await import('src/lib/Setting/testHarness/SettingRendererPropsProbe.svelte')
  return { default: SettingRendererPropsProbe }
})

import { language } from 'src/lang'
import DisplaySettings from './DisplaySettings.svelte'
import { replaceResourceDatabase } from 'src/ts/server/resourceState.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

function buttonNamed(name: string): HTMLButtonElement {
  const button = Array.from(target.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === name,
  )
  if (!button) throw new Error(`button not found: ${name}`)
  return button
}

beforeEach(() => {
  displaySettingsMocks.setLegacyGUI = (useLegacyGUI) => replaceResourceDatabase({ useLegacyGUI } as any)
  displaySettingsMocks.setLegacyGUI(false)
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  document.body.innerHTML = ''
})

describe('DisplaySettings navigation semantics', () => {
  it('announces the selected settings panel', async () => {
    component = mount(DisplaySettings, { target })
    await tick()

    const theme = buttonNamed(language.theme)
    const size = buttonNamed(language.sizeAndSpeed)
    const others = buttonNamed(language.others)

    expect(theme.getAttribute('aria-pressed')).toBe('true')
    expect(size.getAttribute('aria-pressed')).toBe('false')
    expect(others.getAttribute('aria-pressed')).toBe('false')

    size.click()
    await tick()

    expect(theme.getAttribute('aria-pressed')).toBe('false')
    expect(size.getAttribute('aria-pressed')).toBe('true')
    expect(others.getAttribute('aria-pressed')).toBe('false')
  })

  it('switches mounted layouts when the authoritative legacy-GUI setting changes', async () => {
    component = mount(DisplaySettings, { target })
    await tick()

    expect(target.querySelectorAll('button')).toHaveLength(3)

    displaySettingsMocks.setLegacyGUI(true)
    await tick()
    expect(target.querySelectorAll('button')).toHaveLength(0)

    displaySettingsMocks.setLegacyGUI(false)
    await tick()
    expect(target.querySelectorAll('button')).toHaveLength(3)
  })
})
