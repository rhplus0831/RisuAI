import type { character } from 'src/ts/storage/database.svelte'
import { formatMobileCharacterRows, type MobileCharacterRowsOptions } from '../Mobile/mobileCharacterRows'

export const HOME_RECENT_CHARACTER_LIMIT = 8
export const HOME_PINNED_CHAT_COLLAPSED_LIMIT = 6

export interface HomeRecentCharacterItem {
  characterId: string
  characterIndex: number
  characterName: string
  characterImage: string
  activeChatId?: string
  agoText: string
}

export function collectHomeRecentCharacters(
  characters: readonly character[] | null | undefined,
  options: MobileCharacterRowsOptions & { limit?: number },
): HomeRecentCharacterItem[] {
  const safeCharacters = characters ?? []
  const limit = Math.max(0, options.limit ?? HOME_RECENT_CHARACTER_LIMIT)
  return formatMobileCharacterRows(safeCharacters, { ...options, hideTrash: true })
    .filter((row) => row.interaction > 0 && row.chaId && row.chaId !== '§playground')
    .slice(0, limit)
    .map((row) => {
      const character = safeCharacters[row.index]
      const activeChatId = character?.chats?.[character.chatPage]?.id
      return {
        characterId: row.chaId!,
        characterIndex: row.index,
        characterName: row.name,
        characterImage: row.image ?? '',
        ...(activeChatId ? { activeChatId } : {}),
        agoText: row.agoText,
      }
    })
}
