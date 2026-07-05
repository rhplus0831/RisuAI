import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  AGENT_PRESET_SCHEMA_VERSION,
  AGENT_PRESET_MAX_CONCURRENCY_MAX,
  AGENT_PRESET_MAX_CONCURRENCY_MIN,
  AGENT_PRESET_STEP_DESTINATIONS,
  AGENT_PRESET_STEP_INPUT_SCOPES,
  AGENT_PRESET_STEP_OUTPUT_FORMATS,
  AGENT_PRESET_STEP_PHASES,
  isValidAgentPresetOutputKey,
  normalizeAgentPresetDefaultId,
  normalizeAgentPresets,
  validateAgentPresetRecord,
  validateAgentPresetRecords,
  type AgentPresetRecord,
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
  body: unknown
}

type AgentPresetMutationExtra = Record<string, unknown>

const AGENT_PRESET_PHASE_SET = new Set<string>(AGENT_PRESET_STEP_PHASES)
const AGENT_PRESET_OUTPUT_FORMAT_SET = new Set<string>(AGENT_PRESET_STEP_OUTPUT_FORMATS)
const AGENT_PRESET_INPUT_SCOPE_SET = new Set<string>(AGENT_PRESET_STEP_INPUT_SCOPES)
const AGENT_PRESET_DESTINATION_SET = new Set<string>(AGENT_PRESET_STEP_DESTINATIONS)

export function createAgentPresetCommand(
  args: AgentPresetCommandArgs,
): JsonCommandMutationResult<{ presetId: string }> {
  const body = readObject(args.body, 'request body')
  const source = readObject(body.preset, 'preset')
  if (hasOwn(source, 'id')) {
    throw new ValidationError('preset.id is server-generated')
  }

  return applyAgentPresetSettingsMutation(args, (target) => {
    const presets = currentAgentPresets(target)
    const presetId = mintAgentPresetId(new Set(presets.map((preset) => preset.id)))
    const now = Date.now()
    const preset = readPresetRecord(
      {
        name: 'New Agent Preset',
        enabled: true,
        version: AGENT_PRESET_SCHEMA_VERSION,
        steps: [],
        createdAt: now,
        updatedAt: now,
        ...source,
        id: presetId,
      },
      'preset',
    )
    if (presets.some((candidate) => candidate.id === preset.id)) {
      throw new ValidationError(`Duplicate Agent Preset id: ${preset.id}`)
    }
    target.agentPresets = readPresetCollectionForWrite([...presets, preset])
    normalizeAgentPresetDefault(target)
    return {
      event: { ...COMMAND_EVENT_CATALOG.agentPresetCreated, id: presetId },
      extra: { presetId },
    }
  })
}

