export type ModalBackdropDismissHandler = (event: MouseEvent) => void

/**
 * Dismiss a modal only when the primary pointer press and release both happen
 * directly on its backdrop.
 *
 * Browsers target a click at the nearest common ancestor of its press and
 * release targets. Without tracking both ends of the gesture, dragging from a
 * dialog control onto the backdrop can therefore look like a backdrop click.
 */
export function modalBackdropDismiss(node: HTMLElement, dismiss: ModalBackdropDismissHandler) {
  let dismissHandler = dismiss
  let activePointerId: number | null = null
  let pointerDownOnBackdrop = false
  let pointerUpOnBackdrop = false

  function resetPointerGesture(): void {
    activePointerId = null
    pointerDownOnBackdrop = false
    pointerUpOnBackdrop = false
  }

  function handlePointerDown(event: PointerEvent): void {
    resetPointerGesture()
    if (!event.isPrimary || event.button !== 0) return

    activePointerId = event.pointerId
    pointerDownOnBackdrop = event.target === node
  }

  function handlePointerUp(event: PointerEvent): void {
    if (event.pointerId !== activePointerId) return
    pointerUpOnBackdrop = event.target === node
  }

  function handlePointerCancel(event: PointerEvent): void {
    if (event.pointerId === activePointerId) resetPointerGesture()
  }

  function handleClick(event: MouseEvent): void {
    const isSyntheticBackdropClick = event.detail === 0 && activePointerId === null
    const shouldDismiss =
      event.target === node && (isSyntheticBackdropClick || (pointerDownOnBackdrop && pointerUpOnBackdrop))

    resetPointerGesture()
    if (shouldDismiss) dismissHandler(event)
  }

  node.addEventListener('pointerdown', handlePointerDown, true)
  node.addEventListener('pointerup', handlePointerUp, true)
  node.addEventListener('pointercancel', handlePointerCancel, true)
  node.addEventListener('click', handleClick, true)

  return {
    update(nextDismissHandler: ModalBackdropDismissHandler) {
      dismissHandler = nextDismissHandler
    },
    destroy() {
      node.removeEventListener('pointerdown', handlePointerDown, true)
      node.removeEventListener('pointerup', handlePointerUp, true)
      node.removeEventListener('pointercancel', handlePointerCancel, true)
      node.removeEventListener('click', handleClick, true)
    },
  }
}
