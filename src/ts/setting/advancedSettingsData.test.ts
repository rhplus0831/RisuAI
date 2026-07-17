import { describe, expect, it, vi } from 'vitest'

vi.mock('../gui/heightMode', () => ({ updateHeightMode: vi.fn() }))

import { advancedSettingsItems } from './advancedSettingsData'

describe('advanced settings data', () => {
  it('does not advertise unsupported browser-side cold storage', () => {
    expect(advancedSettingsItems.some((item) => item.bindKey === 'coldstorage')).toBe(false)
  })

  it('does not advertise the retired browser remote-save encoder', () => {
    expect(advancedSettingsItems.some((item) => item.bindKey === 'enableRemoteSaving')).toBe(false)
  })

  it('does not advertise the legacy preset chain in server-backed generation', () => {
    expect(advancedSettingsItems.some((item) => item.bindKey === 'presetChain')).toBe(false)
  })

  it('does not advertise the removed Realm preview direct-open behavior', () => {
    expect(advancedSettingsItems.some((item) => item.bindKey === 'realmDirectOpen')).toBe(false)
  })
})
