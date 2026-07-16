function ownerMutationKey(kind: 'character' | 'chat' | 'chat-folder' | 'module', id: string): string {
  return `${kind}-owner:${id}`
}

export function characterOwnerMutationKey(characterId: string): string {
  return ownerMutationKey('character', characterId)
}

export function chatOwnerMutationKey(chatId: string): string {
  return ownerMutationKey('chat', chatId)
}

export function moduleOwnerMutationKey(moduleId: string): string {
  return ownerMutationKey('module', moduleId)
}

export function chatResourceOwnerMutationKey(chatId: string, characterId?: string | null): string {
  return characterId ? characterOwnerMutationKey(characterId) : chatOwnerMutationKey(chatId)
}

export function chatFolderResourceOwnerMutationKey(folderId: string, characterId?: string | null): string {
  return characterId ? characterOwnerMutationKey(characterId) : ownerMutationKey('chat-folder', folderId)
}
