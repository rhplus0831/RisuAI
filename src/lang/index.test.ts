import { afterEach, describe, expect, it, vi } from 'vitest'

function cloneWithFunctions<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneWithFunctions(item)) as T
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneWithFunctions(item)])) as T
  }
  return value
}

function leafPaths(value: unknown, prefix = ''): string[] {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, item]) => leafPaths(item, prefix ? `${prefix}.${key}` : key))
  }

  return [prefix]
}

async function loadLanguageModule() {
  vi.resetModules()

  const cloneSpy = vi.fn(cloneWithFunctions)
  vi.stubGlobal('safeStructuredClone', cloneSpy)
  const langModule = await import('./index')
  const { languageEnglish } = await import('./en')
  const { languageKorean } = await import('./ko')
  const { languageGerman } = await import('./de')
  const { languageChinese } = await import('./cn')
  const { languageChineseTraditional } = await import('./zh-Hant')
  const { languageSpanish } = await import('./es')
  const { languageVietnamese } = await import('./vi')

  return {
    cloneSpy,
    langModule,
    languageEnglish,
    languageGerman,
    languageChinese,
    languageChineseTraditional,
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
  it('uses the requested chat-entry loading copy', async () => {
    const { languageEnglish } = await loadLanguageModule()

    expect(languageEnglish.loadingChat).toBe('Loading chat…')
  })

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

  it('L37: Korean uses translated model profile shell strings', async () => {
    const { langModule, languageEnglish, languageKorean } = await loadLanguageModule()

    langModule.changeLanguage('ko')

    expect(langModule.language.modelProfiles.settingsTitle).toBe(languageKorean.modelProfiles.settingsTitle)
    expect(langModule.language.modelProfiles.settingsTitle).not.toBe(languageEnglish.modelProfiles.settingsTitle)
    expect(langModule.language.modelProfiles.rolesTab).toBe(languageKorean.modelProfiles.rolesTab)
    expect(langModule.language.modelProfiles.bindingModes.profile).toBe(
      languageKorean.modelProfiles.bindingModes.profile,
    )
    expect(langModule.language.modelProfiles.providerNames['custom-api']).toBe(
      languageKorean.modelProfiles.providerNames['custom-api'],
    )
    expect(langModule.language.modelProfiles.providerNames['debug-echo']).toBe(
      languageKorean.modelProfiles.providerNames['debug-echo'],
    )
    expect(langModule.language.modelProfiles.statusReasons['profile-model-missing']).toBe(
      languageKorean.modelProfiles.statusReasons['profile-model-missing'],
    )
    expect(langModule.language.modelProfiles.runtimeFields.maxContext).toBe(
      languageKorean.modelProfiles.runtimeFields.maxContext,
    )
  })

  it('L37: Korean uses translated provider operation strings and formatters', async () => {
    const { langModule, languageEnglish, languageKorean } = await loadLanguageModule()

    langModule.changeLanguage('ko')

    expect(langModule.language.errors.imageGenerationResponseMalformed).toBe(
      languageKorean.errors.imageGenerationResponseMalformed,
    )
    expect(langModule.language.errors.imageGenerationResponseMalformed).not.toBe(
      languageEnglish.errors.imageGenerationResponseMalformed,
    )
    expect(langModule.language.errors.imageGenerationFailed(502)).toBe(languageKorean.errors.imageGenerationFailed(502))
    expect(langModule.language.waveSpeedCatalogModelsLoaded(3)).toBe(languageKorean.waveSpeedCatalogModelsLoaded(3))
  })

  it('defines every English translation path directly in Korean', async () => {
    const { languageEnglish, languageKorean } = await loadLanguageModule()
    const koreanPaths = new Set(leafPaths(languageKorean))

    expect(leafPaths(languageEnglish).filter((path) => !koreanPaths.has(path))).toEqual([])
  })

  it('defines every generation finalization state in every language pack', async () => {
    const {
      languageChinese,
      languageChineseTraditional,
      languageEnglish,
      languageGerman,
      languageKorean,
      languageSpanish,
      languageVietnamese,
    } = await loadLanguageModule()
    const keys = [
      'generationPersistenceQueued',
      'generationPersistenceStalled',
      'generationPersistenceTerminal',
      'generationPersistenceStalledLegacy',
    ] as const

    for (const pack of [
      languageEnglish,
      languageGerman,
      languageSpanish,
      languageVietnamese,
      languageChinese,
      languageChineseTraditional,
      languageKorean,
    ]) {
      for (const key of keys) expect(pack[key]).toEqual(expect.any(String))
    }
  })

  it('defines the acknowledged Stop lifecycle copy in every language pack', async () => {
    const {
      languageChinese,
      languageChineseTraditional,
      languageEnglish,
      languageGerman,
      languageKorean,
      languageSpanish,
      languageVietnamese,
    } = await loadLanguageModule()

    for (const pack of [
      languageEnglish,
      languageGerman,
      languageSpanish,
      languageVietnamese,
      languageChinese,
      languageChineseTraditional,
      languageKorean,
    ]) {
      expect(pack.generationStop).toMatchObject({
        stopping: expect.any(String),
        failed: expect.any(String),
        retry: expect.any(String),
        savingStoppedPartial: expect.any(String),
      })
    }
  })

  it('renders Vietnamese inlay counts without a stray template-literal dollar sign', async () => {
    const { languageVietnamese } = await loadLanguageModule()

    expect(languageVietnamese.playground.inlayDeleteMultipleConfirm.replace('{count}', '3')).toContain('3 tài sản')
    expect(languageVietnamese.playground.inlayTotalAssets.replace('{count}', '3')).toBe('Tổng cộng 3 tài sản')
  })
})
