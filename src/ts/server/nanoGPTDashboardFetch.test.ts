import { describe, expect, it } from 'vitest'

import {
  beginNanoGPTDashboardFetch,
  clearNanoGPTDashboardFetch,
  resolveFreshNanoGPTSubscriptionState,
  type NanoGPTDashboardFetchOperation,
} from './nanoGPTDashboardFetch'

function resolveSubscriptionState(
  operation: NanoGPTDashboardFetchOperation,
  input?: Partial<{
    currentApiKey: string | null
    subscriptionState: string
  }>,
): string | null {
  return resolveFreshNanoGPTSubscriptionState({
    operation,
    currentApiKey: Object.hasOwn(input ?? {}, 'currentApiKey') ? input?.currentApiKey : operation.apiKey,
    subscriptionState: Object.hasOwn(input ?? {}, 'subscriptionState') ? (input?.subscriptionState ?? '') : 'active',
  })
}

describe('NanoGPT dashboard fetch freshness', () => {
  it('rejects an old key result after the current key changes', () => {
    const operation = beginNanoGPTDashboardFetch('key-a')

    try {
      expect(resolveSubscriptionState(operation, { currentApiKey: 'key-b' })).toBeNull()
    } finally {
      clearNanoGPTDashboardFetch(operation)
    }
  })

  it('rejects an older key fetch once a newer key fetch starts on the fixed dashboard target', () => {
    const older = beginNanoGPTDashboardFetch('key-a')
    const newer = beginNanoGPTDashboardFetch('key-b')

    try {
      expect(resolveSubscriptionState(older, { currentApiKey: 'key-a' })).toBeNull()
      expect(resolveSubscriptionState(newer, { currentApiKey: 'key-b', subscriptionState: 'grace' })).toBe('grace')
    } finally {
      clearNanoGPTDashboardFetch(older)
      clearNanoGPTDashboardFetch(newer)
    }
  })

  it('rejects an older same-key request after a newer same-key request starts', () => {
    const older = beginNanoGPTDashboardFetch('key-a')
    const newer = beginNanoGPTDashboardFetch('key-a')

    try {
      expect(resolveSubscriptionState(older)).toBeNull()
      expect(resolveSubscriptionState(newer, { subscriptionState: 'inactive' })).toBe('inactive')
    } finally {
      clearNanoGPTDashboardFetch(older)
      clearNanoGPTDashboardFetch(newer)
    }
  })

  it('rejects a cleared operation so unmount cleanup drops late results', () => {
    const operation = beginNanoGPTDashboardFetch('key-a')

    clearNanoGPTDashboardFetch(operation)

    expect(resolveSubscriptionState(operation)).toBeNull()
  })

  it('returns an empty subscription state for a fresh request with no subscription', () => {
    const operation = beginNanoGPTDashboardFetch('key-a')

    try {
      expect(resolveSubscriptionState(operation, { subscriptionState: '' })).toBe('')
    } finally {
      clearNanoGPTDashboardFetch(operation)
    }
  })
})
