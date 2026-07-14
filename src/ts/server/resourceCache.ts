export const RESOURCE_CACHE_VERSION = 2 as const
export const RESOURCE_CACHE_ALGORITHM = 'sha256' as const
export const RESOURCE_CACHE_MAX_REQUEST_HASHES = 8_192

const RESOURCE_CACHE_DATABASE = 'risu-resource-cache-v1'
const RESOURCE_CACHE_DATABASE_VERSION = 1
const RESOURCE_CACHE_ENTRY_STORE = 'entries'
const RESOURCE_CACHE_MANIFEST_STORE = 'manifests'
const RESOURCE_CACHE_MAX_MANIFESTS = 512
const RESOURCE_CACHE_MAX_ENTRIES = 32_768
const RESOURCE_CACHE_MAX_STORED_BYTES = 64 * 1024 * 1024
const RESOURCE_CACHE_MAX_VALUE_BYTES = 32 * 1024 * 1024
const RESOURCE_CACHE_HASH_PATTERN = /^[a-f0-9]{64}$/
const HASH_BATCH_SIZE = 32
const RESOURCE_CACHE_MANIFEST_VERSION = 1 as const

interface StoredResourceCacheManifest {
  version: 1
  hashes: string[]
  sizes: number[]
  updatedAt: number
}

