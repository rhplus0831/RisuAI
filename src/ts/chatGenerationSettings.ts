export const CHAT_GENERATION_SETTINGS_FIELD = 'generationSettings' as const

export const CHAT_GENERATION_SETTINGS_INCOMPLETE_STATUS = 409 as const
export const CHAT_GENERATION_SETTINGS_INCOMPLETE_ERROR =
  'chat_generation_settings_incomplete' as const
export const CHAT_GENERATION_SETTINGS_INCOMPLETE_MESSAGE =
  'Chat generation settings are incomplete' as const

const JAILBREAK_TOGGLE_TOKEN = '{{jbtoggled}}'

export interface ChatGenerationSettings {
  configured?: boolean
  personaId?: string
  presetId?: string
  jailbreakToggle?: boolean
  sidebarToggles?: Record<string, string>
}

export interface ChatGenerationPersonaReference {
  id?: string | null
}

export interface ChatGenerationPromptTemplateItemReference {
  type?: string
  text?: string
  innerFormat?: string
  defaultText?: string
}

export interface ChatGenerationPresetReference {
  id?: string | null
  jailbreak?: string | null
  promptTemplate?: readonly ChatGenerationPromptTemplateItemReference[] | null
  customPromptTemplateToggle?: string | null
}

export interface ChatGenerationModuleReference {
  id: string
  namespace?: string | null
  customModuleToggle?: string | null
}

export type ChatGenerationSidebarToggleKind = 'boolean' | 'select' | 'text' | 'textarea'

export interface ChatGenerationRequiredSidebarToggle {
  key: string
  label: string
  kind: ChatGenerationSidebarToggleKind
  options: string[]
  source: 'preset' | 'module'
  presetId?: string
  moduleId?: string
  moduleNamespace?: string
}

export interface ChatGenerationJailbreakToggleRequirement {
  field: 'jailbreakToggle'
  required: true
  displayed: boolean
}

export interface ChatGenerationControlRequirements {
  preset: ChatGenerationPresetReference | undefined
  presetFound: boolean
  jailbreakToggle: ChatGenerationJailbreakToggleRequirement
  sidebarToggles: ChatGenerationRequiredSidebarToggle[]
}

export interface ResolveChatGenerationRequirementsInput {
  presetId?: string
  presets: readonly ChatGenerationPresetReference[]
  modules?: readonly ChatGenerationModuleReference[]
  enabledModuleIds?: readonly string[]
  chatModuleIds?: readonly string[]
  characterModuleIds?: readonly string[]
  moduleIntegration?: string | null
}

export interface ResolveChatGenerationSettingsReadinessInput extends ResolveChatGenerationRequirementsInput {
  settings?: ChatGenerationSettings
  personas: readonly ChatGenerationPersonaReference[]
}

export const CHAT_GENERATION_SETTINGS_MISSING_REASON_CODES = [
  'settings_missing',
  'settings_not_configured',
  'persona_id_missing',
  'persona_missing',
  'preset_id_missing',
  'preset_missing',
  'jailbreak_toggle_missing',
  'jailbreak_toggle_invalid',
  'sidebar_toggles_missing',
  'sidebar_toggle_missing',
  'sidebar_toggle_invalid',
] as const

export type ChatGenerationSettingsMissingReasonCode =
  (typeof CHAT_GENERATION_SETTINGS_MISSING_REASON_CODES)[number]

export type ChatGenerationSettingsFieldPath =
  | typeof CHAT_GENERATION_SETTINGS_FIELD
  | `${typeof CHAT_GENERATION_SETTINGS_FIELD}.configured`
  | `${typeof CHAT_GENERATION_SETTINGS_FIELD}.personaId`
  | `${typeof CHAT_GENERATION_SETTINGS_FIELD}.presetId`
  | `${typeof CHAT_GENERATION_SETTINGS_FIELD}.jailbreakToggle`
  | `${typeof CHAT_GENERATION_SETTINGS_FIELD}.sidebarToggles`
  | `${typeof CHAT_GENERATION_SETTINGS_FIELD}.sidebarToggles.${string}`

