import { describe, expect, it, vi } from 'vitest'

import {
  hasActiveModuleEditorLeaveGuard,
  registerModuleEditorLeaveGuard,
  requestActiveModuleEditorLeave,
} from './moduleEditorLeaveGuard'

describe('module editor leave guard registry', () => {
  it('allows leaving without an active editor guard', () => {
    expect(hasActiveModuleEditorLeaveGuard()).toBe(false)
    expect(requestActiveModuleEditorLeave()).toBe(true)
  })

  it('honors the newest active guard and unregisters it cleanly', () => {
    const older = vi.fn(() => true)
    const newer = vi.fn(() => false)
    const unregisterOlder = registerModuleEditorLeaveGuard(older)
    const unregisterNewer = registerModuleEditorLeaveGuard(newer)

    try {
      expect(requestActiveModuleEditorLeave()).toBe(false)
      expect(newer).toHaveBeenCalledOnce()
      expect(older).not.toHaveBeenCalled()

      unregisterNewer()
      expect(requestActiveModuleEditorLeave()).toBe(true)
      expect(older).toHaveBeenCalledOnce()
    } finally {
      unregisterNewer()
      unregisterOlder()
    }

    expect(hasActiveModuleEditorLeaveGuard()).toBe(false)
  })
})
