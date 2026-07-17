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
})
