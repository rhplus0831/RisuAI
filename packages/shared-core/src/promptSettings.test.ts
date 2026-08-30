import { describe, expect, it } from 'vitest'
import { PROMPT_SETTINGS_KEYS } from './promptSettings.js'

describe('prompt settings vocabulary', () => {
  it('preserves the complete ordered key contract', () => {
    expect(PROMPT_SETTINGS_KEYS).toEqual([
      'mainPrompt',
      'jailbreak',
      'globalNote',
      'formatingOrder',
      'promptPreprocess',
      'presetRegex',
      'promptSettings',
      'jsonSchemaEnabled',
      'jsonSchema',
      'strictJsonSchema',
      'extractJson',
      'customPromptTemplateToggle',
      'templateDefaultVariables',
      'OAIPrediction',
      'autoSuggestPrompt',
      'systemContentReplacement',
      'systemRoleReplacement',
      'outputImageModal',
      'fallbackModels',
      'fallbackWhenBlankResponse',
      'doNotChangeFallbackModels',
    ])
  })

  it('contains no duplicate keys', () => {
    expect(new Set(PROMPT_SETTINGS_KEYS).size).toBe(PROMPT_SETTINGS_KEYS.length)
  })
})
