import {
  CHAT_GENERATION_SETTINGS_FIELD,
  type ChatGenerationSettings,
} from '@risuai/shared-core/chat-generation-settings'

type JsonRecord = Record<string, unknown>

export function repairStoredChatGenerationSettings(record: JsonRecord): void {
  if (!hasOwn(record, CHAT_GENERATION_SETTINGS_FIELD)) return
  const normalized = normalizeStoredChatGenerationSettings(record[CHAT_GENERATION_SETTINGS_FIELD])
  if (normalized) {
    record[CHAT_GENERATION_SETTINGS_FIELD] = normalized
  } else {
    delete record[CHAT_GENERATION_SETTINGS_FIELD]
  }
}

export function normalizeStoredChatGenerationSettings(value: unknown): ChatGenerationSettings | undefined {
  if (!isJsonRecord(value)) return undefined

  const normalized: ChatGenerationSettings = {}
  if (typeof value.configured === 'boolean') {
    normalized.configured = value.configured
  }
  if (typeof value.personaId === 'string') {
    normalized.personaId = value.personaId
  }
  if (typeof value.modelPresetId === 'string') {
    normalized.modelPresetId = value.modelPresetId
  }
  if (
    normalized.modelPresetId?.trim() &&
    (value.modelPresetSelectionSource === 'manual' || value.modelPresetSelectionSource === 'prompt-recommendation')
  ) {
    normalized.modelPresetSelectionSource = value.modelPresetSelectionSource
  }
  if (typeof value.promptPresetId === 'string') {
    normalized.promptPresetId = value.promptPresetId
  }
  if (typeof value.agentPresetId === 'string') {
    normalized.agentPresetId = value.agentPresetId
  }
  if (typeof value.togglePresetId === 'string') {
    normalized.togglePresetId = value.togglePresetId
  }
  if (typeof value.jailbreakToggle === 'boolean') {
    normalized.jailbreakToggle = value.jailbreakToggle
  }
  if (isJsonRecord(value.sidebarToggles)) {
    const sidebarToggles: Record<string, string> = {}
    for (const [key, toggleValue] of Object.entries(value.sidebarToggles)) {
      if (key.trim() !== '' && typeof toggleValue === 'string') {
        sidebarToggles[key] = toggleValue
      }
    }
    if (Object.keys(sidebarToggles).length > 0 || Object.keys(normalized).length > 0) {
      normalized.sidebarToggles = sidebarToggles
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}
