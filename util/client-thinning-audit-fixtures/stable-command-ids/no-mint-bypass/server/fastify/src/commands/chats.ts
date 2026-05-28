// EC4 fixture: chat + chat folder command-path constructors are validate-only.
export function createChatRecord(input: { id: string }): { id: string } {
  if (!input.id) throw new Error('chat id required')
  return { id: input.id }
}

export function createChatFolderRecord(input: { id: string }): { id: string } {
  if (!input.id) throw new Error('chat folder id required')
  return { id: input.id }
}
