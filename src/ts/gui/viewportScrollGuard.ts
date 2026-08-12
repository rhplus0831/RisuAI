import { isTextEntryElement, isVisualViewportAdjustmentActive } from './visualViewportCoordinator'

/**
 * The app shell renders inside a fixed, non-scrolling viewport: `body` uses
 * `overflow: hidden`, and no app code scrolls the document root. The root can
 * still gain scrollable overflow — absolutely-positioned elements escape
 * `body` clipping, and user custom CSS can overflow it — and `overflow:
 * hidden` roots remain programmatically scrollable, so browser focus
 * handling, `scrollIntoView`, or automation clicks can shift the whole app
 * upward with no way for the user to scroll back. Pin the document scroll
 * position at the origin instead. Inner scroll containers are unaffected
 * because element scroll events do not bubble to the window.
 *
 * A focused text entry may retain browser reveal scroll only until the visual
 * viewport coordinator has applied its reduced shell height. Once active, the
 * input is visible at root scroll zero and vertical enforcement resumes.
 */
export function installViewportScrollGuard(): void {
  window.addEventListener('scroll', resetViewportScroll)
}

export function resetViewportScroll(): void {
  const scroller = document.scrollingElement
  if (!scroller) return
  if (scroller.scrollLeft !== 0) scroller.scrollLeft = 0
  if (isTextEntryElement(document.activeElement) && !isVisualViewportAdjustmentActive()) return
  if (scroller.scrollTop !== 0) scroller.scrollTop = 0
}
