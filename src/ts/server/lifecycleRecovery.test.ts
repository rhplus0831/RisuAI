import { afterEach, describe, expect, it, vi } from 'vitest'
import { subscribeBrowserLifecycleRecovery } from './lifecycleRecovery'

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe('browser lifecycle recovery', () => {
  it('coalesces one foreground event burst for every recovery domain', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    const generation = vi.fn()
    const resources = vi.fn()
    cleanups.push(subscribeBrowserLifecycleRecovery(generation))
    cleanups.push(subscribeBrowserLifecycleRecovery(resources))

    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    await Promise.resolve()

    expect(generation).toHaveBeenCalledOnce()
    expect(generation).toHaveBeenCalledWith('pageshow')
    expect(resources).toHaveBeenCalledOnce()
    expect(resources).toHaveBeenCalledWith('pageshow')
  })
})
