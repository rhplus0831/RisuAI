import { expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

export const nonEnglishLocales = ['cn', 'de', 'es', 'ko', 'vi', 'zh-Hant'] as const

export async function observeFirstComposerLabel(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const observation = { firstComposerLabel: null as string | null }
    Object.assign(window, { __localeStartupObservation: observation })
    new MutationObserver(() => {
      if (observation.firstComposerLabel !== null) return
      const composer = document.querySelector('[data-testid="default-chat-composer"]')
      if (composer) observation.firstComposerLabel = composer.getAttribute('aria-label')
    }).observe(document, { childList: true, subtree: true, attributes: true })
  })
}

/** Read emitted assets instead of assuming Vite's hashed chunk filenames. */
export function selectedLocaleAssets(): Map<string, string> {
  const manifest = JSON.parse(fs.readFileSync(path.resolve('dist/vite-assets-manifest.json'), 'utf8')) as Record<
    string,
    { file: string }
  >
  return new Map(
    nonEnglishLocales.map((locale) => {
      const entry = manifest[`src/lang/${locale}.ts`]
      expect(entry, `Expected independently loadable ${locale} locale`).toBeDefined()
      return [locale, entry.file]
    }),
  )
}
