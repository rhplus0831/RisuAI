import type { DatabaseSync } from 'node:sqlite'
import { bumpRevision } from '../db.js'

export interface CommandEvent {
  type: string
  revision: number
  resource: string
  id?: string
  parentId?: string
  databaseLineage?: string
  operationId?: string
  sourceMessageId?: string
  jobId?: string
  origin?: CommandEventOrigin
}

export interface CommandEventOrigin {
  writerSessionId: string
}

export type CommandEventDraft = Omit<CommandEvent, 'revision' | 'origin'>

export type CommandEventListener = (event: CommandEvent) => void

export interface CommandEventSink {
  emit(event: CommandEvent): void
  list(): readonly CommandEvent[]
  clear(): void
  subscribe(listener: CommandEventListener): () => void
}

export const COMMAND_EVENT_HISTORY_LIMIT = 1000
export const SETTINGS_WITH_HYPA_V3_PRESETS_RESOURCE = 'settingsWithHypaV3Presets'
export const PRESET_COLLECTION_WITH_POINTER_RESOURCE = 'presetCollectionWithPointer'
export const PRESET_POINTER_RESOURCE = 'presetPointer'
export const REVISION_ONLY_RESOURCE = 'revisionOnly'

export type CommandEventReplaySelection =
  | { status: 'ok'; events: readonly CommandEvent[] }
  | {
      status: 'unavailable'
      currentRevision: number
      oldestRevision?: number
      latestRevision?: number
    }

export function selectCommandEventReplay(
  history: readonly CommandEvent[],
  sinceRevision: number,
  currentRevision: number,
): CommandEventReplaySelection {
  if (sinceRevision === currentRevision) {
    return { status: 'ok', events: [] }
  }
  if (sinceRevision > currentRevision) {
    const oldestRevision = history[0]?.revision
    const latestRevision = history.at(-1)?.revision
    return {
      status: 'unavailable',
      currentRevision,
      ...(oldestRevision !== undefined ? { oldestRevision } : {}),
      ...(latestRevision !== undefined ? { latestRevision } : {}),
    }
  }

  const oldestRevision = history[0]?.revision
  const latestRevision = history.at(-1)?.revision
  const events = history.filter((event) => event.revision > sinceRevision && event.revision <= currentRevision)

  let expectedRevision = sinceRevision + 1
  for (const event of events) {
    if (event.revision !== expectedRevision) {
      return {
        status: 'unavailable',
        currentRevision,
        ...(oldestRevision !== undefined ? { oldestRevision } : {}),
        ...(latestRevision !== undefined ? { latestRevision } : {}),
      }
    }
    expectedRevision += 1
  }

  if (expectedRevision !== currentRevision + 1) {
    return {
      status: 'unavailable',
      currentRevision,
      ...(oldestRevision !== undefined ? { oldestRevision } : {}),
      ...(latestRevision !== undefined ? { latestRevision } : {}),
    }
  }

  return { status: 'ok', events }
}

