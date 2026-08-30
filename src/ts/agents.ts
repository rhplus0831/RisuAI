import type { AgentPresetRecord, AgentPresetUseRecord, AgentRecord } from './agentPresetRecords'
import { safeStructuredClone } from './polyfill'
import {
  createAgentCommand,
  createAgentPresetUseCommand,
  deleteAgentCommand,
  deleteAgentPresetUseCommand,
  duplicateAgentCommand,
  reorderAgentsCommand,
  reorderAgentPresetUsesCommand,
  runServerCommand,
  updateAgentCommand,
  updateAgentPresetUseCommand,
  type AgentPresetUseSnapshot,
  type AgentSnapshot,
  type ServerCommandResult,
  type ServerCommandTransportOptions,
} from './server/commands'
import { dispatchDurableMutation } from './server/durableMutationDispatch'
import {
  isPendingMutationCurrent,
  stagePendingMutation,
  type DurableMutationIntent,
} from './server/pendingMutationOutbox'
import { settingsResourceState } from './server/resourceState.svelte'
import { getDatabase } from './storage/database.svelte'

const AGENT_CONFIGURATION_MUTATION_KEY = 'agent-configuration'

export type AgentMutationOutcome<T extends Record<string, unknown> = Record<string, unknown>> =
  | { status: 'accepted'; result: Extract<ServerCommandResult<T>, { status: 'ok' }> }
  | { status: 'queued'; result: Exclude<ServerCommandResult<T>, { status: 'ok' }>; mutationId: string }
  | { status: 'failed'; result: Exclude<ServerCommandResult<T>, { status: 'ok' }> }

type AgentConfigurationOwner = {
  agents?: AgentRecord[]
  agentPresets?: AgentPresetRecord[]
}

export function getAgents(): AgentRecord[] {
  const owner = readAgentConfigurationOwner()
  return Array.isArray(owner.agents) ? owner.agents : []
}

export function getAgentById(agentId: string): AgentRecord | undefined {
  return uniqueAgentById(readAgentConfigurationOwner().agents, agentId)
}

export function agentUsageCount(agentId: string): number {
  const owner = readAgentConfigurationOwner()
  if (!uniqueAgentById(owner.agents, agentId)) return 0
  return (Array.isArray(owner.agentPresets) ? owner.agentPresets : []).reduce((count, preset) => {
    const uses = Array.isArray(preset.agentUses) ? preset.agentUses : []
    return count + uses.filter((use) => use.agentId === agentId).length
  }, 0)
}

/**
 * Agents are delivered in the read-only `agents` settings group today. Keep
 * this projection narrow so callers do not compose or mutate the Database
 * compatibility facade. During bootstrap, retain the legacy read only while
 * the owner has no resident rows; once the group is ready, malformed data
 * fails closed instead of falling back to stale aggregate state.
 */
function readAgentConfigurationOwner(): AgentConfigurationOwner {
  const owner = settingsResourceState.value as AgentConfigurationOwner
  const ownerReady = settingsResourceState.groupStatuses.agents === 'ready'
  const hasResidentRows =
    (Array.isArray(owner.agents) && owner.agents.length > 0) ||
    (Array.isArray(owner.agentPresets) && owner.agentPresets.length > 0)
  if (ownerReady || hasResidentRows) return owner

  return readLegacyAgentConfigurationBeforeReadiness()
}

/** Compatibility-only path for cold/offline callers before the owner projects rows. */
function readLegacyAgentConfigurationBeforeReadiness(): AgentConfigurationOwner {
  const database = getDatabase()
  return { agents: database.agents, agentPresets: database.agentPresets }
}

function uniqueAgentById(agents: readonly AgentRecord[] | undefined, agentId: string): AgentRecord | undefined {
  if (typeof agentId !== 'string' || agentId.trim() === '' || !Array.isArray(agents)) return undefined
  const matches = agents.filter((agent) => agent?.id === agentId)
  return matches.length === 1 ? matches[0] : undefined
}

export function createAgent(agent: AgentSnapshot): Promise<AgentMutationOutcome<{ agentId: string }>> {
  const attempted = safeStructuredClone(agent)
  return dispatchAgentMutation(
    { version: 1, requests: [{ method: 'POST', path: '/agents', body: { agent: attempted } }] },
    (baseRevision) => createAgentCommand({ baseRevision, agent: safeStructuredClone(attempted) }),
  )
}

export function updateAgent(agentId: string, patch: AgentSnapshot): Promise<AgentMutationOutcome<{ agentId: string }>> {
  const attempted = safeStructuredClone(patch)
  const path = `/agents/${encodeURIComponent(agentId)}`
  return dispatchAgentMutation(
    { version: 1, requests: [{ method: 'PATCH', path, body: { patch: attempted } }] },
    (baseRevision) => updateAgentCommand({ baseRevision, agentId, patch: safeStructuredClone(attempted) }),
  )
}

export function duplicateAgent(
  agentId: string,
  name?: string,
): Promise<AgentMutationOutcome<{ agentId: string; sourceAgentId: string }>> {
  const path = `/agents/${encodeURIComponent(agentId)}/duplicate`
  return dispatchAgentMutation({ version: 1, requests: [{ method: 'POST', path, body: { name } }] }, (baseRevision) =>
    duplicateAgentCommand({ baseRevision, agentId, name }),
  )
}

