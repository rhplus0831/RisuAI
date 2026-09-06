// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest'

import { agentUsageCount, getAgentById, getAgents } from './agents'
import type { AgentPresetRecord, AgentRecord } from './agentPresetRecords'
import { replaceResourceDatabase, resetServerResourceState, settingsResourceState } from './server/resourceState.svelte'

function agent(id: string, name = id): AgentRecord {
  return {
    id,
    name,
    version: 1,
    instruction: `${name} instruction`,
    modelDefaults: { mode: 'inheritMain' },
    runtimeDefaults: {},
    inputScopes: [],
    outputFormat: 'text',
  }
}

function preset(id: string, agentIds: string[]): AgentPresetRecord {
  return {
    id,
    name: id,
    enabled: true,
    version: 1,
    steps: [],
    agentUses: agentIds.map((agentId, index) => ({
      id: `${id}-use-${index}`,
      agentId,
      enabled: true,
      phase: 'beforeMain',
      dependencies: [],
      outputKey: `${id}_${index}`,
      destination: 'promptOutput',
      failurePolicy: { mode: 'required' },
    })),
  }
}

function installConfiguration(agents: AgentRecord[], agentPresets: AgentPresetRecord[] = []): void {
  replaceResourceDatabase({ agents, agentPresets, characters: [] } as never, 4)
}

beforeEach(() => {
  resetServerResourceState()
})

describe('agent resource owner reads', () => {
  it('fails closed before the owner has resident rows or readiness', () => {
    expect(getAgents()).toEqual([])

    const residentAgent = agent('resident-agent')
    settingsResourceState.value = { agents: [residentAgent] }
    settingsResourceState.groupStatuses.agents = 'loading'
    expect(getAgents()).toEqual([residentAgent])

    settingsResourceState.value = {}
    settingsResourceState.groupStatuses.agents = 'ready'
    expect(getAgents()).toEqual([])
  })

  it('keeps the resident owner projection visible while its settings group refreshes', () => {
    const ownedAgent = agent('agent-owned', 'Owned Agent')
    installConfiguration([ownedAgent])
    settingsResourceState.groupStatuses.agents = 'loading'

    expect(getAgents()).toEqual([ownedAgent])
    expect(getAgentById('agent-owned')).toEqual(ownedAgent)
  })

  it('resolves stable ids only when exactly one owner exists', () => {
    const first = agent('duplicate-agent', 'First')
    const second = agent('duplicate-agent', 'Second')
    installConfiguration([first, second], [preset('preset-a', ['duplicate-agent'])])

    expect(getAgents()).toEqual([])
    expect(getAgentById('duplicate-agent')).toBeUndefined()
    expect(getAgentById('missing-agent')).toBeUndefined()
    expect(getAgentById('')).toBeUndefined()
    expect(agentUsageCount('duplicate-agent')).toBe(0)
  })

  it('counts uses only for a uniquely-resolved agent', () => {
    const ownedAgent = agent('agent-owned')
    installConfiguration(
      [ownedAgent],
      [preset('preset-a', ['agent-owned', 'agent-owned']), preset('preset-b', ['other-agent'])],
    )

    expect(agentUsageCount('agent-owned')).toBe(2)
    expect(agentUsageCount('other-agent')).toBe(0)
  })

  it('fails closed for malformed data after the owner is ready', () => {
    installConfiguration([agent('agent-owned')])
    settingsResourceState.value = { agents: { malformed: true } as never }
    settingsResourceState.groupStatuses.agents = 'ready'

    expect(getAgents()).toEqual([])
    expect(getAgentById('agent-owned')).toBeUndefined()
  })

  it('fails closed for owner errors instead of falling back to stale compatibility data', () => {
    const ownedAgent = agent('agent-owned')
    installConfiguration([ownedAgent], [preset('preset-a', ['agent-owned'])])
    settingsResourceState.groupStatuses.agents = 'error'

    expect(getAgents()).toEqual([])
    expect(getAgentById('agent-owned')).toBeUndefined()
    expect(agentUsageCount('agent-owned')).toBe(0)
  })

  it('fails closed for duplicate preset ids when counting Agent uses', () => {
    const ownedAgent = agent('agent-owned')
    installConfiguration([ownedAgent], [preset('preset-a', ['agent-owned']), preset('preset-a', ['agent-owned'])])

    expect(getAgents()).toEqual([ownedAgent])
    expect(agentUsageCount('agent-owned')).toBe(0)
  })
})
