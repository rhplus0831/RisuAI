import type { AgentPresetRecord, AgentPresetStepRecord } from './agentPresetRecords'
import { safeStructuredClone } from './polyfill'
import {
  createAgentPresetCommand,
  createAgentPresetStepCommand,
  deleteAgentPresetCommand,
  deleteAgentPresetStepCommand,
  duplicateAgentPresetCommand,
  duplicateAgentPresetStepCommand,
  reorderAgentPresetsCommand,
  reorderAgentPresetStepsCommand,
  runServerCommand,
  setAgentPresetDefaultCommand,
  updateAgentPresetCommand,
  updateAgentPresetStepCommand,
  type AgentPresetSnapshot,
  type AgentPresetStepSnapshot,
  type ServerCommandResult,
} from './server/commands'
import { withTrustedServerProjectionWrite } from './server/projectionWriteGuard.svelte'
import { applyAttemptedFieldRollback } from './server/staleStateGuards'
import { DBState } from './stores.svelte'

type DatabaseRecord = Record<string, unknown>

interface AgentPresetCommandOptions {
  signal?: AbortSignal | null
}

export function getAgentPresets(): AgentPresetRecord[] {
  return Array.isArray(DBState.db.agentPresets) ? DBState.db.agentPresets : []
}

export function getAgentPresetById(presetId: string): AgentPresetRecord | undefined {
  return getAgentPresets().find((preset) => preset.id === presetId)
}

export function getAgentPresetDefaultId(): string | undefined {
  return typeof DBState.db.agentPresetDefaultId === 'string' ? DBState.db.agentPresetDefaultId : undefined
}

export function createAgentPreset(
  preset: AgentPresetSnapshot,
  options: AgentPresetCommandOptions = {},
): Promise<ServerCommandResult<{ presetId: string }>> {
  return runServerCommand({
    signal: options.signal,
    command: (baseRevision) => createAgentPresetCommand({ baseRevision, preset }, options.signal),
  })
}

export function updateAgentPreset(
  presetId: string,
  patch: AgentPresetSnapshot,
  options: AgentPresetCommandOptions = {},
): Promise<ServerCommandResult<{ presetId: string }>> {
  return runServerCommand({
    signal: options.signal,
    rollback: optimisticallyPatchAgentPreset(presetId, patch),
    command: (baseRevision) => updateAgentPresetCommand({ baseRevision, presetId, patch }, options.signal),
  })
}

export function duplicateAgentPreset(
  presetId: string,
  options: AgentPresetCommandOptions & { name?: string } = {},
): Promise<ServerCommandResult<{ presetId: string; sourcePresetId: string }>> {
  return runServerCommand({
    signal: options.signal,
    command: (baseRevision) =>
      duplicateAgentPresetCommand({ baseRevision, presetId, name: options.name }, options.signal),
  })
}

export function deleteAgentPreset(
  presetId: string,
  options: AgentPresetCommandOptions = {},
): Promise<
  ServerCommandResult<{
    presetId: string
    clearedDefault: boolean
    clearedChatCount: number
    clearedLoadoutCount: number
  }>
> {
  return runServerCommand({
    signal: options.signal,
    rollback: optimisticallyDeleteAgentPreset(presetId),
    command: (baseRevision) => deleteAgentPresetCommand({ baseRevision, presetId }, options.signal),
  })
}

export function reorderAgentPresets(
  presetIds: string[],
  options: AgentPresetCommandOptions = {},
): Promise<ServerCommandResult<{ agentPresetDefaultId: string | null }>> {
  return runServerCommand({
    signal: options.signal,
    rollback: optimisticallyReorderAgentPresets(presetIds),
    command: (baseRevision) => reorderAgentPresetsCommand({ baseRevision, presetIds }, options.signal),
  })
}

export function setAgentPresetDefault(
  agentPresetId: string | null,
  options: AgentPresetCommandOptions = {},
): Promise<ServerCommandResult<{ agentPresetDefaultId: string | null }>> {
  return runServerCommand({
    signal: options.signal,
    rollback: optimisticallySetAgentPresetDefault(agentPresetId),
    command: (baseRevision) => setAgentPresetDefaultCommand({ baseRevision, agentPresetId }, options.signal),
  })
}

export function createAgentPresetStep(
  presetId: string,
  step: AgentPresetStepSnapshot,
  options: AgentPresetCommandOptions = {},
): Promise<ServerCommandResult<{ presetId: string; stepId: string }>> {
  return runServerCommand({
    signal: options.signal,
    command: (baseRevision) => createAgentPresetStepCommand({ baseRevision, presetId, step }, options.signal),
  })
}

export function updateAgentPresetStep(
  presetId: string,
  stepId: string,
  patch: AgentPresetStepSnapshot,
  options: AgentPresetCommandOptions = {},
): Promise<ServerCommandResult<{ presetId: string; stepId: string }>> {
  return runServerCommand({
    signal: options.signal,
    rollback: optimisticallyPatchAgentPresetStep(presetId, stepId, patch),
    command: (baseRevision) => updateAgentPresetStepCommand({ baseRevision, presetId, stepId, patch }, options.signal),
  })
}

export function duplicateAgentPresetStep(
  presetId: string,
  stepId: string,
  options: AgentPresetCommandOptions & { name?: string } = {},
): Promise<ServerCommandResult<{ presetId: string; stepId: string; sourceStepId: string }>> {
  return runServerCommand({
    signal: options.signal,
    command: (baseRevision) =>
      duplicateAgentPresetStepCommand({ baseRevision, presetId, stepId, name: options.name }, options.signal),
  })
}

