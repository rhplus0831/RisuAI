export const RESOURCE_CACHE_VERSION = 1 as const
export const RESOURCE_CACHE_ALGORITHM = 'sha256' as const
export const RESOURCE_CACHE_MAX_REQUEST_HASHES = 8_192

const RESOURCE_CACHE_DATABASE = 'risu-resource-cache-v1'
const RESOURCE_CACHE_DATABASE_VERSION = 1
const RESOURCE_CACHE_ENTRY_STORE = 'entries'
const RESOURCE_CACHE_MANIFEST_STORE = 'manifests'
const RESOURCE_CACHE_MAX_MANIFESTS = 512
const RESOURCE_CACHE_HASH_PATTERN = /^[a-f0-9]{64}$/
const HASH_BATCH_SIZE = 32

interface StoredResourceCacheManifest {
  version: 1
  hashes: string[]
  updatedAt: number
}

export interface ResourceCacheSnapshot {
  hashes: string[]
  valuesByHash: Map<string, unknown>
}

export interface ResolvedResourceCacheValue<T> {
  value: T
  hashes: string[]
}

export interface ResourceCacheUpdate {
  key: string
  hashes: readonly string[]
  values: readonly unknown[]
}

let resourceCacheDatabasePromise: Promise<IDBDatabase | null> | null = null
let resourceCacheWriteChain: Promise<void> = Promise.resolve()
const verifiedResourceCacheValues = new Map<string, unknown>()

/**
 * Load the current content-addressed entries for several logical resources.
 * `null` means IndexedDB or Web Crypto is unavailable; an empty snapshot means
 * the cache is usable but has not seen that resource yet.
 */
export async function readResourceCacheSnapshots(
  keys: readonly string[],
): Promise<Map<string, ResourceCacheSnapshot> | null> {
  let database: IDBDatabase | null
  try {
    database = await openResourceCacheDatabase()
  } catch {
    resourceCacheDatabasePromise = null
    return null
  }
  if (!database) return null

  const uniqueKeys = [...new Set(keys.filter(nonEmptyString))]
  try {
    const manifestTransaction = database.transaction(RESOURCE_CACHE_MANIFEST_STORE, 'readonly')
    const manifestDone = transactionComplete(manifestTransaction)
    const manifestStore = manifestTransaction.objectStore(RESOURCE_CACHE_MANIFEST_STORE)
    const storedManifests = await Promise.all(
      uniqueKeys.map(async (key) => [key, await requestResult(manifestStore.get(key))] as const),
    )
    await manifestDone

    const manifests = new Map<string, string[]>()
    const allHashes = new Set<string>()
    for (const [key, stored] of storedManifests) {
      const hashes = readStoredManifestHashes(stored)
      manifests.set(key, hashes)
      for (const hash of hashes) allHashes.add(hash)
    }

    const valuesByHash = new Map<string, unknown>()
    const hashesToRead: string[] = []
    for (const hash of allHashes) {
      if (verifiedResourceCacheValues.has(hash)) {
        valuesByHash.set(hash, verifiedResourceCacheValues.get(hash))
      } else {
        hashesToRead.push(hash)
      }
    }
    if (hashesToRead.length > 0) {
      const entryTransaction = database.transaction(RESOURCE_CACHE_ENTRY_STORE, 'readonly')
      const entryDone = transactionComplete(entryTransaction)
      const entryStore = entryTransaction.objectStore(RESOURCE_CACHE_ENTRY_STORE)
      const storedEntries = await Promise.all(
        hashesToRead.map(async (hash) => [hash, await requestResult(entryStore.get(hash))] as const),
      )
      await entryDone

      for (let offset = 0; offset < storedEntries.length; offset += HASH_BATCH_SIZE) {
        const batch = storedEntries.slice(offset, offset + HASH_BATCH_SIZE)
        const verified = await Promise.all(
          batch.map(async ([hash, value]) => {
            if (value === undefined) return null
            try {
              return (await sha256JsonValue(value)) === hash ? ([hash, value] as const) : null
            } catch {
              return null
            }
          }),
        )
        for (const entry of verified) {
          if (!entry) continue
          valuesByHash.set(entry[0], entry[1])
          verifiedResourceCacheValues.set(entry[0], entry[1])
        }
      }
    }

    return new Map(
      uniqueKeys.map((key) => {
        const hashes = manifests.get(key) ?? []
        const availableValues = new Map<string, unknown>()
        for (const hash of hashes) {
          if (valuesByHash.has(hash)) availableValues.set(hash, valuesByHash.get(hash))
        }
        return [key, { hashes, valuesByHash: availableValues }] as const
      }),
    )
  } catch {
    discardResourceCacheDatabase(database)
    return null
  }
}

