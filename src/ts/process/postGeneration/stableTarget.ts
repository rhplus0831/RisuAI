import { getDatabase, type Chat, type Message, type character } from '../../storage/database.svelte'

export interface StablePostGenerationChatTarget {
  characterId: string
  chatId: string
}

export interface StablePostGenerationMessageTarget extends StablePostGenerationChatTarget {
  messageId: string
}

export interface StablePostGenerationChatResolution {
  character: character
  chat: Chat
  characterIndex: number
  chatIndex: number
}

export interface StablePostGenerationMessageResolution extends StablePostGenerationChatResolution {
  message: Message
  messageIndex: number
}

function nonEmptyId(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

export function stablePostGenerationChatTarget(
  characterId: string | null | undefined,
  chatId: string | null | undefined,
): StablePostGenerationChatTarget | null {
  return nonEmptyId(characterId) && nonEmptyId(chatId) ? { characterId, chatId } : null
}

export function stablePostGenerationMessageTarget(
  characterId: string | null | undefined,
  chatId: string | null | undefined,
  messageId: string | null | undefined,
): StablePostGenerationMessageTarget | null {
  return nonEmptyId(characterId) && nonEmptyId(chatId) && nonEmptyId(messageId)
    ? { characterId, chatId, messageId }
    : null
}

export function resolveStablePostGenerationChat(
  target: StablePostGenerationChatTarget | null | undefined,
): StablePostGenerationChatResolution | null {
  if (!target) return null
  const characters = getDatabase().characters
  if (!Array.isArray(characters)) return null
  const characterIndex = characters.findIndex((candidate) => candidate?.chaId === target.characterId)
  if (characterIndex < 0) return null
  const character = characters[characterIndex]
  const chatIndex = character?.chats?.findIndex((candidate) => candidate?.id === target.chatId) ?? -1
  if (!character || chatIndex < 0) return null
  const chat = character.chats[chatIndex]
  return chat ? { character, chat, characterIndex, chatIndex } : null
}

export function resolveStablePostGenerationMessage(
  target: StablePostGenerationMessageTarget | null | undefined,
): StablePostGenerationMessageResolution | null {
  if (!target) return null
  const resolution = resolveStablePostGenerationChat(target)
  if (!resolution) return null
  const messageIndex = resolution.chat.message?.findIndex((candidate) => candidate?.chatId === target.messageId) ?? -1
  if (messageIndex < 0) return null
  const message = resolution.chat.message[messageIndex]
  return message ? { ...resolution, message, messageIndex } : null
}
