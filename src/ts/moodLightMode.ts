import { get, writable } from 'svelte/store'

const MOOD_LIGHT_SESSION_KEY = 'risu:mood-light-mode'

function readSessionState(): boolean {
  if (typeof sessionStorage === 'undefined') return false
  try {
    return sessionStorage.getItem(MOOD_LIGHT_SESSION_KEY) === 'active'
  } catch {
    return false
  }
}

export const moodLightMode = writable(readSessionState())

export function isMoodLightModeActive(): boolean {
  return get(moodLightMode)
}

export function setMoodLightModeActive(active: boolean): void {
  moodLightMode.set(active)
  if (typeof sessionStorage === 'undefined') return
  try {
    if (active) sessionStorage.setItem(MOOD_LIGHT_SESSION_KEY, 'active')
    else sessionStorage.removeItem(MOOD_LIGHT_SESSION_KEY)
  } catch {
    // A storage-disabled browser still gets an in-memory, current-page mode.
  }
}
