import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginStartupAttempt,
  canApplyRoutes,
  canGenerate,
  canMutate,
  canRenderShell,
  completeStartupAttempt,
  failStartupAttempt,
  getStartupCoordinatorSnapshot,
  getStartupReadinessSnapshot,
  pluginsReady,
  recordStartupMilestone,
  resetStartupReadinessForTests,
  revokeStartupWriterCapabilities,
  retryStartupCapability,
  runStartupStep,
  settleStartupChatReadiness,
  settleStartupGenerationRecoveryReadiness,
  waitForStartupMilestone,
} from './startupReadiness'

beforeEach(resetStartupReadinessForTests)

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

  it('derives narrow capabilities at coordinator-owned milestone boundaries', () => {
    recordStartupMilestone('entry', 0)
    recordStartupMilestone('shell-mounted', 1)
    expect([canRenderShell(), canApplyRoutes(), canMutate(), pluginsReady(), canGenerate()]).toEqual([
      false,
      false,
      false,
      false,
      false,
    ])

    recordStartupMilestone('observer-ready', 2)
    expect(canRenderShell()).toBe(false)
    expect(canMutate()).toBe(false)

    recordStartupMilestone('writer-ready', 3)
    expect(canRenderShell()).toBe(true)
    expect(canApplyRoutes()).toBe(true)
    expect(canMutate()).toBe(true)
    expect(canGenerate()).toBe(false)

    recordStartupMilestone('plugins-ready', 4)
    expect(pluginsReady()).toBe(true)
    expect(canGenerate()).toBe(false)

    settleStartupChatReadiness(true)
    expect(canGenerate()).toBe(false)

    settleStartupGenerationRecoveryReadiness(true)
    expect(canGenerate()).toBe(true)
  })

  it('revokes writer-owned capabilities without hiding the readable shell or milestone history', () => {
    for (const milestone of [
      'entry',
      'shell-mounted',
      'observer-ready',
      'writer-ready',
      'plugins-ready',
      'chat-ready',
    ] as const) {
      recordStartupMilestone(milestone)
    }
    settleStartupChatReadiness(true)
    settleStartupGenerationRecoveryReadiness(true)

    revokeStartupWriterCapabilities()

    expect(canRenderShell()).toBe(true)
    expect(canApplyRoutes()).toBe(false)
    expect(canMutate()).toBe(false)
    expect(canGenerate()).toBe(false)
    expect(pluginsReady()).toBe(true)
    expect(getStartupReadinessSnapshot().phase).toBe('chat-ready')
    expect(getStartupCoordinatorSnapshot().writerCapabilitiesRevoked).toBe(true)
  })

  it('records per-capability failures and clears them when readiness is reached', () => {
    recordStartupMilestone('entry', 0)
    recordStartupMilestone('shell-mounted', 1)
    const attemptId = beginStartupAttempt(2)
    failStartupAttempt(attemptId, 'plugin-initialization-failed', 'plugins-ready', 3)

    expect(getStartupCoordinatorSnapshot().failures).toEqual({
      pluginsReady: expect.objectContaining({ attemptId, failureCode: 'plugin-initialization-failed' }),
      canGenerate: expect.objectContaining({ attemptId, failureCode: 'plugin-initialization-failed' }),
    })

    recordStartupMilestone('observer-ready', 4)
    recordStartupMilestone('writer-ready', 5)
    recordStartupMilestone('plugins-ready', 6)
    expect(getStartupCoordinatorSnapshot().failures.pluginsReady).toBeUndefined()
    expect(getStartupCoordinatorSnapshot().failures.canGenerate).toBeDefined()

    settleStartupChatReadiness(true)
    settleStartupGenerationRecoveryReadiness(true)
    expect(getStartupCoordinatorSnapshot().failures.canGenerate).toBeUndefined()
  })

  it('deduplicates successful steps and in-flight targeted retries', async () => {
    const step = vi.fn(async () => 'ready')
    await expect(runStartupStep('plugin-runtime', step)).resolves.toBe('ready')
    await expect(runStartupStep('plugin-runtime', step)).resolves.toBe('ready')
    expect(step).toHaveBeenCalledOnce()

    let releaseRetry!: () => void
    const retry = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseRetry = resolve
        }),
    )
    const firstRetry = retryStartupCapability('canRenderShell', retry)
    const secondRetry = retryStartupCapability('canRenderShell', retry)
    await Promise.resolve()
    expect(retry).toHaveBeenCalledOnce()
    releaseRetry()
    await Promise.all([firstRetry, secondRetry])
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
