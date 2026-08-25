export interface DisplaySourceCacheValue {
  displaySource: string
  dependencyFingerprint: string
}

export interface DisplaySourceCacheLoadResult {
  value: DisplaySourceCacheValue
  cacheable: boolean
}

export interface DisplaySourceCacheResult extends DisplaySourceCacheValue {
  cacheStatus: 'hit' | 'miss' | 'inflight_join'
}

export interface DisplaySourceCacheStats {
  hits: number
  misses: number
  inflightJoins: number
  evictions: number
  namespaceRetirements: number
  uncacheableBypasses: number
  oversizeBypasses: number
  staleCompletions: number
  entries: number
  bytes: number
}

interface CompletedEntry {
  value: DisplaySourceCacheValue
  bytes: number
}

interface CacheNamespace {
  id: string
  generation: number
  completed: Map<string, CompletedEntry>
  inflight: Map<string, Promise<DisplaySourceCacheLoadResult>>
  bytes: number
}

export interface DisplaySourceCacheOptions {
  maxEntries?: number
  maxBytes?: number
  maxEntryBytes?: number
}

export class DisplaySourceCache {
  readonly maxEntries: number
  readonly maxBytes: number
  readonly maxEntryBytes: number

  private namespace: CacheNamespace | null = null
  private nextGeneration = 1
  private counters: Omit<DisplaySourceCacheStats, 'entries' | 'bytes'> = {
    hits: 0,
    misses: 0,
    inflightJoins: 0,
    evictions: 0,
    namespaceRetirements: 0,
    uncacheableBypasses: 0,
    oversizeBypasses: 0,
    staleCompletions: 0,
  }

  constructor(options: DisplaySourceCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 512
    this.maxBytes = options.maxBytes ?? 16 * 1024 * 1024
    this.maxEntryBytes = options.maxEntryBytes ?? 512 * 1024
  }

  activate(namespaceId: string): number {
    if (this.namespace?.id === namespaceId) return this.namespace.generation
    if (this.namespace) this.counters.namespaceRetirements += 1
    this.namespace = {
      id: namespaceId,
      generation: this.nextGeneration++,
      completed: new Map(),
      inflight: new Map(),
      bytes: 0,
    }
    return this.namespace.generation
  }

  async resolve(
    namespaceId: string,
    key: string,
    load: () => Promise<DisplaySourceCacheLoadResult>,
  ): Promise<DisplaySourceCacheResult> {
    this.activate(namespaceId)
    const namespace = this.namespace!
    const cached = namespace.completed.get(key)
    if (cached) {
      namespace.completed.delete(key)
      namespace.completed.set(key, cached)
      this.counters.hits += 1
      return { ...cached.value, cacheStatus: 'hit' }
    }

    const joined = namespace.inflight.get(key)
    if (joined) {
      this.counters.inflightJoins += 1
      const result = await joined
      return { ...result.value, cacheStatus: 'inflight_join' }
    }

    this.counters.misses += 1
    const generation = namespace.generation
    const pending = load()
    namespace.inflight.set(key, pending)
    try {
      const result = await pending
      if (!result.cacheable) {
        this.counters.uncacheableBypasses += 1
        return { ...result.value, cacheStatus: 'miss' }
      }

      const bytes = Buffer.byteLength(result.value.displaySource, 'utf8')
      if (bytes > this.maxEntryBytes || bytes > this.maxBytes) {
        this.counters.oversizeBypasses += 1
        return { ...result.value, cacheStatus: 'miss' }
      }
      if (this.namespace !== namespace || this.namespace.generation !== generation) {
        this.counters.staleCompletions += 1
        return { ...result.value, cacheStatus: 'miss' }
      }

      namespace.completed.set(key, { value: result.value, bytes })
      namespace.bytes += bytes
      this.evict(namespace)
      return { ...result.value, cacheStatus: 'miss' }
    } finally {
      namespace.inflight.delete(key)
    }
  }

  stats(): DisplaySourceCacheStats {
    return {
      ...this.counters,
      entries: this.namespace?.completed.size ?? 0,
      bytes: this.namespace?.bytes ?? 0,
    }
  }

  clear(): void {
    if (this.namespace) this.counters.namespaceRetirements += 1
    this.namespace = null
  }

  private evict(namespace: CacheNamespace): void {
    while (namespace.completed.size > this.maxEntries || namespace.bytes > this.maxBytes) {
      const oldestKey = namespace.completed.keys().next().value
      if (oldestKey === undefined) break
      const oldest = namespace.completed.get(oldestKey)
      namespace.completed.delete(oldestKey)
      namespace.bytes -= oldest?.bytes ?? 0
      this.counters.evictions += 1
    }
  }
}
