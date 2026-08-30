export type EffectivePromptTemplateSource =
  | 'chat-prompt-preset'
  | 'missing-chat-prompt-preset'
  | 'global-prompt-preset'
  | 'top-level'
  | 'none'

export interface EffectivePromptTemplateOptions {
  chatPromptPresetId?: string | null
}

export interface EffectivePromptTemplatePreset<PromptItem = unknown> {
  id?: string
  name?: string
  promptTemplate?: readonly PromptItem[] | null
}

export interface EffectivePromptTemplateDatabase<PromptItem = unknown> {
  promptPresets?: readonly EffectivePromptTemplatePreset<PromptItem>[]
  promptPresetsId?: number
  promptTemplate?: readonly PromptItem[] | null
}

export interface EffectivePromptTemplateResolution<PromptItem = unknown> {
  promptTemplate: PromptItem[] | null
  source: EffectivePromptTemplateSource
  promptPresetId?: string
}

/**
 * Resolve the prompt-template owner without importing browser or server state.
 *
 * A chat-scoped owner is authoritative when present. Otherwise the selected
 * modern owner is authoritative, except that the initial default scaffold may
 * intentionally fall through to the aggregate compatibility projection. An
 * explicit body, including an empty array, always belongs to the modern owner;
 * resolution never repairs or mutates either input.
 */
export function resolveEffectivePromptTemplate<PromptItem = unknown>(
  db: EffectivePromptTemplateDatabase<PromptItem>,
  options: EffectivePromptTemplateOptions = {},
): EffectivePromptTemplateResolution<PromptItem> {
  const chatPromptPresetId = nonBlankString(options.chatPromptPresetId)
  if (chatPromptPresetId) {
    const preset = promptPresets(db).find((candidate) => candidate?.id === chatPromptPresetId)
    if (!preset) {
      return { promptTemplate: null, source: 'missing-chat-prompt-preset', promptPresetId: chatPromptPresetId }
    }
    return resolvePresetTemplate(preset, 'chat-prompt-preset', chatPromptPresetId)
  }

  const globalPreset = resolveGlobalPromptPreset(db)
  if (globalPreset) {
    const resolved = resolvePresetTemplate(globalPreset, 'global-prompt-preset', globalPreset.id)
    if (resolved.promptTemplate || Object.prototype.hasOwnProperty.call(globalPreset, 'promptTemplate')) {
      return resolved
    }
    if (!isDefaultPromptPresetScaffold(globalPreset)) return resolved
  }

  if (Array.isArray(db.promptTemplate)) {
    return { promptTemplate: db.promptTemplate as PromptItem[], source: 'top-level' }
  }

  return { promptTemplate: null, source: 'none' }
}

function resolvePresetTemplate<PromptItem>(
  preset: EffectivePromptTemplatePreset<PromptItem>,
  source: 'chat-prompt-preset' | 'global-prompt-preset',
  promptPresetId: string | undefined,
): EffectivePromptTemplateResolution<PromptItem> {
  return {
    promptTemplate: Array.isArray(preset.promptTemplate) ? (preset.promptTemplate as PromptItem[]) : null,
    source,
    promptPresetId,
  }
}

function resolveGlobalPromptPreset<PromptItem>(
  db: Pick<EffectivePromptTemplateDatabase<PromptItem>, 'promptPresets' | 'promptPresetsId'>,
): EffectivePromptTemplatePreset<PromptItem> | undefined {
  const index = db.promptPresetsId
  if (!Number.isInteger(index) || (index as number) < 0) return undefined
  return promptPresets(db)[index as number]
}

function isDefaultPromptPresetScaffold<PromptItem>(preset: EffectivePromptTemplatePreset<PromptItem>): boolean {
  return preset.id === 'default-prompt-preset' && preset.name === 'Default Prompt'
}

function promptPresets<PromptItem>(
  db: Pick<EffectivePromptTemplateDatabase<PromptItem>, 'promptPresets'>,
): readonly EffectivePromptTemplatePreset<PromptItem>[] {
  return Array.isArray(db.promptPresets) ? db.promptPresets : []
}

function nonBlankString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
