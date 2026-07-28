import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { isDeepStrictEqual } from 'node:util'
import {
  AGENT_PRESET_SCHEMA_VERSION,
  AGENT_SCHEMA_VERSION,
  AGENT_PRESET_MAX_CONCURRENCY_MAX,
  AGENT_PRESET_MAX_CONCURRENCY_MIN,
  AGENT_PRESET_STEP_DESTINATIONS,
  AGENT_PRESET_STEP_INPUT_SCOPES,
  AGENT_PRESET_STEP_OUTPUT_FORMATS,
  AGENT_PRESET_STEP_PHASES,
  isValidAgentPresetOutputKey,
  normalizeAgentConfiguration,
  normalizeAgents,
  normalizeAgentPresetDefaultId,
  normalizeAgentPresets,
  resolveAgentPresetSteps,
  validateAgentRecord,
  validateAgentRecords,
  validateAgentPresetRecord,
  validateAgentPresetRecords,
  type AgentRecord,
  type AgentPresetRecord,
  type AgentPresetUseRecord,
  type AgentPresetStepDestination,
  type AgentPresetStepFailurePolicy,
  type AgentPresetStepInputScope,
  type AgentPresetStepModelSelection,
  type AgentPresetStepOutputFormat,
  type AgentPresetStepPhase,
  type AgentPresetStepRecord,
} from '../../../../src/ts/agentPresetRecords.js'
import { EntityNotFoundError, extractSettings, ValidationError, writeSettingsOnly } from '../repository.js'
import {
  applyMessageFreeJsonCommandMutation,
  applyTargetedCommandMutation,
  TARGETED_MUTATION_PATHS,
  type CommandMutationReceiptKey,
  type JsonCommandMutationResult,
} from './mutations.js'
import {
  COMMAND_EVENT_CATALOG,
  type CommandEventDraft,
  type CommandEventOrigin,
  type CommandEventSink,
} from './events.js'
import { ensureLoadoutCollection } from './loadouts.js'
import { normalizeAllCharacterChats } from './chats.js'

interface AgentPresetCommandArgs {
  db: DatabaseSync
  dataDir: string
  baseRevision: number
  eventSink: CommandEventSink
  eventOrigin?: CommandEventOrigin
  mutationReceiptKey?: CommandMutationReceiptKey
  body: unknown
}

type AgentPresetMutationExtra = Record<string, unknown>

interface AgentPresetPatchAcknowledgement extends Record<string, unknown> {
  acknowledgedKeys: string[]
  canonicalValues: Record<string, unknown>
  canonicalDeletedKeys: string[]
  updatedAt?: number
}

interface AgentPresetCollectionAcknowledgement extends Record<string, unknown> {
  certificate: typeof AGENT_PRESET_COLLECTION_ACKNOWLEDGEMENT_CERTIFICATE
  agentPresetIds: string[]
}

interface AgentPresetCollectionMutationExtra extends Record<string, unknown> {
  agentPresetDefaultId: string | null
  certificate?: typeof AGENT_PRESET_COLLECTION_ACKNOWLEDGEMENT_CERTIFICATE
  agentPresetIds?: string[]
}

interface CanonicalAgentPresetState {
  agents: AgentRecord[]
  presets: AgentPresetRecord[]
  defaultId: string | undefined
  acknowledgementSafe: boolean
}

const AGENT_PRESET_PHASE_SET = new Set<string>(AGENT_PRESET_STEP_PHASES)
const AGENT_PRESET_OUTPUT_FORMAT_SET = new Set<string>(AGENT_PRESET_STEP_OUTPUT_FORMATS)
const AGENT_PRESET_INPUT_SCOPE_SET = new Set<string>(AGENT_PRESET_STEP_INPUT_SCOPES)
const AGENT_PRESET_DESTINATION_SET = new Set<string>(AGENT_PRESET_STEP_DESTINATIONS)
const AGENT_PRESET_COLLECTION_ACKNOWLEDGEMENT_CERTIFICATE = 'agent-preset-collection-v1'

export function createAgentPresetCommand(
  args: AgentPresetCommandArgs,
): JsonCommandMutationResult<{ presetId: string }> {
  const body = readObject(args.body, 'request body')
  const source = readObject(body.preset, 'preset')
  if (hasOwn(source, 'id')) {
    throw new ValidationError('preset.id is server-generated')
  }

  return applyAgentPresetSettingsMutation(args, (target) => {
    const configuration = currentAgentConfiguration(target)
    const { agents, presets } = configuration
    const presetId = mintAgentPresetId(new Set(presets.map((preset) => preset.id)))
    const now = Date.now()
    const preset = readPresetRecord(
      {
        name: 'New Agent Preset',
        enabled: true,
        version: AGENT_PRESET_SCHEMA_VERSION,
        agentUses: [],
        steps: [],
        createdAt: now,
        updatedAt: now,
        ...source,
        id: presetId,
      },
      'preset',
      agents,
    )
    if (presets.some((candidate) => candidate.id === preset.id)) {
      throw new ValidationError(`Duplicate Agent Preset id: ${preset.id}`)
    }
    target.agentPresets = readPresetCollectionForWrite([...presets, preset], agents)
    normalizeAgentPresetDefault(target)
    return {
      event: { ...COMMAND_EVENT_CATALOG.agentPresetCreated, id: presetId },
      extra: { presetId },
    }
  })
}

export function updateAgentPresetCommand(
  args: AgentPresetCommandArgs & { presetId: string },
): JsonCommandMutationResult<{ presetId: string } & AgentPresetPatchAcknowledgement> {
  const presetId = readNonEmptyString(args.presetId, 'presetId')
  const body = readObject(args.body, 'request body')
  const patch = readPresetMetadataPatch(body.patch)

  return applyAgentPresetSettingsMutation(args, (target) => {
    const before = readCanonicalAgentPresetState(target)
    const presets = before.presets
    const index = requireAgentPresetIndex(presets, presetId)
    const next = applyPresetMetadataPatch(presets[index], patch, before.agents)
    const nextPresets = [...presets]
    nextPresets[index] = next
    target.agentPresets = readPresetCollectionForWrite(nextPresets, before.agents)
    normalizeAgentPresetDefault(target)
    const after = readCanonicalAgentPresetState(target)
    const finalPreset = after.presets[requireAgentPresetIndex(after.presets, presetId)]
    const acknowledgementSafe =
      before.acknowledgementSafe &&
      after.acknowledgementSafe &&
      before.defaultId === after.defaultId &&
      isExpectedMetadataPatch(before.presets, after.presets, presetId, Object.keys(patch))
    return {
      event: { ...COMMAND_EVENT_CATALOG.agentPresetUpdated, id: presetId },
      extra: {
        presetId,
        ...buildAgentPresetPatchAcknowledgement(patch, finalPreset, acknowledgementSafe),
      },
    }
  })
}

export function duplicateAgentPresetCommand(
  args: AgentPresetCommandArgs & { presetId: string },
): JsonCommandMutationResult<{ presetId: string; sourcePresetId: string }> {
  const sourcePresetId = readNonEmptyString(args.presetId, 'presetId')
  const body = readObject(args.body, 'request body')
  const name = readOptionalNonEmptyString(body.name, 'name')

  return applyAgentPresetSettingsMutation(args, (target) => {
    const { agents, presets } = currentAgentConfiguration(target)
    const source = presets[requireAgentPresetIndex(presets, sourcePresetId)]
    const usedPresetIds = new Set(presets.map((preset) => preset.id))
    const usedStepIds = new Set(presets.flatMap((preset) => (preset.agentUses ?? []).map((use) => use.id)))
    const presetId = mintAgentPresetId(usedPresetIds)
    const duplicated = duplicatePresetRecord(source, presetId, usedStepIds, name, agents)
    target.agentPresets = readPresetCollectionForWrite([...presets, duplicated], agents)
    normalizeAgentPresetDefault(target)
    return {
      event: { ...COMMAND_EVENT_CATALOG.agentPresetDuplicated, id: presetId, parentId: sourcePresetId },
      extra: { presetId, sourcePresetId },
    }
  })
}

