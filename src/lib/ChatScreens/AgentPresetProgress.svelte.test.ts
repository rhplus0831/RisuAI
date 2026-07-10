import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearAgentPresetProgress, updateAgentPresetProgress } from 'src/ts/process/agentPresetProgress'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import AgentPresetProgress from './AgentPresetProgress.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  DBState.db = {
    characters: [{ chatPage: 0, chats: [{ id: 'chat-1' }] }],
  } as never
  selectedCharID.set(0)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  clearAgentPresetProgress()
  selectedCharID.set(-1)
  DBState.db = {} as never
  target.remove()
})

describe('AgentPresetProgress', () => {
  it('shows the active preset, concurrent steps, and determinate completion', async () => {
    component = mount(AgentPresetProgress, { target })
    updateAgentPresetProgress({
      type: 'agent_preset_progress',
      chatId: 'chat-1',
      presetId: 'preset-1',
      presetName: 'Research Team',
      phase: 'beforeMain',
      status: 'running',
      totalSteps: 4,
      completedSteps: 2,
      activeSteps: [
        { stepId: 'step-3', stepName: 'Critique', outputKey: 'critique' },
        { stepId: 'step-4', stepName: 'Fact Check', outputKey: 'facts' },
      ],
    })
    await tick()

    expect(target.textContent).toContain('Research Team')
    expect(target.textContent).toContain('2/4')
    expect(target.textContent).toContain('Critique, Fact Check')
    expect(target.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50')
  })

  it('hides progress for a different chat and after a terminal snapshot', async () => {
    component = mount(AgentPresetProgress, { target })
    updateAgentPresetProgress({
      type: 'agent_preset_progress',
      chatId: 'chat-2',
      presetId: 'preset-1',
      presetName: 'Other Chat',
      phase: 'afterMain',
      status: 'running',
      totalSteps: 1,
      completedSteps: 0,
      activeSteps: [],
    })
    await tick()
    expect(target.querySelector('[role="status"]')).toBeNull()

    updateAgentPresetProgress({
      type: 'agent_preset_progress',
      chatId: 'chat-1',
      presetId: 'preset-1',
      presetName: 'Current Chat',
      phase: 'afterMain',
      status: 'running',
      totalSteps: 1,
      completedSteps: 0,
      activeSteps: [{ stepId: 'step-1', stepName: 'Rewrite', outputKey: 'rewrite' }],
    })
    await tick()
    expect(target.querySelector('[role="status"]')).toBeTruthy()

    updateAgentPresetProgress({
      type: 'agent_preset_progress',
      chatId: 'chat-1',
      presetId: 'preset-1',
      presetName: 'Current Chat',
      phase: 'afterMain',
      status: 'finished',
      totalSteps: 1,
      completedSteps: 1,
      activeSteps: [],
    })
    await tick()
    expect(target.querySelector('[role="status"]')).toBeNull()
  })
})
