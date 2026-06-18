import { describe, expect, it } from 'vitest'
import {
  MODEL_ROLES,
  createDefaultLegacyFallbackModels,
  createDefaultLegacySeperateModels,
  normalizeLegacyFallbackModels,
  normalizeLegacySeperateModels,
  normalizeModelRoleOverrides,
  resolveModelForRole,
  resolveModelRoles,
} from './modelRoles'

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
})
