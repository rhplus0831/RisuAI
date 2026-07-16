export const TRANSLATOR_PRESET_SELECTION_MUTATION_KEY = 'translator-preset:selection'

export function translatorPresetOwnerMutationKey(presetId: string): string {
  return `translator-preset:${presetId}`
}
