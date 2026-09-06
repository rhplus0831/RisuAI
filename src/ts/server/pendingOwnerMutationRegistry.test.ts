import { describe, expect, it, vi } from 'vitest'

import {
  flushRegisteredPendingOwnerMutation,
  flushRegisteredPendingOwnerMutations,
  registerPendingOwnerResetter,
  registerPendingOwnerMutationFlusher,
  resetRegisteredOwnerState,
} from './pendingOwnerMutationRegistry'

describe('pending owner mutation registry', () => {
  it('forwards lifecycle transport options until a component unregisters', () => {
    const flusher = vi.fn()
    const unregister = registerPendingOwnerMutationFlusher('test:component-lifecycle', flusher)

    flushRegisteredPendingOwnerMutations({ keepalive: true })
    expect(flusher).toHaveBeenCalledOnce()
    expect(flusher).toHaveBeenCalledWith({ keepalive: true })

    unregister()
    flushRegisteredPendingOwnerMutations({ keepalive: true })
    expect(flusher).toHaveBeenCalledOnce()
  })

  it('does not let stale component cleanup remove a newer registration with the same id', () => {
    const staleFlusher = vi.fn()
    const currentFlusher = vi.fn()
    const unregisterStale = registerPendingOwnerMutationFlusher('test:replacement-lifecycle', staleFlusher)
    const unregisterCurrent = registerPendingOwnerMutationFlusher('test:replacement-lifecycle', currentFlusher)

    unregisterStale()
    flushRegisteredPendingOwnerMutations({ keepalive: true })

    expect(staleFlusher).not.toHaveBeenCalled()
    expect(currentFlusher).toHaveBeenCalledOnce()

    unregisterCurrent()
  })

  it('flushes only the requested owner when a structural action is about to switch projections', () => {
    const settingsFlusher = vi.fn()
    const chatFlusher = vi.fn()
    const unregisterSettings = registerPendingOwnerMutationFlusher('test:settings-targeted', settingsFlusher)
    const unregisterChat = registerPendingOwnerMutationFlusher('test:chat-targeted', chatFlusher)

    expect(flushRegisteredPendingOwnerMutation('test:settings-targeted', {})).toBe(true)
    expect(flushRegisteredPendingOwnerMutation('test:missing-targeted', {})).toBe(false)
    expect(settingsFlusher).toHaveBeenCalledOnce()
    expect(chatFlusher).not.toHaveBeenCalled()

    unregisterSettings()
    unregisterChat()
  })

  it('resets only the current in-memory owner registration after database replacement', () => {
    const staleResetter = vi.fn()
    const currentResetter = vi.fn()
    const unregisterStale = registerPendingOwnerResetter('test:settings-owner', staleResetter)
    const unregisterCurrent = registerPendingOwnerResetter('test:settings-owner', currentResetter)

    unregisterStale()
    resetRegisteredOwnerState()

    expect(staleResetter).not.toHaveBeenCalled()
    expect(currentResetter).toHaveBeenCalledOnce()
    unregisterCurrent()
  })
})
