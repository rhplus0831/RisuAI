import { describe, expect, it } from 'vitest'
import { sparseAgentPresetStepPatch } from './agentPresetStepPatch'

describe('sparseAgentPresetStepPatch', () => {
  it('omits ids and unchanged top-level JSON values', () => {
    const instruction = 'Large unchanged instruction. '.repeat(10_000)
    const runtime = { timeoutMs: 30_000, maxInputChars: 24_000, maxOutputChars: 1_200, temperature: 100 }

    expect(
      sparseAgentPresetStepPatch(
        { id: 'step-a', name: 'Before', instruction, runtime },
        { id: 'different-id', name: 'After', instruction, runtime: { ...runtime } },
      ),
    ).toEqual({ name: 'After' })
  })

  it('preserves changed false, null, and empty values', () => {
    expect(
      sparseAgentPresetStepPatch(
        {
          enabled: true,
          instruction: 'Before',
          inputScopes: ['currentUserMessage'],
          extension: { enabled: true },
        },
        {
          enabled: false,
          instruction: '',
          inputScopes: [],
          extension: null,
        },
      ),
    ).toEqual({ enabled: false, instruction: '', inputScopes: [], extension: null })
  })

  it('returns an empty patch for JSON-equivalent normalized snapshots', () => {
    expect(
      sparseAgentPresetStepPatch(
        { name: 'Same', model: { mode: 'inheritMain' }, dependencies: [] },
        { name: 'Same', model: { mode: 'inheritMain' }, dependencies: [] },
      ),
    ).toEqual({})
  })

  it('keeps a changed x100-scaled temperature as its stored integer value', () => {
    expect(
      sparseAgentPresetStepPatch(
        { runtime: { timeoutMs: 30_000, temperature: 100 } },
        { runtime: { timeoutMs: 30_000, temperature: 70 } },
      ),
    ).toEqual({ runtime: { timeoutMs: 30_000, temperature: 70 } })
  })
})