export function deleteAgentPresetStep(
  presetId: string,
  stepId: string,
  options: AgentPresetCommandOptions = {},
): Promise<ServerCommandResult<{ presetId: string; stepId: string }>> {
  return runServerCommand({
    signal: options.signal,
    rollback: optimisticallyDeleteAgentPresetStep(presetId, stepId),
    command: (baseRevision) => deleteAgentPresetStepCommand({ baseRevision, presetId, stepId }, options.signal),
  })
}

export function reorderAgentPresetSteps(
  presetId: string,
  stepIds: string[],
  options: AgentPresetCommandOptions = {},
): Promise<ServerCommandResult<{ presetId: string }>> {
  return runServerCommand({
    signal: options.signal,
    rollback: optimisticallyReorderAgentPresetSteps(presetId, stepIds),
    command: (baseRevision) => reorderAgentPresetStepsCommand({ baseRevision, presetId, stepIds }, options.signal),
  })
}

function optimisticallyPatchAgentPreset(presetId: string, patch: AgentPresetSnapshot): (() => void) | undefined {
  return withAgentPresetRollback(['agentPresets'], () => {
    const preset = getAgentPresetById(presetId)
    if (!preset) return
    Object.assign(preset, patch, { id: presetId })
  })
}

function optimisticallyDeleteAgentPreset(presetId: string): (() => void) | undefined {
  return withAgentPresetRollback(['agentPresets', 'agentPresetDefaultId', 'characters', 'loadouts'], () => {
    const presets = getAgentPresets()
    const index = presets.findIndex((preset) => preset.id === presetId)
    if (index !== -1) presets.splice(index, 1)
    if (DBState.db.agentPresetDefaultId === presetId) {
      delete DBState.db.agentPresetDefaultId
    }
    clearChatAgentPresetSelections(presetId)
    clearLoadoutAgentPresetSelections(presetId)
  })
}

function optimisticallyReorderAgentPresets(presetIds: string[]): (() => void) | undefined {
  return withAgentPresetRollback(['agentPresets'], () => {
    const presets = getAgentPresets()
    const byId = new Map(presets.map((preset) => [preset.id, preset]))
    if (presetIds.length !== presets.length || presetIds.some((id) => !byId.has(id))) return
    DBState.db.agentPresets = presetIds.map((id) => byId.get(id)!)
  })
}

function optimisticallySetAgentPresetDefault(agentPresetId: string | null): (() => void) | undefined {
  return withAgentPresetRollback(['agentPresetDefaultId'], () => {
    if (agentPresetId) {
      DBState.db.agentPresetDefaultId = agentPresetId
    } else {
      delete DBState.db.agentPresetDefaultId
    }
  })
}

function optimisticallyPatchAgentPresetStep(
  presetId: string,
  stepId: string,
  patch: AgentPresetStepSnapshot,
): (() => void) | undefined {
  return withAgentPresetRollback(['agentPresets'], () => {
    const step = getAgentPresetById(presetId)?.steps.find((candidate) => candidate.id === stepId)
    if (!step) return
    Object.assign(step, patch, { id: stepId })
  })
}

function optimisticallyDeleteAgentPresetStep(presetId: string, stepId: string): (() => void) | undefined {
  return withAgentPresetRollback(['agentPresets'], () => {
    const preset = getAgentPresetById(presetId)
    if (!preset) return
    const index = preset.steps.findIndex((step) => step.id === stepId)
    if (index !== -1) preset.steps.splice(index, 1)
    for (const step of preset.steps) {
      step.dependencies = step.dependencies.filter((dependencyId) => dependencyId !== stepId)
    }
  })
}

function optimisticallyReorderAgentPresetSteps(presetId: string, stepIds: string[]): (() => void) | undefined {
  return withAgentPresetRollback(['agentPresets'], () => {
    const preset = getAgentPresetById(presetId)
    if (!preset) return
    const byId = new Map(preset.steps.map((step) => [step.id, step]))
    if (stepIds.length !== preset.steps.length || stepIds.some((id) => !byId.has(id))) return
    preset.steps = stepIds.map((id) => byId.get(id)!)
  })
}

function withAgentPresetRollback(keys: string[], mutate: () => void): (() => void) | undefined {
  const target = DBState.db as unknown as DatabaseRecord
  const previous = snapshotKeys(target, keys)
  withTrustedServerProjectionWrite(mutate)
  const attempted = snapshotKeys(target, keys)
  return () => {
    withTrustedServerProjectionWrite(() => {
      applyAttemptedFieldRollback({
        target,
        previous,
        attempted,
        keys,
        deleteMissingPrevious: true,
      })
    })
  }
}

function snapshotKeys(target: DatabaseRecord, keys: readonly string[]): Partial<DatabaseRecord> {
  const snapshot: Partial<DatabaseRecord> = {}
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(target, key)) {
      snapshot[key] = safeStructuredClone(target[key])
    }
  }
  return snapshot
}

function clearChatAgentPresetSelections(presetId: string): void {
  for (const character of DBState.db.characters ?? []) {
    const chats = Array.isArray(character?.chats) ? character.chats : []
    for (const chat of chats) {
      if (chat.generationSettings?.agentPresetId === presetId) {
        delete chat.generationSettings.agentPresetId
      }
    }
  }
}

function clearLoadoutAgentPresetSelections(presetId: string): void {
  for (const loadout of DBState.db.loadouts ?? []) {
    if (loadout.agentPresetId !== presetId) continue
    delete loadout.agentPresetId
    delete loadout.agentPresetName
  }
}
