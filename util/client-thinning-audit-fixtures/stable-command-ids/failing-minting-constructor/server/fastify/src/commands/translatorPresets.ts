// EC4 fixture: translator preset command-path constructor is validate-only.
export function createTranslatorPresetRecord(input: { id: string }): { id: string } {
  if (!input.id) throw new Error('translator preset id required')
  return { id: input.id }
}
