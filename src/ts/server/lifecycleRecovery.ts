export type BrowserLifecycleRecoveryTrigger = 'visibility' | 'pageshow' | 'online' | 'focus'

export type BrowserLifecycleRecoveryListener = (trigger: BrowserLifecycleRecoveryTrigger) => void

const listeners = new Set<BrowserLifecycleRecoveryListener>()
let installed = false
let queued = false
let pendingTrigger: BrowserLifecycleRecoveryTrigger | null = null

function queueRecovery(trigger: BrowserLifecycleRecoveryTrigger): void {
  pendingTrigger = trigger
  if (queued) return
  queued = true
  queueMicrotask(() => {
    queued = false
    const next = pendingTrigger
    pendingTrigger = null
    if (!next) return
    for (const listener of [...listeners]) {
      try {
        listener(next)
      } catch (error) {
        console.error(error)
      }
    }
  })
}

const handleVisibilityChange = (): void => {
  if (document.visibilityState === 'visible') queueRecovery('visibility')
}
const handlePageShow = (): void => queueRecovery('pageshow')
const handleOnline = (): void => queueRecovery('online')
const handleFocus = (): void => queueRecovery('focus')

function installListeners(): void {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') return
  installed = true
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('pageshow', handlePageShow)
  window.addEventListener('online', handleOnline)
  window.addEventListener('focus', handleFocus)
}

function uninstallListeners(): void {
  if (!installed || typeof window === 'undefined' || typeof document === 'undefined') return
  installed = false
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.removeEventListener('pageshow', handlePageShow)
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('focus', handleFocus)
  queued = false
  pendingTrigger = null
}

/**
 * Subscribe to one coalesced browser foreground-recovery signal. Generation,
 * resource SSE, and future recovery domains share these physical listeners so
 * visibility + pageshow bursts enter one ordered recovery epoch.
 */
export function subscribeBrowserLifecycleRecovery(listener: BrowserLifecycleRecoveryListener): () => void {
  listeners.add(listener)
  installListeners()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) uninstallListeners()
  }
}
