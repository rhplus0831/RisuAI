import { describe, expect, it, vi } from 'vitest'

const globalApiSpies = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  saveAsset: vi.fn(),
}))

vi.mock('../globalApi.svelte', () => globalApiSpies)

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

import {
  displayOtherSettingsItems,
  displaySizeSettingsItems,
  displayThemeSettingsItems,
} from './displaySettingsData.svelte'
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

  it('renders fullscreen as browser-session state instead of a persisted setting', () => {
    const fullscreen = displayOtherSettingsItems.find((item) => item.id === 'display.fullScreen')

    expect(fullscreen).toMatchObject({ type: 'custom', componentId: 'FullscreenToggle' })
    expect(fullscreen?.bindKey).toBeUndefined()
  })

  it('does not advertise the unavailable prompt comparison workflow', () => {
    expect(displayOtherSettingsItems.some((item) => item.bindKey === 'showPromptComparison')).toBe(false)
  })

  it('does not advertise the disconnected legacy saving indicator', () => {
    expect(displayOtherSettingsItems.some((item) => item.bindKey === 'showSavingIcon')).toBe(false)
  })
})

describe('display size settings data', () => {
  it('exposes the fixed chat screen width slider in pixels', () => {
    const chatScreenWidth = displaySizeSettingsItems.find((item) => item.id === 'display.chatScreenWidth')

    expect(chatScreenWidth).toMatchObject({
      type: 'slider',
      labelKey: 'chatScreenWidth',
      bindKey: 'chatScreenWidth',
      options: {
        min: 500,
        max: 2000,
        step: 10,
      },
      keywords: ['chat', 'screen', 'width'],
    })
    expect(
      typeof chatScreenWidth?.options?.customText === 'function'
        ? chatScreenWidth.options.customText(900)
        : chatScreenWidth?.options?.customText,
    ).toBe('900px')
  })

  it('falls back to 900 for databases that predate the chat screen width key', () => {
    const chatScreenWidth = displaySizeSettingsItems.find((item) => item.id === 'display.chatScreenWidth')

    expect(chatScreenWidth?.getValue?.({} as never)).toBe(900)
    expect(chatScreenWidth?.getValue?.({ chatScreenWidth: 1240 } as never)).toBe(1240)
  })
})
