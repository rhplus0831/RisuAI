export type PersonaDisplayNameSource =
  | {
      name?: string
      displayName?: string
    }
  | null
  | undefined

export interface PersonaDisplayInfo {
  name: string
  searchText: string
}

export function getPersonaDisplayName(persona: PersonaDisplayNameSource, fallback = 'User'): string {
  const rawDisplayName = persona?.displayName
  const displayName = typeof rawDisplayName === 'string' ? rawDisplayName.trim() : ''
  if (displayName) return displayName

  const rawName = persona?.name
  const name = typeof rawName === 'string' ? rawName : ''
  return name || fallback
}

export function getPersonaDisplaySearchText(persona: PersonaDisplayNameSource): string {
  return getPersonaDisplayInfo(persona, '').searchText
}

export function getPersonaDisplayInfo(persona: PersonaDisplayNameSource, fallback = 'User'): PersonaDisplayInfo {
  const rawDisplayName = persona?.displayName
  const displayName = typeof rawDisplayName === 'string' ? rawDisplayName.trim() : ''
  const rawName = persona?.name
  const internalName = typeof rawName === 'string' ? rawName : ''
  const name = displayName || internalName || fallback
  const searchText = displayName && displayName !== internalName ? `${displayName} ${internalName}`.trim() : name

  return { name, searchText }
}
