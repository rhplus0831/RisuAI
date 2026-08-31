import { afterEach, describe, expect, it, vi } from 'vitest'

const heightModeState = vi.hoisted(() => ({
  database: { heightMode: 'normal' },
  settingsResourceState: {
    value: { heightMode: 'normal' },
    groupStatuses: { display: 'ready' },
  },
}))

vi.mock('../storage/database.svelte', () => ({
  getDatabase: () => heightModeState.database,
}))

vi.mock('../server/resourceState.svelte', () => ({
  settingsResourceState: heightModeState.settingsResourceState,
}))

import { resolveHeightModeCssValue, updateHeightMode } from './heightMode'

afterEach(() => {
  document.documentElement.style.removeProperty('--risu-height-size')
})

describe('height mode runtime projection', () => {
  it.each([
    ['normal', '100%'],
    ['percent', '100%'],
    ['auto', '100%'],
    ['vh', '100vh'],
    ['dvh', '100dvh'],
    ['lvh', '100lvh'],
    ['svh', '100svh'],
    ['unexpected', '100%'],
  ])('maps %s to %s', (mode, expected) => {
    expect(resolveHeightModeCssValue(mode)).toBe(expected)
  })

  it('replaces a previous viewport override when the persisted mode changes', () => {
    heightModeState.settingsResourceState.groupStatuses.display = 'ready'
    heightModeState.settingsResourceState.value.heightMode = 'vh'
    updateHeightMode()
    expect(document.documentElement.style.getPropertyValue('--risu-height-size')).toBe('100vh')

    heightModeState.settingsResourceState.value.heightMode = 'normal'
    updateHeightMode()
    expect(document.documentElement.style.getPropertyValue('--risu-height-size')).toBe('100%')
  })

  it('uses loading compatibility and leaves the last value intact on owner error', () => {
    heightModeState.settingsResourceState.groupStatuses.display = 'loading'
    heightModeState.database.heightMode = 'dvh'
    updateHeightMode()
    expect(document.documentElement.style.getPropertyValue('--risu-height-size')).toBe('100dvh')

    heightModeState.settingsResourceState.groupStatuses.display = 'error'
    heightModeState.database.heightMode = 'vh'
    updateHeightMode()
    expect(document.documentElement.style.getPropertyValue('--risu-height-size')).toBe('100dvh')
  })
})
