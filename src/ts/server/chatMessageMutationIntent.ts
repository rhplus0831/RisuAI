let nextIntentEpoch = 0
const chatIntentEpochs = new Map<string, number>()

export function captureChatMessageMutationIntentEpoch(chatId: string): number {
  return chatIntentEpochs.get(chatId) ?? 0
}

/** Record a user/domain mutation intent before its server acknowledgement. */
export function markChatMessageMutationIntent(chatId: string): void {
  if (chatId.length === 0) return
  chatIntentEpochs.set(chatId, ++nextIntentEpoch)
}
