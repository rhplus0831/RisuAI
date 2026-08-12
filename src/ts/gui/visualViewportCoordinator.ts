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
const OFFSET_TOP_PROPERTY = '--risu-visual-viewport-offset-top'
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
  let animationFrame: number | null = null
  let releaseTimer: ReturnType<typeof setTimeout> | null = null
  let destroyed = false

  const clearReleaseTimer = () => {
    if (releaseTimer === null) return
    clearTimeout(releaseTimer)
    releaseTimer = null
  }

  const clearAdjustment = (notify: boolean) => {
    const wasActive = visualViewportAdjustmentActive
    visualViewportAdjustmentActive = false
    root.removeAttribute(ACTIVE_ATTRIBUTE)
    root.style.removeProperty(HEIGHT_PROPERTY)
    root.style.removeProperty(OFFSET_TOP_PROPERTY)
    if (notify && wasActive) options.onRelease?.()
  }

  const applyAdjustment = () => {
    animationFrame = null
    if (destroyed) return

    const editorFocused = isTextEntryElement(document.activeElement)
    if (!editorFocused && !visualViewportAdjustmentActive) return

    const height = visualViewport?.height ?? window.innerHeight
    const offsetTop = visualViewport?.offsetTop ?? 0
    if (!Number.isFinite(height) || height <= 0) return

    visualViewportAdjustmentActive = true
    root.setAttribute(ACTIVE_ATTRIBUTE, 'true')
    root.style.setProperty(HEIGHT_PROPERTY, `${height}px`)
    root.style.setProperty(OFFSET_TOP_PROPERTY, `${Math.max(0, Number.isFinite(offsetTop) ? offsetTop : 0)}px`)
  }

  const scheduleAdjustment = () => {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame)
    animationFrame = requestAnimationFrame(applyAdjustment)
  }

  const handleFocusIn = () => {
    if (!isTextEntryElement(document.activeElement)) return
    clearReleaseTimer()
    scheduleAdjustment()
  }

  const handleFocusOut = () => {
    clearReleaseTimer()
    releaseTimer = setTimeout(() => {
      releaseTimer = null
      if (isTextEntryElement(document.activeElement)) {
        scheduleAdjustment()
        return
      }
      clearAdjustment(true)
    }, KEYBOARD_SETTLE_MS)
  }

  const handleViewportChange = () => {
    if (visualViewportAdjustmentActive || isTextEntryElement(document.activeElement)) scheduleAdjustment()
  }

  document.addEventListener('focusin', handleFocusIn)
  document.addEventListener('focusout', handleFocusOut)
  window.addEventListener('resize', handleViewportChange)
  window.addEventListener('orientationchange', handleViewportChange)
  visualViewport?.addEventListener('resize', handleViewportChange)
  visualViewport?.addEventListener('scroll', handleViewportChange)

  if (isTextEntryElement(document.activeElement)) scheduleAdjustment()

  return () => {
    destroyed = true
    clearReleaseTimer()
    if (animationFrame !== null) cancelAnimationFrame(animationFrame)
    document.removeEventListener('focusin', handleFocusIn)
    document.removeEventListener('focusout', handleFocusOut)
    window.removeEventListener('resize', handleViewportChange)
    window.removeEventListener('orientationchange', handleViewportChange)
    visualViewport?.removeEventListener('resize', handleViewportChange)
    visualViewport?.removeEventListener('scroll', handleViewportChange)
    clearAdjustment(false)
  }
}