export function deleteAgent(agentId: string): Promise<AgentMutationOutcome<{ agentId: string }>> {
  const path = `/agents/${encodeURIComponent(agentId)}`
  return dispatchAgentMutation({ version: 1, requests: [{ method: 'DELETE', path, body: {} }] }, (baseRevision) =>
    deleteAgentCommand({ baseRevision, agentId }),
  )
}

export function reorderAgents(agentIds: string[]): Promise<AgentMutationOutcome<Record<string, never>>> {
  const attempted = [...agentIds]
  return dispatchAgentMutation(
    { version: 1, requests: [{ method: 'POST', path: '/agents/reorder', body: { agentIds: attempted } }] },
    (baseRevision) => reorderAgentsCommand({ baseRevision, agentIds: [...attempted] }),
  )
}

export function addAgentToPreset(
  presetId: string,
  use: AgentPresetUseSnapshot,
): Promise<AgentMutationOutcome<{ presetId: string; useId: string; agentId: string }>> {
  const attempted = safeStructuredClone(use)
  const path = `/agent-presets/${encodeURIComponent(presetId)}/uses`
  return dispatchAgentMutation(
    { version: 1, requests: [{ method: 'POST', path, body: { use: attempted } }] },
    (baseRevision) => createAgentPresetUseCommand({ baseRevision, presetId, use: safeStructuredClone(attempted) }),
  )
}

export function updateAgentPresetUse(
  presetId: string,
  useId: string,
  patch: AgentPresetUseSnapshot,
): Promise<AgentMutationOutcome<{ presetId: string; useId: string; agentId: string }>> {
  const attempted = safeStructuredClone(patch)
  const path = `/agent-presets/${encodeURIComponent(presetId)}/uses/${encodeURIComponent(useId)}`
  return dispatchAgentMutation(
    { version: 1, requests: [{ method: 'PATCH', path, body: { patch: attempted } }] },
    (baseRevision) =>
      updateAgentPresetUseCommand({ baseRevision, presetId, useId, patch: safeStructuredClone(attempted) }),
  )
}

export function removeAgentFromPreset(
  presetId: string,
  useId: string,
): Promise<AgentMutationOutcome<{ presetId: string; useId: string }>> {
  const path = `/agent-presets/${encodeURIComponent(presetId)}/uses/${encodeURIComponent(useId)}`
  return dispatchAgentMutation({ version: 1, requests: [{ method: 'DELETE', path, body: {} }] }, (baseRevision) =>
    deleteAgentPresetUseCommand({ baseRevision, presetId, useId }),
  )
}

export function reorderAgentPresetUses(
  presetId: string,
  useIds: string[],
): Promise<AgentMutationOutcome<{ presetId: string }>> {
  const attempted = [...useIds]
  const path = `/agent-presets/${encodeURIComponent(presetId)}/uses/reorder`
  return dispatchAgentMutation(
    { version: 1, requests: [{ method: 'POST', path, body: { useIds: attempted } }] },
    (baseRevision) => reorderAgentPresetUsesCommand({ baseRevision, presetId, useIds: [...attempted] }),
  )
}

export function defaultAgentPresetUse(agent: AgentRecord): Omit<AgentPresetUseRecord, 'id'> {
  return {
    agentId: agent.id,
    enabled: true,
    phase: 'beforeMain',
    dependencies: [],
    outputKey: sanitizeOutputKey(agent.name || agent.id),
    destination: 'promptOutput',
    failurePolicy: { mode: 'required' },
  }
}

async function dispatchAgentMutation<T extends Record<string, unknown>>(
  intent: DurableMutationIntent,
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
): Promise<AgentMutationOutcome<T>> {
  let outbox: ReturnType<typeof stagePendingMutation>
  try {
    outbox = stagePendingMutation(AGENT_CONFIGURATION_MUTATION_KEY, intent)
  } catch {
    return { status: 'failed', result: { status: 'unavailable' } }
  }

  let result: ServerCommandResult<T>
  try {
    result = await dispatchDurableMutation(outbox, intent, (transport) => runAgentCommand(command, transport))
  } catch {
    result = { status: 'unavailable' }
  }
  if (result.status === 'ok') return { status: 'accepted', result }
  try {
    return (await isPendingMutationCurrent(outbox))
      ? { status: 'queued', result, mutationId: outbox.mutationId }
      : { status: 'failed', result }
  } catch {
    return (await outbox.ready) === 'persisted'
      ? { status: 'queued', result, mutationId: outbox.mutationId }
      : { status: 'failed', result }
  }
}

function runAgentCommand<T extends Record<string, unknown>>(
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
  transport: ServerCommandTransportOptions,
): Promise<ServerCommandResult<T>> {
  return runServerCommand({ command, ...transport })
}

function sanitizeOutputKey(value: string): string {
  let candidate = value.trim().replace(/[^A-Za-z0-9_]/g, '_') || 'agent_output'
  if (!/^[A-Za-z_]/.test(candidate)) candidate = `agent_${candidate}`
  return candidate.slice(0, 64)
}
