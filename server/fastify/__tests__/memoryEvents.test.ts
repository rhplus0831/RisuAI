import { describe, expect, it } from 'vitest'
import { buildMemoryJobEvent } from '../src/memoryEvents.js'
import type { MemoryJob } from '../src/memoryRepository.js'

describe('memory job event presentation', () => {
  it('includes terminal errors and redacts credential values', () => {
    const job: MemoryJob = {
      id: 'job-1',
      instanceId: 'job-instance-1',
      chatId: 'chat-1',
      kind: 'summarize',
      status: 'failed',
      payload: {},
      error: 'Authorization: Bearer provider-secret',
      attemptCount: 3,
      maxAttempts: 3,
      nextRunAt: '2026-06-01T00:00:00.000Z',
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:01:00.000Z',
    }

    expect(buildMemoryJobEvent(job).job).toEqual({
      id: 'job-1',
      instanceId: 'job-instance-1',
      kind: 'summarize',
      status: 'failed',
      attemptCount: 3,
      maxAttempts: 3,
      error: 'Authorization: [redacted]',
      updatedAt: '2026-06-01T00:01:00.000Z',
    })
  })

  it.each(['pending', 'running', 'completed', 'failed', 'cancelled'] as const)(
    'keeps concrete job identity and timestamps for %s events',
    (status) => {
      const event = buildMemoryJobEvent({
        id: 'logical-job',
        instanceId: 'concrete-instance',
        chatId: 'chat-1',
        kind: 'embed',
        status,
        payload: {},
        error: null,
        attemptCount: status === 'pending' ? 0 : 1,
        maxAttempts: 3,
        nextRunAt: '2026-06-01T00:00:00.000Z',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:01:00.000Z',
      })

      expect(event.job).toMatchObject({
        id: 'logical-job',
        instanceId: 'concrete-instance',
        status,
        updatedAt: '2026-06-01T00:01:00.000Z',
      })
    },
  )
})
