export interface KeyedRequestCacheOptions {
  ttlMs: number
  maxEntries?: number
}

export interface KeyedRequestOptions {
  refresh?: boolean
}

interface CachedRequestResult<T> {
  expiresAt: number
  value: T
}

export interface KeyedRequestCache<T> {
  request(key: string, load: () => Promise<T>, options?: KeyedRequestOptions): Promise<T>
  clear(): void
}

/**
 * Shares active requests by their complete request context and briefly reuses
 * successful results. Rejections are intentionally never retained.
 */
export function createKeyedRequestCache<T>(options: KeyedRequestCacheOptions): KeyedRequestCache<T> {
  const ttlMs = Math.max(0, options.ttlMs)
  const maxEntries = Math.max(1, options.maxEntries ?? 12)
  const activeRequests = new Map<string, Promise<T>>()
  const cachedResults = new Map<string, CachedRequestResult<T>>()

  function pruneExpired(now: number): void {
    for (const [key, entry] of cachedResults) {
      if (entry.expiresAt <= now) cachedResults.delete(key)
    }
  }

  function retainSuccessfulResult(key: string, value: T): void {
    if (ttlMs === 0) return

    cachedResults.delete(key)
    cachedResults.set(key, {
      expiresAt: Date.now() + ttlMs,
      value,
    })

    while (cachedResults.size > maxEntries) {
      const oldestKey = cachedResults.keys().next().value
      if (oldestKey === undefined) break
      cachedResults.delete(oldestKey)
    }
  }

  return {
    request(key, load, requestOptions = {}) {
      const activeRequest = activeRequests.get(key)
      if (activeRequest) return activeRequest

      const now = Date.now()
      pruneExpired(now)
      if (!requestOptions.refresh) {
        const cachedResult = cachedResults.get(key)
        if (cachedResult) return Promise.resolve(cachedResult.value)
      }

      const request = Promise.resolve()
        .then(load)
        .then((value) => {
          retainSuccessfulResult(key, value)
          return value
        })
        .finally(() => {
          if (activeRequests.get(key) === request) activeRequests.delete(key)
        })

      activeRequests.set(key, request)
      return request
    },
    clear() {
      cachedResults.clear()
    },
  }
}
