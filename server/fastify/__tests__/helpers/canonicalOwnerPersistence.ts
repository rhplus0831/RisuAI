import { resolveTranslatorPipeline, translatorPipelineSignature } from '@risuai/shared-core/translator-pipeline'
import { canonicalModelProfileFixture } from '../../../../test/fixtures/canonicalModelProfile.js'

type JsonRecord = Record<string, unknown>

const PERSISTED_MODEL_PROFILE = {
  ...canonicalModelProfileFixture.profile,
  providerOptions: {
    requestModel: canonicalModelProfileFixture.profile.providerOptions.requestModel,
  },
}

export function canonicalOwnerPersistenceDatabase(): JsonRecord {
  return {
    version: 1,
    characters: [],
    modelProfiles: [{ ...PERSISTED_MODEL_PROFILE }],
    modelProfileOrder: [
      {
        kind: 'profile',
        profileId: canonicalModelProfileFixture.profile.id,
      },
    ],
    modelRoleProfiles: { ...canonicalModelProfileFixture.bindings },
    modelRuntimeDefaults: {},
    promptPresetsId: 1,
    promptPresets: [
      {
        id: 'prompt-unselected',
        name: 'Unselected Prompt',
        promptTemplate: [
          {
            id: 'prompt-item-unselected',
            type: 'plain',
            text: 'unselected prompt body',
            role: 'system',
          },
        ],
      },
      {
        id: 'prompt-owner',
        name: 'Selected Prompt Owner',
        promptTemplate: [
          {
            id: 'prompt-item-owner',
            type: 'plain',
            text: 'selected prompt owner body',
            role: 'system',
          },
        ],
      },
    ],
    promptTemplate: [
      {
        id: 'stale-prompt-item',
        type: 'plain',
        text: 'stale prompt compatibility body',
        role: 'system',
      },
    ],
    translatorPresetId: 'translator-owner',
    translatorPresets: [
      {
        id: 'translator-unselected',
        name: 'Unselected Translator',
        prompt: 'Unselected {{slot::content}}',
        maxResponse: 128,
        steps: [
          {
            id: 'translator-step-unselected',
            name: 'Unselected Step',
            enabled: true,
            prompt: 'Unselected {{slot::content}}',
            maxResponse: 128,
            model: { mode: 'inheritTranslate' },
          },
        ],
      },
      {
        id: 'translator-owner',
        name: 'Selected Translator Owner',
        prompt: 'First {{slot::content}}',
        maxResponse: 321,
        steps: [
          {
            id: 'translator-step-owner-1',
            name: 'First Step',
            enabled: true,
            prompt: 'First {{slot::content}}',
            maxResponse: 321,
            model: { mode: 'inheritTranslate' },
            outputKey: 'draft',
          },
          {
            id: 'translator-step-owner-2',
            name: 'Refine Step',
            enabled: true,
            prompt: 'Refine {{slot::out::draft}}',
            maxResponse: 123,
            model: {
              mode: 'modelProfile',
              profileId: canonicalModelProfileFixture.profile.id,
            },
          },
        ],
      },
    ],
    translatorPrompt: 'stale translator scalar',
    translatorMaxResponse: 1,
    selectedPersonaId: 'persona-owner',
    selectedPersona: 1,
    personas: [
      {
        id: 'persona-unselected',
        name: 'Unselected Persona',
        icon: '',
        personaPrompt: 'unselected persona prompt',
        note: 'unselected persona note',
      },
      {
        id: 'persona-owner',
        name: 'Selected Persona Owner',
        icon: '',
        personaPrompt: 'selected persona prompt',
        note: 'selected persona note',
      },
    ],
    username: 'stale persona scalar',
    personaPrompt: 'stale persona prompt scalar',
    userNote: 'stale persona note scalar',
    hypaV3PresetId: 1,
    hypaV3Presets: [
      {
        name: 'Unselected Hypa Preset',
        settings: {
          summarizationPrompt: 'unselected hypa prompt',
          queryChatCount: 2,
        },
      },
      {
        name: 'Selected Hypa Owner',
        settings: {
          summarizationPrompt: 'selected hypa prompt',
          queryChatCount: 7,
        },
      },
    ],
    hypaV3Settings: {
      summarizationPrompt: 'stale hypa compatibility prompt',
      queryChatCount: 99,
    },
  }
}

