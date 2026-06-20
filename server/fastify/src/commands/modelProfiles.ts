import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { FirstClassModelProfileProviderId } from '../../../../src/ts/model/modelProfileResolver.js'
import {
  MODEL_ROLES,
  modelRoleProfileInheritSource,
  resolveModelForRole,
  type ModelRole,
} from '../../../../src/ts/model/modelRoles.js'
import {
  ModelProfileRecordValidationError,
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
import { AnthropicModels } from '../../../../src/ts/model/providers/anthropic.js'
import { GoogleModels } from '../../../../src/ts/model/providers/google.js'
import { OpenAIModels } from '../../../../src/ts/model/providers/openai.js'
import { LLMFormat } from '../../../../src/ts/model/types.js'
import { resolveMaskedProviderSecretPlaceholders } from '../providerSecrets.js'
import { EntityNotFoundError, extractSettings, ValidationError, writeSettingsOnly } from '../repository.js'
import { applyTargetedCommandMutation, TARGETED_MUTATION_PATHS, type JsonCommandMutationResult } from './mutations.js'
import {
  COMMAND_EVENT_CATALOG,
  type CommandEventDraft,
  type CommandEventOrigin,
  type CommandEventSink,
} from './events.js'

interface ModelProfileCommandArgs {
  db: DatabaseSync
  dataDir: string
  baseRevision: number
  eventSink: CommandEventSink
  eventOrigin?: CommandEventOrigin
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
  return applyModelProfileMutation(args, (target) => {
    const profiles = currentProfiles(target)
    const index = profiles.findIndex((profile) => profile.id === profileId)
    if (index < 0) throw new EntityNotFoundError(`Model profile not found: ${profileId}`)
    const nextRows = [...profiles]
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
  const includeSecrets = readOptionalBoolean(body.includeSecrets, 'includeSecrets') ?? false
  return applyModelProfileMutation(args, (target) => {
    const profiles = currentProfiles(target)
    const source = profiles.find((profile) => profile.id === sourceProfileId)
    if (!source) throw new EntityNotFoundError(`Model profile not found: ${sourceProfileId}`)
    const profileId = mintModelProfileId(profiles)
    const profile = duplicateProfile(source, profileId, name, includeSecrets)
    target.modelProfiles = readProfilesForWrite([...profiles, profile], target)
    return {
      event: { ...COMMAND_EVENT_CATALOG.modelProfileDuplicated, id: profileId },
      extra: { profileId, sourceProfileId },
    }
  })
}

export function deleteModelProfileCommand(
  args: ModelProfileCommandArgs & { profileId: string },
): JsonCommandMutationResult<{ profileId: string; reassignedRoles: ModelRole[] }> {
  const profileId = readNonEmptyString(args.profileId, 'profileId')
  const body = readObject(args.body, 'request body')
  const reassignments = readReassignmentMap(body.reassignments)
  return applyModelProfileMutation(args, (target) => {
    const profiles = currentProfiles(target)
    if (!profiles.some((profile) => profile.id === profileId)) {
      throw new EntityNotFoundError(`Model profile not found: ${profileId}`)
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
    return {
      event: { ...COMMAND_EVENT_CATALOG.modelProfileDeleted, id: profileId },
      extra: { profileId, reassignedRoles },
    }
  })
}

export function updateModelRoleProfilesCommand(
  args: ModelProfileCommandArgs,
): JsonCommandMutationResult<{ roles: ModelRole[] }> {
  const body = readObject(args.body, 'request body')
  const bindings = readPartialRoleBindings(body.bindings)
  return applyModelProfileMutation(args, (target) => {
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
    return {
      event: COMMAND_EVENT_CATALOG.modelRoleProfilesUpdated,
      extra: { roles },
    }
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
    const nextProfiles = readProfilesForWrite([...profiles, profile], target)
    const nextBindings = currentRoleProfiles(target)
    nextBindings[role] = { mode: 'profile', profileId }
    target.modelProfiles = nextProfiles
    target.modelRoleProfiles = nextBindings
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
  return Array.isArray(target.modelProfiles) ? readProfilesForWrite(target.modelProfiles, target) : []
}

function currentRoleProfiles(target: Record<string, unknown>): ModelRoleProfileMap {
  return normalizeModelRoleProfiles(target.modelRoleProfiles)
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

function duplicateProfile(
  source: ModelProfileRecord,
  profileId: string,
  name: string | undefined,
  includeSecrets: boolean,
): ModelProfileRecord {
  const copy = cloneJsonValue(source)
  copy.id = profileId
  copy.name = name ?? `${source.name} Copy`
  if (!includeSecrets) {
    delete copy.providerOptions?.apiKey
    if (copy.providerOptions?.vertex) delete copy.providerOptions.vertex.privateKey
  }
  return readProfileRow(copy)
}

function createLegacyConvertedProfile(input: {
  id: string
  role: ModelRole
  modelId: string
  database: Record<string, unknown>
  runtimeOptions?: ModelProfileRecordRuntimeOptions
  fallbacks?: ModelProfileRecordFallbackRef[]
}): ModelProfileRecord {
  const provider = legacyProviderMapping(input.database, input.modelId)
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
        apiKey: nonBlankString(database.proxyKey),
        baseUrl: stripTrailingPath(nonBlankString(database.forceReplaceUrl), '/chat/completions'),
        requestModel: nonBlankString(database.customProxyRequestModel),
        additionalParams: readAdditionalParams(database.additionalParams),
      }),
    }
  }

  if (isOpenAIModelId(normalizedModelId)) {
    return {
      modelId: normalizedModelId,
      providerId: 'openai',
      providerOptions: removeEmptyProviderOptions({ apiKey: nonBlankString(database.openAIKey) }),
    }
  }

  if (isAnthropicModelId(normalizedModelId)) {
    return {
      modelId: normalizedModelId,
      providerId: 'anthropic',
      providerOptions: removeEmptyProviderOptions({ apiKey: nonBlankString(database.claudeAPIKey) }),
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
            clientEmail: nonBlankString(database.vertexClientEmail),
            privateKey: nonBlankString(database.vertexPrivateKey),
          }),
        }),
      }
    }
    return {
      modelId: normalizedModelId,
      providerId: 'google',
      providerOptions: removeEmptyProviderOptions({ apiKey: nonBlankString(google.accessToken) }),
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

function readObject(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ValidationError(`${path} must be an object`)
  return value
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

function readOptionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new ValidationError(`${path} must be a boolean`)
  return value
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