export type ChatGenerationSettingsMissingReason =
  | {
      code: 'settings_missing'
      field: typeof CHAT_GENERATION_SETTINGS_FIELD
    }
  | {
      code: 'settings_not_configured'
      field: `${typeof CHAT_GENERATION_SETTINGS_FIELD}.configured`
    }
  | {
      code: 'persona_id_missing'
      field: `${typeof CHAT_GENERATION_SETTINGS_FIELD}.personaId`
    }
  | {
      code: 'persona_missing'
      field: `${typeof CHAT_GENERATION_SETTINGS_FIELD}.personaId`
      personaId: string
    }
  | {
      code: 'preset_id_missing'
      field: `${typeof CHAT_GENERATION_SETTINGS_FIELD}.presetId`
    }
  | {
      code: 'preset_missing'
      field: `${typeof CHAT_GENERATION_SETTINGS_FIELD}.presetId`
      presetId: string
    }
  | {
      code: 'jailbreak_toggle_missing'
      field: `${typeof CHAT_GENERATION_SETTINGS_FIELD}.jailbreakToggle`
    }
  | {
      code: 'jailbreak_toggle_invalid'
      field: `${typeof CHAT_GENERATION_SETTINGS_FIELD}.jailbreakToggle`
      actualType: string
    }
  | {
      code: 'sidebar_toggles_missing'
      field: `${typeof CHAT_GENERATION_SETTINGS_FIELD}.sidebarToggles`
    }
  | {
      code: 'sidebar_toggle_missing'
      field: `${typeof CHAT_GENERATION_SETTINGS_FIELD}.sidebarToggles.${string}`
      toggleKey: string
    }
  | {
      code: 'sidebar_toggle_invalid'
      field: `${typeof CHAT_GENERATION_SETTINGS_FIELD}.sidebarToggles.${string}`
      toggleKey: string
      actualType: string
    }

export interface ChatGenerationSettingsReadiness {
  ready: boolean
  missing: ChatGenerationSettingsMissingReason[]
  requirements: ChatGenerationControlRequirements
  staleSidebarToggleKeys: string[]
}

export interface ChatGenerationSettingsIncompleteErrorBody {
  statusCode: typeof CHAT_GENERATION_SETTINGS_INCOMPLETE_STATUS
  error: typeof CHAT_GENERATION_SETTINGS_INCOMPLETE_ERROR
  message: typeof CHAT_GENERATION_SETTINGS_INCOMPLETE_MESSAGE
  chatId?: string
  missing: ChatGenerationSettingsMissingReason[]
  staleSidebarToggleKeys: string[]
}

export function resolveRequiredSidebarToggles(
  input: ResolveChatGenerationRequirementsInput,
): ChatGenerationRequiredSidebarToggle[] {
  return collectRequiredSidebarToggles(input)
}

export function resolveChatGenerationControlRequirements(
  input: ResolveChatGenerationRequirementsInput,
): ChatGenerationControlRequirements {
  const preset = resolvePreset(input.presets, input.presetId)

  return {
    preset,
    presetFound: !!preset,
    jailbreakToggle: {
      field: 'jailbreakToggle',
      required: true,
      displayed: presetDisplaysJailbreakToggle(preset),
    },
    sidebarToggles: collectRequiredSidebarToggles(input),
  }
}

