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
