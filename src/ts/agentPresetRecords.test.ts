import { describe, expect, it } from 'vitest'
import {
  normalizeAgentConfiguration,
  normalizeAgentPresetDefaultId,
  normalizeAgentPresets,
  resolveAgentPresetSteps,
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
  it('migrates embedded steps into standalone Agents and preset uses without deduplicating them', () => {
    const normalized = normalizeAgentConfiguration(undefined, [
      preset({ id: 'ap_a', steps: [step({ id: 'shared_name' })] }),
      preset({ id: 'ap_b', steps: [step({ id: 'shared_name', instruction: 'Different behavior.' })] }),
    ])

    expect(normalized.agents).toHaveLength(2)
    expect(normalized.agents.map((agent) => agent.id)).toEqual(['shared_name', 'shared_name_ap_b'])
    expect(normalized.agentPresets[0].steps).toEqual([])
    expect(normalized.agentPresets[0].agentUses).toEqual([
      expect.objectContaining({ id: 'shared_name', agentId: 'shared_name', outputKey: 'context' }),
    ])
    expect(normalized.agentPresets[1].agentUses?.[0].agentId).toBe('shared_name_ap_b')
  })

  it('resolves shared Agent defaults with per-preset model and runtime overrides', () => {
    const normalized = normalizeAgentConfiguration(undefined, [preset()])
    const agent = normalized.agents[0]
    const firstPreset = normalized.agentPresets[0]
    const secondPreset: AgentPresetRecord = {
      id: 'ap_second',
      name: 'Second',
      enabled: true,
      version: 1,
      steps: [],
      agentUses: [
        {
          ...firstPreset.agentUses![0],
          id: 'use_second',
          modelOverride: { mode: 'modelProfile', profileId: 'profile_fast' },
          runtimeOverride: { timeoutMs: 5_000 },
        },
      ],
    }

    expect(resolveAgentPresetSteps(firstPreset, [agent])[0]).toMatchObject({
      agentId: agent.id,
      instruction: 'Collect context.',
      model: { mode: 'inheritMain' },
      runtime: { timeoutMs: 30_000 },
    })
    expect(resolveAgentPresetSteps(secondPreset, [agent])[0]).toMatchObject({
      agentId: agent.id,
      model: { mode: 'modelProfile', profileId: 'profile_fast' },
      runtime: { timeoutMs: 5_000, maxInputChars: 20_000 },
    })
  })
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

  it('normalizes Agent toggle and named lorebook input definitions', () => {
    const normalized = normalizeAgentConfiguration(
      [
        {
          id: 'agent-context',
          name: 'Context',
          instruction: '{{agentToggle::tone}}\n{{agentInput::reference}}',
          toggles: [{ key: ' tone ', label: ' Tone ', kind: 'select', options: ['Warm', 'Cold'] }],
          lorebookInputs: [{ key: ' reference ', displayName: ' Reference Notes ' }],
        },
      ],
      [],
    ).agents[0]

    expect(normalized.toggles).toEqual([{ key: 'tone', label: 'Tone', kind: 'select', options: ['Warm', 'Cold'] }])
    expect(normalized.lorebookInputs).toEqual([{ key: 'reference', displayName: 'Reference Notes', required: true }])
  })

  it('rejects duplicate local keys and required lorebook inputs that are not placed in the instruction', () => {
    const issues = validateAgentPresetRecord(
      preset({
        steps: [
          step({
            toggles: [
              { key: 'tone', label: 'Tone', kind: 'boolean', options: [] },
              { key: 'tone', label: 'Duplicate', kind: 'boolean', options: [] },
            ],
            lorebookInputs: [{ key: 'reference', displayName: 'Reference Notes', required: true }],
          }),
        ],
      }),
    )

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['invalid_toggle', 'invalid_lorebook_input']),
    )
  })

  it('rejects Agent-local placeholders that do not have matching definitions', () => {
    const issues = validateAgentPresetRecord(
      preset({
        steps: [step({ instruction: '{{agentToggle::missing_toggle}}\n{{agentInput::missing_input}}' })],
      }),
    )

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_toggle', message: expect.stringContaining('missing_toggle') }),
        expect.objectContaining({ code: 'invalid_lorebook_input', message: expect.stringContaining('missing_input') }),
      ]),
    )
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

  it('validates before-main user-input modifier phase, uniqueness, and order', () => {
    const valid = validateAgentPresetRecord(
      preset({
        steps: [
          step({ id: 'aps_context', outputKey: 'context' }),
          step({ id: 'aps_input', outputKey: 'input', destination: 'userInput' }),
        ],
      }),
    )
    expect(valid).toEqual([])

    const wrongOrder = validateAgentPresetRecord(
      preset({
        steps: [
          step({ id: 'aps_input', outputKey: 'input', destination: 'userInput' }),
          step({ id: 'aps_context', outputKey: 'context' }),
        ],
      }),
    )
    expect(wrongOrder.map((issue) => issue.code)).toContain('invalid_before_main_modifier')

    const wrongPhase = validateAgentPresetRecord(
      preset({
        steps: [
          step({
            id: 'aps_input',
            phase: 'afterMain',
            outputKey: 'input',
            destination: 'userInput',
          }),
        ],
      }),
    )
    expect(wrongPhase.map((issue) => issue.code)).toContain('invalid_destination')

    const duplicate = validateAgentPresetRecord(
      preset({
        steps: [
          step({ id: 'aps_input_a', outputKey: 'input_a', destination: 'userInput' }),
          step({ id: 'aps_input_b', outputKey: 'input_b', destination: 'userInput' }),
        ],
      }),
    )
    expect(duplicate.map((issue) => issue.code)).toContain('invalid_before_main_modifier')
  })
})
