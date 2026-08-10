import { getCharacterDisplayName } from 'src/ts/characterDisplayName'
import { language } from 'src/lang'
import type { Chat, character, folder } from 'src/ts/storage/database.svelte'

export interface PinnedChatItem {
  characterId: string
  characterIndex: number
  characterName: string
  characterImage: string
  chatId: string
  chatName: string
}

export function collectGeneratingChatIds(
  jobs: readonly { chatId: string }[],
  activities: readonly { chatId?: string; kind: 'message' | 'preview' }[],
): Set<string> {
  const ids = new Set(jobs.map((job) => job.chatId))
  for (const activity of activities) {
    if (activity.kind === 'message' && activity.chatId) ids.add(activity.chatId)
  }
  return ids
}

type SidebarCharacter = Pick<character, 'chaId' | 'name' | 'displayName' | 'image' | 'chats'>
type CharacterOrderEntry = string | Pick<folder, 'data'>

function orderedCharacterIds(
  characters: readonly SidebarCharacter[],
  characterOrder: readonly CharacterOrderEntry[] | null | undefined,
): string[] {
  const knownIds = new Set(characters.map((character) => character.chaId).filter(Boolean))
  const ordered: string[] = []
  const seen = new Set<string>()
  const append = (id: string) => {
    if (!knownIds.has(id) || seen.has(id)) return
    seen.add(id)
    ordered.push(id)
  }

  for (const entry of characterOrder ?? []) {
    if (typeof entry === 'string') append(entry)
    else for (const id of entry.data ?? []) append(id)
  }
  for (const character of characters) append(character.chaId)
  return ordered
}

export function collectPinnedChats(
  characters: readonly SidebarCharacter[] | null | undefined,
  characterOrder: readonly CharacterOrderEntry[] | null | undefined,
): PinnedChatItem[] {
  const safeCharacters = characters ?? []
  const indexById = new Map(safeCharacters.map((character, index) => [character.chaId, index]))
  const pinned: PinnedChatItem[] = []

  for (const characterId of orderedCharacterIds(safeCharacters, characterOrder)) {
    const characterIndex = indexById.get(characterId)
    if (characterIndex === undefined) continue
    const character = safeCharacters[characterIndex]
    for (const chat of character.chats ?? []) {
      if (chat.pinned !== true || !chat.id) continue
      pinned.push({
        characterId,
        characterIndex,
        characterName: getCharacterDisplayName(character),
        characterImage: character.image ?? '',
        chatId: chat.id,
        chatName: chat.name?.trim() ? chat.name : language.unnamedPinnedChat,
      })
    }
  }
  return pinned
}

export function characterHasGeneratingChat(
  character: Pick<SidebarCharacter, 'chats'> | null | undefined,
  generatingChatIds: ReadonlySet<string>,
): boolean {
  return character?.chats?.some((chat: Chat) => !!chat.id && generatingChatIds.has(chat.id)) ?? false
}

export function characterFolderHasGeneratingChat(
  characterIndexes: readonly number[],
  characters: readonly SidebarCharacter[] | null | undefined,
  generatingChatIds: ReadonlySet<string>,
): boolean {
  const safeCharacters = characters ?? []
  return characterIndexes.some((index) => characterHasGeneratingChat(safeCharacters[index], generatingChatIds))
}
