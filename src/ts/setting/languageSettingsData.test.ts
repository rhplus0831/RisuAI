import { beforeEach, describe, expect, it, vi } from 'vitest'

const locale = vi.hoisted(() => ({ change: vi.fn<() => Promise<boolean>>() }))
vi.mock('src/lang', async (importOriginal) => ({
  ...(await importOriginal<typeof import('src/lang')>()),
  changeLanguage: locale.change,
}))

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

import { langState, languageSettingsItems } from './languageSettingsData.svelte'
import { alertError } from '../alert'

describe('language settings actions', () => {
  beforeEach(() => {
    locale.change.mockReset().mockResolvedValue(true)
    vi.mocked(alertError).mockClear()
    langState.changed = false
  })

  it('does not mark a language switch applied until its selected pack is ready', async () => {
    let finish!: (value: boolean) => void
    locale.change.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const item = languageSettingsItems.find((candidate) => candidate.id === 'lang.uiLanguage')!
    const changing = item.onChange!('ko', { db: { language: 'ko' } } as never)
    expect(langState.changed).toBe(false)
    expect(locale.change).toHaveBeenCalledWith('ko')
    finish(true)
    await changing
    expect(langState.changed).toBe(true)
  })

  it('does not mark a superseded selection applied', async () => {
    locale.change.mockResolvedValueOnce(false)
    const item = languageSettingsItems.find((candidate) => candidate.id === 'lang.uiLanguage')!
    await item.onChange!('ko', { db: { language: 'ko' } } as never)
    expect(langState.changed).toBe(false)
  })

  it('handles chunk failure at the settings action and permits retry', async () => {
    const failure = new Error('locale unavailable')
    locale.change.mockRejectedValueOnce(failure)
    const item = languageSettingsItems.find((candidate) => candidate.id === 'lang.uiLanguage')!
    await item.onChange!('ko', { db: { language: 'ko' } } as never)
    expect(langState.changed).toBe(false)
    expect(alertError).toHaveBeenCalledExactlyOnceWith(failure)
    await item.onChange!('ko', { db: { language: 'ko' } } as never)
    expect(langState.changed).toBe(true)
  })

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

  it('shows chain-of-thought exclusion only for active send-text-as-is LLM translation', () => {
    const item = languageSettingsItems.find((candidate) => candidate.id === 'lang.translatorExcludeThoughts')

    expect(item?.bindKey).toBe('translatorExcludeThoughts')
    expect(item?.getValue?.({ translatorExcludeThoughts: undefined } as never)).toBe(false)
    expect(item?.getValue?.({ translatorExcludeThoughts: true } as never)).toBe(true)
    expect(
      item?.condition?.({
        db: { translator: 'ko', translatorType: 'llm', translatorSendTextAsIs: true },
      } as never),
    ).toBe(true)
    expect(
      item?.condition?.({
        db: { translator: 'ko', translatorType: 'llm', translatorSendTextAsIs: false },
      } as never),
    ).toBe(false)
    expect(
      item?.condition?.({
        db: { translator: 'ko', translatorType: 'google', translatorSendTextAsIs: true },
      } as never),
    ).toBe(false)
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
