import { describe, expect, it } from 'vitest'
import { isLocalStopStrings, repairLegacyLocalStopStrings } from './localStopStrings.js'
import {
  composeEffectivePresetSettings,
  createExtractedModelPreset,
  createExtractedPromptPreset,
} from './presetSplit.js'

const markers = [
  { ext: 0, data: [0] },
  { type: 0, data: { type: 'Buffer', data: [0] } },
]

describe('legacy local stop strings', () => {
  it.each(markers)('removes only the wrapped undefined field %j and is idempotent', (marker) => {
    const owner = { localStopStrings: marker, extension: marker, name: 'Preset' }
    expect(repairLegacyLocalStopStrings(owner)).toBe(true)
    expect(owner).toEqual({ extension: marker, name: 'Preset' })
    expect(repairLegacyLocalStopStrings(owner)).toBe(false)
  })

  it.each(markers)('keeps inheritance when extracting an imported preset with %j', (marker) => {
    const input = { localStopStrings: marker, overrideModelParameters: true }
    const promptPreset = createExtractedPromptPreset(input, { id: 'prompt' })
    const modelPreset = createExtractedModelPreset(input, { id: 'model' })
    expect(promptPreset).not.toHaveProperty('localStopStrings')
    expect(modelPreset).not.toHaveProperty('localStopStrings')
    expect(input.localStopStrings).toBe(marker)
    expect(
      composeEffectivePresetSettings({
        base: {},
        modelPreset: { localStopStrings: ['MODEL STOP'] },
        promptPreset,
      }).localStopStrings,
    ).toEqual(['MODEL STOP'])
  })

  it.each([
    undefined,
    null,
    [],
    ['STOP\\nHERE'],
    {},
    [null],
    [42],
    'STOP',
    { ext: 1, data: [0] },
    { ext: 0, data: [1] },
    { ext: 0, data: [0, 0] },
    { ext: '0', data: [0] },
    { ext: 0, data: [0], extension: true },
    { type: 0, data: { type: 'Buffer', data: [1] } },
    { type: 1, data: { type: 'Buffer', data: [0] } },
    { type: 0, data: { type: 'Buffer', data: [0], extension: true } },
    { type: 'Buffer', data: [0] },
  ])('preserves supported values and unrecognized objects without coercion: %j', (value) => {
    const owner = { localStopStrings: value }
    expect(repairLegacyLocalStopStrings(owner)).toBe(false)
    expect(Object.hasOwn(owner, 'localStopStrings')).toBe(true)
    expect(owner.localStopStrings).toBe(value)
  })

  it.each([undefined, null, [], ['', 'STOP']])('accepts supported override %j', (value) => {
    expect(isLocalStopStrings(value)).toBe(true)
  })

  it.each([...markers, {}, [null], [42], 'STOP', false])('rejects unsupported override %j', (value) => {
    expect(isLocalStopStrings(value)).toBe(false)
  })
})
