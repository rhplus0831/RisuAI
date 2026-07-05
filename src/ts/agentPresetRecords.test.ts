import { describe, expect, it } from 'vitest'
import {
  normalizeAgentPresetDefaultId,
  normalizeAgentPresets,
  validateAgentPresetRecord,
  type AgentPresetRecord,
  type AgentPresetStepRecord,
} from './agentPresetRecords'

function step(patch: Partial<AgentPresetStepRecord> = {}): AgentPresetStepRecord {
  return {
    id: 'aps_context',
    name: 'Context',
    enabled: true,
    phase: 'beforeMain',
    dependencies: [],
    instruction: 'Collect context.',
    model: { mode: 'inheritMain' },
    runtime: {
      temperature: 50,
      maxInputChars: 20_000,
      maxOutputChars: 1_200,
      timeoutMs: 30_000,
    },
    inputScopes: ['currentUserMessage', 'recentChatTail'],
    outputKey: 'context',
    outputFormat: 'text',
    destination: 'promptOutput',
    failurePolicy: { mode: 'required' },
    ...patch,
  }
}

function preset(patch: Partial<AgentPresetRecord> = {}): AgentPresetRecord {
  return {
    id: 'ap_default',
    name: 'Default Agent Preset',
    enabled: true,
    version: 1,
    maxConcurrency: 2,
    steps: [step()],
    ...patch,
  }
}

describe('agent preset records', () => {
  it('normalizes stored records without inventing default presets', () => {
    expect(normalizeAgentPresets(undefined)).toEqual([])

    expect(
      normalizeAgentPresets([
        {
          id: ' ap_research ',
          name: ' Research ',
          enabled: false,
          version: 0,
          maxConcurrency: 99,
          agentPresetDefaultId: 'ignored',
          steps: [
            {
              id: ' aps_fact ',
              name: ' Facts ',
              phase: 'afterMain',
              inputScopes: ['currentUserMessage', 'unknown', 'currentUserMessage'],
              outputFormat: 'jsonObject',
              failurePolicy: { mode: 'fallbackText', text: 'fallback' },
            },
            { id: 'aps_fact', name: 'duplicate' },
          ],
        },
      ]),
    ).toEqual([
      {
        id: 'ap_research',
        name: 'Research',
        enabled: false,
        version: 1,
        steps: [
          {
            id: 'aps_fact',
            name: 'Facts',
            enabled: true,
            phase: 'afterMain',
            dependencies: [],
            instruction: '',
            model: { mode: 'inheritMain' },
            runtime: {},
            inputScopes: ['currentUserMessage'],
            outputKey: 'aps_fact',
            outputFormat: 'jsonObject',
            destination: 'intermediate',
            failurePolicy: { mode: 'fallbackText', text: 'fallback' },
          },
        ],
      },
    ])
  })

  it('clears default ids that do not point to an existing preset', () => {
    const presets = normalizeAgentPresets([{ id: 'ap_a', name: 'A' }])

    expect(normalizeAgentPresetDefaultId('ap_a', presets)).toBe('ap_a')
    expect(normalizeAgentPresetDefaultId('missing', presets)).toBeUndefined()
    expect(normalizeAgentPresetDefaultId('', presets)).toBeUndefined()
  })

  it('validates output keys, dependency ids, cycles, and phase direction', () => {
    const issues = validateAgentPresetRecord(
      preset({
        steps: [
          step({ id: 'aps_a', outputKey: 'bad-key', dependencies: ['aps_c'] }),
          step({ id: 'aps_b', phase: 'afterMain', outputKey: 'result', dependencies: ['aps_a'] }),
          step({ id: 'aps_c', phase: 'afterMain', outputKey: 'result', dependencies: ['aps_b'] }),
        ],
      }),
    )

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['invalid_output_key', 'duplicate_output_key', 'invalid_dependency', 'cyclic_dependency']),
    )
  })

  it('validates runtime bounds and after-main direct modifier order', () => {
    const issues = validateAgentPresetRecord(
      preset({
        maxConcurrency: 99,
        steps: [
          step({
            id: 'aps_modifier',
            phase: 'afterMain',
            outputKey: 'modifier',
            destination: 'finalOutput',
            runtime: {
              temperature: 201,
              maxInputChars: -1,
              maxOutputChars: 0,
              timeoutMs: 100,
            },
          }),
          step({
            id: 'aps_advisory',
            phase: 'afterMain',
            outputKey: 'advisory',
            destination: 'intermediate',
          }),
        ],
      }),
    )

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['invalid_max_concurrency', 'invalid_runtime', 'invalid_after_main_modifier']),
    )
  })
})
