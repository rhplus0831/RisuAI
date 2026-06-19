import { describe, expect, it } from 'vitest'
import { createInitialDatabase, normalizeDatabaseDefaults } from '../src/databaseDefaults.js'
import { MODEL_ROLES } from '../../../src/ts/model/modelRoles.js'

describe('database defaults', () => {
  it('creates canonical model roles and script compatibility keys', () => {
    const database = createInitialDatabase()

    expect(Object.keys(database.modelRoles as Record<string, unknown>)).toEqual([...MODEL_ROLES])
    expect(database.modelProfiles).toEqual([])
    expect(database.modelRoleProfiles).toEqual(
      Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])),
    )
    expect(database.seperateModels).toMatchObject({
      memory: '',
      emotion: '',
      translate: '',
      otherAx: '',
      scriptMain: '',
      scriptAux: '',
    })
    expect(database.fallbackModels).toMatchObject({
      model: [],
      memory: [],
      emotion: [],
      translate: [],
      otherAx: [],
      scriptMain: [],
      scriptAux: [],
    })
    expect(database.seperateParameters).toMatchObject({
      memory: {},
      emotion: {},
      translate: {},
      otherAx: {},
      scriptMain: {},
      scriptAux: {},
      overrides: {},
    })
  })

  it('normalizes old model maps without dropping script roles', () => {
    const database = normalizeDatabaseDefaults(
      {
        aiModel: 'main-model',
        subModel: 'aux-model',
        modelRoles: {
          chatMain: 'role-main',
          memory: '   ',
          scriptAux: 'role-script-aux',
        },
        seperateModels: {
          otherAx: 'legacy-other-ax',
          scriptAux: 'legacy-script-aux',
        },
        fallbackModels: {
          model: ['main-fallback', ''],
          otherAx: ['other-fallback'],
          scriptAux: ['script-fallback', ''],
        },
        seperateParameters: {
          memory: { temperature: 50 },
          scriptAux: { top_p: 0.7 },
          overrides: { 'model-a': { top_k: 20 } },
        },
        modelProfiles: [
          { id: 'profile-a', name: 'Primary', providerOptions: { apiKey: 'must-drop' } },
          { id: 'profile-a', name: 'Duplicate' },
          { id: 'profile-b' },
        ],
        modelRoleProfiles: {
          memory: { mode: 'profile', profileId: 'profile-a' },
          translate: { mode: 'legacy' },
        },
      },
      { providerDefaults: false },
    )

    expect(database.modelRoles).toMatchObject({
      chatMain: 'role-main',
      memory: '',
      scriptAux: 'role-script-aux',
    })
    expect(database.seperateModels).toMatchObject({
      otherAx: 'legacy-other-ax',
      scriptMain: '',
      scriptAux: 'legacy-script-aux',
    })
    expect(database.fallbackModels).toMatchObject({
      model: ['main-fallback'],
      otherAx: ['other-fallback'],
      scriptMain: [],
      scriptAux: ['script-fallback'],
    })
    expect(database.seperateParameters).toMatchObject({
      memory: { temperature: 50 },
      scriptMain: {},
      scriptAux: { top_p: 0.7 },
      overrides: { 'model-a': { top_k: 20 } },
    })
    expect(database.modelProfiles).toEqual([
      { id: 'profile-a', name: 'Primary' },
      { id: 'profile-b', name: 'profile-b' },
    ])
    expect(database.modelRoleProfiles).toEqual(
      Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])),
    )
  })
})
