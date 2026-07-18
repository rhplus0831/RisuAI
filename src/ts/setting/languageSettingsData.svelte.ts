/**
 * Language Settings Data
 *
 * Data-driven definition for LanguageSettings page.
 * Uses `.svelte.ts` extension to support reactive `langState` via Svelte 5 runes.
 */

import type { SettingItem } from './types'
import { changeLanguage, getLanguageForCode, language } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { sleep } from '../util'
import { alertNormal, alertSelect, alertConfirm, alertError, alertWait } from '../alert'
import { downloadFile } from '../globalApi.svelte'
import { selectFileByDom } from '../util'
import { exportLLMCacheAsJSON, importLLMCacheFromJSON, clearLLMCache } from '../translator/translator'

export const langState = $state({ changed: false })

export async function downloadLanguageTemplate(): Promise<void> {
  const selection = await alertSelect([language.continueTranslatingLanguage, language.makeNewLanguage])
  if (selection === null) return
  const choice = Number(selection)

  if (choice === 0) {
    const languages = ['de', 'es', 'ko', 'cn', 'vi', 'zh-Hant']
    const languageSelection = await alertSelect(languages)
    if (languageSelection === null) return
    const selectedLanguage = languages[Number(languageSelection)]
    if (!selectedLanguage) return
    const selectedLanguageTemplate = getLanguageForCode(selectedLanguage)
    await downloadFile('lang.json', new TextEncoder().encode(JSON.stringify(selectedLanguageTemplate, null, 4)))
  } else if (choice === 1) {
    await downloadFile('lang.json', new TextEncoder().encode(JSON.stringify(languageEnglish, null, 4)))
  } else {
    return
  }

  alertNormal(language.translationTemplateDownloaded)
}

