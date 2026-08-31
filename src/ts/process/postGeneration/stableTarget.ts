import { mutateChatWithScopedCommand } from '../../chatCommands'
import type { Chat, Message, character } from '../../storage/database.svelte'
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
  if (!target || charactersResourceState.status !== 'ready') return null
  const characters = charactersResourceState.characters
  const character = getCharacterResourceOwner(target.characterId)
  if (!character) return null
  const characterIndex = characters.indexOf(character)
  if (characterIndex < 0) return null
  const chatMatches = (character.chats ?? []).filter((candidate) => candidate?.id === target.chatId)
  if (chatMatches.length !== 1) return null
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
  const ownerMessages = getChatMessageOwnerState(target.chatId)?.messages
  if (!ownerMessages) return null
  const ownerMatches = ownerMessages.filter((candidate) => candidate?.chatId === target.messageId)
  if (ownerMatches.length !== 1) return null
  const messageIndex = ownerMessages.indexOf(ownerMatches[0])
  if (messageIndex < 0) return null
  const message = ownerMessages[messageIndex]
  return message ? { ...resolution, message, messageIndex } : null
}

/**
 * Apply and durably persist one post-generation chat mutation through the
 * stable character/chat owner. The command wrapper owns queued retention and
 * failed rollback; the callback rechecks ids at apply time so navigation or a
 * reordered character list cannot retarget the write.
 */
export function mutateStablePostGenerationChat(
  target: StablePostGenerationChatTarget | null | undefined,
  mutate: (chat: Chat, character: character) => boolean | void,
): boolean {
  const resolution = resolveStablePostGenerationChat(target)
  if (!resolution || !target) return false

  let mutated = false
  const applied = mutateChatWithScopedCommand(
    (chat, character) => {
      if (character.chaId !== target.characterId || chat.id !== target.chatId) return
      const transcriptOwner = getChatMessageOwnerState(target.chatId)
      if (!transcriptOwner) return
      chat.message = transcriptOwner.messages
      if (mutate(chat, character) === false) return
      mutated = true
    },
    { selectedChar: resolution.characterIndex, selectedChat: resolution.chatIndex },
  )
  return applied && mutated
}

/** Stable-id message variant of mutateStablePostGenerationChat. */
export function mutateStablePostGenerationMessage(
  target: StablePostGenerationMessageTarget | null | undefined,
  mutate: (message: Message, chat: Chat, character: character) => void,
): boolean {
  if (!target) return false
  return mutateStablePostGenerationChat(target, (chat, character) => {
    const matches = (chat.message ?? []).filter((candidate) => candidate?.chatId === target.messageId)
    if (matches.length !== 1) return false
    mutate(matches[0], chat, character)
    return true
  })
}
