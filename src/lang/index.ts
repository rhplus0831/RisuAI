import merge from 'lodash/merge'
import { languageEnglish } from './en'
import { loadLanguagePack, type DeferredLanguageCode } from './loadLanguagePack'

type Language = typeof languageEnglish
type ResolvedLanguageCode = 'en' | DeferredLanguageCode

let trackLanguageRead = () => {}
const languageListeners = new Set<() => void>()
const selectionListeners = new Set<() => void>()

/** Installed by the application runtime; the entry fallback has no framework dependency. */
export function observeLanguageReads(track: () => void): void {
  trackLanguageRead = track
}

export function subscribeLanguageChanges(listener: () => void): () => void {
  languageListeners.add(listener)
  return () => languageListeners.delete(listener)
}

function observableLanguage(pack: Language): Language {
  return new Proxy(pack, {
    get(target, key, receiver) {
      trackLanguageRead()
      return Reflect.get(target, key, receiver)
    },
  })
}

const englishFallback = observableLanguage(languageEnglish)
export let language: Language = englishFallback

const loadedLanguages = new Map<ResolvedLanguageCode, Language>([['en', englishFallback]])
const pendingLanguages = new Map<ResolvedLanguageCode, Promise<Language>>()
let lastAppliedLanguageCode: ResolvedLanguageCode = 'en'
let selectionToken = 0
let languageReady: Promise<boolean> = Promise.resolve(true)

function resolveLanguageCode(lang: string): ResolvedLanguageCode {
  if (lang === 'cn' || lang === 'de' || lang === 'es' || lang === 'ko' || lang === 'vi' || lang === 'zh-Hant') {
    return lang
  }
  return 'en'
}

/** Load only the requested pack, retaining English for missing translation keys. */
export function getLanguageForCode(lang: string): Promise<Language> {
  const code = resolveLanguageCode(lang)
  const loaded = loadedLanguages.get(code)
  if (loaded) return Promise.resolve(loaded)
  const pending = pendingLanguages.get(code)
  if (pending) return pending
  if (code === 'en') return Promise.resolve(englishFallback)

  const loading = loadLanguagePack(code)
    .then((pack) => {
      const merged = observableLanguage(merge(safeStructuredClone(languageEnglish), pack))
      loadedLanguages.set(code, merged)
      return merged
    })
    .finally(() => {
      pendingLanguages.delete(code)
    })
  pendingLanguages.set(code, loading)
  return loading
}

function applyLanguage(code: ResolvedLanguageCode, pack: Language): void {
  if (lastAppliedLanguageCode === code) return
  language = pack
  lastAppliedLanguageCode = code
  for (const listener of languageListeners) listener()
}

/** English/cached packs apply synchronously; a pending selection never replaces a newer one. */
export function changeLanguage(lang: string): Promise<boolean> {
  const code = resolveLanguageCode(lang)
  const token = ++selectionToken
  const loaded = loadedLanguages.get(code)
  if (loaded) {
    applyLanguage(code, loaded)
    languageReady = Promise.resolve(true)
  } else {
    languageReady = getLanguageForCode(code).then(
      (pack) => {
        if (token !== selectionToken) return false
        applyLanguage(code, pack)
        return true
      },
      (error) => {
        if (token !== selectionToken) return false
        throw error
      },
    )
  }
  // Synchronous resource setters start loading without awaiting it. Keep their
  // detached failures handled while readiness/runtime callers can still reject.
  void languageReady.catch(() => {})
  for (const listener of selectionListeners) listener()
  return languageReady
}

/** Cancel only a still-current selection owned by a surface that was destroyed. */
export function cancelLanguageChange(pending: Promise<boolean>): void {
  if (pending !== languageReady) return
  selectionToken += 1
  languageReady = Promise.resolve(true)
  for (const listener of selectionListeners) listener()
}

/** Follow replacements while waiting; a failed current import remains retryable. */
export async function awaitLanguageReady(): Promise<void> {
  for (;;) {
    const pending = languageReady
    let selectionChanged!: () => void
    const changed = new Promise<void>((resolve) => {
      selectionChanged = resolve
      selectionListeners.add(resolve)
    })
    try {
      await Promise.race([pending, changed])
    } catch (error) {
      if (pending === languageReady) throw error
    } finally {
      selectionListeners.delete(selectionChanged)
    }
    if (pending === languageReady) return
  }
}
