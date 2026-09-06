import { get } from 'svelte/store'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  agentPresetProgress,
  beginAgentPresetProgress,
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
    const session = beginAgentPresetProgress('chat-1')
    updateAgentPresetProgress(session, {
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
    updateAgentPresetProgress(session, {
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

    expect(get(agentPresetProgress)).toContainEqual(
      expect.objectContaining({
        startedAt: 1_000,
        updatedAt: 1_500,
        completedSteps: 1,
      }),
    )
  })

  it('clears terminal snapshots and clamps determinate percentages', () => {
    expect(getAgentPresetProgressPercent({ completedSteps: 1, totalSteps: 4 })).toBe(25)
    expect(getAgentPresetProgressPercent({ completedSteps: 9, totalSteps: 4 })).toBe(100)
    expect(getAgentPresetProgressPercent({ completedSteps: 1, totalSteps: 0 })).toBe(0)

    const session = beginAgentPresetProgress('chat-1')
    updateAgentPresetProgress(session, {
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
    expect(get(agentPresetProgress)).toEqual([])
  })

  it('keeps simultaneous chats independent and rejects events after session cleanup', () => {
    const first = beginAgentPresetProgress('chat-1')
    const second = beginAgentPresetProgress('chat-2')
    updateAgentPresetProgress(first, {
      type: 'agent_preset_progress',
      chatId: 'chat-1',
      presetId: 'preset-1',
      presetName: 'First',
      phase: 'beforeMain',
      status: 'running',
      totalSteps: 2,
      completedSteps: 1,
      activeSteps: [],
    })
    updateAgentPresetProgress(second, {
      type: 'agent_preset_progress',
      chatId: 'chat-2',
      presetId: 'preset-2',
      presetName: 'Second',
      phase: 'afterMain',
      status: 'running',
      totalSteps: 3,
      completedSteps: 1,
      activeSteps: [],
    })

    expect(get(agentPresetProgress)).toEqual([
      expect.objectContaining({ chatId: 'chat-1', presetName: 'First' }),
      expect.objectContaining({ chatId: 'chat-2', presetName: 'Second' }),
    ])

    clearAgentPresetProgress(first)
    expect(get(agentPresetProgress)).toEqual([expect.objectContaining({ chatId: 'chat-2', presetName: 'Second' })])

    updateAgentPresetProgress(first, {
      type: 'agent_preset_progress',
      chatId: 'chat-1',
      presetId: 'preset-1',
      presetName: 'Stale First',
      phase: 'beforeMain',
      status: 'running',
      totalSteps: 2,
      completedSteps: 2,
      activeSteps: [],
    })
    expect(get(agentPresetProgress)).toEqual([expect.objectContaining({ chatId: 'chat-2', presetName: 'Second' })])
  })

  it('bounds retained live chats and invalidates the least-recently-active session', () => {
    const sessions = Array.from({ length: 17 }, (_, index) => beginAgentPresetProgress(`chat-${index}`))
    sessions.forEach((session, index) => {
      updateAgentPresetProgress(session, {
        type: 'agent_preset_progress',
        chatId: session.chatId,
        presetId: `preset-${index}`,
        presetName: `Preset ${index}`,
        phase: 'beforeMain',
        status: 'running',
        totalSteps: 1,
        completedSteps: 0,
        activeSteps: [],
      })
    })

    const progress = get(agentPresetProgress)
    expect(progress).toHaveLength(16)
    expect(progress.some((entry) => entry.chatId === 'chat-0')).toBe(false)
  })
})
