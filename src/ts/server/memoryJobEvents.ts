import type { ServerMemoryEvent } from './events'

export type ServerMemoryJobEventListener = (event: ServerMemoryEvent) => void

const listeners = new Set<ServerMemoryJobEventListener>()

export function publishServerMemoryJobEvent(event: ServerMemoryEvent): void {
  for (const listener of listeners) {
    listener(event)
  }
}

export function subscribeServerMemoryJobEvents(listener: ServerMemoryJobEventListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
