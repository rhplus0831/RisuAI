import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  aggregate: { keiServerURL: '' },
  settings: {
    value: {} as { keiServerURL?: string },
    status: 'ready' as 'idle' | 'loading' | 'ready' | 'error',
    groupStatuses: { advanced: 'ready' } as Record<string, 'idle' | 'loading' | 'ready' | 'error'>,
  },
}))

vi.mock('../characterCards', () => ({ hubURL: 'https://hub.example.test' }))
vi.mock('../server/resourceState.svelte', () => ({ settingsResourceState: state.settings }))
vi.mock('../storage/database.svelte', () => ({ getDatabase: () => state.aggregate }))

import { keiServerURL } from './kei'

beforeEach(() => {
  state.aggregate.keiServerURL = 'https://aggregate.example.test'
  state.settings.value = { keiServerURL: 'https://owner.example.test' }
  state.settings.status = 'ready'
  state.settings.groupStatuses.advanced = 'ready'
})

describe('keiServerURL settings owner', () => {
  it('uses the ready advanced-settings owner instead of the aggregate', () => {
    expect(keiServerURL()).toBe('https://owner.example.test')
  })

  it.each(['idle', 'loading'] as const)('retains aggregate bootstrap compatibility while %s', (status) => {
    state.settings.status = status
    state.settings.groupStatuses.advanced = status
    state.settings.value = {}

    expect(keiServerURL()).toBe('https://aggregate.example.test')
  })

  it('fails closed to the public hub endpoint after an owner error', () => {
    state.settings.groupStatuses.advanced = 'error'

    expect(keiServerURL()).toBe('https://hub.example.test/kei')
  })
})
