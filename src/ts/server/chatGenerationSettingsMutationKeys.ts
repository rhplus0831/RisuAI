import type { ChatGenerationSettings } from '../chatGenerationSettings'
import { PERSONA_SELECTION_MUTATION_KEY, personaOwnerMutationKey } from './personaMutationKeys'
import { SETTINGS_BRIDGE_MUTATION_KEY } from './settingsMutationKey'

/**
 * A chat generation-settings write stores foreign keys into three structural
 * collections. Hold it behind their selection/structure lanes and the exact
 * referenced owner lanes so a retained delete or owner repair settles before
 * the chat can persist a reference to that row.
 */
export function chatGenerationSettingsMutationDependencyKeys(settings: ChatGenerationSettings): string[] {
  const keys = new Set<string>([PERSONA_SELECTION_MUTATION_KEY, SETTINGS_BRIDGE_MUTATION_KEY])
  const personaId = nonBlankId(settings.personaId)
  const modelPresetId = nonBlankId(settings.modelPresetId)
  const promptPresetId = nonBlankId(settings.promptPresetId)

  if (personaId) keys.add(personaOwnerMutationKey(personaId))
  if (modelPresetId) keys.add(modelPresetOwnerMutationKey(modelPresetId))
  if (promptPresetId) keys.add(promptPresetOwnerMutationKey(promptPresetId))
  return [...keys]
}

export function modelPresetOwnerMutationKey(presetId: string): string {
  return `split-preset:model:${presetId}`
}

export function promptPresetOwnerMutationKey(presetId: string): string {
  return `prompt-template-owner:${presetId}`
}

function nonBlankId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}
