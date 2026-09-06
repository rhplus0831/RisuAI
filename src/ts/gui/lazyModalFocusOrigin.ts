interface LazyModalFocusOrigin {
  found: boolean
  origin: HTMLElement | null
}

const focusOrigins = new WeakMap<HTMLElement, HTMLElement | null>()

/**
 * Keep the original opener stable while a lazy modal swaps its loading,
 * failure, and loaded dialog implementations.
 */
export function lazyModalFocusOrigin(node: HTMLElement, enabled = true) {
  function register(): void {
    node.dataset.lazyModalFocusOrigin = 'true'
    focusOrigins.set(node, document.activeElement instanceof HTMLElement ? document.activeElement : null)
  }

  function unregister(): void {
    delete node.dataset.lazyModalFocusOrigin
    focusOrigins.delete(node)
  }

  if (enabled) register()

  return {
    update(nextEnabled: boolean) {
      if (nextEnabled && !focusOrigins.has(node)) register()
      if (!nextEnabled) unregister()
    },
    destroy() {
      unregister()
    },
  }
}

export function findLazyModalFocusOrigin(node: HTMLElement): LazyModalFocusOrigin {
  const host = node.closest<HTMLElement>('[data-lazy-modal-focus-origin="true"]')
  if (!host || !focusOrigins.has(host)) return { found: false, origin: null }
  return { found: true, origin: focusOrigins.get(host) ?? null }
}
