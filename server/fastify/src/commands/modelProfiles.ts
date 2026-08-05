import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { isDeepStrictEqual } from 'node:util'
import {
  resolveModelProfile,
  type FirstClassModelProfileProviderId,
} from '../../../../src/ts/model/modelProfileResolver.js'
import { resolveMemoryModelCapability } from '../../../../src/ts/model/memoryModelCapability.js'
import type { Database } from '../../../../src/ts/storage/database.svelte.js'
import {
  MODEL_ROLES,
  modelRoleProfileInheritSource,
  resolveModelForRole,
  type ModelRole,
} from '../../../../src/ts/model/modelRoles.js'
import {
  ModelProfileRecordValidationError,
  normalizeModelProfiles,
  normalizeModelProfileRuntimeOptions,
  normalizeModelRoleProfiles,
  readModelProfiles,
  readModelRuntimeDefaults,
  readModelRoleProfiles,
  type ModelProfileRecord,
  type ModelProfileRecordFallbackRef,
  type ModelProfileRecordProviderOptions,
  type ModelProfileRecordRuntimeOptions,
  type ModelRoleProfileBinding,
  type ModelRoleProfileMap,
  type ModelRuntimeDefaults,
} from '../../../../src/ts/model/modelProfileRecords.js'
import {
  ProviderCredentialRecordValidationError,
  readProviderCredentials,
  type ProviderCredentialRecord,
} from '../../../../src/ts/model/providerCredentialRecords.js'
import { AnthropicModels } from '../../../../src/ts/model/providers/anthropic.js'
import { GoogleModels } from '../../../../src/ts/model/providers/google.js'
import { OpenAIModels } from '../../../../src/ts/model/providers/openai.js'
import { LLMFormat } from '../../../../src/ts/model/types.js'
import { resolveMaskedProviderSecretPlaceholders } from '../providerSecrets.js'
import {
  EntityNotFoundError,
  extractSettings,
  RevisionMismatchError,
  ValidationError,
  writeSettingsOnly,
  writeSingleCollectionRow,
} from '../repository.js'
import {
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
import { ensureModelPresetCollection, readModelPresetId, requireModelPresetIndex } from './splitPresets.js'

interface ModelProfileCommandArgs {
  db: DatabaseSync
  dataDir: string
  baseRevision: number
  eventSink: CommandEventSink
  eventOrigin?: CommandEventOrigin
  mutationReceiptKey?: CommandMutationReceiptKey
  body: unknown
}

type ModelProfileMutationExtra = Record<string, unknown>
type ProfileIdsByRole = Record<ModelRole, string>

const MODEL_ROLE_SET = new Set<string>(MODEL_ROLES)
const OPENAI_MODEL_IDS = new Set(
  OpenAIModels.flatMap((model) => [model.id, model.internalID]).filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  ),
)
const ANTHROPIC_MODEL_IDS = new Set(
  AnthropicModels.flatMap((model) => [model.id, model.internalID]).filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  ),
)
const GOOGLE_MODEL_IDS = new Set(
  GoogleModels.flatMap((model) => [model.id, model.internalID]).filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  ),
)

const ROLE_PROFILE_NAMES: Record<ModelRole, string> = {
  chatMain: 'Main Chat',
  chatAux: 'Auxiliary',
  memory: 'Memory',
  emotion: 'Emotion',
  translate: 'Translate',
  otherAx: 'Other Auxiliary',
  scriptMain: 'Script Main',
  scriptAux: 'Script Auxiliary',
}

const RUNTIME_DEFAULT_KEY_MAP = {
  maxContext: 'maxContext',
  maxResponse: 'maxResponse',
  temperature: 'temperature',
  top_p: 'topP',
  top_k: 'topK',
  min_p: 'minP',
  top_a: 'topA',
  repetition_penalty: 'repetitionPenalty',
  frequencyPenalty: 'frequencyPenalty',
  PresensePenalty: 'presencePenalty',
  reasoningEffort: 'reasoningEffort',
  thinkingTokens: 'thinkingTokens',
  verbosity: 'verbosity',
  genTime: 'genTime',
  thinkingType: 'thinkingType',
  deepseekThinkingType: 'deepseekThinkingType',
  adaptiveThinkingEffort: 'adaptiveThinkingEffort',
  deepseekReasoningEffort: 'deepseekReasoningEffort',
  extractJson: 'extractJson',
  jsonSchema: 'jsonSchema',
  customTokenizer: 'customTokenizer',
  useStreaming: 'useStreaming',
  jsonSchemaEnabled: 'jsonSchemaEnabled',
  strictJsonSchema: 'strictJsonSchema',
  outputImageModal: 'outputImageModal',
  enableCustomFlags: 'enableCustomFlags',
  dynamicOutput: 'dynamicOutput',
  modelTools: 'modelTools',
  customFlags: 'customFlags',
} as const satisfies Record<string, keyof ModelRuntimeDefaults>

const SEPARATE_PARAMETER_KEY_MAP = {
  temperature: 'temperature',
  top_p: 'topP',
  top_k: 'topK',
  min_p: 'minP',
  top_a: 'topA',
  repetition_penalty: 'repetitionPenalty',
  frequency_penalty: 'frequencyPenalty',
  presence_penalty: 'presencePenalty',
  reasoning_effort: 'reasoningEffort',
  thinking_tokens: 'thinkingTokens',
  verbosity: 'verbosity',
  thinking_type: 'thinkingType',
  deepseek_thinking_type: 'deepseekThinkingType',
  adaptive_thinking_effort: 'adaptiveThinkingEffort',
  deepseek_reasoning_effort: 'deepseekReasoningEffort',
  outputImageModal: 'outputImageModal',
} as const satisfies Record<string, keyof ModelProfileRecordRuntimeOptions>

