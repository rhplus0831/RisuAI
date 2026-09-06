export interface PartialEditTouchTriggerOptions {
  bodyRoot: HTMLElement
  /** Resolve the editable block at a viewport point; null means no target. */
  resolveBlock: (clientX: number, clientY: number) => HTMLElement | null
  onLongPress: (block: HTMLElement) => void
  longPressMs?: number
  moveSlopPx?: number
}

const DEFAULT_LONG_PRESS_MS = 500
const DEFAULT_MOVE_SLOP_PX = 10
// Synthetic click events arrive within a few milliseconds of touchend; anything
// later is a real user tap and must not be swallowed.
const CLICK_SWALLOW_WINDOW_MS = 250

interface SuppressedStyles {
  userSelect: string
  webkitUserSelect: string
  webkitTouchCallout: string
}

/**
 * Long-press recognizer for touch devices. While a press is pending it
 * suppresses native text selection and the context menu inside bodyRoot so the
 * gesture can own the interaction; when it fires it resolves the pressed block
 * and reports it, then swallows the synthetic click that follows touch release.
 */
export function attachPartialEditTouchTrigger(options: PartialEditTouchTriggerOptions): () => void {
  const { bodyRoot, resolveBlock, onLongPress } = options
  const longPressMs = options.longPressMs ?? DEFAULT_LONG_PRESS_MS
  const moveSlopPx = options.moveSlopPx ?? DEFAULT_MOVE_SLOP_PX

  let timerId: number | null = null
  let startX = 0
  let startY = 0
  let activeTouchId: number | undefined
  let fired = false
  let savedStyles: SuppressedStyles | null = null
  let clickSwallowExpiry: number | null = null

  function suppressNativeSelection() {
    if (savedStyles) return
    const style = bodyRoot.style as CSSStyleDeclaration & { webkitUserSelect?: string; webkitTouchCallout?: string }
    savedStyles = {
      userSelect: style.userSelect ?? '',
      webkitUserSelect: style.webkitUserSelect ?? '',
      webkitTouchCallout: style.webkitTouchCallout ?? '',
    }
    style.userSelect = 'none'
    style.webkitUserSelect = 'none'
    style.webkitTouchCallout = 'none'
  }

  function restoreNativeSelection() {
    if (!savedStyles) return
    const style = bodyRoot.style as CSSStyleDeclaration & { webkitUserSelect?: string; webkitTouchCallout?: string }
    style.userSelect = savedStyles.userSelect
    style.webkitUserSelect = savedStyles.webkitUserSelect
    style.webkitTouchCallout = savedStyles.webkitTouchCallout
    savedStyles = null
  }

  function findActiveTouch(list: TouchList | undefined): Touch | null {
    if (!list) return null
    for (let index = 0; index < list.length; index += 1) {
      if (list[index].identifier === activeTouchId) return list[index]
    }
    return null
  }

  function clearGestureListeners() {
    window.removeEventListener('touchstart', handleExtraTouchStart)
    window.removeEventListener('touchmove', handleTouchMove)
    window.removeEventListener('touchend', handleTouchEnd)
    window.removeEventListener('touchcancel', handleTouchCancel)
    document.removeEventListener('scroll', handleScroll, true)
  }

  function clearTimer() {
    if (timerId !== null) {
      window.clearTimeout(timerId)
      timerId = null
    }
  }

  function endGesture() {
    clearTimer()
    clearGestureListeners()
    restoreNativeSelection()
    fired = false
    activeTouchId = undefined
  }

  function disarmSyntheticClickSwallow() {
    window.removeEventListener('click', swallowSyntheticClick, true)
    clickSwallowExpiry = null
  }

  function swallowSyntheticClick(event: MouseEvent) {
    window.removeEventListener('click', swallowSyntheticClick, true)
    if (clickSwallowExpiry !== null && Date.now() > clickSwallowExpiry) return
    clickSwallowExpiry = null
    // Only the synthetic click replaying the long-press lands inside bodyRoot;
    // a quick intentional tap on the floating edit/delete buttons must pass.
    if (!(event.target instanceof Node) || !bodyRoot.contains(event.target)) return
    event.preventDefault()
    event.stopPropagation()
  }

  function armSyntheticClickSwallow() {
    clickSwallowExpiry = Date.now() + CLICK_SWALLOW_WINDOW_MS
    window.addEventListener('click', swallowSyntheticClick, true)
  }

  function handleExtraTouchStart(event: TouchEvent) {
    // A second finger while the press is still pending aborts it; once the
    // gesture fired only the initiating finger's release matters.
    if (!fired && event.touches.length > 1) {
      endGesture()
    }
  }

  function handleTouchMove(event: TouchEvent) {
    // After firing we only await the release; drift must not drop the
    // touchend protection that swallows the compatibility click.
    if (fired) return
    const touch = findActiveTouch(event.touches)
    if (!touch) {
      endGesture()
      return
    }
    const dx = touch.clientX - startX
    const dy = touch.clientY - startY
    if (dx * dx + dy * dy > moveSlopPx * moveSlopPx) {
      endGesture()
    }
  }

  function handleTouchEnd(event: TouchEvent) {
    const releasedOurs = findActiveTouch(event.changedTouches) !== null
    if (!releasedOurs && findActiveTouch(event.touches) !== null) return
    if (fired) {
      // Prevent the browser from synthesizing mouse events for this touch; the
      // capture-phase click swallow below is the fallback for engines that
      // dispatch a click anyway.
      if (event.cancelable) event.preventDefault()
      armSyntheticClickSwallow()
    }
    endGesture()
  }

  function handleTouchCancel() {
    endGesture()
  }

  function handleScroll() {
    // Scrolling aborts a pending press; a fired gesture keeps its release
    // protection until the finger lifts.
    if (!fired) endGesture()
  }

  function handleContextMenu(event: Event) {
    if (timerId !== null || fired) {
      // Capture phase: descendant handlers (e.g. the code-block copy menu)
      // must not open their own context menu mid-gesture.
      event.preventDefault()
      event.stopPropagation()
    }
  }

  function handleTouchStart(event: TouchEvent) {
    // A fresh touch means the next click is intentional — never swallow it.
    disarmSyntheticClickSwallow()
    if (event.touches.length !== 1) {
      endGesture()
      return
    }
    endGesture()
    const touch = event.touches[0]
    activeTouchId = touch.identifier
    startX = touch.clientX
    startY = touch.clientY
    suppressNativeSelection()
    window.addEventListener('touchstart', handleExtraTouchStart, { passive: true })
    window.addEventListener('touchmove', handleTouchMove, { passive: true })
    window.addEventListener('touchend', handleTouchEnd, { passive: false })
    window.addEventListener('touchcancel', handleTouchCancel)
    document.addEventListener('scroll', handleScroll, true)
    timerId = window.setTimeout(() => {
      timerId = null
      window.getSelection()?.removeAllRanges()
      const block = resolveBlock(startX, startY)
      if (block) {
        fired = true
        onLongPress(block)
      }
    }, longPressMs)
  }

  bodyRoot.addEventListener('touchstart', handleTouchStart, { passive: true })
  bodyRoot.addEventListener('contextmenu', handleContextMenu, true)

  return () => {
    endGesture()
    disarmSyntheticClickSwallow()
    bodyRoot.removeEventListener('touchstart', handleTouchStart)
    bodyRoot.removeEventListener('contextmenu', handleContextMenu, true)
  }
}
