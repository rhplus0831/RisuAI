import type { CommandEvent, ServerCommandLocalEffect } from './commands'

export type ServerCommandLocalEffectAppliedListener = (
  event: CommandEvent,
  localEffect: ServerCommandLocalEffect,
) => void

const listeners = new Set<ServerCommandLocalEffectAppliedListener>()

/**
 * Observe only local effects that passed every event/projection fence and were
 * actually applied. This is intentionally distinct from an HTTP 2xx receipt:
 * callers can safely settle optimistic dirty markers without weakening the
 * authoritative fallback path for malformed or stale acknowledgements.
 *
 * This registry intentionally lives outside commands.ts. Domain modules may
 * subscribe while the command transport is still being initialized through an
 * import cycle, and tests may replace that transport with a narrow mock.
 */
export function subscribeServerCommandLocalEffectApplied(
  listener: ServerCommandLocalEffectAppliedListener,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifyServerCommandLocalEffectApplied(
  event: CommandEvent,
  localEffect: ServerCommandLocalEffect,
): void {
  for (const listener of listeners) {
    try {
      listener(event, localEffect)
    } catch (error) {
      console.warn('Server command local-effect listener failed', error)
    }
  }
}
