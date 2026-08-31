import { beforeEach, describe, expect, it, vi } from 'vitest'

const customBackgroundState = vi.hoisted(() => ({
  compatibility: { customBackground: '-' },
  settingsResourceState: {
    value: { customBackground: '-' },
    groupStatuses: { display: 'ready' },
  },
  applyServerBackedSetting: vi.fn(),
}))

vi.mock('./resourceState.svelte', () => ({
  settingsResourceState: customBackgroundState.settingsResourceState,
}))

vi.mock('../storage/database.svelte', () => ({
  getDatabase: () => customBackgroundState.compatibility,
}))

vi.mock('./settingsBridge.svelte', () => ({
  applyServerBackedSetting: customBackgroundState.applyServerBackedSetting,
}))

import { normalizeLegacyCustomBackgroundSetting } from './customBackgroundSetting'

beforeEach(() => {
  customBackgroundState.compatibility.customBackground = '-'
  customBackgroundState.settingsResourceState.value.customBackground = '-'
  customBackgroundState.settingsResourceState.groupStatuses.display = 'ready'
  customBackgroundState.applyServerBackedSetting.mockReset()
})

describe('legacy custom background normalization ownership', () => {
  it('repairs the ready display owner', () => {
    expect(normalizeLegacyCustomBackgroundSetting()).toBe(true)
    expect(customBackgroundState.applyServerBackedSetting).toHaveBeenCalledWith('customBackground', '')
  })

  it('uses the compatibility value only while the display owner is loading', () => {
    customBackgroundState.settingsResourceState.groupStatuses.display = 'loading'
    customBackgroundState.settingsResourceState.value.customBackground = 'owner-value'

    expect(normalizeLegacyCustomBackgroundSetting()).toBe(true)
    expect(customBackgroundState.applyServerBackedSetting).toHaveBeenCalledOnce()
  })

  it('fails closed when the display owner is in error', () => {
    customBackgroundState.settingsResourceState.groupStatuses.display = 'error'

    expect(normalizeLegacyCustomBackgroundSetting()).toBe(false)
    expect(customBackgroundState.applyServerBackedSetting).not.toHaveBeenCalled()
  })
})
