import { describe, expect, it } from 'vitest'

import { languageChinese } from './cn'
import { languageGerman } from './de'
import { languageEnglish } from './en'
import { languageSpanish } from './es'
import { languageKorean } from './ko'
import { languageVietnamese } from './vi'
import { languageChineseTraditional } from './zh-Hant'

const languages = [
  ['English', languageEnglish],
  ['Chinese', languageChinese],
  ['German', languageGerman],
  ['Spanish', languageSpanish],
  ['Korean', languageKorean],
  ['Vietnamese', languageVietnamese],
  ['Traditional Chinese', languageChineseTraditional],
] as const

function placeholders(template: string): string[] {
  return Array.from(template.matchAll(/{{(.+?)}}/g), (match) => match[1]).sort()
}

describe('trigger description placeholders', () => {
  it.each(languages)('%s array insertion summaries reference fields stored by their effects', (_name, lang) => {
    expect(placeholders(lang.triggerDesc.v2UnshiftArrayVarDesc)).toEqual(['value', 'var'])
    expect(placeholders(lang.triggerDesc.v2SpliceArrayVarDesc)).toEqual(['item', 'start', 'var'])
  })
})
