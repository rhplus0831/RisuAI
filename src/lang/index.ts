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
  if (
    lang === 'cn' ||
    lang === 'de' ||
    lang === 'es' ||
    lang === 'ko' ||
    lang === 'vi' ||
    lang === 'zh-Hant'
  ) {
    return lang
  }

  return 'en'
}

export function changeLanguage(lang: string) {
  const resolvedLanguageCode = resolveLanguageCode(lang)
  if (lastAppliedLanguageCode === resolvedLanguageCode) return

  if (resolvedLanguageCode === 'cn') {
    language = merge(safeStructuredClone(languageEnglish), languageChinese)
  } else if (resolvedLanguageCode === 'de') {
    language = merge(safeStructuredClone(languageEnglish), languageGerman)
  } else if (resolvedLanguageCode === 'ko') {
    language = merge(safeStructuredClone(languageEnglish), languageKorean)
  } else if (resolvedLanguageCode === 'vi') {
    language = merge(safeStructuredClone(languageEnglish), languageVietnamese)
  } else if (resolvedLanguageCode === 'zh-Hant') {
    language = merge(safeStructuredClone(languageEnglish), languageChineseTraditional)
  } else if (resolvedLanguageCode === 'es') {
    language = merge(safeStructuredClone(languageEnglish), languageSpanish)
  } else {
    language = languageEnglish
  }

  lastAppliedLanguageCode = resolvedLanguageCode
}
