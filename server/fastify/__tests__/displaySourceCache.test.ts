import { describe, expect, it } from 'vitest'
import { DisplaySourceCache } from '../src/displaySourceCache.js'

describe('DisplaySourceCache', () => {
  it('shares in-flight work and reuses successful side-effect-free results', async () => {
    const cache = new DisplaySourceCache()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let loads = 0
    const load = async () => {
      loads += 1
      await gate
      return {
        value: { displaySource: 'rendered', dependencyFingerprint: 'dependency-a' },
        cacheable: true,
      }
    }

    const first = cache.resolve('namespace-a', 'key-a', load)
    const joined = cache.resolve('namespace-a', 'key-a', load)
    release()

    await expect(first).resolves.toMatchObject({ displaySource: 'rendered', cacheStatus: 'miss' })
    await expect(joined).resolves.toMatchObject({ displaySource: 'rendered', cacheStatus: 'inflight_join' })
    await expect(cache.resolve('namespace-a', 'key-a', load)).resolves.toMatchObject({ cacheStatus: 'hit' })
    expect(loads).toBe(1)
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1, inflightJoins: 1, entries: 1 })
  })

  it('retires old namespaces and cannot populate one from a stale completion', async () => {
    const cache = new DisplaySourceCache({ maxNamespaces: 1 })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const stale = cache.resolve('namespace-a', 'key-a', async () => {
      await gate
      return {
        value: { displaySource: 'stale', dependencyFingerprint: 'dependency-a' },
        cacheable: true,
      }
    })
    cache.activate('namespace-b')
    release()
    await stale

    expect(cache.stats()).toMatchObject({ namespaceRetirements: 1, staleCompletions: 1, entries: 0 })
  })

  it('reuses recently active namespaces without crossing their identities', async () => {
    const cache = new DisplaySourceCache({ maxNamespaces: 2 })
    let loads = 0
    const load = (displaySource: string) => async () => {
      loads += 1
      return {
        value: { displaySource, dependencyFingerprint: displaySource },
        cacheable: true,
      }
    }

    await expect(cache.resolve('namespace-a', 'shared-key', load('a'))).resolves.toMatchObject({
      displaySource: 'a',
      cacheStatus: 'miss',
    })
    await expect(cache.resolve('namespace-b', 'shared-key', load('b'))).resolves.toMatchObject({
      displaySource: 'b',
      cacheStatus: 'miss',
    })
    await expect(cache.resolve('namespace-a', 'shared-key', load('unexpected'))).resolves.toMatchObject({
      displaySource: 'a',
      cacheStatus: 'hit',
    })

    expect(loads).toBe(2)
    expect(cache.stats()).toMatchObject({ namespaces: 2, entries: 2, namespaceRetirements: 0 })
  })

  it('retires the least-recent namespace and enforces aggregate entry bounds', async () => {
    const cache = new DisplaySourceCache({ maxNamespaces: 2, maxEntries: 2, maxBytes: 100 })
    const load = (displaySource: string) => async () => ({
      value: { displaySource, dependencyFingerprint: displaySource },
      cacheable: true,
    })

    await cache.resolve('namespace-a', 'a', load('a'))
    await cache.resolve('namespace-b', 'b', load('b'))
    cache.activate('namespace-a')
    await cache.resolve('namespace-c', 'c', load('c'))

    await expect(cache.resolve('namespace-a', 'a', load('unexpected'))).resolves.toMatchObject({ cacheStatus: 'hit' })
    expect(cache.stats()).toMatchObject({ namespaces: 2, entries: 2, bytes: 2, namespaceRetirements: 1 })

    await cache.resolve('namespace-a', 'a-2', load('aa'))
    expect(cache.stats()).toMatchObject({ namespaces: 2, entries: 2, bytes: 3, evictions: 1 })
  })

  it('enforces byte/entry bounds and bypasses durable or oversized results', async () => {
    const cache = new DisplaySourceCache({ maxEntries: 1, maxBytes: 8, maxEntryBytes: 6 })
    const load =
      (displaySource: string, cacheable = true) =>
      async () => ({
        value: { displaySource, dependencyFingerprint: displaySource },
        cacheable,
      })

    await cache.resolve('namespace', 'one', load('one'))
    await cache.resolve('namespace', 'two', load('two'))
    await cache.resolve('namespace', 'durable', load('state', false))
    await cache.resolve('namespace', 'oversize', load('1234567'))

    expect(cache.stats()).toMatchObject({ entries: 1, evictions: 1, uncacheableBypasses: 1, oversizeBypasses: 1 })
  })
})