export function createModelProfileCommand(
  args: ModelProfileCommandArgs,
): JsonCommandMutationResult<{ profileId: string }> {
  const body = readObject(args.body, 'request body')
  const requestedProfile = readCreateProfileBody(body)
  return applyModelProfileMutation(args, (target) => {
    const profiles = currentProfiles(target)
    const profileId = mintModelProfileId(profiles)
    const profile = readProfileRow({ ...requestedProfile, id: profileId })
    validateProfileCredentialReference(profile, target, 'profile.providerOptions.credentialId')
    const nextProfiles = readProfilesForWrite([...profiles, profile], target)
    target.modelProfiles = nextProfiles
    return {
      event: { ...COMMAND_EVENT_CATALOG.modelProfileCreated, id: profileId },
      extra: { profileId },
    }
  })
}

export function updateModelProfileCommand(
  args: ModelProfileCommandArgs & { profileId: string },
): JsonCommandMutationResult<{ profileId: string }> {
  const profileId = readNonEmptyString(args.profileId, 'profileId')
  const body = readObject(args.body, 'request body')
  const requestedProfile = readUpdateProfileBody(body, profileId)
  const expectedProfile = readExpectedProfileBody(body, profileId)
  return applyModelProfileMutation(args, (target) => {
    const profiles = currentProfiles(target)
    const index = profiles.findIndex((profile) => profile.id === profileId)
    if (index < 0) throw new EntityNotFoundError(`Model profile not found: ${profileId}`)
    const resolvedExpectedProfile = readProfilesForWrite([expectedProfile], target)[0]
    if (!isDeepStrictEqual(profiles[index], resolvedExpectedProfile)) {
      throw new RevisionMismatchError(args.baseRevision, `Model profile changed since editing began: ${profileId}`)
    }
    const nextRows = [...profiles]
    validateProfileCredentialReference(requestedProfile, target, 'profile.providerOptions.credentialId')
    nextRows[index] = requestedProfile
    target.modelProfiles = readProfilesForWrite(nextRows, target)
    return {
      event: { ...COMMAND_EVENT_CATALOG.modelProfileUpdated, id: profileId },
      extra: { profileId },
    }
  })
}

export function duplicateModelProfileCommand(
  args: ModelProfileCommandArgs & { profileId: string },
): JsonCommandMutationResult<{ profileId: string; sourceProfileId: string }> {
  const sourceProfileId = readNonEmptyString(args.profileId, 'profileId')
  const body = readObject(args.body, 'request body')
  const name = readOptionalNonEmptyString(body.name, 'name')
  return applyModelProfileMutation(args, (target) => {
    const profiles = currentProfiles(target)
    const source = profiles.find((profile) => profile.id === sourceProfileId)
    if (!source) throw new EntityNotFoundError(`Model profile not found: ${sourceProfileId}`)
    const profileId = mintModelProfileId(profiles)
    const profile = duplicateProfile(source, profileId, name)
    target.modelProfiles = readProfilesForWrite([...profiles, profile], target)
    return {
      event: { ...COMMAND_EVENT_CATALOG.modelProfileDuplicated, id: profileId },
      extra: { profileId, sourceProfileId },
    }
  })
}

export function reorderModelProfilesCommand(
  args: ModelProfileCommandArgs,
): JsonCommandMutationResult<{ profileIds: string[] }> {
  const body = readObject(args.body, 'request body')
  const profileIds = readProfileIdOrder(body.profileIds)
  return applyModelProfileMutation(args, (target) => {
    const profiles = currentProfiles(target)
    if (profileIds.length !== profiles.length) {
      throw new ValidationError('profileIds must include every existing model profile exactly once')
    }

    const profilesById = new Map(profiles.map((profile) => [profile.id, profile]))
    const seen = new Set<string>()
    const reorderedProfiles = profileIds.map((profileId) => {
      if (seen.has(profileId)) throw new ValidationError(`Duplicate model profile id: ${profileId}`)
      seen.add(profileId)
      const profile = profilesById.get(profileId)
      if (!profile) throw new ValidationError(`Unknown model profile id: ${profileId}`)
      return profile
    })

    target.modelProfiles = readProfilesForWrite(reorderedProfiles, target)
    return {
      event: COMMAND_EVENT_CATALOG.modelProfilesReordered,
      extra: { profileIds: [...profileIds] },
    }
  })
}

