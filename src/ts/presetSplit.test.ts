import { describe, expect, it } from 'vitest'
import {
  createExtractedModelPreset,
  createExtractedPromptPreset,
  findEquivalentModelPreset,
  modelPresetFingerprint,
  promptPresetExportPayload,
  resolvePromptPresetRegexField,
} from './presetSplit'

describe('preset split helpers', () => {
  const legacyPreset = {
    id: 'legacy-a',
    name: 'Legacy A',
    aiModel: 'gpt-4o',
    apiType: 'openai',
    temperature: 0.7,
    maxContext: 16000,
    additionalParams: [['temperature', '{{none}}']],
    enableCustomFlags: true,
    customFlags: [8],
    mainPrompt: 'Prompt text',
    jailbreak: 'Jailbreak text',
    customPromptTemplateToggle: 'mode=Mode',
    promptTemplate: [{ type: 'plain', text: 'Template row' }],
    proxyKey: 'secret',
  }

  it('extracts model and prompt fields into separate presets', () => {
    const modelPreset = createExtractedModelPreset(legacyPreset, { id: 'model-a', name: 'Model A' })
    const promptPreset = createExtractedPromptPreset(legacyPreset, { id: 'prompt-a', name: 'Prompt A' })

    expect(modelPreset).toMatchObject({
      id: 'model-a',
      name: 'Model A',
      aiModel: 'gpt-4o',
      apiType: 'openai',
      temperature: 0.7,
      maxContext: 16000,
      additionalParams: [['temperature', '{{none}}']],
      enableCustomFlags: true,
      customFlags: [8],
      proxyKey: 'secret',
    })
    expect(modelPreset).not.toHaveProperty('mainPrompt')
    expect(modelPreset).not.toHaveProperty('promptTemplate')

    expect(promptPreset).toMatchObject({
      id: 'prompt-a',
      name: 'Prompt A',
      mainPrompt: 'Prompt text',
      jailbreak: 'Jailbreak text',
      customPromptTemplateToggle: 'mode=Mode',
      promptTemplate: [{ type: 'plain', text: 'Template row' }],
      temperature: 0.7,
      maxContext: 16000,
      additionalParams: [['temperature', '{{none}}']],
      enableCustomFlags: true,
      customFlags: [8],
    })
    expect(promptPreset).not.toHaveProperty('aiModel')
    expect(promptPreset).not.toHaveProperty('proxyKey')
  })

  it('dedupes model presets by model fields rather than identity', () => {
    const first = createExtractedModelPreset(legacyPreset, { id: 'model-a', name: 'Model A' })
    const second = createExtractedModelPreset(
      {
        ...legacyPreset,
        id: 'legacy-b',
        name: 'Different prompt wrapper',
        mainPrompt: 'Different prompt',
      },
      { id: 'model-b', name: 'Model B' },
    )

    expect(modelPresetFingerprint(first)).toBe(modelPresetFingerprint(second))
    expect(findEquivalentModelPreset([first], second)).toBe(first)
  })

  it('exports prompt preset fields plus stored model override values', () => {
    expect(
      promptPresetExportPayload({
        ...legacyPreset,
        overrideModelParameters: true,
      }),
    ).toEqual({
      id: 'legacy-a',
      name: 'Legacy A',
      mainPrompt: 'Prompt text',
      jailbreak: 'Jailbreak text',
      customPromptTemplateToggle: 'mode=Mode',
      promptTemplate: [{ type: 'plain', text: 'Template row' }],
      overrideModelParameters: true,
      temperature: 0.7,
      maxContext: 16000,
      additionalParams: [['temperature', '{{none}}']],
      enableCustomFlags: true,
      customFlags: [8],
    })
  })

  it('resolves prompt preset regex aliases as one logical field', () => {
    const legacy = [{ id: 'legacy-regex', in: 'hello', out: 'hi', type: 'editinput' }]
    const canonical = [{ id: 'canonical-regex', in: 'hello', out: 'hey', type: 'editinput' }]

    expect(resolvePromptPresetRegexField({ regex: legacy, presetRegex: [] })).toEqual({
      present: true,
      value: legacy,
    })
    expect(resolvePromptPresetRegexField({ regex: legacy, presetRegex: canonical })).toEqual({
      present: true,
      value: canonical,
    })
    expect(resolvePromptPresetRegexField({ presetRegex: [] })).toEqual({
      present: true,
      value: [],
    })
    expect(resolvePromptPresetRegexField({ mainPrompt: 'Prompt text' })).toEqual({
      present: false,
      value: undefined,
    })
  })
})
