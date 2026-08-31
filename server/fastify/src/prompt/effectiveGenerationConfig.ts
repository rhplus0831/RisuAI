import type {
  FastifyChat as Chat,
  FastifyCharacter as character,
  FastifyDatabase as Database,
  FastifyMessagePresetInfo as MessagePresetInfo,
} from './serverTypes.js'
import {
  createChatGenerationSettingsIncompleteError,
  resolveChatGenerationSettingsReadiness,
  type ChatGenerationSettingsIncompleteErrorBody,
  type ChatGenerationSettingsReadiness,
} from '@risuai/shared-core/chat-generation-settings'
import type { ModelPresetRecord, PromptPresetRecord } from '../commands/splitPresets.js'
import { mirrorLegacyProfile, type PersonaRecord } from '../commands/personas.js'
import {
  applyEffectivePresetComposition,
  applyPromptPresetModelOverrides,
  isLegacyModelPresetCompatibilityRecord,
  resolvePromptPresetRegexField,
} from '@risuai/shared-core/preset-split'
import {
  modelProfileGenerationBlockReason,
  resolveModelProfile,
  resolveModelProfileTokenizerSelection,
  resolveModelProfileWithLegacyCompatibility,
  type ResolvedModelProfile,
} from '@risuai/shared-core/model-profile-resolver'
import { normalizeModelRoleProfiles } from '@risuai/shared-core/model-profile-records'
import { serverTokenizerUnsupportedReason } from './tokenizerConfig.js'
import { createPromptInfoSnapshot } from '@risuai/shared-core/prompt-info-snapshot'
import { resolveEffectiveAgentPresetId } from '@risuai/shared-core/agent-preset-resolver'
import { combineModuleIntegrations, resolveAgentPresetModuleIntegration } from '@risuai/shared-core/module-integration'
import { resolveUniquePromptPreset } from '@risuai/shared-core/effective-prompt-template'
import { selectedPersonaIndexFromStableId } from '@risuai/shared-core/persona-selection-identity'

type JsonRecord = Record<string, unknown>
type EffectivePromptPresetRecord = PromptPresetRecord & { moduleIntergration?: unknown }

export class ChatGenerationSettingsIncompleteAssemblyError extends Error {
  readonly statusCode = 409
  readonly body: ChatGenerationSettingsIncompleteErrorBody

  constructor(readiness: Pick<ChatGenerationSettingsReadiness, 'missing' | 'staleSidebarToggleKeys'>, chatId?: string) {
    const body = createChatGenerationSettingsIncompleteError(readiness, chatId)
    super(body.message)
    this.name = 'ChatGenerationSettingsIncompleteAssemblyError'
    this.body = body
  }
}

export function isChatGenerationSettingsIncompleteAssemblyError(
  error: unknown,
): error is ChatGenerationSettingsIncompleteAssemblyError {
  return error instanceof ChatGenerationSettingsIncompleteAssemblyError
}

export class ModelProfileGenerationGuardAssemblyError extends Error {
  readonly statusCode = 400
  readonly body: { error: string }

  constructor(message: string) {
    super(message)
    this.name = 'ModelProfileGenerationGuardAssemblyError'
    this.body = { error: message }
  }
}

export function isModelProfileGenerationGuardAssemblyError(
  error: unknown,
): error is ModelProfileGenerationGuardAssemblyError {
  return error instanceof ModelProfileGenerationGuardAssemblyError
}

export interface EffectiveGenerationConfigInput {
  database: Database
  currentChar: character
  currentChat: Chat
  selectedCharID: number
  chatPage: number
}

export interface EffectiveGenerationConfigResult {
  database: Database
  currentChar: character
  currentChat: Chat
  promptInfo: MessagePresetInfo
  resolvedMainProfile: ResolvedModelProfile
}

