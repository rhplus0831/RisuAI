type ResizePointerEvent = {
  clientX?: number | null
  clientY?: number | null
  touches?: ArrayLike<{ clientX: number; clientY: number }> | null
}

export function readResizePointer(event: ResizePointerEvent): { x: number; y: number } | null {
  const touch = event.touches?.[0]
  const x = event.clientX ?? touch?.clientX
  const y = event.clientY ?? touch?.clientY
  if (typeof x !== 'number' || typeof y !== 'number') return null
  return { x, y }
}
