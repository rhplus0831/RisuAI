import { describe, expect, it } from 'vitest'
import {
  applyEffectivePresetComposition,
  composeEffectivePresetSettings,
  createExtractedModelPreset,
  createExtractedPromptPreset,
  findEquivalentModelPreset,
  modelPresetFingerprint,
  PROMPT_PRESET_FIELDS,
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
    modelRuntimeDefaults: { maxContext: 12000, temperature: 45 },
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
      modelRuntimeDefaults: { maxContext: 12000, temperature: 45 },
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
    expect(promptPreset).not.toHaveProperty('modelRuntimeDefaults')
  })

  it('keeps groupTemplate and groupOtherBotRole on prompt presets through split and composition', () => {
    const source = {
      ...legacyPreset,
      groupTemplate: '[{{user}} -> {{char}}]\n{{slot}}',
      groupOtherBotRole: 'system',
    }

    const promptPreset = createExtractedPromptPreset(source, { id: 'prompt-a', name: 'Prompt A' })
    expect(promptPreset).toMatchObject({
      groupTemplate: '[{{user}} -> {{char}}]\n{{slot}}',
      groupOtherBotRole: 'system',
    })

    const modelPreset = createExtractedModelPreset(source, { id: 'model-a', name: 'Model A' })
    expect(modelPreset).not.toHaveProperty('groupTemplate')
    expect(modelPreset).not.toHaveProperty('groupOtherBotRole')

    const effective = composeEffectivePresetSettings({
      base: { groupTemplate: 'BASE TEMPLATE', groupOtherBotRole: 'user' },
      promptPreset,
      scope: 'full-generation',
    })
    expect(effective).toMatchObject({
      groupTemplate: '[{{user}} -> {{char}}]\n{{slot}}',
      groupOtherBotRole: 'system',
    })
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

  it('keeps durable profiles on model presets and only role bindings on prompt presets', () => {
    const source = {
      ...legacyPreset,
      modelProfiles: [
        {
          id: 'profile-a',
          name: 'Profile A',
          modelId: 'gpt-5',
          providerOptions: { requestModel: 'wire-model' },
          fallbacks: [{ mode: 'profile', profileId: 'fallback-profile' }],
        },
      ],
      modelRoleProfiles: { memory: { mode: 'profile', profileId: 'profile-a' } },
      modelRuntimeDefaults: { maxContext: 9000, modelTools: ['tool-a'] },
    }

    expect(createExtractedModelPreset(source, { id: 'model-a', name: 'Model A' })).toMatchObject({
      modelProfiles: [
        {
          id: 'profile-a',
          name: 'Profile A',
          modelId: 'gpt-5',
          providerOptions: { requestModel: 'wire-model' },
          fallbacks: [{ mode: 'profile', profileId: 'fallback-profile' }],
        },
      ],
      modelRoleProfiles: { memory: { mode: 'profile', profileId: 'profile-a' } },
      modelRuntimeDefaults: { maxContext: 9000, modelTools: ['tool-a'] },
    })

    const promptPreset = createExtractedPromptPreset(source, { id: 'prompt-a', name: 'Prompt A' })
    expect(promptPreset).toMatchObject({
      modelRoleProfiles: { memory: { mode: 'profile', profileId: 'profile-a' } },
    })
    expect(promptPreset).not.toHaveProperty('modelProfiles')
    expect(promptPreset).not.toHaveProperty('modelRuntimeDefaults')
  })

  it('exports prompt preset fields plus stored model override values', () => {
    expect(
      promptPresetExportPayload({
        ...legacyPreset,
        archived: true,
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
      archived: true,
    })
  })

  it('normalizes standalone archive metadata without making it an applied prompt field', () => {
    expect(PROMPT_PRESET_FIELDS).not.toContain('archived')
    expect(promptPresetExportPayload({ name: 'Active', archived: false })).toMatchObject({ archived: false })
    expect(promptPresetExportPayload({ name: 'Legacy active' })).toMatchObject({ archived: false })
    expect(promptPresetExportPayload({ name: 'Invalid', archived: 'true' })).toMatchObject({ archived: false })
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

describe('effective preset composition', () => {
  it('composes base, model preset, then prompt preset overrides for full generation', () => {
    const base = {
      apiType: 'base-api',
      aiModel: 'base-model',
      temperature: 10,
      NAIsettings: { cfg_scale: 1 },
      reasoningEffort: 'base-reason',
      modelRoles: { memory: 'base-memory' },
      mainPrompt: 'BASE MAIN',
      additionalParams: [['base', '1']],
    }
    const modelPreset = {
      id: 'model-a',
      apiType: 'model-api',
      aiModel: 'model-model',
      temperature: 20,
      NAISettings: { cfg_scale: 2 },
      reasonEffort: 'model-reason',
      modelRoles: { memory: 'model-memory' },
      additionalParams: [['model', '2']],
    }
    const promptPreset = {
      id: 'prompt-a',
      mainPrompt: 'PROMPT MAIN',
      overrideModelParameters: true,
      temperature: 30,
      reasonEffort: 'prompt-reason',
      modelRoles: { memory: 'prompt-memory' },
      additionalParams: [['prompt', '3']],
    }

    const effective = composeEffectivePresetSettings({ base, modelPreset, promptPreset, scope: 'full-generation' })

    expect(effective).toMatchObject({
      apiType: 'model-api',
      aiModel: 'model-model',
      temperature: 30,
      NAIsettings: { cfg_scale: 2 },
      reasoningEffort: 'prompt-reason',
      modelRoles: { memory: 'prompt-memory' },
      mainPrompt: 'PROMPT MAIN',
      additionalParams: [['prompt', '3']],
    })
    expect(base).toMatchObject({
      apiType: 'base-api',
      temperature: 10,
      mainPrompt: 'BASE MAIN',
      additionalParams: [['base', '1']],
    })
  })

  it('applies prompt parameter overrides only when enabled', () => {
    const base = { temperature: 10, maxContext: 1000 }
    const modelPreset = { id: 'model-a', temperature: 20, maxContext: 2000 }
    const disabledPromptPreset = {
      id: 'prompt-disabled',
      overrideModelParameters: false,
      temperature: 30,
      maxContext: 3000,
    }
    const enabledPromptPreset = {
      id: 'prompt-enabled',
      overrideModelParameters: true,
      temperature: 40,
      maxContext: 4000,
    }

    expect(
      composeEffectivePresetSettings({
        base,
        modelPreset,
        promptPreset: disabledPromptPreset,
        scope: 'model-runtime',
      }),
    ).toMatchObject({
      temperature: 20,
      maxContext: 2000,
    })

    expect(
      composeEffectivePresetSettings({
        base,
        modelPreset,
        promptPreset: enabledPromptPreset,
        scope: 'model-runtime',
      }),
    ).toMatchObject({
      temperature: 40,
      maxContext: 4000,
    })
  })

  it('lets Prompt Others override role, separate-model, and fallback fields even when parameters are disabled', () => {
    const effective = composeEffectivePresetSettings({
      base: {
        temperature: 10,
        modelRoles: { memory: 'base-memory' },
        modelProfiles: [{ id: 'base-profile', name: 'Base Profile' }],
        modelRoleProfiles: { memory: { mode: 'profile', profileId: 'base-profile' } },
        modelRuntimeDefaults: { maxContext: 1000 },
        seperateModelsForAxModels: false,
        seperateModels: { memory: 'base-separate' },
        fallbackModels: { model: 'base-fallback' },
      },
      modelPreset: {
        id: 'model-a',
        temperature: 20,
        modelRoles: { memory: 'model-memory' },
        modelProfiles: [{ id: 'model-profile', name: 'Model Profile' }],
        modelRoleProfiles: { memory: { mode: 'profile', profileId: 'model-profile' } },
        modelRuntimeDefaults: { maxContext: 2000, modelTools: ['model-tool'] },
        seperateModelsForAxModels: false,
        seperateModels: { memory: 'model-separate' },
        fallbackModels: { model: 'model-fallback' },
      },
      promptPreset: {
        id: 'prompt-a',
        overrideModelParameters: false,
        temperature: 30,
        modelRoles: { memory: 'prompt-memory' },
        modelProfiles: [{ id: 'prompt-profile', name: 'Prompt Profile' }],
        modelRoleProfiles: { memory: { mode: 'profile', profileId: 'prompt-profile' } },
        modelRuntimeDefaults: { maxContext: 3000 },
        seperateModelsForAxModels: true,
        seperateModels: { memory: 'prompt-separate' },
        fallbackModels: { model: 'prompt-fallback' },
      },
      scope: 'model-runtime',
    })

    expect(effective).toMatchObject({
      temperature: 20,
      modelRoles: { memory: 'prompt-memory' },
      modelProfiles: [{ id: 'model-profile', name: 'Model Profile' }],
      modelRoleProfiles: { memory: { mode: 'profile', profileId: 'prompt-profile' } },
      modelRuntimeDefaults: { maxContext: 2000, modelTools: ['model-tool'] },
      seperateModelsForAxModels: true,
      seperateModels: { memory: 'prompt-separate' },
      fallbackModels: { model: 'prompt-fallback' },
    })
  })

  it('maps prompt regex aliases to presetRegex in full-generation scope', () => {
    const legacy = [{ id: 'legacy-regex', in: 'hello', out: 'hi', type: 'editinput' }]
    const canonical = [{ id: 'canonical-regex', in: 'hello', out: 'hey', type: 'editinput' }]

    const effective = composeEffectivePresetSettings({
      base: { presetRegex: [{ id: 'base-regex' }] },
      promptPreset: {
        id: 'prompt-a',
        mainPrompt: 'PROMPT MAIN',
        regex: legacy,
        presetRegex: canonical,
      },
      scope: 'full-generation',
    })

    expect(effective.mainPrompt).toBe('PROMPT MAIN')
    expect(effective.presetRegex).toEqual(canonical)
    expect(effective).not.toHaveProperty('regex')
  })

  it('excludes prompt text and regex fields in model-runtime scope', () => {
    const baseRegex = [{ id: 'base-regex', type: 'editinput' }]
    const promptRegex = [{ id: 'prompt-regex', type: 'editinput' }]

    const effective = composeEffectivePresetSettings({
      base: {
        mainPrompt: 'BASE MAIN',
        presetRegex: baseRegex,
        temperature: 10,
      },
      promptPreset: {
        id: 'prompt-a',
        mainPrompt: 'PROMPT MAIN',
        jailbreak: 'PROMPT JB',
        presetRegex: promptRegex,
        overrideModelParameters: true,
        temperature: 40,
      },
      scope: 'model-runtime',
    })

    expect(effective).toMatchObject({
      mainPrompt: 'BASE MAIN',
      presetRegex: baseRegex,
      temperature: 40,
    })
    expect(effective).not.toHaveProperty('jailbreak')
  })

  it('clones composed output and applied target values', () => {
    const base = {
      globalChatVariables: { kept: 'yes' },
      customFlags: [1],
    }
    const modelPreset = {
      id: 'model-a',
      customFlags: [2],
    }
    const promptPreset = {
      id: 'prompt-a',
      modelRoles: { memory: 'prompt-memory' },
      additionalParams: [['prompt', '3']],
    }

    const effective = composeEffectivePresetSettings({ base, modelPreset, promptPreset, scope: 'model-runtime' })
    expect(effective.globalChatVariables).toEqual({ kept: 'yes' })
    expect(effective.globalChatVariables).not.toBe(base.globalChatVariables)
    expect(effective.customFlags).toEqual([2])
    expect(effective.customFlags).not.toBe(modelPreset.customFlags)
    expect(effective.modelRoles).toEqual({ memory: 'prompt-memory' })
    expect(effective.modelRoles).not.toBe(promptPreset.modelRoles)
    expect(effective.additionalParams).toEqual([['prompt', '3']])
    expect(effective.additionalParams).not.toBe(promptPreset.additionalParams)
    ;(effective.customFlags as number[]).push(9)
    ;(effective.additionalParams as string[][])[0][1] = 'changed'
    expect(modelPreset.customFlags).toEqual([2])
    expect(promptPreset.additionalParams).toEqual([['prompt', '3']])

    const appliedPromptPreset = {
      id: 'prompt-b',
      additionalParams: [['target', '1']],
    }
    const target: Record<string, unknown> = {}
    applyEffectivePresetComposition(target, {
      promptPreset: appliedPromptPreset,
      scope: 'model-runtime',
    })
    expect(target.additionalParams).toEqual([['target', '1']])
    expect(target.additionalParams).not.toBe(appliedPromptPreset.additionalParams)
  })
})
