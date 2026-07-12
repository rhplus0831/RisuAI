type HydrationKind = 'chat' | 'characterLorebook'

export const EXPECTED_FULL_RESOURCE_REFRESH_REASONS = [
  'event-replay-unavailable',
  'malformed-command-event',
  'backup-restore',
  'bundle-restore',
  'realm-import',
] as const

export type FullResourceRefreshReason = (typeof EXPECTED_FULL_RESOURCE_REFRESH_REASONS)[number]

interface HydrationDiagnostics {
  bulkRuns: number
  bulkIds: number
  requestsStarted: number
  activeRequests: number
  maxConcurrentRequests: number
  staleResponseDrops: number
}

interface AssetByteReadDiagnostics {
  // Total JS-driven asset byte reads (`readServerAsset`), i.e. byte fetches
  // outside one server-side generation request. Browser-native `<img src>`
  // fetches go straight to `GET /api/v1/assets/:id` and are counted by the
  // server-side `asset_byte_read` metric instead.
  requests: number
  // Distinct asset ids read this session.
  uniqueIds: number
  // Reads that hit an id already read this session — the repeated-id fanout
  // signal a bulk-byte route or browser cache would remove.
  repeatedReads: number
  // Worst single-id read count this session.
  maxReadsForSingleId: number
}

interface ProtocolDiagnostics {
  fullResourceRefresh: Record<string, number>
  unexpectedFullResourceRefresh: Record<string, number>
  // Counts which command-event `resource` triggered a complete refresh,
  // so the cost of sprawling-resource (`settings`, `state`) and
  // unknown-resource fallbacks can be attributed per resource. Only populated
  // for resyncs with a known triggering resource (event-driven ones); restore
  // and replay-unavailable resyncs have no single resource and are omitted.
  fullResourceRefreshResources: Record<string, number>
  hydration: Record<HydrationKind, HydrationDiagnostics>
  assetByteReads: AssetByteReadDiagnostics
}

const diagnostics: ProtocolDiagnostics = {
  fullResourceRefresh: {},
  unexpectedFullResourceRefresh: {},
  fullResourceRefreshResources: {},
  hydration: {
    chat: emptyHydrationDiagnostics(),
    characterLorebook: emptyHydrationDiagnostics(),
  },
  assetByteReads: {
    requests: 0,
    uniqueIds: 0,
    repeatedReads: 0,
    maxReadsForSingleId: 0,
  },
}

// Per-id read counts back the asset-byte-read aggregates. Kept outside the
// snapshot so the full id list is never exposed or cloned; only the aggregate
// counters above are reported.
const assetByteReadCounts = new Map<string, number>()

const expectedFullResourceRefreshReasons = new Set<string>(EXPECTED_FULL_RESOURCE_REFRESH_REASONS)

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

export function recordFullResourceRefresh(reason: string, resource?: string): void {
  diagnostics.fullResourceRefresh[reason] = (diagnostics.fullResourceRefresh[reason] ?? 0) + 1
  const expected = isExpectedFullResourceRefreshReason(reason)
  if (!expected) {
    diagnostics.unexpectedFullResourceRefresh[reason] = (diagnostics.unexpectedFullResourceRefresh[reason] ?? 0) + 1
  }
  if (resource) {
    diagnostics.fullResourceRefreshResources[resource] = (diagnostics.fullResourceRefreshResources[resource] ?? 0) + 1
  }
  debugProtocol('full-resource-refresh', { reason, expected, resource })
}

export function isExpectedFullResourceRefreshReason(reason: string): reason is FullResourceRefreshReason {
  return expectedFullResourceRefreshReasons.has(reason)
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

/**
 * Records one JS-driven asset byte read so the measurement can attribute
 * request fanout and repeated-id reads to client workflows that fetch many
 * asset bytes outside one generation request.
 */
export function recordAssetByteRead(assetId: string): void {
  const reads = diagnostics.assetByteReads
  reads.requests += 1
  const previous = assetByteReadCounts.get(assetId) ?? 0
  const next = previous + 1
  assetByteReadCounts.set(assetId, next)
  if (previous === 0) {
    reads.uniqueIds += 1
  } else {
    reads.repeatedReads += 1
  }
  if (next > reads.maxReadsForSingleId) {
    reads.maxReadsForSingleId = next
  }
  debugProtocol('asset-byte-read', { assetId, reads: next })
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
      (localStorage.getItem('risu:protocol-debug') === '1' || localStorage.getItem('risu:protocol-debug') === 'true')
    )
  } catch {
    return false
  }
}
