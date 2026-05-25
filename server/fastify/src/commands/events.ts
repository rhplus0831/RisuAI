export interface CommandEvent {
  type: string
  revision: number
  resource: string
  id?: string
  parentId?: string
}

export type CommandEventDraft = Omit<CommandEvent, 'revision'>

export interface CommandEventSink {
  emit(event: CommandEvent): void
  list(): readonly CommandEvent[]
  clear(): void
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
    resource: 'character',
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
} as const satisfies Record<string, CommandEventDraft>

export class InMemoryCommandEventSink implements CommandEventSink {
  private readonly events: CommandEvent[] = []

  emit(event: CommandEvent): void {
    this.events.push(event)
  }

  list(): readonly CommandEvent[] {
    return [...this.events]
  }

  clear(): void {
    this.events.length = 0
  }
}

export function createCommandEventSink(): CommandEventSink {
  return new InMemoryCommandEventSink()
}