export function deleteAgentPresetCommand(
  args: AgentPresetCommandArgs & { presetId: string },
): JsonCommandMutationResult<{
  presetId: string
  clearedDefault: boolean
  clearedChatCount: number
  clearedLoadoutCount: number
}> {
  const presetId = readNonEmptyString(args.presetId, 'presetId')

  return applyMessageFreeJsonCommandMutation({
    db: args.db,
    dataDir: args.dataDir,
    baseRevision: args.baseRevision,
    eventSink: args.eventSink,
    ...(args.eventOrigin ? { eventOrigin: args.eventOrigin } : {}),
    ...(args.mutationReceiptKey ? { mutationReceiptKey: args.mutationReceiptKey } : {}),
    mutate(database) {
      const target = readDatabaseTarget(database)
      const { agents, presets } = currentAgentConfiguration(target)
      const index = requireAgentPresetIndex(presets, presetId)
      presets.splice(index, 1)
      target.agentPresets = readPresetCollectionForWrite(presets, agents)
      const clearedDefault = target.agentPresetDefaultId === presetId
      normalizeAgentPresetDefault(target)
      const clearedChatCount = clearChatAgentPresetSelections(target, presetId)
      const clearedLoadoutCount = clearLoadoutAgentPresetSelections(target, presetId)
      return {
        event: { ...COMMAND_EVENT_CATALOG.agentPresetDeleted, id: presetId },
        extra: { presetId, clearedDefault, clearedChatCount, clearedLoadoutCount },
      }
    },
  })
}

export function reorderAgentPresetsCommand(
  args: AgentPresetCommandArgs,
): JsonCommandMutationResult<AgentPresetCollectionMutationExtra> {
  const body = readObject(args.body, 'request body')
  const presetIds = readIdList(body.presetIds, 'presetIds')

  return applyAgentPresetSettingsMutation(args, (target) => {
    const before = readCanonicalAgentPresetState(target)
    const presets = before.presets
    validateFullPresetOrder(presets, presetIds)
    const byId = new Map(presets.map((preset) => [preset.id, preset]))
    target.agentPresets = readPresetCollectionForWrite(
      presetIds.map((id) => byId.get(id)!),
      before.agents,
    )
    normalizeAgentPresetDefault(target)
    const after = readCanonicalAgentPresetState(target)
    const acknowledgementSafe =
      before.acknowledgementSafe &&
      after.acknowledgementSafe &&
      before.defaultId === after.defaultId &&
      presetIds.every((presetId, index) => isDeepStrictEqual(after.presets[index], byId.get(presetId)))
    return {
      event: COMMAND_EVENT_CATALOG.agentPresetReordered,
      extra: {
        agentPresetDefaultId: after.defaultId ?? null,
        ...buildAgentPresetCollectionAcknowledgement(after, acknowledgementSafe),
      },
    }
  })
}

export function setAgentPresetDefaultCommand(
  args: AgentPresetCommandArgs,
): JsonCommandMutationResult<AgentPresetCollectionMutationExtra> {
  const body = readObject(args.body, 'request body')
  const rawId = body.agentPresetId ?? body.presetId
  const requestedId = rawId === null ? '' : (readOptionalString(rawId, 'agentPresetId') ?? '')

  return applyAgentPresetSettingsMutation(args, (target) => {
    const before = readCanonicalAgentPresetState(target)
    const presets = before.presets
    if (requestedId.trim() === '') {
      delete target.agentPresetDefaultId
    } else {
      requireAgentPresetIndex(presets, requestedId)
      target.agentPresetDefaultId = requestedId
    }
    normalizeAgentPresetDefault(target)
    const after = readCanonicalAgentPresetState(target)
    const expectedDefaultId = requestedId.trim() === '' ? undefined : requestedId
    const acknowledgementSafe =
      before.acknowledgementSafe &&
      after.acknowledgementSafe &&
      after.defaultId === expectedDefaultId &&
      isDeepStrictEqual(before.presets, after.presets)
    return {
      event: {
        ...COMMAND_EVENT_CATALOG.agentPresetDefaultUpdated,
        ...(after.defaultId ? { id: after.defaultId } : {}),
      },
      extra: {
        agentPresetDefaultId: after.defaultId ?? null,
        ...buildAgentPresetCollectionAcknowledgement(after, acknowledgementSafe),
      },
    }
  })
}

export function createAgentCommand(args: AgentPresetCommandArgs): JsonCommandMutationResult<{ agentId: string }> {
  const body = readObject(args.body, 'request body')
  const source = readObject(body.agent, 'agent')
  if (hasOwn(source, 'id')) throw new ValidationError('agent.id is server-generated')
  validateAgentFields(source, 'agent', false)

  return applyAgentPresetSettingsMutation(args, (target) => {
    const { agents } = currentAgentConfiguration(target)
    const agentId = mintAgentId(new Set(agents.map((agent) => agent.id)))
    const now = Date.now()
    const agent = readAgentRecord(
      {
        name: 'New Agent',
        version: AGENT_SCHEMA_VERSION,
        instruction: '',
        modelDefaults: { mode: 'inheritMain' },
        runtimeDefaults: {},
        inputScopes: [],
        outputFormat: 'text',
        createdAt: now,
        updatedAt: now,
        ...source,
        id: agentId,
      },
      'agent',
    )
    target.agents = readAgentCollectionForWrite([...agents, agent])
    return { event: { ...COMMAND_EVENT_CATALOG.agentCreated, id: agentId }, extra: { agentId } }
  })
}

export function updateAgentCommand(
  args: AgentPresetCommandArgs & { agentId: string },
): JsonCommandMutationResult<{ agentId: string }> {
  const agentId = readNonEmptyString(args.agentId, 'agentId')
  const body = readObject(args.body, 'request body')
  const patch = readAgentPatch(body.patch)
  return applyAgentPresetSettingsMutation(args, (target) => {
    const { agents } = currentAgentConfiguration(target)
    const index = requireAgentIndex(agents, agentId)
    const next = applyAgentPatch(agents[index], patch)
    const nextAgents = [...agents]
    nextAgents[index] = next
    target.agents = readAgentCollectionForWrite(nextAgents)
    return { event: { ...COMMAND_EVENT_CATALOG.agentUpdated, id: agentId }, extra: { agentId } }
  })
}

export function duplicateAgentCommand(
  args: AgentPresetCommandArgs & { agentId: string },
): JsonCommandMutationResult<{ agentId: string; sourceAgentId: string }> {
  const sourceAgentId = readNonEmptyString(args.agentId, 'agentId')
  const body = readObject(args.body, 'request body')
  const name = readOptionalNonEmptyString(body.name, 'name')
  return applyAgentPresetSettingsMutation(args, (target) => {
    const { agents } = currentAgentConfiguration(target)
    const source = agents[requireAgentIndex(agents, sourceAgentId)]
    const agentId = mintAgentId(new Set(agents.map((agent) => agent.id)))
    const now = Date.now()
    const duplicated = readAgentRecord(
      { ...cloneJson(source), id: agentId, name: name ?? `${source.name} Copy`, createdAt: now, updatedAt: now },
      'agent',
    )
    target.agents = readAgentCollectionForWrite([...agents, duplicated])
    return {
      event: { ...COMMAND_EVENT_CATALOG.agentDuplicated, id: agentId, parentId: sourceAgentId },
      extra: { agentId, sourceAgentId },
    }
  })
}

