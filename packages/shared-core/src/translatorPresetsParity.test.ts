import { describe, expect, it } from 'vitest'
import * as browserPresets from '../../../src/ts/translator/presets'
import * as sharedPresets from './translatorPresets.js'

describe('translator preset browser compatibility', () => {
  it('re-exports shared record behavior and contracts by identity', () => {
    for (const key of [
      'createTranslatorPreset',
      'defaultTranslatorPrompt',
      'getCanonicalTranslatorPresets',
      'getCurrentTranslatorPresetFromState',
      'getTranslatorPresetFromState',
      'isValidTranslatorPresetOutputKey',
      'normalizeTranslatorPreset',
      'normalizeTranslatorPresetState',
      'normalizeTranslatorPresetStateWithLegacyCompatibility',
      'syncCurrentTranslatorPresetToLegacyFields',
      'TRANSLATOR_PRESET_MAX_STEPS',
      'TRANSLATOR_PRESET_OUTPUT_KEY_PATTERN',
    ] as const) {
      expect(browserPresets[key]).toBe(sharedPresets[key])
    }
  })
})
