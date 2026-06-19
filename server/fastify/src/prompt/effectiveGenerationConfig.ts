import type { Chat, Database, character } from '../../../../src/ts/storage/database.svelte'
import {
  createChatGenerationSettingsIncompleteError,
  resolveChatGenerationSettingsReadiness,
  type ChatGenerationSettingsIncompleteErrorBody,
  type ChatGenerationSettingsReadiness,
} from '../../../../src/ts/chatGenerationSettings'
import type { ModelPresetRecord, PromptPresetRecord } from '../commands/splitPresets.js'
import { mirrorLegacyProfile, type PersonaRecord } from '../commands/personas.js'
import { applyEffectivePresetComposition, resolvePromptPresetRegexField } from '../../../../src/ts/presetSplit.js'

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
}

export function buildEffectiveGenerationConfig(input: EffectiveGenerationConfigInput): EffectiveGenerationConfigResult {
  const settings = input.currentChat.generationSettings
  const modelPresets = (input.database.modelPresets ?? []) as unknown as ModelPresetRecord[]
  const promptPresets = (input.database.promptPresets ?? []) as unknown as EffectivePromptPresetRecord[]
  const personas = (input.database.personas ?? []) as PersonaRecord[]
  const selectedModelPreset = findById(modelPresets, settings?.modelPresetId)
  const selectedPromptPreset = findById(promptPresets, settings?.promptPresetId)
  const readiness = resolveChatGenerationSettingsReadiness({
    settings,
    personas,
    modelPresets,
    promptPresets,
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

  const effectiveDatabase = structuredClone(input.database) as Database
  const effectiveModelPresets = (effectiveDatabase.modelPresets ?? []) as unknown as ModelPresetRecord[]
  const effectivePromptPresets = (effectiveDatabase.promptPresets ?? []) as unknown as EffectivePromptPresetRecord[]
  const effectivePersonas = (effectiveDatabase.personas ?? []) as PersonaRecord[]
  const effectiveModelPresetIndex = effectiveModelPresets.findIndex(
    (candidate: ModelPresetRecord) => candidate.id === modelPreset.id,
  )
  const effectivePromptPresetIndex = effectivePromptPresets.findIndex(
    (candidate: EffectivePromptPresetRecord) => candidate.id === promptPreset.id,
  )
  const effectivePersonaIndex = effectivePersonas.findIndex((candidate: PersonaRecord) => candidate.id === persona.id)
  const effectiveModelPreset = effectiveModelPresets[effectiveModelPresetIndex] as ModelPresetRecord | undefined
  const effectivePromptPreset = effectivePromptPresets[effectivePromptPresetIndex] as PromptPresetRecord | undefined
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
  effectiveDatabase.moduleIntergration =
    typeof effectivePromptPreset.moduleIntergration === 'string' ? effectivePromptPreset.moduleIntergration : ''
  const promptPresetRegex = resolvePromptPresetRegexField(effectivePromptPreset)
  effectiveDatabase.presetRegex = structuredClone(
    promptPresetRegex.present && Array.isArray(promptPresetRegex.value) ? promptPresetRegex.value : [],
  ) as Database['presetRegex']

  effectiveDatabase.selectedPersona = effectivePersonaIndex
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

  const effectiveCurrentChar = effectiveDatabase.characters[input.selectedCharID]
  const effectiveStoredChat = effectiveCurrentChar?.chats?.[input.chatPage]
  if (!effectiveCurrentChar || !effectiveStoredChat) {
    throw new ChatGenerationSettingsIncompleteAssemblyError(readiness, input.currentChat.id)
  }

  return {
    database: effectiveDatabase,
    currentChar: effectiveCurrentChar,
    currentChat: structuredClone(effectiveStoredChat) as Chat,
  }
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