/** Return a bounded, de-duplicated inventory containing only resident values. */
export function selectResourceCacheHashes(
  snapshot: ResourceCacheSnapshot,
  limit = RESOURCE_CACHE_MAX_REQUEST_HASHES,
): string[] {
  if (!Number.isInteger(limit) || limit <= 0) return []
  const selected: string[] = []
  const seen = new Set<string>()
  for (const hash of snapshot.hashes) {
    if (selected.length >= limit) break
    if (seen.has(hash) || !snapshot.valuesByHash.has(hash)) continue
    selected.push(hash)
    seen.add(hash)
  }
  return selected
}

/** Reconstruct an array whose unchanged entries were replaced by hashes. */
export async function resolveResourceCacheArray<T = unknown>(
  mixedValues: unknown,
  snapshot: ResourceCacheSnapshot,
  sentHashes: readonly string[],
): Promise<ResolvedResourceCacheValue<T[]> | null> {
  if (!Array.isArray(mixedValues)) return null

  const sent = new Set(sentHashes.filter(isSha256Hex))
  const values = new Array<T>(mixedValues.length)
  const hashes = new Array<string>(mixedValues.length)
  const changed: Array<{ index: number; value: unknown }> = []

  for (let index = 0; index < mixedValues.length; index += 1) {
    const candidate = mixedValues[index]
    if (typeof candidate === 'string' && sent.has(candidate)) {
      if (!snapshot.valuesByHash.has(candidate)) return null
      values[index] = snapshot.valuesByHash.get(candidate) as T
      hashes[index] = candidate
    } else {
      changed.push({ index, value: candidate })
    }
  }

  for (let offset = 0; offset < changed.length; offset += HASH_BATCH_SIZE) {
    const batch = changed.slice(offset, offset + HASH_BATCH_SIZE)
    const batchHashes = await Promise.all(batch.map(({ value }) => sha256JsonValue(value)))
    for (let index = 0; index < batch.length; index += 1) {
      const item = batch[index]
      if (!item) continue
      values[item.index] = item.value as T
      hashes[item.index] = batchHashes[index] as string
    }
  }

  return { value: values, hashes }
}

/** Reconstruct one object/value whose unchanged representation is a hash. */
export async function resolveResourceCacheValue<T = unknown>(
  mixedValue: unknown,
  snapshot: ResourceCacheSnapshot,
  sentHashes: readonly string[],
): Promise<ResolvedResourceCacheValue<T> | null> {
  if (typeof mixedValue === 'string' && sentHashes.includes(mixedValue)) {
    if (!isSha256Hex(mixedValue) || !snapshot.valuesByHash.has(mixedValue)) return null
    return { value: snapshot.valuesByHash.get(mixedValue) as T, hashes: [mixedValue] }
  }
  return {
    value: mixedValue as T,
    hashes: [await sha256JsonValue(mixedValue)],
  }
}

/**
 * Persist only validated, fully reconstructed authoritative responses. Cache
 * failures are deliberately swallowed because IndexedDB is never the source of
 * truth and must not block a resource read.
 */
export function persistResourceCache(updates: readonly ResourceCacheUpdate[]): Promise<void> {
  const validUpdates = updates.filter(isValidResourceCacheUpdate)
  if (validUpdates.length === 0) return Promise.resolve()

  const operation = resourceCacheWriteChain
    .catch(() => undefined)
    .then(() => persistResourceCacheInternal(validUpdates))
    .catch(() => undefined)
  resourceCacheWriteChain = operation
  return operation
}

export function isResourceCacheMetadata(value: unknown): boolean {
  return isRecord(value) && value.version === RESOURCE_CACHE_VERSION && value.algorithm === RESOURCE_CACHE_ALGORITHM
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && RESOURCE_CACHE_HASH_PATTERN.test(value)
}

