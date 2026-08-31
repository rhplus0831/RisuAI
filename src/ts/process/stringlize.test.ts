import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  aggregate: {
    autoSuggestPrefix: 'aggregate suggestion',
    ooba: { formating: { userPrefix: 'aggregate-prefix', seperator: '\n', useName: false } },
    username: 'Aggregate user',
  },
  settings: {
    value: {} as Record<string, unknown>,
    status: 'ready' as 'idle' | 'loading' | 'ready' | 'error',
    groupStatuses: { account: 'ready', providers: 'ready' } as Record<string, 'idle' | 'loading' | 'ready' | 'error'>,
  },
}))

vi.mock('../server/resourceState.svelte', () => ({ settingsResourceState: state.settings }))
vi.mock('../storage/database.svelte', () => ({ getDatabase: () => state.aggregate }))
vi.mock('../utilState', () => ({ getUserName: () => 'Owner presentation user' }))

import { getStopStrings, stringlizeChatOba } from './stringlize'

beforeEach(() => {
  state.settings.value = {
    autoSuggestPrefix: 'owner suggestion',
    ooba: { formating: { userPrefix: 'owner-prefix', seperator: '\n', useName: false } },
    username: 'Owner user',
  }
  state.settings.status = 'ready'
  state.settings.groupStatuses.account = 'ready'
  state.settings.groupStatuses.providers = 'ready'
})

describe('stringlize settings owner', () => {
  it('uses the ready settings owner instead of the aggregate', () => {
    expect(getStopStrings()).toContain('owner-prefix')
    expect(getStopStrings()).toContain('Owner user:')
    expect(getStopStrings()).not.toContain('aggregate-prefix')
  })

  it('accepts an explicit formatting snapshot without ambient owner state', () => {
    state.settings.status = 'error'

    expect(
      stringlizeChatOba([], 'Character', true, false, {
        autoSuggestPrefix: 'explicit suggestion',
        ooba: { formating: { assistantPrefix: 'ASSISTANT', seperator: '\n', useName: false } } as never,
      }),
    ).toContain('explicit suggestion')
  })

  it('does not use stale aggregate formatting after an owner error', () => {
    state.settings.status = 'error'

    expect(getStopStrings()).not.toContain('aggregate-prefix')
    expect(getStopStrings()).not.toContain('Aggregate user:')
  })
})
