import { describe, expect, it } from 'vitest'
import {
  MODEL_ROLES,
  createDefaultLegacyFallbackModels,
  createDefaultLegacySeperateModels,
  createDefaultModelRoleOverrides,
  modelRoleProfileInheritSource,
  modelRoleToLegacyModelMode,
  normalizeLegacyFallbackModels,
  normalizeLegacySeperateModels,
  normalizeModelRole,
  normalizeModelRoleOverrides,
  resolveModelForRole,
  resolveModelRoles,
} from './modelRoles.js'

describe('model role resolver', () => {
  it('resolves every canonical role from legacy fields by default', () => {
    const source = {
      aiModel: 'main-model',
      subModel: 'aux-model',
      seperateModelsForAxModels: true,
      seperateModels: {
        memory: 'memory-model',
        emotion: 'emotion-model',
        translate: 'translate-model',
        otherAx: 'other-ax-model',
      },
    }

    expect(resolveModelRoles(source)).toEqual({
      chatMain: 'main-model',
      chatAux: 'aux-model',
      memory: 'memory-model',
      emotion: 'emotion-model',
      translate: 'translate-model',
      otherAx: 'other-ax-model',
      scriptMain: 'main-model',
      scriptAux: 'other-ax-model',
    })
  })

  it('lets non-blank role overrides win and treats blank overrides as inherit', () => {
    const source = {
      aiModel: 'main-model',
      subModel: 'aux-model',
      modelRoles: {
        memory: '   ',
        scriptAux: 'override-script-aux',
      },
      seperateModelsForAxModels: true,
      seperateModels: {
        memory: 'memory-model',
        otherAx: 'other-ax-model',
      },
    }

    expect(resolveModelForRole(source, 'memory')).toBe('memory-model')
    expect(resolveModelForRole(source, 'scriptAux')).toBe('override-script-aux')
  })

  it('ignores canonical role overrides for base main and auxiliary roles', () => {
    const source = {
      aiModel: 'main-model',
      subModel: 'aux-model',
      modelRoles: {
        chatMain: 'override-main',
        chatAux: 'override-aux',
      },
    }

    expect(resolveModelForRole(source, 'chatMain')).toBe('main-model')
    expect(resolveModelForRole(source, 'chatAux')).toBe('aux-model')
  })

  it('falls auxiliary roles back to subModel when legacy separate models are disabled', () => {
    const source = {
      aiModel: 'main-model',
      subModel: 'aux-model',
      seperateModelsForAxModels: false,
      seperateModels: {
        memory: 'memory-model',
        emotion: 'emotion-model',
        translate: 'translate-model',
        otherAx: 'other-ax-model',
      },
    }

    expect(resolveModelForRole(source, 'memory')).toBe('aux-model')
    expect(resolveModelForRole(source, 'emotion')).toBe('aux-model')
    expect(resolveModelForRole(source, 'translate')).toBe('aux-model')
    expect(resolveModelForRole(source, 'otherAx')).toBe('aux-model')
  })

  it('uses the scriptAux-specific legacy fallback chain when separate models are enabled', () => {
    expect(
      resolveModelForRole(
        {
          subModel: 'aux-model',
          seperateModelsForAxModels: true,
          seperateModels: {
            scriptAux: 'script-aux-model',
            otherAx: 'other-ax-model',
          },
        },
        'scriptAux',
      ),
    ).toBe('script-aux-model')

    expect(
      resolveModelForRole(
        {
          subModel: 'aux-model',
          seperateModelsForAxModels: true,
          seperateModels: {
            otherAx: 'other-ax-model',
          },
        },
        'scriptAux',
      ),
    ).toBe('other-ax-model')
  })

  it('falls scriptAux back to subModel when legacy separate models are disabled', () => {
    expect(
      resolveModelForRole(
        {
          subModel: 'aux-model',
          seperateModelsForAxModels: false,
          seperateModels: {
            scriptAux: 'script-aux-model',
            otherAx: 'other-ax-model',
          },
        },
        'scriptAux',
      ),
    ).toBe('aux-model')
  })

  it('uses scriptMain legacy separate model only when separate models are enabled', () => {
    expect(
      resolveModelForRole(
        {
          aiModel: 'main-model',
          seperateModelsForAxModels: true,
          seperateModels: {
            scriptMain: 'script-main-model',
          },
        },
        'scriptMain',
      ),
    ).toBe('script-main-model')

    expect(
      resolveModelForRole(
        {
          aiModel: 'main-model',
          seperateModelsForAxModels: false,
          seperateModels: {
            scriptMain: 'script-main-model',
          },
        },
        'scriptMain',
      ),
    ).toBe('main-model')
  })

  it('normalizes role maps and legacy maps with script keys present', () => {
    expect(Object.keys(normalizeModelRoleOverrides({ chatAux: 'aux' }))).toEqual([...MODEL_ROLES])
    expect(normalizeLegacySeperateModels({ scriptAux: 'script' })).toEqual({
      ...createDefaultLegacySeperateModels(),
      scriptAux: 'script',
    })
    expect(normalizeLegacyFallbackModels({ model: ['main', ''], scriptMain: ['script'] })).toEqual({
      ...createDefaultLegacyFallbackModels(),
      model: ['main'],
      scriptMain: ['script'],
    })
  })

  it('preserves canonical roles, legacy aliases, and invalid-role rejection', () => {
    expect(MODEL_ROLES).toEqual([
      'chatMain',
      'chatAux',
      'memory',
      'emotion',
      'translate',
      'otherAx',
      'scriptMain',
      'scriptAux',
    ])
    for (const role of MODEL_ROLES) expect(normalizeModelRole(role)).toBe(role)
    expect(normalizeModelRole('model')).toBe('chatMain')
    expect(normalizeModelRole('submodel')).toBe('chatAux')
    expect(normalizeModelRole(' model ')).toBeNull()
    expect(normalizeModelRole(null)).toBeNull()
    expect(normalizeModelRole('unknown')).toBeNull()
  })

  it('preserves legacy-mode and profile-inheritance mappings', () => {
    expect(MODEL_ROLES.map((role) => modelRoleToLegacyModelMode(role))).toEqual([
      'model',
      'submodel',
      'memory',
      'emotion',
      'translate',
      'otherAx',
      'scriptMain',
      'scriptAux',
    ])
    expect(MODEL_ROLES.map((role) => modelRoleProfileInheritSource(role))).toEqual([
      null,
      null,
      'chatAux',
      'chatAux',
      'chatAux',
      'chatAux',
      'chatMain',
      'chatAux',
    ])
  })

  it('normalizes only supported values while preserving nonblank fallback spelling', () => {
    expect(normalizeModelRoleOverrides({ memory: ' memory-model ', unknown: 'ignored' })).toEqual({
      ...createDefaultModelRoleOverrides(),
      memory: 'memory-model',
    })
    expect(normalizeLegacySeperateModels({ memory: ' memory-model ', scriptAux: 42 })).toEqual({
      ...createDefaultLegacySeperateModels(),
      memory: 'memory-model',
    })
    expect(normalizeLegacyFallbackModels({ model: [' main ', '', '   ', 42, 'fallback'] })).toEqual({
      ...createDefaultLegacyFallbackModels(),
      model: [' main ', 'fallback'],
    })
  })

  it('allocates fresh role and fallback maps', () => {
    const firstRoles = createDefaultModelRoleOverrides()
    const secondRoles = createDefaultModelRoleOverrides()
    firstRoles.memory = 'changed'
    expect(secondRoles.memory).toBe('')

    const firstFallbacks = createDefaultLegacyFallbackModels()
    const secondFallbacks = createDefaultLegacyFallbackModels()
    firstFallbacks.memory.push('changed')
    expect(secondFallbacks.memory).toEqual([])
  })

  it('requires the exact legacy separate-model gate and preserves fallback chains', () => {
    const source = {
      aiModel: ' main ',
      subModel: ' aux ',
      seperateModelsForAxModels: 1,
      seperateModels: {
        memory: ' memory ',
        scriptMain: ' script-main ',
        scriptAux: '   ',
        otherAx: ' other ',
      },
    }

    expect(resolveModelForRole(source, 'memory')).toBe('aux')
    expect(resolveModelForRole(source, 'scriptMain')).toBe('main')
    expect(resolveModelForRole(source, 'scriptAux')).toBe('aux')
    expect(resolveModelForRole({ ...source, seperateModelsForAxModels: true }, 'scriptAux')).toBe('other')
    expect(resolveModelForRole({}, 'memory')).toBe('')
  })
})
