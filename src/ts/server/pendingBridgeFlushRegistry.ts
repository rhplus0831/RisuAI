import type { ServerCommandTransportOptions } from './commands'

type PendingBridgePatchFlusher = (options: ServerCommandTransportOptions) => void
type PendingBridgeOwnershipResetter = () => void

const pendingBridgePatchFlushers = new Map<string, PendingBridgePatchFlusher>()
const pendingBridgeOwnershipResetters = new Map<string, PendingBridgeOwnershipResetter>()

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

/** Register in-memory state that must not survive a database ownership change. */
export function registerPendingBridgeOwnershipResetter(
  id: string,
  resetter: PendingBridgeOwnershipResetter,
): () => void {
  pendingBridgeOwnershipResetters.set(id, resetter)
  return () => {
    if (pendingBridgeOwnershipResetters.get(id) === resetter) pendingBridgeOwnershipResetters.delete(id)
  }
}

export function resetRegisteredPendingBridgeOwnershipState(): void {
  for (const resetter of pendingBridgeOwnershipResetters.values()) resetter()
}
