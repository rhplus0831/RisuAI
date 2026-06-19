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
        { id: ' profile-a ', name: ' Primary ', providerOptions: { apiKey: 'must-drop' } },
        { id: 'profile-a', name: 'Duplicate' },
        { id: 'profile-b' },
        { name: 'Missing Id' },
        'bad-row',
      ]),
    ).toEqual([
      { id: 'profile-a', name: 'Primary' },
      { id: 'profile-b', name: 'profile-b' },
    ])
  })

  it('accepts strict identity-only profile rows and normalized legacy role bindings', () => {
    expect(readModelProfiles([{ id: ' profile-a ', name: ' Primary ' }])).toEqual([
      { id: 'profile-a', name: 'Primary' },
    ])
    expect(readModelRoleProfiles({ memory: { mode: 'legacy' } })).toEqual(
      Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])),
    )
  })

  it('rejects duplicate and non-identity profile rows for settings commands', () => {
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
  })

  it('rejects unknown role keys and non-legacy binding shapes for settings commands', () => {
    expect(() => readModelRoleProfiles({ unknownRole: { mode: 'legacy' } })).toThrow(
      'Unknown model role profile binding: unknownRole',
    )
    expect(() => readModelRoleProfiles({ memory: { mode: 'profile', profileId: 'profile-a' } })).toThrow(
      'modelRoleProfiles.memory.profileId is not supported',
    )
    expect(() => readModelRoleProfiles({ memory: { mode: 'profile' } })).toThrow(
      'modelRoleProfiles.memory.mode must be legacy',
    )
  })

  it('leniently restores malformed role binding maps to all-legacy defaults', () => {
    expect(normalizeModelRoleProfiles({ memory: { mode: 'profile', profileId: 'profile-a' } })).toEqual(
      Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])),
    )
    expect(normalizeModelRoleProfiles(null)).toEqual(
      Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])),
    )
  })
})
