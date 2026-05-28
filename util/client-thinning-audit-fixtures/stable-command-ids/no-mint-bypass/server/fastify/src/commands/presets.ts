// EC4 fixture: preset command-path constructor is validate-only.
export function createPresetRecord(input: { id: string }): { id: string } {
  if (!input.id) throw new Error('preset id required')
  return { id: input.id }
}
