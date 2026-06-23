import type { Database, PromptPreset } from '../../storage/database.svelte'
import type { PromptItem } from '../prompt'

export type EffectivePromptTemplateSource =
  | 'chat-prompt-preset'
  | 'missing-chat-prompt-preset'
  | 'global-prompt-preset'
  | 'top-level'
  | 'none'

export interface EffectivePromptTemplateOptions {
  chatPromptPresetId?: string | null
}

export interface EffectivePromptTemplateResolution {
  promptTemplate: PromptItem[] | null
  source: EffectivePromptTemplateSource
  promptPresetId?: string
}

export function resolveEffectivePromptTemplate(
  db: Pick<Database, 'promptPresets' | 'promptPresetsId' | 'promptTemplate'>,
  options: EffectivePromptTemplateOptions = {},
): EffectivePromptTemplateResolution {
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
    return resolvePresetTemplate(globalPreset, 'global-prompt-preset', globalPreset.id)
  }

  if (Array.isArray(db.promptTemplate)) {
    return { promptTemplate: db.promptTemplate, source: 'top-level' }
  }

  return { promptTemplate: null, source: 'none' }
}

function resolvePresetTemplate(
  preset: PromptPreset,
  source: 'chat-prompt-preset' | 'global-prompt-preset',
  promptPresetId: string | undefined,
): EffectivePromptTemplateResolution {
  return {
    promptTemplate: Array.isArray(preset.promptTemplate) ? preset.promptTemplate : null,
    source,
    promptPresetId,
  }
}

function resolveGlobalPromptPreset(db: Pick<Database, 'promptPresets' | 'promptPresetsId'>): PromptPreset | undefined {
  const index = db.promptPresetsId
  if (!Number.isInteger(index) || index < 0) return undefined
  return promptPresets(db)[index]
}

function promptPresets(db: Pick<Database, 'promptPresets'>): PromptPreset[] {
  return Array.isArray(db.promptPresets) ? db.promptPresets : []
}

function nonBlankString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