export function deleteAgentCommand(
  args: AgentPresetCommandArgs & { agentId: string },
): JsonCommandMutationResult<{ agentId: string }> {
  const agentId = readNonEmptyString(args.agentId, 'agentId')
  return applyAgentPresetSettingsMutation(args, (target) => {
    const { agents, presets } = currentAgentConfiguration(target)
    requireAgentIndex(agents, agentId)
    const usageCount = presets.reduce(
      (count, preset) => count + (preset.agentUses ?? []).filter((use) => use.agentId === agentId).length,
      0,
    )
    if (usageCount > 0) {
      throw new ValidationError(`Agent is still used by ${usageCount} Agent Preset invocation(s)`)
    }
    target.agents = readAgentCollectionForWrite(agents.filter((agent) => agent.id !== agentId))
    return { event: { ...COMMAND_EVENT_CATALOG.agentDeleted, id: agentId }, extra: { agentId } }
  })
}

export function reorderAgentsCommand(args: AgentPresetCommandArgs): JsonCommandMutationResult<Record<string, never>> {
  const body = readObject(args.body, 'request body')
  const agentIds = readIdList(body.agentIds, 'agentIds')
  return applyAgentPresetSettingsMutation(args, (target) => {
    const { agents } = currentAgentConfiguration(target)
    validateFullIdOrder(
      agents.map((agent) => agent.id),
      agentIds,
      'agentIds',
      'Agent id',
    )
    const byId = new Map(agents.map((agent) => [agent.id, agent]))
    target.agents = readAgentCollectionForWrite(agentIds.map((id) => byId.get(id)!))
    return { event: COMMAND_EVENT_CATALOG.agentReordered, extra: {} }
  })
}

export function createAgentPresetStepCommand(
  args: AgentPresetCommandArgs & { presetId: string },
): JsonCommandMutationResult<{ presetId: string; stepId: string; useId: string; agentId: string }> {
  const presetId = readNonEmptyString(args.presetId, 'presetId')
  const body = readObject(args.body, 'request body')
  const legacyCreate = body.use === undefined
  const source = readObject(legacyCreate ? body.step : body.use, legacyCreate ? 'step' : 'use')
  if (hasOwn(source, 'id')) {
    throw new ValidationError(`${legacyCreate ? 'step' : 'use'}.id is server-generated`)
  }

  return applyAgentPresetSettingsMutation(args, (target) => {
    const configuration = currentAgentConfiguration(target)
    const { presets } = configuration
    let { agents } = configuration
    const preset = clonePreset(presets[requireAgentPresetIndex(presets, presetId)])
    const useId = mintAgentPresetStepId(
      new Set(presets.flatMap((candidate) => (candidate.agentUses ?? []).map((use) => use.id))),
    )
    let agentId: string
    if (legacyCreate) {
      agentId = mintAgentId(new Set(agents.map((agent) => agent.id)))
      const agent = readAgentRecordFromLegacyStepCreate(source, agentId)
      agents = [...agents, agent]
      target.agents = readAgentCollectionForWrite(agents)
    } else {
      agentId = readNonEmptyString(source.agentId, 'use.agentId')
      requireAgentIndex(agents, agentId)
    }
    const use = readPresetUseFromCreate(source, useId, agentId, preset, agents)
    preset.agentUses = [...(preset.agentUses ?? []), use]
    preset.steps = []
    preset.updatedAt = Date.now()
    const nextPresets = replacePreset(presets, preset)
    target.agentPresets = readPresetCollectionForWrite(nextPresets, agents)
    normalizeAgentPresetDefault(target)
    return {
      event: { ...COMMAND_EVENT_CATALOG.agentPresetUseCreated, id: useId, parentId: presetId },
      extra: { presetId, stepId: useId, useId, agentId },
    }
  })
}

export const createAgentPresetUseCommand = createAgentPresetStepCommand

export function updateAgentPresetStepCommand(
  args: AgentPresetCommandArgs & { presetId: string; stepId: string },
): JsonCommandMutationResult<
  { presetId: string; stepId: string; useId: string; agentId: string } & AgentPresetPatchAcknowledgement
> {
  const presetId = readNonEmptyString(args.presetId, 'presetId')
  const stepId = readNonEmptyString(args.stepId, 'stepId')
  const body = readObject(args.body, 'request body')
  const patch = readStepPatch(body.patch)

  return applyAgentPresetSettingsMutation(args, (target) => {
    const before = readCanonicalAgentPresetState(target)
    const presets = before.presets
    let agents = before.agents
    const preset = clonePreset(presets[requireAgentPresetIndex(presets, presetId)])
    const useIndex = requireUseIndex(preset, stepId)
    const use = applyUsePatch((preset.agentUses ?? [])[useIndex], patch)
    preset.agentUses![useIndex] = use
    preset.steps = []
    const agentIndex = requireAgentIndex(agents, use.agentId)
    const agentPatch = agentPatchFromLegacyStepPatch(patch)
    if (Object.keys(agentPatch).length > 0) {
      const nextAgents = [...agents]
      nextAgents[agentIndex] = applyAgentPatch(agents[agentIndex], agentPatch)
      agents = nextAgents
      target.agents = readAgentCollectionForWrite(agents)
    }
    preset.updatedAt = Date.now()
    const nextPresets = replacePreset(presets, preset)
    target.agentPresets = readPresetCollectionForWrite(nextPresets, agents)
    normalizeAgentPresetDefault(target)
    const after = readCanonicalAgentPresetState(target)
    const finalPreset = after.presets[requireAgentPresetIndex(after.presets, presetId)]
    const finalStep = resolveAgentPresetSteps(finalPreset, after.agents).find((step) => step.id === stepId)!
    const finalUse = finalPreset.agentUses!.find((candidate) => candidate.id === stepId)!
    const canonicalPatchTarget: Record<string, unknown> = { ...finalStep }
    if (hasOwn(finalUse, 'modelOverride')) canonicalPatchTarget.modelOverride = finalUse.modelOverride
    if (hasOwn(finalUse, 'runtimeOverride')) canonicalPatchTarget.runtimeOverride = finalUse.runtimeOverride
    const acknowledgementSafe = before.acknowledgementSafe && after.acknowledgementSafe
    return {
      event: { ...COMMAND_EVENT_CATALOG.agentPresetUseUpdated, id: stepId, parentId: presetId },
      extra: {
        presetId,
        stepId,
        useId: stepId,
        agentId: use.agentId,
        ...buildAgentPresetPatchAcknowledgement(
          patch,
          canonicalPatchTarget,
          acknowledgementSafe,
          finalPreset.updatedAt,
        ),
      },
    }
  })
}

export const updateAgentPresetUseCommand = updateAgentPresetStepCommand

export function duplicateAgentPresetStepCommand(
  args: AgentPresetCommandArgs & { presetId: string; stepId: string },
): JsonCommandMutationResult<{ presetId: string; stepId: string; sourceStepId: string }> {
  const presetId = readNonEmptyString(args.presetId, 'presetId')
  const sourceStepId = readNonEmptyString(args.stepId, 'stepId')
  const body = readObject(args.body, 'request body')
  const name = readOptionalNonEmptyString(body.name, 'name')

  return applyAgentPresetSettingsMutation(args, (target) => {
    const { agents, presets } = currentAgentConfiguration(target)
    const preset = clonePreset(presets[requireAgentPresetIndex(presets, presetId)])
    const sourceIndex = requireUseIndex(preset, sourceStepId)
    const source = preset.agentUses![sourceIndex]
    const stepId = mintAgentPresetStepId(
      new Set(presets.flatMap((candidate) => (candidate.agentUses ?? []).map((use) => use.id))),
    )
    const sourceAgent = agents[requireAgentIndex(agents, source.agentId)]
    const duplicated: AgentPresetUseRecord = {
      ...cloneJson(source),
      id: stepId,
      dependencies: [...source.dependencies],
      failurePolicy: cloneJson(source.failurePolicy),
      outputKey: uniqueOutputKey(`${source.outputKey}_copy`, resolveAgentPresetSteps(preset, agents), source.phase),
    }
    preset.agentUses!.splice(sourceIndex + 1, 0, duplicated)
    preset.updatedAt = Date.now()
    const nextPresets = replacePreset(presets, preset)
    target.agentPresets = readPresetCollectionForWrite(nextPresets, agents)
    normalizeAgentPresetDefault(target)
    return {
      event: { ...COMMAND_EVENT_CATALOG.agentPresetUseCreated, id: stepId, parentId: presetId },
      extra: { presetId, stepId, sourceStepId, useId: stepId, agentId: sourceAgent.id, name },
    }
  })
}

