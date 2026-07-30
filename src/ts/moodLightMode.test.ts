import { get } from 'svelte/store'
import { beforeEach, describe, expect, it } from 'vitest'
import { moodLightMode, setMoodLightModeActive } from './moodLightMode'

describe('Mood Light browser-session state', () => {
  beforeEach(() => {
    sessionStorage.clear()
    setMoodLightModeActive(false)
  })

  it('stores only the active mode flag in session storage and removes it on exit', () => {
    setMoodLightModeActive(true)

    expect(get(moodLightMode)).toBe(true)
    expect(sessionStorage.getItem('risu:mood-light-mode')).toBe('active')

    setMoodLightModeActive(false)

    expect(get(moodLightMode)).toBe(false)
    expect(sessionStorage.getItem('risu:mood-light-mode')).toBeNull()
  })
})
