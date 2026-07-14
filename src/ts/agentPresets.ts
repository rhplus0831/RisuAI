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
  type AgentPresetCollectionOptimisticAcknowledgement,
  type JsonFieldState,
  type ServerCommandResult,
} from './server/commands'
import {
  captureCharacterRowProjectionEpoch,
  captureCollectionProjectionEpoch,
  captureSettingsGroupProjectionEpoch,
  hasCharacterRowProjectionEpochChanged,
  hasCollectionProjectionEpochChanged,
  hasSettingsGroupProjectionEpochChanged,
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
  const settingsProjectionEpoch = captureSettingsGroupProjectionEpoch('agents')
  const rollback = optimisticallyReorderAgentPresets(presetIds)
  const optimisticAcknowledgement = currentAgentPresetCollectionAcknowledgement(settingsProjectionEpoch, {
    presetIds,
  })
  return runServerCommand({
    signal: options.signal,
    rollback: taintedAgentPresetRollback(rollback),
    command: (baseRevision) =>
      reorderAgentPresetsCommand(
        {
          baseRevision,
          presetIds,
          ...(optimisticAcknowledgement ? { optimisticAcknowledgement } : {}),
        },
        options.signal,
      ),
  })
}

export function setAgentPresetDefault(
  agentPresetId: string | null,
  options: AgentPresetCommandOptions = {},
): Promise<ServerCommandResult<{ agentPresetDefaultId: string | null }>> {
  const settingsProjectionEpoch = captureSettingsGroupProjectionEpoch('agents')
  const rollback = optimisticallySetAgentPresetDefault(agentPresetId)
  const optimisticAcknowledgement = currentAgentPresetCollectionAcknowledgement(settingsProjectionEpoch, {
    agentPresetDefaultId: agentPresetId,
  })
  return runServerCommand({
    signal: options.signal,
    rollback: taintedAgentPresetRollback(rollback),
    command: (baseRevision) =>
      setAgentPresetDefaultCommand(
        {
          baseRevision,
          agentPresetId,
          ...(optimisticAcknowledgement ? { optimisticAcknowledgement } : {}),
        },
        options.signal,
      ),
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

function currentAgentPresetCollectionAcknowledgement(
  settingsProjectionEpoch: number,
  expected: { presetIds: string[] } | { agentPresetDefaultId: string | null },
): AgentPresetCollectionOptimisticAcknowledgement | undefined {
  const presetIds = getAgentPresets().map((preset) => preset.id)
  if (presetIds.some((presetId) => !nonBlankId(presetId)) || new Set(presetIds).size !== presetIds.length) {
    return undefined
  }
  const agentPresetDefaultId = getAgentPresetDefaultId() ?? null
  if (agentPresetDefaultId !== null && !presetIds.includes(agentPresetDefaultId)) return undefined
  if (
    'presetIds' in expected &&
    (presetIds.length !== expected.presetIds.length ||
      presetIds.some((presetId, index) => presetId !== expected.presetIds[index]))
  ) {
    return undefined
  }
  if ('agentPresetDefaultId' in expected && agentPresetDefaultId !== expected.agentPresetDefaultId) return undefined
  return {
    settingsProjectionEpoch,
    presetIds: [...presetIds],
    agentPresetDefaultId,
  }
}

interface AgentPresetDeleteFieldRollback {
  keys: string[]
  previous: Record<string, JsonFieldState>
  attempted: Record<string, JsonFieldState>
  resolveTarget: () => DatabaseRecord | undefined
  hasProjectionChanged: () => boolean
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
  const preset = uniqueAgentPresetById(presetId)
  if (!preset) return undefined
  const presetRollback = withAgentPresetRollback(['agentPresets'], () => {
    const presets = getAgentPresets()
    const index = presets.indexOf(preset)
    if (index !== -1) presets.splice(index, 1)
  })
  const referenceRollbacks = withTrustedResourceWrite(() => {
    const rollbacks: AgentPresetDeleteFieldRollback[] = []
    const database = getDatabase() as unknown as DatabaseRecord
    if (getDatabase().agentPresetDefaultId === presetId) {
      const projectionEpoch = captureSettingsGroupProjectionEpoch('agents')
      rollbacks.push(
        captureAgentPresetDeleteFieldRollback({
          target: database,
          resolveTarget: () => getDatabase() as unknown as DatabaseRecord,
          keys: ['agentPresetDefaultId'],
          mutate: () => delete getDatabase().agentPresetDefaultId,
          hasProjectionChanged: () => hasSettingsGroupProjectionEpochChanged('agents', projectionEpoch),
        }),
      )
    }
    rollbacks.push(...clearChatAgentPresetSelections(presetId), ...clearLoadoutAgentPresetSelections(presetId))
    return rollbacks
  })

  return () => {
    presetRollback?.()
    // Never restore references to a preset whose whole-row rollback was
    // superseded by a later edit. The agents taint forces authoritative
    // reconciliation before a later local acknowledgement can fence it.
    if (!uniqueAgentPresetById(presetId)) return
    withTrustedResourceWrite(() => {
      for (const rollback of referenceRollbacks) restoreAgentPresetDeleteFields(rollback)
    })
  }
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

function clearChatAgentPresetSelections(presetId: string): AgentPresetDeleteFieldRollback[] {
  const rollbacks: AgentPresetDeleteFieldRollback[] = []
  for (const character of getDatabase().characters ?? []) {
    const characterId = nonBlankId(character?.chaId)
    if (!characterId) continue
    const projectionEpoch = captureCharacterRowProjectionEpoch(characterId)
    const chats = Array.isArray(character?.chats) ? character.chats : []
    for (const chat of chats) {
      const chatId = nonBlankId(chat?.id)
      const generationSettings = chat?.generationSettings as unknown
      if (
        !chatId ||
        !isDatabaseRecord(generationSettings) ||
        generationSettings.agentPresetId !== presetId ||
        resolveUniqueChatGenerationSettings(characterId, chatId) !== generationSettings
      ) {
        continue
      }
      rollbacks.push(
        captureAgentPresetDeleteFieldRollback({
          target: generationSettings,
          resolveTarget: () => resolveUniqueChatGenerationSettings(characterId, chatId),
          keys: ['agentPresetId'],
          mutate: () => delete generationSettings.agentPresetId,
          hasProjectionChanged: () => hasCharacterRowProjectionEpochChanged(characterId, projectionEpoch),
        }),
      )
    }
  }
  return rollbacks
}

function clearLoadoutAgentPresetSelections(presetId: string): AgentPresetDeleteFieldRollback[] {
  const rollbacks: AgentPresetDeleteFieldRollback[] = []
  const projectionEpoch = captureCollectionProjectionEpoch('loadouts')
  for (const loadout of getDatabase().loadouts ?? []) {
    const loadoutId = nonBlankId(loadout?.id)
    const target = loadout as unknown as DatabaseRecord
    if (!loadoutId || target.agentPresetId !== presetId || resolveUniqueLoadout(loadoutId) !== target) {
      continue
    }
    rollbacks.push(
      captureAgentPresetDeleteFieldRollback({
        target,
        resolveTarget: () => resolveUniqueLoadout(loadoutId),
        keys: ['agentPresetId', 'agentPresetName'],
        mutate: () => {
          delete target.agentPresetId
          delete target.agentPresetName
        },
        hasProjectionChanged: () => hasCollectionProjectionEpochChanged('loadouts', projectionEpoch),
      }),
    )
  }
  return rollbacks
}

function captureAgentPresetDeleteFieldRollback(input: {
  target: DatabaseRecord
  resolveTarget: () => DatabaseRecord | undefined
  keys: string[]
  mutate: () => void
  hasProjectionChanged: () => boolean
}): AgentPresetDeleteFieldRollback {
  const previous = snapshotAgentPresetDeleteFieldStates(input.target, input.keys)
  input.mutate()
  return {
    keys: input.keys,
    previous,
    attempted: snapshotAgentPresetDeleteFieldStates(input.target, input.keys),
    resolveTarget: input.resolveTarget,
    hasProjectionChanged: input.hasProjectionChanged,
  }
}

function restoreAgentPresetDeleteFields(rollback: AgentPresetDeleteFieldRollback): void {
  if (rollback.hasProjectionChanged()) return
  const target = rollback.resolveTarget()
  if (!target) return
  // Treat related loadout id/name fields atomically. A later edit to either
  // field supersedes this rollback and must not be partially overwritten.
  if (rollback.keys.some((key) => !jsonFieldStateMatches(target, key, rollback.attempted[key]))) return
  for (const key of rollback.keys) {
    const previous = rollback.previous[key]
    if (previous.present) target[key] = safeStructuredClone(previous.value)
    else delete target[key]
  }
}

function jsonFieldStateMatches(target: DatabaseRecord, key: string, expected: JsonFieldState): boolean {
  const present = Object.prototype.hasOwnProperty.call(target, key)
  if (!expected.present) return !present || target[key] === undefined
  return present && JSON.stringify(target[key]) === JSON.stringify(expected.value)
}

function snapshotAgentPresetDeleteFieldStates(
  target: DatabaseRecord,
  keys: readonly string[],
): Record<string, JsonFieldState> {
  const fields: Record<string, JsonFieldState> = {}
  for (const key of keys) {
    const value = target[key]
    fields[key] =
      Object.prototype.hasOwnProperty.call(target, key) && value !== undefined
        ? { present: true, value: safeStructuredClone(value) }
        : { present: false }
  }
  return fields
}

function resolveUniqueChatGenerationSettings(characterId: string, chatId: string): DatabaseRecord | undefined {
  const characters = (getDatabase().characters ?? []).filter((character) => character?.chaId === characterId)
  if (characters.length !== 1) return undefined
  const chats = (characters[0].chats ?? []).filter((chat) => chat?.id === chatId)
  if (chats.length !== 1 || !isDatabaseRecord(chats[0].generationSettings)) return undefined
  return chats[0].generationSettings as unknown as DatabaseRecord
}

function resolveUniqueLoadout(loadoutId: string): DatabaseRecord | undefined {
  const loadouts = (getDatabase().loadouts ?? []).filter((loadout) => loadout?.id === loadoutId)
  return loadouts.length === 1 ? (loadouts[0] as unknown as DatabaseRecord) : undefined
}

function isDatabaseRecord(value: unknown): value is DatabaseRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function nonBlankId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}
