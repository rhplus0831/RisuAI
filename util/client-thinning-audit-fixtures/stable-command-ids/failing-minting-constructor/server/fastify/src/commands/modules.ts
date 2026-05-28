// EC4 fixture: module command-path constructor is validate-only.
export function createModuleRecord(input: { id: string }): { id: string } {
  if (!input.id) throw new Error('module id required')
  return { id: input.id }
}
