import type { Message } from '../storage/database.svelte'
import {
  captureChatBodyProjectionEpoch,
  charactersResourceState,
  getCharacterResourceOwner,
  isChatBodyResourceLoaded,
} from './resourceState.svelte'

export interface ChatTranscriptOwnerState {
  characterId: string
  chatId: string
  messages: Message[]
  projectionEpoch: number
  resourceLoaded: boolean
}

/** Resolve one canonical transcript by stable chat id without loading the compatibility facade. */
export function getChatTranscriptOwnerState(chatId: string): ChatTranscriptOwnerState | undefined {
  if (charactersResourceState.status !== 'ready' || typeof chatId !== 'string' || chatId.length === 0) {
    return undefined
  }

  let match: ChatTranscriptOwnerState | undefined
  for (const candidate of charactersResourceState.characters) {
    if (!candidate?.chaId || getCharacterResourceOwner(candidate.chaId) !== candidate) return undefined
    for (const chat of candidate.chats ?? []) {
      if (chat?.id !== chatId) continue
      if (match) return undefined
      match = {
        characterId: candidate.chaId,
        chatId,
        messages: chat.message ?? [],
        projectionEpoch: captureChatBodyProjectionEpoch(chatId),
        resourceLoaded: isChatBodyResourceLoaded(chatId),
      }
    }
  }
  return match
}
