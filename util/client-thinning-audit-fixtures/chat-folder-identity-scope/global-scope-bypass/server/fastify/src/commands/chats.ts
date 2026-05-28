// AEC4 fixture: chat folder ids are normalized globally across every character,
// not per-character, and repaired ids update the chat folderId references.
import { randomUUID } from 'node:crypto'

interface CharacterRecord {
  chats?: { folderId?: string }[]
  chatFolders?: { id?: string }[]
}

export function normalizeAllCharacterChats(database: unknown): CharacterRecord[] {
  const characters = (database as { characters?: CharacterRecord[] }).characters ?? []
  normalizeGlobalChatFolderIds(characters)
  return characters
}

export function normalizeGlobalChatFolderIds(characters: CharacterRecord[]): void {
  const seen = new Set<string>()
  for (const character of characters) {
    for (const folder of character.chatFolders ?? []) {
      if (!folder.id || seen.has(folder.id)) {
        const previousId = folder.id
        folder.id = randomUUID()
        for (const chat of character.chats ?? []) {
          if (chat.folderId === previousId) chat.folderId = folder.id
        }
      }
      seen.add(folder.id)
    }
  }
}
