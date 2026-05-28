// EC4 fixture: persona command-path constructor is validate-only.
export function createPersonaRecord(input: { id: string }): { id: string } {
  if (!input.id) throw new Error('persona id required')
  return { id: input.id }
}
