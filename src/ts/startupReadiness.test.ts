import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  beginStartupAttempt,
  completeStartupAttempt,
  failStartupAttempt,
  getStartupReadinessSnapshot,
  recordStartupMilestone,
  resetStartupReadinessForTests,
  waitForStartupMilestone,
} from './startupReadiness'

afterEach(() => {
  resetStartupReadinessForTests()
  vi.useRealTimers()
})

describe('startup readiness instrumentation', () => {
  it('publishes ordered, monotonic transitions when signals arrive out of order', () => {
    recordStartupMilestone('entry', 0)
    recordStartupMilestone('shell-mounted', 5)
    expect(recordStartupMilestone('writer-ready', 12)).toBe('pending')
    expect(getStartupReadinessSnapshot().phase).toBe('shell-mounted')

    recordStartupMilestone('observer-ready', 15)

    expect(getStartupReadinessSnapshot()).toMatchObject({
      phase: 'writer-ready',
      timestamps: {
        entry: 0,
        'shell-mounted': 5,
        'observer-ready': 15,
        'writer-ready': 15,
      },
      durationsFromEntry: {
        entry: 0,
        'shell-mounted': 5,
        'observer-ready': 15,
        'writer-ready': 15,
      },
    })
  })

  it('suppresses duplicate signals without rewriting the first transition', () => {
    recordStartupMilestone('entry', 0)
    expect(recordStartupMilestone('entry', 99)).toBe('duplicate')

    expect(getStartupReadinessSnapshot().timestamps.entry).toBe(0)
  })

  it('records retry failures without error or browser-content data', () => {
    const firstAttempt = beginStartupAttempt(10)
    failStartupAttempt(firstAttempt, 'writer-bootstrap-failed', 'observer-ready', 12)
    const secondAttempt = beginStartupAttempt(13)
    completeStartupAttempt(secondAttempt, 20)

    const snapshot = getStartupReadinessSnapshot()
    expect(snapshot.attempts).toEqual([
      {
        attemptId: 1,
        startedAtMs: 10,
        failedAtMs: 12,
        failureCode: 'writer-bootstrap-failed',
        failureMilestone: 'observer-ready',
      },
      { attemptId: 2, startedAtMs: 13, completedAtMs: 20 },
    ])
    expect(JSON.stringify(snapshot)).not.toMatch(/character|chat content|prompt|plugin storage|account/i)
  })

  it('waits for a narrow milestone and rejects on timeout', async () => {
    vi.useFakeTimers()
    const waiting = waitForStartupMilestone('writer-ready', 100)
    recordStartupMilestone('entry', 0)
    recordStartupMilestone('shell-mounted', 1)
    recordStartupMilestone('observer-ready', 2)
    recordStartupMilestone('writer-ready', 3)
    await expect(waiting).resolves.toBeUndefined()

    const timedOut = waitForStartupMilestone('chat-ready', 100)
    const rejection = expect(timedOut).rejects.toThrow('Timed out waiting for startup milestone: chat-ready')
    await vi.advanceTimersByTimeAsync(100)
    await rejection
  })
})
