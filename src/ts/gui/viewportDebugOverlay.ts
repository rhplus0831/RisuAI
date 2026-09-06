const BUFFER_LIMIT = 50
const RENDERED_TAIL_LENGTH = 8
const FOCUSED_POLL_INTERVAL_MS = 200
const HEIGHT_PROPERTY = '--risu-visual-viewport-height'
const ACTIVE_ATTRIBUTE = 'data-risu-visual-viewport-active'
const TEXT_ENTRY_INPUT_TYPES = new Set([
  'date',
  'datetime-local',
  'email',
  'month',
  'number',
  'password',
  'search',
  'tel',
  'text',
  'time',
  'url',
  'week',
])

interface ViewportDebugEntry {
  timestamp: number
  event: string
  visualViewportHeight: number | null
  visualViewportOffsetTop: number | null
  visualViewportPageTop: number | null
  windowScrollY: number
  windowInnerHeight: number
  appliedHeight: string
  adjustmentActive: boolean
  activeElement: string
}

declare global {
  interface Window {
    __RISU_VIEWPORT_DEBUG_DUMP__?: () => string
  }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatNumber(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(1)
}

function activeElementLabel(): string {
  const activeElement = document.activeElement
  if (!(activeElement instanceof Element)) return 'none'
  const tag = activeElement.tagName.toLowerCase()
  const type = activeElement instanceof HTMLInputElement ? `[type=${activeElement.type}]` : ''
  return `${tag}${type}`
}

function isTextEntryFocused(): boolean {
  const activeElement = document.activeElement
  if (activeElement instanceof HTMLTextAreaElement) return !activeElement.disabled && !activeElement.readOnly
  if (activeElement instanceof HTMLInputElement) {
    return !activeElement.disabled && !activeElement.readOnly && TEXT_ENTRY_INPUT_TYPES.has(activeElement.type)
  }
  return activeElement instanceof HTMLElement && activeElement.isContentEditable
}

function takeSnapshot(event: string): ViewportDebugEntry {
  const visualViewport = window.visualViewport
  const root = document.documentElement
  return {
    timestamp: Math.round(performance.now() * 10) / 10,
    event,
    visualViewportHeight: finiteNumber(visualViewport?.height),
    visualViewportOffsetTop: finiteNumber(visualViewport?.offsetTop),
    visualViewportPageTop: finiteNumber(visualViewport?.pageTop),
    windowScrollY: window.scrollY,
    windowInnerHeight: window.innerHeight,
    appliedHeight: root.style.getPropertyValue(HEIGHT_PROPERTY) || 'unset',
    adjustmentActive: root.getAttribute(ACTIVE_ATTRIBUTE) === 'true',
    activeElement: activeElementLabel(),
  }
}

export function installViewportDebugOverlay(): () => void {
  const entries: ViewportDebugEntry[] = []
  const panel = document.createElement('pre')
  panel.dataset.risuViewportDebugOverlay = 'true'
  panel.setAttribute('aria-hidden', 'true')
  Object.assign(panel.style, {
    position: 'fixed',
    inset: '0 auto auto 0',
    zIndex: '2147483647',
    width: 'min(100vw, 32rem)',
    maxHeight: '45vh',
    margin: '0',
    padding: '6px',
    overflow: 'hidden',
    pointerEvents: 'none',
    whiteSpace: 'pre-wrap',
    background: 'rgba(0, 0, 0, 0.82)',
    color: '#7CFC00',
    font: '10px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  })

  const render = () => {
    const current = takeSnapshot('render')
    const tail = entries
      .slice(-RENDERED_TAIL_LENGTH)
      .map(
        (entry) =>
          `${entry.timestamp.toFixed(1)} ${entry.event} h=${formatNumber(entry.visualViewportHeight)} ` +
          `off=${formatNumber(entry.visualViewportOffsetTop)} page=${formatNumber(entry.visualViewportPageTop)} ` +
          `scroll=${entry.windowScrollY.toFixed(1)} applied=${entry.appliedHeight}`,
      )
    panel.textContent = [
      `visualViewport.height: ${formatNumber(current.visualViewportHeight)}`,
      `visualViewport.offsetTop: ${formatNumber(current.visualViewportOffsetTop)}`,
      `visualViewport.pageTop: ${formatNumber(current.visualViewportPageTop)}`,
      `window.scrollY: ${current.windowScrollY.toFixed(1)}`,
      `window.innerHeight: ${current.windowInnerHeight.toFixed(1)}`,
      `${HEIGHT_PROPERTY}: ${current.appliedHeight}`,
      `${ACTIVE_ATTRIBUTE}: ${String(current.adjustmentActive)}`,
      `activeElement: ${current.activeElement}`,
      '',
      ...tail,
    ].join('\n')
  }

  const record = (event: string) => {
    entries.push(takeSnapshot(event))
    if (entries.length > BUFFER_LIMIT) entries.splice(0, entries.length - BUFFER_LIMIT)
    render()
  }

  let pollTimer: number | null = null
  let destroyed = false
  const syncPolling = () => {
    if (destroyed) return
    if (isTextEntryFocused()) {
      if (pollTimer === null) pollTimer = window.setInterval(() => record('poll'), FOCUSED_POLL_INTERVAL_MS)
      return
    }
    if (pollTimer !== null) window.clearInterval(pollTimer)
    pollTimer = null
  }

  const handleFocusIn = () => {
    record('focusin')
    syncPolling()
  }
  const handleFocusOut = () => {
    record('focusout')
    queueMicrotask(syncPolling)
  }
  const handleVisualViewportResize = () => record('visualViewport.resize')
  const handleVisualViewportScroll = () => record('visualViewport.scroll')
  const handleWindowScroll = () => record('window.scroll')
  const handleWindowResize = () => record('window.resize')
  const visualViewport = window.visualViewport

  document.addEventListener('focusin', handleFocusIn)
  document.addEventListener('focusout', handleFocusOut)
  visualViewport?.addEventListener('resize', handleVisualViewportResize)
  visualViewport?.addEventListener('scroll', handleVisualViewportScroll)
  window.addEventListener('scroll', handleWindowScroll)
  window.addEventListener('resize', handleWindowResize)

  const previousDump = window.__RISU_VIEWPORT_DEBUG_DUMP__
  const dump = () => JSON.stringify(entries, null, 2)
  window.__RISU_VIEWPORT_DEBUG_DUMP__ = dump
  const shell = document.querySelector('[data-risu-visual-viewport-shell]')
  ;(shell ?? document.body).append(panel)
  record('install')
  syncPolling()

  return () => {
    destroyed = true
    if (pollTimer !== null) window.clearInterval(pollTimer)
    document.removeEventListener('focusin', handleFocusIn)
    document.removeEventListener('focusout', handleFocusOut)
    visualViewport?.removeEventListener('resize', handleVisualViewportResize)
    visualViewport?.removeEventListener('scroll', handleVisualViewportScroll)
    window.removeEventListener('scroll', handleWindowScroll)
    window.removeEventListener('resize', handleWindowResize)
    panel.remove()
    if (window.__RISU_VIEWPORT_DEBUG_DUMP__ === dump) {
      if (previousDump) window.__RISU_VIEWPORT_DEBUG_DUMP__ = previousDump
      else delete window.__RISU_VIEWPORT_DEBUG_DUMP__
    }
  }
}
