import type { Chat, character, Message } from 'src/ts/storage/database.svelte'

interface CharacterReadState {
  status: string
  characters: readonly character[]
  currentChar: number
}

/**
 * Shared render reads. Track identities and array structure, not message bodies,
 * metadata, or projection epochs (which also change for unrelated row edits).
 * Svelte invalidates these derived indexes synchronously for in-place optimistic
 * edits, rollback, hydration and replacement as well as authoritative updates.
 * Mutation callers must still capture and revalidate their own freshness tokens.
 */
export function createChatReadOwners(
  state: CharacterReadState,
  readMessages: (chatId: string) => readonly Message[] | undefined,
) {
  const owners = $derived.by(() => {
    const characters = new Map<string, character | undefined>()
    const chats = new Map<string, { character: character; chat: Chat } | undefined>()
    if (state.status !== 'ready') return { characters, chats }
    for (const character of state.characters) {
      if (character?.chaId) {
        characters.set(character.chaId, characters.has(character.chaId) ? undefined : character)
      }
      // Count even chats beneath ambiguous/missing character IDs. Such a row
      // must not let another character claim a globally duplicated chat ID.
      for (const chat of character?.chats ?? []) {
        if (!chat?.id || !chat.id.trim()) continue
        chats.set(chat.id, chats.has(chat.id) ? undefined : { character, chat })
      }
    }
    return { characters, chats }
  })

  const selectedCharacter = $derived.by(() => {
    if (state.status !== 'ready') return undefined
    const candidate = state.characters[state.currentChar]
    return candidate?.chaId && owners.characters.get(candidate.chaId) === candidate ? candidate : undefined
  })

  const selectedChat = $derived.by(() => {
    const character = selectedCharacter
    if (!character || typeof character.chatPage !== 'number') return undefined
    const candidate = character.chats?.[character.chatPage]
    const owner = candidate?.id ? owners.chats.get(candidate.id) : undefined
    return owner?.character === character ? owner.chat : undefined
  })

  const messages = $derived(selectedChat?.id ? readMessages(selectedChat.id) : undefined)
  const messageOwners = $derived.by(() => {
    const unique = new Map<string, Message | undefined>()
    for (const message of messages ?? []) {
      if (message?.chatId) unique.set(message.chatId, unique.has(message.chatId) ? undefined : message)
    }
    return unique
  })

  return {
    characterById: (id: string): character | undefined => owners.characters.get(id),
    character: () => selectedCharacter,
    chat: () => selectedChat,
    message(index: number): Message | undefined {
      if (index < 0) return undefined
      const candidate = messages?.[index]
      return candidate?.chatId && messageOwners.get(candidate.chatId) === candidate ? candidate : undefined
    },
  }
}