export function resolveChatGenerationSettingsReadiness(
  input: ResolveChatGenerationSettingsReadinessInput,
): ChatGenerationSettingsReadiness {
  const settings = input.settings
  const requirements = resolveChatGenerationControlRequirements({
    ...input,
    presetId: settings?.presetId,
  })
  const missing: ChatGenerationSettingsMissingReason[] = []

  if (!settings) {
    missing.push({
      code: 'settings_missing',
      field: CHAT_GENERATION_SETTINGS_FIELD,
    })
  }

  if (settings?.configured !== true) {
    missing.push({
      code: 'settings_not_configured',
      field: `${CHAT_GENERATION_SETTINGS_FIELD}.configured`,
    })
  }

  const personaId = settings?.personaId
  if (!isNonEmptyString(personaId)) {
    missing.push({
      code: 'persona_id_missing',
      field: `${CHAT_GENERATION_SETTINGS_FIELD}.personaId`,
    })
  } else if (!input.personas.some((persona) => persona.id === personaId)) {
    missing.push({
      code: 'persona_missing',
      field: `${CHAT_GENERATION_SETTINGS_FIELD}.personaId`,
      personaId,
    })
  }

  const presetId = settings?.presetId
  if (!isNonEmptyString(presetId)) {
    missing.push({
      code: 'preset_id_missing',
      field: `${CHAT_GENERATION_SETTINGS_FIELD}.presetId`,
    })
  } else if (!requirements.presetFound) {
    missing.push({
      code: 'preset_missing',
      field: `${CHAT_GENERATION_SETTINGS_FIELD}.presetId`,
      presetId,
    })
  }

  if (!settings || !hasOwn(settings, 'jailbreakToggle')) {
    missing.push({
      code: 'jailbreak_toggle_missing',
      field: `${CHAT_GENERATION_SETTINGS_FIELD}.jailbreakToggle`,
    })
  } else if (typeof settings.jailbreakToggle !== 'boolean') {
    missing.push({
      code: 'jailbreak_toggle_invalid',
      field: `${CHAT_GENERATION_SETTINGS_FIELD}.jailbreakToggle`,
      actualType: valueType(settings.jailbreakToggle),
    })
  }

  const sidebarToggles = isRecord(settings?.sidebarToggles) ? settings.sidebarToggles : undefined
  if (!sidebarToggles && requirements.sidebarToggles.length > 0) {
    missing.push({
      code: 'sidebar_toggles_missing',
      field: `${CHAT_GENERATION_SETTINGS_FIELD}.sidebarToggles`,
    })
  }

  for (const toggle of requirements.sidebarToggles) {
    if (!sidebarToggles || !hasOwn(sidebarToggles, toggle.key)) {
      missing.push({
        code: 'sidebar_toggle_missing',
        field: sidebarToggleField(toggle.key),
        toggleKey: toggle.key,
      })
      continue
    }
    if (typeof sidebarToggles[toggle.key] !== 'string') {
      missing.push({
        code: 'sidebar_toggle_invalid',
        field: sidebarToggleField(toggle.key),
        toggleKey: toggle.key,
        actualType: valueType(sidebarToggles[toggle.key]),
      })
    }
  }

  const requiredToggleKeys = new Set(requirements.sidebarToggles.map((toggle) => toggle.key))
  const staleSidebarToggleKeys = sidebarToggles
    ? Object.keys(sidebarToggles).filter((key) => !requiredToggleKeys.has(key))
    : []

  return {
    ready: missing.length === 0,
    missing,
    requirements,
    staleSidebarToggleKeys,
  }
}

export function createChatGenerationSettingsIncompleteError(
  readiness: Pick<ChatGenerationSettingsReadiness, 'missing' | 'staleSidebarToggleKeys'>,
  chatId?: string,
): ChatGenerationSettingsIncompleteErrorBody {
  const body: ChatGenerationSettingsIncompleteErrorBody = {
    statusCode: CHAT_GENERATION_SETTINGS_INCOMPLETE_STATUS,
    error: CHAT_GENERATION_SETTINGS_INCOMPLETE_ERROR,
    message: CHAT_GENERATION_SETTINGS_INCOMPLETE_MESSAGE,
    missing: readiness.missing,
    staleSidebarToggleKeys: readiness.staleSidebarToggleKeys,
  }
  if (chatId !== undefined) {
    body.chatId = chatId
  }
  return body
}

