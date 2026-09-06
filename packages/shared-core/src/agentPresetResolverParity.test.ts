import { describe, expect, it } from 'vitest'
import * as browserResolver from '../../../src/ts/agentPresetResolver'
import * as sharedResolver from './agentPresetResolver.js'

describe('agent-preset-resolver browser compatibility', () => {
  it('re-exports shared resolver contracts and behavior by identity', () => {
    for (const key of [
      'resolveAgentPresetForChat',
      'planAgentPreset',
      'createAgentPresetStatusSummary',
      'resolveEffectiveAgentPresetId',
    ] as const) {
      expect(browserResolver[key]).toBe(sharedResolver[key])
    }
  })
})
