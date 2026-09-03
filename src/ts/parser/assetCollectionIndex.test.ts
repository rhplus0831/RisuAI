import { describe, expect, it, vi } from 'vitest'
import { AssetCollectionIndexCache, type AssetTuples } from './assetCollectionIndex'

const assets = (count: number): string[][] => Array.from({ length: count }, (_, i) => [`name-${i}`, `path-${i}`, 'png'])

describe('shared asset collection indexes', () => {
  it('shares in-flight work and yields to an ordinary task before a large build finishes', async () => {
    let taskRan = false
    const visit = vi.fn()
    const cache = new AssetCollectionIndexCache(visit, () => 0)
    const source = assets(10_000)
    setTimeout(() => {
      taskRan = true
    }, 0)
    const first = cache.get(source, 0, 'module')
    expect(cache.get(source, 0, 'module')).toBe(first)
    const index = await first
    expect(taskRan).toBe(true)
    expect(index.get('name-9999')?.get('png')).toEqual(['path-9999'])
    expect(visit).toHaveBeenCalledTimes(10_000)
    expect(await cache.get(source, 0, 'module')).toBe(index)
    expect(visit).toHaveBeenCalledTimes(10_000)
  })

  it('discards a partial index when a module changes during a yield, including rollback', async () => {
    let revision = 0
    let resume!: () => void
    const paused = new Promise<void>((resolve) => {
      resume = resolve
    })
    const yieldWork = vi
      .fn()
      .mockResolvedValue(undefined)
      .mockImplementationOnce(() => paused)
    const cache = new AssetCollectionIndexCache(
      () => {},
      () => revision,
      yieldWork,
    )
    const source = assets(5_000)
    const pending = cache.get(source, revision, 'module')
    expect(yieldWork).toHaveBeenCalledOnce()
    source[0][1] = 'edited-first'
    source[4999][1] = 'edited-last'
    revision++
    resume()
    const index = await pending
    expect(index.get('name-0')?.get('png')).toEqual(['edited-first'])
    expect(index.get('name-4999')?.get('png')).toEqual(['edited-last'])
    source[0][1] = 'path-0'
    revision++
    expect((await cache.get(source, revision, 'module')).get('name-0')?.get('png')).toEqual(['path-0'])
  })

  it('indexes a captured character snapshot and keeps all extensions for ordered merging', async () => {
    const source = [
      ['PORTRAIT', 'first', 'jpg'],
      ['portrait', 'second', 'png'],
    ]
    const snapshot: AssetTuples = source.map((tuple) => [...tuple])
    const cache = new AssetCollectionIndexCache(
      () => {},
      () => 0,
    )
    source[0][1] = 'edited'
    const index = await cache.get(source, 'original', 'character', snapshot)
    expect([...index.get('portrait')!.entries()]).toEqual([
      ['jpg', ['first']],
      ['png', ['second']],
    ])
    expect((await cache.get(source, 'edited', 'character')).get('portrait')?.get('jpg')).toEqual(['edited'])
  })
})
