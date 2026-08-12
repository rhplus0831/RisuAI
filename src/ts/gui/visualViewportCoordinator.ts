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

const ACTIVE_ATTRIBUTE = 'data-risu-visual-viewport-active'
const SHIFTED_ATTRIBUTE = 'data-risu-visual-viewport-shifted'
const HEIGHT_PROPERTY = '--risu-visual-viewport-height'
const PAGE_TOP_PROPERTY = '--risu-visual-viewport-page-top'
// iOS WebKit can dispatch a VisualViewport event before its keyboard
// coordinates settle. Re-read after a short delay and two paint boundaries.
const VIEWPORT_SETTLE_MS = 50
const KEYBOARD_SETTLE_MS = 700

let visualViewportAdjustmentActive = false

export function isTextEntryElement(element: Element | null): boolean {
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly
  if (element instanceof HTMLInputElement) {
    return !element.disabled && !element.readOnly && TEXT_ENTRY_INPUT_TYPES.has(element.type)
  }
  return element instanceof HTMLElement && element.isContentEditable
}

export function isVisualViewportAdjustmentActive(): boolean {
  return visualViewportAdjustmentActive
}

export function installVisualViewportCoordinator(options: { onRelease?: () => void } = {}): () => void {
  const root = document.documentElement
  const visualViewport = window.visualViewport
  let samplingFrame: number | null = null
  let applyFrame: number | null = null
  let viewportSettleTimer: ReturnType<typeof setTimeout> | null = null
  let releaseTimer: ReturnType<typeof setTimeout> | null = null
  let destroyed = false

  const clearReleaseTimer = () => {
    if (releaseTimer === null) return
    clearTimeout(releaseTimer)
    releaseTimer = null
  }

  const clearViewportSettleTimer = () => {
    if (viewportSettleTimer === null) return
    clearTimeout(viewportSettleTimer)
    viewportSettleTimer = null
  }

  const cancelScheduledAdjustment = () => {
    if (samplingFrame !== null) cancelAnimationFrame(samplingFrame)
    if (applyFrame !== null) cancelAnimationFrame(applyFrame)
    samplingFrame = null
    applyFrame = null
  }

  const clearAdjustment = (notify: boolean) => {
    const wasActive = visualViewportAdjustmentActive
    visualViewportAdjustmentActive = false
    root.removeAttribute(ACTIVE_ATTRIBUTE)
    root.removeAttribute(SHIFTED_ATTRIBUTE)
    root.style.removeProperty(HEIGHT_PROPERTY)
    root.style.removeProperty(PAGE_TOP_PROPERTY)
    if (notify && wasActive) options.onRelease?.()
  }

  const applyAdjustment = () => {
    applyFrame = null
    if (destroyed) return

    const editorFocused = isTextEntryElement(document.activeElement)
    if (!editorFocused && !visualViewportAdjustmentActive) return

    const height = visualViewport?.height ?? window.innerHeight
    const offsetTop = visualViewport?.offsetTop ?? 0
    const reportedPageTop = visualViewport?.pageTop
    // The shell is page-positioned, so pageTop remains correct when WebKit
    // moves either the visual viewport or the layout viewport during focus.
    const fallbackPageTop = window.scrollY + (Number.isFinite(offsetTop) ? offsetTop : 0)
    const pageTop =
      typeof reportedPageTop === 'number' && Number.isFinite(reportedPageTop) ? reportedPageTop : fallbackPageTop
    if (!Number.isFinite(height) || height <= 0) return

    visualViewportAdjustmentActive = true
    root.setAttribute(ACTIVE_ATTRIBUTE, 'true')
    root.toggleAttribute(SHIFTED_ATTRIBUTE, pageTop > 0.5)
    root.style.setProperty(HEIGHT_PROPERTY, `${height}px`)
    root.style.setProperty(PAGE_TOP_PROPERTY, `${Math.max(0, pageTop)}px`)
  }

  const queueStableAdjustment = () => {
    cancelScheduledAdjustment()
    samplingFrame = requestAnimationFrame(() => {
      samplingFrame = null
      applyFrame = requestAnimationFrame(applyAdjustment)
    })
  }

  const scheduleViewportAdjustment = () => {
    clearViewportSettleTimer()
    cancelScheduledAdjustment()
    viewportSettleTimer = setTimeout(() => {
      viewportSettleTimer = null
      queueStableAdjustment()
    }, VIEWPORT_SETTLE_MS)
  }

  const handleFocusIn = () => {
    if (!isTextEntryElement(document.activeElement)) return
    clearReleaseTimer()
    clearViewportSettleTimer()
    queueStableAdjustment()
  }

  const handleFocusOut = () => {
    clearReleaseTimer()
    releaseTimer = setTimeout(() => {
      releaseTimer = null
      if (isTextEntryElement(document.activeElement)) {
        queueStableAdjustment()
        return
      }
      clearViewportSettleTimer()
      cancelScheduledAdjustment()
      clearAdjustment(true)
    }, KEYBOARD_SETTLE_MS)
  }

  const handleViewportChange = () => {
    if (visualViewportAdjustmentActive || isTextEntryElement(document.activeElement)) scheduleViewportAdjustment()
  }

  document.addEventListener('focusin', handleFocusIn)
  document.addEventListener('focusout', handleFocusOut)
  window.addEventListener('resize', handleViewportChange)
  window.addEventListener('scroll', handleViewportChange)
  window.addEventListener('orientationchange', handleViewportChange)
  visualViewport?.addEventListener('resize', handleViewportChange)
  visualViewport?.addEventListener('scroll', handleViewportChange)

  if (isTextEntryElement(document.activeElement)) queueStableAdjustment()

  return () => {
    destroyed = true
    clearReleaseTimer()
    clearViewportSettleTimer()
    cancelScheduledAdjustment()
    document.removeEventListener('focusin', handleFocusIn)
    document.removeEventListener('focusout', handleFocusOut)
    window.removeEventListener('resize', handleViewportChange)
    window.removeEventListener('scroll', handleViewportChange)
    window.removeEventListener('orientationchange', handleViewportChange)
    visualViewport?.removeEventListener('resize', handleViewportChange)
    visualViewport?.removeEventListener('scroll', handleViewportChange)
    clearAdjustment(false)
  }
}
