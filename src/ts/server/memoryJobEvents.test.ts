import { describe, expect, it } from 'vitest'
import type { ServerMemoryEvent } from './events'
import { publishServerMemoryJobEvent, subscribeServerMemoryJobEvents } from './memoryJobEvents'

function memoryEvent(jobId: string): ServerMemoryEvent {
  return {
    type: 'memory.job',
    streamId: 'memory-stream-1',
    version: jobId === 'job-1' ? 1 : 2,
    chatId: 'chat-1',
    job: {
      id: jobId,
      instanceId: `${jobId}-instance`,
      kind: 'summarize',
      status: 'running',
      attemptCount: 1,
      maxAttempts: 3,
      updatedAt: '2026-08-11T00:00:00.000Z',
    },
  }
}

describe('server memory job event fanout', () => {
  it('publishes memory job events to subscribers and stops after unsubscribe', () => {
    const seen: ServerMemoryEvent[] = []
    const unsubscribe = subscribeServerMemoryJobEvents((event) => {
      seen.push(event)
    })

    publishServerMemoryJobEvent(memoryEvent('job-1'))
    unsubscribe()
    publishServerMemoryJobEvent(memoryEvent('job-2'))

    expect(seen.map((event) => event.job.id)).toEqual(['job-1'])
  })
})
