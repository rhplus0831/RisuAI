import { get } from 'svelte/store'
import { getPersonaDisplayName } from './personaDisplayName'
import {
  resolveEffectivePromptTemplate,
  type EffectivePromptTemplateOptions,
} from './process/promptAssembly/effectivePromptTemplate'
import { getDatabase } from './storage/database.svelte'
import { selectedCharID } from './stores/coreStores.svelte'

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
    const personaId =
      typeof chat.generationSettings?.personaId === 'string' && chat.generationSettings.personaId.trim()
        ? chat.generationSettings.personaId
        : chat.bindedPersona
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
  const bindedPersona = checkPersonaBinded()
  if (bindedPersona) {
    return getPersonaDisplayName(bindedPersona)
  }
  const db = getDatabase()
  const selectedPersona = db.personas?.[db.selectedPersona]
  return getPersonaDisplayName(
    {
      name: db.username ?? selectedPersona?.name,
      displayName: selectedPersona?.displayName,
    },
    'User',
  )
}

export function getUserIcon() {
  const bindedPersona = checkPersonaBinded()
  if (bindedPersona) {
    return bindedPersona.icon
  }
  const db = getDatabase()
  return db.userIcon ?? ''
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
    const bindedPersona = checkPersonaBinded()
    if (bindedPersona) {
      return bindedPersona.largePortrait
    }
    const db = getDatabase()
    return db.personas[db.selectedPersona].largePortrait
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
