import { afterEach, describe, expect, it, vi } from 'vitest'
import { CUSTOM_CSS_CACHE_KEY } from './gui/customCSSCache'

afterEach(() => {
  document.querySelector('#customcss')?.remove()
  localStorage.clear()
  vi.resetModules()
})

describe('CustomCSSStore startup', () => {
  it('paints cached CSS before server hydration', async () => {
    const cachedCSS = 'body { background: rgb(1, 2, 3); }'
    localStorage.setItem(CUSTOM_CSS_CACHE_KEY, cachedCSS)

    const { CustomCSSStore } = await import('./stores.svelte')
    let currentCSS = ''
    const unsubscribe = CustomCSSStore.subscribe((css) => {
      currentCSS = css
    })

    expect(currentCSS).toBe(cachedCSS)
    expect(document.querySelector<HTMLStyleElement>('#customcss')?.innerHTML).toBe(cachedCSS)
    unsubscribe()
  })
})
