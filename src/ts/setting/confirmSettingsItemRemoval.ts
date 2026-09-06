import { language } from 'src/lang'

export function confirmSettingsItemRemoval(): boolean {
  if (typeof window.confirm !== 'function') return false
  return window.confirm(language.settingsItemRemovalConfirm)
}
