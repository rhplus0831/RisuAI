import { beforeEach, describe, expect, it } from 'vitest'

import {
  consumeObserverRouteIntent,
  peekObserverRouteIntent,
  recordObserverRouteIntent,
  resetObserverRouteIntentForTests,
} from './observerRouteIntent'

describe('observer route intent', () => {
  beforeEach(() => resetObserverRouteIntentForTests())

  it('replaces an older presentation choice with the latest route', () => {
    const first = recordObserverRouteIntent({ kind: 'character', path: '/character/a', chaId: 'a' })
    const latest = recordObserverRouteIntent({
      kind: 'character',
      path: '/character/b/chat-b',
      chaId: 'b',
      chatId: 'chat-b',
    })

    expect(latest.sequence).toBeGreaterThan(first.sequence)
    expect(peekObserverRouteIntent()).toEqual(latest)
  })

  it('does not create a new intent for the same semantic route', () => {
    const first = recordObserverRouteIntent({ kind: 'character', path: '/characters/a', chaId: 'a' })
    const duplicate = recordObserverRouteIntent({ kind: 'character', path: '/character/a', chaId: 'a' })

    expect(duplicate).toEqual(first)
  })

  it('consumes only the exact latest intent once', () => {
    const stale = recordObserverRouteIntent({ kind: 'home', path: '/' })
    const latest = recordObserverRouteIntent({ kind: 'grid', path: '/grid' })

    expect(consumeObserverRouteIntent(stale.sequence)).toBeNull()
    expect(consumeObserverRouteIntent(latest.sequence)).toEqual(latest)
    expect(consumeObserverRouteIntent(latest.sequence)).toBeNull()
  })

  it('keeps a newer intent when an older reconciliation finishes late', () => {
    const older = recordObserverRouteIntent({ kind: 'character', path: '/character/a', chaId: 'a' })
    const newer = recordObserverRouteIntent({ kind: 'character', path: '/character/b', chaId: 'b' })

    expect(consumeObserverRouteIntent(older.sequence)).toBeNull()
    expect(peekObserverRouteIntent()).toEqual(newer)
  })
})
