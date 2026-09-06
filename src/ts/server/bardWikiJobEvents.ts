import type { BardWikiJobSummary } from '@risuai/protocol'

export interface ServerBardWikiJobEvent {
  type: 'bardwiki.job'
  streamId: string
  version: number
  chatId: string
  job: Omit<BardWikiJobSummary, 'chatId' | 'nextRunAt' | 'createdAt'>
}

export interface ServerBardWikiJobSnapshot {
  streamId: string
  version: number
  jobs: BardWikiJobSummary[]
}

export type ServerBardWikiJobEventListener = (event: ServerBardWikiJobEvent) => void
export type ServerBardWikiJobSnapshotListener = (snapshot: ServerBardWikiJobSnapshot) => void

const listeners = new Set<ServerBardWikiJobEventListener>()
const snapshotListeners = new Set<ServerBardWikiJobSnapshotListener>()

export function publishServerBardWikiJobEvent(event: ServerBardWikiJobEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      // Status listeners are independent; one broken workspace cannot block another.
    }
  }
}

export function publishServerBardWikiJobSnapshot(snapshot: ServerBardWikiJobSnapshot): void {
  for (const listener of snapshotListeners) {
    try {
      listener(snapshot)
    } catch {
      // Reconnect listeners are independent for the same reason as live listeners.
    }
  }
}

export function subscribeServerBardWikiJobEvents(
  listener: ServerBardWikiJobEventListener,
  snapshotListener?: ServerBardWikiJobSnapshotListener,
): () => void {
  listeners.add(listener)
  if (snapshotListener) snapshotListeners.add(snapshotListener)
  return () => {
    listeners.delete(listener)
    if (snapshotListener) snapshotListeners.delete(snapshotListener)
  }
}