export function deleteModelProfileCommand(
  args: ModelProfileCommandArgs & { profileId: string },
): JsonCommandMutationResult<{ profileId: string; reassignedRoles: ModelRole[] }> {
  const profileId = readNonEmptyString(args.profileId, 'profileId')
  const body = readObject(args.body, 'request body')
  const reassignments = readReassignmentMap(body.reassignments)
  return applyModelProfileMutation(
    args,
    (target) => {
      const profiles = currentProfiles(target)
      if (!profiles.some((profile) => profile.id === profileId)) {
        throw new EntityNotFoundError(`Model profile not found: ${profileId}`)
      }

      const modelPresetLabels = modelPresetLabelsUsingProfile(target, profileId)
      if (modelPresetLabels.length > 0) {
        throw new ValidationError(
          `Model profile ${profileId} is used by Model Presets: ${modelPresetLabels.join(', ')}`,
        )
      }

      const remainingProfiles = profiles.filter((profile) => profile.id !== profileId)
      const remainingIds = new Set(remainingProfiles.map((profile) => profile.id))
      const bindings = currentRoleProfiles(target)
      const reassignedRoles: ModelRole[] = []
      const nextBindings: ModelRoleProfileMap = { ...bindings }

      for (const role of MODEL_ROLES) {
        const binding = bindings[role]
        if (binding.mode !== 'profile' || binding.profileId !== profileId) continue
        const reassignment = reassignments[role]
        if (!reassignment) {
          throw new ValidationError(`reassignments.${role} is required`)
        }
        validateBindingTarget(role, reassignment, remainingIds, `reassignments.${role}`)
        nextBindings[role] = reassignment
        reassignedRoles.push(role)
      }

      for (const role of Object.keys(reassignments)) {
        if (!reassignedRoles.includes(role as ModelRole)) {
          throw new ValidationError(`reassignments.${role} does not target the deleted profile`)
        }
      }

      target.modelProfiles = readProfilesForWrite(remainingProfiles, target)
      target.modelRoleProfiles = nextBindings
      if (reassignedRoles.includes('memory')) validateMemoryRoleCapability(target)
      return {
        event: { ...COMMAND_EVENT_CATALOG.modelProfileDeleted, id: profileId },
        extra: { profileId, reassignedRoles },
      }
    },
    'modelPresets',
  )
}

export function updateModelRoleProfilesCommand(
  args: ModelProfileCommandArgs,
): JsonCommandMutationResult<{ roles: ModelRole[] }> {
  const body = readObject(args.body, 'request body')
  const bindings = readPartialRoleBindings(body.bindings)
  const modelPresetId = body.modelPresetId === undefined ? null : readModelPresetId(body.modelPresetId)

  const mutateTarget = (target: Record<string, unknown>) => {
    const profileIds = new Set(currentProfiles(target).map((profile) => profile.id))
    const nextBindings = currentRoleProfiles(target)
    const roles = MODEL_ROLES.filter((role) => Object.prototype.hasOwnProperty.call(bindings, role))
    if (roles.length === 0) throw new ValidationError('bindings must include at least one role')

    for (const role of roles) {
      const binding = bindings[role]
      if (!binding) continue
      validateBindingTarget(role, binding, profileIds, `bindings.${role}`)
      nextBindings[role] = binding
    }

    target.modelRoleProfiles = nextBindings
    if (roles.includes('memory')) validateMemoryRoleCapability(target)
    return {
      nextBindings,
      roles,
    }
  }

  if (!modelPresetId) {
    return applyModelProfileMutation(args, (target) => {
      const { roles } = mutateTarget(target)
      return {
        event: COMMAND_EVENT_CATALOG.modelRoleProfilesUpdated,
        extra: { roles },
      }
    })
  }

  return applyTargetedCommandMutation<{ roles: ModelRole[] }>({
    db: args.db,
    dataDir: args.dataDir,
    baseRevision: args.baseRevision,
    eventSink: args.eventSink,
    ...(args.eventOrigin ? { eventOrigin: args.eventOrigin } : {}),
    ...(args.mutationReceiptKey ? { mutationReceiptKey: args.mutationReceiptKey } : {}),
    mutationPath: TARGETED_MUTATION_PATHS.collection,
    collectionScopedRead: ['modelPresets'],
    mutate(database, innerDb) {
      const target = readSettingsTarget(database)
      const { nextBindings, roles } = mutateTarget(target)
      const modelPresets = ensureModelPresetCollection(target)
      const modelPresetIndex = requireModelPresetIndex(modelPresets, modelPresetId)
      modelPresets[modelPresetIndex] = {
        ...modelPresets[modelPresetIndex],
        modelRoleProfiles: cloneJsonValue(nextBindings),
      }
      writeSettingsOnly(innerDb, extractSettings(target))
      writeSingleCollectionRow(innerDb, 'modelPresets', modelPresetIndex, modelPresets[modelPresetIndex])
      return {
        event: { ...COMMAND_EVENT_CATALOG.modelPresetUpdated, id: modelPresetId },
        extra: { roles },
      }
    },
  })
}

export function createAndBindModelProfileCommand(
  args: ModelProfileCommandArgs,
): JsonCommandMutationResult<{ profileId: string; role: ModelRole }> {
  const body = readObject(args.body, 'request body')
  const role = readModelRole(body.role, 'role')
  const requestedProfile = readCreateProfileBody(body)
  return applyModelProfileMutation(args, (target) => {
    const profiles = currentProfiles(target)
    const profileId = mintModelProfileId(profiles)
    const profile = readProfileRow({ ...requestedProfile, id: profileId })
    validateProfileCredentialReference(profile, target, 'profile.providerOptions.credentialId')
    const nextProfiles = readProfilesForWrite([...profiles, profile], target)
    const nextBindings = currentRoleProfiles(target)
    nextBindings[role] = { mode: 'profile', profileId }
    target.modelProfiles = nextProfiles
    target.modelRoleProfiles = nextBindings
    if (role === 'memory') validateMemoryRoleCapability(target)
    return {
      event: { ...COMMAND_EVENT_CATALOG.modelProfileCreatedAndBound, id: profileId },
      extra: { profileId, role },
    }
  })
}

