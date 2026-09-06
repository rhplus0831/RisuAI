import { afterEach, describe, expect, it, vi } from 'vitest'
import { CUSTOM_CSS_CACHE_KEY, cacheCustomCSS, readCachedCustomCSS } from './customCSSCache'

function installStorage(initial: Record<string, string> = {}): { storage: Storage; values: Map<string, string> } {
  const values = new Map(Object.entries(initial))
  const storage: Storage = {
    get length() {
      return values.size
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    removeItem: vi.fn((key: string) => values.delete(key)),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  }
  vi.stubGlobal('localStorage', storage)
  return { storage, values }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('custom CSS paint cache', () => {
  it('reads the cached CSS synchronously', () => {
    installStorage({ [CUSTOM_CSS_CACHE_KEY]: 'body { color: teal; }' })

    expect(readCachedCustomCSS()).toBe('body { color: teal; }')
  })

  it('writes changed server CSS and skips an unchanged value', () => {
    const { storage, values } = installStorage({ [CUSTOM_CSS_CACHE_KEY]: 'body { color: teal; }' })

    expect(cacheCustomCSS('body { color: teal; }')).toBe(false)
    expect(storage.setItem).not.toHaveBeenCalled()

    expect(cacheCustomCSS('body { color: purple; }')).toBe(true)
    expect(values.get(CUSTOM_CSS_CACHE_KEY)).toBe('body { color: purple; }')
    expect(storage.setItem).toHaveBeenCalledOnce()
  })

  it('caches an empty server value so stale CSS is cleared on the next refresh', () => {
    const { values } = installStorage({ [CUSTOM_CSS_CACHE_KEY]: 'body { color: teal; }' })

    expect(cacheCustomCSS('')).toBe(true)
    expect(values.get(CUSTOM_CSS_CACHE_KEY)).toBe('')
  })

  it('treats unavailable browser storage as a silent cache miss', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => {
        throw new Error('blocked')
      }),
      setItem: vi.fn(() => {
        throw new Error('blocked')
      }),
    })

    expect(readCachedCustomCSS()).toBe('')
    expect(cacheCustomCSS('body {}')).toBe(false)
  })
})
