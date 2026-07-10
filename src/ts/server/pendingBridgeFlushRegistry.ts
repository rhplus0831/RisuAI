import type { ServerCommandTransportOptions } from './commands'

type PendingBridgePatchFlusher = (options: ServerCommandTransportOptions) => void

const pendingBridgePatchFlushers = new Map<string, PendingBridgePatchFlusher>()

/** Register a lazily loaded bridge without making bootstrap import its feature module. */
export function registerPendingBridgePatchFlusher(id: string, flusher: PendingBridgePatchFlusher): void {
  pendingBridgePatchFlushers.set(id, flusher)
}

export function flushRegisteredPendingBridgePatches(options: ServerCommandTransportOptions): void {
  for (const flusher of pendingBridgePatchFlushers.values()) flusher(options)
}
