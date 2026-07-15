import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const languageSettingsMocks = vi.hoisted(() => ({
  alertNormal: vi.fn(),
  alertSelect: vi.fn(),
  downloadFile: vi.fn(async (_name: string, _bytes: Uint8Array) => {}),
}))

vi.mock('../alert', () => ({
  alertConfirm: vi.fn(),
  alertError: vi.fn(),
  alertNormal: languageSettingsMocks.alertNormal,
  alertSelect: languageSettingsMocks.alertSelect,
  alertWait: vi.fn(),
}))

vi.mock('../globalApi.svelte', () => ({
  downloadFile: languageSettingsMocks.downloadFile,
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

import { changeLanguage, language } from 'src/lang'
import { languageKorean } from 'src/lang/ko'
import { languageSpanish } from 'src/lang/es'
import { getResourceDatabase, replaceResourceDatabase } from '../server/resourceState.svelte'
import { downloadLanguageTemplate, languageSettingsItems } from './languageSettingsData.svelte'

beforeEach(() => {
  languageSettingsMocks.alertNormal.mockReset()
  languageSettingsMocks.alertSelect.mockReset()
  languageSettingsMocks.downloadFile.mockClear()
  replaceResourceDatabase({ language: 'es' } as any)
  changeLanguage('es')
})

afterEach(() => {
  replaceResourceDatabase({} as any)
  changeLanguage('en')
})

describe('language settings actions', () => {
  it('keeps the translation-template action out of the persisted language values', () => {
    const languageSelect = languageSettingsItems.find((item) => item.id === 'lang.uiLanguage')
    const templateAction = languageSettingsItems.find((item) => item.id === 'lang.downloadTemplate')

    expect(languageSelect?.options?.selectOptions?.map((option) => option.value)).not.toContain('translang')
    expect(languageSelect?.options?.selectFallbackValue).toBe('en')
    expect(templateAction).toMatchObject({ type: 'button', labelKey: 'translateOwnLanguage' })
  })

  it('downloads an existing-language template without changing the persisted or active locale', async () => {
    languageSettingsMocks.alertSelect.mockResolvedValueOnce('0').mockResolvedValueOnce('1')

    await downloadLanguageTemplate()

    expect(getResourceDatabase().language).toBe('es')
    expect(language.UiLanguage).toBe(languageSpanish.UiLanguage)
    expect(languageSettingsMocks.downloadFile).toHaveBeenCalledOnce()
    const [name, bytes] = languageSettingsMocks.downloadFile.mock.calls[0]
    expect(name).toBe('lang.json')
    expect(JSON.parse(new TextDecoder().decode(bytes as Uint8Array)).UiLanguage).toBe(languageKorean.UiLanguage)
    expect(languageSettingsMocks.alertNormal).toHaveBeenCalledWith(language.translationTemplateDownloaded)
  })
})
