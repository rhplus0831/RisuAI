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
  type AgentPresetPatchOptimisticAcknowledgement,
  type JsonFieldState,
  type ServerCommandResult,
} from './server/commands'
import {
  captureSettingsGroupProjectionEpoch,
  markSettingsGroupAcknowledgementTainted,
} from './server/resourceState.svelte'
import { withTrustedResourceWrite } from './server/resourceWriteGuard.svelte'
import { applyAttemptedFieldRollback } from './server/staleStateGuards'
import { getDatabase } from './storage/database.svelte'

type DatabaseRecord = Record<string, unknown>

interface AgentPresetCommandOptions {
  signal?: AbortSignal | null
}

export function getAgentPresets(): AgentPresetRecord[] {
  return Array.isArray(getDatabase().agentPresets) ? getDatabase().agentPresets : []
}

export function getAgentPresetById(presetId: string): AgentPresetRecord | undefined {
  return getAgentPresets().find((preset) => preset.id === presetId)
}

export function getAgentPresetDefaultId(): string | undefined {
  return typeof getDatabase().agentPresetDefaultId === 'string' ? getDatabase().agentPresetDefaultId : undefined
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
  const optimistic = optimisticallyPatchAgentPreset(presetId, patch)
  return runServerCommand({
    signal: options.signal,
    rollback: taintedAgentPresetRollback(optimistic.rollback),
    command: (baseRevision) =>
      updateAgentPresetCommand(
        {
          baseRevision,
          presetId,
          patch,
          optimisticAcknowledgement: optimistic.acknowledgement,
        },
        options.signal,
      ),
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
    rollback: taintedAgentPresetRollback(optimisticallyDeleteAgentPreset(presetId)),
    command: (baseRevision) => deleteAgentPresetCommand({ baseRevision, presetId }, options.signal),
  })
}

export function reorderAgentPresets(
  presetIds: string[],
  options: AgentPresetCommandOptions = {},
): Promise<ServerCommandResult<{ agentPresetDefaultId: string | null }>> {
  return runServerCommand({
    signal: options.signal,
    rollback: taintedAgentPresetRollback(optimisticallyReorderAgentPresets(presetIds)),
    command: (baseRevision) => reorderAgentPresetsCommand({ baseRevision, presetIds }, options.signal),
  })
}

