export function moveDropListItem<T>(list: readonly T[], index: number, direction: -1 | 1): readonly T[] {
  if (list.length < 2 || index < 0 || index >= list.length) return list

  const next = [...list]
  const targetIndex = (index + direction + list.length) % list.length
  next[index] = list[targetIndex]
  next[targetIndex] = list[index]
  return next
}
