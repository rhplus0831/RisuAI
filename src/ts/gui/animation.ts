import { getDatabase } from '../storage/database.svelte'

export function updateAnimationSpeed() {
  const db = getDatabase()
  document.documentElement.style.setProperty(
    '--risu-animation-speed',
    db.reducedMotion ? '0.01ms' : db.animationSpeed + 's',
  )
}

export function updateReducedMotion() {
  document.documentElement.classList.toggle('risu-reduced-motion', getDatabase().reducedMotion === true)
  updateAnimationSpeed()
}
