import { describe, expect, it, vi } from 'vitest'
import { decode as decodeMsgpack } from 'msgpackr/index-no-eval'
import { decompressSync } from 'fflate'

vi.mock('src/ts/util', () => ({
  encryptBuffer: async (data: Uint8Array) => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  decryptBuffer: async (data: Uint8Array) => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
}))

vi.mock('src/ts/rpack/rpack_js.js', () => ({
  encodeRPack: async (data: Uint8Array) => data,
  decodeRPack: async (data: Uint8Array) => data,
}))

import {
  createTranslatorPreset,
  decodeTranslatorPresetFile,
  encodeTranslatorPresetFile,
  getCurrentTranslatorPresetFromState,
  getTranslatorPresetFromState,
  getTranslatorPresetDownloadName,
  normalizeTranslatorPresetState,
  normalizeTranslatorPresetStateWithLegacyCompatibility,
  TRANSLATOR_PRESET_MAX_STEPS,
  translatorPresetImportExtensions,
  type TranslatorPresetStateLike,
} from './presets'

describe('normalizeTranslatorPresetState', () => {
  it('uses canonical defaults without consulting legacy translator settings', () => {
    const state: TranslatorPresetStateLike = {
      translatorPrompt: 'Translate to {{slot}}.',
      translatorMaxResponse: 321,
    }

    normalizeTranslatorPresetState(state)

    expect(state.translatorPresets).toEqual([
      {
        id: expect.any(String),
        name: 'Default',
        prompt: expect.any(String),
        maxResponse: 1000,
        steps: [
          {
            id: expect.any(String),
            name: 'Step 1',
            enabled: true,
            prompt: expect.any(String),
            maxResponse: 1000,
            model: { mode: 'inheritTranslate' },
          },
        ],
      },
    ])
    expect(state.translatorPresetId).toBe(0)
    expect(state.translatorPrompt).toBe('Translate to {{slot}}.')
    expect(state.translatorMaxResponse).toBe(321)
  })

  it('imports legacy translator settings only through the explicit compatibility resolver', () => {
    const state: TranslatorPresetStateLike = {
      translatorPrompt: 'Translate to {{slot}}.',
      translatorMaxResponse: 321,
    }

    normalizeTranslatorPresetStateWithLegacyCompatibility(state)

    expect(state.translatorPresets?.[0]).toMatchObject({
      prompt: 'Translate to {{slot}}.',
      maxResponse: 321,
    })
    expect(state.translatorPrompt).toBe('Translate to {{slot}}.')
    expect(state.translatorMaxResponse).toBe(321)
  })

  it('clamps invalid preset ids without synchronizing legacy fields', () => {
    const state: TranslatorPresetStateLike = {
      translatorPrompt: 'legacy',
      translatorMaxResponse: 1000,
      translatorPresets: [
        createTranslatorPreset('Fast', {
          prompt: 'Fast preset',
          maxResponse: 128,
        }),
      ],
      translatorPresetId: 99,
    }

    normalizeTranslatorPresetState(state)

    expect(state.translatorPresetId).toBe(0)
    expect(state.translatorPresets?.[0]).toMatchObject({ id: expect.any(String) })
    expect(state.translatorPrompt).toBe('legacy')
    expect(state.translatorMaxResponse).toBe(1000)
  })

  it('normalizes missing and duplicate translator preset ids', () => {
    const state: TranslatorPresetStateLike = {
      translatorPresets: [
        { id: 'preset-a', name: 'A', prompt: 'A prompt', maxResponse: 100 },
        { id: 'preset-a', name: 'B', prompt: 'B prompt', maxResponse: 200 },
        { name: 'C', prompt: 'C prompt', maxResponse: 300 },
      ],
      translatorPresetId: 1,
    }

    normalizeTranslatorPresetState(state)

    const ids = state.translatorPresets?.map((preset) =>
      typeof preset === 'object' && preset ? (preset as { id?: unknown }).id : null,
    )
    expect(ids?.[0]).toBe('preset-a')
    expect(ids?.[1]).toEqual(expect.any(String))
    expect(ids?.[1]).not.toBe('preset-a')
    expect(ids?.[2]).toEqual(expect.any(String))
  })

  it('normalizes step ids and output keys, caps the pipeline, and owns first-step values canonically', () => {
    const state: TranslatorPresetStateLike = {
      translatorPrompt: 'stale prompt',
      translatorMaxResponse: 999,
      translatorPresets: [
        {
          id: 'preset-a',
          name: 'Pipeline',
          prompt: 'stale prompt',
          maxResponse: 999,
          steps: Array.from({ length: TRANSLATOR_PRESET_MAX_STEPS + 2 }, (_, index) => ({
            id: index < 2 ? 'duplicate' : '',
            name: index === 0 ? '' : `Named ${index + 1}`,
            enabled: index !== 1,
            prompt: `Step prompt ${index + 1}`,
            maxResponse: index === 1 ? Number.NaN : index + 100,
            model:
              index === 2
                ? { mode: 'modelProfile', profileId: ' profile-a ' }
                : index === 3
                  ? { mode: 'modelProfile', profileId: '' }
                  : { mode: 'inheritTranslate' },
            outputKey: index < 2 ? 'shared' : index === 2 ? 'invalid-key!' : `key_${index}`,
          })),
        },
      ],
      translatorPresetId: 0,
    }

    normalizeTranslatorPresetState(state)

    const preset = state.translatorPresets?.[0] as any
    expect(preset.steps).toHaveLength(TRANSLATOR_PRESET_MAX_STEPS)
    expect(new Set(preset.steps.map((step: { id: string }) => step.id)).size).toBe(TRANSLATOR_PRESET_MAX_STEPS)
    expect(preset.steps[0]).toMatchObject({ name: 'Step 1', outputKey: 'shared' })
    expect(preset.steps[1].outputKey).toBeUndefined()
    expect(preset.steps[1].maxResponse).toBe(1000)
    expect(preset.steps[2].outputKey).toBeUndefined()
    expect(preset.steps[2].model).toEqual({ mode: 'modelProfile', profileId: 'profile-a' })
    expect(preset.steps[3].model).toEqual({ mode: 'inheritTranslate' })
    expect(preset.prompt).toBe('Step prompt 1')
    expect(preset.maxResponse).toBe(100)
    expect(state.translatorPrompt).toBe('stale prompt')
    expect(state.translatorMaxResponse).toBe(999)
  })
})

