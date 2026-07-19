import { describe, expect, it, vi } from 'vitest'

vi.mock('../alert', () => ({
  alertConfirm: vi.fn(),
  alertError: vi.fn(),
  alertNormal: vi.fn(),
  alertWait: vi.fn(),
}))

vi.mock('../globalApi.svelte', () => ({
  downloadFile: vi.fn(async (_name: string, _bytes: Uint8Array) => {}),
  saveAsset: vi.fn(),
}))

vi.mock('../translator/translator', () => ({
  clearLLMCache: vi.fn(),
  exportLLMCacheAsJSON: vi.fn(),
  importLLMCacheFromJSON: vi.fn(),
}))

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

import { languageSettingsItems } from './languageSettingsData.svelte'

describe('language settings actions', () => {
  it('keeps non-language values out of the persisted UI-language select', () => {
    const languageSelect = languageSettingsItems.find((item) => item.id === 'lang.uiLanguage')

    expect(languageSelect?.options?.selectOptions?.map((option) => option.value)).not.toContain('translang')
    expect(languageSelect?.options?.selectFallbackValue).toBe('en')
  })

  it('does not offer the removed translation-template download action', () => {
    expect(languageSettingsItems.find((item) => item.id === 'lang.downloadTemplate')).toBeUndefined()
  })
})
