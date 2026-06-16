import { describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

import { displayThemeSettingsItems } from './displaySettingsData.svelte'
import type { SettingContext } from './types'

function contextForTheme(theme: string): SettingContext {
  return {
    db: { theme } as SettingContext['db'],
    modelInfo: {} as SettingContext['modelInfo'],
    subModelInfo: {} as SettingContext['subModelInfo'],
  }
}

describe('display theme settings data', () => {
  it('makes the custom GUI editor reachable for the rendered customHTML/guiHTML path', () => {
    const customGuiButton = displayThemeSettingsItems.find((item) => item.id === 'display.customGui')
    const guiHtmlEditor = displayThemeSettingsItems.find((item) => item.id === 'display.guiHTML')

    expect(customGuiButton?.condition?.(contextForTheme('customHTML'))).toBe(true)
    expect(customGuiButton?.condition?.(contextForTheme('fastify'))).toBe(false)
    expect(guiHtmlEditor?.bindKey).toBe('guiHTML')
    expect(guiHtmlEditor?.condition?.(contextForTheme('customHTML'))).toBe(true)
  })
})