export function updateAgentPresetCommand(
  args: AgentPresetCommandArgs & { presetId: string },
): JsonCommandMutationResult<{ presetId: string }> {
  const presetId = readNonEmptyString(args.presetId, 'presetId')
  const body = readObject(args.body, 'request body')
  const patch = readPresetMetadataPatch(body.patch)

  return applyAgentPresetSettingsMutation(args, (target) => {
    const presets = currentAgentPresets(target)
    const index = requireAgentPresetIndex(presets, presetId)
    const next = applyPresetMetadataPatch(presets[index], patch)
    const nextPresets = [...presets]
    nextPresets[index] = next
    target.agentPresets = readPresetCollectionForWrite(nextPresets)
    normalizeAgentPresetDefault(target)
    return {
      event: { ...COMMAND_EVENT_CATALOG.agentPresetUpdated, id: presetId },
      extra: { presetId },
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
    const presets = currentAgentPresets(target)
    const source = presets[requireAgentPresetIndex(presets, sourcePresetId)]
    const usedPresetIds = new Set(presets.map((preset) => preset.id))
    const usedStepIds = new Set(presets.flatMap((preset) => preset.steps.map((step) => step.id)))
    const presetId = mintAgentPresetId(usedPresetIds)
    const duplicated = duplicatePresetRecord(source, presetId, usedStepIds, name)
    target.agentPresets = readPresetCollectionForWrite([...presets, duplicated])
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
    mutate(database) {
      const target = readDatabaseTarget(database)
      const presets = currentAgentPresets(target)
      const index = requireAgentPresetIndex(presets, presetId)
      presets.splice(index, 1)
      target.agentPresets = readPresetCollectionForWrite(presets)
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
): JsonCommandMutationResult<{ agentPresetDefaultId: string | null }> {
  const body = readObject(args.body, 'request body')
  const presetIds = readIdList(body.presetIds, 'presetIds')

  return applyAgentPresetSettingsMutation(args, (target) => {
    const presets = currentAgentPresets(target)
    validateFullPresetOrder(presets, presetIds)
    const byId = new Map(presets.map((preset) => [preset.id, preset]))
    target.agentPresets = readPresetCollectionForWrite(presetIds.map((id) => byId.get(id)!))
    normalizeAgentPresetDefault(target)
    return {
      event: COMMAND_EVENT_CATALOG.agentPresetReordered,
      extra: {
        agentPresetDefaultId: typeof target.agentPresetDefaultId === 'string' ? target.agentPresetDefaultId : null,
      },
    }
  })
}

export function setAgentPresetDefaultCommand(
  args: AgentPresetCommandArgs,
): JsonCommandMutationResult<{ agentPresetDefaultId: string | null }> {
  const body = readObject(args.body, 'request body')
  const rawId = body.agentPresetId ?? body.presetId
  const requestedId = rawId === null ? '' : (readOptionalString(rawId, 'agentPresetId') ?? '')

  return applyAgentPresetSettingsMutation(args, (target) => {
    const presets = currentAgentPresets(target)
    if (requestedId.trim() === '') {
      delete target.agentPresetDefaultId
    } else {
      requireAgentPresetIndex(presets, requestedId)
      target.agentPresetDefaultId = requestedId
    }
    normalizeAgentPresetDefault(target)
    return {
      event: {
        ...COMMAND_EVENT_CATALOG.agentPresetDefaultUpdated,
        ...(typeof target.agentPresetDefaultId === 'string' ? { id: target.agentPresetDefaultId } : {}),
      },
      extra: {
        agentPresetDefaultId: typeof target.agentPresetDefaultId === 'string' ? target.agentPresetDefaultId : null,
      },
    }
  })
}

export function createAgentPresetStepCommand(
  args: AgentPresetCommandArgs & { presetId: string },
): JsonCommandMutationResult<{ presetId: string; stepId: string }> {
  const presetId = readNonEmptyString(args.presetId, 'presetId')
  const body = readObject(args.body, 'request body')
  const source = readObject(body.step, 'step')
  if (hasOwn(source, 'id')) {
    throw new ValidationError('step.id is server-generated')
  }

  return applyAgentPresetSettingsMutation(args, (target) => {
    const presets = currentAgentPresets(target)
    const preset = clonePreset(presets[requireAgentPresetIndex(presets, presetId)])
    const stepId = mintAgentPresetStepId(
      new Set(presets.flatMap((candidate) => candidate.steps.map((step) => step.id))),
    )
    const step = readStepRecordFromCreate(source, stepId, preset.steps)
    preset.steps = [...preset.steps, step]
    preset.updatedAt = Date.now()
    const nextPresets = replacePreset(presets, preset)
    target.agentPresets = readPresetCollectionForWrite(nextPresets)
    normalizeAgentPresetDefault(target)
    return {
      event: { ...COMMAND_EVENT_CATALOG.agentPresetStepCreated, id: stepId, parentId: presetId },
      extra: { presetId, stepId },
    }
  })
}

export function updateAgentPresetStepCommand(
  args: AgentPresetCommandArgs & { presetId: string; stepId: string },
): JsonCommandMutationResult<{ presetId: string; stepId: string }> {
  const presetId = readNonEmptyString(args.presetId, 'presetId')
  const stepId = readNonEmptyString(args.stepId, 'stepId')
  const body = readObject(args.body, 'request body')
  const patch = readStepPatch(body.patch)

  return applyAgentPresetSettingsMutation(args, (target) => {
    const presets = currentAgentPresets(target)
    const preset = clonePreset(presets[requireAgentPresetIndex(presets, presetId)])
    const stepIndex = requireStepIndex(preset, stepId)
    preset.steps[stepIndex] = applyStepPatch(preset.steps[stepIndex], patch)
    preset.updatedAt = Date.now()
    const nextPresets = replacePreset(presets, preset)
    target.agentPresets = readPresetCollectionForWrite(nextPresets)
    normalizeAgentPresetDefault(target)
    return {
      event: { ...COMMAND_EVENT_CATALOG.agentPresetStepUpdated, id: stepId, parentId: presetId },
      extra: { presetId, stepId },
    }
  })
}

export function duplicateAgentPresetStepCommand(
  args: AgentPresetCommandArgs & { presetId: string; stepId: string },
): JsonCommandMutationResult<{ presetId: string; stepId: string; sourceStepId: string }> {
  const presetId = readNonEmptyString(args.presetId, 'presetId')
  const sourceStepId = readNonEmptyString(args.stepId, 'stepId')
  const body = readObject(args.body, 'request body')
  const name = readOptionalNonEmptyString(body.name, 'name')

  return applyAgentPresetSettingsMutation(args, (target) => {
    const presets = currentAgentPresets(target)
    const preset = clonePreset(presets[requireAgentPresetIndex(presets, presetId)])
    const sourceIndex = requireStepIndex(preset, sourceStepId)
    const source = preset.steps[sourceIndex]
    const stepId = mintAgentPresetStepId(
      new Set(presets.flatMap((candidate) => candidate.steps.map((step) => step.id))),
    )
    const duplicated: AgentPresetStepRecord = {
      ...cloneStep(source),
      id: stepId,
      name: name ?? `${source.name} Copy`,
      dependencies: [...source.dependencies],
      runtime: { ...source.runtime },
      inputScopes: [...source.inputScopes],
      model: cloneJson(source.model),
      failurePolicy: cloneJson(source.failurePolicy),
      outputKey: uniqueOutputKey(`${source.outputKey}_copy`, preset.steps, source.phase),
    }
    preset.steps.splice(sourceIndex + 1, 0, duplicated)
    preset.updatedAt = Date.now()
    const nextPresets = replacePreset(presets, preset)
    target.agentPresets = readPresetCollectionForWrite(nextPresets)
    normalizeAgentPresetDefault(target)
    return {
      event: { ...COMMAND_EVENT_CATALOG.agentPresetStepDuplicated, id: stepId, parentId: presetId },
      extra: { presetId, stepId, sourceStepId },
    }
  })
}

export function deleteAgentPresetStepCommand(
  args: AgentPresetCommandArgs & { presetId: string; stepId: string },
): JsonCommandMutationResult<{ presetId: string; stepId: string }> {
  const presetId = readNonEmptyString(args.presetId, 'presetId')
  const stepId = readNonEmptyString(args.stepId, 'stepId')

  return applyAgentPresetSettingsMutation(args, (target) => {
    const presets = currentAgentPresets(target)
    const preset = clonePreset(presets[requireAgentPresetIndex(presets, presetId)])
    const stepIndex = requireStepIndex(preset, stepId)
    preset.steps.splice(stepIndex, 1)
    preset.steps = preset.steps.map((step) => ({
      ...step,
      dependencies: step.dependencies.filter((dependencyId) => dependencyId !== stepId),
    }))
    preset.updatedAt = Date.now()
    const nextPresets = replacePreset(presets, preset)
    target.agentPresets = readPresetCollectionForWrite(nextPresets)
    normalizeAgentPresetDefault(target)
    return {
      event: { ...COMMAND_EVENT_CATALOG.agentPresetStepDeleted, id: stepId, parentId: presetId },
      extra: { presetId, stepId },
    }
  })
}

export function reorderAgentPresetStepsCommand(
  args: AgentPresetCommandArgs & { presetId: string },
): JsonCommandMutationResult<{ presetId: string }> {
  const presetId = readNonEmptyString(args.presetId, 'presetId')
  const body = readObject(args.body, 'request body')
  const stepIds = readIdList(body.stepIds, 'stepIds')

  return applyAgentPresetSettingsMutation(args, (target) => {
    const presets = currentAgentPresets(target)
    const preset = clonePreset(presets[requireAgentPresetIndex(presets, presetId)])
    validateFullStepOrder(preset, stepIds)
    const byId = new Map(preset.steps.map((step) => [step.id, step]))
    preset.steps = stepIds.map((id) => byId.get(id)!)
    preset.updatedAt = Date.now()
    const nextPresets = replacePreset(presets, preset)
    target.agentPresets = readPresetCollectionForWrite(nextPresets)
    normalizeAgentPresetDefault(target)
    return {
      event: { ...COMMAND_EVENT_CATALOG.agentPresetStepReordered, id: presetId },
      extra: { presetId },
    }
  })
}

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
  const presets = normalizeAgentPresets(target.agentPresets)
  assertValidPresetCollection(presets)
  return presets
}

function readPresetCollectionForWrite(value: readonly AgentPresetRecord[]): AgentPresetRecord[] {
  assertValidPresetCollection(value)
  return cloneJson([...value])
}

function readPresetRecord(value: unknown, label: string): AgentPresetRecord {
  const source = readObject(value, label)
  assertMaxConcurrencyValue(source.maxConcurrency, `${label}.maxConcurrency`)
  const preset = normalizeAgentPresets([value])[0]
  if (!preset) {
    throw new ValidationError(`${label}.id must be a non-empty string`)
  }
  assertValidPreset(preset, label)
  return preset
}

function assertValidPresetCollection(presets: readonly AgentPresetRecord[]): void {
  const issues = validateAgentPresetRecords(presets)
  if (issues.length > 0) {
    throw new ValidationError(issues[0].message)
  }
}

function assertValidPreset(preset: AgentPresetRecord, label: string): void {
  const issues = validateAgentPresetRecord(preset, label)
  if (issues.length > 0) {
    throw new ValidationError(issues[0].message)
  }
}

function readPresetMetadataPatch(value: unknown): Record<string, unknown> {
  const patch = readObject(value, 'patch')
  const allowed = new Set(['name', 'description', 'enabled', 'maxConcurrency'])
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

function applyPresetMetadataPatch(preset: AgentPresetRecord, patch: Record<string, unknown>): AgentPresetRecord {
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
  if (hasOwn(patch, 'enabled')) next.enabled = patch.enabled as boolean
  if (hasOwn(patch, 'maxConcurrency')) {
    if (patch.maxConcurrency === null) {
      delete next.maxConcurrency
    } else {
      next.maxConcurrency = patch.maxConcurrency as number
    }
  }
  next.updatedAt = Date.now()
  return readPresetRecord(next, 'agentPreset')
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
    'runtime',
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
  if (key === 'runtime') readRuntimeOptions(value, 'patch.runtime')
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
    throw new ValidationError(`${label} must be promptOutput, intermediate, or finalOutput`)
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
): AgentPresetRecord {
  const stepIdMap = new Map<string, string>()
  for (const step of source.steps) {
    stepIdMap.set(step.id, mintAgentPresetStepId(usedStepIds))
  }
  const now = Date.now()
  return readPresetRecord(
    {
      ...clonePreset(source),
      id: presetId,
      name: name ?? `${source.name} Copy`,
      steps: source.steps.map((step) => ({
        ...cloneStep(step),
        id: stepIdMap.get(step.id)!,
        dependencies: step.dependencies.map((dependencyId) => stepIdMap.get(dependencyId) ?? dependencyId),
      })),
      createdAt: now,
      updatedAt: now,
    },
    'agentPreset',
  )
}

function requireAgentPresetIndex(presets: readonly AgentPresetRecord[], presetId: string): number {
  const index = presets.findIndex((preset) => preset.id === presetId)
  if (index === -1) throw new EntityNotFoundError(`Agent Preset not found: ${presetId}`)
  return index
}

function requireStepIndex(preset: AgentPresetRecord, stepId: string): number {
  const index = preset.steps.findIndex((step) => step.id === stepId)
  if (index === -1) throw new EntityNotFoundError(`Agent Preset step not found: ${stepId}`)
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
    preset.steps.map((step) => step.id),
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
  const presets = normalizeAgentPresets(target.agentPresets)
  target.agentPresets = presets
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
