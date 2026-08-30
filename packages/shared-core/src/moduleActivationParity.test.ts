import { describe, expect, it } from 'vitest'
import * as browserActivation from '../../../src/ts/moduleActivation'
import * as sharedActivation from './moduleActivation.js'

describe('module-activation browser compatibility', () => {
  it('re-exports the shared contracts and generic resolver by identity', () => {
    expect(browserActivation.MODULE_ACTIVATION_SOURCES).toBe(sharedActivation.MODULE_ACTIVATION_SOURCES)
    expect(browserActivation.resolveModuleActivationStates).toBe(sharedActivation.resolveModuleActivationStates)
    expect(browserActivation.hasModuleActivationIdentifiers).toBe(sharedActivation.hasModuleActivationIdentifiers)
    expect(browserActivation.moduleActivationIdentifiersKey).toBe(sharedActivation.moduleActivationIdentifiersKey)
  })
})
