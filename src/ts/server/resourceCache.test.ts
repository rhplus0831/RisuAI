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

    const first = await resolveResourceCacheArray(initial, empty!, [])
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
    const mixedResponse = [first!.hashes[1], changed, first!.hashes[0]]
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

  it('fails closed when the server references a hash whose body is not resident', async () => {
    const missingHash = 'a'.repeat(64)
    await expect(
      resolveResourceCacheArray([missingHash], { hashes: [missingHash], valuesByHash: new Map() }, [missingHash]),
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
      .put({ version: 1, hashes: [claimedHash], updatedAt: Date.now() }, 'collection:modules')
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

  it('accepts only the negotiated SHA-256 cache metadata', () => {
    expect(isResourceCacheMetadata({ version: 1, algorithm: 'sha256' })).toBe(true)
    expect(isResourceCacheMetadata({ version: 2, algorithm: 'sha256' })).toBe(false)
    expect(isResourceCacheMetadata({ version: 1, algorithm: 'md5' })).toBe(false)
  })
})
