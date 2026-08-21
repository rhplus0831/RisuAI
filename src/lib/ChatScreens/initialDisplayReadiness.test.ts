import { describe, expect, it } from 'vitest'
import { createInitialDisplayReadiness } from './initialDisplayReadiness'

function createHarness() {
  const pendingChanges: boolean[] = []
  const renderWaiters: Array<() => void> = []
  const readiness = createInitialDisplayReadiness(
    (pending) => pendingChanges.push(pending),
    () =>
      new Promise<void>((resolve) => {
        renderWaiters.push(resolve)
      }),
  )

  return {
    pendingChanges,
    readiness,
    async flushRenderWaiters() {
      const waiters = renderWaiters.splice(0)
      for (const resolve of waiters) resolve()
      await Promise.resolve()
      await Promise.resolve()
    },
    renderWaiters,
  }
}

describe('initial transcript display readiness', () => {
  it('keeps the cold transcript pending until every registered parse settles', async () => {
    const harness = createHarness()
    const first = Symbol('first')
    const second = Symbol('second')

    harness.readiness.updateScope('chat-a', true)
    harness.readiness.start('chat-a', first)
    harness.readiness.start('chat-a', second)
    await harness.flushRenderWaiters()

    expect(harness.pendingChanges).toEqual([true])

    harness.readiness.settle('chat-a', first)
    expect(harness.renderWaiters).toHaveLength(0)

    harness.readiness.settle('chat-a', second)
    expect(harness.renderWaiters).toHaveLength(1)
    await harness.flushRenderWaiters()

    expect(harness.pendingChanges).toEqual([true, false])
  })

  it('ignores stale settlements after switching chat scopes', async () => {
    const harness = createHarness()
    const stale = Symbol('stale')
    const current = Symbol('current')

    harness.readiness.updateScope('chat-a', true)
    harness.readiness.start('chat-a', stale)
    harness.readiness.updateScope('chat-b', true)
    harness.readiness.start('chat-b', current)
    harness.readiness.settle('chat-a', stale)
    await harness.flushRenderWaiters()

    expect(harness.pendingChanges).toEqual([true])

    harness.readiness.settle('chat-b', current)
    await harness.flushRenderWaiters()

    expect(harness.pendingChanges).toEqual([true, false])
  })

  it('clears after one render when the initial rows do not mount parsed bodies and ignores later reparses', async () => {
    const harness = createHarness()

    harness.readiness.updateScope('chat-a', true)
    await harness.flushRenderWaiters()
    expect(harness.pendingChanges).toEqual([true, false])

    harness.readiness.start('chat-a', Symbol('later-reparse'))
    expect(harness.pendingChanges).toEqual([true, false])
  })
})
