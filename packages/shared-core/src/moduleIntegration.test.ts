import { describe, expect, it } from 'vitest'
import {
  combineModuleIntegrations,
  parseModuleIntegration,
  resolveAgentPresetModuleIntegration,
} from './moduleIntegration.js'

describe('module integration helpers', () => {
  it('parses and trims integrations while preserving duplicates and order', () => {
    expect(parseModuleIntegration(' alpha, beta ,, alpha ')).toEqual(['alpha', 'beta', 'alpha'])
    expect(parseModuleIntegration('first, second, first')).toEqual(['first', 'second', 'first'])
  })

  it('rejects non-string integration inputs', () => {
    expect(parseModuleIntegration(null)).toEqual([])
    expect(parseModuleIntegration(['alpha'])).toEqual([])
    expect(parseModuleIntegration({ value: 'alpha' })).toEqual([])
  })

  it('combines values with stable first-occurrence deduplication', () => {
    expect(combineModuleIntegrations(' alpha, beta ', 'beta, exact-module', null, 'alpha, final')).toBe(
      'alpha, beta, exact-module, final',
    )
    expect(combineModuleIntegrations()).toBe('')
  })

  it('resolves integration only from the selected enabled Agent Preset', () => {
    const presets = [
      { id: 'enabled', enabled: true, moduleIntergration: 'enabled-space' },
      { id: 'disabled', enabled: false, moduleIntergration: 'disabled-space' },
    ]

    expect(resolveAgentPresetModuleIntegration(presets, ' enabled ')).toBe('enabled-space')
    expect(resolveAgentPresetModuleIntegration(presets, 'disabled')).toBe('')
    expect(resolveAgentPresetModuleIntegration(presets, 'missing')).toBe('')
  })

  it('uses the first exact ID match and returns its integration verbatim', () => {
    const presets = [
      { id: 'selected', moduleIntergration: ' first, untrimmed ' },
      { id: 'selected', moduleIntergration: 'second' },
      { id: 42, moduleIntergration: 'numeric' },
    ]

    expect(resolveAgentPresetModuleIntegration(presets, 'selected')).toBe(' first, untrimmed ')
    expect(resolveAgentPresetModuleIntegration(presets, '42')).toBe('')
  })

  it('rejects blank IDs and non-string integration values', () => {
    expect(resolveAgentPresetModuleIntegration([{ id: 'selected', moduleIntergration: 42 }], 'selected')).toBe('')
    expect(resolveAgentPresetModuleIntegration([], '   ')).toBe('')
    expect(resolveAgentPresetModuleIntegration(undefined, 'selected')).toBe('')
  })
})
