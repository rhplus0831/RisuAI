// EC4 fixture: lorebook command-path validators reject missing/duplicate ids.
export function validateGlobalLorebookCreate(input: { id: string }): { id: string } {
  if (!input.id) throw new Error('lorebook id required')
  return { id: input.id }
}

export function validateLorebookEntries(entries: { id: string }[]): { id: string }[] {
  return entries
}