export function setAgentPresetDefault(
  agentPresetId: string | null,
  options: AgentPresetCommandOptions = {},
): Promise<ServerCommandResult<{ agentPresetDefaultId: string | null }>> {
  return runServerCommand({
    signal: options.signal,
    rollback: taintedAgentPresetRollback(optimisticallySetAgentPresetDefault(agentPresetId)),
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
  const optimistic = optimisticallyPatchAgentPresetStep(presetId, stepId, patch)
  return runServerCommand({
    signal: options.signal,
    rollback: taintedAgentPresetRollback(optimistic.rollback),
    command: (baseRevision) =>
      updateAgentPresetStepCommand(
        {
          baseRevision,
          presetId,
          stepId,
          patch,
          optimisticAcknowledgement: optimistic.acknowledgement,
        },
        options.signal,
      ),
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
    rollback: taintedAgentPresetRollback(optimisticallyDeleteAgentPresetStep(presetId, stepId)),
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
    rollback: taintedAgentPresetRollback(optimisticallyReorderAgentPresetSteps(presetId, stepIds)),
    command: (baseRevision) => reorderAgentPresetStepsCommand({ baseRevision, presetId, stepIds }, options.signal),
  })
}

interface OptimisticAgentPresetFieldPatch {
  rollback?: () => void
  acknowledgement?: AgentPresetPatchOptimisticAcknowledgement
}

function optimisticallyPatchAgentPreset(presetId: string, patch: AgentPresetSnapshot): OptimisticAgentPresetFieldPatch {
  const projectionEpoch = captureSettingsGroupProjectionEpoch('agents')
  const preset = uniqueAgentPresetById(presetId)
  if (!preset) return {}
  return applyOptimisticAgentPresetFields(
    () => uniqueAgentPresetById(presetId) as unknown as DatabaseRecord | undefined,
    preset as unknown as DatabaseRecord,
    patch,
    projectionEpoch,
  )
}

function optimisticallyDeleteAgentPreset(presetId: string): (() => void) | undefined {
  return withAgentPresetRollback(['agentPresets', 'agentPresetDefaultId', 'characters', 'loadouts'], () => {
    const presets = getAgentPresets()
    const index = presets.findIndex((preset) => preset.id === presetId)
    if (index !== -1) presets.splice(index, 1)
    if (getDatabase().agentPresetDefaultId === presetId) {
      delete getDatabase().agentPresetDefaultId
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
    getDatabase().agentPresets = presetIds.map((id) => byId.get(id)!)
  })
}

function optimisticallySetAgentPresetDefault(agentPresetId: string | null): (() => void) | undefined {
  return withAgentPresetRollback(['agentPresetDefaultId'], () => {
    if (agentPresetId) {
      getDatabase().agentPresetDefaultId = agentPresetId
    } else {
      delete getDatabase().agentPresetDefaultId
    }
  })
}

function optimisticallyPatchAgentPresetStep(
  presetId: string,
  stepId: string,
  patch: AgentPresetStepSnapshot,
): OptimisticAgentPresetFieldPatch {
  const projectionEpoch = captureSettingsGroupProjectionEpoch('agents')
  const step = uniqueAgentPresetStepById(presetId, stepId)
  if (!step) return {}
  return applyOptimisticAgentPresetFields(
    () => uniqueAgentPresetStepById(presetId, stepId) as unknown as DatabaseRecord | undefined,
    step as unknown as DatabaseRecord,
    patch,
    projectionEpoch,
  )
}

function applyOptimisticAgentPresetFields(
  resolveTarget: () => DatabaseRecord | undefined,
  target: DatabaseRecord,
  patch: Record<string, unknown>,
  settingsProjectionEpoch: number,
): OptimisticAgentPresetFieldPatch {
  const keys = Object.keys(patch).filter((key) => key !== 'id')
  const previous = snapshotKeys(target, keys)
  withTrustedResourceWrite(() => {
    for (const key of keys) target[key] = patch[key]
  })
  const attempted = snapshotKeys(target, keys)
  const attemptedFields = snapshotJsonFieldStates(target, keys)
  return {
    acknowledgement:
      keys.length > 0
        ? {
            settingsProjectionEpoch,
            attemptedFields,
          }
        : undefined,
    rollback: () => {
      const liveTarget = resolveTarget()
      if (!liveTarget) return
      withTrustedResourceWrite(() => {
        applyAttemptedFieldRollback({
          target: liveTarget,
          previous,
          attempted,
          keys,
          deleteMissingPrevious: true,
        })
      })
    },
  }
}

function snapshotJsonFieldStates(target: DatabaseRecord, keys: readonly string[]): Record<string, JsonFieldState> {
  const fields: Record<string, JsonFieldState> = {}
  for (const key of keys) {
    fields[key] = Object.prototype.hasOwnProperty.call(target, key)
      ? { present: true, value: safeStructuredClone(target[key]) }
      : { present: false }
  }
  return fields
}

function uniqueAgentPresetById(presetId: string): AgentPresetRecord | undefined {
  const matches = getAgentPresets().filter((preset) => preset.id === presetId)
  return matches.length === 1 ? matches[0] : undefined
}

function uniqueAgentPresetStepById(presetId: string, stepId: string): AgentPresetStepRecord | undefined {
  const preset = uniqueAgentPresetById(presetId)
  if (!preset) return undefined
  const matches = preset.steps.filter((step) => step.id === stepId)
  return matches.length === 1 ? matches[0] : undefined
}

function taintedAgentPresetRollback(rollback?: () => void): () => void {
  return () => {
    markSettingsGroupAcknowledgementTainted('agents')
    rollback?.()
  }
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
  const target = getDatabase() as unknown as DatabaseRecord
  const previous = snapshotKeys(target, keys)
  withTrustedResourceWrite(mutate)
  const attempted = snapshotKeys(target, keys)
  return () => {
    withTrustedResourceWrite(() => {
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
  for (const character of getDatabase().characters ?? []) {
    const chats = Array.isArray(character?.chats) ? character.chats : []
    for (const chat of chats) {
      if (chat.generationSettings?.agentPresetId === presetId) {
        delete chat.generationSettings.agentPresetId
      }
    }
  }
}

function clearLoadoutAgentPresetSelections(presetId: string): void {
  for (const loadout of getDatabase().loadouts ?? []) {
    if (loadout.agentPresetId !== presetId) continue
    delete loadout.agentPresetId
    delete loadout.agentPresetName
  }
}
