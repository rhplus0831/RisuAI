import { describe, expect, it } from 'vitest'
import { resolveModelProfile, resolveModelProfileWithLegacyCompatibility } from './modelProfileResolver.js'

describe('nullable legacy model runtime settings', () => {
  it.each([
    { defaults: { dynamicMessages: true }, local: null, expected: null },
    { defaults: null, local: undefined, expected: null },
    { defaults: null, local: { dynamicMessages: false }, expected: { dynamicMessages: false } },
    { defaults: undefined, local: undefined, expected: undefined },
  ])(
    'preserves dynamic-output ownership with defaults=$defaults and profile=$local',
    ({ defaults, local, expected }) => {
      const database = {
        dynamicOutput: { dynamicMessages: true },
        modelRuntimeDefaults: defaults === undefined ? {} : { dynamicOutput: defaults },
        modelProfiles: [
          {
            id: 'profile',
            name: 'Main',
            modelId: 'echo_model',
            runtimeOptions: local === undefined ? {} : { dynamicOutput: local },
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'profile' } },
      }
      const bytes = JSON.stringify(database)
      const profile = resolveModelProfile({ database })
      expect(profile.source.kind).toBe('durable-profile')
      expect(profile.runtimeOptions.dynamicOutput).toEqual(expected)
      expect(JSON.stringify(database)).toBe(bytes)
    },
  )

  it('retains a legacy dynamic-output clear while leaving an unset thinking budget absent', () => {
    const profile = resolveModelProfileWithLegacyCompatibility({
      database: { dynamicOutput: null, thinkingTokens: null },
      staticModel: 'echo_model',
    })
    expect(profile.runtimeOptions.dynamicOutput).toBeNull()
    expect(profile.runtimeOptions.thinkingTokens).toBeUndefined()
  })
})
