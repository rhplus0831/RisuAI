import { isDeepStrictEqual } from 'node:util'
import type { DatabaseSync } from 'node:sqlite'
import { getSchemaState } from '../db.js'
import { COMMAND_EVENT_CATALOG, type CommandEventOrigin, type CommandEventSink } from '../commands/events.js'
import { applyTargetedCommandMutation, type CommandMutationReceiptKey } from '../commands/mutations.js'
import type { GreetingTranslationJobHandle, GreetingTranslationJobRegistry } from '../greetingTranslationJobs.js'
import {
  EntityNotFoundError,
  ValidationError,
  loadCharacterSelectionRows,
  loadSettingsWithTranslatorPresetsFromSqlite,
} from '../repository.js'
import { createDetachedAbort } from '../requestAbort.js'
import { getGreetingTranslation, greetingSourceAtIndex, upsertGreetingTranslation } from './greetingTranslationStore.js'
import {
  resolveRawMessageTranslatorIdentity,
  translateRawMessageData,
  type RawMessageTranslation,
} from './rawMessageTranslation.js'

export interface RunServerGreetingTranslationInput {
  db: DatabaseSync
  dataDir: string
  eventSink: CommandEventSink
  greetingTranslationJobs?: GreetingTranslationJobRegistry
  characterId: string
  greetingIndex: number
  jobId?: string
  eventOrigin?: CommandEventOrigin
  mutationReceiptKey?: CommandMutationReceiptKey
}

function readCharacter(db: DatabaseSync, characterId: string): Record<string, unknown> {
  try {
    return loadCharacterSelectionRows(db, characterId).character
  } catch (error) {
    if (error instanceof EntityNotFoundError) throw error
    throw new ValidationError(`Character could not be loaded: ${characterId}`)
  }
}

function readGreetingSource(character: Record<string, unknown>, characterId: string, greetingIndex: number): string {
  const source = greetingSourceAtIndex(character, greetingIndex)
  if (source === null) {
    throw new EntityNotFoundError(`Greeting not found: ${characterId}/${greetingIndex}`)
  }
  return source
}

export async function runServerGreetingTranslation(input: RunServerGreetingTranslationInput) {
  const { signal, cleanup } = createDetachedAbort()
  let translationJob: GreetingTranslationJobHandle | undefined
  try {
    const character = readCharacter(input.db, input.characterId)
    const source = readGreetingSource(character, input.characterId, input.greetingIndex)
    const settings = loadSettingsWithTranslatorPresetsFromSqlite(input.db)
    if (settings === null) throw new ValidationError('database is not initialized')
    const identity = resolveRawMessageTranslatorIdentity({ settings, character })
    const priorRow = getGreetingTranslation(input.db, input.characterId, input.greetingIndex, identity.settingsHash)
    translationJob = input.greetingTranslationJobs?.register({
      characterId: input.characterId,
      greetingIndex: input.greetingIndex,
      settingsHash: identity.settingsHash,
      ...(input.jobId ? { jobId: input.jobId } : {}),
    })

    const translation = await translateRawMessageData({
      settings,
      character,
      text: source,
      signal,
    })

    const result = applyTargetedCommandMutation<{
      characterId: string
      greetingIndex: number
      settingsHash: string
      translation: RawMessageTranslation
    }>({
      db: input.db,
      dataDir: input.dataDir,
      baseRevision: getSchemaState(input.db).revision,
      eventSink: input.eventSink,
      ...(input.eventOrigin ? { eventOrigin: input.eventOrigin } : {}),
      ...(input.mutationReceiptKey ? { mutationReceiptKey: input.mutationReceiptKey } : {}),
      mutationPath: 'targeted-greeting-translation',
      skipDatabaseLoad: true,
      mutate(_database, targetDb) {
        const liveCharacter = readCharacter(targetDb, input.characterId)
        const liveSource = readGreetingSource(liveCharacter, input.characterId, input.greetingIndex)
        if (translationJob && !translationJob.isCurrent()) {
          throw new ValidationError(
            `Greeting translation is no longer current: ${input.characterId}/${input.greetingIndex}`,
          )
        }
        if (liveSource !== source) {
          throw new ValidationError(
            `Greeting changed before translation could be saved: ${input.characterId}/${input.greetingIndex}`,
          )
        }
        const livePriorRow = getGreetingTranslation(
          targetDb,
          input.characterId,
          input.greetingIndex,
          identity.settingsHash,
        )
        if (!isDeepStrictEqual(livePriorRow, priorRow)) {
          throw new ValidationError(
            `Greeting translation changed before translation could be saved: ${input.characterId}/${input.greetingIndex}`,
          )
        }
        upsertGreetingTranslation(targetDb, input.characterId, input.greetingIndex, translation)
        return {
          event: { ...COMMAND_EVENT_CATALOG.greetingTranslationUpdated, id: input.characterId },
          extra: {
            characterId: input.characterId,
            greetingIndex: input.greetingIndex,
            settingsHash: identity.settingsHash,
            translation,
          },
        }
      },
    })

    translationJob?.succeed()
    return {
      revision: result.revision,
      event: result.event,
      jobId: translationJob?.jobId ?? input.jobId,
      ...result.extra,
    }
  } catch (error) {
    translationJob?.fail(error)
    throw error
  } finally {
    cleanup()
  }
}
