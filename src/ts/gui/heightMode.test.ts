import { afterEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({ heightMode: 'normal' }))

vi.mock('../storage/database.svelte', () => ({
  getDatabase: () => database,
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
    database.heightMode = 'vh'
    updateHeightMode()
    expect(document.documentElement.style.getPropertyValue('--risu-height-size')).toBe('100vh')

    database.heightMode = 'normal'
    updateHeightMode()
    expect(document.documentElement.style.getPropertyValue('--risu-height-size')).toBe('100%')
  })
})
