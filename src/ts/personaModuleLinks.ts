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

  const selectedIndex = Number.isInteger(database.selectedPersona) ? database.selectedPersona : -1
  const selectedPersonaId = selectedIndex >= 0 ? database.personas?.[selectedIndex]?.id : undefined
  return nonEmptyString(selectedPersonaId) ? selectedPersonaId : null
}

export function resolvePersonaModuleIds(database: Database, chat: Chat | undefined): string[] {
  const personaId = resolveEffectivePersonaId(database, chat)
  return resolvePersonaModuleIdsById(database, personaId)
}

export function resolvePersonaModuleIdsById(database: Database, personaId: string | null | undefined): string[] {
  if (!personaId) return []
  const persona = database.personas?.find((candidate) => candidate.id === personaId)
  if (!persona || !Array.isArray(persona.modules)) return []
  return Array.from(new Set(persona.modules.filter(nonEmptyString)))
}

export function isPersonaLinkedModule(database: Database, chat: Chat | undefined, moduleId: string): boolean {
  return resolvePersonaModuleIds(database, chat).includes(moduleId)
}
