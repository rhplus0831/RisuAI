export interface PersonaProfileDigestValue {
  name: string
  icon: string
  personaPrompt: string
  note: string
}

export function serializePersonaIdsDigestInput(personaIds: readonly string[]): string {
  return `persona-mutation-ids-v1:${JSON.stringify(personaIds)}`
}

export function serializePersonaCollectionDigestInput(personas: readonly unknown[]): string {
  return `persona-mutation-collection-v1:${JSON.stringify(sortJsonValue(personas))}`
}

export function serializePersonaProfileDigestInput(profile: PersonaProfileDigestValue): string {
  return `persona-mutation-profile-v1:${JSON.stringify({
    name: profile.name,
    icon: profile.icon,
    personaPrompt: profile.personaPrompt,
    note: profile.note,
  })}`
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (!value || typeof value !== 'object') return value

  const sorted = Object.create(null) as Record<string, unknown>
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortJsonValue((value as Record<string, unknown>)[key])
  }
  return sorted
}