export function updateModelRuntimeDefaultsCommand(args: ModelProfileCommandArgs): JsonCommandMutationResult<{}> {
  const body = readObject(args.body, 'request body')
  const runtimeDefaults = readRuntimeDefaultsBody(body)
  return applyModelProfileMutation(args, (target) => {
    target.modelRuntimeDefaults = runtimeDefaults
    return {
      event: COMMAND_EVENT_CATALOG.modelRuntimeDefaultsUpdated,
      extra: {},
    }
  })
}

export function convertLegacyModelProfilesCommand(
  args: ModelProfileCommandArgs,
): JsonCommandMutationResult<{ profileIdsByRole: ProfileIdsByRole; convertedRoles: ModelRole[] }> {
  return applyModelProfileMutation(args, (target) => {
    const existingProfiles = currentProfiles(target)
    const existingCredentials = currentProviderCredentials(target)
    const nextCredentials = [...existingCredentials]
    const credentialMinter = createLegacyCredentialMinter(nextCredentials)
    mintLegacyProviderCredentials(target, credentialMinter)
    const usedIds = new Set(existingProfiles.map((profile) => profile.id))
    const runtimeDefaults = legacyRuntimeDefaults(target)
    const roleModels = Object.fromEntries(
      MODEL_ROLES.map((role) => [role, resolveModelForRole(target, role)]),
    ) as Record<ModelRole, string>
    const legacyFallbacks = readLegacyFallbacks(target)
    const roleRuntimeOptions = Object.fromEntries(
      MODEL_ROLES.map((role) => [role, legacyRuntimeOptionsForRole(target, role, roleModels[role], runtimeDefaults)]),
    ) as Record<ModelRole, ModelProfileRecordRuntimeOptions | undefined>

    const nextProfiles = [...existingProfiles]
    const nextBindings = currentRoleProfiles(target)
    const profileIdsByRole = {} as ProfileIdsByRole

    const createConverted = (role: ModelRole): string => {
      const profileId = mintModelProfileIdFromIds(usedIds)
      usedIds.add(profileId)
      const profile = createLegacyConvertedProfile({
        id: profileId,
        role,
        modelId: roleModels[role],
        database: target,
        credentialMinter,
        runtimeOptions: roleRuntimeOptions[role],
        fallbacks: legacyFallbacks[role],
      })
      nextProfiles.push(profile)
      profileIdsByRole[role] = profileId
      nextBindings[role] = { mode: 'profile', profileId }
      return profileId
    }

    const mainProfileId = createConverted('chatMain')
    const auxProfileId = createConverted('chatAux')

    for (const role of MODEL_ROLES) {
      if (role === 'chatMain' || role === 'chatAux') continue
      const sourceRole = modelRoleProfileInheritSource(role)
      const sourceProfileId = sourceRole === 'chatMain' ? mainProfileId : auxProfileId
      if (
        sourceRole &&
        roleModels[role] === roleModels[sourceRole] &&
        runtimeRecordsEqual(roleRuntimeOptions[role], roleRuntimeOptions[sourceRole]) &&
        fallbackRefsEqual(legacyFallbacks[role], legacyFallbacks[sourceRole])
      ) {
        nextBindings[role] = { mode: 'inherit' }
        profileIdsByRole[role] = sourceProfileId
        continue
      }
      createConverted(role)
    }

    target.modelProfiles = readProfilesForWrite(nextProfiles, target)
    target.providerCredentials = readProviderCredentialRows(nextCredentials)
    target.modelRoleProfiles = nextBindings
    target.modelRuntimeDefaults = runtimeDefaults
    return {
      event: COMMAND_EVENT_CATALOG.modelProfilesLegacyConverted,
      extra: {
        profileIdsByRole,
        convertedRoles: [...MODEL_ROLES],
      },
    }
  })
}

function applyModelProfileMutation<TExtra extends ModelProfileMutationExtra = {}>(
  args: Omit<ModelProfileCommandArgs, 'body'>,
  mutateTarget: (target: Record<string, unknown>) => { event: CommandEventDraft; extra: TExtra },
  readScope: 'settings' | 'modelPresets' = 'settings',
): JsonCommandMutationResult<TExtra> {
  return applyTargetedCommandMutation<TExtra>({
    db: args.db,
    dataDir: args.dataDir,
    baseRevision: args.baseRevision,
    eventSink: args.eventSink,
    ...(args.eventOrigin ? { eventOrigin: args.eventOrigin } : {}),
    ...(args.mutationReceiptKey ? { mutationReceiptKey: args.mutationReceiptKey } : {}),
    mutationPath: readScope === 'modelPresets' ? TARGETED_MUTATION_PATHS.collection : TARGETED_MUTATION_PATHS.settings,
    ...(readScope === 'modelPresets'
      ? { collectionScopedRead: ['modelPresets'] as const }
      : { settingsScopedRead: true }),
    mutate(database, innerDb) {
      const target = readSettingsTarget(database)
      const result = mutateTarget(target)
      writeSettingsOnly(innerDb, extractSettings(target))
      return result
    },
  })
}

function readSettingsTarget(database: unknown): Record<string, unknown> {
  if (!isRecord(database)) {
    throw new ValidationError('database must be an object before settings commands can run')
  }
  return database
}

function currentProfiles(target: Record<string, unknown>): ModelProfileRecord[] {
  return normalizeModelProfiles(target.modelProfiles ?? [])
}

