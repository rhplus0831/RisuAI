import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../platform', () => ({ isFastifyServer: true }))
vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'persistence-activity-token',
}))

import {
  clearCachedServerCommandRevision,
  runServerCommand,
  setCachedServerCommandRevision,
  setServerCommandSuccessReconciler,
  type ServerCommandResult,
} from './commands'
import {
  beginPersistenceActivity,
  PERSISTENCE_ACTIVITY_LINGER_MS,
  persistenceSavingState,
  resetPersistenceActivityForTests,
} from './persistenceActivity.svelte'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

beforeEach(() => {
  resetPersistenceActivityForTests()
  clearCachedServerCommandRevision()
  setServerCommandSuccessReconciler(null)
})

afterEach(() => {
  resetPersistenceActivityForTests()
  vi.useRealTimers()
})

describe('persistence activity', () => {
  it('is active while a tracked server mutation is in flight', async () => {
    const response = deferred<ServerCommandResult>()
    setCachedServerCommandRevision(4)

    const pending = runServerCommand({
      command: () => response.promise,
    })

    expect(persistenceSavingState.state).toBe(true)

    response.resolve({
      status: 'ok',
      revision: 5,
      event: { type: 'settings.updated', revision: 5, resource: 'settings' },
    })
    await expect(pending).resolves.toMatchObject({ status: 'ok', revision: 5 })
  })

  it('lingers after activity and merges rapid successive mutations into one indication', async () => {
    vi.useFakeTimers()
    const finishFirst = beginPersistenceActivity()

    finishFirst()
    await vi.advanceTimersByTimeAsync(PERSISTENCE_ACTIVITY_LINGER_MS - 100)
    expect(persistenceSavingState.state).toBe(true)

    const finishSecond = beginPersistenceActivity()
    await vi.advanceTimersByTimeAsync(PERSISTENCE_ACTIVITY_LINGER_MS * 2)
    expect(persistenceSavingState.state).toBe(true)

    finishSecond()
    await vi.advanceTimersByTimeAsync(PERSISTENCE_ACTIVITY_LINGER_MS - 1)
    expect(persistenceSavingState.state).toBe(true)

    await vi.advanceTimersByTimeAsync(1)
    expect(persistenceSavingState.state).toBe(false)
  })
})
