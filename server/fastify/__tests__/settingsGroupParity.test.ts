import { describe, expect, it } from 'vitest'
import { SERVER_SETTINGS_KEYS_BY_GROUP } from '../../../src/ts/server/settingsGroups.js'
import { READABLE_SETTINGS_GROUPS, SETTINGS_GROUP_KEYS, SETTINGS_GROUPS } from '../src/routes/commands.js'

describe('settings group parity', () => {
  it('assigns every generically writable setting to exactly one canonical group', () => {
    const owners = new Map<string, string[]>()
    for (const group of SETTINGS_GROUPS) {
      const keys = SETTINGS_GROUP_KEYS[group]
      expect(new Set(keys).size, `${group} contains duplicate keys`).toBe(keys.length)
      for (const key of keys) {
        owners.set(key, [...(owners.get(key) ?? []), group])
      }
    }

    expect(
      [...owners.entries()].filter(([, groups]) => groups.length > 1),
      "writable settings must not advance a different group's revision fence",
    ).toEqual([])
  })

  it('keeps the dedicated Agent Preset projection readable but not generically writable', () => {
    expect(READABLE_SETTINGS_GROUPS).toContain('agents')
    expect(SETTINGS_GROUPS).not.toContain('agents')
    expect(SETTINGS_GROUP_KEYS.agents).toEqual(['agentPresets', 'agentPresetDefaultId'])
    const clientGroups = SERVER_SETTINGS_KEYS_BY_GROUP as Record<string, string[]>
    expect(clientGroups.agents).toEqual([...SETTINGS_GROUP_KEYS.agents])
  })

  it('keeps the model profile projection exact, read-only, and provider-write compatible', () => {
    const modelProfileSettingsKeys = ['modelProfiles', 'modelRoleProfiles', 'modelRuntimeDefaults']
    expect(READABLE_SETTINGS_GROUPS).toContain('models')
    expect(SETTINGS_GROUPS).not.toContain('models')
    expect(SETTINGS_GROUP_KEYS.models).toEqual(modelProfileSettingsKeys)
    const clientGroups = SERVER_SETTINGS_KEYS_BY_GROUP as Record<string, string[]>
    expect(clientGroups.models).toEqual(modelProfileSettingsKeys)

    for (const key of modelProfileSettingsKeys) {
      expect(SETTINGS_GROUP_KEYS.providers).toContain(key)
      expect(clientGroups.providers).toContain(key)
    }
  })

  it('does not accept the retired Claude batching setting', () => {
    expect(SETTINGS_GROUP_KEYS.providers).not.toContain('claudeBatching')
    expect(SERVER_SETTINGS_KEYS_BY_GROUP.providers).not.toContain('claudeBatching')
  })

  it('does not accept the retired Claude cache-retrieval setting', () => {
    expect(SETTINGS_GROUP_KEYS.providers).not.toContain('claudeRetrivalCaching')
    expect(SERVER_SETTINGS_KEYS_BY_GROUP.providers).not.toContain('claudeRetrivalCaching')
  })

  it('does not accept the retired force-proxy-format setting', () => {
    expect(SETTINGS_GROUP_KEYS.advanced).not.toContain('forceProxyAsOpenAI')
    expect(SERVER_SETTINGS_KEYS_BY_GROUP.advanced).not.toContain('forceProxyAsOpenAI')
  })

  it('does not accept the retired Hypa punctuation setting', () => {
    expect(SETTINGS_GROUP_KEYS.memory).not.toContain('removePunctuationHypa')
    expect(SERVER_SETTINGS_KEYS_BY_GROUP.memory).not.toContain('removePunctuationHypa')
  })
})
