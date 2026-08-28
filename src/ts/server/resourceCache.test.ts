import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearResourceCache,
  isResourceCacheMetadata,
  persistResourceCache,
  readResourceCacheSnapshots,
  resolveResourceCacheArray,
  resolveResourceCacheValue,
  selectResourceCacheHashes,
  sha256JsonValue,
} from './resourceCache'

beforeEach(async () => {
  await clearResourceCache()
})

afterEach(async () => {
  await clearResourceCache()
})

describe('IndexedDB resource cache', () => {
  it('reconstructs reordered arrays by content hash and persists only the new manifest order', async () => {
    const initial = [
      { id: 'module-a', script: 'A'.repeat(128) },
      { id: 'module-b', script: 'B'.repeat(128) },
    ]
    const emptySnapshots = await readResourceCacheSnapshots(['collection:modules'])
    expect(emptySnapshots).not.toBeNull()
    const empty = emptySnapshots?.get('collection:modules')
    expect(empty).toEqual({ hashes: [], valuesByHash: new Map() })

    const first = await resolveResourceCacheArray(
      initial.map((value) => ({ value })),
      empty!,
      [],
    )
    expect(first?.value).toEqual(initial)
    await persistResourceCache([
      {
        key: 'collection:modules',
        hashes: first!.hashes,
        values: first!.value,
      },
    ])

    const cachedSnapshots = await readResourceCacheSnapshots(['collection:modules'])
    const cached = cachedSnapshots!.get('collection:modules')!
    const requestHashes = selectResourceCacheHashes(cached)
    expect(requestHashes).toEqual(first!.hashes)

    const changed = { id: 'module-c', script: 'C'.repeat(128) }
    const mixedResponse = [{ hash: first!.hashes[1] }, { value: changed }, { hash: first!.hashes[0] }]
    const second = await resolveResourceCacheArray(mixedResponse, cached, requestHashes)
    expect(second?.value).toEqual([initial[1], changed, initial[0]])
    expect(second?.hashes).toEqual([first!.hashes[1], await sha256JsonValue(changed), first!.hashes[0]])

    await persistResourceCache([
      {
        key: 'collection:modules',
        hashes: second!.hashes,
        values: second!.value,
      },
    ])
    const finalSnapshots = await readResourceCacheSnapshots(['collection:modules'])
    expect(finalSnapshots!.get('collection:modules')!.hashes).toEqual(second!.hashes)
  })

  it('materializes duplicate hash hits as independent JSON values', async () => {
    const row = { id: 'same-row', nested: { enabled: true } }
    const hash = await sha256JsonValue(row)
    const snapshot = {
      hashes: [hash],
      valuesByHash: new Map([[hash, row]]),
    }

    const resolved = await resolveResourceCacheArray<typeof row>([{ hash }, { hash }], snapshot, [hash])
    expect(resolved?.value).toEqual([row, row])
    expect(resolved?.value[0]).not.toBe(resolved?.value[1])
    expect(resolved?.value[0]?.nested).not.toBe(resolved?.value[1]?.nested)
  })

  it('stores and restores a whole cached value for settings-style resources', async () => {
    const settings = { language: 'en', agentPresets: [{ id: 'agent-a', prompt: 'large prompt' }] }
    const empty = (await readResourceCacheSnapshots(['settings:all']))!.get('settings:all')!
    const first = await resolveResourceCacheValue(settings, empty, [])
    await persistResourceCache([{ key: 'settings:all', hashes: first!.hashes, values: [first!.value] }])

    const cached = (await readResourceCacheSnapshots(['settings:all']))!.get('settings:all')!
    const requestHashes = selectResourceCacheHashes(cached)
    const hit = await resolveResourceCacheValue(requestHashes[0], cached, requestHashes)

    expect(hit).toEqual({ value: settings, hashes: requestHashes })
  })

  it('isolates verified cache values from caller mutations', async () => {
    const settings = { language: 'en', nested: { value: 'authoritative' } }
    const empty = (await readResourceCacheSnapshots(['settings:all']))!.get('settings:all')!
    const first = await resolveResourceCacheValue(settings, empty, [])
    expect(first).not.toBeNull()
    if (!first) throw new Error('Expected the settings value to resolve')
    await persistResourceCache([{ key: 'settings:all', hashes: first.hashes, values: [first.value] }])

    settings.nested.value = 'optimistic mutation'
    const firstSnapshot = (await readResourceCacheSnapshots(['settings:all']))!.get('settings:all')!
    const [hash] = first.hashes
    if (!hash) throw new Error('Expected a settings cache hash')
    expect(firstSnapshot.valuesByHash.get(hash)).toEqual({
      language: 'en',
      nested: { value: 'authoritative' },
    })
    const exposedValue = firstSnapshot.valuesByHash.get(hash) as typeof settings
    exposedValue.nested.value = 'snapshot mutation'
    const secondSnapshot = (await readResourceCacheSnapshots(['settings:all']))!.get('settings:all')!
    expect(secondSnapshot.valuesByHash.get(hash)).toEqual({
      language: 'en',
      nested: { value: 'authoritative' },
    })
    expect(selectResourceCacheHashes(secondSnapshot)).toEqual([hash])
  })

  it('fails closed when the server references a hash whose body is not resident', async () => {
    const missingHash = 'a'.repeat(64)
    await expect(
      resolveResourceCacheArray([{ hash: missingHash }], { hashes: [missingHash], valuesByHash: new Map() }, [
        missingHash,
      ]),
    ).resolves.toBeNull()
    await expect(
      resolveResourceCacheValue(missingHash, { hashes: [missingHash], valuesByHash: new Map() }, [missingHash]),
    ).resolves.toBeNull()
  })

  it('does not advertise an IndexedDB entry whose bytes do not match its key', async () => {
    const claimedHash = await sha256JsonValue({ id: 'expected' })
    const request = indexedDB.open('risu-resource-cache-v1', 1)
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onupgradeneeded = () => {
        request.result.createObjectStore('entries')
        request.result.createObjectStore('manifests')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction(['entries', 'manifests'], 'readwrite')
    transaction.objectStore('entries').put({ id: 'tampered' }, claimedHash)
    transaction
      .objectStore('manifests')
      .put({ version: 1, hashes: [claimedHash], sizes: [17], updatedAt: Date.now() }, 'collection:modules')
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()

    const cached = (await readResourceCacheSnapshots(['collection:modules']))!.get('collection:modules')!
    expect(cached.hashes).toEqual([claimedHash])
    expect(selectResourceCacheHashes(cached)).toEqual([])
  })

  it('caps each persisted manifest to the request inventory limit', async () => {
    const values = Array.from({ length: 8_300 }, (_, id) => ({ id }))
    const hashes = await Promise.all(values.map((value) => sha256JsonValue(value)))
    await persistResourceCache([{ key: 'collection:modules', hashes, values }])

    const cached = (await readResourceCacheSnapshots(['collection:modules']))!.get('collection:modules')!
    expect(cached.hashes).toHaveLength(8_192)
    expect(selectResourceCacheHashes(cached)).toHaveLength(8_192)
  })

  it('does not retain a value above the per-entry storage budget', async () => {
    const oversized = 'x'.repeat(32 * 1024 * 1024)
    await persistResourceCache([
      {
        key: 'settings:oversized',
        hashes: ['a'.repeat(64)],
        values: [oversized],
      },
    ])

    const cached = (await readResourceCacheSnapshots(['settings:oversized']))!.get('settings:oversized')!
    expect(cached).toEqual({ hashes: [], valuesByHash: new Map() })
  })

  it('prunes the oldest manifest population to the database-wide manifest budget', async () => {
    const values = Array.from({ length: 513 }, (_, index) => ({ index }))
    const hashes = await Promise.all(values.map((value) => sha256JsonValue(value)))
    const keys = values.map(({ index }) => `collection:budget-${index.toString().padStart(3, '0')}`)
    await persistResourceCache(
      values.map((value, index) => ({
        key: keys[index]!,
        hashes: [hashes[index]!],
        values: [value],
      })),
    )

    const snapshots = await readResourceCacheSnapshots(keys)
    expect([...snapshots!.values()].filter((snapshot) => snapshot.hashes.length > 0)).toHaveLength(512)
  })

  it('treats an unreadable manifest row as an empty disposable cache snapshot', async () => {
    const request = indexedDB.open('risu-resource-cache-v1', 1)
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onupgradeneeded = () => {
        request.result.createObjectStore('entries')
        request.result.createObjectStore('manifests')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction('manifests', 'readwrite')
    transaction
      .objectStore('manifests')
      .put({ version: 1, hashes: ['b'.repeat(64)], sizes: [], updatedAt: Date.now() }, 'collection:corrupt')
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()

    const cached = (await readResourceCacheSnapshots(['collection:corrupt']))!.get('collection:corrupt')!
    expect(cached).toEqual({ hashes: [], valuesByHash: new Map() })
  })

  it('accepts only the negotiated SHA-256 cache metadata', () => {
    expect(isResourceCacheMetadata({ version: 2, algorithm: 'sha256' })).toBe(true)
    expect(isResourceCacheMetadata({ version: 1, algorithm: 'sha256' })).toBe(false)
    expect(isResourceCacheMetadata({ version: 2, algorithm: 'md5' })).toBe(false)
  })
})
