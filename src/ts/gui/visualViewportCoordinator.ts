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
const HEIGHT_PROPERTY = '--risu-visual-viewport-height'
// iOS WebKit can dispatch a VisualViewport event before its keyboard
// coordinates settle. Coalesce briefly, then re-read after paint boundaries
// and at two trailing checkpoints so a late coordinate update cannot persist.
const VIEWPORT_SETTLE_MS = 50
const TRAILING_VALIDATION_DELAYS_MS = [250, 700]
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

export function installVisualViewportCoordinator(
  options: { onApply?: () => void; onRelease?: () => void } = {},
): () => void {
  const root = document.documentElement
  const visualViewport = window.visualViewport
  let samplingFrame: number | null = null
  let applyFrame: number | null = null
  let resetFrame: number | null = null
  let viewportSettleTimer: ReturnType<typeof setTimeout> | null = null
  let trailingValidationTimers: Array<ReturnType<typeof setTimeout>> = []
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

  const clearTrailingValidationTimers = () => {
    for (const timer of trailingValidationTimers) clearTimeout(timer)
    trailingValidationTimers = []
  }

  const cancelScheduledAdjustment = () => {
    if (samplingFrame !== null) cancelAnimationFrame(samplingFrame)
    if (applyFrame !== null) cancelAnimationFrame(applyFrame)
    samplingFrame = null
    applyFrame = null
  }

  const cancelScheduledReset = () => {
    if (resetFrame !== null) cancelAnimationFrame(resetFrame)
    resetFrame = null
  }

  const clearAdjustment = (notify: boolean) => {
    const wasActive = visualViewportAdjustmentActive
    cancelScheduledReset()
    visualViewportAdjustmentActive = false
    root.removeAttribute(ACTIVE_ATTRIBUTE)
    root.style.removeProperty(HEIGHT_PROPERTY)
    if (notify && wasActive) options.onRelease?.()
  }

  const applyAdjustment = () => {
    applyFrame = null
    if (destroyed) return

    const editorFocused = isTextEntryElement(document.activeElement)
    if (!editorFocused && !visualViewportAdjustmentActive) return

    const height = visualViewport?.height ?? window.innerHeight
    if (!Number.isFinite(height) || height <= 0) return

    visualViewportAdjustmentActive = true
    root.setAttribute(ACTIVE_ATTRIBUTE, 'true')
    root.style.setProperty(HEIGHT_PROPERTY, `${height}px`)
    cancelScheduledReset()
    resetFrame = requestAnimationFrame(() => {
      resetFrame = null
      if (destroyed || !visualViewportAdjustmentActive) return
      options.onApply?.()
    })
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
    clearTrailingValidationTimers()
    cancelScheduledAdjustment()
    viewportSettleTimer = setTimeout(() => {
      viewportSettleTimer = null
      queueStableAdjustment()
    }, VIEWPORT_SETTLE_MS)
    trailingValidationTimers = TRAILING_VALIDATION_DELAYS_MS.map((delay) => {
      const validationTimer = setTimeout(() => {
        trailingValidationTimers = trailingValidationTimers.filter((timer) => timer !== validationTimer)
        queueStableAdjustment()
      }, delay)
      return validationTimer
    })
  }

  const handleFocusIn = () => {
    if (!isTextEntryElement(document.activeElement)) return
    clearReleaseTimer()
    clearViewportSettleTimer()
    clearTrailingValidationTimers()
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
      clearTrailingValidationTimers()
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
    clearTrailingValidationTimers()
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
