import { resolvePromptPresetRegexField } from '../presetSplit'
import { resolveUniquePromptPreset } from '@risuai/shared-core/effective-prompt-template'
import { getCurrentChat, getDatabase, type Chat, type Database, type customscript } from '../storage/database.svelte'
import { getSelectedCharacterOwner } from '../characterState'
import {
  charactersResourceState,
  collectionsResourceState,
  getCharacterResourceOwner,
  getChatMetadataOwnerState,
  settingsResourceState,
} from '../server/resourceState.svelte'

type PromptPresetRegexRecord = {
  id?: unknown
  regex?: unknown
  presetRegex?: unknown
}

function selectedPromptPresetId(currentChat: Chat | undefined): string {
  const promptPresetId = currentChat?.generationSettings?.promptPresetId
  return typeof promptPresetId === 'string' ? promptPresetId.trim() : ''
}

function promptPresetRecords(db: Database): PromptPresetRegexRecord[] {
  return Array.isArray(db.promptPresets) ? (db.promptPresets as PromptPresetRegexRecord[]) : []
}

function customScriptArray(value: unknown): customscript[] {
  return Array.isArray(value) ? (value as customscript[]) : []
}

function selectedPromptRegexChatOwner(): Chat | undefined {
  if (charactersResourceState.status === 'error') return undefined
  if (charactersResourceState.status === 'idle' || charactersResourceState.status === 'loading') {
    return getCurrentChat()
  }

  const character = getSelectedCharacterOwner()
  if (!character?.chaId || getCharacterResourceOwner(character.chaId) !== character) return undefined
  const candidate = character.chats?.[character.chatPage]
  if (!candidate?.id) return undefined
  if (character.chats.filter((chat) => chat?.id === candidate.id).length !== 1) return undefined
  return getChatMetadataOwnerState(candidate.id) ? candidate : undefined
}

function currentPromptPresetRegexOwner(currentChat?: Chat): {
  currentChat: Chat | undefined
  presetRegex: unknown
  promptPresets: PromptPresetRegexRecord[]
} | null {
  const promptSettingsStatus = settingsResourceState.groupStatuses.prompt ?? settingsResourceState.status
  const promptCollectionStatus = collectionsResourceState.statuses.promptPresets ?? collectionsResourceState.status
  if (
    settingsResourceState.status === 'error' ||
    collectionsResourceState.status === 'error' ||
    (charactersResourceState.status === 'error' && !currentChat) ||
    promptSettingsStatus === 'error' ||
    promptCollectionStatus === 'error'
  ) {
    return null
  }

  let compatibilityDatabase: Database | undefined
  const compatibility = () => (compatibilityDatabase ??= getDatabase())
  const promptPresets =
    promptCollectionStatus === 'ready' || collectionsResourceState.status === 'ready'
      ? promptPresetRecords({ promptPresets: collectionsResourceState.values.promptPresets } as Database)
      : promptPresetRecords(compatibility())
  const presetRegex =
    promptSettingsStatus === 'ready' || settingsResourceState.status === 'ready'
      ? settingsResourceState.value.presetRegex
      : compatibility().presetRegex

  return {
    currentChat: currentChat ?? selectedPromptRegexChatOwner(),
    presetRegex,
    promptPresets,
  }
}

export function getActivePromptPresetRegexScripts(db?: Database, currentChat?: Chat): customscript[] {
  if (db) {
    const promptPresetId = selectedPromptPresetId(currentChat ?? getCurrentChat())
    if (promptPresetId) {
      const preset = resolveUniquePromptPreset(promptPresetRecords(db), promptPresetId)
      const regexField = resolvePromptPresetRegexField(preset)
      return regexField.present ? customScriptArray(regexField.value) : []
    }
    return customScriptArray(db.presetRegex)
  }

  const owner = currentPromptPresetRegexOwner(currentChat)
  if (!owner) return []
  const promptPresetId = selectedPromptPresetId(owner.currentChat)
  if (promptPresetId) {
    const preset = resolveUniquePromptPreset(owner.promptPresets, promptPresetId)
    const regexField = resolvePromptPresetRegexField(preset)
    return regexField.present ? customScriptArray(regexField.value) : []
  }
  return customScriptArray(owner.presetRegex)
}