function collectRequiredSidebarToggles(
  input: ResolveChatGenerationRequirementsInput,
): ChatGenerationRequiredSidebarToggle[] {
  const toggles: ChatGenerationRequiredSidebarToggle[] = []
  const seenKeys = new Set<string>()
  const preset = resolvePreset(input.presets, input.presetId)

  if (preset?.id) {
    appendUniqueToggles(
      toggles,
      seenKeys,
      parseSidebarToggleSyntax(preset.customPromptTemplateToggle ?? '', {
        source: 'preset',
        presetId: preset.id,
      }),
    )
  }

  for (const module of resolveActiveModules(input)) {
    appendUniqueToggles(
      toggles,
      seenKeys,
      parseSidebarToggleSyntax(module.customModuleToggle ?? '', {
        source: 'module',
        moduleId: module.id,
        moduleNamespace: module.namespace ?? undefined,
      }),
    )
  }

  return toggles
}

function appendUniqueToggles(
  target: ChatGenerationRequiredSidebarToggle[],
  seenKeys: Set<string>,
  toggles: readonly ChatGenerationRequiredSidebarToggle[],
): void {
  for (const toggle of toggles) {
    if (seenKeys.has(toggle.key)) continue
    seenKeys.add(toggle.key)
    target.push(toggle)
  }
}

function parseSidebarToggleSyntax(
  syntax: string,
  source:
    | { source: 'preset'; presetId: string }
    | { source: 'module'; moduleId: string; moduleNamespace?: string },
): ChatGenerationRequiredSidebarToggle[] {
  if (!syntax) return []

  const toggles: ChatGenerationRequiredSidebarToggle[] = []
  for (const line of syntax.split('\n')) {
    const [key, label, rawType, optionText] = line.split('=')
    if (rawType === 'group' || rawType === 'groupEnd' || rawType === 'divider') {
      continue
    }
    if (rawType === 'caption') {
      continue
    }
    if (!key || !label) {
      continue
    }

    const kind =
      rawType === 'select' || rawType === 'text' || rawType === 'textarea' ? rawType : 'boolean'
    toggles.push({
      key,
      label,
      kind,
      options: kind === 'select' ? (optionText?.split(',') ?? []) : [],
      ...source,
    })
  }
  return toggles
}

function resolvePreset(
  presets: readonly ChatGenerationPresetReference[],
  presetId: string | undefined,
): ChatGenerationPresetReference | undefined {
  if (!isNonEmptyString(presetId)) return undefined
  return presets.find((preset) => preset.id === presetId)
}

function resolveActiveModules(
  input: ResolveChatGenerationRequirementsInput,
): ChatGenerationModuleReference[] {
  const requestedIds = [
    ...(input.enabledModuleIds ?? []),
    ...(input.chatModuleIds ?? []),
    ...(input.characterModuleIds ?? []),
    ...parseModuleIntegration(input.moduleIntegration),
  ].filter(isNonEmptyString)

  if (requestedIds.length === 0) return []

  const requested = new Set(requestedIds)
  const seen = new Set<string>()
  const active: ChatGenerationModuleReference[] = []
  for (const module of input.modules ?? []) {
    if (!isNonEmptyString(module.id) || seen.has(module.id)) continue
    if (!requested.has(module.id) && !(module.namespace && requested.has(module.namespace))) {
      continue
    }
    seen.add(module.id)
    active.push(module)
  }
  return active
}

function parseModuleIntegration(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((namespace) => namespace.trim())
    .filter((namespace) => namespace.length > 0)
}

function presetDisplaysJailbreakToggle(preset: ChatGenerationPresetReference | undefined): boolean {
  if (!preset) return false
  if (!Array.isArray(preset.promptTemplate)) {
    return typeof preset.jailbreak === 'string' && preset.jailbreak.trim().length > 0
  }
  return preset.promptTemplate.some((item) => {
    if (item.type === 'jailbreak') return true
    return (
      usesJailbreakToggle(item.text) ||
      usesJailbreakToggle(item.innerFormat) ||
      usesJailbreakToggle(item.defaultText)
    )
  })
}

function usesJailbreakToggle(value: string | undefined): boolean {
  return typeof value === 'string' && value.includes(JAILBREAK_TOGGLE_TOKEN)
}

function sidebarToggleField(
  key: string,
): `${typeof CHAT_GENERATION_SETTINGS_FIELD}.sidebarToggles.${string}` {
  return `${CHAT_GENERATION_SETTINGS_FIELD}.sidebarToggles.${key}`
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function valueType(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}
