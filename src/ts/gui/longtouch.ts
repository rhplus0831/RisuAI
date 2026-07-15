export function longpress(node: HTMLElement, callback: (e: MouseEvent) => void) {
  const TIME_MS = 500
  let timeoutPtr: number | undefined

  function cancelPendingLongPress() {
    if (timeoutPtr !== undefined) {
      window.clearTimeout(timeoutPtr)
      timeoutPtr = undefined
    }
    window.removeEventListener('mousemove', cancelPendingLongPress)
    window.removeEventListener('mouseup', cancelPendingLongPress)
    window.removeEventListener('blur', cancelPendingLongPress)
  }

  function handleMouseDown(e: MouseEvent) {
    if (e.button !== 0) return
    cancelPendingLongPress()
    window.addEventListener('mousemove', cancelPendingLongPress)
    window.addEventListener('mouseup', cancelPendingLongPress)
    window.addEventListener('blur', cancelPendingLongPress)
    timeoutPtr = window.setTimeout(() => {
      cancelPendingLongPress()
      callback(e)
    }, TIME_MS)
  }
  node.addEventListener('mousedown', handleMouseDown)
  return {
    destroy: () => {
      cancelPendingLongPress()
      node.removeEventListener('mousedown', handleMouseDown)
    },
  }
}
