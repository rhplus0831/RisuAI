import { describe, expect, it } from 'vitest'
import {
  MODULE_ACTIVATION_SOURCES,
  hasModuleActivationIdentifiers,
  moduleActivationIdentifiersKey,
  resolveModuleActivationStates,
} from './moduleActivation.js'

describe('shared module activation', () => {
  it('matches ids and namespaces while preserving source order and module identity', () => {
    const direct = { id: 'direct-module' }
    const namespaced = { id: 'codex-module', namespace: 'Codex' }

    const states = resolveModuleActivationStates({
      modules: [direct, namespaced],
      identifiers: {
        global: ['direct-module'],
        chat: ['Codex'],
        promptPresetIntegration: ['Codex'],
      },
    })

    expect(states).toEqual([
      { module: direct, sources: ['global'] },
      { module: namespaced, sources: ['chat', 'promptPresetIntegration'] },
    ])
    expect(states[0]?.module).toBe(direct)
    expect(MODULE_ACTIVATION_SOURCES).toEqual([
      'global',
      'chat',
      'character',
      'persona',
      'promptPresetIntegration',
      'agentPresetIntegration',
      'legacyIntegration',
    ])
  })

  it('keeps the first matching row for duplicate module ids', () => {
    const first = { id: 'module-a', namespace: 'shared' }
    const duplicate = { id: 'module-a', namespace: 'shared' }

    expect(
      resolveModuleActivationStates({
        modules: [first, duplicate],
        identifiers: { promptPresetIntegration: ['shared'] },
      }),
    ).toEqual([{ module: first, sources: ['promptPresetIntegration'] }])
  })

  it('allows a later duplicate to win when the earlier row is inactive', () => {
    const inactive = { id: 'module-a', namespace: 'other' }
    const active = { id: 'module-a', namespace: 'shared' }

    expect(
      resolveModuleActivationStates({
        modules: [inactive, active],
        identifiers: { promptPresetIntegration: ['shared'] },
      }),
    ).toEqual([{ module: active, sources: ['promptPresetIntegration'] }])
  })

  it('keeps presence and cache-key semantics separate', () => {
    const identifiers = {
      global: ['module-a', 'module-a'],
      chat: null,
      legacyIntegration: ['module-b'],
    } as const

    expect(hasModuleActivationIdentifiers({ chat: [], character: null })).toBe(false)
    expect(hasModuleActivationIdentifiers(identifiers)).toBe(true)
    expect(moduleActivationIdentifiersKey(identifiers)).toBe(
      JSON.stringify([['module-a', 'module-a'], [], [], [], [], [], ['module-b']]),
    )
    expect(moduleActivationIdentifiersKey({ legacyIntegration: ['module-b'] })).not.toBe(
      moduleActivationIdentifiersKey({ global: ['module-b'] }),
    )
  })
})