describe('getCurrentTranslatorPresetFromState', () => {
  it('reuses a valid selected preset without renormalizing the preset array', () => {
    const presets = [
      createTranslatorPreset('Default', {
        prompt: 'Default prompt',
        maxResponse: 128,
      }),
      createTranslatorPreset('Detailed', {
        prompt: 'Detailed prompt',
        maxResponse: 256,
      }),
    ]
    const state: TranslatorPresetStateLike = {
      translatorPrompt: 'legacy prompt',
      translatorMaxResponse: 1000,
      translatorPresets: presets,
      translatorPresetId: 1,
    }

    const preset = getCurrentTranslatorPresetFromState(state)

    expect(preset).toBe(presets[1])
    expect(state.translatorPresets).toBe(presets)
    expect(state.translatorPrompt).toBe('legacy prompt')
    expect(state.translatorMaxResponse).toBe(1000)
  })

  it('resolves a stable chat binding without changing the global legacy mirrors', () => {
    const presets = [
      createTranslatorPreset('Global', { id: 'global', prompt: 'Global prompt', maxResponse: 128 }),
      createTranslatorPreset('Bound', { id: 'bound', prompt: 'Bound prompt', maxResponse: 256 }),
    ]
    const state: TranslatorPresetStateLike = {
      translatorPrompt: 'Global prompt',
      translatorMaxResponse: 128,
      translatorPresets: presets,
      translatorPresetId: 0,
    }

    expect(getTranslatorPresetFromState(state, 'bound')).toBe(presets[1])
    expect(state.translatorPresetId).toBe(0)
    expect(state.translatorPrompt).toBe('Global prompt')
    expect(state.translatorMaxResponse).toBe(128)
  })

  it('falls back to the global preset for a missing chat binding', () => {
    const presets = [
      createTranslatorPreset('Global', { id: 'global', prompt: 'Global prompt', maxResponse: 128 }),
      createTranslatorPreset('Other', { id: 'other', prompt: 'Other prompt', maxResponse: 256 }),
    ]
    const state: TranslatorPresetStateLike = {
      translatorPrompt: 'legacy',
      translatorMaxResponse: 1000,
      translatorPresets: presets,
      translatorPresetId: 0,
    }

    expect(getTranslatorPresetFromState(state, 'missing')).toBe(presets[0])
    expect(state.translatorPrompt).toBe('legacy')
    expect(state.translatorMaxResponse).toBe(1000)
  })

  it('prefers the selected canonical preset over conflicting stale legacy scalars', () => {
    const state: TranslatorPresetStateLike = {
      translatorPrompt: 'stale scalar prompt',
      translatorMaxResponse: 7,
      translatorPresets: [createTranslatorPreset('Canonical', { prompt: 'canonical prompt', maxResponse: 321 })],
      translatorPresetId: 0,
    }

    const preset = getTranslatorPresetFromState(state)

    expect(preset.prompt).toBe('canonical prompt')
    expect(preset.maxResponse).toBe(321)
    expect(state.translatorPrompt).toBe('stale scalar prompt')
    expect(state.translatorMaxResponse).toBe(7)
  })
})

