import { describe, expect, it } from 'vitest'
import {
  createTranslatorPreset,
  defaultTranslatorPrompt,
  getTranslatorPresetFromState,
  normalizeTranslatorPreset,
  normalizeTranslatorPresetState,
  normalizeTranslatorPresetStateWithLegacyCompatibility,
  TRANSLATOR_PRESET_MAX_STEPS,
  type TranslatorPresetStateLike,
} from './translatorPresets.js'

describe('shared translator preset records', () => {
  it('creates canonical defaults without consulting legacy scalar settings', () => {
    const state: TranslatorPresetStateLike = {
      translatorPrompt: 'legacy prompt',
      translatorMaxResponse: 321,
    }

    normalizeTranslatorPresetState(state)

    expect(state.translatorPresets).toMatchObject([
      {
        name: 'Default',
        prompt: defaultTranslatorPrompt,
        maxResponse: 1000,
        steps: [{ name: 'Step 1', prompt: defaultTranslatorPrompt, maxResponse: 1000 }],
      },
    ])
    expect(state.translatorPresetId).toBe(0)
    expect(state.translatorPrompt).toBe('legacy prompt')
    expect(state.translatorMaxResponse).toBe(321)
  })

  it('keeps legacy migration and scalar projection explicit', () => {
    const state: TranslatorPresetStateLike = {
      translatorPrompt: 'legacy prompt',
      translatorMaxResponse: 321,
    }

    normalizeTranslatorPresetStateWithLegacyCompatibility(state)

    expect(state.translatorPresets?.[0]).toMatchObject({ prompt: 'legacy prompt', maxResponse: 321 })
    expect(state.translatorPrompt).toBe('legacy prompt')
    expect(state.translatorMaxResponse).toBe(321)
  })

  it('normalizes steps, output keys, models, duplicate ids, and the step cap', () => {
    const preset = normalizeTranslatorPreset({
      id: 'preset-a',
      name: 'Pipeline',
      steps: Array.from({ length: TRANSLATOR_PRESET_MAX_STEPS + 2 }, (_, index) => ({
        id: index < 2 ? 'duplicate' : '',
        name: index === 0 ? '' : `Step ${index + 1}`,
        enabled: true,
        prompt: `Prompt ${index + 1}`,
        maxResponse: index === 1 ? Number.NaN : index + 100,
        model: index === 2 ? { mode: 'modelProfile', profileId: ' profile-a ' } : { mode: 'inheritTranslate' },
        outputKey: index < 2 ? 'shared' : index === 3 ? 'invalid-key!' : `key_${index}`,
      })),
    })

    expect(preset.steps).toHaveLength(TRANSLATOR_PRESET_MAX_STEPS)
    expect(new Set(preset.steps.map((step) => step.id)).size).toBe(TRANSLATOR_PRESET_MAX_STEPS)
    expect(preset.steps[0]).toMatchObject({ name: 'Step 1', outputKey: 'shared' })
    expect(preset.steps[1]).toMatchObject({ maxResponse: 1000 })
    expect(preset.steps[1].outputKey).toBeUndefined()
    expect(preset.steps[2].model).toEqual({ mode: 'modelProfile', profileId: 'profile-a' })
    expect(preset.prompt).toBe('Prompt 1')
    expect(preset.maxResponse).toBe(100)
  })

  it('honors valid bound ids before global selection and falls back when missing', () => {
    const presets = [
      createTranslatorPreset('Global', { id: 'global', prompt: 'Global prompt', maxResponse: 128 }),
      createTranslatorPreset('Bound', { id: 'bound', prompt: 'Bound prompt', maxResponse: 256 }),
    ]
    const state: TranslatorPresetStateLike = { translatorPresets: presets, translatorPresetId: 0 }

    expect(getTranslatorPresetFromState(state, 'bound')).toBe(presets[1])
    expect(getTranslatorPresetFromState(state, 'missing')).toBe(presets[0])
  })
})
