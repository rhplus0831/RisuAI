import { get } from 'svelte/store'
import { resolveUniquePromptPreset } from '@risuai/shared-core/effective-prompt-template'
import { selectedCharID } from '../stores.svelte'
import { parseKeyValue } from '../util'
import { setChatVarBackend } from './chatVarBackend'
import { setParserStateBackend } from './parserStateBackend'
import {
  currentChatScriptstateSnapshot,
  dispatchCurrentChatScriptstatePatch,
  dispatchPatchChatScriptstateScoped,
  type ChatScriptstateSnapshot,
} from '../chatCommands'
import { withTrustedResourceWrite } from '../server/resourceWriteGuard.svelte'
import {
  applyChatScriptstateOwnerValue,
  charactersResourceState,
  collectionsResourceState,
  getCharacterResourceOwner,
  getChatScriptstateOwnerSnapshot,
  settingsResourceState,
  type ChatScriptstateOwnerSnapshot,
} from '../server/resourceState.svelte'
import type { Database } from '../storage/database.svelte'

function currentChatScriptstateOwner(): ChatScriptstateOwnerSnapshot | undefined {
  const character = charactersResourceState.characters[charactersResourceState.currentChar]
  if (!character?.chaId) return undefined
  const chat = character.chats?.[character.chatPage]
  if (!chat?.id) return undefined
  return getChatScriptstateOwnerSnapshot(character.chaId, chat.id)
}

function preReadySelectedCharacter() {
  if (charactersResourceState.status !== 'idle' && charactersResourceState.status !== 'loading') return undefined
  return charactersResourceState.characters[get(selectedCharID)]
}

function currentTemplateDefaultVariables(): string {
  const presetStatus = collectionsResourceState.statuses.promptPresets
  const selectionStatus = settingsResourceState.standaloneStatuses.promptPresetsId
  const promptOwnersReady = presetStatus === 'ready' && selectionStatus === 'ready'
  if (!promptOwnersReady) {
    if (presetStatus === 'error' || selectionStatus === 'error') return ''
    const compatibilityValue = (settingsResourceState.value as Record<string, unknown>).templateDefaultVariables
    return typeof compatibilityValue === 'string' ? compatibilityValue : ''
  }

  const presets = collectionsResourceState.values.promptPresets
  const selectedIndex = (settingsResourceState.value as Record<string, unknown>).promptPresetsId
  if (!Array.isArray(presets) || !Number.isInteger(selectedIndex) || (selectedIndex as number) < 0) return ''
  const candidate = presets[selectedIndex as number]
  if (!candidate || typeof candidate.id !== 'string') return ''
  const owner = resolveUniquePromptPreset(presets, candidate.id)
  return owner === candidate && typeof owner.templateDefaultVariables === 'string' ? owner.templateDefaultVariables : ''
}

export function getChatVar(key: string): string {
  const owner = charactersResourceState.status === 'ready' ? currentChatScriptstateOwner() : undefined
  const char = owner ? getCharacterResourceOwner(owner.characterId) : preReadySelectedCharacter()
  if (!char) {
    return 'null'
  }
  const chat = owner ? undefined : char.chats[char.chatPage]
  const state = owner?.scriptstate?.['$' + key] ?? chat?.scriptstate?.['$' + key]
  if (state === undefined || state === null) {
    const defaultVariables = parseKeyValue(char.defaultVariables).concat(
      parseKeyValue(currentTemplateDefaultVariables()),
    )
    const findResult = defaultVariables.find((f) => {
      return f[0] === key
    })
    if (findResult) {
      return findResult[1]
    }
    return 'null'
  }
  return state.toString()
}

export function setChatVar(key: string, value: string): boolean {
  if (charactersResourceState.status === 'ready') {
    const owner = currentChatScriptstateOwner()
    const stateKey = '$' + key
    if (!owner || owner.scriptstate?.[stateKey] === value) return false
    if (!applyChatScriptstateOwnerValue(owner.characterId, owner.chatId, stateKey, value)) return false
    const previous: ChatScriptstateSnapshot = {
      characterId: owner.characterId,
      chatId: owner.chatId,
      selectedCharID: charactersResourceState.currentChar,
      scriptstate: owner.scriptstate,
    }
    dispatchPatchChatScriptstateScoped(owner.chatId, { [stateKey]: value }, [], previous)
    return true
  }

  const previous = currentChatScriptstateSnapshot()
  let updated = false
  withTrustedResourceWrite(() => {
    const character = preReadySelectedCharacter()
    const chat = character?.chats?.[character.chatPage]
    if (!chat) return
    const stateKey = '$' + key
    if (chat.scriptstate?.[stateKey] === value) return
    chat.scriptstate ??= {}
    chat.scriptstate[stateKey] = value
    updated = true
  })
  if (updated) {
    dispatchCurrentChatScriptstatePatch({ ['$' + key]: value }, [], previous)
  }
  return updated
}

export function getGlobalChatVar(key: string): string {
  if (settingsResourceState.groupStatuses.sidebar === 'error') return 'null'
  const globalChatVariables = (settingsResourceState.value as Record<string, unknown>).globalChatVariables
  if (!globalChatVariables || typeof globalChatVariables !== 'object' || Array.isArray(globalChatVariables))
    return 'null'
  const value = (globalChatVariables as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : 'null'
}

setChatVarBackend({ getChatVar, setChatVar, getGlobalChatVar })
setParserStateBackend({
  // The parser only consults `characters` for its optional accurate-tokenizer
  // fallback, so keep this adapter narrow instead of exposing the aggregate
  // resource database.
  getDefaultDatabase: () =>
    charactersResourceState.status === 'error'
      ? null
      : ({ characters: charactersResourceState.characters } as Database),
  getDefaultSelectedCharID: () =>
    charactersResourceState.status === 'ready'
      ? charactersResourceState.currentChar
      : charactersResourceState.status === 'idle' || charactersResourceState.status === 'loading'
        ? get(selectedCharID)
        : -1,
})