export function canonicalOwnerPersistenceSnapshot(database: unknown): JsonRecord {
  const source = isRecord(database) ? database : {}
  const modelProfiles = Array.isArray(source.modelProfiles) ? source.modelProfiles : []
  const selectedPrompt = selectedArrayRecord(source.promptPresets, source.promptPresetsId)
  const selectedTranslator = uniqueRecordById(source.translatorPresets, source.translatorPresetId)
  const selectedPersona = uniqueRecordById(source.personas, source.selectedPersonaId)
  const selectedHypaPreset = selectedArrayRecord(source.hypaV3Presets, source.hypaV3PresetId)
  const selectedHypaSettings = isRecord(selectedHypaPreset?.settings) ? selectedHypaPreset.settings : {}
  const roleBindings = isRecord(source.modelRoleProfiles) ? source.modelRoleProfiles : {}

  return {
    model: {
      profile: uniqueRecordById(modelProfiles, canonicalModelProfileFixture.profile.id),
      order: source.modelProfileOrder,
      memoryBinding: roleBindings.memory,
    },
    prompt: {
      selectedId: selectedPrompt?.id ?? null,
      selectedBody: selectedPrompt?.promptTemplate ?? null,
      projectedBody: source.promptTemplate ?? null,
    },
    translator: {
      selectedId: source.translatorPresetId ?? null,
      selectedPresetId: selectedTranslator?.id ?? null,
      cacheSignature: translatorPipelineSignature(resolveTranslatorPipeline(source)),
    },
    persona: {
      selectedId: source.selectedPersonaId ?? null,
      name: selectedPersona?.name ?? null,
      personaPrompt: selectedPersona?.personaPrompt ?? null,
      note: selectedPersona?.note ?? null,
    },
    hypa: {
      // Hypa still persists a numeric compatibility pointer. Until its stable-id
      // contract lands, pin both that pointer and the selected row's content.
      selectedIndex: source.hypaV3PresetId ?? null,
      selectedName: selectedHypaPreset?.name ?? null,
      summarizationPrompt: selectedHypaSettings.summarizationPrompt ?? null,
      queryChatCount: selectedHypaSettings.queryChatCount ?? null,
    },
  }
}

export const EXPECTED_CANONICAL_OWNER_PERSISTENCE_SNAPSHOT: JsonRecord = {
  model: {
    profile: PERSISTED_MODEL_PROFILE,
    order: [
      {
        kind: 'profile',
        profileId: canonicalModelProfileFixture.profile.id,
      },
    ],
    memoryBinding: canonicalModelProfileFixture.bindings.memory,
  },
  prompt: {
    selectedId: 'prompt-owner',
    selectedBody: [
      {
        id: 'prompt-item-owner',
        type: 'plain',
        text: 'selected prompt owner body',
        role: 'system',
      },
    ],
    projectedBody: [
      {
        id: 'prompt-item-owner',
        type: 'plain',
        text: 'selected prompt owner body',
        role: 'system',
      },
    ],
  },
  translator: {
    selectedId: 'translator-owner',
    selectedPresetId: 'translator-owner',
    cacheSignature: {
      steps: [
        {
          prompt: 'First {{slot::content}}',
          maxResponse: 321,
          model: { mode: 'inheritTranslate' },
          outputKey: 'draft',
          enabled: true,
        },
        {
          prompt: 'Refine {{slot::out::draft}}',
          maxResponse: 123,
          model: {
            mode: 'modelProfile',
            profileId: canonicalModelProfileFixture.profile.id,
          },
          outputKey: null,
          enabled: true,
        },
      ],
    },
  },
  persona: {
    selectedId: 'persona-owner',
    name: 'Selected Persona Owner',
    personaPrompt: 'selected persona prompt',
    note: 'selected persona note',
  },
  hypa: {
    selectedIndex: 1,
    selectedName: 'Selected Hypa Owner',
    summarizationPrompt: 'selected hypa prompt',
    queryChatCount: 7,
  },
}

function selectedArrayRecord(collection: unknown, index: unknown): JsonRecord | null {
  if (!Array.isArray(collection) || !Number.isInteger(index) || (index as number) < 0) return null
  const selected = collection[index as number]
  return isRecord(selected) ? selected : null
}

function uniqueRecordById(collection: unknown, id: unknown): JsonRecord | null {
  if (!Array.isArray(collection) || typeof id !== 'string' || id.trim() === '') return null
  const matches = collection.filter((value) => isRecord(value) && value.id === id)
  return matches.length === 1 ? (matches[0] as JsonRecord) : null
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
