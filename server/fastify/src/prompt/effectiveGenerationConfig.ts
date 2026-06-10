import type { Chat, Database, character } from '../../../../src/ts/storage/database.svelte'
import {
  createChatGenerationSettingsIncompleteError,
  resolveChatGenerationSettingsReadiness,
  type ChatGenerationSettingsIncompleteErrorBody,
  type ChatGenerationSettingsReadiness,
} from '../../../../src/ts/chatGenerationSettings'
import { applyPreset, type PresetRecord } from '../commands/presets.js'
import { mirrorLegacyProfile, type PersonaRecord } from '../commands/personas.js'

type JsonRecord = Record<string, unknown>
type EffectivePresetRecord = PresetRecord & { moduleIntergration?: unknown }

export class ChatGenerationSettingsIncompleteAssemblyError extends Error {
  readonly statusCode = 409
  readonly body: ChatGenerationSettingsIncompleteErrorBody

  constructor(
    readiness: Pick<ChatGenerationSettingsReadiness, 'missing' | 'staleSidebarToggleKeys'>,
    chatId?: string,
  ) {
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

export function buildEffectiveGenerationConfig(
  input: EffectiveGenerationConfigInput,
): EffectiveGenerationConfigResult {
  const settings = input.currentChat.generationSettings
  const presets = (input.database.botPresets ?? []) as unknown as EffectivePresetRecord[]
  const personas = (input.database.personas ?? []) as PersonaRecord[]
  const selectedPreset = findById(presets, settings?.presetId)
  const readiness = resolveChatGenerationSettingsReadiness({
    settings,
    personas,
    presets,
    modules: input.database.modules ?? [],
    enabledModuleIds: stringArray(input.database.enabledModules),
    characterModuleIds: stringArray(input.currentChar.modules),
    chatModuleIds: stringArray(input.currentChat.modules),
    moduleIntegration:
      typeof selectedPreset?.moduleIntergration === 'string'
        ? selectedPreset.moduleIntergration
        : null,
  })

  if (!readiness.ready) {
    throw new ChatGenerationSettingsIncompleteAssemblyError(readiness, input.currentChat.id)
  }

  const persona = findById(personas, settings?.personaId) as PersonaRecord | undefined
  const preset = selectedPreset as PresetRecord | undefined
  if (!persona || !preset) {
    throw new ChatGenerationSettingsIncompleteAssemblyError(readiness, input.currentChat.id)
  }

  const effectiveDatabase = structuredClone(input.database) as Database
  const effectivePresets = (effectiveDatabase.botPresets ?? []) as unknown as EffectivePresetRecord[]
  const effectivePersonas = (effectiveDatabase.personas ?? []) as PersonaRecord[]
  const effectivePresetIndex = effectivePresets.findIndex(
    (candidate: EffectivePresetRecord) => candidate.id === preset.id,
  )
  const effectivePersonaIndex = effectivePersonas.findIndex(
    (candidate: PersonaRecord) => candidate.id === persona.id,
  )
  const effectivePreset = effectivePresets[effectivePresetIndex] as PresetRecord | undefined
  const effectivePersona = effectivePersonas[effectivePersonaIndex] as PersonaRecord | undefined

  if (!effectivePreset || !effectivePersona) {
    throw new ChatGenerationSettingsIncompleteAssemblyError(readiness, input.currentChat.id)
  }

  effectiveDatabase.botPresetsId = effectivePresetIndex
  applyPreset(effectiveDatabase as unknown as JsonRecord, effectivePreset)

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

function findById<T extends { id?: string | null }>(
  collection: readonly T[],
  id: string | undefined,
): T | undefined {
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
