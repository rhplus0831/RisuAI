import { describe, expect, it } from 'vitest'
import { SERVER_SETTINGS_KEYS_BY_GROUP } from '../../../src/ts/server/settingsGroups.js'
import { READABLE_SETTINGS_GROUPS, SETTINGS_GROUP_KEYS, SETTINGS_GROUPS } from '../src/routes/commands.js'

describe('settings group parity', () => {
  it('keeps the dedicated Agent Preset projection readable but not generically writable', () => {
    expect(READABLE_SETTINGS_GROUPS).toContain('agents')
    expect(SETTINGS_GROUPS).not.toContain('agents')
    expect(SETTINGS_GROUP_KEYS.agents).toEqual(['agentPresets', 'agentPresetDefaultId'])
    const clientGroups = SERVER_SETTINGS_KEYS_BY_GROUP as Record<string, string[]>
    expect(clientGroups.agents).toEqual([...SETTINGS_GROUP_KEYS.agents])
  })
})