export async function sha256JsonValue(value: unknown): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('Web Crypto SHA-256 is unavailable')
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('Resource cache values must be JSON-serializable')
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(serialized))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Clear the disposable cache, including a cached failed/open connection. */
export async function clearResourceCache(): Promise<void> {
  const database = await resourceCacheDatabasePromise?.catch(() => null)
  database?.close()
  resourceCacheDatabasePromise = null
  resourceCacheWriteChain = Promise.resolve()
  verifiedResourceCacheValues.clear()
  if (typeof globalThis.indexedDB === 'undefined') return
  await new Promise<void>((resolve) => {
    const request = globalThis.indexedDB.deleteDatabase(RESOURCE_CACHE_DATABASE)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

async function openResourceCacheDatabase(): Promise<IDBDatabase | null> {
  if (typeof globalThis.indexedDB === 'undefined' || !globalThis.crypto?.subtle) return null
  if (resourceCacheDatabasePromise) return resourceCacheDatabasePromise

  resourceCacheDatabasePromise = new Promise<IDBDatabase | null>((resolve) => {
    const request = globalThis.indexedDB.open(RESOURCE_CACHE_DATABASE, RESOURCE_CACHE_DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(RESOURCE_CACHE_ENTRY_STORE)) {
        database.createObjectStore(RESOURCE_CACHE_ENTRY_STORE)
      }
      if (!database.objectStoreNames.contains(RESOURCE_CACHE_MANIFEST_STORE)) {
        database.createObjectStore(RESOURCE_CACHE_MANIFEST_STORE)
      }
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => {
        database.close()
        if (resourceCacheDatabasePromise) resourceCacheDatabasePromise = null
      }
      resolve(database)
    }
    request.onerror = () => resolve(null)
  })
  return resourceCacheDatabasePromise
}

async function persistResourceCacheInternal(updates: readonly ResourceCacheUpdate[]): Promise<void> {
  const database = await openResourceCacheDatabase()
  if (!database) return

  const transaction = database.transaction([RESOURCE_CACHE_ENTRY_STORE, RESOURCE_CACHE_MANIFEST_STORE], 'readwrite')
  const done = transactionComplete(transaction)
  const entries = transaction.objectStore(RESOURCE_CACHE_ENTRY_STORE)
  const manifests = transaction.objectStore(RESOURCE_CACHE_MANIFEST_STORE)
  const now = Date.now()

  for (const update of updates) {
    for (let index = 0; index < update.hashes.length; index += 1) {
      entries.put(update.values[index], update.hashes[index])
    }
    const manifest: StoredResourceCacheManifest = {
      version: RESOURCE_CACHE_VERSION,
      hashes: [...update.hashes],
      updatedAt: now,
    }
    manifests.put(manifest, update.key)
  }
  await done
  for (const update of updates) {
    for (let index = 0; index < update.hashes.length; index += 1) {
      verifiedResourceCacheValues.set(update.hashes[index] as string, update.values[index])
    }
  }
  await pruneResourceCache(database)
}

async function pruneResourceCache(database: IDBDatabase): Promise<void> {
  const readTransaction = database.transaction([RESOURCE_CACHE_ENTRY_STORE, RESOURCE_CACHE_MANIFEST_STORE], 'readonly')
  const readDone = transactionComplete(readTransaction)
  const manifests = readTransaction.objectStore(RESOURCE_CACHE_MANIFEST_STORE)
  const entries = readTransaction.objectStore(RESOURCE_CACHE_ENTRY_STORE)
  const [manifestKeys, storedManifests, entryKeys] = await Promise.all([
    requestResult(manifests.getAllKeys()),
    requestResult(manifests.getAll()),
    requestResult(entries.getAllKeys()),
  ])
  await readDone

  const candidates = manifestKeys
    .map((key, index) => ({ key, manifest: readStoredManifest(storedManifests[index]) }))
    .filter(
      (candidate): candidate is { key: IDBValidKey; manifest: StoredResourceCacheManifest } =>
        candidate.manifest !== null,
    )
    .sort((left, right) => right.manifest.updatedAt - left.manifest.updatedAt)
  const kept = candidates.slice(0, RESOURCE_CACHE_MAX_MANIFESTS)
  const keptKeys = new Set(kept.map(({ key }) => String(key)))
  const referencedHashes = new Set(kept.flatMap(({ manifest }) => manifest.hashes))
  const manifestDeletes = manifestKeys.filter((key) => !keptKeys.has(String(key)))
  const entryDeletes = entryKeys.filter((key) => !referencedHashes.has(String(key)))
  for (const hash of verifiedResourceCacheValues.keys()) {
    if (!referencedHashes.has(hash)) verifiedResourceCacheValues.delete(hash)
  }
  if (manifestDeletes.length === 0 && entryDeletes.length === 0) return

  const deleteTransaction = database.transaction(
    [RESOURCE_CACHE_ENTRY_STORE, RESOURCE_CACHE_MANIFEST_STORE],
    'readwrite',
  )
  const deleteDone = transactionComplete(deleteTransaction)
  const deleteManifests = deleteTransaction.objectStore(RESOURCE_CACHE_MANIFEST_STORE)
  const deleteEntries = deleteTransaction.objectStore(RESOURCE_CACHE_ENTRY_STORE)
  for (const key of manifestDeletes) deleteManifests.delete(key)
  for (const key of entryDeletes) deleteEntries.delete(key)
  await deleteDone
}

function readStoredManifest(value: unknown): StoredResourceCacheManifest | null {
  if (
    !isRecord(value) ||
    value.version !== RESOURCE_CACHE_VERSION ||
    !Array.isArray(value.hashes) ||
    !value.hashes.every(isSha256Hex) ||
    !Number.isFinite(value.updatedAt)
  ) {
    return null
  }
  return {
    version: RESOURCE_CACHE_VERSION,
    hashes: value.hashes,
    updatedAt: value.updatedAt as number,
  }
}

function readStoredManifestHashes(value: unknown): string[] {
  return readStoredManifest(value)?.hashes ?? []
}

function isValidResourceCacheUpdate(update: ResourceCacheUpdate): boolean {
  return nonEmptyString(update.key) && update.hashes.length === update.values.length && update.hashes.every(isSha256Hex)
}

function discardResourceCacheDatabase(database: IDBDatabase): void {
  database.close()
  resourceCacheDatabasePromise = null
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}
