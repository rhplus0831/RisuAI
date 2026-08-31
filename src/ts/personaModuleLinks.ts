import type { Chat, Database } from './storage/database.svelte'

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function resolveChatBoundPersonaId(chat: Chat | undefined): string | null {
  if (chat?.generationSettings !== undefined) {
    const chatPersonaId = chat.generationSettings.personaId
    return nonEmptyString(chatPersonaId) ? chatPersonaId : null
  }
  return nonEmptyString(chat?.bindedPersona) ? chat.bindedPersona : null
}

export function resolveEffectivePersonaId(database: Database, chat: Chat | undefined): string | null {
  const chatPersonaId = resolveChatBoundPersonaId(chat)
  if (chatPersonaId) return chatPersonaId
  if (chat?.generationSettings !== undefined) return null

  const selectedPersonaId = database.selectedPersonaId
  if (!nonEmptyString(selectedPersonaId)) return null
  const personas = canonicalPersonaCollection(database.personas ?? [])
  return personas && uniquePersona(personas, selectedPersonaId) ? selectedPersonaId : null
}

export function resolvePersonaModuleIds(database: Database, chat: Chat | undefined): string[] {
  const personaId = resolveEffectivePersonaId(database, chat)
  return resolvePersonaModuleIdsById(database, personaId)
}

export function resolvePersonaModuleIdsById(database: Database, personaId: string | null | undefined): string[] {
  if (!personaId) return []
  const personas = canonicalPersonaCollection(database.personas ?? [])
  const persona = personas ? uniquePersona(personas, personaId) : null
  if (!persona || !Array.isArray(persona.modules)) return []
  return Array.from(new Set(persona.modules.filter(nonEmptyString)))
}

export function isPersonaLinkedModule(database: Database, chat: Chat | undefined, moduleId: string): boolean {
  return resolvePersonaModuleIds(database, chat).includes(moduleId)
}

function uniquePersona(personas: Database['personas'], personaId: string): Database['personas'][number] | null {
  const matches = personas.filter((candidate) => candidate?.id === personaId)
  return matches.length === 1 ? matches[0] : null
}

function canonicalPersonaCollection(personas: Database['personas']): Database['personas'] | null {
  const ids = new Set<string>()
  for (const persona of personas) {
    if (!nonEmptyString(persona?.id) || ids.has(persona.id)) return null
    ids.add(persona.id)
  }
  return personas
}
