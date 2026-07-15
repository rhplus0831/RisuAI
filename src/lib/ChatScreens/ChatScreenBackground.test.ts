import { describe, expect, it, vi } from 'vitest'
import { createLatestBackgroundLoader } from './ChatScreenBackground'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('createLatestBackgroundLoader', () => {
  it('discards an older background that resolves after the newest selection', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const loadBackground = vi.fn((source: string) => (source === 'first' ? first.promise : second.promise))
    const loadLatestBackground = createLatestBackgroundLoader(loadBackground)

    const firstLoad = loadLatestBackground('first')
    const secondLoad = loadLatestBackground('second')
    second.resolve('background: url(second)')
    await expect(secondLoad).resolves.toBe('background: url(second)')

    first.resolve('background: url(first)')
    await expect(firstLoad).resolves.toBeUndefined()
  })

  it('treats a repeated source as a newer operation', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const loadBackground = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const loadLatestBackground = createLatestBackgroundLoader(loadBackground)

    const firstLoad = loadLatestBackground('same')
    const secondLoad = loadLatestBackground('same')
    second.resolve('new value')
    first.resolve('old value')

    await expect(secondLoad).resolves.toBe('new value')
    await expect(firstLoad).resolves.toBeUndefined()
  })
})
