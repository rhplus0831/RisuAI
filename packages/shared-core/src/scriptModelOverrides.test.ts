import { describe, expect, it } from 'vitest'
import {
  normalizeScriptModelOverrides,
  readScriptModelOverrides,
  ScriptModelOverridesValidationError,
  scriptModelOverrideProfileId,
  updateScriptModelOverrideProfileId,
} from './scriptModelOverrides.js'

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
    expect(normalizeScriptModelOverrides([])).toEqual({})
    expect(normalizeScriptModelOverrides('main-profile')).toEqual({})
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

  it('preserves custom validation paths and error identity', () => {
    expect(() => readScriptModelOverrides({ axLlmProfileId: 42 }, 'module.scriptModelOverrides')).toThrowError(
      new ScriptModelOverridesValidationError('module.scriptModelOverrides.axLlmProfileId must be a non-empty string'),
    )
    try {
      readScriptModelOverrides(null)
      expect.unreachable('expected validation to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(ScriptModelOverridesValidationError)
      expect((error as Error).name).toBe('ScriptModelOverridesValidationError')
    }
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

  it('returns fresh values without mutating its input', () => {
    const input = { llmProfileId: ' main ', axLlmProfileId: ' aux ' }
    const normalized = normalizeScriptModelOverrides(input)
    const updated = updateScriptModelOverrideProfileId(input, 'scriptMain', 'next')

    expect(normalized).not.toBe(input)
    expect(updated).not.toBe(input)
    expect(input).toEqual({ llmProfileId: ' main ', axLlmProfileId: ' aux ' })
    expect(normalized).toEqual({ llmProfileId: 'main', axLlmProfileId: 'aux' })
    expect(updated).toEqual({ llmProfileId: 'next', axLlmProfileId: 'aux' })
  })
})
