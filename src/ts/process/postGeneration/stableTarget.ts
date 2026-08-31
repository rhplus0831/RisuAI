import { getDatabase, type Chat, type Message, type character } from '../../storage/database.svelte'
import { getChatMessageOwnerState } from '../../server/chatMessageHydration.svelte'
import { charactersResourceState, getCharacterResourceOwner } from '../../server/resourceState.svelte'

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
  return typeof value === 'string' && value.trim().length > 0
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
  const ready = charactersResourceState.status === 'ready'
  if (!ready && charactersResourceState.status !== 'idle' && charactersResourceState.status !== 'loading') return null
  const characters = ready ? charactersResourceState.characters : getDatabase().characters
  if (!Array.isArray(characters)) return null
  const character = ready
    ? getCharacterResourceOwner(target.characterId)
    : characters.find((candidate) => candidate?.chaId === target.characterId)
  if (!character) return null
  const characterIndex = characters.indexOf(character)
  if (characterIndex < 0) return null
  const chatMatches = (character.chats ?? []).filter((candidate) => candidate?.id === target.chatId)
  if (ready && chatMatches.length !== 1) return null
  const chat = chatMatches[0]
  const chatIndex = chat ? character.chats.indexOf(chat) : -1
  return chat && chatIndex >= 0 ? { character, chat, characterIndex, chatIndex } : null
}

export function resolveStablePostGenerationMessage(
  target: StablePostGenerationMessageTarget | null | undefined,
): StablePostGenerationMessageResolution | null {
  if (!target) return null
  const resolution = resolveStablePostGenerationChat(target)
  if (!resolution) return null
  const ready = charactersResourceState.status === 'ready'
  const ownerMessages = ready ? getChatMessageOwnerState(target.chatId)?.messages : resolution.chat.message
  if (!ownerMessages) return null
  const ownerMatches = ownerMessages.filter((candidate) => candidate?.chatId === target.messageId)
  if (ready && ownerMatches.length !== 1) return null
  const messageMatches = (resolution.chat.message ?? []).filter((candidate) => candidate?.chatId === target.messageId)
  if (ready && messageMatches.length !== 1) return null
  const messageIndex = resolution.chat.message?.indexOf(messageMatches[0]) ?? -1
  if (messageIndex < 0) return null
  const message = resolution.chat.message[messageIndex]
  return message ? { ...resolution, message, messageIndex } : null
}
