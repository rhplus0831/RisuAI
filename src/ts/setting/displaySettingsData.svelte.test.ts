import { describe, expect, it, vi } from 'vitest'

const globalApiSpies = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  saveAsset: vi.fn(),
  toggleFullscreen: vi.fn(),
}))

vi.mock('../globalApi.svelte', () => globalApiSpies)

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

import { displayOtherSettingsItems, displayThemeSettingsItems } from './displaySettingsData.svelte'
import type { SettingContext } from './types'

function contextForTheme(theme: string): SettingContext {
  return {
    db: { theme } as SettingContext['db'],
    modelInfo: {} as SettingContext['modelInfo'],
    subModelInfo: {} as SettingContext['subModelInfo'],
  }
}

describe('display theme settings data', () => {
  it('gives the conditional custom-font field a visible and accessible label', () => {
    const customFont = displayThemeSettingsItems.find((item) => item.id === 'display.customFont')

    expect(customFont?.labelKey).toBe('customFont')
    expect(customFont?.condition?.({ ...contextForTheme('fastify'), db: { font: 'custom' } as any })).toBe(true)
  })

  it('makes the custom GUI editor reachable for the rendered customHTML/guiHTML path', () => {
    const customGuiButton = displayThemeSettingsItems.find((item) => item.id === 'display.customGui')
    const guiHtmlEditor = displayThemeSettingsItems.find((item) => item.id === 'display.guiHTML')

    expect(customGuiButton?.condition?.(contextForTheme('customHTML'))).toBe(true)
    expect(customGuiButton?.condition?.(contextForTheme('fastify'))).toBe(false)
    expect(guiHtmlEditor?.bindKey).toBe('guiHTML')
    expect(guiHtmlEditor?.condition?.(contextForTheme('customHTML'))).toBe(true)
  })

  it('passes the requested fullscreen state to the browser helper', () => {
    const fullscreen = displayOtherSettingsItems.find((item) => item.id === 'display.fullScreen')

    fullscreen?.onChange?.(true, contextForTheme('fastify'))
    fullscreen?.onChange?.(false, contextForTheme('fastify'))

    expect(globalApiSpies.toggleFullscreen).toHaveBeenNthCalledWith(1, true)
    expect(globalApiSpies.toggleFullscreen).toHaveBeenNthCalledWith(2, false)
  })
})
