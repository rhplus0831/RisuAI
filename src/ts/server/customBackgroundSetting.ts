import { getResourceDatabase as getDatabase } from './resourceState.svelte'
import { applyServerBackedSetting } from './settingsBridge.svelte'

export const LEGACY_CUSTOM_BACKGROUND_PENDING_VALUE = '-'

/** Clears the placeholder written by older clients and persists the repair. */
export function normalizeLegacyCustomBackgroundSetting(): boolean {
  if (getDatabase().customBackground !== LEGACY_CUSTOM_BACKGROUND_PENDING_VALUE) return false
  applyServerBackedSetting('customBackground', '')
  return true
}
