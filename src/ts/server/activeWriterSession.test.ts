import { afterEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'risu:active-writer-session-id'
const reloadNotice = vi.hoisted(() => ({ alertError: vi.fn() }))

vi.mock('../alert', () => ({ alertError: reloadNotice.alertError }))
vi.mock('../../lang', () => ({
  language: {
    pendingMutationRecoveryReload: 'pending mutation recovery',
    reloadSession: 'stale writer recovery',
  },
}))

function stubSessionStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
  } as unknown as Storage
  vi.stubGlobal('sessionStorage', storage)
  return { storage, values }
}

function stubCryptoSessionId(sessionId: string) {
  vi.stubGlobal('crypto', {
    randomUUID: vi.fn(() => sessionId),
  })
}

async function importActiveWriterSession() {
  vi.resetModules()
  return await import('./activeWriterSession')
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
  reloadNotice.alertError.mockReset()
})

describe('active writer browser session', () => {
  it('stores the generated writer session and reuses it after a same-tab reload', async () => {
    const { values } = stubSessionStorage()
    stubCryptoSessionId('writer-from-crypto')

    let activeWriterSession = await importActiveWriterSession()
    expect(activeWriterSession.peekActiveWriterSessionId()).toBeNull()
    expect(activeWriterSession.getActiveWriterSessionId()).toBe('writer-from-crypto')
    expect(values.get(STORAGE_KEY)).toBe('writer-from-crypto')

    activeWriterSession = await importActiveWriterSession()
    expect(activeWriterSession.peekActiveWriterSessionId()).toBeNull()
    expect(activeWriterSession.getActiveWriterSessionId()).toBe('writer-from-crypto')
  })

  it('ignores invalid stored writer session IDs', async () => {
    const { values } = stubSessionStorage({ [STORAGE_KEY]: 'x'.repeat(129) })
    stubCryptoSessionId('replacement-writer')

    const activeWriterSession = await importActiveWriterSession()

    expect(activeWriterSession.getActiveWriterSessionId()).toBe('replacement-writer')
    expect(values.get(STORAGE_KEY)).toBe('replacement-writer')
  })

  it('keeps generating a writer session when sessionStorage is unavailable', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn(() => {
        throw new Error('storage blocked')
      }),
      setItem: vi.fn(() => {
        throw new Error('storage blocked')
      }),
    })
    stubCryptoSessionId('storage-blocked-writer')

    const activeWriterSession = await importActiveWriterSession()

    expect(activeWriterSession.getActiveWriterSessionId()).toBe('storage-blocked-writer')
  })

  it('notifies once and reloads when a terminal durable predecessor loses its rollback', async () => {
    vi.useFakeTimers()
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    const activeWriterSession = await importActiveWriterSession()

    activeWriterSession.schedulePendingMutationRecoveryReload()
    activeWriterSession.scheduleServerOwnershipReload()
    await vi.advanceTimersByTimeAsync(100)

    expect(reloadNotice.alertError).toHaveBeenCalledOnce()
    expect(reloadNotice.alertError).toHaveBeenCalledWith('pending mutation recovery')
    expect(reload).toHaveBeenCalledOnce()
  })
})