interface PreparedResourceCacheUpdate extends ResourceCacheUpdate {
  hashes: string[]
  values: unknown[]
  sizes: number[]
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

export interface ResourceCacheDescriptor {
  name: string
  key: string
}

export interface PreparedResourceCacheRequest {
  hashes: Record<string, string[]>
  snapshots: Map<string, ResourceCacheSnapshot>
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
        valuesByHash.set(hash, cloneResourceCacheValue(verifiedResourceCacheValues.get(hash)))
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
          verifiedResourceCacheValues.set(entry[0], cloneResourceCacheValue(entry[1]))
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

/** Prepare one bounded POST inventory shared by root and hydration reads. */
export async function prepareResourceCacheRequest(
  descriptors: readonly ResourceCacheDescriptor[],
): Promise<PreparedResourceCacheRequest | null> {
  const cached = await readResourceCacheSnapshots(descriptors.map(({ key }) => key))
  if (!cached) return null

  const hashes: Record<string, string[]> = {}
  const snapshots = new Map<string, ResourceCacheSnapshot>()
  let remainingHashes = RESOURCE_CACHE_MAX_REQUEST_HASHES
  for (const descriptor of descriptors) {
    const snapshot = cached.get(descriptor.key) ?? { hashes: [], valuesByHash: new Map() }
    const selected = selectResourceCacheHashes(snapshot, remainingHashes)
    hashes[descriptor.name] = selected
    snapshots.set(descriptor.name, snapshot)
    remainingHashes -= selected.length
  }
  return { hashes, snapshots }
}

export function resourceCacheRequestBody(hashes: Record<string, string[]>): Record<string, unknown> {
  return {
    cache: {
      version: RESOURCE_CACHE_VERSION,
      hashes,
    },
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
    const entry = readResourceCacheArrayEntry(mixedValues[index])
    if (!entry) return null
    if (entry.kind === 'hit') {
      if (!sent.has(entry.hash) || !snapshot.valuesByHash.has(entry.hash)) return null
      values[index] = cloneResourceCacheValue(snapshot.valuesByHash.get(entry.hash)) as T
      hashes[index] = entry.hash
      continue
    }
    changed.push({ index, value: entry.value })
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
    return { value: cloneResourceCacheValue(snapshot.valuesByHash.get(mixedValue)) as T, hashes: [mixedValue] }
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
  const preparedUpdates = prepareResourceCacheUpdates(updates)
  const database = await openResourceCacheDatabase()
  if (!database) return

  const transaction = database.transaction([RESOURCE_CACHE_ENTRY_STORE, RESOURCE_CACHE_MANIFEST_STORE], 'readwrite')
  const done = transactionComplete(transaction)
  const entries = transaction.objectStore(RESOURCE_CACHE_ENTRY_STORE)
  const manifests = transaction.objectStore(RESOURCE_CACHE_MANIFEST_STORE)
  const now = Date.now()

  const writtenHashes = new Set<string>()
  for (const update of preparedUpdates) {
    for (let index = 0; index < update.hashes.length; index += 1) {
      const hash = update.hashes[index]
      if (!hash || writtenHashes.has(hash)) continue
      entries.put(update.values[index], hash)
      writtenHashes.add(hash)
    }
    const manifest: StoredResourceCacheManifest = {
      version: RESOURCE_CACHE_MANIFEST_VERSION,
      hashes: [...update.hashes],
      sizes: [...update.sizes],
      updatedAt: now,
    }
    manifests.put(manifest, update.key)
  }
  await done
  for (const update of preparedUpdates) {
    for (let index = 0; index < update.hashes.length; index += 1) {
      verifiedResourceCacheValues.set(update.hashes[index] as string, cloneResourceCacheValue(update.values[index]))
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
  const kept: Array<{ key: IDBValidKey; manifest: StoredResourceCacheManifest }> = []
  const referencedSizes = new Map<string, number>()
  let referencedBytes = 0
  for (const candidate of candidates) {
    if (kept.length >= RESOURCE_CACHE_MAX_MANIFESTS) break
    const hashes: string[] = []
    const sizes: number[] = []
    const seen = new Set<string>()
    for (let index = 0; index < candidate.manifest.hashes.length; index += 1) {
      const hash = candidate.manifest.hashes[index]
      const size = candidate.manifest.sizes[index]
      if (!hash || size === undefined || seen.has(hash)) continue
      const retainedSize = referencedSizes.get(hash)
      if (retainedSize === undefined) {
        if (referencedSizes.size >= RESOURCE_CACHE_MAX_ENTRIES) continue
        if (referencedBytes + size > RESOURCE_CACHE_MAX_STORED_BYTES) continue
        referencedSizes.set(hash, size)
        referencedBytes += size
      }
      hashes.push(hash)
      sizes.push(retainedSize ?? size)
      seen.add(hash)
    }
    if (hashes.length === 0) continue
    kept.push({
      key: candidate.key,
      manifest: { ...candidate.manifest, hashes, sizes },
    })
  }
  const keptKeys = new Set(kept.map(({ key }) => String(key)))
  const referencedHashes = new Set(referencedSizes.keys())
  const manifestDeletes = manifestKeys.filter((key) => !keptKeys.has(String(key)))
  const entryDeletes = entryKeys.filter((key) => !referencedHashes.has(String(key)))
  const manifestPuts = kept.filter(({ key, manifest }) => {
    const candidate = candidates.find((entry) => String(entry.key) === String(key))
    return (
      !candidate ||
      !sameArray(candidate.manifest.hashes, manifest.hashes) ||
      !sameArray(candidate.manifest.sizes, manifest.sizes)
    )
  })
  for (const hash of verifiedResourceCacheValues.keys()) {
    if (!referencedHashes.has(hash)) verifiedResourceCacheValues.delete(hash)
  }
  if (manifestDeletes.length === 0 && entryDeletes.length === 0 && manifestPuts.length === 0) return

  const deleteTransaction = database.transaction(
    [RESOURCE_CACHE_ENTRY_STORE, RESOURCE_CACHE_MANIFEST_STORE],
    'readwrite',
  )
  const deleteDone = transactionComplete(deleteTransaction)
  const deleteManifests = deleteTransaction.objectStore(RESOURCE_CACHE_MANIFEST_STORE)
  const deleteEntries = deleteTransaction.objectStore(RESOURCE_CACHE_ENTRY_STORE)
  for (const key of manifestDeletes) deleteManifests.delete(key)
  for (const { key, manifest } of manifestPuts) deleteManifests.put(manifest, key)
  for (const key of entryDeletes) deleteEntries.delete(key)
  await deleteDone
}

function readStoredManifest(value: unknown): StoredResourceCacheManifest | null {
  if (
    !isRecord(value) ||
    value.version !== RESOURCE_CACHE_MANIFEST_VERSION ||
    !Array.isArray(value.hashes) ||
    !value.hashes.every(isSha256Hex) ||
    value.hashes.length > RESOURCE_CACHE_MAX_REQUEST_HASHES ||
    !Array.isArray(value.sizes) ||
    value.sizes.length !== value.hashes.length ||
    !value.sizes.every((size) => Number.isInteger(size) && size >= 0) ||
    !Number.isFinite(value.updatedAt)
  ) {
    return null
  }
  return {
    version: RESOURCE_CACHE_MANIFEST_VERSION,
    hashes: value.hashes,
    sizes: value.sizes as number[],
    updatedAt: value.updatedAt as number,
  }
}

function readStoredManifestHashes(value: unknown): string[] {
  return readStoredManifest(value)?.hashes ?? []
}

function isValidResourceCacheUpdate(update: ResourceCacheUpdate): boolean {
  return nonEmptyString(update.key) && update.hashes.length === update.values.length && update.hashes.every(isSha256Hex)
}

function prepareResourceCacheUpdates(updates: readonly ResourceCacheUpdate[]): PreparedResourceCacheUpdate[] {
  const retainedHashes = new Set<string>()
  let retainedBytes = 0
  return updates.map((update) => {
    const hashes: string[] = []
    const values: unknown[] = []
    const sizes: number[] = []
    const manifestHashes = new Set<string>()
    for (let index = 0; index < update.hashes.length; index += 1) {
      if (hashes.length >= RESOURCE_CACHE_MAX_REQUEST_HASHES) break
      const hash = update.hashes[index]
      if (!hash || manifestHashes.has(hash)) continue
      const serialized = serializeResourceCacheValue(update.values[index])
      const size = new TextEncoder().encode(serialized).byteLength
      if (size > RESOURCE_CACHE_MAX_VALUE_BYTES) continue
      if (!retainedHashes.has(hash)) {
        if (retainedHashes.size >= RESOURCE_CACHE_MAX_ENTRIES) continue
        if (retainedBytes + size > RESOURCE_CACHE_MAX_STORED_BYTES) continue
        retainedHashes.add(hash)
        retainedBytes += size
      }
      hashes.push(hash)
      values.push(JSON.parse(serialized) as unknown)
      sizes.push(size)
      manifestHashes.add(hash)
    }
    return { key: update.key, hashes, values, sizes }
  })
}

function readResourceCacheArrayEntry(
  value: unknown,
): { kind: 'hit'; hash: string } | { kind: 'value'; value: unknown } | null {
  if (!isRecord(value)) return null
  const keys = Object.keys(value)
  if (keys.length !== 1) return null
  if (keys[0] === 'hash' && isSha256Hex(value.hash)) return { kind: 'hit', hash: value.hash }
  if (keys[0] === 'value' && Object.prototype.hasOwnProperty.call(value, 'value')) {
    return { kind: 'value', value: value.value }
  }
  return null
}

function cloneResourceCacheValue<T>(value: T): T {
  return JSON.parse(serializeResourceCacheValue(value)) as T
}

function serializeResourceCacheValue(value: unknown): string {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('Resource cache values must be JSON-serializable')
  return serialized
}

function sameArray<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
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
