import { describe, expect, it } from 'vitest'
import {
  applyModelPreset,
  applyPromptPreset,
  createModelPresetRecord,
  createPromptPresetRecord,
  readModelPresetPatch,
  readPromptPresetPatch,
  resolveModelPresetMaskedSecrets,
} from '../src/commands/splitPresets.js'
import { MASKED_PROVIDER_SECRET } from '../src/providerSecrets.js'
import { MODEL_ROLES } from '../../../src/ts/model/modelRoles.js'

const normalizedModelRoles = (overrides: Record<string, string> = {}) => ({
  chatMain: '',
  chatAux: '',
  memory: '',
  emotion: '',
  translate: '',
  otherAx: '',
  scriptMain: '',
  scriptAux: '',
  ...overrides,
})

const normalizedSeperateModels = (overrides: Record<string, string> = {}) => ({
  memory: '',
  emotion: '',
  translate: '',
  otherAx: '',
  scriptMain: '',
  scriptAux: '',
  ...overrides,
})

const normalizedFallbackModels = (overrides: Record<string, string[]> = {}) => ({
  model: [],
  memory: [],
  emotion: [],
  translate: [],
  otherAx: [],
  scriptMain: [],
  scriptAux: [],
  ...overrides,
})

const normalizedSeperateParameters = (overrides: Record<string, Record<string, unknown>> = {}) => ({
  memory: {},
  emotion: {},
  translate: {},
  otherAx: {},
  scriptMain: {},
  scriptAux: {},
  overrides: {},
  ...overrides,
})

const normalizedModelRoleProfiles = (overrides: Record<string, Record<string, unknown>> = {}) => ({
  ...Object.fromEntries(MODEL_ROLES.map((role) => [role, { mode: 'legacy' }])),
  ...overrides,
})

