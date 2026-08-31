import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const animationState = vi.hoisted(() => ({
  database: {
    animationSpeed: 0.4,
    reducedMotion: false,
  },
  settingsResourceState: {
    value: {} as Record<string, unknown>,
    groupStatuses: { display: 'ready' },
  },
}))

vi.mock('../storage/database.svelte', () => ({
  getDatabase: () => animationState.database,
}))

vi.mock('../server/resourceState.svelte', () => ({
  settingsResourceState: animationState.settingsResourceState,
}))

import { updateReducedMotion } from './animation'

beforeEach(() => {
  animationState.database.animationSpeed = 0.4
  animationState.database.reducedMotion = false
  animationState.settingsResourceState.value = animationState.database
  animationState.settingsResourceState.groupStatuses.display = 'ready'
  document.documentElement.classList.remove('risu-reduced-motion')
  document.documentElement.style.removeProperty('--risu-animation-speed')
})

afterEach(() => {
  document.documentElement.classList.remove('risu-reduced-motion')
  document.documentElement.style.removeProperty('--risu-animation-speed')
  vi.unstubAllGlobals()
})

describe('app reduced motion preference', () => {
  it('ignores the operating-system preference when the app setting is disabled', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    )

    updateReducedMotion()

    expect(document.documentElement.classList.contains('risu-reduced-motion')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--risu-animation-speed')).toBe('0.4s')
  })

  it('enables reduced motion from the app setting regardless of the operating-system preference', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    )
    animationState.database.reducedMotion = true

    updateReducedMotion()

    expect(document.documentElement.classList.contains('risu-reduced-motion')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--risu-animation-speed')).toBe('0.01ms')
  })

  it('waits for the display owner and leaves the last value intact on error', () => {
    animationState.settingsResourceState.value = { animationSpeed: 9, reducedMotion: true }
    animationState.settingsResourceState.groupStatuses.display = 'loading'
    animationState.database.animationSpeed = 0.2
    updateReducedMotion()
    expect(document.documentElement.style.getPropertyValue('--risu-animation-speed')).toBe('')

    animationState.settingsResourceState.groupStatuses.display = 'error'
    animationState.database.animationSpeed = 0.8
    updateReducedMotion()
    expect(document.documentElement.style.getPropertyValue('--risu-animation-speed')).toBe('')
  })
})
