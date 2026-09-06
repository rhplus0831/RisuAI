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
const KEYBOARD_HEIGHT_STORAGE_PREFIX = 'risu-keyboard-viewport-height'
const MIN_CACHED_VIEWPORT_HEIGHT_PX = 200
const MIN_KEYBOARD_HEIGHT_DELTA_PX = 100
// iOS WebKit's keyboard reveal commonly emits viewport changes for 250-500ms.
// The old 50ms debounce after the first event applied mid-animation, so wait
// until the last geometry event has been quiet for a full stability window.
const VIEWPORT_STABLE_MS = 275
// Re-read once more even without an event so late iOS coordinate drift cannot
// persist after the apparent settle.
const LATE_VIEWPORT_VALIDATION_MS = 700
const KEYBOARD_SETTLE_MS = 700

let visualViewportAdjustmentActive = false

function keyboardHeightStorageKey(): string {
  const orientation = window.innerWidth <= window.innerHeight ? 'portrait' : 'landscape'
  return `${KEYBOARD_HEIGHT_STORAGE_PREFIX}:${orientation}`
}

function readCachedKeyboardHeight(): number | null {
  try {
    const height = Number(window.localStorage.getItem(keyboardHeightStorageKey()))
    if (!Number.isFinite(height)) return null
    if (height < MIN_CACHED_VIEWPORT_HEIGHT_PX || height > window.innerHeight) return null
    return height
  } catch {
    return null
  }
}

function cacheSettledKeyboardHeight(height: number): void {
  try {
    const key = keyboardHeightStorageKey()
    if (window.innerHeight - height <= MIN_KEYBOARD_HEIGHT_DELTA_PX) {
      // A focused session that settled at (or near) full height means no soft
      // keyboard is present (hardware keyboard, desktop zoom). Drop the cached
      // pre-lift so a stale height cannot blip the shell on every future focus.
      window.localStorage.removeItem(key)
      return
    }
    if (height < MIN_CACHED_VIEWPORT_HEIGHT_PX || height > window.innerHeight) return
    if (Number(window.localStorage.getItem(key)) === height) return
    window.localStorage.setItem(key, `${height}`)
  } catch {
    // Device-local optimization only; storage can be unavailable in private mode.
  }
}

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
  let viewportStableTimer: ReturnType<typeof setTimeout> | null = null
  let lateValidationTimer: ReturnType<typeof setTimeout> | null = null
  let releaseTimer: ReturnType<typeof setTimeout> | null = null
  // Preserve final release ownership while an applied adjustment is temporarily
  // unlatched during a new burst of focused viewport motion.
  let adjustmentApplied = false
  // Keep the cached shell clamped for the whole session. Expanding it on a
  // viewport event would recreate the focus-reveal fight phase A prevents.
  let preLiftedFromCache = false
  let destroyed = false

  const clearReleaseTimer = () => {
    if (releaseTimer === null) return
    clearTimeout(releaseTimer)
    releaseTimer = null
  }

  const clearViewportStableTimer = () => {
    if (viewportStableTimer === null) return
    clearTimeout(viewportStableTimer)
    viewportStableTimer = null
  }

  const clearLateValidationTimer = () => {
    if (lateValidationTimer === null) return
    clearTimeout(lateValidationTimer)
    lateValidationTimer = null
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

  const suspendAdjustment = () => {
    cancelScheduledReset()
    visualViewportAdjustmentActive = false
    root.removeAttribute(ACTIVE_ATTRIBUTE)
    root.style.removeProperty(HEIGHT_PROPERTY)
  }

  const clearAdjustment = (notify: boolean) => {
    const wasApplied = adjustmentApplied
    adjustmentApplied = false
    preLiftedFromCache = false
    suspendAdjustment()
    if (notify && wasApplied) options.onRelease?.()
  }

  const publishAdjustment = (height: number, resetSynchronously = false) => {
    adjustmentApplied = true
    visualViewportAdjustmentActive = true
    root.setAttribute(ACTIVE_ATTRIBUTE, 'true')
    root.style.setProperty(HEIGHT_PROPERTY, `${height}px`)
    cancelScheduledReset()
    if (resetSynchronously) {
      options.onApply?.()
      return
    }
    resetFrame = requestAnimationFrame(() => {
      resetFrame = null
      if (destroyed || !visualViewportAdjustmentActive) return
      options.onApply?.()
    })
  }

  const applyAdjustment = () => {
    applyFrame = null
    if (destroyed) return

    const editorFocused = isTextEntryElement(document.activeElement)
    if (!editorFocused && !adjustmentApplied) return

    const height = visualViewport?.height ?? window.innerHeight
    if (!Number.isFinite(height) || height <= 0) return

    publishAdjustment(height)
    if (editorFocused) cacheSettledKeyboardHeight(height)
  }

  const queueStableAdjustment = () => {
    cancelScheduledAdjustment()
    samplingFrame = requestAnimationFrame(() => {
      samplingFrame = null
      applyFrame = requestAnimationFrame(applyAdjustment)
    })
  }

  // Refocusing an editor while the keyboard is already open must not expand a
  // settled shell. Geometry motion unlatches cache misses, while a pre-lifted
  // session remains clamped until its measured height replaces the cache.
  const scheduleViewportAdjustment = (suspendForFocusedViewportMotion: boolean) => {
    clearViewportStableTimer()
    clearLateValidationTimer()
    cancelScheduledAdjustment()
    if (suspendForFocusedViewportMotion && isTextEntryElement(document.activeElement)) suspendAdjustment()
    viewportStableTimer = setTimeout(() => {
      viewportStableTimer = null
      queueStableAdjustment()
    }, VIEWPORT_STABLE_MS)
    lateValidationTimer = setTimeout(() => {
      lateValidationTimer = null
      queueStableAdjustment()
    }, LATE_VIEWPORT_VALIDATION_MS)
  }

  const handleFocusIn = () => {
    if (!isTextEntryElement(document.activeElement)) return
    clearReleaseTimer()
    if (!adjustmentApplied) {
      const cachedHeight = readCachedKeyboardHeight()
      if (cachedHeight !== null) {
        // A stale cache with a hardware keyboard is corrected to the measured
        // full height by the normal settle pass after 275ms.
        preLiftedFromCache = true
        publishAdjustment(cachedHeight, true)
      }
    }
    scheduleViewportAdjustment(false)
  }

  const handleFocusOut = () => {
    clearReleaseTimer()
    releaseTimer = setTimeout(() => {
      releaseTimer = null
      if (isTextEntryElement(document.activeElement)) {
        scheduleViewportAdjustment(false)
        return
      }
      clearViewportStableTimer()
      clearLateValidationTimer()
      cancelScheduledAdjustment()
      clearAdjustment(true)
    }, KEYBOARD_SETTLE_MS)
  }

  const handleViewportChange = () => {
    if (adjustmentApplied || isTextEntryElement(document.activeElement)) {
      scheduleViewportAdjustment(!preLiftedFromCache)
    }
  }

  document.addEventListener('focusin', handleFocusIn)
  document.addEventListener('focusout', handleFocusOut)
  window.addEventListener('resize', handleViewportChange)
  window.addEventListener('scroll', handleViewportChange)
  window.addEventListener('orientationchange', handleViewportChange)
  visualViewport?.addEventListener('resize', handleViewportChange)
  visualViewport?.addEventListener('scroll', handleViewportChange)

  if (isTextEntryElement(document.activeElement)) handleFocusIn()

  return () => {
    destroyed = true
    clearReleaseTimer()
    clearViewportStableTimer()
    clearLateValidationTimer()
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
