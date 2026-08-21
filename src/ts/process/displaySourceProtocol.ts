import { normalizeReportedClientContext, type ReportedClientContext } from './request/clientContext'

export const DISPLAY_SOURCE_PROTOCOL_VERSION = 1 as const
export const DISPLAY_SOURCE_TRANSFORM_VERSION = 'editdisplay-v1' as const

export const DISPLAY_SOURCE_LIMITS = {
  maxTargets: 64,
  maxSourceBytes: 512 * 1024,
  maxRequestSourceBytes: 4 * 1024 * 1024,
  maxRequestKeyLength: 128,
  maxPageSessionIdLength: 128,
} as const

export type DisplaySourceLayer = 'original' | 'translation' | 'bilingual' | 'greeting' | 'preview'

export interface DisplayRequestContext extends ReportedClientContext {
  pageSessionId: string
}

export interface DisplaySourceTarget {
  requestKey: string
  characterId: string
  messageId?: string
  index: number
  role: string | null
  firstMessage: boolean
  layer: DisplaySourceLayer
  source: string
  sourceHash: string
  projectionEpoch: number
  /** Growing provider prefix; never eligible for the shared server LRU. */
  streaming?: boolean
  name?: string
}

export interface DisplaySourceRequest {
  protocolVersion: typeof DISPLAY_SOURCE_PROTOCOL_VERSION
  baseRevision: number
  context: DisplayRequestContext
  targets: DisplaySourceTarget[]
}

export type DisplaySourceResponseEntry =
  | {
      requestKey: string
      status: 'ok'
      sourceHash: string
      dependencyFingerprint: string
      displaySource: string
    }
  | {
      requestKey: string
      status: 'client_fallback' | 'stale' | 'error'
      sourceHash: string
      reason: string
    }

export interface DisplaySourceResponse {
  protocolVersion: typeof DISPLAY_SOURCE_PROTOCOL_VERSION
  revision: number
  contextFingerprint: string
  entries: DisplaySourceResponseEntry[]
}

export interface DisplaySourceNamespaceInput {
  databaseLineage: string
  activeWriterEpoch: number
  context: DisplayRequestContext
  protocolVersion?: number
}

export function normalizeDisplayRequestContext(value: unknown): DisplayRequestContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const pageSessionId = typeof raw.pageSessionId === 'string' ? raw.pageSessionId.trim() : ''
  if (pageSessionId.length === 0 || pageSessionId.length > DISPLAY_SOURCE_LIMITS.maxPageSessionIdLength) {
    return undefined
  }
  const reported = normalizeReportedClientContext(raw)
  return { pageSessionId, ...reported }
}

export function normalizeDisplayDependencyValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeDisplayDependencyValue(item))
  if (!value || typeof value !== 'object') return value

  const normalized: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const next = (value as Record<string, unknown>)[key]
    if (next === undefined || typeof next === 'function') continue
    normalized[key] = normalizeDisplayDependencyValue(next)
  }
  return normalized
}

export function stableDisplayDependencyJson(value: unknown): string {
  return JSON.stringify(normalizeDisplayDependencyValue(value)) ?? 'null'
}

export function displaySourceNamespaceValue(input: DisplaySourceNamespaceInput): Record<string, unknown> {
  return {
    activeWriterEpoch: input.activeWriterEpoch,
    browserLanguage: input.context.browserLanguage,
    databaseLineage: input.databaseLineage,
    pageSessionId: input.context.pageSessionId,
    protocolVersion: input.protocolVersion ?? DISPLAY_SOURCE_PROTOCOL_VERSION,
    screenHeight: input.context.screenHeight,
    screenWidth: input.context.screenWidth,
  }
}

export function displaySourceNamespaceJson(input: DisplaySourceNamespaceInput): string {
  return stableDisplayDependencyJson(displaySourceNamespaceValue(input))
}