export function deleteAgentPresetStepCommand(
  args: AgentPresetCommandArgs & { presetId: string; stepId: string },
): JsonCommandMutationResult<{ presetId: string; stepId: string; useId: string }> {
  const presetId = readNonEmptyString(args.presetId, 'presetId')
  const stepId = readNonEmptyString(args.stepId, 'stepId')

  return applyAgentPresetSettingsMutation(args, (target) => {
    const { agents, presets } = currentAgentConfiguration(target)
    const preset = clonePreset(presets[requireAgentPresetIndex(presets, presetId)])
    const stepIndex = requireUseIndex(preset, stepId)
    preset.agentUses!.splice(stepIndex, 1)
    preset.agentUses = preset.agentUses!.map((use) => ({
      ...use,
      dependencies: use.dependencies.filter((dependencyId) => dependencyId !== stepId),
    }))
    preset.updatedAt = Date.now()
    const nextPresets = replacePreset(presets, preset)
    target.agentPresets = readPresetCollectionForWrite(nextPresets, agents)
    normalizeAgentPresetDefault(target)
    return {
      event: { ...COMMAND_EVENT_CATALOG.agentPresetUseDeleted, id: stepId, parentId: presetId },
      extra: { presetId, stepId, useId: stepId },
    }
  })
}

export const deleteAgentPresetUseCommand = deleteAgentPresetStepCommand

export function reorderAgentPresetStepsCommand(
  args: AgentPresetCommandArgs & { presetId: string },
): JsonCommandMutationResult<{ presetId: string }> {
  const presetId = readNonEmptyString(args.presetId, 'presetId')
  const body = readObject(args.body, 'request body')
  const usesCanonicalField = hasOwn(body, 'useIds')
  const stepIds = readIdList(usesCanonicalField ? body.useIds : body.stepIds, usesCanonicalField ? 'useIds' : 'stepIds')

  return applyAgentPresetSettingsMutation(args, (target) => {
    const { agents, presets } = currentAgentConfiguration(target)
    const preset = clonePreset(presets[requireAgentPresetIndex(presets, presetId)])
    validateFullStepOrder(preset, stepIds)
    const byId = new Map((preset.agentUses ?? []).map((use) => [use.id, use]))
    preset.agentUses = stepIds.map((id) => byId.get(id)!)
    preset.updatedAt = Date.now()
    const nextPresets = replacePreset(presets, preset)
    target.agentPresets = readPresetCollectionForWrite(nextPresets, agents)
    normalizeAgentPresetDefault(target)
    return {
      event: { ...COMMAND_EVENT_CATALOG.agentPresetUseReordered, id: presetId },
      extra: { presetId },
    }
  })
}

export const reorderAgentPresetUsesCommand = reorderAgentPresetStepsCommand

function applyAgentPresetSettingsMutation<TExtra extends AgentPresetMutationExtra = {}>(
  args: Omit<AgentPresetCommandArgs, 'body'>,
  mutateTarget: (target: Record<string, unknown>) => { event: CommandEventDraft; extra: TExtra },
): JsonCommandMutationResult<TExtra> {
  return applyTargetedCommandMutation<TExtra>({
    db: args.db,
    dataDir: args.dataDir,
    baseRevision: args.baseRevision,
    eventSink: args.eventSink,
    ...(args.eventOrigin ? { eventOrigin: args.eventOrigin } : {}),
    ...(args.mutationReceiptKey ? { mutationReceiptKey: args.mutationReceiptKey } : {}),
    mutationPath: TARGETED_MUTATION_PATHS.settings,
    settingsScopedRead: true,
    mutate(database, innerDb) {
      const target = readDatabaseTarget(database)
      const result = mutateTarget(target)
      writeSettingsOnly(innerDb, extractSettings(target))
      return result
    },
  })
}

function currentAgentPresets(target: Record<string, unknown>): AgentPresetRecord[] {
  return currentAgentConfiguration(target).presets
}

function currentAgentConfiguration(target: Record<string, unknown>): {
  agents: AgentRecord[]
  presets: AgentPresetRecord[]
} {
  const normalized = normalizeAgentConfiguration(target.agents, target.agentPresets)
  assertValidAgentCollection(normalized.agents)
  assertValidPresetCollection(normalized.agentPresets, normalized.agents)
  target.agents = cloneJson(normalized.agents)
  target.agentPresets = cloneJson(normalized.agentPresets)
  return { agents: normalized.agents, presets: normalized.agentPresets }
}

function readCanonicalAgentPresetState(target: Record<string, unknown>): CanonicalAgentPresetState {
  const rawAgents = target.agents
  const rawPresets = target.agentPresets
  const { agents, presets } = currentAgentConfiguration(target)
  const defaultId = normalizeAgentPresetDefaultId(target.agentPresetDefaultId, presets)
  const defaultIsCanonical = defaultId
    ? target.agentPresetDefaultId === defaultId
    : !hasOwn(target, 'agentPresetDefaultId')
  return {
    agents,
    presets,
    defaultId,
    acknowledgementSafe:
      Array.isArray(rawAgents) &&
      isDeepStrictEqual(rawAgents, agents) &&
      Array.isArray(rawPresets) &&
      isDeepStrictEqual(rawPresets, presets) &&
      defaultIsCanonical,
  }
}

function buildAgentPresetCollectionAcknowledgement(
  state: CanonicalAgentPresetState,
  acknowledgementSafe: boolean,
): AgentPresetCollectionAcknowledgement | Record<string, never> {
  if (!acknowledgementSafe) return {}
  return {
    certificate: AGENT_PRESET_COLLECTION_ACKNOWLEDGEMENT_CERTIFICATE,
    agentPresetIds: state.presets.map((preset) => preset.id),
  }
}

function buildAgentPresetPatchAcknowledgement(
  patch: Record<string, unknown>,
  canonicalTarget: object,
  acknowledgementSafe: boolean,
  updatedAt = (canonicalTarget as Record<string, unknown>).updatedAt,
): AgentPresetPatchAcknowledgement {
  if (!acknowledgementSafe || typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt < 0) {
    return {
      acknowledgedKeys: [],
      canonicalValues: {},
      canonicalDeletedKeys: [],
    }
  }

  const acknowledgedKeys = Object.keys(patch)
  const canonicalValues: Record<string, unknown> = {}
  const canonicalDeletedKeys: string[] = []
  const canonicalRecord = canonicalTarget as Record<string, unknown>
  for (const key of acknowledgedKeys) {
    if (hasOwn(canonicalRecord, key)) canonicalValues[key] = cloneJson(canonicalRecord[key])
    else canonicalDeletedKeys.push(key)
  }
  return {
    acknowledgedKeys,
    canonicalValues,
    canonicalDeletedKeys,
    updatedAt,
  }
}

function isExpectedMetadataPatch(
  before: readonly AgentPresetRecord[],
  after: readonly AgentPresetRecord[],
  presetId: string,
  patchKeys: readonly string[],
): boolean {
  if (!samePresetIdentityOrder(before, after)) return false
  const allowedKeys = new Set([...patchKeys, 'updatedAt'])
  return before.every((preset, index) =>
    preset.id === presetId
      ? recordsEqualExcept(preset, after[index], allowedKeys)
      : isDeepStrictEqual(preset, after[index]),
  )
}