function currentRoleProfiles(target: Record<string, unknown>): ModelRoleProfileMap {
  return normalizeModelRoleProfiles(target.modelRoleProfiles)
}

function modelPresetLabelsUsingProfile(target: Record<string, unknown>, profileId: string): string[] {
  if (!Array.isArray(target.modelPresets)) return []
  const labels: string[] = []
  target.modelPresets.forEach((value, index) => {
    if (!isRecord(value)) return
    const bindings = normalizeModelRoleProfiles(value.modelRoleProfiles)
    const referencesProfile = MODEL_ROLES.some((role) => {
      const binding = bindings[role]
      return binding.mode === 'profile' && binding.profileId === profileId
    })
    if (!referencesProfile) return
    labels.push(nonBlankString(value.name) ?? `#${index + 1}`)
  })
  return labels
}

function readProfilesForWrite(value: unknown, sourceDatabase: unknown): ModelProfileRecord[] {
  try {
    const resolved = resolveMaskedProviderSecretPlaceholders(sourceDatabase, { modelProfiles: value })
    return readModelProfiles(resolved.modelProfiles)
  } catch (error) {
    throwModelProfileValidationError(error)
  }
}

function readProfileRow(value: unknown): ModelProfileRecord {
  try {
    return readModelProfiles([value])[0]
  } catch (error) {
    throwModelProfileValidationError(error)
  }
}

function readRoleProfiles(value: unknown): ModelRoleProfileMap {
  try {
    return readModelRoleProfiles(value)
  } catch (error) {
    throwModelProfileValidationError(error)
  }
}

function readRuntimeDefaults(value: unknown): ModelRuntimeDefaults {
  try {
    return readModelRuntimeDefaults(value)
  } catch (error) {
    throwModelProfileValidationError(error)
  }
}

function throwModelProfileValidationError(error: unknown): never {
  if (error instanceof ModelProfileRecordValidationError) {
    throw new ValidationError(error.message)
  }
  throw error
}

function readCreateProfileBody(body: Record<string, unknown>): Record<string, unknown> {
  const profile = readObject(body.profile, 'profile')
  if (Object.prototype.hasOwnProperty.call(profile, 'id')) {
    throw new ValidationError('profile.id is server-generated')
  }
  return profile
}

function readUpdateProfileBody(body: Record<string, unknown>, profileId: string): ModelProfileRecord {
  const profile = readObject(body.profile, 'profile')
  if (Object.prototype.hasOwnProperty.call(profile, 'id') && profile.id !== profileId) {
    throw new ValidationError('profile.id must match profileId')
  }
  return readProfileRow({ ...profile, id: profileId })
}

function readExpectedProfileBody(body: Record<string, unknown>, profileId: string): ModelProfileRecord {
  const profile = readObject(body.expectedProfile, 'expectedProfile')
  if (Object.prototype.hasOwnProperty.call(profile, 'id') && profile.id !== profileId) {
    throw new ValidationError('expectedProfile.id must match profileId')
  }
  return readProfileRow({ ...profile, id: profileId })
}

function readRuntimeDefaultsBody(body: Record<string, unknown>): ModelRuntimeDefaults {
  if (!Object.prototype.hasOwnProperty.call(body, 'runtimeDefaults')) {
    throw new ValidationError('runtimeDefaults is required')
  }
  return readRuntimeDefaults(body.runtimeDefaults)
}

function readPartialRoleBindings(value: unknown): Partial<Record<ModelRole, ModelRoleProfileBinding>> {
  const raw = readObject(value, 'bindings')
  const bindings: Partial<Record<ModelRole, ModelRoleProfileBinding>> = {}
  for (const [rawRole, binding] of Object.entries(raw)) {
    const role = readModelRole(rawRole, `bindings.${rawRole}`)
    bindings[role] = readSingleRoleBinding(role, binding, `bindings.${role}`)
  }
  return bindings
}

function readReassignmentMap(value: unknown): Partial<Record<ModelRole, ModelRoleProfileBinding>> {
  const raw = readObject(value, 'reassignments')
  const bindings: Partial<Record<ModelRole, ModelRoleProfileBinding>> = {}
  for (const [rawRole, binding] of Object.entries(raw)) {
    const role = readModelRole(rawRole, `reassignments.${rawRole}`)
    bindings[role] = readSingleRoleBinding(role, binding, `reassignments.${role}`)
  }
  return bindings
}

function readSingleRoleBinding(role: ModelRole, binding: unknown, path: string): ModelRoleProfileBinding {
  return readRoleProfiles({ [role]: binding })[role]
}

function validateBindingTarget(
  role: ModelRole,
  binding: ModelRoleProfileBinding,
  profileIds: Set<string>,
  path: string,
): void {
  if (binding.mode === 'profile' && !profileIds.has(binding.profileId)) {
    throw new ValidationError(`${path}.profileId must reference an existing profile`)
  }
  if (binding.mode === 'inherit' && !modelRoleProfileInheritSource(role)) {
    throw new ValidationError(`${path}.mode does not support inherit`)
  }
}

function validateMemoryRoleCapability(target: Record<string, unknown>): void {
  const profile = resolveModelProfile({ database: target as unknown as Database, role: 'memory' })
  const capability = resolveMemoryModelCapability(profile)
  if (capability.ok === false) {
    throw new ValidationError(`bindings.memory is unsupported: ${capability.error}`)
  }
}

