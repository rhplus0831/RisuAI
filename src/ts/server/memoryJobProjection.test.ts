import { beforeEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import type { ServerMemoryJob, ServerMemoryJobStatus } from '../process/request/serverMemory'
import type { ServerMemoryEvent, ServerMemoryJobSnapshot } from './events'
import { groupMemoryJobsForPresentation } from './memoryJobPresentation'
import {
  MEMORY_JOB_TERMINAL_PROJECTION_LIMIT,
  applyServerMemoryJobEvent,
  applyServerMemoryJobSnapshot,
  memoryJobProjectionStore,
  replaceMemoryJobsForChat,
  resetMemoryJobProjectionForTests,
  selectMemoryJobs,
  selectMemoryProgress,
  startLocalMemoryJob,
  updateLocalMemoryJob,
} from './memoryJobProjection.svelte'

function job(input: {
  id: string
  instanceId?: string
  chatId?: string
  status?: ServerMemoryJobStatus
}): ServerMemoryJob {
  return {
    id: input.id,
    instanceId: input.instanceId ?? `${input.id}-instance`,
    chatId: input.chatId ?? 'chat-1',
    kind: 'summarize',
    status: input.status ?? 'running',
    attemptCount: 1,
    maxAttempts: 3,
    updatedAt: '2026-08-11T00:00:00.000Z',
  }
}

function event(version: number, value: ServerMemoryJob, streamId = 'stream-1'): ServerMemoryEvent {
  const { chatId, ...eventJob } = value
  return { type: 'memory.job', streamId, version, chatId, job: eventJob }
}

function snapshot(version: number, jobs: ServerMemoryJob[], streamId = 'stream-1'): ServerMemoryJobSnapshot {
  return { type: 'memory.snapshot', streamId, version, jobs }
}

describe('memory job projection', () => {
  beforeEach(() => {
    resetMemoryJobProjectionForTests()
  })

  it('keeps every active identity when another job reaches a terminal state', () => {
    const first = job({ id: 'job-a', chatId: 'chat-a' })
    const second = job({ id: 'job-b', chatId: 'chat-b' })

    applyServerMemoryJobEvent(event(1, first))
    applyServerMemoryJobEvent(event(2, second))
    applyServerMemoryJobEvent(event(3, { ...first, status: 'completed' }))

    const projection = selectMemoryProgress(get(memoryJobProjectionStore), 'chat-a', false)
    expect(projection.activeCount).toBe(1)
    expect(projection.allActiveJobs).toEqual([second])
  })

  it('derives truthful chat labels, counts, and open-chat-only presentation from job identities', () => {
    const openJob = job({ id: 'open-job', chatId: 'chat-open' })
    const otherJob = job({ id: 'other-job', chatId: 'chat-other', status: 'pending' })
    applyServerMemoryJobSnapshot(snapshot(0, [otherJob, openJob]))

    const state = get(memoryJobProjectionStore)
    const aggregate = selectMemoryProgress(state, 'chat-open', false)
    expect(aggregate.presentedCount).toBe(2)
    expect(aggregate.backgroundCount).toBe(0)
    expect(
      groupMemoryJobsForPresentation(aggregate.presentedJobs, 'chat-open', (chatId) =>
        chatId === 'chat-open' ? 'Open Chat' : 'Other Chat',
      ).map((group) => ({ label: group.label, ids: group.jobs.map((entry) => entry.id) })),
    ).toEqual([
      { label: 'Open Chat', ids: ['open-job'] },
      { label: 'Other Chat', ids: ['other-job'] },
    ])

    const scoped = selectMemoryProgress(state, 'chat-open', true)
    expect(scoped.presentedJobs).toEqual([openJob])
    expect(scoped.presentedCount).toBe(1)
    expect(scoped.backgroundJobs).toEqual([otherJob])
    expect(scoped.backgroundCount).toBe(1)
  })

  it('preserves post-snapshot events and replaces stale active state on reconnect', () => {
    const stale = job({ id: 'stale-job' })
    const newer = job({ id: 'newer-job', chatId: 'chat-2' })
    applyServerMemoryJobSnapshot(snapshot(4, [stale]))
    applyServerMemoryJobEvent(event(5, newer))

    applyServerMemoryJobSnapshot(snapshot(4, [stale]))
    expect(selectMemoryProgress(get(memoryJobProjectionStore), null, false).allActiveJobs).toEqual([stale, newer])

    applyServerMemoryJobSnapshot(snapshot(0, [], 'stream-2'))
    expect(selectMemoryProgress(get(memoryJobProjectionStore), null, false).allActiveJobs).toEqual([])
  })

  it('rejects a lower-version snapshot from the current stream', () => {
    const stale = job({ id: 'stale-job' })
    applyServerMemoryJobSnapshot(snapshot(5, [stale]))
    applyServerMemoryJobSnapshot(snapshot(10, []))

    expect(applyServerMemoryJobSnapshot(snapshot(5, [stale]))).toBe(false)
    expect(get(memoryJobProjectionStore).version).toBe(10)
    expect(selectMemoryProgress(get(memoryJobProjectionStore), null, false).allActiveJobs).toEqual([])
  })

  it('adopts a replacement job lists version when the server stream changes', () => {
    const replacement = job({ id: 'replacement-job' })
    applyServerMemoryJobSnapshot(snapshot(100, [job({ id: 'old-job' })], 'old-stream'))

    replaceMemoryJobsForChat('chat-1', [replacement], { streamId: 'new-stream', version: 1 })

    expect(get(memoryJobProjectionStore)).toMatchObject({ streamId: 'new-stream', version: 1 })
    expect(applyServerMemoryJobEvent(event(2, { ...replacement, status: 'completed' }, 'new-stream'))).toBe(true)
    expect(selectMemoryProgress(get(memoryJobProjectionStore), null, false).allActiveJobs).toEqual([])
    expect(selectMemoryJobs(get(memoryJobProjectionStore))).toContainEqual({ ...replacement, status: 'completed' })
  })

  it('keeps identified browser-local work separate from server snapshot replacement', () => {
    const local = startLocalMemoryJob({ chatId: 'local-chat', kind: 'embed' })
    applyServerMemoryJobSnapshot(snapshot(0, [], 'stream-2'))

    expect(selectMemoryProgress(get(memoryJobProjectionStore), 'local-chat', false).allActiveJobs).toMatchObject([
      { id: local.id, instanceId: local.instanceId, chatId: 'local-chat', kind: 'embed', status: 'running' },
    ])
    updateLocalMemoryJob(local, 'completed')
    expect(selectMemoryProgress(get(memoryJobProjectionStore), 'local-chat', false).activeCount).toBe(0)
  })

  it('accepts a recreated logical job only when it has a new concrete instance identity', () => {
    const oldInstance = job({ id: 'logical-job', instanceId: 'instance-old' })
    applyServerMemoryJobEvent(event(1, oldInstance))
    applyServerMemoryJobEvent(event(2, { ...oldInstance, status: 'cancelled' }))
    expect(applyServerMemoryJobEvent(event(3, { ...oldInstance, status: 'running' }))).toBe(false)

    const recreated = job({ id: 'logical-job', instanceId: 'instance-new', status: 'pending' })
    expect(applyServerMemoryJobEvent(event(4, recreated))).toBe(true)
    expect(selectMemoryProgress(get(memoryJobProjectionStore), 'chat-1', false).allActiveJobs).toEqual([recreated])
  })

  it('bounds retained terminal instances without removing active jobs', () => {
    const active = job({ id: 'still-running' })
    applyServerMemoryJobEvent(event(1, active))
    for (let index = 0; index <= MEMORY_JOB_TERMINAL_PROJECTION_LIMIT; index += 1) {
      const terminal = job({
        id: `terminal-${index}`,
        instanceId: `terminal-instance-${index}`,
        status: 'completed',
      })
      applyServerMemoryJobEvent(event(index + 2, terminal))
    }

    const retained = selectMemoryJobs(get(memoryJobProjectionStore))
    expect(retained.filter((entry) => entry.status === 'completed')).toHaveLength(MEMORY_JOB_TERMINAL_PROJECTION_LIMIT)
    expect(retained).toContainEqual(active)
  })
})
