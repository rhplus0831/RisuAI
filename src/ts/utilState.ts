import { get } from 'svelte/store'
import { getPersonaDisplayName } from './personaDisplayName'
import {
  resolveEffectivePromptTemplate,
  type EffectivePromptTemplateOptions,
} from '@risuai/shared-core/effective-prompt-template'
import { type Chat, type Database, type character } from './storage/database.svelte'
import { selectedCharID } from './stores/coreStores.svelte'
import { resolveChatBoundPersonaId } from './personaModuleLinks'
import { selectCharacterOwner } from './characterState'
import {
  charactersResourceState,
  collectionsResourceState,
  getChatMetadataOwnerSnapshot,
  settingsResourceState,
} from './server/resourceState.svelte'

export interface UserPersonaPresentation {
  currentUsername: string
  userIcon: string
  userIconPortrait: boolean
}

function selectedPersonaRecord(database: Database): Database['personas'][number] | undefined {
  const index = database.selectedPersona
  const persona = database.personas?.[index]
  const id = persona?.id
  if (!persona || typeof id !== 'string' || id.trim() === '') return undefined
  if (database.personas.filter((candidate) => candidate?.id === id).length !== 1) return undefined
  return persona
}

function uniquePersonaRecord(
  personas: Database['personas'],
  personaId: string,
): Database['personas'][number] | undefined {
  const matches = personas.filter((candidate) => candidate?.id === personaId)
  return matches.length === 1 ? matches[0] : undefined
}

function personaOwnerRows(): Database['personas'] {
  const personas = collectionsResourceState.values.personas
  const status = collectionsResourceState.statuses.personas
  if (status === 'ready') {
    return Array.isArray(personas) ? personas : []
  }
  if (status === 'error') return []
  // Before the collection read completes, this value is the compatibility
  // projection retained by bootstrap. A ready owner never falls through here.
  return Array.isArray(personas) ? personas : []
}

function personaPresentationDatabase(): Database {
  const settings = settingsResourceState.value as unknown as Partial<Database>
  return {
    personas: personaOwnerRows(),
    selectedPersona: Number.isInteger(settings.selectedPersona) ? settings.selectedPersona : -1,
    username: typeof settings.username === 'string' ? settings.username : 'User',
    userIcon: typeof settings.userIcon === 'string' ? settings.userIcon : '',
    personaPrompt: typeof settings.personaPrompt === 'string' ? settings.personaPrompt : '',
  } as Database
}

function selectedCharacterPresentationOwner(): character | undefined {
  const status = charactersResourceState.status
  if (status !== 'ready' && status !== 'idle' && status !== 'loading') return undefined
  const selectedIndex = status === 'ready' ? charactersResourceState.currentChar : get(selectedCharID)
  return selectCharacterOwner(charactersResourceState.characters, selectedIndex)
}

function selectedChatPresentationOwner(): Chat | undefined {
  const character = selectedCharacterPresentationOwner()
  if (!character?.chaId) return undefined

  const candidate = character.chats?.[character.chatPage]
  const chatId = candidate?.id
  if (typeof chatId !== 'string' || chatId.trim() === '') return undefined

  let globalOwner: Chat | undefined
  for (const characterOwner of charactersResourceState.characters) {
    for (const chatOwner of characterOwner.chats ?? []) {
      if (chatOwner?.id !== chatId) continue
      if (globalOwner) return undefined
      globalOwner = chatOwner
    }
  }
  if (globalOwner !== candidate) return undefined

  const metadataOwner = getChatMetadataOwnerSnapshot(character.chaId, chatId)
  if (!metadataOwner) return undefined
  return { ...candidate, ...metadataOwner.metadata } as Chat
}

export function resolveUserPersonaPresentation(database: Database, chat: Chat | undefined): UserPersonaPresentation {
  const personaId = resolveChatBoundPersonaId(chat)
  const persona = personaId ? uniquePersonaRecord(database.personas ?? [], personaId) : undefined
  if (persona) {
    return {
      currentUsername: getPersonaDisplayName(persona),
      userIcon: persona.icon ?? '',
      userIconPortrait: persona.largePortrait ?? false,
    }
  }

  const selectedPersona = selectedPersonaRecord(database)
  return {
    currentUsername: getPersonaDisplayName(
      {
        name: selectedPersona?.name ?? database.username,
        displayName: selectedPersona?.displayName,
      },
      'User',
    ),
    userIcon: selectedPersona?.icon ?? database.userIcon ?? '',
    userIconPortrait: selectedPersona?.largePortrait ?? false,
  }
}

export const replacePlaceholders = (msg: string, name: string) => {
  const currentChar = selectedCharacterPresentationOwner()
  return msg
    .replace(/({{char}})|({{Char}})|(<Char>)|(<char>)/gi, currentChar?.name ?? name)
    .replace(/({{user}})|({{User}})|(<User>)|(<user>)/gi, getUserName())
    .replace(/(\{\{((set)|(get))var::.+?\}\})/gu, '')
}

export function checkPersonaBinded() {
  try {
    const chat = selectedChatPresentationOwner()
    const personaId = resolveChatBoundPersonaId(chat)
    if (!personaId) {
      return null
    }
    return uniquePersonaRecord(personaOwnerRows(), personaId) ?? null
  } catch (error) {
    return null
  }
}

export function getUserName() {
  const bindedPersona = checkPersonaBinded()
  if (bindedPersona) {
    return bindedPersona.name
  }
  const db = personaPresentationDatabase()
  return selectedPersonaRecord(db)?.name ?? db.username ?? 'User'
}

export function getUserDisplayName() {
  return resolveUserPersonaPresentation(personaPresentationDatabase(), selectedChatPresentationOwner()).currentUsername
}

export function getUserIcon() {
  return resolveUserPersonaPresentation(personaPresentationDatabase(), selectedChatPresentationOwner()).userIcon
}

export function getPersonaPrompt() {
  const bindedPersona = checkPersonaBinded()
  if (bindedPersona) {
    return bindedPersona.personaPrompt
  }
  const db = personaPresentationDatabase()
  return selectedPersonaRecord(db)?.personaPrompt ?? db.personaPrompt ?? ''
}

export function getUserIconProtrait() {
  try {
    return resolveUserPersonaPresentation(personaPresentationDatabase(), selectedChatPresentationOwner())
      .userIconPortrait
  } catch (error) {
    return false
  }
}

export function getAuthorNoteDefaultText(options: EffectivePromptTemplateOptions = {}) {
  const settings = settingsResourceState.value as unknown as Partial<Database>
  const template = resolveEffectivePromptTemplate(
    {
      promptPresets: collectionsResourceState.values.promptPresets,
      promptPresetsId: settings.promptPresetsId,
      promptTemplate: collectionsResourceState.values.promptTemplate,
    },
    options,
  ).promptTemplate
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