function duplicateProfile(source: ModelProfileRecord, profileId: string, name: string | undefined): ModelProfileRecord {
  const copy = cloneJsonValue(source)
  copy.id = profileId
  copy.name = name ?? `${source.name} Copy`
  return readProfileRow(copy)
}

function createLegacyConvertedProfile(input: {
  id: string
  role: ModelRole
  modelId: string
  database: Record<string, unknown>
  credentialMinter: LegacyCredentialMinter
  runtimeOptions?: ModelProfileRecordRuntimeOptions
  fallbacks?: ModelProfileRecordFallbackRef[]
}): ModelProfileRecord {
  const provider = legacyProviderMapping(input.database, input.modelId, input.credentialMinter)
  const row: ModelProfileRecord = {
    id: input.id,
    name: ROLE_PROFILE_NAMES[input.role],
    modelId: provider.modelId,
    ...(provider.providerId ? { providerId: provider.providerId } : {}),
    ...(provider.providerOptions ? { providerOptions: provider.providerOptions } : {}),
    ...(input.runtimeOptions ? { runtimeOptions: input.runtimeOptions } : {}),
    ...(input.fallbacks && input.fallbacks.length > 0 ? { fallbacks: input.fallbacks } : {}),
  }
  return readProfileRow(row)
}

function legacyProviderMapping(
  database: Record<string, unknown>,
  modelId: string,
  credentialMinter: LegacyCredentialMinter,
): {
  modelId: string
  providerId?: FirstClassModelProfileProviderId
  providerOptions?: ModelProfileRecordProviderOptions
} {
  const normalizedModelId = nonBlankString(modelId) ?? ''
  if (
    normalizedModelId === 'reverse_proxy' &&
    asFormat(database.customAPIFormat) === LLMFormat.OpenAICompatible &&
    nonBlankString(database.forceReplaceUrl)
  ) {
    return {
      modelId: 'custom-api',
      providerId: 'custom-api',
      providerOptions: removeEmptyProviderOptions({
        credentialId: credentialMinter.apiKey(nonBlankString(database.proxyKey), 'Proxy (imported)'),
        baseUrl: legacyReverseProxyBaseUrl(
          nonBlankString(database.forceReplaceUrl),
          database.autofillRequestUrl !== false,
          LLMFormat.OpenAICompatible,
        ),
        requestModel: nonBlankString(database.customProxyRequestModel),
        additionalParams: readAdditionalParams(database.additionalParams),
      }),
    }
  }

  if (isOpenAIModelId(normalizedModelId)) {
    return {
      modelId: normalizedModelId,
      providerId: 'openai',
      providerOptions: removeEmptyProviderOptions({
        credentialId: credentialMinter.apiKey(nonBlankString(database.openAIKey), 'OpenAI (imported)'),
      }),
    }
  }

  if (isAnthropicModelId(normalizedModelId)) {
    return {
      modelId: normalizedModelId,
      providerId: 'anthropic',
      providerOptions: removeEmptyProviderOptions({
        credentialId: credentialMinter.apiKey(nonBlankString(database.claudeAPIKey), 'Anthropic (imported)'),
      }),
    }
  }

  if (isGoogleModelId(normalizedModelId)) {
    const google = recordOrEmpty(database.google)
    const vertex = nonBlankString(database.vertexClientEmail) || normalizedModelId.endsWith('-vertex')
    if (vertex) {
      return {
        modelId: normalizedModelId,
        providerId: 'vertex',
        providerOptions: removeEmptyProviderOptions({
          vertex: removeEmptyRecord({
            projectId: nonBlankString(google.projectId),
            region: nonBlankString(database.vertexRegion),
          }),
          credentialId: credentialMinter.vertexServiceAccount(
            nonBlankString(database.vertexClientEmail),
            nonBlankString(database.vertexPrivateKey),
            'Vertex AI (imported)',
          ),
        }),
      }
    }
    return {
      modelId: normalizedModelId,
      providerId: 'google',
      providerOptions: removeEmptyProviderOptions({
        credentialId: credentialMinter.apiKey(nonBlankString(google.accessToken), 'Google (imported)'),
      }),
    }
  }

  return { modelId: normalizedModelId }
}

function legacyRuntimeDefaults(database: Record<string, unknown>): ModelRuntimeDefaults {
  const defaults: Record<string, unknown> = {}
  for (const [legacyKey, runtimeKey] of Object.entries(RUNTIME_DEFAULT_KEY_MAP)) {
    if (Object.prototype.hasOwnProperty.call(database, legacyKey)) {
      defaults[runtimeKey] = cloneJsonValue(database[legacyKey])
    }
  }
  return readRuntimeDefaults(defaults)
}

function legacyRuntimeOptionsForRole(
  database: Record<string, unknown>,
  role: ModelRole,
  modelId: string,
  runtimeDefaults: ModelRuntimeDefaults,
): ModelProfileRecordRuntimeOptions | undefined {
  if (database.seperateParametersEnabled !== true) return undefined
  const seperateParameters = recordOrEmpty(database.seperateParameters)
  const rawParams =
    database.seperateParametersByModel === true
      ? recordOrEmpty(recordOrEmpty(seperateParameters.overrides)[modelId])
      : separateParametersForRole(seperateParameters, role)
  const runtimeOptions = separateParametersToRuntimeOptions(rawParams)
  if (!runtimeOptions) return undefined
  const diff: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(runtimeOptions)) {
    if (!runtimeValuesEqual(value, runtimeDefaults[key as keyof ModelRuntimeDefaults])) diff[key] = value
  }
  return normalizeModelProfileRuntimeOptions(diff)
}

