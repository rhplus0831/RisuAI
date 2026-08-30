import { describe, expect, it } from 'vitest'
import { resolveEffectivePromptTemplate, type EffectivePromptTemplateDatabase } from './effectivePromptTemplate.js'

type Row = { id: string; text: string }

const row = (id: string): Row => ({ id, text: id })

function database(overrides: Partial<EffectivePromptTemplateDatabase<Row>> = {}): EffectivePromptTemplateDatabase<Row> {
  return {
    promptPresets: [
      { id: 'default-prompt-preset', name: 'Default Prompt' },
      { id: 'modern', name: 'Modern', promptTemplate: [row('modern-row')] },
      { id: 'empty', name: 'Empty', promptTemplate: [] },
    ],
    promptPresetsId: 1,
    promptTemplate: [row('compatibility-row')],
    ...overrides,
  }
}

describe('effective prompt-template owner policy', () => {
  it('prefers a chat-scoped modern owner over the selected global owner', () => {
    const result = resolveEffectivePromptTemplate(
      database({
        promptPresets: [
          { id: 'global', name: 'Global', promptTemplate: [row('global-row')] },
          { id: 'chat', name: 'Chat', promptTemplate: [row('chat-row')] },
        ],
        promptPresetsId: 0,
      }),
      { chatPromptPresetId: 'chat' },
    )

    expect(result).toEqual({
      promptTemplate: [row('chat-row')],
      source: 'chat-prompt-preset',
      promptPresetId: 'chat',
    })
  })

  it('returns disabled for a missing chat owner without falling back', () => {
    expect(resolveEffectivePromptTemplate(database(), { chatPromptPresetId: 'missing' })).toEqual({
      promptTemplate: null,
      source: 'missing-chat-prompt-preset',
      promptPresetId: 'missing',
    })
  })

  it('keeps explicit null/empty modern bodies authoritative', () => {
    expect(
      resolveEffectivePromptTemplate(
        database({
          promptPresets: [{ id: 'modern', name: 'Modern', promptTemplate: null }],
          promptPresetsId: 0,
        }),
      ),
    ).toMatchObject({ promptTemplate: null, source: 'global-prompt-preset', promptPresetId: 'modern' })
    expect(
      resolveEffectivePromptTemplate(
        database({
          promptPresets: [{ id: 'empty', name: 'Empty', promptTemplate: [] }],
          promptPresetsId: 0,
        }),
      ),
    ).toMatchObject({ promptTemplate: [], source: 'global-prompt-preset', promptPresetId: 'empty' })
  })

  it('allows only the default scaffold to use the top-level compatibility fallback', () => {
    expect(resolveEffectivePromptTemplate(database({ promptPresetsId: 0 }))).toMatchObject({
      promptTemplate: [row('compatibility-row')],
      source: 'top-level',
    })
    expect(
      resolveEffectivePromptTemplate(
        database({
          promptPresets: [{ id: 'custom', name: 'Custom' }],
          promptPresetsId: 0,
        }),
      ),
    ).toMatchObject({ promptTemplate: null, source: 'global-prompt-preset', promptPresetId: 'custom' })
  })

  it('does not repair or mutate the supplied state', () => {
    const input = database({ promptPresetsId: 99 })
    const snapshot = structuredClone(input)
    resolveEffectivePromptTemplate(input)
    expect(input).toEqual(snapshot)
  })
})
