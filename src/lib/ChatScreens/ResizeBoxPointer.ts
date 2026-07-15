type ResizePointerEvent = {
  clientX?: number | null
  clientY?: number | null
  touches?: ArrayLike<{ clientX: number; clientY: number }> | null
}

export const MIN_RESIZE_BOX_SIZE = 64

export function clampResizeBoxSize(size: number, viewportSize: number): number {
  const maximum = Math.max(MIN_RESIZE_BOX_SIZE, viewportSize * 0.8)
  return Math.min(Math.max(size, MIN_RESIZE_BOX_SIZE), maximum)
}

export function readResizePointer(event: ResizePointerEvent): { x: number; y: number } | null {
  const touch = event.touches?.[0]
  const x = event.clientX ?? touch?.clientX
  const y = event.clientY ?? touch?.clientY
  if (typeof x !== 'number' || typeof y !== 'number') return null
  return { x, y }
}
