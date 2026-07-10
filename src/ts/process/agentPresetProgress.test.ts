import { get } from 'svelte/store'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  agentPresetProgress,
  clearAgentPresetProgress,
  getAgentPresetProgressPercent,
  updateAgentPresetProgress,
} from './agentPresetProgress'

afterEach(() => {
  clearAgentPresetProgress()
  vi.useRealTimers()
})

describe('Agent Preset progress state', () => {
  it('tracks phase snapshots and preserves the phase start time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    updateAgentPresetProgress({
      type: 'agent_preset_progress',
      chatId: 'chat-1',
      presetId: 'preset-1',
      presetName: 'Research',
      phase: 'beforeMain',
      status: 'started',
      totalSteps: 2,
      completedSteps: 0,
      activeSteps: [],
    })

    vi.setSystemTime(1_500)
    updateAgentPresetProgress({
      type: 'agent_preset_progress',
      chatId: 'chat-1',
      presetId: 'preset-1',
      presetName: 'Research',
      phase: 'beforeMain',
      status: 'running',
      totalSteps: 2,
      completedSteps: 1,
      activeSteps: [{ stepId: 'step-2', stepName: 'Critique', outputKey: 'critique' }],
    })

    expect(get(agentPresetProgress)).toMatchObject({
      startedAt: 1_000,
      updatedAt: 1_500,
      completedSteps: 1,
    })
  })

  it('clears terminal snapshots and clamps determinate percentages', () => {
    expect(getAgentPresetProgressPercent({ completedSteps: 1, totalSteps: 4 })).toBe(25)
    expect(getAgentPresetProgressPercent({ completedSteps: 9, totalSteps: 4 })).toBe(100)
    expect(getAgentPresetProgressPercent({ completedSteps: 1, totalSteps: 0 })).toBe(0)

    updateAgentPresetProgress({
      type: 'agent_preset_progress',
      chatId: 'chat-1',
      presetId: 'preset-1',
      presetName: 'Research',
      phase: 'afterMain',
      status: 'finished',
      totalSteps: 1,
      completedSteps: 1,
      activeSteps: [],
    })
    expect(get(agentPresetProgress)).toBeNull()
  })
})