function separateParametersForRole(
  seperateParameters: Record<string, unknown>,
  role: ModelRole,
): Record<string, unknown> {
  if (role === 'chatMain') return {}
  if (role === 'chatAux') return recordOrEmpty(seperateParameters.otherAx)
  if (role === 'scriptMain') {
    const scriptMain = recordOrEmpty(seperateParameters.scriptMain)
    return Object.keys(scriptMain).length > 0 ? scriptMain : {}
  }
  if (role === 'scriptAux') {
    const scriptAux = recordOrEmpty(seperateParameters.scriptAux)
    return Object.keys(scriptAux).length > 0 ? scriptAux : recordOrEmpty(seperateParameters.otherAx)
  }
  return recordOrEmpty(seperateParameters[role])
}

function separateParametersToRuntimeOptions(
  value: Record<string, unknown>,
): ModelProfileRecordRuntimeOptions | undefined {
  const runtime: Record<string, unknown> = {}
  for (const [legacyKey, runtimeKey] of Object.entries(SEPARATE_PARAMETER_KEY_MAP)) {
    if (Object.prototype.hasOwnProperty.call(value, legacyKey)) {
      runtime[runtimeKey] = cloneJsonValue(value[legacyKey])
    }
  }
  return normalizeModelProfileRuntimeOptions(runtime)
}

function readLegacyFallbacks(target: Record<string, unknown>): Record<ModelRole, ModelProfileRecordFallbackRef[]> {
  const fallbackModels = recordOrEmpty(target.fallbackModels)
  return {
    chatMain: readFallbackModels(fallbackModels.model),
    chatAux: [],
    memory: readFallbackModels(fallbackModels.memory),
    emotion: readFallbackModels(fallbackModels.emotion),
    translate: readFallbackModels(fallbackModels.translate),
    otherAx: readFallbackModels(fallbackModels.otherAx),
    scriptMain: readFallbackModels(fallbackModels.scriptMain),
    scriptAux: readFallbackModels(fallbackModels.scriptAux),
  }
}

function readFallbackModels(value: unknown): ModelProfileRecordFallbackRef[] {
  if (!Array.isArray(value)) return []
  const fallbacks: ModelProfileRecordFallbackRef[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const modelId = nonBlankString(item)
    if (!modelId || seen.has(modelId)) continue
    fallbacks.push({ mode: 'model', modelId })
    seen.add(modelId)
  }
  return fallbacks
}

function mintModelProfileId(profiles: readonly ModelProfileRecord[]): string {
  return mintModelProfileIdFromIds(new Set(profiles.map((profile) => profile.id)))
}

function mintModelProfileIdFromIds(existingIds: Set<string>): string {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const id = `mp_${randomUUID().replaceAll('-', '').slice(0, 20)}`
    if (!existingIds.has(id)) return id
  }
  throw new Error('Unable to mint a unique model profile id')
}

interface LegacyCredentialMinter {
  apiKey(secret: string | undefined, name: string): string | undefined
  vertexServiceAccount(
    clientEmail: string | undefined,
    privateKey: string | undefined,
    name: string,
  ): string | undefined
}

function createLegacyCredentialMinter(credentials: ProviderCredentialRecord[]): LegacyCredentialMinter {
  const bySecret = new Map<string, string>()
  for (const credential of credentials) {
    if (credential.type === 'apiKey' && credential.apiKey) {
      bySecret.set(`apiKey:${credential.apiKey}`, credential.id)
    } else if (credential.type === 'vertexServiceAccount' && credential.vertex) {
      bySecret.set(
        `vertexServiceAccount:${credential.vertex.clientEmail}\u0000${credential.vertex.privateKey}`,
        credential.id,
      )
    }
  }

  const mint = (key: string, record: Omit<ProviderCredentialRecord, 'id'>): string => {
    const existing = bySecret.get(key)
    if (existing) return existing
    const id = mintProviderCredentialIdFromIds(new Set(credentials.map((credential) => credential.id)))
    credentials.push({ ...record, id })
    bySecret.set(key, id)
    return id
  }

  return {
    apiKey(secret, name) {
      if (!secret) return undefined
      return mint(`apiKey:${secret}`, { name, type: 'apiKey', apiKey: secret })
    },
    vertexServiceAccount(clientEmail, privateKey, name) {
      if (!clientEmail || !privateKey) return undefined
      return mint(`vertexServiceAccount:${clientEmail}\u0000${privateKey}`, {
        name,
        type: 'vertexServiceAccount',
        vertex: { clientEmail, privateKey },
      })
    },
  }
}

function mintLegacyProviderCredentials(
  database: Record<string, unknown>,
  credentialMinter: LegacyCredentialMinter,
): void {
  const google = recordOrEmpty(database.google)
  credentialMinter.apiKey(nonBlankString(database.openAIKey), 'OpenAI (imported)')
  credentialMinter.apiKey(nonBlankString(database.claudeAPIKey), 'Anthropic (imported)')
  credentialMinter.apiKey(nonBlankString(google.accessToken), 'Google (imported)')
  credentialMinter.vertexServiceAccount(
    nonBlankString(database.vertexClientEmail),
    nonBlankString(database.vertexPrivateKey),
    'Vertex AI (imported)',
  )
  credentialMinter.apiKey(nonBlankString(database.proxyKey), 'Proxy (imported)')
}

