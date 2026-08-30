import {
  captureCharacterRowProjectionEpoch,
  captureCollectionProjectionEpoch,
  charactersResourceState,
  getCharacterResourceOwner,
  hasCharacterRowProjectionEpochChanged,
  hasCollectionProjectionEpochChanged,
} from './server/resourceState.svelte'
import { withTrustedResourceWrite } from './server/resourceWriteGuard.svelte'
import type { Database } from './storage/database.svelte'

type JsonRecord = Record<string, unknown>

export type GenerationReferenceKind = 'persona' | 'modelPreset' | 'promptPreset'

export interface GenerationReferenceReplacement {
  id: string
  name?: string
}

export interface OptimisticGenerationReferenceCascade {
  chatCount: number
  loadoutCount: number
  promptRecommendationCount: number
  rollback: () => void
}

interface FieldRollback {
  keys: string[]
  previous: Record<string, JsonFieldState>
  attempted: Record<string, JsonFieldState>
  resolveTarget: () => JsonRecord | undefined
  hasProjectionChanged: () => boolean
}

interface JsonFieldState {
  present: boolean
  value?: unknown
}

/**
 * Rehome every optimistic chat/loadout reference owned by a structural delete.
 * The returned rollback is identity-, field-, and projection-fenced so a failed
 * delete never overwrites a newer chat save, loadout edit, or authoritative read.
 */
export function optimisticallyRehomeGenerationReferences(input: {
  getDatabase: () => Database
  kind: GenerationReferenceKind
  deletedId: string
  replacement: GenerationReferenceReplacement | null
}): OptimisticGenerationReferenceCascade {
  const field = generationReferenceField(input.kind)
  const database = input.getDatabase()
  const rollbacks: FieldRollback[] = []
  let chatCount = 0
  let loadoutCount = 0
  let promptRecommendationCount = 0

  withTrustedResourceWrite(() => {
    // Character/chat generation settings are owned by the explicit character
    // resource rows. Do not scan the aggregate mirror here: a row replacement
    // or duplicate stable id must make the cascade fail closed rather than
    // rehome a different character's chat.
    for (const character of charactersResourceState.characters) {
      const characterId = nonBlankId(character?.chaId)
      if (!characterId) continue
      const projectionEpoch = captureCharacterRowProjectionEpoch(characterId)
      const chats = Array.isArray(character?.chats) ? character.chats : []
      for (const chat of chats) {
        const chatId = nonBlankId(chat?.id)
        const generationSettings = asJsonRecord(chat?.generationSettings)
        if (
          !chatId ||
          !generationSettings ||
          generationSettings[field] !== input.deletedId ||
          resolveUniqueChatGenerationSettings(characterId, chatId) !== generationSettings
        ) {
          continue
        }
        rollbacks.push(
          captureFieldRollback({
            target: generationSettings,
            keys: [field],
            resolveTarget: () => resolveUniqueChatGenerationSettings(characterId, chatId),
            hasProjectionChanged: () => hasCharacterRowProjectionEpochChanged(characterId, projectionEpoch),
            mutate: () => assignOptionalReference(generationSettings, field, input.replacement?.id),
          }),
        )
        chatCount += 1
      }
    }

    const projectionEpoch = captureCollectionProjectionEpoch('loadouts')
    for (const loadout of database.loadouts ?? []) {
      const loadoutId = nonBlankId(loadout?.id)
      const target = asJsonRecord(loadout)
      if (!loadoutId || !target || target[field] !== input.deletedId) continue
      if (resolveUniqueLoadout(input.getDatabase(), loadoutId) !== target) continue
      const keys = loadoutReferenceKeys(input.kind)
      rollbacks.push(
        captureFieldRollback({
          target,
          keys,
          resolveTarget: () => resolveUniqueLoadout(input.getDatabase(), loadoutId),
          hasProjectionChanged: () => hasCollectionProjectionEpochChanged('loadouts', projectionEpoch),
          mutate: () => assignLoadoutReference(target, input.kind, input.replacement),
        }),
      )
      loadoutCount += 1
    }

    if (input.kind === 'modelPreset') {
      const promptPresetProjectionEpoch = captureCollectionProjectionEpoch('promptPresets')
      for (const promptPreset of database.promptPresets ?? []) {
        const promptPresetId = nonBlankId(promptPreset?.id)
        const target = asJsonRecord(promptPreset)
        if (
          !promptPresetId ||
          !target ||
          target.recommendedModelPresetId !== input.deletedId ||
          resolveUniquePromptPreset(input.getDatabase(), promptPresetId) !== target
        ) {
          continue
        }
        rollbacks.push(
          captureFieldRollback({
            target,
            keys: ['recommendedModelPresetId'],
            resolveTarget: () => resolveUniquePromptPreset(input.getDatabase(), promptPresetId),
            hasProjectionChanged: () =>
              hasCollectionProjectionEpochChanged('promptPresets', promptPresetProjectionEpoch),
            mutate: () => {
              target.recommendedModelPresetId = null
            },
          }),
        )
        promptRecommendationCount += 1
      }
    }
  })

  return {
    chatCount,
    loadoutCount,
    promptRecommendationCount,
    rollback: () => {
      withTrustedResourceWrite(() => {
        for (const rollback of rollbacks) restoreFields(rollback)
      })
    },
  }
}

