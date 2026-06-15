import { resolvePromptPresetRegexField } from '../presetSplit'
import { getCurrentChat, getDatabase, type Chat, type Database, type customscript } from '../storage/database.svelte'

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

export function getActivePromptPresetRegexScripts(
  db: Database = getDatabase(),
  currentChat: Chat | undefined = getCurrentChat(),
): customscript[] {
  const promptPresetId = selectedPromptPresetId(currentChat)
  if (promptPresetId) {
    const preset = promptPresetRecords(db).find((candidate) => candidate?.id === promptPresetId)
    const regexField = resolvePromptPresetRegexField(preset)
    return regexField.present ? customScriptArray(regexField.value) : []
  }
  return customScriptArray(db.presetRegex)
}
