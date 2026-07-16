import { normalizeAllCharacterChats, type ChatRecord } from './chats.js'
import { ensureLoadoutCollection } from './loadouts.js'

type JsonRecord = Record<string, unknown>

export type GenerationReferenceKind = 'persona' | 'modelPreset' | 'promptPreset'

export interface GenerationReferenceReplacement {
  id: string
  name?: string
}

export interface GenerationReferenceCascadeResult {
  changedChats: Array<{ chatId: string; chat: ChatRecord }>
  changedChatCount: number
  changedLoadoutCount: number
}

/** Rehome chat and loadout references as part of an owner-delete transaction. */
export function rehomeGenerationReferences(
  target: JsonRecord,
  kind: GenerationReferenceKind,
  deletedId: string,
  replacement: GenerationReferenceReplacement | null,
): GenerationReferenceCascadeResult {
  const field = generationReferenceField(kind)
  const changedChats: Array<{ chatId: string; chat: ChatRecord }> = []

  for (const character of normalizeAllCharacterChats(target)) {
    const chats = Array.isArray(character.chats) ? character.chats : []
    for (const chat of chats) {
      const settings = chat.generationSettings
      if (!settings || settings[field] !== deletedId) continue
      if (replacement) settings[field] = replacement.id
      else delete settings[field]
      changedChats.push({ chatId: chat.id, chat })
    }
  }

  let changedLoadoutCount = 0
  for (const loadout of ensureLoadoutCollection(target)) {
    if (loadout[field] !== deletedId) continue
    const replacementId = replacement?.id ?? ''
    switch (kind) {
      case 'persona':
        loadout.personaId = replacementId
        break
      case 'modelPreset':
        loadout.modelPresetId = replacementId
        loadout.modelPresetName = replacement?.name ?? ''
        break
      case 'promptPreset':
        loadout.promptPresetId = replacementId
        loadout.promptPresetName = replacement?.name ?? ''
        break
    }
    changedLoadoutCount += 1
  }

  return {
    changedChats,
    changedChatCount: changedChats.length,
    changedLoadoutCount,
  }
}

function generationReferenceField(kind: GenerationReferenceKind): 'personaId' | 'modelPresetId' | 'promptPresetId' {
  switch (kind) {
    case 'persona':
      return 'personaId'
    case 'modelPreset':
      return 'modelPresetId'
    case 'promptPreset':
      return 'promptPresetId'
  }
}
