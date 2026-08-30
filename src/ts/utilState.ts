import { get } from 'svelte/store'
import { getPersonaDisplayName } from './personaDisplayName'
import {
  resolveEffectivePromptTemplate,
  type EffectivePromptTemplateOptions,
} from '@risuai/shared-core/effective-prompt-template'
import { getDatabase, type Chat, type Database } from './storage/database.svelte'
import { selectedCharID } from './stores/coreStores.svelte'
import { resolveChatBoundPersonaId } from './personaModuleLinks'

export interface UserPersonaPresentation {
  currentUsername: string
  userIcon: string
  userIconPortrait: boolean
}

export function resolveUserPersonaPresentation(database: Database, chat: Chat | undefined): UserPersonaPresentation {
  const personaId = resolveChatBoundPersonaId(chat)
  const persona = personaId ? database.personas?.find((candidate) => candidate.id === personaId) : undefined
  if (persona) {
    return {
      currentUsername: getPersonaDisplayName(persona),
      userIcon: persona.icon ?? '',
      userIconPortrait: persona.largePortrait ?? false,
    }
  }

  const selectedPersona = database.personas?.[database.selectedPersona]
  return {
    currentUsername: getPersonaDisplayName(
      {
        name: database.username ?? selectedPersona?.name,
        displayName: selectedPersona?.displayName,
      },
      'User',
    ),
    userIcon: database.userIcon ?? '',
    userIconPortrait: selectedPersona?.largePortrait ?? false,
  }
}

export const replacePlaceholders = (msg: string, name: string) => {
  const db = getDatabase()
  const selectedChar = get(selectedCharID)
  const currentChar = db.characters[selectedChar]
  return msg
    .replace(/({{char}})|({{Char}})|(<Char>)|(<char>)/gi, currentChar.name)
    .replace(/({{user}})|({{User}})|(<User>)|(<user>)/gi, getUserName())
    .replace(/(\{\{((set)|(get))var::.+?\}\})/gu, '')
}

export function checkPersonaBinded() {
  try {
    const db = getDatabase()
    const selectedChar = get(selectedCharID)
    const character = db.characters[selectedChar]
    const chat = character.chats[character.chatPage]
    const personaId = resolveChatBoundPersonaId(chat)
    if (!personaId) {
      return null
    }
    const persona = db.personas.find((v) => v.id === personaId)
    return persona
  } catch (error) {
    return null
  }
}

export function getUserName() {
  const bindedPersona = checkPersonaBinded()
  if (bindedPersona) {
    return bindedPersona.name
  }
  const db = getDatabase()
  return db.username ?? 'User'
}

export function getUserDisplayName() {
  const db = getDatabase()
  const selectedChar = get(selectedCharID)
  const character = db.characters?.[selectedChar]
  return resolveUserPersonaPresentation(db, character?.chats?.[character.chatPage]).currentUsername
}

export function getUserIcon() {
  const db = getDatabase()
  const selectedChar = get(selectedCharID)
  const character = db.characters?.[selectedChar]
  return resolveUserPersonaPresentation(db, character?.chats?.[character.chatPage]).userIcon
}

export function getPersonaPrompt() {
  const bindedPersona = checkPersonaBinded()
  if (bindedPersona) {
    return bindedPersona.personaPrompt
  }
  const db = getDatabase()
  return db.personaPrompt ?? ''
}

export function getUserIconProtrait() {
  try {
    const db = getDatabase()
    const selectedChar = get(selectedCharID)
    const character = db.characters?.[selectedChar]
    return resolveUserPersonaPresentation(db, character?.chats?.[character.chatPage]).userIconPortrait
  } catch (error) {
    return false
  }
}

export function getAuthorNoteDefaultText(options: EffectivePromptTemplateOptions = {}) {
  const db = getDatabase()
  const template = resolveEffectivePromptTemplate(db, options).promptTemplate
  if (!template) {
    return ''
  }

  for (const v of template) {
    if (v.type === 'authornote') {
      return v.defaultText ?? ''
    }
  }
  return ''
}
