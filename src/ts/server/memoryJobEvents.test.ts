import { describe, expect, it } from 'vitest'
import type { ServerMemoryEvent } from './events'
import { publishServerMemoryJobEvent, subscribeServerMemoryJobEvents } from './memoryJobEvents'

function memoryEvent(jobId: string): ServerMemoryEvent {
  return {
    type: 'memory.job',
    chatId: 'chat-1',
    job: {
      id: jobId,
      kind: 'summarize',
      status: 'running',
      attemptCount: 1,
      maxAttempts: 3,
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