export function buildEffectiveGenerationConfig(input: EffectiveGenerationConfigInput): EffectiveGenerationConfigResult {
  const settings = input.currentChat.generationSettings
  const effectiveAgentPresetId = resolveEffectiveAgentPresetId(input.database, settings)
  const modelPresets = (input.database.modelPresets ?? []) as unknown as ModelPresetRecord[]
  const promptPresets = (input.database.promptPresets ?? []) as unknown as EffectivePromptPresetRecord[]
  const personas = (input.database.personas ?? []) as PersonaRecord[]
  const selectedModelPreset = findById(modelPresets, settings?.modelPresetId)
  const selectedPromptPreset = resolveUniquePromptPreset(promptPresets, settings?.promptPresetId)
  const readiness = resolveChatGenerationSettingsReadiness({
    settings,
    effectiveAgentPresetId,
    personas,
    modelPresets,
    promptPresets,
    agentPresets: input.database.agentPresets ?? [],
    agents: input.database.agents ?? [],
    modules: input.database.modules ?? [],
    enabledModuleIds: stringArray(input.database.enabledModules),
    characterModuleIds: stringArray(input.currentChar.modules),
    chatModuleIds: stringArray(input.currentChat.modules),
    moduleIntegration:
      typeof selectedPromptPreset?.moduleIntergration === 'string' ? selectedPromptPreset.moduleIntergration : null,
  })

  if (!readiness.ready) {
    throw new ChatGenerationSettingsIncompleteAssemblyError(readiness, input.currentChat.id)
  }

  const persona = findById(personas, settings?.personaId) as PersonaRecord | undefined
  const modelPreset = selectedModelPreset as ModelPresetRecord | undefined
  const promptPreset = selectedPromptPreset as PromptPresetRecord | undefined
  if (!persona || !modelPreset || !promptPreset) {
    throw new ChatGenerationSettingsIncompleteAssemblyError(readiness, input.currentChat.id)
  }

  const promptInfo = createPromptInfoSnapshot({
    enabled: input.database.promptInfoInsideChat === true,
    promptPreset,
    requiredSidebarToggles: readiness.requirements.sidebarToggles,
    sidebarToggles: settings?.sidebarToggles,
  })

  const effectiveDatabase = structuredClone(input.database) as Database
  const effectiveModelPresets = (effectiveDatabase.modelPresets ?? []) as unknown as ModelPresetRecord[]
  const effectivePromptPresets = (effectiveDatabase.promptPresets ?? []) as unknown as EffectivePromptPresetRecord[]
  const effectivePersonas = (effectiveDatabase.personas ?? []) as PersonaRecord[]
  const effectiveModelPresetIndex = effectiveModelPresets.findIndex(
    (candidate: ModelPresetRecord) => candidate.id === modelPreset.id,
  )
  const effectivePromptPreset = resolveUniquePromptPreset(effectivePromptPresets, promptPreset.id)
  const effectivePromptPresetIndex = effectivePromptPreset ? effectivePromptPresets.indexOf(effectivePromptPreset) : -1
  const effectivePersonaIndex = effectivePersonas.findIndex((candidate: PersonaRecord) => candidate.id === persona.id)
  const effectiveModelPreset = effectiveModelPresets[effectiveModelPresetIndex] as ModelPresetRecord | undefined
  const effectivePersona = effectivePersonas[effectivePersonaIndex] as PersonaRecord | undefined

  if (!effectiveModelPreset || !effectivePromptPreset || !effectivePersona) {
    throw new ChatGenerationSettingsIncompleteAssemblyError(readiness, input.currentChat.id)
  }

  effectiveDatabase.modelPresetsId = effectiveModelPresetIndex
  effectiveDatabase.promptPresetsId = effectivePromptPresetIndex
  applyEffectivePresetComposition(effectiveDatabase as unknown as JsonRecord, {
    modelPreset: effectiveModelPreset,
    promptPreset: effectivePromptPreset,
    scope: 'full-generation',
  })
  effectiveDatabase.moduleIntergration = combineModuleIntegrations(
    effectivePromptPreset.moduleIntergration,
    resolveAgentPresetModuleIntegration(effectiveDatabase.agentPresets, effectiveAgentPresetId),
  )
  const promptPresetRegex = resolvePromptPresetRegexField(effectivePromptPreset)
  effectiveDatabase.presetRegex = structuredClone(
    promptPresetRegex.present && Array.isArray(promptPresetRegex.value) ? promptPresetRegex.value : [],
  ) as Database['presetRegex']

  effectiveDatabase.selectedPersonaId = effectivePersona.id
  effectiveDatabase.selectedPersona = selectedPersonaIndexFromStableId(effectiveDatabase)
  mirrorLegacyProfile(effectiveDatabase as unknown as JsonRecord, effectivePersona)

  effectiveDatabase.globalChatVariables = {
    ...recordOfStrings(effectiveDatabase.globalChatVariables),
  }
  for (const [key, value] of Object.entries(settings?.sidebarToggles ?? {})) {
    if (typeof value === 'string') {
      effectiveDatabase.globalChatVariables[`toggle_${key}`] = value
    }
  }
  effectiveDatabase.jailbreakToggle = settings?.jailbreakToggle === true

  const legacyBinding = normalizeModelRoleProfiles(effectiveDatabase.modelRoleProfiles).chatMain.mode === 'legacy'
  const profile =
    isLegacyModelPresetCompatibilityRecord(effectiveModelPreset) || legacyBinding
      ? resolveModelProfileWithLegacyCompatibility({ database: effectiveDatabase })
      : resolveModelProfile({ database: effectiveDatabase })
  const profileBlockReason = modelProfileGenerationBlockReason(profile)
  if (profileBlockReason) {
    throw new ModelProfileGenerationGuardAssemblyError(profileBlockReason)
  }
  applyProfileBoundGenerationFields(effectiveDatabase, profile)
  // Durable profile runtime fields materialize onto the flat request settings.
  // Prompt preset model overrides are the final user-facing layer for a chat, so
  // reapply them after profile runtime defaults/profile-local options.
  applyPromptPresetModelOverrides(effectiveDatabase as unknown as JsonRecord, effectivePromptPreset)
  if (profile.source.kind === 'durable-profile') {
    effectiveDatabase.customTokenizer = resolveModelProfileTokenizerSelection(effectiveDatabase, profile)
  }
  const tokenizerBlockReason = serverTokenizerUnsupportedReason(effectiveDatabase)
  if (tokenizerBlockReason) {
    throw new ModelProfileGenerationGuardAssemblyError(tokenizerBlockReason)
  }

  const effectiveCurrentChar = effectiveDatabase.characters[input.selectedCharID]
  const effectiveStoredChat = effectiveCurrentChar?.chats?.[input.chatPage]
  if (!effectiveCurrentChar || !effectiveStoredChat) {
    throw new ChatGenerationSettingsIncompleteAssemblyError(readiness, input.currentChat.id)
  }

  return {
    database: effectiveDatabase,
    currentChar: effectiveCurrentChar,
    currentChat: structuredClone(effectiveStoredChat) as Chat,
    promptInfo,
    resolvedMainProfile: profile,
  }
}

