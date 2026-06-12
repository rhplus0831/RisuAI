import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerMemoryJob, ServerMemoryResult } from '../process/request/serverMemory'
import { createMemoryJobRefreshController, hasActiveMemoryJobs } from './memoryJobRefresh'

const NOW = new Date('2026-06-01T00:00:00.000Z')

function job(status: ServerMemoryJob['status'], id = `job-${status}`): ServerMemoryJob {
  return {
    id,
    chatId: 'chat-1',
    kind: 'summarize',
    status,
    payload: {},
    error: null,
    attemptCount: 1,
    maxAttempts: 3,
    nextRunAt: NOW.toISOString(),
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('memory job refresh controller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('detects pending and running jobs as active', () => {
    expect(hasActiveMemoryJobs([job('pending')])).toBe(true)
    expect(hasActiveMemoryJobs([job('running')])).toBe(true)
    expect(hasActiveMemoryJobs([job('completed'), job('failed'), job('cancelled')])).toBe(false)
  })

  it('does not overlap refresh requests and runs one queued refresh afterward', async () => {
    const first = deferred<ServerMemoryResult<{ jobs: ServerMemoryJob[] }>>()
    const second = deferred<ServerMemoryResult<{ jobs: ServerMemoryJob[] }>>()
    const listJobs = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const seenJobs: ServerMemoryJob[][] = []
    const loading: boolean[] = []
    const controller = createMemoryJobRefreshController({
      chatId: 'chat-1',
      listJobs,
      onJobs: (jobs) => seenJobs.push(jobs),
      onError: vi.fn(),
      onClear: vi.fn(),
      onLoading: (value) => loading.push(value),
      now: () => NOW,
    })

    const firstRefresh = controller.refresh()
    const queuedRefresh = controller.refresh()

    expect(listJobs).toHaveBeenCalledTimes(1)
    first.resolve({ status: 'ok', jobs: [job('running', 'job-1')] })
    await firstRefresh
    expect(listJobs).toHaveBeenCalledTimes(2)

    second.resolve({ status: 'ok', jobs: [] })
    await queuedRefresh
    await vi.runOnlyPendingTimersAsync()

    expect(seenJobs.map((jobs) => jobs.map((entry) => entry.id))).toEqual([['job-1'], []])
    expect(loading).toEqual([true, false, true, false])
    controller.dispose()
  })

  it('polls only while active jobs exist', async () => {
    const listJobs = vi
      .fn()
      .mockResolvedValueOnce({ status: 'ok', jobs: [job('pending', 'job-1')] })
      .mockResolvedValueOnce({ status: 'ok', jobs: [] })
    const seenJobs: ServerMemoryJob[][] = []
    const controller = createMemoryJobRefreshController({
      chatId: 'chat-1',
      intervalMs: 1000,
      listJobs,
      onJobs: (jobs) => seenJobs.push(jobs),
      onError: vi.fn(),
      onClear: vi.fn(),
      onLoading: vi.fn(),
      now: () => NOW,
    })

    await controller.refresh()
    expect(listJobs).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(listJobs).toHaveBeenCalledTimes(2)
    expect(seenJobs.map((jobs) => jobs.map((entry) => entry.id))).toEqual([['job-1'], []])

    await vi.advanceTimersByTimeAsync(3000)
    expect(listJobs).toHaveBeenCalledTimes(2)
    controller.dispose()
  })

  it('clears state and stops polling when the chat id becomes empty', async () => {
    const listJobs = vi.fn().mockResolvedValue({ status: 'ok', jobs: [job('running', 'job-1')] })
    const onClear = vi.fn()
    const controller = createMemoryJobRefreshController({
      chatId: 'chat-1',
      intervalMs: 1000,
      listJobs,
      onJobs: vi.fn(),
      onError: vi.fn(),
      onClear,
      onLoading: vi.fn(),
      now: () => NOW,
    })

    await controller.refresh()
    controller.setChatId('')
    expect(onClear).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(3000)
    expect(listJobs).toHaveBeenCalledTimes(1)
    controller.dispose()
  })
})
