import type { languageEnglish } from './en'
import { localeChunkUrls } from './localeChunkUrls'

export type DeferredLanguageCode = 'cn' | 'de' | 'es' | 'ko' | 'vi' | 'zh-Hant'
type LanguagePack = DeepPartial<typeof languageEnglish>
const failedAttempts = new Map<DeferredLanguageCode, number>()
const exportNames = {
  cn: 'languageChinese',
  de: 'languageGerman',
  es: 'languageSpanish',
  ko: 'languageKorean',
  vi: 'languageVietnamese',
  'zh-Hant': 'languageChineseTraditional',
} as const

/** Literal imports keep unselected packs outside both eager startup closures. */
function importLanguagePack(code: DeferredLanguageCode) {
  switch (code) {
    case 'cn':
      return import('./cn').then((pack) => pack.languageChinese)
    case 'de':
      return import('./de').then((pack) => pack.languageGerman)
    case 'es':
      return import('./es').then((pack) => pack.languageSpanish)
    case 'ko':
      return import('./ko').then((pack) => pack.languageKorean)
    case 'vi':
      return import('./vi').then((pack) => pack.languageVietnamese)
    case 'zh-Hant':
      return import('./zh-Hant').then((pack) => pack.languageChineseTraditional)
  }
}

/** A new URL bypasses the browser module map's cached failed fetch on an explicit retry. */
export function localeRetryUrl(chunkUrl: string, attempt: number, ownerUrl: string): string {
  const url = new URL(chunkUrl, ownerUrl)
  url.searchParams.set('localeRetry', String(attempt))
  return url.href
}

export async function loadLanguagePack(code: DeferredLanguageCode): Promise<LanguagePack> {
  const attempt = failedAttempts.get(code) ?? 0
  try {
    if (attempt === 0) return await importLanguagePack(code)
    const url = localeRetryUrl(localeChunkUrls[code], attempt, import.meta.url)
    const module: Partial<Record<(typeof exportNames)[DeferredLanguageCode], LanguagePack>> = await import(
      /* @vite-ignore */ url
    )
    const pack = module[exportNames[code]]
    if (!pack) throw new Error(`Locale chunk is missing its ${code} language pack`)
    return pack
  } catch (error) {
    failedAttempts.set(code, attempt + 1)
    throw error
  }
}
