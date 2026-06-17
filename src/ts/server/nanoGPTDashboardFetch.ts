import { createLatestOperationGuard, type LatestOperationToken } from './staleStateGuards'

const NANO_GPT_DASHBOARD_FETCH_TARGET = 'nanogptDashboard' as const

export interface NanoGPTDashboardFetchOperation {
  readonly apiKey: string
  readonly token: LatestOperationToken<typeof NANO_GPT_DASHBOARD_FETCH_TARGET>
}

export interface NanoGPTDashboardFetchFreshness {
  readonly currentApiKey: string | null | undefined
}

const nanoGPTDashboardFetchGuard = createLatestOperationGuard<typeof NANO_GPT_DASHBOARD_FETCH_TARGET>()

export function beginNanoGPTDashboardFetch(apiKey: string): NanoGPTDashboardFetchOperation {
  return {
    apiKey,
    token: nanoGPTDashboardFetchGuard.issue(NANO_GPT_DASHBOARD_FETCH_TARGET),
  }
}

export function clearNanoGPTDashboardFetch(operation: NanoGPTDashboardFetchOperation): void {
  nanoGPTDashboardFetchGuard.clear(operation.token)
}

export function isFreshNanoGPTDashboardFetch(
  operation: NanoGPTDashboardFetchOperation,
  freshness: NanoGPTDashboardFetchFreshness,
): boolean {
  if (!nanoGPTDashboardFetchGuard.isLatest(operation.token)) return false
  return freshness.currentApiKey === operation.apiKey
}

export function resolveFreshNanoGPTSubscriptionState(input: {
  operation: NanoGPTDashboardFetchOperation
  currentApiKey: string | null | undefined
  subscriptionState: string
}): string | null {
  if (!isFreshNanoGPTDashboardFetch(input.operation, { currentApiKey: input.currentApiKey })) return null
  return input.subscriptionState
}
