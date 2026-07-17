import { describe, expect, it, vi } from 'vitest'
import { MessageTranslationJobRegistry } from '../src/messageTranslationJobs.js'

describe('MessageTranslationJobRegistry', () => {
  it('keeps the same job id from running through terminal success', () => {
    const registry = new MessageTranslationJobRegistry()
    const job = registry.register({ chatId: 'chat-a', messageId: 'message-a' })

    expect(registry.translations()).toEqual([
      {
        chatId: 'chat-a',
        messageId: 'message-a',
        jobId: job.jobId,
        status: 'running',
      },
    ])

    job.succeed()

    expect(registry.translations()).toEqual([
      {
        chatId: 'chat-a',
        messageId: 'message-a',
        jobId: job.jobId,
        status: 'succeeded',
        completedAt: expect.any(Number),
      },
    ])
  })

  it('retains a safe bounded failure message', () => {
    const registry = new MessageTranslationJobRegistry()
    const job = registry.register({ chatId: 'chat-a', messageId: 'message-a' })

    job.fail(new Error(`Bearer secret-token sk-test_123456789 ${'x'.repeat(600)}`))

    const [failure] = registry.translations()
    expect(failure).toMatchObject({
      chatId: 'chat-a',
      messageId: 'message-a',
      jobId: job.jobId,
      status: 'failed',
      completedAt: expect.any(Number),
    })
    expect(failure.error).not.toContain('secret-token')
    expect(failure.error).not.toContain('sk-test_123456789')
    expect(failure.error?.length).toBeLessThanOrEqual(500)
  })

  it('does not let an older attempt complete a newer job for the same message', () => {
    const registry = new MessageTranslationJobRegistry()
    const older = registry.register({ chatId: 'chat-a', messageId: 'message-a' })
    const newer = registry.register({ chatId: 'chat-a', messageId: 'message-a' })

    older.fail(new Error('stale failure'))

    expect(registry.translations()).toEqual([
      {
        chatId: 'chat-a',
        messageId: 'message-a',
        jobId: newer.jobId,
        status: 'running',
      },
    ])
  })

  it('expires terminal outcomes after the retention window', () => {
    vi.useFakeTimers()
    try {
      const registry = new MessageTranslationJobRegistry()
      const job = registry.register({ chatId: 'chat-a', messageId: 'message-a' })
      job.succeed()

      vi.advanceTimersByTime(10 * 60_000 + 1)

      expect(registry.translations()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})
