import { afterEach, describe, expect, it, vi } from 'vitest'

function cloneWithFunctions<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneWithFunctions(item)) as T
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneWithFunctions(item)])) as T
  }
  return value
}

async function loadLanguageModule() {
  vi.resetModules()

  const cloneSpy = vi.fn(cloneWithFunctions)
  vi.stubGlobal('safeStructuredClone', cloneSpy)
  const langModule = await import('./index')
  const { languageEnglish } = await import('./en')
  const { languageKorean } = await import('./ko')
  const { languageSpanish } = await import('./es')
  const { languageVietnamese } = await import('./vi')

  return {
    cloneSpy,
    langModule,
    languageEnglish,
    languageKorean,
    languageSpanish,
    languageVietnamese,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('changeLanguage same-code cache', () => {
  it('L37: repeated same-code changeLanguage calls reuse the applied language object without clone work', async () => {
    const { cloneSpy, langModule, languageKorean } = await loadLanguageModule()

    langModule.changeLanguage('ko')
    const firstKoreanLanguage = langModule.language

    expect(firstKoreanLanguage.formating.main).toBe(languageKorean.formating.main)
    expect(cloneSpy).toHaveBeenCalledTimes(1)

    langModule.changeLanguage('ko')
    langModule.changeLanguage('ko')

    expect(langModule.language).toBe(firstKoreanLanguage)
    expect(langModule.language.formating.main).toBe(languageKorean.formating.main)
    expect(cloneSpy).toHaveBeenCalledTimes(1)
  })

  it('L37: switching between languages rebuilds language objects and merged strings', async () => {
    const { cloneSpy, langModule, languageKorean, languageSpanish } = await loadLanguageModule()

    langModule.changeLanguage('ko')
    const koreanLanguage = langModule.language

    expect(koreanLanguage.formating.main).toBe(languageKorean.formating.main)

    langModule.changeLanguage('es')
    const spanishLanguage = langModule.language

    expect(spanishLanguage).not.toBe(koreanLanguage)
    expect(spanishLanguage.formating.main).toBe(languageSpanish.formating.main)
    expect(spanishLanguage.errors.toomuchtoken).toBe(languageSpanish.errors.toomuchtoken)
    expect(cloneSpy).toHaveBeenCalledTimes(2)
  })

  it('L37: switching back to English changes identity once and then reuses the English object', async () => {
    const { cloneSpy, langModule, languageEnglish } = await loadLanguageModule()

    langModule.changeLanguage('ko')
    const koreanLanguage = langModule.language

    langModule.changeLanguage('en')
    const englishLanguage = langModule.language

    expect(englishLanguage).toBe(languageEnglish)
    expect(englishLanguage).not.toBe(koreanLanguage)
    expect(englishLanguage.formating.main).toBe(languageEnglish.formating.main)
    expect(cloneSpy).toHaveBeenCalledTimes(1)

    langModule.changeLanguage('en')

    expect(langModule.language).toBe(englishLanguage)
    expect(cloneSpy).toHaveBeenCalledTimes(1)
  })

  it('L37: unknown language codes resolve to English and share the English cache key', async () => {
    const { cloneSpy, langModule, languageEnglish } = await loadLanguageModule()

    langModule.changeLanguage('unknown-language')
    const firstFallbackLanguage = langModule.language

    expect(firstFallbackLanguage).toBe(languageEnglish)
    expect(firstFallbackLanguage.formating.main).toBe(languageEnglish.formating.main)
    expect(cloneSpy).toHaveBeenCalledTimes(0)

    langModule.changeLanguage('en')
    langModule.changeLanguage('still-unknown')

    expect(langModule.language).toBe(firstFallbackLanguage)
    expect(cloneSpy).toHaveBeenCalledTimes(0)

    langModule.changeLanguage('ko')
    const koreanLanguage = langModule.language

    langModule.changeLanguage('not-a-supported-language')
    const fallbackAfterSwitch = langModule.language

    expect(fallbackAfterSwitch).toBe(languageEnglish)
    expect(fallbackAfterSwitch).not.toBe(koreanLanguage)
    expect(cloneSpy).toHaveBeenCalledTimes(1)

    langModule.changeLanguage('another-unknown-language')
    langModule.changeLanguage('en')

    expect(langModule.language).toBe(fallbackAfterSwitch)
    expect(cloneSpy).toHaveBeenCalledTimes(1)
  })

  it('L37: non-English languages inherit model profile shell strings from English', async () => {
    const { langModule, languageEnglish } = await loadLanguageModule()

    langModule.changeLanguage('ko')

    expect(langModule.language.modelProfiles.settingsTitle).toBe(languageEnglish.modelProfiles.settingsTitle)
    expect(langModule.language.modelProfiles.rolesTab).toBe(languageEnglish.modelProfiles.rolesTab)
    expect(langModule.language.modelProfiles.bindingModes.profile).toBe(
      languageEnglish.modelProfiles.bindingModes.profile,
    )
    expect(langModule.language.modelProfiles.providerNames['custom-api']).toBe(
      languageEnglish.modelProfiles.providerNames['custom-api'],
    )
    expect(langModule.language.modelProfiles.providerNames['debug-echo']).toBe(
      languageEnglish.modelProfiles.providerNames['debug-echo'],
    )
    expect(langModule.language.modelProfiles.statusReasons['profile-model-missing']).toBe(
      languageEnglish.modelProfiles.statusReasons['profile-model-missing'],
    )
    expect(langModule.language.modelProfiles.runtimeFields.maxContext).toBe(
      languageEnglish.modelProfiles.runtimeFields.maxContext,
    )
  })

  it('L37: non-English languages inherit provider operation error strings and formatters from English', async () => {
    const { langModule, languageEnglish } = await loadLanguageModule()

    langModule.changeLanguage('ko')

    expect(langModule.language.errors.imageGenerationResponseMalformed).toBe(
      languageEnglish.errors.imageGenerationResponseMalformed,
    )
    expect(langModule.language.errors.imageGenerationFailed(502)).toBe(
      languageEnglish.errors.imageGenerationFailed(502),
    )
    expect(langModule.language.waveSpeedCatalogModelsLoaded(3)).toBe(languageEnglish.waveSpeedCatalogModelsLoaded(3))
  })

  it('renders Vietnamese inlay counts without a stray template-literal dollar sign', async () => {
    const { languageVietnamese } = await loadLanguageModule()

    expect(languageVietnamese.playground.inlayDeleteMultipleConfirm.replace('{count}', '3')).toContain('3 tài sản')
    expect(languageVietnamese.playground.inlayTotalAssets.replace('{count}', '3')).toBe('Tổng cộng 3 tài sản')
  })
})
