import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const sourcePath = resolve(process.cwd(), 'src/lib/UI/NanoGPTDashboard.svelte')

function readSource(): string {
  return readFileSync(sourcePath, 'utf8')
}

describe('NanoGPTDashboard freshness contract', () => {
  it('routes subscription persistence through the NanoGPT dashboard freshness helper', () => {
    const source = readSource()

    expect(source).toContain("from 'src/ts/server/nanoGPTDashboardFetch'")
    expect(source).toContain('beginNanoGPTDashboardFetch(key)')
    expect(source).toContain('resolveFreshNanoGPTSubscriptionState({')
    expect(source).toContain('currentApiKey,')
    expect(source).toContain("subscriptionState !== (getDatabase().nanogptSubscriptionState ?? '')")
    expect(source).not.toContain("const subscriptionState = subscription?.state ?? ''")
  })

  it('does not render stale account data while a new key is settling', () => {
    const source = readSource()

    expect(source).toContain('apiKey && apiKey === currentApiKey')
  })

  it('clears the active dashboard fetch operation on destroy', () => {
    const source = readSource()

    expect(source).toContain('onDestroy(() => {')
    expect(source).toContain('clearNanoGPTDashboardFetch(activeDashboardOperation)')
  })
})
