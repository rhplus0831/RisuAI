import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const databaseMocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
}))

vi.mock('src/ts/storage/database.svelte', () => ({
  getDatabase: databaseMocks.getDatabase,
  reapplyPendingPresetProjections: () => {},
}))

vi.mock('src/ts/process/modules', () => ({
  applyModule: vi.fn(),
  exportModule: vi.fn(),
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModuleTriggers: vi.fn(() => []),
  getModules: vi.fn(() => []),
  importModule: vi.fn(),
  moduleUpdate: vi.fn(),
  readModule: vi.fn(),
  refreshModules: vi.fn(),
}))

import {
  beginAgentPresetProgress,
  clearAgentPresetProgress,
  updateAgentPresetProgress,
  type AgentPresetProgressSession,
} from 'src/ts/process/agentPresetProgress'
import { selectedCharID } from 'src/ts/stores.svelte'
import { testDatabaseState } from 'src/ts/__tests__/resourceDatabaseState'
import AgentPresetProgress from './AgentPresetProgress.svelte'

databaseMocks.getDatabase.mockImplementation(() => testDatabaseState.db)

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined
let progressSession: AgentPresetProgressSession

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  testDatabaseState.db = {
    characters: [{ chatPage: 0, chats: [{ id: 'chat-1' }] }],
  } as never
  selectedCharID.set(0)
  progressSession = beginAgentPresetProgress('chat-1')
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  clearAgentPresetProgress()
  selectedCharID.set(-1)
  testDatabaseState.db = {}
  target.remove()
})

describe('AgentPresetProgress', () => {
  it('shows the active preset, concurrent steps, and determinate completion', async () => {
    component = mount(AgentPresetProgress, { target })
    updateAgentPresetProgress(progressSession, {
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
    expect(target.querySelectorAll('.risu-ongoing-pulse')).toHaveLength(2)
  })

  it('hides progress for a different chat and after a terminal snapshot', async () => {
    component = mount(AgentPresetProgress, { target })
    progressSession = beginAgentPresetProgress('chat-2')
    updateAgentPresetProgress(progressSession, {
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

    progressSession = beginAgentPresetProgress('chat-1')
    updateAgentPresetProgress(progressSession, {
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

    updateAgentPresetProgress(progressSession, {
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
