import { untrack } from 'svelte'
import { get, writable } from 'svelte/store'
import { resolveActiveModuleStates } from '../moduleActivation'
import { selectedCharID } from '../stores.svelte'
import { getDatabase, type Chat, type Database, type character } from '../storage/database.svelte'
import {
  charactersResourceState,
  collectionsResourceState,
  getChatMetadataOwnerSnapshot,
  settingsResourceState,
  type ServerCollectionName,
} from '../server/resourceState.svelte'
import type { SettingsGroup } from '@risuai/shared-core/settings-groups'

export const RegexDisplayReloadPointer = writable(0)

export interface RegexDisplayReloadScopeState {
  epoch: number
  ownerEpochs: Readonly<Record<string, number>>
}

export interface RegexDisplayReloadContext {
  characterId?: string | null
  chatId?: string | null
}

const ALL_REGEX_DISPLAY_OWNERS = '*'

export const RegexDisplayReloadScope = writable<RegexDisplayReloadScopeState>({
  epoch: 0,
  ownerEpochs: {},
})

export function normalizeRegexDisplayOwnerKey(ownerKey: string | null | undefined): string {
  return ownerKey?.trim() || ALL_REGEX_DISPLAY_OWNERS
}

export function reloadRegexDisplay(ownerKey?: string | null) {
  const normalizedOwnerKey = normalizeRegexDisplayOwnerKey(ownerKey)
  const nextPointer = get(RegexDisplayReloadPointer) + 1
  RegexDisplayReloadScope.update((state) => ({
    epoch: nextPointer,
    ownerEpochs: {
      ...state.ownerEpochs,
      [normalizedOwnerKey]: nextPointer,
    },
  }))
  RegexDisplayReloadPointer.set(nextPointer)
}

/**
 * Produce a stable token containing only reload owners that can affect the
 * requested character/chat. Unrelated owner activations leave the token equal,
 * so Svelte dependents do not re-run their parsers.
 */
export function regexDisplayReloadTokenForContext(
  pointer: number,
  scope: RegexDisplayReloadScopeState,
  context: RegexDisplayReloadContext = {},
): string {
  if (scope.epoch !== pointer) return `legacy:${pointer}`

  return untrack(() => {
    const ownerState = regexDisplayOwnerState()
    const selectedCharacter = resolveContextCharacter(
      ownerState.characters,
      ownerState.selectedCharacterIndex,
      context.characterId,
    )
    const selectedChatStructure = resolveContextChat(ownerState.characters, selectedCharacter, context.chatId)
    const selectedChat =
      ownerState.ready && selectedCharacter && selectedChatStructure
        ? projectChatMetadataOwner(selectedCharacter, selectedChatStructure)
        : selectedChatStructure
    const ownerKeys = [ALL_REGEX_DISPLAY_OWNERS, 'global']

    const characterId = selectedCharacter?.chaId
    if (characterId) {
      ownerKeys.push(characterId, `character:${characterId}`)
    }

    const promptPresetId = selectedChat?.generationSettings?.promptPresetId?.trim()
    ownerKeys.push(promptPresetId ? `preset:${promptPresetId}` : 'root')

    if (ownerState.database) {
      for (const state of resolveActiveModuleStates(ownerState.database, selectedCharacter, selectedChat)) {
        ownerKeys.push(`module:${state.module.id}`)
      }
    }

    return ownerKeys.map((key) => `${key}:${scope.ownerEpochs[key] ?? 0}`).join('|')
  })
}

export function currentRegexDisplayReloadToken(context: RegexDisplayReloadContext = {}): string {
  return regexDisplayReloadTokenForContext(get(RegexDisplayReloadPointer), get(RegexDisplayReloadScope), context)
}

export function resetRegexDisplayReloadForTests(): void {
  RegexDisplayReloadPointer.set(0)
  RegexDisplayReloadScope.set({ epoch: 0, ownerEpochs: {} })
}

function resolveContextCharacter(
  characters: readonly character[],
  selectedCharacterIndex: number,
  characterId: string | null | undefined,
): character | undefined {
  if (characterId !== null && characterId !== undefined) {
    const normalizedCharacterId = characterId.trim()
    return normalizedCharacterId ? uniqueCharacterOwner(characters, normalizedCharacterId) : undefined
  }

  const candidate = characters[selectedCharacterIndex]
  return candidate?.chaId ? uniqueCharacterOwner(characters, candidate.chaId) : undefined
}

function resolveContextChat(
  characters: readonly character[],
  selectedCharacter: character | undefined,
  chatId: string | null | undefined,
): Chat | undefined {
  if (!selectedCharacter) return undefined
  if (chatId !== null && chatId !== undefined) {
    const normalizedChatId = chatId.trim()
    return normalizedChatId ? uniqueChatOwner(characters, selectedCharacter, normalizedChatId) : undefined
  }

  const candidate = selectedCharacter.chats?.[selectedCharacter.chatPage]
  return candidate?.id ? uniqueChatOwner(characters, selectedCharacter, candidate.id) : undefined
}

