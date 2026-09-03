import { runtimeDisplaySettingsOwner } from './displaySettings'
import { applyDisplayStyles } from './displaySettingsCache'

export function updateAnimationSpeed() {
  const db = runtimeDisplaySettingsOwner()
  if (!db) return
  applyDisplayStyles(
    { '--risu-animation-speed': db.reducedMotion ? '0.01ms' : (db.animationSpeed ?? 0.4) + 's' },
    db.reducedMotion === true,
  )
}

export function updateReducedMotion() {
  updateAnimationSpeed()
}
