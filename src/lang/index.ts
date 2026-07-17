import merge from 'lodash/merge'
import { languageChinese } from './cn'
import { languageGerman } from './de'
import { languageEnglish } from './en'
import { languageKorean } from './ko'
import { languageVietnamese } from './vi'
import { languageChineseTraditional } from './zh-Hant'
import { languageSpanish } from './es'

export let language: typeof languageEnglish = languageEnglish

type ResolvedLanguageCode = 'cn' | 'de' | 'en' | 'es' | 'ko' | 'vi' | 'zh-Hant'

let lastAppliedLanguageCode: ResolvedLanguageCode | undefined

function resolveLanguageCode(lang: string): ResolvedLanguageCode {
  if (lang === 'cn' || lang === 'de' || lang === 'es' || lang === 'ko' || lang === 'vi' || lang === 'zh-Hant') {
    return lang
  }

  return 'en'
}

export function getLanguageForCode(lang: string): typeof languageEnglish {
  const resolvedLanguageCode = resolveLanguageCode(lang)

  if (resolvedLanguageCode === 'cn') {
    return merge(safeStructuredClone(languageEnglish), languageChinese)
  }
  if (resolvedLanguageCode === 'de') {
    return merge(safeStructuredClone(languageEnglish), languageGerman)
  }
  if (resolvedLanguageCode === 'ko') {
    return merge(safeStructuredClone(languageEnglish), languageKorean)
  }
  if (resolvedLanguageCode === 'vi') {
    return merge(safeStructuredClone(languageEnglish), languageVietnamese)
  }
  if (resolvedLanguageCode === 'zh-Hant') {
    return merge(safeStructuredClone(languageEnglish), languageChineseTraditional)
  }
  if (resolvedLanguageCode === 'es') {
    return merge(safeStructuredClone(languageEnglish), languageSpanish)
  }
  return languageEnglish
}

export function changeLanguage(lang: string) {
  const resolvedLanguageCode = resolveLanguageCode(lang)
  if (lastAppliedLanguageCode === resolvedLanguageCode) return

  language = getLanguageForCode(resolvedLanguageCode)
  lastAppliedLanguageCode = resolvedLanguageCode
}
