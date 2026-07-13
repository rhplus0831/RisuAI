interface ChatStructureHydrationHooks {
  markCreatedTranscript: (chatId: string) => boolean
  invalidateTranscript: (chatId: string) => void
}

let hooks: ChatStructureHydrationHooks | null = null

export function setChatStructureHydrationHooks(nextHooks: ChatStructureHydrationHooks): void {
  hooks = nextHooks
}

export function markOptimisticCreatedChatTranscript(chatId: string): boolean {
  return hooks?.markCreatedTranscript(chatId) ?? false
}

export function invalidateOptimisticCreatedChatTranscript(chatId: string): void {
  hooks?.invalidateTranscript(chatId)
}