export const languageSettingsItems: SettingItem[] = [
  {
    id: 'lang.header',
    type: 'header',
    labelKey: 'language',
    options: { level: 'h2' },
  },

  // UI Language
  {
    id: 'lang.uiLanguage',
    type: 'select',
    labelKey: 'UiLanguage',
    bindKey: 'language',
    classes: 'mt-4',
    options: {
      selectFallbackValue: 'en',
      selectOptions: [
        { value: 'de', label: 'Deutsch' },
        { value: 'en', label: 'English' },
        { value: 'es', label: 'Español' },
        { value: 'ko', label: '한국어' },
        { value: 'cn', label: '中文' },
        { value: 'zh-Hant', label: '中文(繁體)' },
        { value: 'vi', label: 'Tiếng Việt' },
      ],
    },
    onChange: async (val, ctx) => {
      await sleep(10)
      changeLanguage(ctx.db.language)
      langState.changed = true
    },
  },

  {
    id: 'lang.downloadTemplate',
    type: 'button',
    labelKey: 'translateOwnLanguage',
    classes: 'mt-2',
    options: { onClick: downloadLanguageTemplate },
  },

  {
    id: 'lang.restartWarn',
    type: 'header',
    fallbackLabel: 'Close the settings to take effect',
    options: { level: 'span' },
    classes: 'bg-red-500 text-sm',
    condition: () => langState.changed,
  },

  // Translator Base
  {
    id: 'lang.translatorLang',
    type: 'select',
    labelKey: 'translatorLanguage',
    bindKey: 'translator',
    classes: 'mt-4',
    options: {
      selectFallbackValue: '',
      selectOptions: [
        { value: '', labelKey: 'disabled' },
        { value: 'ko', label: 'Korean' },
        { value: 'ru', label: 'Russian' },
        { value: 'zh', label: 'Chinese' },
        { value: 'zh-TW', label: 'Chinese (Traditional)' },
        { value: 'fa', label: 'Persian (Farsi)' },
        { value: 'ja', label: 'Japanese' },
        { value: 'fr', label: 'French' },
        { value: 'es', label: 'Spanish' },
        { value: 'pt', label: 'Portuguese' },
        { value: 'de', label: 'German' },
        { value: 'id', label: 'Indonesian' },
        { value: 'ms', label: 'Malaysian' },
        { value: 'uk', label: 'Ukranian' },
      ],
    },
  },

  {
    id: 'lang.translatorType',
    type: 'select',
    labelKey: 'translatorType',
    bindKey: 'translatorType',
    classes: 'mt-4',
    condition: (ctx) => !!ctx.db.translator,
    options: {
      selectOptions: [
        { value: 'google', label: 'Google' },
        { value: 'deepl', label: 'DeepL' },
        { value: 'llm', label: 'Ax. Model' },
        { value: 'deeplX', label: 'DeepL X' },
      ],
    },
  },

  // Translator Specific Configurations
  {
    id: 'lang.deeplWebWarn',
    type: 'header',
    labelKey: 'webdeeplwarn',
    options: { level: 'warning' },
    condition: (ctx) => !!ctx.db.translator && ctx.db.translatorType === 'deepl',
  },

  {
    id: 'lang.deeplKey',
    type: 'text',
    labelKey: 'deeplKey',
    bindPath: 'deeplOptions.key',
    classes: 'mt-4',
    options: { hideText: true },
    condition: (ctx) => !!ctx.db.translator && ctx.db.translatorType === 'deepl',
  },

  {
    id: 'lang.deeplFree',
    type: 'check',
    labelKey: 'deeplFreeKey',
    bindPath: 'deeplOptions.freeApi',
    classes: 'mt-2',
    condition: (ctx) => !!ctx.db.translator && ctx.db.translatorType === 'deepl',
  },

  {
    id: 'lang.deeplXUrl',
    type: 'text',
    labelKey: 'deeplXUrl',
    bindPath: 'deeplXOptions.url',
    classes: 'mt-4',
    condition: (ctx) => !!ctx.db.translator && ctx.db.translatorType === 'deeplX',
  },

  {
    id: 'lang.deeplXToken',
    type: 'text',
    labelKey: 'deeplXToken',
    bindPath: 'deeplXOptions.token',
    classes: 'mt-4',
    options: { hideText: true },
    condition: (ctx) => !!ctx.db.translator && ctx.db.translatorType === 'deeplX',
  },

  {
    id: 'lang.llmPresets',
    type: 'custom',
    componentId: 'TranslatorPresetSettings',
    condition: (ctx) => !!ctx.db.translator && ctx.db.translatorType === 'llm',
  },

  {
    id: 'lang.inputTranslatorPrompt',
    type: 'textarea',
    labelKey: 'inputTranslatorPrompt',
    bindKey: 'inputTranslatorPrompt',
    helpKey: 'inputTranslatorPrompt',
    classes: 'mt-4',
  },

  {
    id: 'lang.googleSourceLang',
    type: 'select',
    labelKey: 'sourceLanguage',
    bindKey: 'translatorInputLanguage',
    classes: 'mt-4',
    condition: (ctx) => !!ctx.db.translator && ctx.db.translatorType === 'google',
    options: {
      selectOptions: [
        { value: 'auto', label: 'Auto' },
        { value: 'en', label: 'English' },
        { value: 'zh', label: 'Chinese' },
        { value: 'ja', label: 'Japanese' },
        { value: 'ko', label: 'Korean' },
        { value: 'fr', label: 'French' },
        { value: 'es', label: 'Spanish' },
        { value: 'de', label: 'German' },
        { value: 'ru', label: 'Russian' },
      ],
    },
  },

  // General Translation Options
  {
    id: 'lang.autoTranslate',
    type: 'check',
    labelKey: 'autoTranslation',
    bindKey: 'autoTranslate',
    classes: 'mt-2',
    condition: (ctx) => !!ctx.db.translator,
  },

  {
    id: 'lang.combineTranslation',
    type: 'check',
    labelKey: 'combineTranslation',
    bindKey: 'combineTranslation',
    helpKey: 'combineTranslation',
    classes: 'mt-4',
    condition: (ctx) => !!ctx.db.translator,
  },

  {
    id: 'lang.legacyTranslation',
    type: 'check',
    labelKey: 'legacyTranslation',
    bindKey: 'legacyTranslation',
    helpKey: 'legacyTranslation',
    classes: 'mt-4',
    condition: (ctx) => !!ctx.db.translator,
  },

  {
    id: 'lang.translateBeforeHTML',
    type: 'check',
    labelKey: 'translateBeforeHTMLFormatting',
    bindKey: 'translateBeforeHTMLFormatting',
    helpKey: 'translateBeforeHTMLFormatting',
    classes: 'mt-4',
    condition: (ctx) => !!ctx.db.translator && ctx.db.translatorType === 'llm',
  },

  {
    id: 'lang.autoTranslateCachedOnly',
    type: 'check',
    labelKey: 'autoTranslateCachedOnly',
    bindKey: 'autoTranslateCachedOnly',
    helpKey: 'autoTranslateCachedOnly',
    classes: 'mt-4',
    condition: (ctx) => !!ctx.db.translator && ctx.db.translatorType === 'llm',
  },

  // Translation Cache
  {
    id: 'lang.exportCache',
    type: 'button',
    labelKey: 'exportTranslationCache',
    classes: 'mt-4',
    condition: (ctx) => !!ctx.db.translator && ctx.db.translatorType === 'llm',
    options: {
      onClick: async () => {
        alertWait(language.loading)
        try {
          const cache = await exportLLMCacheAsJSON()
          const entries = Object.keys(cache).length
          if (entries === 0) {
            alertNormal(language.exportTranslationCacheEmpty)
            return
          }
          const json = JSON.stringify(cache, null, 2)
          await downloadFile('translation_cache.json', new TextEncoder().encode(json))
          alertNormal(language.exportTranslationCacheSuccess)
        } catch (e: any) {
          alertError(e.message)
        }
      },
    },
  },

  {
    id: 'lang.importCache',
    type: 'button',
    labelKey: 'importTranslationCache',
    classes: 'mt-2',
    condition: (ctx) => !!ctx.db.translator && ctx.db.translatorType === 'llm',
    options: {
      onClick: async () => {
        try {
          const files = await selectFileByDom(['.json'])
          if (!files || files.length === 0) return
          if (!files[0].name.endsWith('.json')) {
            alertError('Invalid file type. Please select a .json file.')
            return
          }
          const text = await files[0].text()
          const data = JSON.parse(text)
          if (typeof data !== 'object' || Array.isArray(data)) {
            alertError('Invalid JSON format')
            return
          }
          for (const [key, value] of Object.entries(data)) {
            if (typeof key !== 'string' || typeof value !== 'string') {
              alertError('Invalid JSON format')
              return
            }
          }
          const confirmed = await alertConfirm(language.importTranslationCacheConfirm)
          if (!confirmed) return
          alertWait(language.loading)
          const { count, failed } = await importLLMCacheFromJSON(data as Record<string, string>)
          if (failed > 0) {
            alertError(
              language.importTranslationCacheFailed.replace('{0}', String(count)).replace('{1}', String(failed)),
            )
          } else {
            alertNormal(language.importTranslationCacheSuccess.replace('{0}', String(count)))
          }
        } catch (e: any) {
          alertError(e.message)
        }
      },
    },
  },

  {
    id: 'lang.clearCache',
    type: 'button',
    labelKey: 'clearTranslationCache',
    classes: 'mt-2',
    condition: (ctx) => !!ctx.db.translator && ctx.db.translatorType === 'llm',
    options: {
      onClick: async () => {
        try {
          const confirmed = await alertConfirm(language.clearTranslationCacheConfirm)
          if (!confirmed) return
          alertWait(language.loading)
          await clearLLMCache()
          alertNormal(language.clearTranslationCacheSuccess)
        } catch (e: any) {
          alertError(e.message)
        }
      },
    },
  },
]