function generationReferenceField(kind: GenerationReferenceKind): string {
  switch (kind) {
    case 'persona':
      return 'personaId'
    case 'modelPreset':
      return 'modelPresetId'
    case 'promptPreset':
      return 'promptPresetId'
  }
}

function loadoutReferenceKeys(kind: GenerationReferenceKind): string[] {
  switch (kind) {
    case 'persona':
      return ['personaId']
    case 'modelPreset':
      return ['modelPresetId', 'modelPresetName']
    case 'promptPreset':
      return ['promptPresetId', 'promptPresetName']
  }
}

function assignOptionalReference(target: JsonRecord, field: string, replacementId: string | undefined): void {
  if (replacementId) target[field] = replacementId
  else delete target[field]
}

function assignLoadoutReference(
  target: JsonRecord,
  kind: GenerationReferenceKind,
  replacement: GenerationReferenceReplacement | null,
): void {
  const id = replacement?.id ?? ''
  switch (kind) {
    case 'persona':
      target.personaId = id
      return
    case 'modelPreset':
      target.modelPresetId = id
      target.modelPresetName = replacement?.name ?? ''
      return
    case 'promptPreset':
      target.promptPresetId = id
      target.promptPresetName = replacement?.name ?? ''
  }
}

function captureFieldRollback(input: {
  target: JsonRecord
  keys: string[]
  resolveTarget: () => JsonRecord | undefined
  hasProjectionChanged: () => boolean
  mutate: () => void
}): FieldRollback {
  const previous = snapshotFields(input.target, input.keys)
  input.mutate()
  return {
    keys: input.keys,
    previous,
    attempted: snapshotFields(input.target, input.keys),
    resolveTarget: input.resolveTarget,
    hasProjectionChanged: input.hasProjectionChanged,
  }
}

function restoreFields(rollback: FieldRollback): void {
  if (rollback.hasProjectionChanged()) return
  const target = rollback.resolveTarget()
  if (!target) return
  if (rollback.keys.some((key) => !fieldMatches(target, key, rollback.attempted[key]))) return
  for (const key of rollback.keys) {
    const previous = rollback.previous[key]
    if (previous.present) target[key] = structuredCloneValue(previous.value)
    else delete target[key]
  }
}

function snapshotFields(target: JsonRecord, keys: readonly string[]): Record<string, JsonFieldState> {
  return Object.fromEntries(
    keys.map((key) => {
      const present = Object.prototype.hasOwnProperty.call(target, key) && target[key] !== undefined
      return [key, present ? { present: true, value: structuredCloneValue(target[key]) } : { present: false }]
    }),
  )
}

function fieldMatches(target: JsonRecord, key: string, expected: JsonFieldState): boolean {
  const present = Object.prototype.hasOwnProperty.call(target, key) && target[key] !== undefined
  if (!expected.present) return !present
  return present && JSON.stringify(target[key]) === JSON.stringify(expected.value)
}

function resolveUniqueChatGenerationSettings(characterId: string, chatId: string): JsonRecord | undefined {
  const character = getCharacterResourceOwner(characterId)
  if (!character) return undefined
  const chats = (character.chats ?? []).filter((chat) => chat?.id === chatId)
  return chats.length === 1 ? (asJsonRecord(chats[0].generationSettings) ?? undefined) : undefined
}

function resolveUniqueLoadout(database: Database, loadoutId: string): JsonRecord | undefined {
  const loadouts = (database.loadouts ?? []).filter((loadout) => loadout?.id === loadoutId)
  return loadouts.length === 1 ? (asJsonRecord(loadouts[0]) ?? undefined) : undefined
}

function resolveUniquePromptPreset(database: Database, promptPresetId: string): JsonRecord | undefined {
  const promptPresets = (database.promptPresets ?? []).filter((promptPreset) => promptPreset?.id === promptPresetId)
  return promptPresets.length === 1 ? (asJsonRecord(promptPresets[0]) ?? undefined) : undefined
}

function asJsonRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

function nonBlankId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function structuredCloneValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
