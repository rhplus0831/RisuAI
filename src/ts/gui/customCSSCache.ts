export const CUSTOM_CSS_CACHE_KEY = 'risu-custom-css-v1'

function browserLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** Read the display-only CSS cache without making startup depend on browser storage. */
export function readCachedCustomCSS(): string {
  try {
    return browserLocalStorage()?.getItem(CUSTOM_CSS_CACHE_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Reconcile the display-only cache with the current server-backed setting. */
export function cacheCustomCSS(css: string): boolean {
  try {
    const storage = browserLocalStorage()
    if (!storage || storage.getItem(CUSTOM_CSS_CACHE_KEY) === css) return false
    storage.setItem(CUSTOM_CSS_CACHE_KEY, css)
    return true
  } catch {
    return false
  }
}
