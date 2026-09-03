import {
  DIAGNOSTICS_ENDPOINT,
  DIAGNOSTICS_LIMIT,
  diagnosticErrorFields,
  isDiagnosticsConfiguration,
  projectDiagnosticEntry,
  type DiagnosticEntry,
} from '@risuai/protocol/diagnostics'
import { PROTOCOL_ROUTE_OPERATION_CATALOG, protocolRouteOperationMatches } from '@risuai/protocol/route-operation'
import { subscribeStartupTelemetryEvents } from './startupReadiness'

const STORAGE_KEY = 'risu:diagnostics:v1'
let state: 'pending' | 'enabled' | 'disabled' = 'pending'
let entries: DiagnosticEntry[] = []
let restored = false
let stopCapture: (() => void) | undefined
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      /* Diagnostics must never break the application. */
    }
  }
}

function persist(): void {
  try {
    if (state === 'enabled') sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
    else if (state === 'disabled') sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* Mobile/private browsing may disallow storage. Memory capture still works. */
  }
}

export function configureClientDiagnostics(configuration: unknown): void {
  if (!isDiagnosticsConfiguration(configuration)) {
    state = 'disabled'
    entries = []
    restored = true
  } else {
    state = 'enabled'
    if (!restored) {
      restored = true
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY)
        const saved: unknown = raw && raw.length <= 600_000 ? JSON.parse(raw) : []
        if (Array.isArray(saved)) {
          const previous = saved
            .slice(-DIAGNOSTICS_LIMIT)
            .map(projectDiagnosticEntry)
            .filter((entry): entry is DiagnosticEntry => entry !== null && entry.source === 'browser')
          entries = [...previous, ...entries].slice(-DIAGNOSTICS_LIMIT)
        }
      } catch {
        /* Ignore unavailable or malformed session snapshots. */
      }
    }
  }
  persist()
  notify()
}

export function recordClientDiagnostic(input: Record<string, unknown>): void {
  if (state === 'disabled') return
  const entry = projectDiagnosticEntry({ ...input, source: 'browser', timestamp: Date.now() })
  if (!entry) return
  entries.push(entry)
  if (entries.length > DIAGNOSTICS_LIMIT) entries.shift()
  persist()
  notify()
}

export function getClientDiagnosticsSnapshot(): { enabled: boolean; entries: DiagnosticEntry[] } {
  return {
    enabled: state === 'enabled',
    entries: state === 'enabled' ? entries.map((entry) => projectDiagnosticEntry(entry)!) : [],
  }
}

export function subscribeClientDiagnostics(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function clearClientDiagnostics(): void {
  entries = []
  persist()
  notify()
}

function requestMetadata(input: RequestInfo | URL, init?: RequestInit): { routeId: string; method: string } | null {
  try {
    const isRequest = typeof Request !== 'undefined' && input instanceof Request
    const url = new URL(isRequest ? input.url : String(input), window.location.href)
    if (url.origin === window.location.origin && url.pathname === DIAGNOSTICS_ENDPOINT) return null
    const method = (init?.method ?? (isRequest ? input.method : 'GET')).toUpperCase()
    const routeId =
      url.origin !== window.location.origin
        ? 'external'
        : (PROTOCOL_ROUTE_OPERATION_CATALOG.find((route) => protocolRouteOperationMatches(route, method, url.pathname))
            ?.id ?? (url.pathname.startsWith('/api/') ? 'unknown' : 'resource'))
    return { routeId, method }
  } catch {
    return { routeId: 'unknown', method: 'GET' }
  }
}

/** Install before bootstrap so errors remain reportable without opening DevTools. */
export function initializeClientDiagnostics(): () => void {
  if (stopCapture) return stopCapture
  const removers: (() => void)[] = []
  const onError = (event: ErrorEvent) =>
    recordClientDiagnostic({
      event: 'runtime-error',
      level: 'error',
      ...diagnosticErrorFields(event.error),
    })
  const onRejection = (event: PromiseRejectionEvent) =>
    recordClientDiagnostic({
      event: 'unhandled-rejection',
      level: 'error',
      ...diagnosticErrorFields(event.reason),
    })
  const onOnline = () => recordClientDiagnostic({ event: 'online', level: 'info' })
  const onOffline = () => recordClientDiagnostic({ event: 'offline', level: 'warn' })
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  removers.push(() => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
  })
  for (const method of ['warn', 'error'] as const) {
    const original = console[method]
    const wrapped = (...args: unknown[]) => {
      if (state !== 'disabled') {
        try {
          recordClientDiagnostic({
            event: 'console',
            level: method === 'warn' ? 'warn' : 'error',
            ...diagnosticErrorFields(args.find((arg) => arg instanceof Error) ?? new Error()),
          })
        } catch {
          /* Always preserve the original console call. */
        }
      }
      original.apply(console, args)
    }
    console[method] = wrapped
    removers.push(() => {
      if (console[method] === wrapped) console[method] = original
    })
  }
  const originalFetch = window.fetch
  const wrappedFetch: typeof fetch = async (input, init) => {
    if (state === 'disabled') return originalFetch.call(window, input, init)
    const metadata = requestMetadata(input, init)
    const start = performance.now()
    try {
      const response = await originalFetch.call(window, input, init)
      if (metadata)
        recordClientDiagnostic({
          ...metadata,
          event: 'http',
          level: response.status >= 500 ? 'error' : response.status >= 400 ? 'warn' : 'info',
          statusCode: response.status,
          requestUid: response.headers.get('X-Request-UID'),
          durationMs: Math.round(Math.max(0, performance.now() - start)),
        })
      return response
    } catch (error) {
      if (metadata)
        recordClientDiagnostic({
          ...metadata,
          event: 'network-failure',
          level: 'error',
          durationMs: Math.round(Math.max(0, performance.now() - start)),
          ...diagnosticErrorFields(error),
        })
      throw error
    }
  }
  window.fetch = wrappedFetch
  removers.push(() => {
    if (window.fetch === wrappedFetch) window.fetch = originalFetch
  })
  removers.push(
    subscribeStartupTelemetryEvents((event) =>
      recordClientDiagnostic({
        event: 'startup',
        level: event.kind.endsWith('failed') || event.kind === 'diagnostic-failure' ? 'error' : 'info',
        code: 'failureCode' in event ? event.failureCode : event.kind,
        phase:
          'milestone' in event ? event.milestone : 'failureMilestone' in event ? event.failureMilestone : undefined,
        attemptCount: event.attemptCount,
        durationMs:
          'entryDurationMs' in event
            ? event.entryDurationMs
            : 'attemptDurationMs' in event
              ? event.attemptDurationMs
              : undefined,
      }),
    ),
  )
  stopCapture = () => {
    removers.forEach((remove) => remove())
    stopCapture = undefined
  }
  return stopCapture
}