export function applyProfileBoundGenerationFields(database: Database, profile: ResolvedModelProfile): void {
  if (profile.source.kind !== 'durable-profile') return

  database.aiModel = profile.modelId
  const runtime = profile.runtimeOptions
  assignIfDefined(database, 'maxContext', runtime.maxContext)
  assignIfDefined(database, 'maxResponse', runtime.maxResponse)
  assignIfDefined(database, 'temperature', runtime.rawTemperature)
  assignIfDefined(database, 'top_p', runtime.topP)
  assignIfDefined(database, 'top_k', runtime.topK)
  assignIfDefined(database, 'min_p', runtime.minP)
  assignIfDefined(database, 'top_a', runtime.topA)
  assignIfDefined(database, 'repetition_penalty', runtime.repetitionPenalty)
  assignIfDefined(database, 'frequencyPenalty', scaleSamplerForDatabase(runtime.frequencyPenalty))
  assignIfDefined(database, 'PresensePenalty', scaleSamplerForDatabase(runtime.presencePenalty))
  assignIfDefined(database, 'reasoningEffort', runtime.reasoningEffort)
  assignIfDefined(database, 'thinkingTokens', runtime.thinkingTokens)
  assignIfDefined(database, 'thinkingType', runtime.thinkingType as Database['thinkingType'] | undefined)
  assignIfDefined(
    database,
    'deepseekThinkingType',
    runtime.deepseekThinkingType as Database['deepseekThinkingType'] | undefined,
  )
  assignIfDefined(
    database,
    'adaptiveThinkingEffort',
    runtime.adaptiveThinkingEffort as Database['adaptiveThinkingEffort'] | undefined,
  )
  assignIfDefined(
    database,
    'deepseekReasoningEffort',
    runtime.deepseekReasoningEffort as Database['deepseekReasoningEffort'] | undefined,
  )
  assignIfDefined(database, 'verbosity', runtime.verbosity)
  assignIfDefined(database, 'halfStreaming', runtime.halfStreaming)
  assignIfDefined(database, 'useStreaming', runtime.useStreaming)
  assignIfDefined(database, 'genTime', runtime.genTime)
  assignIfDefined(database, 'extractJson', runtime.extractJson)
  assignIfDefined(database, 'jsonSchemaEnabled', runtime.jsonSchemaEnabled)
  assignIfDefined(database, 'jsonSchema', runtime.jsonSchema)
  assignIfDefined(database, 'strictJsonSchema', runtime.strictJsonSchema)
  assignIfDefined(database, 'outputImageModal', runtime.outputImageModal)
  assignIfDefined(database, 'dynamicOutput', runtime.dynamicOutput as Database['dynamicOutput'])
  database.modelTools = [...runtime.modelTools]
  assignIfDefined(database, 'enableCustomFlags', runtime.enableCustomFlags)
  if (runtime.customFlags !== undefined) database.customFlags = [...runtime.customFlags]
  assignIfDefined(database, 'customTokenizer', runtime.customTokenizer)
}

function assignIfDefined<K extends keyof Database>(database: Database, key: K, value: Database[K] | undefined): void {
  if (value !== undefined) {
    database[key] = value
  }
}

function scaleSamplerForDatabase(value: number | undefined): number | undefined {
  return value === undefined ? undefined : value * 100
}

function findById<T extends { id?: string | null }>(collection: readonly T[], id: string | undefined): T | undefined {
  if (!id) return undefined
  return collection.find((candidate) => candidate.id === id)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function recordOfStrings(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') out[key] = raw
  }
  return out
}
