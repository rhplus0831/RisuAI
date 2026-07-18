import { beforeEach, describe, expect, it, vi } from 'vitest'

const forage = vi.hoisted(() => ({
  getItem: vi.fn(),
  removeItem: vi.fn(),
  setItem: vi.fn(),
}))

vi.mock('localforage', () => ({
  default: {
    createInstance: vi.fn(() => forage),
  },
}))

import { normalizePushNotificationRetryState, pushNotificationRetryStorage } from './pushNotificationRetryStorage'

beforeEach(() => {
  forage.getItem.mockReset()
  forage.removeItem.mockReset()
  forage.setItem.mockReset()
})

describe('push notification retry storage', () => {
  it('hydrates only bounded unique endpoint strings', async () => {
    const endpoint = 'https://push.example.test/a'
    forage.getItem.mockResolvedValue({
      pendingEndpoints: [endpoint, endpoint, '', 42, 'x'.repeat(8193)],
      localInspectionPending: true,
    })

    await expect(pushNotificationRetryStorage.loadPendingCleanup()).resolves.toEqual({
      pendingEndpoints: [endpoint],
      localInspectionPending: true,
    })
  })

  it('persists the cleanup ledger and removes it only after all cleanup completes', async () => {
    const endpoint = 'https://push.example.test/a'

    await pushNotificationRetryStorage.savePendingCleanup({
      pendingEndpoints: [endpoint, endpoint],
      localInspectionPending: true,
    })
    expect(forage.setItem).toHaveBeenCalledWith('pending-cleanup-v1', {
      pendingEndpoints: [endpoint],
      localInspectionPending: true,
    })

    await pushNotificationRetryStorage.savePendingCleanup({
      pendingEndpoints: [],
      localInspectionPending: false,
    })
    expect(forage.removeItem).toHaveBeenCalledWith('pending-cleanup-v1')
  })

  it('normalizes corrupt values to an empty cleanup ledger', () => {
    expect(normalizePushNotificationRetryState({ endpoint: 'invalid' })).toEqual({
      pendingEndpoints: [],
      localInspectionPending: false,
    })
  })
})