describe('split preset command normalization', () => {
  it('normalizes model preset role-adjacent fields on create and apply', () => {
    const preset = createModelPresetRecord({
      id: 'model-a',
      name: 'Model A',
      modelRoles: { chatMain: ' main-model ', memory: ' memory-model ', missing: 'ignored' },
      modelProfiles: [
        {
          id: ' profile-a ',
          name: ' Primary ',
          modelId: ' gpt-5 ',
          providerOptions: { requestModel: ' wire-model ', apiKey: ' profile-secret ', openAIKey: 'must-drop' },
        },
        { id: 'profile-a', name: 'Duplicate' },
        { id: 'profile-b', name: 'Secondary', modelId: '   ' },
      ],
      modelRoleProfiles: {
        memory: { mode: 'profile', profileId: ' profile-a ' },
        translate: { mode: 'legacy' },
        unknown: { mode: 'profile', profileId: 'ignored' },
      },
      seperateModels: { memory: ' memory-aux ', translate: 42, scriptAux: ' script-aux ' },
      fallbackModels: { model: ['primary-fallback', '', 7], scriptMain: ['script-fallback'] },
      seperateParameters: {
        memory: { temperature: 0.6 },
        translate: 'ignored',
        scriptMain: { top_p: 0.7 },
        overrides: { 'model-a': { top_k: 42 } },
      },
    })

    expect(preset).toMatchObject({
      modelRoles: normalizedModelRoles({ chatMain: 'main-model', memory: 'memory-model' }),
      modelProfiles: [
        {
          id: 'profile-a',
          name: 'Primary',
          modelId: 'gpt-5',
          providerOptions: { requestModel: 'wire-model', apiKey: 'profile-secret' },
        },
        { id: 'profile-b', name: 'Secondary' },
      ],
      modelRoleProfiles: normalizedModelRoleProfiles({
        memory: { mode: 'profile', profileId: 'profile-a' },
      }),
      seperateModels: normalizedSeperateModels({ memory: 'memory-aux', scriptAux: 'script-aux' }),
      fallbackModels: normalizedFallbackModels({
        model: ['primary-fallback'],
        scriptMain: ['script-fallback'],
      }),
      seperateParameters: normalizedSeperateParameters({
        memory: { temperature: 0.6 },
        scriptMain: { top_p: 0.7 },
        overrides: { 'model-a': { top_k: 42 } },
      }),
    })

    const database: Record<string, unknown> = {}
    applyModelPreset(database, {
      id: 'dirty-model',
      modelRoles: { scriptMain: ' dirty-script ' },
      modelProfiles: [
        {
          id: ' dirty-profile ',
          name: ' Dirty Profile ',
          modelId: ' dirty-model ',
          providerOptions: { requestModel: ' dirty-wire ', apiKey: ' dirty-secret ', openAIKey: 'must-drop' },
        },
      ],
      modelRoleProfiles: { scriptMain: { mode: 'profile', profileId: ' dirty-profile ' } },
      seperateModels: { otherAx: ' dirty-aux ' },
      fallbackModels: { memory: ['dirty-memory', ''] },
      seperateParameters: { scriptAux: { min_p: 0.2 } },
    })

    expect(database).toMatchObject({
      modelRoles: normalizedModelRoles({ scriptMain: 'dirty-script' }),
      modelProfiles: [
        {
          id: 'dirty-profile',
          name: 'Dirty Profile',
          modelId: 'dirty-model',
          providerOptions: { requestModel: 'dirty-wire', apiKey: 'dirty-secret' },
        },
      ],
      modelRoleProfiles: normalizedModelRoleProfiles({
        scriptMain: { mode: 'profile', profileId: 'dirty-profile' },
      }),
      seperateModels: normalizedSeperateModels({ otherAx: 'dirty-aux' }),
      fallbackModels: normalizedFallbackModels({ memory: ['dirty-memory'] }),
      seperateParameters: normalizedSeperateParameters({ scriptAux: { min_p: 0.2 } }),
    })
  })

  it('normalizes model preset patches while preserving masked secret resolution', () => {
    const patch = readModelPresetPatch({
      openAIKey: MASKED_PROVIDER_SECRET,
      proxyKey: MASKED_PROVIDER_SECRET,
      modelRoles: { translate: ' translate-model ' },
      seperateModels: null,
      fallbackModels: { otherAx: ['other-fallback', ''] },
      seperateParameters: { otherAx: { frequencyPenalty: 0.1 }, overrides: null },
    })

    const resolved = resolveModelPresetMaskedSecrets(
      {
        id: 'model-a',
        name: 'Model A',
        openAIKey: 'openai-secret',
        proxyKey: 'proxy-secret',
      },
      patch,
    )

    expect(resolved).toMatchObject({
      openAIKey: 'openai-secret',
      proxyKey: 'proxy-secret',
      modelRoles: normalizedModelRoles({ translate: 'translate-model' }),
      seperateModels: normalizedSeperateModels(),
      fallbackModels: normalizedFallbackModels({ otherAx: ['other-fallback'] }),
      seperateParameters: normalizedSeperateParameters({ otherAx: { frequencyPenalty: 0.1 } }),
    })
  })

  it('normalizes prompt preset model override fields on create, patch, and apply', () => {
    const preset = createPromptPresetRecord({
      id: 'prompt-a',
      name: 'Prompt A',
      modelRoles: { emotion: ' emotion-model ' },
      modelProfiles: [{ id: ' prompt-profile ', name: ' Prompt Profile ' }],
      modelRoleProfiles: { emotion: { mode: 'profile', profileId: ' prompt-profile ' } },
      seperateModels: { scriptMain: ' script-main ' },
      fallbackModels: { translate: ['translate-fallback', ''] },
      seperateParameters: { translate: { temperature: 0.4 } },
    })

    expect(preset).toMatchObject({
      modelRoles: normalizedModelRoles({ emotion: 'emotion-model' }),
      modelProfiles: [{ id: 'prompt-profile', name: 'Prompt Profile' }],
      modelRoleProfiles: normalizedModelRoleProfiles({
        emotion: { mode: 'profile', profileId: 'prompt-profile' },
      }),
      seperateModels: normalizedSeperateModels({ scriptMain: 'script-main' }),
      fallbackModels: normalizedFallbackModels({ translate: ['translate-fallback'] }),
      seperateParameters: normalizedSeperateParameters({ translate: { temperature: 0.4 } }),
    })

    const patch = readPromptPresetPatch({
      presetRegex: [{ id: 'regex-a', type: 'editinput', in: 'hello', out: 'hi' }],
      regex: [{ id: 'legacy-regex' }],
      modelRoles: { scriptAux: ' script-aux ' },
      modelProfiles: [{ id: ' patch-profile ', name: ' Patch Profile ' }],
      modelRoleProfiles: { scriptAux: { mode: 'profile', profileId: ' patch-profile ' } },
      seperateModels: { emotion: ' emotion-aux ' },
      fallbackModels: { scriptAux: ['script-fallback', ''] },
      seperateParameters: { scriptAux: { top_p: 0.8 }, memory: [] },
    })

    expect(patch).toMatchObject({
      presetRegex: [{ id: 'regex-a', type: 'editinput', in: 'hello', out: 'hi' }],
      regex: [],
      modelRoles: normalizedModelRoles({ scriptAux: 'script-aux' }),
      modelProfiles: [{ id: 'patch-profile', name: 'Patch Profile' }],
      modelRoleProfiles: normalizedModelRoleProfiles({
        scriptAux: { mode: 'profile', profileId: 'patch-profile' },
      }),
      seperateModels: normalizedSeperateModels({ emotion: 'emotion-aux' }),
      fallbackModels: normalizedFallbackModels({ scriptAux: ['script-fallback'] }),
      seperateParameters: normalizedSeperateParameters({ scriptAux: { top_p: 0.8 } }),
    })

    const database: Record<string, unknown> = {
      modelProfiles: [{ id: 'base-profile', name: 'Base Profile' }],
    }
    applyPromptPreset(database, {
      id: 'dirty-prompt',
      overrideModelParameters: true,
      modelRoles: { memory: ' dirty-memory ' },
      modelProfiles: [{ id: 'ignored-profile', name: 'Ignored Profile' }],
      modelRoleProfiles: { memory: { mode: 'profile', profileId: ' dirty-profile ' } },
      seperateModels: { memory: ' dirty-memory-aux ' },
      fallbackModels: { model: ['dirty-fallback', ''] },
      seperateParameters: { memory: { temperature: 0.3 } },
      presetRegex: [{ id: 'regex-b' }],
    })

    expect(database).toMatchObject({
      presetRegex: [{ id: 'regex-b' }],
      modelRoles: normalizedModelRoles({ memory: 'dirty-memory' }),
      modelProfiles: [{ id: 'base-profile', name: 'Base Profile' }],
      modelRoleProfiles: normalizedModelRoleProfiles({
        memory: { mode: 'profile', profileId: 'dirty-profile' },
      }),
      seperateModels: normalizedSeperateModels({ memory: 'dirty-memory-aux' }),
      fallbackModels: normalizedFallbackModels({ model: ['dirty-fallback'] }),
      seperateParameters: normalizedSeperateParameters({ memory: { temperature: 0.3 } }),
    })
  })
})
