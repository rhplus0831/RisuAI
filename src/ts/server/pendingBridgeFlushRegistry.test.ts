import { describe, expect, it, vi } from 'vitest'

import { flushRegisteredPendingBridgePatches, registerPendingBridgePatchFlusher } from './pendingBridgeFlushRegistry'

describe('pending bridge flush registry', () => {
  it('forwards lifecycle transport options until a component unregisters', () => {
    const flusher = vi.fn()
    const unregister = registerPendingBridgePatchFlusher('test:component-lifecycle', flusher)

    flushRegisteredPendingBridgePatches({ keepalive: true })
    expect(flusher).toHaveBeenCalledOnce()
    expect(flusher).toHaveBeenCalledWith({ keepalive: true })

    unregister()
    flushRegisteredPendingBridgePatches({ keepalive: true })
    expect(flusher).toHaveBeenCalledOnce()
  })

  it('does not let stale component cleanup remove a newer registration with the same id', () => {
    const staleFlusher = vi.fn()
    const currentFlusher = vi.fn()
    const unregisterStale = registerPendingBridgePatchFlusher('test:replacement-lifecycle', staleFlusher)
    const unregisterCurrent = registerPendingBridgePatchFlusher('test:replacement-lifecycle', currentFlusher)

    unregisterStale()
    flushRegisteredPendingBridgePatches({ keepalive: true })

    expect(staleFlusher).not.toHaveBeenCalled()
    expect(currentFlusher).toHaveBeenCalledOnce()

    unregisterCurrent()
  })
})
