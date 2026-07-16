import { mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const dashboardMocks = vi.hoisted(() => ({
  applySetting: vi.fn(),
  balance: vi.fn(),
  database: { nanogptSubscriptionState: 'active' } as Record<string, unknown>,
  subscription: vi.fn(),
}))

vi.mock('src/ts/model/nanogpt', () => ({
  getNanoGPTBalance: dashboardMocks.balance,
  getNanoGPTSubscription: dashboardMocks.subscription,
}))

vi.mock('src/ts/storage/database.svelte', () => ({
  getDatabase: () => dashboardMocks.database,
}))

vi.mock('src/ts/server/settingsBridge.svelte', () => ({
  applyServerBackedSetting: dashboardMocks.applySetting,
}))

import NanoGPTDashboard from './NanoGPTDashboard.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  dashboardMocks.database = { nanogptSubscriptionState: 'active' }
  dashboardMocks.applySetting.mockReset()
  dashboardMocks.balance.mockReset()
  dashboardMocks.subscription.mockReset()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('NanoGPTDashboard account refresh', () => {
  it('preserves the saved subscription state when the account request fails', async () => {
    dashboardMocks.balance.mockResolvedValue(null)
    dashboardMocks.subscription.mockResolvedValue(null)

    component = mount(NanoGPTDashboard, {
      target,
      props: { apiKey: 'account-key', currentApiKey: 'account-key' },
    })

    await vi.waitFor(() => {
      expect(dashboardMocks.balance).toHaveBeenCalledWith('account-key')
      expect(dashboardMocks.subscription).toHaveBeenCalledWith('account-key')
    })
    await Promise.resolve()

    expect(dashboardMocks.applySetting).not.toHaveBeenCalled()
    expect(dashboardMocks.database.nanogptSubscriptionState).toBe('active')
  })

  it('persists a fresh successful subscription state', async () => {
    dashboardMocks.balance.mockResolvedValue(null)
    dashboardMocks.subscription.mockResolvedValue({ state: 'inactive' })

    component = mount(NanoGPTDashboard, {
      target,
      props: { apiKey: 'account-key', currentApiKey: 'account-key' },
    })

    await vi.waitFor(() => {
      expect(dashboardMocks.applySetting).toHaveBeenCalledWith('nanogptSubscriptionState', 'inactive')
    })
  })

  it('does not persist a malformed provider subscription state', async () => {
    dashboardMocks.balance.mockResolvedValue(null)
    dashboardMocks.subscription.mockResolvedValue({ state: 'unexpected-state' })

    component = mount(NanoGPTDashboard, {
      target,
      props: { apiKey: 'account-key', currentApiKey: 'account-key' },
    })

    await vi.waitFor(() => expect(dashboardMocks.subscription).toHaveBeenCalledWith('account-key'))
    await Promise.resolve()

    expect(dashboardMocks.applySetting).not.toHaveBeenCalled()
    expect(dashboardMocks.database.nanogptSubscriptionState).toBe('active')
  })
})
