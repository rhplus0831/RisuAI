import { describe, expect, it } from 'vitest'
import {
  CHAT_GENERATION_SETTINGS_INCOMPLETE_ERROR,
  CHAT_GENERATION_SETTINGS_INCOMPLETE_MESSAGE,
  CHAT_GENERATION_SETTINGS_INCOMPLETE_STATUS,
  createChatGenerationSettingsIncompleteError,
  resolveChatGenerationControlRequirements,
  resolveDisplayedSidebarToggles,
  resolveChatGenerationSettingsReadiness,
  resolveRequiredSidebarToggles,
  type ChatGenerationPromptPresetReference,
  type ResolveChatGenerationSettingsReadinessInput,
} from './chatGenerationSettings'

const personas = [{ id: 'persona-a' }]
const modelPresets = [{ id: 'model-a' }]

function readinessInput(
  overrides: Partial<ResolveChatGenerationSettingsReadinessInput>,
): ResolveChatGenerationSettingsReadinessInput {
  return {
    personas,
    modelPresets,
    promptPresets: [],
    ...overrides,
  }
}

describe('chat generation settings contract', () => {
  it('resolves displayed preset toggles from the selected promptPresetId', () => {
    const promptPresets: ChatGenerationPromptPresetReference[] = [
      {
        id: 'preset-a',
        customPromptTemplateToggle: 'tone=Tone=select=warm,formal\ncot=Chain of thought',
      },
      {
        id: 'preset-b',
        customPromptTemplateToggle: 'mood=Mood=text',
      },
    ]

    const toggles = resolveRequiredSidebarToggles({
      modelPresetId: 'model-a',
      promptPresetId: 'preset-b',
      modelPresets,
      promptPresets,
    })

    expect(toggles).toEqual([
      {
        key: 'mood',
        label: 'Mood',
        kind: 'text',
        options: [],
        source: 'preset',
        presetId: 'preset-b',
      },
    ])
  })

  it('resolves active module toggles from global, chat, character, and namespace links', () => {
    const toggles = resolveRequiredSidebarToggles({
      modelPresetId: 'model-a',
      promptPresetId: 'preset-empty',
      modelPresets,
      promptPresets: [{ id: 'preset-empty', customPromptTemplateToggle: '' }],
      modules: [
        { id: 'enabled-module', customModuleToggle: 'enabled=Enabled module' },
        { id: 'chat-module', customModuleToggle: 'chat=Chat module=select=a,b' },
        { id: 'character-module', customModuleToggle: 'character=Character module=text' },
        {
          id: 'integrated-module',
          namespace: 'shared-space',
          customModuleToggle: 'integrated=Integrated module=textarea',
        },
        { id: 'inactive-module', customModuleToggle: 'inactive=Inactive module' },
      ],
      enabledModuleIds: ['enabled-module'],
      chatModuleIds: ['chat-module'],
      characterModuleIds: ['character-module'],
      moduleIntegration: ' shared-space ',
    })

    expect(toggles.map((toggle) => [toggle.key, toggle.kind, toggle.source, toggle.moduleId])).toEqual([
      ['enabled', 'boolean', 'module', 'enabled-module'],
      ['chat', 'select', 'module', 'chat-module'],
      ['character', 'text', 'module', 'character-module'],
      ['integrated', 'textarea', 'module', 'integrated-module'],
    ])
  })

  it('preserves layout-only rows for display without making them required', () => {
    const promptPresets: ChatGenerationPromptPresetReference[] = [
      {
        id: 'preset-a',
        customPromptTemplateToggle:
          '=Preset Group=group\nmode=Mode\n=Group note=caption\n==groupend\n=Outside=divider\noutside=Outside',
      },
    ]

    const input = {
      modelPresetId: 'model-a',
      promptPresetId: 'preset-a',
      modelPresets,
      promptPresets,
    }

    expect(resolveRequiredSidebarToggles(input).map((toggle) => toggle.key)).toEqual(['mode', 'outside'])
    expect(resolveDisplayedSidebarToggles(input).map((toggle) => [toggle.kind, toggle.label])).toEqual([
      ['group', 'Preset Group'],
      ['boolean', 'Mode'],
      ['caption', 'Group note'],
      ['groupEnd', ''],
      ['divider', 'Outside'],
      ['boolean', 'Outside'],
    ])
  })

  it('keeps jailbreak as a required chat-owned control and reports whether it is displayed', () => {
    const withJailbreakTemplate = resolveChatGenerationControlRequirements({
      modelPresetId: 'model-a',
      promptPresetId: 'preset-jailbreak',
      modelPresets,
      promptPresets: [
        {
          id: 'preset-jailbreak',
          promptTemplate: [{ type: 'plain', text: 'Use {{jbtoggled}} here.' }],
        },
      ],
    })
    const withoutJailbreakTemplate = resolveChatGenerationControlRequirements({
      modelPresetId: 'model-a',
      promptPresetId: 'preset-plain',
      modelPresets,
      promptPresets: [{ id: 'preset-plain', jailbreak: '' }],
    })

    expect(withJailbreakTemplate.jailbreakToggle).toEqual({
      field: 'jailbreakToggle',
      required: true,
      displayed: true,
    })
    expect(withoutJailbreakTemplate.jailbreakToggle).toEqual({
      field: 'jailbreakToggle',
      required: true,
      displayed: false,
    })
  })

  it('treats explicit off and empty raw values as configured when keys are present', () => {
    const readiness = resolveChatGenerationSettingsReadiness(
      readinessInput({
        agentPresets: [{ id: 'agent-preset-a' }],
        promptPresets: [
          {
            id: 'preset-a',
            customPromptTemplateToggle: 'mode=Mode\nnotes=Notes=text',
            jailbreak: 'Jailbreak text',
          },
        ],
        settings: {
          configured: true,
          personaId: 'persona-a',
          modelPresetId: 'model-a',
          promptPresetId: 'preset-a',
          agentPresetId: '',
          jailbreakToggle: false,
          sidebarToggles: {
            mode: '0',
            notes: '',
          },
        },
      }),
    )

    expect(readiness.ready).toBe(true)
    expect(readiness.missing).toEqual([])
  })

  it('keeps absent Agent Preset selection ready and reports non-empty stale references', () => {
    const ready = resolveChatGenerationSettingsReadiness(
      readinessInput({
        agentPresets: [],
        promptPresets: [{ id: 'preset-a' }],
        settings: {
          configured: true,
          personaId: 'persona-a',
          modelPresetId: 'model-a',
          promptPresetId: 'preset-a',
          jailbreakToggle: false,
          sidebarToggles: {},
        },
      }),
    )
    const stale = resolveChatGenerationSettingsReadiness(
      readinessInput({
        agentPresets: [{ id: 'agent-preset-a' }],
        promptPresets: [{ id: 'preset-a' }],
        settings: {
          configured: true,
          personaId: 'persona-a',
          modelPresetId: 'model-a',
          promptPresetId: 'preset-a',
          agentPresetId: 'deleted-agent-preset',
          jailbreakToggle: false,
          sidebarToggles: {},
        },
      }),
    )

    expect(ready.ready).toBe(true)
    expect(ready.missing).toEqual([])
    expect(stale.ready).toBe(false)
    expect(stale.missing).toEqual([
      {
        code: 'agent_preset_missing',
        field: 'generationSettings.agentPresetId',
        agentPresetId: 'deleted-agent-preset',
      },
    ])
  })

  it('returns missing reason codes for absent required values', () => {
    const readiness = resolveChatGenerationSettingsReadiness(
      readinessInput({
        promptPresets: [{ id: 'preset-a', customPromptTemplateToggle: 'mode=Mode\nmood=Mood' }],
        settings: {
          configured: true,
          personaId: 'persona-a',
          modelPresetId: 'model-a',
          promptPresetId: 'preset-a',
          sidebarToggles: {
            mode: '1',
          },
        },
      }),
    )

    expect(readiness.ready).toBe(false)
    expect(readiness.missing.map((reason) => reason.code)).toEqual([
      'jailbreak_toggle_missing',
      'sidebar_toggle_missing',
    ])
    expect(readiness.missing[1]).toMatchObject({
      field: 'generationSettings.sidebarToggles.mood',
      toggleKey: 'mood',
    })
  })

  it('reports deleted preset and persona references without retargeting to available rows', () => {
    const settings = {
      configured: true,
      personaId: 'deleted-persona',
      modelPresetId: 'deleted-model',
      promptPresetId: 'deleted-preset',
      jailbreakToggle: false,
      sidebarToggles: {},
    }

    const readiness = resolveChatGenerationSettingsReadiness(
      readinessInput({
        personas: [{ id: 'persona-a' }],
        modelPresets,
        promptPresets: [{ id: 'preset-a', customPromptTemplateToggle: 'mode=Mode' }],
        settings,
      }),
    )

    expect(readiness.ready).toBe(false)
    expect(readiness.requirements.promptPreset).toBeUndefined()
    expect(readiness.requirements.promptPresetFound).toBe(false)
    expect(readiness.requirements.sidebarToggles).toEqual([])
    expect(readiness.missing).toEqual([
      {
        code: 'persona_missing',
        field: 'generationSettings.personaId',
        personaId: 'deleted-persona',
      },
      {
        code: 'model_preset_missing',
        field: 'generationSettings.modelPresetId',
        modelPresetId: 'deleted-model',
      },
      {
        code: 'prompt_preset_missing',
        field: 'generationSettings.promptPresetId',
        promptPresetId: 'deleted-preset',
      },
    ])
    expect(settings).toMatchObject({
      personaId: 'deleted-persona',
      modelPresetId: 'deleted-model',
      promptPresetId: 'deleted-preset',
    })
  })

  it('ignores stale sidebar toggle keys for readiness and reports them for pruning', () => {
    const readiness = resolveChatGenerationSettingsReadiness(
      readinessInput({
        promptPresets: [{ id: 'preset-a', customPromptTemplateToggle: 'mode=Mode' }],
        settings: {
          configured: true,
          personaId: 'persona-a',
          modelPresetId: 'model-a',
          promptPresetId: 'preset-a',
          jailbreakToggle: true,
          sidebarToggles: {
            mode: '1',
            deleted: '1',
          },
        },
      }),
    )

    expect(readiness.ready).toBe(true)
    expect(readiness.staleSidebarToggleKeys).toEqual(['deleted'])
  })

  it('uses a stable incomplete-chat error body', () => {
    const readiness = resolveChatGenerationSettingsReadiness(
      readinessInput({
        settings: {
          configured: true,
          personaId: 'missing-persona',
          modelPresetId: 'missing-model',
          promptPresetId: 'missing-preset',
          jailbreakToggle: false,
          sidebarToggles: {},
        },
        promptPresets: [],
      }),
    )

    expect(createChatGenerationSettingsIncompleteError(readiness, 'chat-a')).toEqual({
      statusCode: CHAT_GENERATION_SETTINGS_INCOMPLETE_STATUS,
      error: CHAT_GENERATION_SETTINGS_INCOMPLETE_ERROR,
      message: CHAT_GENERATION_SETTINGS_INCOMPLETE_MESSAGE,
      chatId: 'chat-a',
      missing: [
        {
          code: 'persona_missing',
          field: 'generationSettings.personaId',
          personaId: 'missing-persona',
        },
        {
          code: 'model_preset_missing',
          field: 'generationSettings.modelPresetId',
          modelPresetId: 'missing-model',
        },
        {
          code: 'prompt_preset_missing',
          field: 'generationSettings.promptPresetId',
          promptPresetId: 'missing-preset',
        },
      ],
      staleSidebarToggleKeys: [],
    })
  })
})
