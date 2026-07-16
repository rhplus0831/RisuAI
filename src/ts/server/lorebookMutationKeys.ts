/** Orders global lorebook deletes and explicit page selections. */
export const GLOBAL_LOREBOOK_SELECTION_MUTATION_KEY = 'lorebook:global-selection'

export function globalLorebookOwnerMutationKey(lorebookId: string): string {
  return `lorebook:global:${lorebookId}`
}