function isExpectedStepPatch(
  before: readonly AgentPresetRecord[],
  after: readonly AgentPresetRecord[],
  presetId: string,
  stepId: string,
  patchKeys: readonly string[],
): boolean {
  if (!samePresetIdentityOrder(before, after)) return false
  return before.every((preset, presetIndex) => {
    const nextPreset = after[presetIndex]
    if (preset.id !== presetId) return isDeepStrictEqual(preset, nextPreset)
    if (!recordsEqualExcept(preset, nextPreset, new Set(['steps', 'updatedAt']))) return false
    if (preset.steps.length !== nextPreset.steps.length) return false
    const allowedStepKeys = new Set(patchKeys)
    return preset.steps.every((step, stepIndex) => {
      const nextStep = nextPreset.steps[stepIndex]
      if (!nextStep || nextStep.id !== step.id) return false
      return step.id === stepId
        ? recordsEqualExcept(step, nextStep, allowedStepKeys)
        : isDeepStrictEqual(step, nextStep)
    })
  })
}

function samePresetIdentityOrder(before: readonly AgentPresetRecord[], after: readonly AgentPresetRecord[]): boolean {
  return before.length === after.length && before.every((preset, index) => after[index]?.id === preset.id)
}

function recordsEqualExcept(before: object, after: object, allowedKeys: ReadonlySet<string>): boolean {
  const beforeRecord = before as Record<string, unknown>
  const afterRecord = after as Record<string, unknown>
  const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])
  for (const key of keys) {
    if (allowedKeys.has(key)) continue
    if (!isDeepStrictEqual(beforeRecord[key], afterRecord[key])) return false
  }
  return true
}

function readPresetCollectionForWrite(
  value: readonly AgentPresetRecord[],
  agents: readonly AgentRecord[] = [],
): AgentPresetRecord[] {
  assertValidPresetCollection(value, agents)
  return cloneJson([...value])
}

function readPresetRecord(value: unknown, label: string, agents: readonly AgentRecord[] = []): AgentPresetRecord {
  const source = readObject(value, label)
  assertMaxConcurrencyValue(source.maxConcurrency, `${label}.maxConcurrency`)
  const preset = normalizeAgentPresets([value])[0]
  if (!preset) {
    throw new ValidationError(`${label}.id must be a non-empty string`)
  }
  assertValidPreset(preset, label, agents)
  return preset
}

function assertValidAgentCollection(agents: readonly AgentRecord[]): void {
  const issues = validateAgentRecords(agents)
  if (issues.length > 0) throw new ValidationError(issues[0].message)
}

function assertValidPresetCollection(presets: readonly AgentPresetRecord[], agents: readonly AgentRecord[] = []): void {
  const issues = validateAgentPresetRecords(presets, agents)
  if (issues.length > 0) {
    throw new ValidationError(issues[0].message)
  }
}

function assertValidPreset(preset: AgentPresetRecord, label: string, agents: readonly AgentRecord[] = []): void {
  const issues = validateAgentPresetRecord(preset, label, agents)
  if (issues.length > 0) {
    throw new ValidationError(issues[0].message)
  }
}

function readPresetMetadataPatch(value: unknown): Record<string, unknown> {
  const patch = readObject(value, 'patch')
  const allowed = new Set([
    'name',
    'description',
    'moduleIntergration',
    'finalOutputTemplate',
    'enabled',
    'maxConcurrency',
  ])
  const entries = Object.entries(patch)
  if (entries.length === 0) {
    throw new ValidationError('patch must include at least one Agent Preset field')
  }
  for (const [key, patchValue] of entries) {
    if (!allowed.has(key)) {
      throw new ValidationError(`patch.${key} is not supported for Agent Preset metadata`)
    }
    if (key === 'name') readNonEmptyString(patchValue, 'patch.name')
    if (key === 'description' && patchValue !== null && typeof patchValue !== 'string') {
      throw new ValidationError('patch.description must be a string or null')
    }
    if (key === 'moduleIntergration' && patchValue !== null && typeof patchValue !== 'string') {
      throw new ValidationError('patch.moduleIntergration must be a string or null')
    }
    if (key === 'finalOutputTemplate' && patchValue !== null && typeof patchValue !== 'string') {
      throw new ValidationError('patch.finalOutputTemplate must be a string or null')
    }
    if (key === 'enabled' && typeof patchValue !== 'boolean') {
      throw new ValidationError('patch.enabled must be a boolean')
    }
    if (key === 'maxConcurrency' && patchValue !== null && !Number.isInteger(patchValue)) {
      throw new ValidationError('patch.maxConcurrency must be an integer or null')
    }
    if (key === 'maxConcurrency' && patchValue !== null) {
      assertMaxConcurrencyValue(patchValue, 'patch.maxConcurrency')
    }
  }
  return patch
}

function applyPresetMetadataPatch(
  preset: AgentPresetRecord,
  patch: Record<string, unknown>,
  agents: readonly AgentRecord[],
): AgentPresetRecord {
  const next: AgentPresetRecord = clonePreset(preset)
  if (hasOwn(patch, 'name')) next.name = readNonEmptyString(patch.name, 'patch.name')
  if (hasOwn(patch, 'description')) {
    const description = patch.description
    if (description === null || description === '') {
      delete next.description
    } else {
      next.description = description as string
    }
  }
  if (hasOwn(patch, 'moduleIntergration')) {
    const moduleIntergration = patch.moduleIntergration
    if (moduleIntergration === null || (moduleIntergration as string).trim() === '') {
      delete next.moduleIntergration
    } else {
      next.moduleIntergration = moduleIntergration as string
    }
  }
  if (hasOwn(patch, 'finalOutputTemplate')) {
    const finalOutputTemplate = patch.finalOutputTemplate
    if (finalOutputTemplate === null || (finalOutputTemplate as string).trim() === '') {
      delete next.finalOutputTemplate
    } else {
      next.finalOutputTemplate = finalOutputTemplate as string
    }
  }
  if (hasOwn(patch, 'enabled')) next.enabled = patch.enabled as boolean
  if (hasOwn(patch, 'maxConcurrency')) {
    if (patch.maxConcurrency === null) {
      delete next.maxConcurrency
    } else {
      next.maxConcurrency = patch.maxConcurrency as number
    }
  }
  next.updatedAt = Date.now()
  return readPresetRecord(next, 'agentPreset', agents)
}

function readAgentCollectionForWrite(value: readonly AgentRecord[]): AgentRecord[] {
  assertValidAgentCollection(value)
  return cloneJson([...value])
}

function readAgentRecord(value: unknown, label: string): AgentRecord {
  const source = readObject(value, label)
  const agent = normalizeAgents([source])[0]
  if (!agent) throw new ValidationError(`${label}.id must be a non-empty string`)
  const issues = validateAgentRecord(agent, label)
  if (issues.length > 0) throw new ValidationError(issues[0].message)
  return agent
}

function readAgentPatch(value: unknown): Record<string, unknown> {
  const patch = readObject(value, 'patch')
  validateAgentFields(patch, 'patch', true)
  return patch
}

function validateAgentFields(source: Record<string, unknown>, label: string, requireOne: boolean): void {
  const allowed = new Set([
    'name',
    'description',
    'instruction',
    'modelDefaults',
    'runtimeDefaults',
    'inputScopes',
    'toggles',
    'lorebookInputs',
    'outputFormat',
  ])
  if (requireOne && Object.keys(source).length === 0) {
    throw new ValidationError(`${label} must include at least one Agent field`)
  }
  for (const [key, entry] of Object.entries(source)) {
    if (!allowed.has(key)) throw new ValidationError(`${label}.${key} is not supported for Agents`)
    if (key === 'name') readNonEmptyString(entry, `${label}.name`)
    if (key === 'description' && entry !== null && typeof entry !== 'string') {
      throw new ValidationError(`${label}.description must be a string or null`)
    }
    if (key === 'instruction') readString(entry, `${label}.instruction`)
    if (key === 'modelDefaults') readModelSelection(entry, `${label}.modelDefaults`)
    if (key === 'runtimeDefaults') readRuntimeOptions(entry, `${label}.runtimeDefaults`)
    if (key === 'inputScopes') readInputScopes(entry, `${label}.inputScopes`)
    if (key === 'toggles' && !Array.isArray(entry)) {
      throw new ValidationError(`${label}.toggles must be an array`)
    }
    if (key === 'lorebookInputs' && !Array.isArray(entry)) {
      throw new ValidationError(`${label}.lorebookInputs must be an array`)
    }
    if (key === 'outputFormat') readOutputFormat(entry, `${label}.outputFormat`)
  }
}

