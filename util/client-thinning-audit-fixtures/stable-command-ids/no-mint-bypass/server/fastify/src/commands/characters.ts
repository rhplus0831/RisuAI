// EC4 fixture: character command-path constructor is validate-only.
export function createCharacterRecord(input: { chaId: string }): { chaId: string } {
  if (!input.chaId) throw new Error('character id required')
  return { chaId: input.chaId }
}
