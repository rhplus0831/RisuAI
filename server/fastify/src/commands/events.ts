import type { DatabaseSync } from 'node:sqlite'
import { bumpRevision } from '../db.js'

export interface CommandEvent {
  type: string
  revision: number
  resource: string
  id?: string
  parentId?: string
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
  const events = history.filter(
    (event) => event.revision > sinceRevision && event.revision <= currentRevision,
  )

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
  db.prepare(
    `
      INSERT INTO command_events (revision, type, resource, id, parent_id)
      VALUES (?, ?, ?, ?, ?)
    `,
  ).run(event.revision, event.type, event.resource, event.id ?? null, event.parentId ?? null)
  pruneCommandEventHistory(db, historyLimit)
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
        SELECT revision, type, resource, id, parent_id AS parentId
        FROM command_events
        ORDER BY revision ASC
      `,
    )
    .all() as PersistedCommandEventRow[]
  return rows.map(commandEventFromRow)
}

export function selectPersistedCommandEventReplay(
  db: DatabaseSync,
  sinceRevision: number,
  currentRevision: number,
): CommandEventReplaySelection {
  return selectCommandEventReplay(
    listPersistedCommandEventHistory(db),
    sinceRevision,
    currentRevision,
  )
}

function pruneCommandEventHistory(db: DatabaseSync, historyLimit: number): void {
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 1) {
    throw new RangeError('Command event history limit must be a positive safe integer')
  }
  const threshold = db
    .prepare(
      `
        SELECT revision
        FROM command_events
        ORDER BY revision DESC
        LIMIT 1 OFFSET ?
      `,
    )
    .get(historyLimit - 1) as { revision: number } | undefined
  if (!threshold) return
  db.prepare('DELETE FROM command_events WHERE revision < ?').run(threshold.revision)
}

interface PersistedCommandEventRow {
  revision: number
  type: string
  resource: string
  id: string | null
  parentId: string | null
}

function commandEventFromRow(row: PersistedCommandEventRow): CommandEvent {
  return {
    type: row.type,
    revision: row.revision,
    resource: row.resource,
    ...(row.id !== null ? { id: row.id } : {}),
    ...(row.parentId !== null ? { parentId: row.parentId } : {}),
  }
}

function validateCommandEventForPersistence(event: CommandEvent): void {
  if (!Number.isSafeInteger(event.revision) || event.revision < 0) {
    throw new RangeError('Command event revision must be a non-negative safe integer')
  }
}

export const COMMAND_EVENT_CATALOG = {
  settingsUpdated: {
    type: 'settings.updated',
    resource: 'settings',
  },
  presetCreated: {
    type: 'preset.created',
    resource: 'preset',
  },
  presetUpdated: {
    type: 'preset.updated',
    resource: 'preset',
  },
  presetDeleted: {
    type: 'preset.deleted',
    resource: 'preset',
  },
  presetCopied: {
    type: 'preset.copied',
    resource: 'preset',
  },
  presetSelected: {
    type: 'preset.selected',
    resource: 'preset',
  },
  presetImported: {
    type: 'preset.imported',
    resource: 'preset',
  },
  presetReordered: {
    type: 'preset.reordered',
    resource: 'preset',
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
    resource: 'character',
  },
  chatCreated: {
    type: 'chat.created',
    resource: 'chat',
  },
  chatUpdated: {
    type: 'chat.updated',
    resource: 'chat',
  },
  chatDeleted: {
    type: 'chat.deleted',
    resource: 'chat',
  },
  chatForked: {
    type: 'chat.forked',
    resource: 'chat',
  },
  chatReordered: {
    type: 'chat.reordered',
    resource: 'chat',
  },
  chatFolderCreated: {
    type: 'chatFolder.created',
    resource: 'chatFolder',
  },
  chatFolderUpdated: {
    type: 'chatFolder.updated',
    resource: 'chatFolder',
  },
  chatFolderDeleted: {
    type: 'chatFolder.deleted',
    resource: 'chatFolder',
  },
  chatFolderReordered: {
    type: 'chatFolder.reordered',
    resource: 'chatFolder',
  },
  chatScriptstateUpdated: {
    type: 'chat.scriptstate.updated',
    resource: 'chat',
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
  generationPersisted: {
    type: 'generation.persisted',
    resource: 'generation',
  },
  lorebookCreated: {
    type: 'lorebook.created',
    resource: 'lorebook',
  },
  lorebookUpdated: {
    type: 'lorebook.updated',
    resource: 'lorebook',
  },
  lorebookDeleted: {
    type: 'lorebook.deleted',
    resource: 'lorebook',
  },
  lorebookReordered: {
    type: 'lorebook.reordered',
    resource: 'lorebook',
  },
  lorebookSelected: {
    type: 'lorebook.selected',
    resource: 'lorebook',
  },
  lorebookEntriesReplaced: {
    type: 'lorebook.entries.replaced',
    resource: 'lorebook',
  },
  scriptDefinitionsReplaced: {
    type: 'scriptDefinitions.replaced',
    resource: 'scriptDefinition',
  },
  triggerDefinitionsReplaced: {
    type: 'triggerDefinitions.replaced',
    resource: 'triggerDefinition',
  },
  moduleCreated: {
    type: 'module.created',
    resource: 'module',
  },
  moduleUpdated: {
    type: 'module.updated',
    resource: 'module',
  },
  moduleDeleted: {
    type: 'module.deleted',
    resource: 'module',
  },
  moduleEnabled: {
    type: 'module.enabled',
    resource: 'module',
  },
  moduleReordered: {
    type: 'module.reordered',
    resource: 'module',
  },
  characterModulesReordered: {
    type: 'character.modules.reordered',
    resource: 'character',
  },
  pluginCreated: {
    type: 'plugin.created',
    resource: 'plugin',
  },
  pluginUpdated: {
    type: 'plugin.updated',
    resource: 'plugin',
  },
  pluginDeleted: {
    type: 'plugin.deleted',
    resource: 'plugin',
  },
  pluginEnabled: {
    type: 'plugin.enabled',
    resource: 'plugin',
  },
  pluginProviderSelected: {
    type: 'plugin.provider.selected',
    resource: 'plugin',
  },
  pluginReordered: {
    type: 'plugin.reordered',
    resource: 'plugin',
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
