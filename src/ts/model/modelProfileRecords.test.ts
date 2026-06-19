import { describe, expect, it } from 'vitest'
import { MODEL_ROLES } from './modelRoles'
import {
  createDefaultModelRoleProfiles,
  normalizeModelProfiles,
  normalizeModelRoleProfiles,
  readModelProfiles,
  readModelRoleProfiles,
} from './modelProfileRecords'

describe('model profile records', () => {
  it('defaults every role binding to legacy mode', () => {
    expect(createDefaultModelRoleProfiles()).toEqual(
      Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])),
    )
  })

  it('leniently normalizes missing and old persisted profile shapes', () => {
    expect(normalizeModelProfiles(undefined)).toEqual([])
    expect(
      normalizeModelProfiles([
        { id: ' profile-a ', name: ' Primary ', modelId: ' gpt-5 ', providerOptions: { apiKey: 'must-drop' } },
        { id: 'profile-a', name: 'Duplicate' },
        { id: 'profile-b', name: 'Identity Only', modelId: '   ' },
        { id: 'profile-c' },
        { name: 'Missing Id' },
        'bad-row',
      ]),
    ).toEqual([
      { id: 'profile-a', name: 'Primary', modelId: 'gpt-5' },
      { id: 'profile-b', name: 'Identity Only' },
      { id: 'profile-c', name: 'profile-c' },
    ])
  })

  it('accepts strict selected-model profile rows and normalized profile role bindings', () => {
    expect(
      readModelProfiles([
        { id: ' profile-a ', name: ' Primary ', modelId: ' gpt-5 ' },
        { id: ' identity-only ', name: ' Identity Only ', modelId: '   ' },
      ]),
    ).toEqual([
      { id: 'profile-a', name: 'Primary', modelId: 'gpt-5' },
      { id: 'identity-only', name: 'Identity Only' },
    ])
    expect(readModelRoleProfiles({ memory: { mode: 'profile', profileId: ' profile-a ' } })).toEqual({
      ...Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])),
      memory: { mode: 'profile', profileId: 'profile-a' },
    })
  })

  it('rejects duplicate and unsupported profile rows for settings commands', () => {
    expect(() =>
      readModelProfiles([
        { id: 'profile-a', name: 'Primary' },
        { id: ' profile-a ', name: 'Duplicate' },
      ]),
    ).toThrow('Duplicate model profile id: profile-a')

    expect(() =>
      readModelProfiles([{ id: 'profile-a', name: 'Primary', providerOptions: { apiKey: 'secret' } }]),
    ).toThrow('modelProfiles[0].providerOptions is not supported')

    expect(() => readModelProfiles([{ id: 'profile-a', name: '' }])).toThrow(
      'modelProfiles[0].name must be a non-empty string',
    )

    expect(() => readModelProfiles([{ id: 'profile-a', name: 'Primary', modelId: 123 }])).toThrow(
      'modelProfiles[0].modelId must be a string when present',
    )
  })

  it('rejects unknown role keys and malformed binding shapes for settings commands', () => {
    expect(() => readModelRoleProfiles({ unknownRole: { mode: 'legacy' } })).toThrow(
      'Unknown model role profile binding: unknownRole',
    )
    expect(() => readModelRoleProfiles({ memory: { mode: 'profile', profileId: '' } })).toThrow(
      'modelRoleProfiles.memory.profileId must be a non-empty string',
    )
    expect(() => readModelRoleProfiles({ memory: { mode: 'profile' } })).toThrow(
      'modelRoleProfiles.memory.profileId must be a non-empty string',
    )
    expect(() =>
      readModelRoleProfiles({ memory: { mode: 'profile', profileId: 'profile-a', providerOptions: {} } }),
    ).toThrow('modelRoleProfiles.memory.providerOptions is not supported')
    expect(() => readModelRoleProfiles({ memory: { mode: 'legacy', profileId: 'profile-a' } })).toThrow(
      'modelRoleProfiles.memory.profileId is only supported for profile mode',
    )
    expect(() => readModelRoleProfiles({ memory: { mode: 'inherit' } })).toThrow(
      'modelRoleProfiles.memory.mode must be legacy or profile',
    )
  })

  it('leniently normalizes profile role bindings and restores malformed bindings to legacy', () => {
    expect(
      normalizeModelRoleProfiles({
        memory: { mode: 'profile', profileId: ' profile-a ' },
        emotion: { mode: 'profile', profileId: '   ' },
        translate: { mode: 'legacy' },
      }),
    ).toEqual({
      ...Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])),
      memory: { mode: 'profile', profileId: 'profile-a' },
    })
    expect(normalizeModelRoleProfiles(null)).toEqual(
      Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])),
    )
  })
})
