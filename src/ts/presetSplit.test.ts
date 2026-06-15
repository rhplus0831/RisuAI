import { describe, expect, it } from 'vitest'
import {
  createExtractedModelPreset,
  createExtractedPromptPreset,
  findEquivalentModelPreset,
  modelPresetFingerprint,
  promptPresetExportPayload,
} from './presetSplit'

describe('preset split helpers', () => {
  const legacyPreset = {
    id: 'legacy-a',
    name: 'Legacy A',
    aiModel: 'gpt-4o',
    apiType: 'openai',
    temperature: 0.7,
    maxContext: 16000,
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

  it('exports only prompt preset fields', () => {
    expect(promptPresetExportPayload(legacyPreset)).toEqual({
      id: 'legacy-a',
      name: 'Legacy A',
      mainPrompt: 'Prompt text',
      jailbreak: 'Jailbreak text',
      customPromptTemplateToggle: 'mode=Mode',
      promptTemplate: [{ type: 'plain', text: 'Template row' }],
    })
  })
})
