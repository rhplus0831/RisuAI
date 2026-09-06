import { runtimeDisplaySettingsOwner } from './displaySettings'
import { applyDisplayStyles } from './displaySettingsCache'

export function resolveHeightModeCssValue(heightMode: unknown): string {
  switch (heightMode) {
    case 'vh':
      return '100vh'
    case 'dvh':
      return '100dvh'
    case 'lvh':
      return '100lvh'
    case 'svh':
      return '100svh'
    case 'auto':
    case 'percent':
    case 'normal':
    default:
      return '100%'
  }
}

export function updateHeightMode(): void {
  if (typeof document === 'undefined') return
  const settings = runtimeDisplaySettingsOwner()
  if (!settings) return
  applyDisplayStyles({ '--risu-height-size': resolveHeightModeCssValue(settings.heightMode) })
}
