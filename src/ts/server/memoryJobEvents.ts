import type { ServerMemoryEvent } from './events'

export type ServerMemoryJobEventListener = (event: ServerMemoryEvent) => void

const listeners = new Set<ServerMemoryJobEventListener>()

export function publishServerMemoryJobEvent(event: ServerMemoryEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      // Progress listeners are independent projections. One broken consumer
      // must not prevent later subscribers from observing a committed event.
    }
  }
}

export function subscribeServerMemoryJobEvents(listener: ServerMemoryJobEventListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
