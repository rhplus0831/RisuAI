import { describe, expect, it, vi } from 'vitest'
import { createTranscriptInteractionScope, type TranscriptInteractionProvider } from './transcriptInteraction'

function providerFixture() {
  const release = vi.fn()
  const provider: TranscriptInteractionProvider = {
    reserve: vi.fn(() => release),
    subscribeAvailable: () => () => {},
  }
  return { provider, release }
}

describe('transcript interaction ownership', () => {
  it('keeps overlapping same-row work reserved until every owner settles', () => {
    const { provider, release } = providerFixture()
    const scope = createTranscriptInteractionScope(provider, () => 'message-a', vi.fn())
    const editor = scope.acquire()!
    const save = scope.acquire()!
    expect(provider.reserve).toHaveBeenCalledTimes(1)
    editor()
    editor()
    expect(release).not.toHaveBeenCalled()
    save()
    expect(release).toHaveBeenCalledTimes(1)
    const nextEdit = scope.acquire()!
    expect(provider.reserve).toHaveBeenCalledTimes(2)
    nextEdit()
    expect(release).toHaveBeenCalledTimes(2)
  })

  it('does not begin an action or notify for deferred automatic work when admission is full', async () => {
    const { provider } = providerFixture()
    vi.mocked(provider.reserve).mockReturnValue(null)
    const notify = vi.fn()
    const operation = vi.fn()
    const scope = createTranscriptInteractionScope(provider, () => 'message-a', notify)
    expect(scope.acquire(false)).toBeNull()
    expect(notify).not.toHaveBeenCalled()
    await scope.run(operation)
    expect(operation).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('retains admission across awaited work and releases after rejection', async () => {
    const { provider, release } = providerFixture()
    const scope = createTranscriptInteractionScope(provider, () => 'message-a', vi.fn())
    let reject!: (reason: Error) => void
    const work = scope.run(
      () =>
        new Promise<void>((_resolve, rejectWork) => {
          reject = rejectWork
        }),
    )
    expect(release).not.toHaveBeenCalled()
    reject(new Error('operation failed'))
    await expect(work).rejects.toThrow('operation failed')
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('releases a destroyed row once and ignores late operation settlement', () => {
    const { provider, release } = providerFixture()
    const scope = createTranscriptInteractionScope(provider, () => 'message-a', vi.fn())
    const settle = scope.acquire()!
    scope.dispose()
    scope.dispose()
    settle()
    expect(release).toHaveBeenCalledTimes(1)
    expect(scope.acquire()).toBeNull()
  })

  it('leaves greetings and non-transcript Chat consumers unrestricted', async () => {
    const { provider } = providerFixture()
    const greeting = createTranscriptInteractionScope(provider, () => null, vi.fn())
    const standalone = createTranscriptInteractionScope(undefined, () => 'message-a', vi.fn())
    expect(await greeting.run(() => 'greeting')).toBe('greeting')
    expect(await standalone.run(() => 'standalone')).toBe('standalone')
    expect(provider.reserve).not.toHaveBeenCalled()
  })
})
