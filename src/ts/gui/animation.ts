import type { Database } from '../storage/database.svelte'
import { settingsResourceState } from '../server/resourceState.svelte'

function displaySettingsOwner(): Partial<Database> | undefined {
  const status = settingsResourceState.groupStatuses.display ?? 'idle'
  if (status === 'ready') return settingsResourceState.value as Partial<Database>
  return undefined
}

export function updateAnimationSpeed() {
  const db = displaySettingsOwner()
  if (!db) return
  document.documentElement.style.setProperty(
    '--risu-animation-speed',
    db.reducedMotion ? '0.01ms' : db.animationSpeed + 's',
  )
}

export function updateReducedMotion() {
  const settings = displaySettingsOwner()
  if (!settings) return
  document.documentElement.classList.toggle('risu-reduced-motion', settings.reducedMotion === true)
  updateAnimationSpeed()
}
