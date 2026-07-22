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

  it('does not offer the retired global auto-translate setting', () => {
    expect(languageSettingsItems.find((item) => item.id === 'lang.autoTranslate')).toBeUndefined()
  })

  it('renders send-text-as-is as disabled when an existing database has no stored value', () => {
    const item = languageSettingsItems.find((candidate) => candidate.id === 'lang.translatorSendTextAsIs')

    expect(item?.bindKey).toBe('translatorSendTextAsIs')
    expect(item?.getValue?.({ translatorSendTextAsIs: undefined } as never)).toBe(false)
    expect(item?.getValue?.({ translatorSendTextAsIs: true } as never)).toBe(true)
  })

  it('uses the default history token limit for missing or invalid existing values', () => {
    const item = languageSettingsItems.find((candidate) => candidate.id === 'lang.translatorHistoryMaxTokens')

    expect(item?.bindKey).toBe('translatorHistoryMaxTokens')
    expect(item?.getValue?.({ translatorHistoryMaxTokens: undefined } as never)).toBe(2048)
    expect(item?.getValue?.({ translatorHistoryMaxTokens: 0 } as never)).toBe(2048)
    expect(item?.getValue?.({ translatorHistoryMaxTokens: Number.NaN } as never)).toBe(2048)
    expect(item?.getValue?.({ translatorHistoryMaxTokens: 512 } as never)).toBe(512)
  })
})