describe('translator preset file codec', () => {
  it('only allows .risutl files in the import picker', () => {
    expect(translatorPresetImportExtensions).toEqual(['risutl'])
  })

  it('round-trips a trivial pipeline through a version 1 .risutl payload', async () => {
    const preset = createTranslatorPreset('My Preset', {
      prompt: 'Translate into {{slot}}.',
      maxResponse: 256,
    })

    const encoded = await encodeTranslatorPresetFile(preset)
    const decoded = await decodeTranslatorPresetFile(encoded)

    const container = decodeMsgpack(decompressSync(encoded)) as { translatorPresetVersion: number }
    expect(container.translatorPresetVersion).toBe(1)
    expect(decoded).toMatchObject({
      name: preset.name,
      prompt: preset.prompt,
      maxResponse: preset.maxResponse,
      steps: [
        {
          enabled: true,
          prompt: preset.prompt,
          maxResponse: preset.maxResponse,
          model: { mode: 'inheritTranslate' },
        },
      ],
    })
    expect(() => JSON.parse(new TextDecoder().decode(encoded))).toThrow()
    expect(getTranslatorPresetDownloadName('My/Translator:Preset')).toBe(
      'translator_preset_My_Translator_Preset.risutl',
    )
  })

  it('round-trips a multi-step pipeline through a version 2 .risutl payload', async () => {
    const preset = createTranslatorPreset('Pipeline', {
      steps: [
        {
          id: 'draft',
          name: 'Draft',
          enabled: true,
          prompt: 'Draft {{slot::content}}',
          maxResponse: 200,
          model: { mode: 'inheritTranslate' },
          outputKey: 'draft',
        },
        {
          id: 'refine',
          name: 'Refine',
          enabled: true,
          prompt: 'Refine {{slot::prev}}',
          maxResponse: 300,
          model: { mode: 'modelProfile', profileId: 'profile-a' },
        },
      ],
    })

    const encoded = await encodeTranslatorPresetFile(preset)
    const container = decodeMsgpack(decompressSync(encoded)) as { translatorPresetVersion: number }
    const decoded = await decodeTranslatorPresetFile(encoded)

    expect(container.translatorPresetVersion).toBe(2)
    expect(decoded).toEqual(preset)
  })

  it('rejects plain JSON translator preset payloads', async () => {
    const plainJsonPayload = new TextEncoder().encode(
      JSON.stringify({
        type: 'risu',
        ver: 1,
        data: {
          name: 'Plain JSON Preset',
          prompt: 'Plain JSON prompt',
          maxResponse: 111,
        },
      }),
    )

    await expect(decodeTranslatorPresetFile(plainJsonPayload)).rejects.toThrow('Invalid translator preset file.')
  })

  it('rejects non-translator preset payloads', async () => {
    const hypaLikePayload = new TextEncoder().encode(
      JSON.stringify({
        type: 'risu',
        ver: 1,
        data: {
          name: 'HypaV3',
          settings: {
            summarizationPrompt: 'not a translator preset',
          },
        },
      }),
    )

    await expect(decodeTranslatorPresetFile(hypaLikePayload)).rejects.toThrow('Invalid translator preset file.')
  })
})
