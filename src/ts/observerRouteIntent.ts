import { routeKey, type AppRoute } from './routerRoute'

export interface ObserverRouteIntent {
  route: AppRoute
  sequence: number
}

let latestIntent: ObserverRouteIntent | null = null
let nextSequence = 0

/**
 * Retain only the latest presentation choice made before writer promotion.
 * Observer navigation is deliberately memory-only: this module never imports
 * the command transport or the durable mutation outbox.
 */
export function recordObserverRouteIntent(route: AppRoute): ObserverRouteIntent {
  if (latestIntent && routeKey(latestIntent.route) === routeKey(route)) return latestIntent

  latestIntent = {
    route: cloneRoute(route),
    sequence: ++nextSequence,
  }
  return latestIntent
}

export function peekObserverRouteIntent(): ObserverRouteIntent | null {
  return latestIntent ? { route: cloneRoute(latestIntent.route), sequence: latestIntent.sequence } : null
}

/** Consume an exact observer intent once after writer-safe reconciliation. */
export function consumeObserverRouteIntent(sequence: number): ObserverRouteIntent | null {
  if (!latestIntent || latestIntent.sequence !== sequence) return null
  const consumed = peekObserverRouteIntent()
  latestIntent = null
  return consumed
}

export function clearObserverRouteIntent(): void {
  latestIntent = null
}

export function resetObserverRouteIntentForTests(): void {
  latestIntent = null
  nextSequence = 0
}

function cloneRoute(route: AppRoute): AppRoute {
  return { ...route }
}
