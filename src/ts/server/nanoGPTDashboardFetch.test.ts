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
    subscriptionState: unknown
  }>,
): string | null {
  return resolveFreshNanoGPTSubscriptionState({
    operation,
    currentApiKey: Object.hasOwn(input ?? {}, 'currentApiKey') ? input?.currentApiKey : operation.apiKey,
    subscriptionState: Object.hasOwn(input ?? {}, 'subscriptionState') ? (input?.subscriptionState ?? null) : 'active',
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

  it('does not replace a saved subscription state when a fresh account request fails', () => {
    const operation = beginNanoGPTDashboardFetch('key-a')

    try {
      expect(resolveSubscriptionState(operation, { subscriptionState: null })).toBeNull()
    } finally {
      clearNanoGPTDashboardFetch(operation)
    }
  })

  it('rejects a malformed subscription state from a fresh provider response', () => {
    const operation = beginNanoGPTDashboardFetch('key-a')

    try {
      expect(resolveSubscriptionState(operation, { subscriptionState: 'unexpected-state' })).toBeNull()
      expect(resolveSubscriptionState(operation, { subscriptionState: { state: 'active' } })).toBeNull()
    } finally {
      clearNanoGPTDashboardFetch(operation)
    }
  })
})
