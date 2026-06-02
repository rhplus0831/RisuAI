type HydrationKind = 'chat' | 'characterLorebook'

export const EXPECTED_FULL_BOOTSTRAP_RESYNC_REASONS = [
  'event-replay-unavailable',
  'no-baseline',
  'projection-error',
  'projection-full-mode',
  'revision-gap',
] as const

export type FullBootstrapResyncReason = (typeof EXPECTED_FULL_BOOTSTRAP_RESYNC_REASONS)[number]

interface HydrationDiagnostics {
  bulkRuns: number
  bulkIds: number
  requestsStarted: number
  activeRequests: number
  maxConcurrentRequests: number
  staleResponseDrops: number
}

interface ProtocolDiagnostics {
  fullBootstrapResync: Record<string, number>
  unexpectedFullBootstrapResync: Record<string, number>
  // Counts which command-event `resource` triggered a full-bootstrap fallback,
  // so the cost of sprawling-resource (`settings`, `state`, `pluginStorage`) and
  // unknown-resource fallbacks can be attributed per resource. Only populated
  // for resyncs with a known triggering resource (event-driven ones); restore
  // and replay-unavailable resyncs have no single resource and are omitted.
  fullBootstrapResyncResources: Record<string, number>
  hydration: Record<HydrationKind, HydrationDiagnostics>
}

const diagnostics: ProtocolDiagnostics = {
  fullBootstrapResync: {},
  unexpectedFullBootstrapResync: {},
  fullBootstrapResyncResources: {},
  hydration: {
    chat: emptyHydrationDiagnostics(),
    characterLorebook: emptyHydrationDiagnostics(),
  },
}

const expectedFullBootstrapResyncReasons = new Set<string>(EXPECTED_FULL_BOOTSTRAP_RESYNC_REASONS)

function emptyHydrationDiagnostics(): HydrationDiagnostics {
  return {
    bulkRuns: 0,
    bulkIds: 0,
    requestsStarted: 0,
    activeRequests: 0,
    maxConcurrentRequests: 0,
    staleResponseDrops: 0,
  }
}

export function recordFullBootstrapResync(reason: string, resource?: string): void {
  diagnostics.fullBootstrapResync[reason] = (diagnostics.fullBootstrapResync[reason] ?? 0) + 1
  const expected = isExpectedFullBootstrapResyncReason(reason)
  if (!expected) {
    diagnostics.unexpectedFullBootstrapResync[reason] =
      (diagnostics.unexpectedFullBootstrapResync[reason] ?? 0) + 1
  }
  if (resource) {
    diagnostics.fullBootstrapResyncResources[resource] =
      (diagnostics.fullBootstrapResyncResources[resource] ?? 0) + 1
  }
  debugProtocol('full-bootstrap-resync', { reason, expected, resource })
}

export function isExpectedFullBootstrapResyncReason(
  reason: string,
): reason is FullBootstrapResyncReason {
  return expectedFullBootstrapResyncReasons.has(reason)
}

export function recordBulkHydration(kind: HydrationKind, idCount: number): void {
  const target = diagnostics.hydration[kind]
  target.bulkRuns += 1
  target.bulkIds += idCount
  debugProtocol('bulk-hydration', { kind, idCount })
}

export function beginHydrationRequest(kind: HydrationKind): () => void {
  const target = diagnostics.hydration[kind]
  target.requestsStarted += 1
  target.activeRequests += 1
  target.maxConcurrentRequests = Math.max(target.maxConcurrentRequests, target.activeRequests)
  debugProtocol('hydration-start', {
    kind,
    requestsStarted: target.requestsStarted,
    activeRequests: target.activeRequests,
    maxConcurrentRequests: target.maxConcurrentRequests,
  })
  let ended = false
  return () => {
    if (ended) return
    ended = true
    target.activeRequests = Math.max(0, target.activeRequests - 1)
    debugProtocol('hydration-end', { kind, activeRequests: target.activeRequests })
  }
}

export function recordHydrationStaleDrop(kind: HydrationKind, reason: string): void {
  diagnostics.hydration[kind].staleResponseDrops += 1
  debugProtocol('hydration-stale-drop', { kind, reason })
}

export function getProtocolDiagnosticsSnapshot(): ProtocolDiagnostics {
  return structuredClone(diagnostics) as ProtocolDiagnostics
}

function debugProtocol(event: string, details: Record<string, unknown>): void {
  if (!protocolDebugEnabled()) return
  console.debug('[risu:protocol]', event, details)
}

function protocolDebugEnabled(): boolean {
  try {
    return (
      typeof localStorage !== 'undefined' &&
      (localStorage.getItem('risu:protocol-debug') === '1' ||
        localStorage.getItem('risu:protocol-debug') === 'true')
    )
  } catch {
    return false
  }
}