function applyAgentPatch(agent: AgentRecord, patch: Record<string, unknown>): AgentRecord {
  const next = cloneJson(agent)
  if (hasOwn(patch, 'name')) next.name = readNonEmptyString(patch.name, 'patch.name')
  if (hasOwn(patch, 'description')) {
    if (patch.description === null || patch.description === '') delete next.description
    else next.description = patch.description as string
  }
  if (hasOwn(patch, 'instruction')) next.instruction = readString(patch.instruction, 'patch.instruction')
  if (hasOwn(patch, 'modelDefaults')) {
    next.modelDefaults = readModelSelection(patch.modelDefaults, 'patch.modelDefaults')
  }
  if (hasOwn(patch, 'runtimeDefaults')) {
    next.runtimeDefaults = readRuntimeOptions(patch.runtimeDefaults, 'patch.runtimeDefaults')
  }
  if (hasOwn(patch, 'inputScopes')) next.inputScopes = readInputScopes(patch.inputScopes, 'patch.inputScopes')
  if (hasOwn(patch, 'toggles')) next.toggles = cloneJson(patch.toggles) as AgentRecord['toggles']
  if (hasOwn(patch, 'lorebookInputs')) {
    next.lorebookInputs = cloneJson(patch.lorebookInputs) as AgentRecord['lorebookInputs']
  }
  if (hasOwn(patch, 'outputFormat')) next.outputFormat = readOutputFormat(patch.outputFormat, 'patch.outputFormat')
  next.updatedAt = Date.now()
  return readAgentRecord(next, 'agent')
}

function readAgentRecordFromLegacyStepCreate(source: Record<string, unknown>, agentId: string): AgentRecord {
  const now = Date.now()
  return readAgentRecord(
    {
      id: agentId,
      name: hasOwn(source, 'name') ? readNonEmptyString(source.name, 'step.name') : 'New Agent',
      version: AGENT_SCHEMA_VERSION,
      instruction: hasOwn(source, 'instruction') ? readString(source.instruction, 'step.instruction') : '',
      modelDefaults: hasOwn(source, 'model') ? readModelSelection(source.model, 'step.model') : { mode: 'inheritMain' },
      runtimeDefaults: hasOwn(source, 'runtime') ? readRuntimeOptions(source.runtime, 'step.runtime') : {},
      inputScopes: hasOwn(source, 'inputScopes') ? readInputScopes(source.inputScopes, 'step.inputScopes') : [],
      outputFormat: hasOwn(source, 'outputFormat')
        ? readOutputFormat(source.outputFormat, 'step.outputFormat')
        : 'text',
      createdAt: now,
      updatedAt: now,
    },
    'agent',
  )
}

function readPresetUseFromCreate(
  source: Record<string, unknown>,
  useId: string,
  agentId: string,
  preset: AgentPresetRecord,
  agents: readonly AgentRecord[],
): AgentPresetUseRecord {
  const phase = readPhase(source.phase, 'use.phase', 'beforeMain')
  const outputKey = hasOwn(source, 'outputKey')
    ? readNonEmptyString(source.outputKey, 'use.outputKey')
    : uniqueOutputKey(useId, resolveAgentPresetSteps(preset, agents), phase)
  const use: AgentPresetUseRecord = {
    id: useId,
    agentId,
    enabled: hasOwn(source, 'enabled') ? readBoolean(source.enabled, 'use.enabled') : true,
    phase,
    dependencies: hasOwn(source, 'dependencies') ? readIdList(source.dependencies, 'use.dependencies') : [],
    outputKey,
    destination: hasOwn(source, 'destination')
      ? readDestination(source.destination, 'use.destination')
      : phase === 'beforeMain'
        ? 'promptOutput'
        : 'intermediate',
    failurePolicy: hasOwn(source, 'failurePolicy')
      ? readFailurePolicy(source.failurePolicy, 'use.failurePolicy')
      : { mode: 'required' },
  }
  if (hasOwn(source, 'modelOverride') && source.modelOverride !== null) {
    use.modelOverride = readModelSelection(source.modelOverride, 'use.modelOverride')
  }
  if (hasOwn(source, 'runtimeOverride') && source.runtimeOverride !== null) {
    use.runtimeOverride = readRuntimeOptions(source.runtimeOverride, 'use.runtimeOverride')
  }
  return use
}

function applyUsePatch(use: AgentPresetUseRecord, patch: Record<string, unknown>): AgentPresetUseRecord {
  const next = cloneJson(use)
  if (hasOwn(patch, 'enabled')) next.enabled = readBoolean(patch.enabled, 'patch.enabled')
  if (hasOwn(patch, 'phase')) next.phase = readPhase(patch.phase, 'patch.phase')
  if (hasOwn(patch, 'dependencies')) next.dependencies = readIdList(patch.dependencies, 'patch.dependencies')
  if (hasOwn(patch, 'outputKey')) next.outputKey = readNonEmptyString(patch.outputKey, 'patch.outputKey')
  if (hasOwn(patch, 'destination')) next.destination = readDestination(patch.destination, 'patch.destination')
  if (hasOwn(patch, 'failurePolicy')) {
    next.failurePolicy = readFailurePolicy(patch.failurePolicy, 'patch.failurePolicy')
  }
  if (hasOwn(patch, 'modelOverride')) {
    if (patch.modelOverride === null) delete next.modelOverride
    else next.modelOverride = readModelSelection(patch.modelOverride, 'patch.modelOverride')
  }
  if (hasOwn(patch, 'runtimeOverride')) {
    if (patch.runtimeOverride === null) delete next.runtimeOverride
    else next.runtimeOverride = readRuntimeOptions(patch.runtimeOverride, 'patch.runtimeOverride')
  }
  return next
}

function agentPatchFromLegacyStepPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const agentPatch: Record<string, unknown> = {}
  if (hasOwn(patch, 'name')) agentPatch.name = patch.name
  if (hasOwn(patch, 'instruction')) agentPatch.instruction = patch.instruction
  if (hasOwn(patch, 'model')) agentPatch.modelDefaults = patch.model
  if (hasOwn(patch, 'runtime')) agentPatch.runtimeDefaults = patch.runtime
  if (hasOwn(patch, 'inputScopes')) agentPatch.inputScopes = patch.inputScopes
  if (hasOwn(patch, 'outputFormat')) agentPatch.outputFormat = patch.outputFormat
  return agentPatch
}

function readStepRecordFromCreate(
  source: Record<string, unknown>,
  stepId: string,
  existingSteps: readonly AgentPresetStepRecord[],
): AgentPresetStepRecord {
  const phase = readPhase(source.phase, 'step.phase', 'beforeMain')
  const outputKey = hasOwn(source, 'outputKey')
    ? readNonEmptyString(source.outputKey, 'step.outputKey')
    : uniqueOutputKey(stepId, existingSteps, phase)
  const step: AgentPresetStepRecord = {
    id: stepId,
    name: hasOwn(source, 'name') ? readNonEmptyString(source.name, 'step.name') : 'New Step',
    enabled: hasOwn(source, 'enabled') ? readBoolean(source.enabled, 'step.enabled') : true,
    phase,
    dependencies: hasOwn(source, 'dependencies') ? readIdList(source.dependencies, 'step.dependencies') : [],
    instruction: hasOwn(source, 'instruction') ? readString(source.instruction, 'step.instruction') : '',
    model: hasOwn(source, 'model') ? readModelSelection(source.model, 'step.model') : { mode: 'inheritMain' },
    runtime: hasOwn(source, 'runtime') ? readRuntimeOptions(source.runtime, 'step.runtime') : {},
    inputScopes: hasOwn(source, 'inputScopes') ? readInputScopes(source.inputScopes, 'step.inputScopes') : [],
    outputKey,
    outputFormat: hasOwn(source, 'outputFormat') ? readOutputFormat(source.outputFormat, 'step.outputFormat') : 'text',
    destination: hasOwn(source, 'destination')
      ? readDestination(source.destination, 'step.destination')
      : phase === 'beforeMain'
        ? 'promptOutput'
        : 'intermediate',
    failurePolicy: hasOwn(source, 'failurePolicy')
      ? readFailurePolicy(source.failurePolicy, 'step.failurePolicy')
      : { mode: 'required' },
  }
  return step
}