export function persistCommandEvent(
  db: DatabaseSync,
  event: CommandEvent,
  historyLimit = COMMAND_EVENT_HISTORY_LIMIT,
): void {
  validateCommandEventForPersistence(event)
  // The writer-session origin persists with the event so an SSE
  // reconnect replay carries the same own-echo suppression metadata as the
  // live emit. Metadata only — the projected event payload is unchanged for
  // events that never had an origin.
  db.prepare(
    `
      INSERT INTO command_events (
        revision, type, resource, id, parent_id, origin_writer_session_id,
        database_lineage, operation_id, source_message_id, job_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    event.revision,
    event.type,
    event.resource,
    event.id ?? null,
    event.parentId ?? null,
    event.origin?.writerSessionId ?? null,
    event.databaseLineage ?? null,
    event.operationId ?? null,
    event.sourceMessageId ?? null,
    event.jobId ?? null,
  )
  pruneCommandEventHistory(db, historyLimit, event.revision)
}

export function persistRevisionedCommandEvent(
  db: DatabaseSync,
  event: CommandEventDraft,
  historyLimit = COMMAND_EVENT_HISTORY_LIMIT,
): CommandEvent {
  const revision = bumpRevision(db)
  const persisted: CommandEvent = { ...event, revision }
  persistCommandEvent(db, persisted, historyLimit)
  return persisted
}

export function listPersistedCommandEventHistory(db: DatabaseSync): readonly CommandEvent[] {
  const rows = db
    .prepare(
      `
        SELECT revision, type, resource, id, parent_id AS parentId,
               origin_writer_session_id AS originWriterSessionId,
               database_lineage AS databaseLineage,
               operation_id AS operationId,
               source_message_id AS sourceMessageId,
               job_id AS jobId
        FROM command_events
        ORDER BY revision ASC
      `,
    )
    .all() as unknown as PersistedCommandEventRow[]
  return rows.map(commandEventFromRow)
}

export function selectPersistedCommandEventReplay(
  db: DatabaseSync,
  sinceRevision: number,
  currentRevision: number,
): CommandEventReplaySelection {
  return selectCommandEventReplay(listPersistedCommandEventHistory(db), sinceRevision, currentRevision)
}

/**
 * Deletes revisions outside the keep window. Because revisions bump once per
 * persisted event, `latestRevision - historyLimit` preserves the latest
 * `historyLimit` events with one range delete.
 */
function pruneCommandEventHistory(db: DatabaseSync, historyLimit: number, latestRevision: number): void {
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 1) {
    throw new RangeError('Command event history limit must be a positive safe integer')
  }
  db.prepare('DELETE FROM command_events WHERE revision <= ?').run(latestRevision - historyLimit)
}

interface PersistedCommandEventRow {
  revision: number
  type: string
  resource: string
  id: string | null
  parentId: string | null
  originWriterSessionId: string | null
  databaseLineage: string | null
  operationId: string | null
  sourceMessageId: string | null
  jobId: string | null
}

function commandEventFromRow(row: PersistedCommandEventRow): CommandEvent {
  return {
    type: row.type,
    revision: row.revision,
    resource: row.resource,
    ...(row.id !== null ? { id: row.id } : {}),
    ...(row.parentId !== null ? { parentId: row.parentId } : {}),
    ...(row.databaseLineage !== null ? { databaseLineage: row.databaseLineage } : {}),
    ...(row.operationId !== null ? { operationId: row.operationId } : {}),
    ...(row.sourceMessageId !== null ? { sourceMessageId: row.sourceMessageId } : {}),
    ...(row.jobId !== null ? { jobId: row.jobId } : {}),
    ...(row.originWriterSessionId !== null ? { origin: { writerSessionId: row.originWriterSessionId } } : {}),
  }
}

function validateCommandEventForPersistence(event: CommandEvent): void {
  if (!Number.isSafeInteger(event.revision) || event.revision < 0) {
    throw new RangeError('Command event revision must be a non-negative safe integer')
  }
}

export const COMMAND_EVENT_CATALOG = {
  bardWikiSettingsUpdated: {
    type: 'bardwiki.settings.updated',
    resource: 'bardWikiChat',
  },
  bardWikiDocumentCreated: {
    type: 'bardwiki.document.created',
    resource: 'bardWikiDocument',
  },
  bardWikiDocumentUpdated: {
    type: 'bardwiki.document.updated',
    resource: 'bardWikiDocument',
  },
  bardWikiDocumentDeleted: {
    type: 'bardwiki.document.deleted',
    resource: 'bardWikiDocument',
  },
  settingsUpdated: {
    type: 'settings.updated',
    resource: 'settings',
  },
  inlayCatalogUpserted: {
    type: 'inlayCatalog.upserted',
    resource: 'inlayCatalog',
  },
  inlayCatalogDeleted: {
    type: 'inlayCatalog.deleted',
    resource: 'inlayCatalog',
  },
  presetCreated: {
    type: 'preset.created',
    resource: 'presetCollection',
  },
  presetUpdated: {
    type: 'preset.updated',
    resource: 'presetRow',
  },
  presetDeleted: {
    type: 'preset.deleted',
    resource: 'presetApplied',
  },
  presetCopied: {
    type: 'preset.copied',
    resource: 'presetCollection',
  },
  presetSelected: {
    type: 'preset.selected',
    resource: 'presetApplied',
  },
  presetImported: {
    type: 'preset.imported',
    resource: 'presetCollection',
  },
  presetReordered: {
    type: 'preset.reordered',
    resource: 'presetCollection',
  },
  modelPresetCreated: {
    type: 'modelPreset.created',
    resource: 'modelPreset',
  },
  modelPresetUpdated: {
    type: 'modelPreset.updated',
    resource: 'modelPreset',
  },
  modelPresetDeleted: {
    type: 'modelPreset.deleted',
    resource: 'modelPreset',
  },
  modelPresetSelected: {
    type: 'modelPreset.selected',
    resource: 'modelPreset',
  },
  modelPresetImported: {
    type: 'modelPreset.imported',
    resource: 'modelPreset',
  },
  modelPresetReordered: {
    type: 'modelPreset.reordered',
    resource: 'modelPreset',
  },
  promptPresetCreated: {
    type: 'promptPreset.created',
    resource: 'promptPreset',
  },
  promptPresetUpdated: {
    type: 'promptPreset.updated',
    resource: 'promptPreset',
  },
  promptPresetDeleted: {
    type: 'promptPreset.deleted',
    resource: 'promptPreset',
  },
  promptPresetSelected: {
    type: 'promptPreset.selected',
    resource: 'promptPreset',
  },
  promptPresetImported: {
    type: 'promptPreset.imported',
    resource: 'promptPreset',
  },
  promptPresetReordered: {
    type: 'promptPreset.reordered',
    resource: 'promptPreset',
  },
  legacyBotPresetExtracted: {
    type: 'legacyBotPreset.extracted',
    resource: 'legacyBotPreset',
  },
  onboardingCompleted: {
    type: 'onboarding.completed',
    resource: 'legacyBotPreset',
  },
  promptSettingsUpdated: {
    type: 'prompt.settings.updated',
    resource: 'prompt',
  },
  promptItemCreated: {
    type: 'prompt.item.created',
    resource: 'promptItem',
  },
  promptItemUpdated: {
    type: 'prompt.item.updated',
    resource: 'promptItem',
  },
  promptItemDeleted: {
    type: 'prompt.item.deleted',
    resource: 'promptItem',
  },
  promptItemReordered: {
    type: 'prompt.item.reordered',
    resource: 'promptItem',
  },
  promptItemsEnabled: {
    type: 'prompt.item.enabled',
    resource: 'promptItem',
  },
  modelProfileCreated: {
    type: 'modelProfile.created',
    resource: 'modelProfile',
  },
  modelProfileUpdated: {
    type: 'modelProfile.updated',
    resource: 'modelProfile',
  },
  modelProfileDuplicated: {
    type: 'modelProfile.duplicated',
    resource: 'modelProfile',
  },
  modelProfilesReordered: {
    type: 'modelProfile.reordered',
    resource: 'modelProfile',
  },
  modelProfileDeleted: {
    type: 'modelProfile.deleted',
    resource: 'modelProfile',
  },
  modelRoleProfilesUpdated: {
    type: 'modelProfile.roles.updated',
    resource: 'modelProfile',
  },
  modelProfileCreatedAndBound: {
    type: 'modelProfile.createdAndBound',
    resource: 'modelProfile',
  },
  modelRuntimeDefaultsUpdated: {
    type: 'modelProfile.runtimeDefaults.updated',
    resource: 'modelProfile',
  },
  providerCredentialCreated: {
    type: 'providerCredential.created',
    resource: 'providerCredential',
  },
  providerCredentialUpdated: {
    type: 'providerCredential.updated',
    resource: 'providerCredential',
  },
  providerCredentialDeleted: {
    type: 'providerCredential.deleted',
    resource: 'providerCredential',
  },
  agentPresetCreated: {
    type: 'agentPreset.created',
    resource: 'agentPreset',
  },
  agentPresetUpdated: {
    type: 'agentPreset.updated',
    resource: 'agentPreset',
  },
  agentPresetDuplicated: {
    type: 'agentPreset.duplicated',
    resource: 'agentPreset',
  },
  agentPresetDeleted: {
    type: 'agentPreset.deleted',
    resource: 'agentPresetDeleted',
  },
  agentPresetReordered: {
    type: 'agentPreset.reordered',
    resource: 'agentPreset',
  },
  agentPresetDefaultUpdated: {
    type: 'agentPreset.default.updated',
    resource: 'agentPreset',
  },
  agentCreated: {
    type: 'agent.created',
    resource: 'agentPreset',
  },
  agentUpdated: {
    type: 'agent.updated',
    resource: 'agentPreset',
  },
  agentDuplicated: {
    type: 'agent.duplicated',
    resource: 'agentPreset',
  },
  agentDeleted: {
    type: 'agent.deleted',
    resource: 'agentPreset',
  },
  agentReordered: {
    type: 'agent.reordered',
    resource: 'agentPreset',
  },
  agentPresetUseCreated: {
    type: 'agentPreset.use.created',
    resource: 'agentPreset',
  },
  agentPresetUseUpdated: {
    type: 'agentPreset.use.updated',
    resource: 'agentPreset',
  },
  agentPresetUseDeleted: {
    type: 'agentPreset.use.deleted',
    resource: 'agentPreset',
  },
  agentPresetUseReordered: {
    type: 'agentPreset.use.reordered',
    resource: 'agentPreset',
  },
  agentPresetStepCreated: {
    type: 'agentPreset.step.created',
    resource: 'agentPreset',
  },
  agentPresetStepUpdated: {
    type: 'agentPreset.step.updated',
    resource: 'agentPreset',
  },
  agentPresetStepDuplicated: {
    type: 'agentPreset.step.duplicated',
    resource: 'agentPreset',
  },
  agentPresetStepDeleted: {
    type: 'agentPreset.step.deleted',
    resource: 'agentPreset',
  },
  agentPresetStepReordered: {
    type: 'agentPreset.step.reordered',
    resource: 'agentPreset',
  },
  modelProfilesLegacyConverted: {
    type: 'modelProfile.legacyConverted',
    resource: 'modelProfile',
  },
  personaCreated: {
    type: 'persona.created',
    resource: 'persona',
  },
  personaUpdated: {
    type: 'persona.updated',
    resource: 'persona',
  },
  personaDeleted: {
    type: 'persona.deleted',
    resource: 'persona',
  },
  personaSelected: {
    type: 'persona.selected',
    resource: 'persona',
  },
  personaReordered: {
    type: 'persona.reordered',
    resource: 'persona',
  },
  translatorPresetCreated: {
    type: 'translatorPreset.created',
    resource: 'translatorPreset',
  },
  translatorPresetUpdated: {
    type: 'translatorPreset.updated',
    resource: 'translatorPreset',
  },
  translatorPresetDeleted: {
    type: 'translatorPreset.deleted',
    resource: 'translatorPreset',
  },
  translatorPresetSelected: {
    type: 'translatorPreset.selected',
    resource: 'translatorPreset',
  },
  loadoutCreated: {
    type: 'loadout.created',
    resource: 'loadout',
  },
  loadoutUpdated: {
    type: 'loadout.updated',
    resource: 'loadout',
  },
  loadoutDeleted: {
    type: 'loadout.deleted',
    resource: 'loadout',
  },
  loadoutFavorited: {
    type: 'loadout.favorited',
    resource: 'loadout',
  },
  loadoutTouched: {
    type: 'loadout.touched',
    resource: 'loadout',
  },
  characterCreated: {
    type: 'character.created',
    resource: 'character',
  },
  characterCreatedAndSelected: {
    type: 'character.createdAndSelected',
    resource: 'character',
  },
  characterUpdated: {
    type: 'character.updated',
    // Ordinary field edits write one character row, so a foreign refresh ships
    // just that character.
    resource: 'characterRow',
  },
  alternateGreetingsUpdated: {
    type: 'character.alternateGreetings.updated',
    resource: 'characterRow',
  },
  greetingTranslationUpdated: {
    type: 'character.greetingTranslation.updated',
    resource: 'greetingTranslation',
  },
  coldStorageCharacterRecovered: {
    type: 'coldStorage.characterRecovered',
    // Recovery replaces one character row and its chat rows. Message bodies
    // remain lazily hydrated by chat id, so foreign clients need only refresh
    // the recovered character metadata.
    resource: 'characterRow',
  },
  characterTrashUpdated: {
    type: 'character.updated',
    // Trashing/restoring also rewrites settings-level characterOrder, so the
    // event must project both the collection and its order.
    resource: 'character',
  },
  characterDeleted: {
    type: 'character.deleted',
    resource: 'character',
  },
  characterSelected: {
    type: 'character.selected',
    resource: 'characterSelection',
  },
  characterReordered: {
    type: 'character.reordered',
    // Reorder writes only the settings-level presentation structure; character
    // row order and selection are unchanged.
    resource: 'characterOrder',
  },
  chatCreated: {
    type: 'chat.created',
    resource: 'characterRow',
  },
  chatCreatedWithTranscript: {
    type: 'chat.created',
    resource: 'chatTranscript',
  },
  coldStorageChatRecovered: {
    type: 'coldStorage.chatRecovered',
    resource: 'chatTranscript',
  },
  chatUpdated: {
    type: 'chat.updated',
    // Chat metadata is stored in chat rows; the `characterRow` projection
    // reloads the parent character with its chat rows, so a foreign refresh
    // ships only that character.
    resource: 'characterRow',
  },
  chatDeleted: {
    type: 'chat.deleted',
    resource: 'characterRow',
  },
  chatsReset: {
    type: 'chats.reset',
    resource: 'characterRow',
  },
  chatForked: {
    type: 'chat.forked',
    resource: 'characterRow',
  },
  chatForkedWithTranscript: {
    type: 'chat.forked',
    resource: 'chatTranscript',
  },
  chatReordered: {
    type: 'chat.reordered',
    resource: 'characterRow',
  },
  chatFolderCreated: {
    type: 'chatFolder.created',
    resource: 'characterRow',
  },
  chatFolderUpdated: {
    type: 'chatFolder.updated',
    // Chat folders live in one character row; a foreign refresh ships just the
    // containing character (per-character `characterRow` branch).
    resource: 'characterRow',
  },
  chatFolderDeleted: {
    type: 'chatFolder.deleted',
    resource: 'characterRow',
  },
  chatFolderReordered: {
    type: 'chatFolder.reordered',
    resource: 'characterRow',
  },
  chatScriptstateUpdated: {
    type: 'chat.scriptstate.updated',
    resource: 'characterRow',
  },
  messageAppended: {
    type: 'message.appended',
    resource: 'message',
  },
  messageUpdated: {
    type: 'message.updated',
    resource: 'message',
  },
  messageDeleted: {
    type: 'message.deleted',
    resource: 'message',
  },
  messageTruncated: {
    type: 'message.truncated',
    resource: 'message',
  },
  messagesReplaced: {
    type: 'messages.replaced',
    resource: 'message',
  },
  generationAssemblyPersisted: {
    type: 'generation.assemblyPersisted',
    resource: 'chatTranscript',
  },
  generationPersisted: {
    type: 'generation.persisted',
    resource: 'generation',
  },
  generationPersistedWithChatState: {
    type: 'generation.persisted',
    resource: 'chatTranscript',
  },
  // The global-lorebook commands change only `loreBook`/`loreBookPage`, so they
  // carry the narrow `globalLorebook` resource (split out of the broad
  // `lorebook` resource that also re-shipped every character + module). The
  // character/chat/module lorebook-entry routes override `lorebookEntriesReplaced`
  // with their own per-row resource (characterLorebook / chat / moduleUpdated).
  lorebookCreated: {
    type: 'lorebook.created',
    resource: 'globalLorebook',
  },
  lorebookUpdated: {
    type: 'lorebook.updated',
    resource: 'globalLorebook',
  },
  lorebookDeleted: {
    type: 'lorebook.deleted',
    resource: 'globalLorebook',
  },
  lorebookReordered: {
    type: 'lorebook.reordered',
    resource: 'globalLorebook',
  },
  lorebookSelected: {
    type: 'lorebook.selected',
    resource: 'globalLorebook',
  },
  lorebookEntriesReplaced: {
    type: 'lorebook.entries.replaced',
    resource: 'globalLorebook',
  },
  scriptDefinitionsReplaced: {
    type: 'scriptDefinitions.replaced',
    // Character script replacement writes one character row. Module routes
    // override this with their module-scoped resource below the catalog spread.
    resource: 'characterRow',
  },
  triggerDefinitionsReplaced: {
    type: 'triggerDefinitions.replaced',
    // Character trigger replacement has the same single-row ownership.
    resource: 'characterRow',
  },
  moduleCreated: {
    type: 'module.created',
    // Creation appends only the modules collection. Keep broad `module` for
    // deletion, which removes references across several domains.
    resource: 'moduleCreated',
  },
  moduleUpdated: {
    type: 'module.updated',
    // A field edit rewrites only the `modules` table; a foreign refresh ships
    // just the `modules` collection (not enabledModules/loadouts/characters).
    resource: 'moduleUpdated',
  },
  moduleDeleted: {
    type: 'module.deleted',
    // Deletion cross-writes personas/characters/chats/loadouts via removeModuleReferences,
    // so it keeps the broad `module` resource.
    resource: 'module',
  },
  moduleEnabled: {
    type: 'module.enabled',
    // Enable/disable writes only the `enabledModules` settings scalar.
    resource: 'moduleEnabled',
  },
  moduleReordered: {
    type: 'module.reordered',
    // Reorder rewrites only the `modules` table.
    resource: 'moduleReordered',
  },
  characterModulesReordered: {
    type: 'character.modules.reordered',
    // Reordering a character's module links writes one character row, so a
    // foreign refresh ships just that character (per-character `characterRow`).
    resource: 'characterRow',
  },
  pluginCreated: {
    type: 'plugin.created',
    resource: 'pluginCollection',
  },
  pluginUpdated: {
    type: 'plugin.updated',
    resource: 'pluginCollection',
  },
  pluginDeleted: {
    type: 'plugin.deleted',
    resource: 'pluginCollection',
  },
  pluginEnabled: {
    type: 'plugin.enabled',
    resource: 'pluginCollection',
  },
  pluginProviderSelected: {
    type: 'plugin.provider.selected',
    resource: 'pluginProvider',
  },
  pluginReordered: {
    type: 'plugin.reordered',
    resource: 'pluginCollection',
  },
  pluginStorageUpdated: {
    type: 'pluginStorage.updated',
    resource: 'pluginStorage',
  },
  pluginStorageDeleted: {
    type: 'pluginStorage.deleted',
    resource: 'pluginStorage',
  },
  pluginStorageBulkUpdated: {
    type: 'pluginStorage.bulkUpdated',
    resource: 'pluginStorage',
  },
  stateRestored: {
    type: 'state.restored',
    resource: 'state',
  },
  stateInitialized: {
    type: 'state.initialized',
    resource: 'state',
  },
  stateImported: {
    type: 'state.imported',
    resource: 'state',
  },
  stateExported: {
    type: 'state.exported',
    resource: 'state',
  },
  assetCreated: {
    type: 'asset.created',
    resource: 'asset',
  },
} as const satisfies Record<string, CommandEventDraft>

export class InMemoryCommandEventSink implements CommandEventSink {
  private readonly events: CommandEvent[] = []
  private readonly listeners = new Set<CommandEventListener>()

  constructor(private readonly historyLimit = COMMAND_EVENT_HISTORY_LIMIT) {
    if (!Number.isSafeInteger(historyLimit) || historyLimit < 1) {
      throw new RangeError('Command event history limit must be a positive safe integer')
    }
  }

  emit(event: CommandEvent): void {
    this.events.push(event)
    if (this.events.length > this.historyLimit) {
      this.events.splice(0, this.events.length - this.historyLimit)
    }
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Event subscribers are best-effort projection invalidators; a
        // broken stream must not turn a committed command into a failure.
      }
    }
  }

  list(): readonly CommandEvent[] {
    return [...this.events]
  }

  clear(): void {
    this.events.length = 0
  }

  subscribe(listener: CommandEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

export function createCommandEventSink(): CommandEventSink {
  return new InMemoryCommandEventSink()
}
