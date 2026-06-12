import { describe, expect, it } from 'vitest'
import {
  CHAT_GENERATION_SETTINGS_INCOMPLETE_ERROR,
  CHAT_GENERATION_SETTINGS_INCOMPLETE_MESSAGE,
  CHAT_GENERATION_SETTINGS_INCOMPLETE_STATUS,
  createChatGenerationSettingsIncompleteError,
  resolveChatGenerationControlRequirements,
  resolveChatGenerationSettingsReadiness,
  resolveRequiredSidebarToggles,
  type ChatGenerationPresetReference,
  type ResolveChatGenerationSettingsReadinessInput,
} from './chatGenerationSettings'

const personas = [{ id: 'persona-a' }]

function readinessInput(
  overrides: Partial<ResolveChatGenerationSettingsReadinessInput>,
): ResolveChatGenerationSettingsReadinessInput {
  return {
    personas,
    presets: [],
    ...overrides,
  }
}

describe('chat generation settings contract', () => {
  it('resolves displayed preset toggles from the selected presetId', () => {
    const presets: ChatGenerationPresetReference[] = [
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
      presetId: 'preset-b',
      presets,
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
      presetId: 'preset-empty',
      presets: [{ id: 'preset-empty', customPromptTemplateToggle: '' }],
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

  it('keeps jailbreak as a required chat-owned control and reports whether it is displayed', () => {
    const withJailbreakTemplate = resolveChatGenerationControlRequirements({
      presetId: 'preset-jailbreak',
      presets: [
        {
          id: 'preset-jailbreak',
          promptTemplate: [{ type: 'plain', text: 'Use {{jbtoggled}} here.' }],
        },
      ],
    })
    const withoutJailbreakTemplate = resolveChatGenerationControlRequirements({
      presetId: 'preset-plain',
      presets: [{ id: 'preset-plain', jailbreak: '' }],
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
        presets: [
          {
            id: 'preset-a',
            customPromptTemplateToggle: 'mode=Mode\nnotes=Notes=text',
            jailbreak: 'Jailbreak text',
          },
        ],
        settings: {
          configured: true,
          personaId: 'persona-a',
          presetId: 'preset-a',
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

  it('returns missing reason codes for absent required values', () => {
    const readiness = resolveChatGenerationSettingsReadiness(
      readinessInput({
        presets: [{ id: 'preset-a', customPromptTemplateToggle: 'mode=Mode\nmood=Mood' }],
        settings: {
          configured: true,
          personaId: 'persona-a',
          presetId: 'preset-a',
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
      presetId: 'deleted-preset',
      jailbreakToggle: false,
      sidebarToggles: {},
    }

    const readiness = resolveChatGenerationSettingsReadiness(
      readinessInput({
        personas: [{ id: 'persona-a' }],
        presets: [{ id: 'preset-a', customPromptTemplateToggle: 'mode=Mode' }],
        settings,
      }),
    )

    expect(readiness.ready).toBe(false)
    expect(readiness.requirements.preset).toBeUndefined()
    expect(readiness.requirements.presetFound).toBe(false)
    expect(readiness.requirements.sidebarToggles).toEqual([])
    expect(readiness.missing).toEqual([
      {
        code: 'persona_missing',
        field: 'generationSettings.personaId',
        personaId: 'deleted-persona',
      },
      {
        code: 'preset_missing',
        field: 'generationSettings.presetId',
        presetId: 'deleted-preset',
      },
    ])
    expect(settings).toMatchObject({
      personaId: 'deleted-persona',
      presetId: 'deleted-preset',
    })
  })

  it('ignores stale sidebar toggle keys for readiness and reports them for pruning', () => {
    const readiness = resolveChatGenerationSettingsReadiness(
      readinessInput({
        presets: [{ id: 'preset-a', customPromptTemplateToggle: 'mode=Mode' }],
        settings: {
          configured: true,
          personaId: 'persona-a',
          presetId: 'preset-a',
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
          presetId: 'missing-preset',
          jailbreakToggle: false,
          sidebarToggles: {},
        },
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
          code: 'preset_missing',
          field: 'generationSettings.presetId',
          presetId: 'missing-preset',
        },
      ],
      staleSidebarToggleKeys: [],
    })
  })
})
