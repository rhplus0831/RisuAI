const VIEWPORT_DEBUG_QUERY_PARAMETER = 'risuViewportDebug'
const VIEWPORT_DEBUG_STORAGE_KEY = 'risu-viewport-debug'

interface ViewportDebugOverlayModule {
  installViewportDebugOverlay: () => () => void
}

interface ViewportDebugOverlayGateOptions {
  search?: string
  readStoredFlag?: () => string | null
  loadOverlay?: () => Promise<ViewportDebugOverlayModule>
}

function readStoredViewportDebugFlag(): string | null {
  try {
    return window.localStorage.getItem(VIEWPORT_DEBUG_STORAGE_KEY)
  } catch {
    return null
  }
}

export function isViewportDebugOverlayEnabled(
  search = window.location.search,
  readStoredFlag: () => string | null = readStoredViewportDebugFlag,
): boolean {
  if (new URLSearchParams(search).get(VIEWPORT_DEBUG_QUERY_PARAMETER) === '1') return true
  return readStoredFlag() === '1'
}

export async function installViewportDebugOverlayIfEnabled(
  options: ViewportDebugOverlayGateOptions = {},
): Promise<(() => void) | undefined> {
  if (!isViewportDebugOverlayEnabled(options.search, options.readStoredFlag)) return undefined
  const overlay = await (options.loadOverlay?.() ?? import('./viewportDebugOverlay'))
  return overlay.installViewportDebugOverlay()
}
