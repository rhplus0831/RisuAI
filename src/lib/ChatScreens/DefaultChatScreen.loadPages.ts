import { DEFAULT_CHAT_DISPLAY_TAIL_COUNT } from '../../ts/chatDisplayTailCount'

export const DEFAULT_CHAT_LOAD_PAGES = DEFAULT_CHAT_DISPLAY_TAIL_COUNT
export const CHAT_JUMP_LOAD_PADDING = 5

export interface TranscriptWindowIdentityInput {
  selectedCharacterIndex: number
  characterId?: string | null
  chatPage?: number | null
  chatId?: string | null
}

export interface TranscriptWindowRangeInput {
  messageCount: number
  loadPages: number
  foldedMessageIndex?: number
}

export function buildTranscriptWindowIdentity({
  selectedCharacterIndex,
  characterId,
  chatPage,
  chatId,
}: TranscriptWindowIdentityInput): string | null {
  if (selectedCharacterIndex < 0) {
    return null
  }

  const characterKey = characterId && characterId.length > 0 ? characterId : selectedCharacterIndex
  const chatKey = chatId && chatId.length > 0 ? chatId : `page:${chatPage ?? -1}`
  return `${selectedCharacterIndex}:${characterKey}:${chatKey}`
}

export function getLoadPagesForMessageJump(
  currentLoadPages: number,
  messageCount: number,
  targetIndex: number,
): number {
  if (!Number.isInteger(targetIndex) || targetIndex < 0) {
    return currentLoadPages
  }

  const neededLoadPages = messageCount - targetIndex + CHAT_JUMP_LOAD_PADDING
  return currentLoadPages < neededLoadPages ? neededLoadPages : currentLoadPages
}

export function getTranscriptWindowRange({
  messageCount,
  loadPages,
  foldedMessageIndex = -1,
}: TranscriptWindowRangeInput): { loadStart: number; loadEnd: number } {
  let loadStart = messageCount - 1
  let loadEnd = Math.max(0, messageCount - loadPages)

  if (foldedMessageIndex !== -1) {
    loadStart = Math.min(foldedMessageIndex, messageCount - 1)
    loadEnd = Math.max(0, loadStart - loadPages)
  }

  return { loadStart, loadEnd }
}