function uniqueCharacterOwner(characters: readonly character[], characterId: string): character | undefined {
  let owner: character | undefined
  for (const candidate of characters) {
    if (candidate?.chaId !== characterId) continue
    if (owner) return undefined
    owner = candidate
  }
  return owner
}

function uniqueChatOwner(
  characters: readonly character[],
  selectedCharacter: character,
  chatId: string,
): Chat | undefined {
  let owner: { character: character; chat: Chat } | undefined
  for (const character of characters) {
    for (const chat of character.chats ?? []) {
      if (chat?.id !== chatId) continue
      if (owner) return undefined
      owner = { character, chat }
    }
  }
  return owner?.character === selectedCharacter ? owner.chat : undefined
}

function projectChatMetadataOwner(selectedCharacter: character, selectedChat: Chat): Chat | undefined {
  const characterId = selectedCharacter.chaId?.trim()
  const chatId = selectedChat.id?.trim()
  if (!characterId || !chatId) return undefined
  const snapshot = getChatMetadataOwnerSnapshot(characterId, chatId)
  if (!snapshot) return undefined

  return {
    ...selectedChat,
    modules: Array.isArray(snapshot.metadata.modules) ? (snapshot.metadata.modules as string[]) : undefined,
    bindedPersona: typeof snapshot.metadata.bindedPersona === 'string' ? snapshot.metadata.bindedPersona : undefined,
  }
}

function regexDisplayOwnerState(): {
  database: Database | undefined
  characters: readonly character[]
  selectedCharacterIndex: number
  ready: boolean
} {
  if (charactersResourceState.status === 'ready') {
    return {
      database: canonicalModuleActivationDatabase(),
      characters: charactersResourceState.characters,
      selectedCharacterIndex: charactersResourceState.currentChar,
      ready: true,
    }
  }

  if (charactersResourceState.status === 'idle' || charactersResourceState.status === 'loading') {
    const database = getDatabase()
    return {
      database,
      characters: database.characters ?? [],
      selectedCharacterIndex: get(selectedCharID),
      ready: false,
    }
  }

  return {
    database: canonicalModuleActivationDatabase(),
    characters: [],
    selectedCharacterIndex: -1,
    ready: false,
  }
}

function canonicalModuleActivationDatabase(): Database | undefined {
  const moduleSettings = settingsGroupOwner('modules')
  const advancedSettings = settingsGroupOwner('advanced')
  const agentSettings = settingsGroupOwner('agents')
  const personaSelection = standaloneSettingsOwner()
  const modules = stableOwnerCollection<Database['modules'][number]>(collectionOwner('modules'))
  const promptPresets = stableOwnerCollection<Database['promptPresets'][number]>(collectionOwner('promptPresets'))
  const personas = stableOwnerCollection<Database['personas'][number]>(collectionOwner('personas'))
  const agentPresets = stableOwnerCollection<Database['agentPresets'][number]>(agentSettings?.agentPresets)
  const enabledModules = moduleSettings?.enabledModules
  if (
    !moduleSettings ||
    !advancedSettings ||
    !agentSettings ||
    !personaSelection ||
    !modules ||
    !promptPresets ||
    !personas ||
    !agentPresets ||
    !Array.isArray(enabledModules) ||
    !enabledModules.every((id) => typeof id === 'string' && id.trim().length > 0)
  ) {
    return undefined
  }

  return {
    modules,
    promptPresets,
    personas,
    enabledModules,
    moduleIntergration: advancedSettings.moduleIntergration,
    agentPresets,
    agentPresetDefaultId: agentSettings.agentPresetDefaultId,
    selectedPersonaId: personaSelection.selectedPersonaId,
  } as Database
}

function settingsGroupOwner(group: SettingsGroup): Partial<Database> | undefined {
  const status = settingsResourceState.groupStatuses[group] ?? 'idle'
  if (settingsResourceState.status === 'error' || status === 'error') return undefined
  if (status === 'ready') return settingsResourceState.value as Partial<Database>
  if (status === 'idle' || status === 'loading') return getDatabase()
  return undefined
}

function collectionOwner<Name extends ServerCollectionName>(name: Name): Database[Name] | undefined {
  const status = collectionsResourceState.statuses[name] ?? 'idle'
  if (collectionsResourceState.status === 'error' || status === 'error') return undefined
  if (status === 'ready') return collectionsResourceState.values[name] as Database[Name] | undefined
  if (status === 'idle' || status === 'loading') return getDatabase()[name]
  return undefined
}

function standaloneSettingsOwner(): Partial<Database> | undefined {
  const status = settingsResourceState.standaloneStatuses.selectedPersonaId ?? 'idle'
  if (settingsResourceState.status === 'error' || status === 'error') return undefined
  if (status === 'ready') return settingsResourceState.value as Partial<Database>
  if (status === 'idle' || status === 'loading') return getDatabase()
  return undefined
}

function stableOwnerCollection<T extends { id?: unknown }>(value: unknown): T[] | undefined {
  if (!Array.isArray(value)) return undefined
  const ids = new Set<string>()
  for (const candidate of value) {
    const id = typeof candidate?.id === 'string' ? candidate.id.trim() : ''
    if (!id || ids.has(id)) return undefined
    ids.add(id)
  }
  return value as T[]
}
