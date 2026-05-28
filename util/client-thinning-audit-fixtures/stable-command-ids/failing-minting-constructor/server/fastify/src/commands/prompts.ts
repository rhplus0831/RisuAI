// EC4 fixture: command-path constructors validate stable ids supplied by the
// request; they never mint them. `promptTemplate` is not a writable settings key.
export const PROMPT_SETTINGS_KEYS = ['temperature', 'maxContext'] as const

export function createPromptItemRecord(input: { id: string }): { id: string } {
  if (!input.id) throw new Error('prompt item id required')
  return { id: input.id }
}