function readStepPatch(value: unknown): Record<string, unknown> {
  const patch = readObject(value, 'patch')
  const allowed = new Set([
    'name',
    'enabled',
    'phase',
    'dependencies',
    'instruction',
    'model',
    'modelOverride',
    'runtime',
    'runtimeOverride',
    'inputScopes',
    'outputKey',
    'outputFormat',
    'destination',
    'failurePolicy',
  ])
  const entries = Object.entries(patch)
  if (entries.length === 0) {
    throw new ValidationError('patch must include at least one Agent Preset step field')
  }
  for (const [key, patchValue] of entries) {
    if (!allowed.has(key)) {
      throw new ValidationError(`patch.${key} is not supported for Agent Preset steps`)
    }
    validateStepPatchField(key, patchValue)
  }
  return patch
}

function validateStepPatchField(key: string, value: unknown): void {
  if (key === 'name') readNonEmptyString(value, 'patch.name')
  if (key === 'enabled') readBoolean(value, 'patch.enabled')
  if (key === 'phase') readPhase(value, 'patch.phase')
  if (key === 'dependencies') readIdList(value, 'patch.dependencies')
  if (key === 'instruction') readString(value, 'patch.instruction')
  if (key === 'model') readModelSelection(value, 'patch.model')
  if (key === 'modelOverride' && value !== null) readModelSelection(value, 'patch.modelOverride')
  if (key === 'runtime') readRuntimeOptions(value, 'patch.runtime')
  if (key === 'runtimeOverride' && value !== null) readRuntimeOptions(value, 'patch.runtimeOverride')
  if (key === 'inputScopes') readInputScopes(value, 'patch.inputScopes')
  if (key === 'outputKey') readNonEmptyString(value, 'patch.outputKey')
  if (key === 'outputFormat') readOutputFormat(value, 'patch.outputFormat')
  if (key === 'destination') readDestination(value, 'patch.destination')
  if (key === 'failurePolicy') readFailurePolicy(value, 'patch.failurePolicy')
}

function applyStepPatch(step: AgentPresetStepRecord, patch: Record<string, unknown>): AgentPresetStepRecord {
  const next: AgentPresetStepRecord = cloneStep(step)
  if (hasOwn(patch, 'name')) next.name = readNonEmptyString(patch.name, 'patch.name')
  if (hasOwn(patch, 'enabled')) next.enabled = patch.enabled as boolean
  if (hasOwn(patch, 'phase')) next.phase = readPhase(patch.phase, 'patch.phase')
  if (hasOwn(patch, 'dependencies')) next.dependencies = readIdList(patch.dependencies, 'patch.dependencies')
  if (hasOwn(patch, 'instruction')) next.instruction = readString(patch.instruction, 'patch.instruction')
  if (hasOwn(patch, 'model')) next.model = readModelSelection(patch.model, 'patch.model')
  if (hasOwn(patch, 'runtime')) next.runtime = readRuntimeOptions(patch.runtime, 'patch.runtime')
  if (hasOwn(patch, 'inputScopes')) next.inputScopes = readInputScopes(patch.inputScopes, 'patch.inputScopes')
  if (hasOwn(patch, 'outputKey')) next.outputKey = readNonEmptyString(patch.outputKey, 'patch.outputKey')
  if (hasOwn(patch, 'outputFormat')) next.outputFormat = readOutputFormat(patch.outputFormat, 'patch.outputFormat')
  if (hasOwn(patch, 'destination')) next.destination = readDestination(patch.destination, 'patch.destination')
  if (hasOwn(patch, 'failurePolicy')) next.failurePolicy = readFailurePolicy(patch.failurePolicy, 'patch.failurePolicy')
  return next
}

function readModelSelection(value: unknown, label: string): AgentPresetStepModelSelection {
  const source = readObject(value, label)
  if (source.mode === 'inheritMain') return { mode: 'inheritMain' }
  if (source.mode === 'modelProfile') {
    return {
      mode: 'modelProfile',
      profileId: readNonEmptyString(source.profileId, `${label}.profileId`),
    }
  }
  throw new ValidationError(`${label}.mode must be inheritMain or modelProfile`)
}

function readRuntimeOptions(value: unknown, label: string): AgentPresetStepRecord['runtime'] {
  const source = readObject(value, label)
  const allowed = new Set(['temperature', 'maxInputChars', 'maxOutputChars', 'timeoutMs', 'structuredOutputStrict'])
  const runtime: AgentPresetStepRecord['runtime'] = {}
  for (const [key, entry] of Object.entries(source)) {
    if (!allowed.has(key)) {
      throw new ValidationError(`${label}.${key} is not supported`)
    }
    if (key === 'structuredOutputStrict') {
      if (typeof entry !== 'boolean') throw new ValidationError(`${label}.${key} must be a boolean`)
      runtime.structuredOutputStrict = entry
      continue
    }
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      throw new ValidationError(`${label}.${key} must be a finite number`)
    }
    if (key === 'temperature') runtime.temperature = entry
    if (key === 'maxInputChars') runtime.maxInputChars = readInteger(entry, `${label}.${key}`)
    if (key === 'maxOutputChars') runtime.maxOutputChars = readInteger(entry, `${label}.${key}`)
    if (key === 'timeoutMs') runtime.timeoutMs = readInteger(entry, `${label}.${key}`)
  }
  return runtime
}

function readInputScopes(value: unknown, label: string): AgentPresetStepInputScope[] {
  if (!Array.isArray(value)) throw new ValidationError(`${label} must be an array`)
  const scopes: AgentPresetStepInputScope[] = []
  const seen = new Set<string>()
  value.forEach((scope, index) => {
    if (typeof scope !== 'string' || !AGENT_PRESET_INPUT_SCOPE_SET.has(scope)) {
      throw new ValidationError(`${label}[${index}] must be a known Agent Preset input scope`)
    }
    if (!seen.has(scope)) {
      scopes.push(scope as AgentPresetStepInputScope)
      seen.add(scope)
    }
  })
  return scopes
}

function readFailurePolicy(value: unknown, label: string): AgentPresetStepFailurePolicy {
  if (typeof value === 'string') {
    if (value === 'optional' || value === 'required' || value === 'stopGeneration') return { mode: value }
    if (value === 'fallbackText') return { mode: 'fallbackText', text: '' }
  }
  const source = readObject(value, label)
  if (source.mode === 'optional' || source.mode === 'required' || source.mode === 'stopGeneration') {
    return { mode: source.mode }
  }
  if (source.mode === 'fallbackText') {
    return { mode: 'fallbackText', text: readString(source.text, `${label}.text`) }
  }
  throw new ValidationError(`${label}.mode must be optional, required, fallbackText, or stopGeneration`)
}

function readPhase(value: unknown, label: string, fallback?: AgentPresetStepPhase): AgentPresetStepPhase {
  if (value === undefined && fallback) return fallback
  if (typeof value !== 'string' || !AGENT_PRESET_PHASE_SET.has(value)) {
    throw new ValidationError(`${label} must be beforeMain or afterMain`)
  }
  return value as AgentPresetStepPhase
}

function readOutputFormat(value: unknown, label: string): AgentPresetStepOutputFormat {
  if (typeof value !== 'string' || !AGENT_PRESET_OUTPUT_FORMAT_SET.has(value)) {
    throw new ValidationError(`${label} must be text or jsonObject`)
  }
  return value as AgentPresetStepOutputFormat
}

