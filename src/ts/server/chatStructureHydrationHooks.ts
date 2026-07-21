interface ChatStructureHydrationHooks {
  markCreatedTranscript: (chatId: string) => boolean
  invalidateTranscript: (chatId: string) => void
  isTranscriptHydrated: (chatId: string) => boolean
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

export function isKnownHydratedChatTranscript(chatId: string): boolean {
  return hooks?.isTranscriptHydrated(chatId) ?? false
}