function mintProviderCredentialIdFromIds(existingIds: Set<string>): string {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const id = `cred_${randomUUID().replaceAll('-', '').slice(0, 20)}`
    if (!existingIds.has(id)) return id
  }
  throw new Error('Unable to mint a unique provider credential id')
}

function currentProviderCredentials(target: Record<string, unknown>): ProviderCredentialRecord[] {
  return readProviderCredentialRows(target.providerCredentials ?? [])
}

function readProviderCredentialRows(value: unknown): ProviderCredentialRecord[] {
  try {
    return readProviderCredentials(value)
  } catch (error) {
    if (error instanceof ProviderCredentialRecordValidationError) {
      throw new ValidationError(error.message)
    }
    throw error
  }
}

function validateProfileCredentialReference(
  profile: ModelProfileRecord,
  target: Record<string, unknown>,
  path: string,
): void {
  const credentialId = profile.providerOptions?.credentialId
  if (!credentialId) return
  if (!currentProviderCredentials(target).some((credential) => credential.id === credentialId)) {
    throw new ValidationError(`${path} must reference an existing provider credential`)
  }
}

function readObject(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ValidationError(`${path} must be an object`)
  return value
}

function readProfileIdOrder(value: unknown): string[] {
  if (!Array.isArray(value)) throw new ValidationError('profileIds must be an array')
  return value.map((profileId, index) => readNonEmptyString(profileId, `profileIds[${index}]`))
}

function readModelRole(value: unknown, path: string): ModelRole {
  if (typeof value !== 'string' || !MODEL_ROLE_SET.has(value)) {
    throw new ValidationError(`${path} must be a valid model role`)
  }
  return value as ModelRole
}

function readNonEmptyString(value: unknown, path: string): string {
  const normalized = nonBlankString(value)
  if (!normalized) throw new ValidationError(`${path} must be a non-empty string`)
  return normalized
}

function readOptionalNonEmptyString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined
  return readNonEmptyString(value, path)
}

function isOpenAIModelId(modelId: string): boolean {
  return OPENAI_MODEL_IDS.has(modelId) || modelId.startsWith('gpt-') || modelId.endsWith('-response-api')
}

function isAnthropicModelId(modelId: string): boolean {
  return ANTHROPIC_MODEL_IDS.has(modelId) || modelId.startsWith('claude-')
}

function isGoogleModelId(modelId: string): boolean {
  return GOOGLE_MODEL_IDS.has(modelId) || modelId.startsWith('gemini-')
}

function asFormat(value: unknown): LLMFormat | undefined {
  return typeof value === 'number' && Object.values(LLMFormat).includes(value as LLMFormat)
    ? (value as LLMFormat)
    : undefined
}

function readAdditionalParams(value: unknown): Array<[string, string]> | undefined {
  if (!Array.isArray(value)) return undefined
  const rows = value.filter(
    (item): item is [string, string] =>
      Array.isArray(item) && typeof item[0] === 'string' && item[0].trim() !== '' && typeof item[1] === 'string',
  )
  return rows.length > 0 ? rows.map(([key, itemValue]) => [key.trim(), itemValue.trim()]) : undefined
}

function removeEmptyProviderOptions(options: Record<string, unknown>): ModelProfileRecordProviderOptions | undefined {
  const cleaned = removeEmptyRecord(options) as ModelProfileRecordProviderOptions | undefined
  return cleaned && Object.keys(cleaned).length > 0 ? cleaned : undefined
}

function removeEmptyRecord(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const cleaned: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue
    if (isRecord(item)) {
      const nested = removeEmptyRecord(item)
      if (nested && Object.keys(nested).length > 0) cleaned[key] = nested
      continue
    }
    if (Array.isArray(item) && item.length === 0) continue
    if (typeof item === 'string' && item.trim() === '') continue
    cleaned[key] = item
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined
}

function stripTrailingPath(value: string | undefined, path: string): string | undefined {
  if (!value) return undefined
  return value.endsWith(path) ? value.slice(0, -path.length) : value
}

function legacyReverseProxyBaseUrl(
  rawUrl: string | undefined,
  autofill: boolean,
  format: LLMFormat,
): string | undefined {
  if (!rawUrl) return undefined
  const suffix =
    format === LLMFormat.OpenAILegacyInstruct || format === LLMFormat.NanoGPTLegacy
      ? 'completions'
      : format === LLMFormat.OpenAIResponseAPI || format === LLMFormat.NanoGPTResponses
        ? 'responses'
        : 'chat/completions'
  let url = rawUrl
  if (url.startsWith('risu::')) url = url.slice('risu::'.length)
  if (autofill) {
    if (url.endsWith('v1')) {
      url += `/${suffix}`
    } else if (url.endsWith('v1/')) {
      url += suffix
    } else if (!(url.endsWith(suffix) || url.endsWith(`${suffix}/`))) {
      url += url.endsWith('/') ? `v1/${suffix}` : `/v1/${suffix}`
    }
  }
  return stripTrailingPath(url, `/${suffix}`)
}

function fallbackRefsEqual(
  a: readonly ModelProfileRecordFallbackRef[] | undefined,
  b: readonly ModelProfileRecordFallbackRef[] | undefined,
): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
}

function runtimeRecordsEqual(
  a: ModelProfileRecordRuntimeOptions | undefined,
  b: ModelProfileRecordRuntimeOptions | undefined,
): boolean {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {})
}

function runtimeValuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function nonBlankString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
