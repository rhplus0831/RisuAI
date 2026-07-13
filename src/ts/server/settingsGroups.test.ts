import { describe, expect, it } from 'vitest'
import {
  SERVER_SETTINGS_GROUP_BY_KEY,
  SERVER_SETTINGS_KEYS_BY_GROUP,
  SETTINGS_GROUPS,
  isSettingsGroup,
} from './settingsGroups'

describe('settings group contracts', () => {
  it('exposes Agent Presets through a dedicated read-only group', () => {
    expect(SETTINGS_GROUPS).toContain('agents')
    expect(isSettingsGroup('agents')).toBe(true)
    expect(SERVER_SETTINGS_KEYS_BY_GROUP.agents).toEqual(['agentPresets', 'agentPresetDefaultId'])

    // Dedicated Agent Preset commands own these values. Keeping them out of
    // the generic write-owner map prevents compatibility settings patches
    // from routing around that validation.
    expect(SERVER_SETTINGS_GROUP_BY_KEY).not.toHaveProperty('agentPresets')
    expect(SERVER_SETTINGS_GROUP_BY_KEY).not.toHaveProperty('agentPresetDefaultId')
  })
})
