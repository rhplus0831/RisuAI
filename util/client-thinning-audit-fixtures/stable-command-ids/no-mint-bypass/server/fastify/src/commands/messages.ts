// EC4 fixture: message command-path readers/constructors are validate-only.
export function createMessageRecord(input: { chatId: string }): { chatId: string } {
  if (!input.chatId) throw new Error('message id required')
  return { chatId: input.chatId }
}

export function readReplacementMessages(input: unknown[]): unknown[] {
  return input
}

export function readGenerationResult(input: unknown): unknown {
  return input
}
