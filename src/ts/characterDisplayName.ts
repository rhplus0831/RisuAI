import type { character } from './storage/database.svelte'

export type CharacterDisplayNameSource = Pick<character, 'name' | 'displayName'> | null | undefined

export interface CharacterDisplayInfo {
  name: string
  searchText: string
}

export function getCharacterDisplayName(character: CharacterDisplayNameSource, fallback = 'Unnamed'): string {
  const rawDisplayName = character?.displayName
  const displayName = typeof rawDisplayName === 'string' ? rawDisplayName.trim() : ''
  if (displayName) return displayName

  const rawName = character?.name
  const name = typeof rawName === 'string' ? rawName : ''
  return name || fallback
}

export function getCharacterDisplaySearchText(character: CharacterDisplayNameSource): string {
  return getCharacterDisplayInfo(character, '').searchText
}

export function getCharacterDisplayInfo(
  character: CharacterDisplayNameSource,
  fallback = 'Unnamed',
): CharacterDisplayInfo {
  const rawDisplayName = character?.displayName
  const displayName = typeof rawDisplayName === 'string' ? rawDisplayName.trim() : ''
  const rawName = character?.name
  const internalName = typeof rawName === 'string' ? rawName : ''
  const name = displayName || internalName || fallback
  const searchText = displayName && displayName !== internalName ? `${displayName} ${internalName}`.trim() : name

  return { name, searchText }
}
