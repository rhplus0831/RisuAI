import { describe, expect, it } from 'vitest'
import {
  MODEL_PROFILE_SETTINGS_KEYS,
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

  it('exposes model profile records through a dedicated read group while retaining provider write ownership', () => {
    expect(SETTINGS_GROUPS).toContain('models')
    expect(isSettingsGroup('models')).toBe(true)
    expect(SERVER_SETTINGS_KEYS_BY_GROUP.models).toEqual([...MODEL_PROFILE_SETTINGS_KEYS])

    for (const key of MODEL_PROFILE_SETTINGS_KEYS) {
      expect(SERVER_SETTINGS_GROUP_BY_KEY[key]).toBe('providers')
      expect(SERVER_SETTINGS_KEYS_BY_GROUP.providers).toContain(key)
    }
  })

  it('exposes the Translator Preset selection only through language reads', () => {
    expect(SERVER_SETTINGS_KEYS_BY_GROUP.language).toContain('translatorPresetId')
    expect(SERVER_SETTINGS_GROUP_BY_KEY).not.toHaveProperty('translatorPresetId')
  })
})
