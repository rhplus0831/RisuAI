import { describe, expect, it } from 'vitest'
import {
  createDefaultInputHooks,
  defaultAutoSuggestPrompt,
  defaultInputTranslatorPrompt,
} from './defaultPromptSettings.js'

describe('default prompt settings', () => {
  it('keeps the suggestion prompt markers stable', () => {
    expect(defaultAutoSuggestPrompt).toContain('1. A response that {{user}} would likely say')
    expect(defaultAutoSuggestPrompt).toContain('2. A response that {{char}} currently might want')
    expect(defaultAutoSuggestPrompt).toContain('- Respond4')
    expect(defaultAutoSuggestPrompt.endsWith('accurately adhered to the rules.')).toBe(true)
  })

  it('creates a fresh default translation hook with stable ownership', () => {
    const first = createDefaultInputHooks()
    const second = createDefaultInputHooks()

    expect(first).toEqual([
      {
        id: 'default-translate',
        name: 'Translate',
        type: 'draft',
        prompt: defaultInputTranslatorPrompt,
        model: { mode: 'inheritOtherAx' },
      },
    ])
    expect(first).not.toBe(second)
    expect(first[0]).not.toBe(second[0])
    expect(first[0].model).not.toBe(second[0].model)
  })
})
