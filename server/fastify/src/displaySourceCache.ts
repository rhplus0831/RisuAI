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
  namespaces: number
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
  maxNamespaces?: number
  maxEntries?: number
  maxBytes?: number
  maxEntryBytes?: number
}

export class DisplaySourceCache {
  readonly maxNamespaces: number
  readonly maxEntries: number
  readonly maxBytes: number
  readonly maxEntryBytes: number

  private readonly namespaces = new Map<string, CacheNamespace>()
  private nextGeneration = 1
  private totalEntries = 0
  private totalBytes = 0
  private counters: Omit<DisplaySourceCacheStats, 'namespaces' | 'entries' | 'bytes'> = {
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
    this.maxNamespaces = Math.max(1, Math.floor(options.maxNamespaces ?? 4))
    this.maxEntries = options.maxEntries ?? 512
    this.maxBytes = options.maxBytes ?? 16 * 1024 * 1024
    this.maxEntryBytes = options.maxEntryBytes ?? 512 * 1024
  }

  activate(namespaceId: string): number {
    const existing = this.namespaces.get(namespaceId)
    if (existing) {
      this.touchNamespace(existing)
      return existing.generation
    }
    const namespace: CacheNamespace = {
      id: namespaceId,
      generation: this.nextGeneration++,
      completed: new Map(),
      inflight: new Map(),
      bytes: 0,
    }
    this.namespaces.set(namespaceId, namespace)
    this.enforceNamespaceLimit()
    return namespace.generation
  }

  async resolve(
    namespaceId: string,
    key: string,
    load: () => Promise<DisplaySourceCacheLoadResult>,
  ): Promise<DisplaySourceCacheResult> {
    this.activate(namespaceId)
    const namespace = this.namespaces.get(namespaceId)!
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
      if (this.namespaces.get(namespaceId) !== namespace || namespace.generation !== generation) {
        this.counters.staleCompletions += 1
        return { ...result.value, cacheStatus: 'miss' }
      }

      namespace.completed.set(key, { value: result.value, bytes })
      namespace.bytes += bytes
      this.totalEntries += 1
      this.totalBytes += bytes
      this.enforceEntryLimits()
      return { ...result.value, cacheStatus: 'miss' }
    } finally {
      namespace.inflight.delete(key)
    }
  }

  stats(): DisplaySourceCacheStats {
    return {
      ...this.counters,
      namespaces: this.namespaces.size,
      entries: this.totalEntries,
      bytes: this.totalBytes,
    }
  }

  clear(): void {
    this.counters.namespaceRetirements += this.namespaces.size
    this.namespaces.clear()
    this.totalEntries = 0
    this.totalBytes = 0
  }

  private touchNamespace(namespace: CacheNamespace): void {
    this.namespaces.delete(namespace.id)
    this.namespaces.set(namespace.id, namespace)
  }

  private enforceNamespaceLimit(): void {
    while (this.namespaces.size > this.maxNamespaces) {
      const oldestId = this.namespaces.keys().next().value
      if (oldestId === undefined) break
      const retired = this.namespaces.get(oldestId)
      this.namespaces.delete(oldestId)
      this.totalEntries -= retired?.completed.size ?? 0
      this.totalBytes -= retired?.bytes ?? 0
      this.counters.namespaceRetirements += 1
    }
  }

  private enforceEntryLimits(): void {
    while (this.totalEntries > this.maxEntries || this.totalBytes > this.maxBytes) {
      let evicted = false
      for (const namespace of this.namespaces.values()) {
        const oldestKey = namespace.completed.keys().next().value
        if (oldestKey === undefined) continue
        const oldest = namespace.completed.get(oldestKey)
        namespace.completed.delete(oldestKey)
        namespace.bytes -= oldest?.bytes ?? 0
        this.totalEntries -= 1
        this.totalBytes -= oldest?.bytes ?? 0
        this.counters.evictions += 1
        evicted = true
        break
      }
      if (!evicted) break
    }
  }
}