function readDestination(value: unknown, label: string): AgentPresetStepDestination {
  if (typeof value !== 'string' || !AGENT_PRESET_DESTINATION_SET.has(value)) {
    throw new ValidationError(`${label} must be promptOutput, intermediate, userInput, or finalOutput`)
  }
  return value as AgentPresetStepDestination
}

function replacePreset(presets: readonly AgentPresetRecord[], replacement: AgentPresetRecord): AgentPresetRecord[] {
  return presets.map((preset) => (preset.id === replacement.id ? replacement : preset))
}

function duplicatePresetRecord(
  source: AgentPresetRecord,
  presetId: string,
  usedStepIds: Set<string>,
  name?: string,
  agents: readonly AgentRecord[] = [],
): AgentPresetRecord {
  const stepIdMap = new Map<string, string>()
  for (const use of source.agentUses ?? []) {
    stepIdMap.set(use.id, mintAgentPresetStepId(usedStepIds))
  }
  const now = Date.now()
  return readPresetRecord(
    {
      ...clonePreset(source),
      id: presetId,
      name: name ?? `${source.name} Copy`,
      agentUses: (source.agentUses ?? []).map((use) => ({
        ...cloneJson(use),
        id: stepIdMap.get(use.id)!,
        dependencies: use.dependencies.map((dependencyId) => stepIdMap.get(dependencyId) ?? dependencyId),
      })),
      steps: [],
      createdAt: now,
      updatedAt: now,
    },
    'agentPreset',
    agents,
  )
}

function requireAgentPresetIndex(presets: readonly AgentPresetRecord[], presetId: string): number {
  const index = presets.findIndex((preset) => preset.id === presetId)
  if (index === -1) throw new EntityNotFoundError(`Agent Preset not found: ${presetId}`)
  return index
}

function requireAgentIndex(agents: readonly AgentRecord[], agentId: string): number {
  const index = agents.findIndex((agent) => agent.id === agentId)
  if (index === -1) throw new EntityNotFoundError(`Agent not found: ${agentId}`)
  return index
}

function requireUseIndex(preset: AgentPresetRecord, useId: string): number {
  const index = (preset.agentUses ?? []).findIndex((use) => use.id === useId)
  if (index === -1) throw new EntityNotFoundError(`Agent Preset use not found: ${useId}`)
  return index
}

function validateFullPresetOrder(presets: readonly AgentPresetRecord[], presetIds: readonly string[]): void {
  validateFullIdOrder(
    presets.map((preset) => preset.id),
    presetIds,
    'presetIds',
    'Agent Preset id',
  )
}

function validateFullStepOrder(preset: AgentPresetRecord, stepIds: readonly string[]): void {
  validateFullIdOrder(
    (preset.agentUses ?? []).map((use) => use.id),
    stepIds,
    'stepIds',
    'Agent Preset step id',
  )
}

function validateFullIdOrder(
  existingIds: readonly string[],
  orderedIds: readonly string[],
  label: string,
  idLabel: string,
): void {
  const existing = new Set(existingIds)
  const seen = new Set<string>()
  for (const id of orderedIds) {
    if (!existing.has(id)) throw new ValidationError(`Unknown ${idLabel} in ${label}: ${id}`)
    if (seen.has(id)) throw new ValidationError(`Duplicate ${idLabel} in ${label}: ${id}`)
    seen.add(id)
  }
  if (seen.size !== existing.size) {
    throw new ValidationError(`${label} must include every ${idLabel}`)
  }
}

function clearChatAgentPresetSelections(target: Record<string, unknown>, presetId: string): number {
  let cleared = 0
  const characters = normalizeAllCharacterChats(target)
  for (const character of characters) {
    const chats = Array.isArray(character.chats) ? character.chats : []
    for (const chat of chats) {
      if (chat.generationSettings?.agentPresetId !== presetId) continue
      delete chat.generationSettings.agentPresetId
      cleared += 1
    }
  }
  return cleared
}

function clearLoadoutAgentPresetSelections(target: Record<string, unknown>, presetId: string): number {
  let cleared = 0
  const loadouts = ensureLoadoutCollection(target)
  for (const loadout of loadouts) {
    if (loadout.agentPresetId !== presetId) continue
    delete loadout.agentPresetId
    delete loadout.agentPresetName
    cleared += 1
  }
  return cleared
}

function normalizeAgentPresetDefault(target: Record<string, unknown>): void {
  const normalized = normalizeAgentConfiguration(target.agents, target.agentPresets)
  target.agents = normalized.agents
  target.agentPresets = normalized.agentPresets
  const presets = normalized.agentPresets
  const defaultId = normalizeAgentPresetDefaultId(target.agentPresetDefaultId, presets)
  if (defaultId) {
    target.agentPresetDefaultId = defaultId
  } else {
    delete target.agentPresetDefaultId
  }
}

function assertMaxConcurrencyValue(value: unknown, label: string): void {
  if (value === undefined) return
  if (
    !Number.isInteger(value) ||
    (value as number) < AGENT_PRESET_MAX_CONCURRENCY_MIN ||
    (value as number) > AGENT_PRESET_MAX_CONCURRENCY_MAX
  ) {
    throw new ValidationError(
      `${label} must be between ${AGENT_PRESET_MAX_CONCURRENCY_MIN} and ${AGENT_PRESET_MAX_CONCURRENCY_MAX}`,
    )
  }
}

function uniqueOutputKey(base: string, steps: readonly AgentPresetStepRecord[], phase: AgentPresetStepPhase): string {
  const used = new Set(steps.filter((step) => step.phase === phase).map((step) => step.outputKey))
  const sanitizedBase = sanitizeOutputKeyBase(base)
  if (!used.has(sanitizedBase)) return sanitizedBase
  for (let index = 2; index < 1000; index += 1) {
    const suffix = `_${index}`
    const candidate = `${sanitizedBase.slice(0, 64 - suffix.length)}${suffix}`
    if (!used.has(candidate) && isValidAgentPresetOutputKey(candidate)) return candidate
  }
  throw new Error('Unable to mint a unique Agent Preset output key')
}

function sanitizeOutputKeyBase(base: string): string {
  let candidate = base.replace(/[^A-Za-z0-9_]/g, '_')
  if (!/^[A-Za-z_]/.test(candidate)) candidate = `agent_${candidate}`
  candidate = candidate.slice(0, 64)
  return isValidAgentPresetOutputKey(candidate) ? candidate : 'agent_output'
}

function mintAgentPresetId(existingIds: Set<string>): string {
  return mintId('ap', existingIds)
}

function mintAgentId(existingIds: Set<string>): string {
  return mintId('ag', existingIds)
}

function mintAgentPresetStepId(existingIds: Set<string>): string {
  return mintId('aps', existingIds)
}

function mintId(prefix: string, existingIds: Set<string>): string {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const id = `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 20)}`
    if (!existingIds.has(id)) {
      existingIds.add(id)
      return id
    }
  }
  throw new Error(`Unable to mint a unique ${prefix} id`)
}

function readDatabaseTarget(database: unknown): Record<string, unknown> {
  if (!isRecord(database)) {
    throw new ValidationError('database must be an object before Agent Preset commands can run')
  }
  return database
}

function readObject(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ValidationError(`${label} must be an object`)
  return value
}

function readIdList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new ValidationError(`${label} must be an array`)
  return value.map((id, index) => readNonEmptyString(id, `${label}[${index}]`))
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new ValidationError(`${label} must be a string`)
  return value
}

function readOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  return readString(value, label)
}

function readOptionalNonEmptyString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  return readNonEmptyString(value, label)
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new ValidationError(`${label} must be a boolean`)
  return value
}

function readInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value)) throw new ValidationError(`${label} must be an integer`)
  return value as number
}

function clonePreset(preset: AgentPresetRecord): AgentPresetRecord {
  return cloneJson(preset)
}

function cloneStep(step: AgentPresetStepRecord): AgentPresetStepRecord {
  return cloneJson(step)
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}
