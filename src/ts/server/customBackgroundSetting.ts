import type { Database } from '../storage/database.svelte'
import { settingsResourceState } from './resourceState.svelte'
import { applyServerBackedSetting } from './settingsOwner.svelte'

export const LEGACY_CUSTOM_BACKGROUND_PENDING_VALUE = '-'

function displaySettingsOwner(): Partial<Database> | undefined {
  const status = settingsResourceState.groupStatuses.display ?? 'idle'
  if (status === 'ready') return settingsResourceState.value as Partial<Database>
  return undefined
}

/** Clears the placeholder written by older clients and persists the repair. */
export function normalizeLegacyCustomBackgroundSetting(): boolean {
  if (displaySettingsOwner()?.customBackground !== LEGACY_CUSTOM_BACKGROUND_PENDING_VALUE) return false
  applyServerBackedSetting('customBackground', '')
  return true
}
