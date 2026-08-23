import { describe, expect, it } from 'vitest'
import {
  normalizeScriptModelOverrides,
  readScriptModelOverrides,
  scriptModelOverrideProfileId,
  updateScriptModelOverrideProfileId,
} from './scriptModelOverrides'

describe('script model overrides', () => {
  it('normalizes supported profile ids and removes blank or unknown data', () => {
    expect(
      normalizeScriptModelOverrides({
        llmProfileId: ' main-profile ',
        axLlmProfileId: '',
        ignored: 'value',
      }),
    ).toEqual({ llmProfileId: 'main-profile' })
    expect(normalizeScriptModelOverrides(null)).toEqual({})
  })

  it('strictly validates command payloads', () => {
    expect(readScriptModelOverrides({ axLlmProfileId: ' aux-profile ' })).toEqual({
      axLlmProfileId: 'aux-profile',
    })
    expect(() => readScriptModelOverrides([])).toThrow('scriptModelOverrides must be an object')
    expect(() => readScriptModelOverrides({ llmProfileId: '' })).toThrow(
      'scriptModelOverrides.llmProfileId must be a non-empty string',
    )
    expect(() => readScriptModelOverrides({ modelId: 'raw-model' })).toThrow(
      'scriptModelOverrides.modelId is not supported',
    )
  })

  it('reads and updates the profile assigned to each script role', () => {
    const main = updateScriptModelOverrideProfileId({}, 'scriptMain', 'main-profile')
    const both = updateScriptModelOverrideProfileId(main, 'scriptAux', 'aux-profile')

    expect(scriptModelOverrideProfileId(both, 'scriptMain')).toBe('main-profile')
    expect(scriptModelOverrideProfileId(both, 'scriptAux')).toBe('aux-profile')
    expect(updateScriptModelOverrideProfileId(both, 'scriptMain', '')).toEqual({
      axLlmProfileId: 'aux-profile',
    })
  })
})
