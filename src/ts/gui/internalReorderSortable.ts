import { sortableOptions } from '../util'

export const internalReorderSortableOptions = {
  ...sortableOptions,
  animation: 150,
  delay: 0,
  delayOnTouchOnly: false,
  forceFallback: true,
  fallbackTolerance: 3,
  chosenClass: 'risu-chosen-item',
  ghostClass: 'risu-ghost-item',
} as const
