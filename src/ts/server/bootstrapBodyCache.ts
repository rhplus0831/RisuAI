import type { Database } from '../storage/database.svelte'

export const BODY_CACHE_MANIFEST_HEADER = 'x-risu-body-cache-manifest'

const STORAGE_KEY = 'risu:bootstrap-body-cache:v1'
const STORAGE_VERSION = 1
const MAX_HEADER_LENGTH = 12_000

export interface ServerBootstrapBodyCacheEntry {
  id: string
  revision: number
  body?: unknown
}

export interface ServerBootstrapBodyCachePayload {
  epoch: number
  modules: ServerBootstrapBodyCacheEntry[]
  plugins: ServerBootstrapBodyCacheEntry[]
}

interface StoredBodyCacheEntry {
  revision: number
  body: unknown
}

interface StoredBodyCache {
  version: 1
  epoch: number
  modules: Record<string, StoredBodyCacheEntry>
  plugins: Record<string, StoredBodyCacheEntry>
}

export interface BootstrapBodyCacheRequestState {
  cache: StoredBodyCache | null
  headerValue?: string
}

export function prepareBootstrapBodyCacheRequest(): BootstrapBodyCacheRequestState {
  const cache = readStoredBodyCache()
  if (!cache) return { cache: null }

  const manifest = {
    epoch: cache.epoch,
    modules: manifestForCollection(cache.modules),
    plugins: manifestForCollection(cache.plugins),
  }
  const headerValue = encodeURIComponent(JSON.stringify(manifest))
  return headerValue.length <= MAX_HEADER_LENGTH ? { cache, headerValue } : { cache }
}

export function parseBootstrapBodyCachePayload(value: unknown): ServerBootstrapBodyCachePayload | undefined | null {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!Number.isInteger(record.epoch) || (record.epoch as number) < 1) return null
  const modules = parseEntries(record.modules)
  const plugins = parseEntries(record.plugins)
  if (!modules || !plugins) return null
  return {
    epoch: record.epoch as number,
    modules,
    plugins,
  }
}

export function mergeBootstrapBodyCache(
  database: Database | null,
  bodyCache: ServerBootstrapBodyCachePayload | undefined,
  requestState: BootstrapBodyCacheRequestState,
): Database | null {
  if (!database || !bodyCache) return database

  const cache: StoredBodyCache =
    requestState.cache?.epoch === bodyCache.epoch
      ? requestState.cache
      : { version: STORAGE_VERSION, epoch: bodyCache.epoch, modules: {}, plugins: {} }

  const modules = mergeCollection(database.modules, bodyCache.modules, cache.modules, 'id')
  const plugins = mergeCollection(database.plugins, bodyCache.plugins, cache.plugins, 'name')
  database.modules = modules.values as Database['modules']
  database.plugins = plugins.values as Database['plugins']

  writeStoredBodyCache({
    version: STORAGE_VERSION,
    epoch: bodyCache.epoch,
    modules: modules.cache,
    plugins: plugins.cache,
  })

  return database
}

function manifestForCollection(collection: Record<string, StoredBodyCacheEntry>): Record<string, number> {
  const manifest: Record<string, number> = {}
  for (const [id, entry] of Object.entries(collection)) {
    if (isUsableStoredEntry(entry)) manifest[id] = entry.revision
  }
  return manifest
}

function parseEntries(value: unknown): ServerBootstrapBodyCacheEntry[] | null {
  if (!Array.isArray(value)) return null
  const entries: ServerBootstrapBodyCacheEntry[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || record.id.trim() === '') return null
    if (!Number.isInteger(record.revision) || (record.revision as number) < 0) return null
    entries.push({
      id: record.id,
      revision: record.revision as number,
      ...(Object.prototype.hasOwnProperty.call(record, 'body') ? { body: record.body } : {}),
    })
  }
  return entries
}

function mergeCollection(
  stubs: unknown,
  entries: ServerBootstrapBodyCacheEntry[],
  cache: Record<string, StoredBodyCacheEntry>,
  idKey: string,
): { values: unknown[]; cache: Record<string, StoredBodyCacheEntry> } {
  if (!Array.isArray(stubs)) return { values: [], cache: {} }
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]))
  const nextValues: unknown[] = []
  const nextCache: Record<string, StoredBodyCacheEntry> = {}

  for (const stub of stubs) {
    if (!isRecord(stub) || typeof stub[idKey] !== 'string') {
      nextValues.push(stub)
      continue
    }

    const id = stub[idKey]
    const entry = entriesById.get(id)
    const body =
      entry?.body !== undefined
        ? entry.body
        : entry && cache[id]?.revision === entry.revision
          ? cache[id].body
          : undefined

    if (entry && isRecord(body)) {
      const merged = { ...cloneJsonValue(body), ...stub }
      nextValues.push(merged)
      nextCache[id] = { revision: entry.revision, body: merged }
      continue
    }

    nextValues.push(stub)
  }

  return { values: nextValues, cache: nextCache }
}

function readStoredBodyCache(): StoredBodyCache | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!isStoredBodyCache(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

function writeStoredBodyCache(cache: StoredBodyCache): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // Quota or privacy-mode failures should not block startup.
  }
}

function isStoredBodyCache(value: unknown): value is StoredBodyCache {
  if (!isRecord(value)) return false
  if (value.version !== STORAGE_VERSION) return false
  if (!Number.isInteger(value.epoch) || (value.epoch as number) < 1) return false
  return isStoredCollection(value.modules) && isStoredCollection(value.plugins)
}

function isStoredCollection(value: unknown): value is Record<string, StoredBodyCacheEntry> {
  if (!isRecord(value)) return false
  return Object.values(value).every(isUsableStoredEntry)
}

function isUsableStoredEntry(value: unknown): value is StoredBodyCacheEntry {
  return (
    isRecord(value) && Number.isInteger(value.revision) && (value.revision as number) >= 0 && value.body !== undefined
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
