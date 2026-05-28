// EC4 fixture: loadout command-path constructor is validate-only.
export function createLoadoutRecord(input: { id: string }): { id: string } {
  if (!input.id) throw new Error('loadout id required')
  return { id: input.id }
}
