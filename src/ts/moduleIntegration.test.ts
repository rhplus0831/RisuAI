import { describe, expect, it } from 'vitest'
import {
  combineModuleIntegrations,
  parseModuleIntegration,
  resolveAgentPresetModuleIntegration,
} from './moduleIntegration'

describe('module integration helpers', () => {
  it('parses, trims, and combines module IDs and namespaces without duplicates', () => {
    expect(parseModuleIntegration(' alpha, beta ,, alpha ')).toEqual(['alpha', 'beta', 'alpha'])
    expect(combineModuleIntegrations(' alpha, beta ', 'beta, exact-module')).toBe('alpha, beta, exact-module')
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
})
