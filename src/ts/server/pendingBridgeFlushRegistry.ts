import type { ServerCommandTransportOptions } from './commands'

type PendingBridgePatchFlusher = (options: ServerCommandTransportOptions) => void

const pendingBridgePatchFlushers = new Map<string, PendingBridgePatchFlusher>()

/** Register a lazily loaded bridge without making bootstrap import its feature module. */
export function registerPendingBridgePatchFlusher(id: string, flusher: PendingBridgePatchFlusher): () => void {
  pendingBridgePatchFlushers.set(id, flusher)
  return () => {
    if (pendingBridgePatchFlushers.get(id) === flusher) pendingBridgePatchFlushers.delete(id)
  }
}

export function flushRegisteredPendingBridgePatches(options: ServerCommandTransportOptions): void {
  for (const flusher of pendingBridgePatchFlushers.values()) flusher(options)
}

/** Flush one owner before a structural action changes the projection it watches. */
export function flushRegisteredPendingBridgePatch(id: string, options: ServerCommandTransportOptions): boolean {
  const flusher = pendingBridgePatchFlushers.get(id)
  if (!flusher) return false
  flusher(options)
  return true
}
