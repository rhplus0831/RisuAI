import { describe, expect, it } from 'vitest'
import * as browserPresetSplit from '../../../src/ts/presetSplit'
import * as sharedPresetSplit from './presetSplit.js'

describe('preset-split browser compatibility', () => {
  it('re-exports shared constants and behavior by identity', () => {
    for (const key of [
      'MODEL_PRESET_FIELDS',
      'PROMPT_PRESET_MODEL_PARAMETERS_OVERRIDE_KEY',
      'PROMPT_PRESET_MODEL_PARAMETER_OVERRIDE_FIELDS',
      'PROMPT_PRESET_MODEL_OTHERS_OVERRIDE_FIELDS',
      'PROMPT_PRESET_MODEL_OVERRIDE_FIELDS',
      'PROMPT_PRESET_FIELDS',
      'PROMPT_PRESET_METADATA_FIELDS',
      'PROMPT_PRESET_PERSISTED_FIELDS',
    ] as const) {
      expect(browserPresetSplit[key]).toBe(sharedPresetSplit[key])
    }
    for (const key of [
      'hasModelPresetOnlyFields',
      'isLegacyModelPresetCompatibilityRecord',
      'applyLegacyModelPresetCompatibilitySelection',
      'extractModelPresetFields',
      'extractPromptPresetFields',
      'extractPromptPresetPersistedFields',
      'promptPresetRecommendedModelPresetId',
      'repairPromptPresetRecommendedModelPresetReferences',
      'clearPromptPresetRecommendedModelPresetReferences',
      'extractPromptPresetModelOverrideFields',
      'createExtractedModelPreset',
      'createExtractedPromptPreset',
      'modelPresetFingerprint',
      'findEquivalentModelPreset',
      'promptPresetExportPayload',
      'databaseKeyForModelPresetField',
      'modelPresetFieldForDatabaseKey',
      'promptPresetModelOverrideFieldForDatabaseKey',
      'isPromptPresetModelParameterOverrideField',
      'isPromptPresetModelOthersOverrideField',
      'promptPresetOverridesModelParameters',
      'resolvePromptPresetRegexField',
      'composeEffectivePresetSettings',
      'applyEffectivePresetComposition',
      'applyPromptPresetModelOverrides',
    ] as const) {
      expect(browserPresetSplit[key]).toBe(sharedPresetSplit[key])
    }
  })
})
