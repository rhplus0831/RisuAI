import type { Database } from '../storage/database.svelte'
import { settingsResourceState } from '../server/resourceState.svelte'

function displaySettingsOwner(): Partial<Database> | undefined {
  const status = settingsResourceState.groupStatuses.display ?? 'idle'
  if (status === 'ready') return settingsResourceState.value as Partial<Database>
  return undefined
}

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
  const settings = displaySettingsOwner()
  if (!settings) return
  document.documentElement.style.setProperty('--risu-height-size', resolveHeightModeCssValue(settings.heightMode))
}
