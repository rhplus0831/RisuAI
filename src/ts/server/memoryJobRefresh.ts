import type { ServerMemoryJob, ServerMemoryResult } from '../process/request/serverMemory'

const DEFAULT_REFRESH_INTERVAL_MS = 5000

type TimerHandle = ReturnType<typeof setInterval>

export interface MemoryJobRefreshController {
  refresh(): Promise<void>
  setChatId(chatId: string): void
  dispose(): void
}

export interface MemoryJobRefreshControllerOptions {
  chatId: string
  intervalMs?: number
  listJobs: (
    chatId: string,
    signal?: AbortSignal | null,
    etag?: string,
  ) => Promise<ServerMemoryResult<{ jobs: ServerMemoryJob[] }>>
  onJobs(jobs: ServerMemoryJob[], loadedAt: string): void
  onError(error: string): void
  onClear(): void
  onLoading(loading: boolean): void
  now?: () => Date
}

export function hasActiveMemoryJobs(jobs: readonly Pick<ServerMemoryJob, 'status'>[]): boolean {
  return jobs.some((job) => job.status === 'pending' || job.status === 'running')
}

export function createMemoryJobRefreshController(
  options: MemoryJobRefreshControllerOptions,
): MemoryJobRefreshController {
  const intervalMs = options.intervalMs ?? DEFAULT_REFRESH_INTERVAL_MS
  const now = options.now ?? (() => new Date())
  let chatId = options.chatId
  let requestSerial = 0
  let inFlight = false
  let queued = false
  let disposed = false
  let refreshTimer: TimerHandle | null = null
  let activeController: AbortController | null = null
  let lastEtag: string | undefined
  let lastJobs: ServerMemoryJob[] = []

  function stopPolling(): void {
    if (!refreshTimer) return
    clearInterval(refreshTimer)
    refreshTimer = null
  }

  function syncPolling(jobs: readonly Pick<ServerMemoryJob, 'status'>[]): void {
    if (disposed || !chatId || !hasActiveMemoryJobs(jobs)) {
      stopPolling()
      return
    }
    if (refreshTimer) return
    refreshTimer = setInterval(() => {
      void refresh()
    }, intervalMs)
  }

  async function refresh(): Promise<void> {
    if (disposed) return
    if (!chatId) {
      requestSerial += 1
      queued = false
      lastEtag = undefined
      lastJobs = []
      activeController?.abort()
      activeController = null
      inFlight = false
      stopPolling()
      options.onLoading(false)
      options.onClear()
      return
    }

    if (inFlight) {
      queued = true
      return
    }

    const serial = ++requestSerial
    const controller = new AbortController()
    activeController = controller
    inFlight = true
    options.onLoading(true)

    try {
      const result = await options.listJobs(chatId, controller.signal, lastEtag)
      if (disposed || serial !== requestSerial) return

      if (result.status === 'ok') {
        lastEtag = result.etag
        lastJobs = result.jobs
        options.onJobs(result.jobs, now().toISOString())
        syncPolling(result.jobs)
      } else if (result.status === 'not-modified') {
        lastEtag = result.etag ?? lastEtag
        options.onJobs(lastJobs, now().toISOString())
        syncPolling(lastJobs)
      } else {
        stopPolling()
        options.onError(result.status === 'unavailable' ? 'Server memory jobs are unavailable.' : result.error)
      }
    } catch (err) {
      if (disposed || serial !== requestSerial || controller.signal.aborted) return
      stopPolling()
      const message = err instanceof Error ? err.message : String(err)
      options.onError(`Network error: ${message}`)
    } finally {
      if (serial === requestSerial) {
        activeController = null
        inFlight = false
        options.onLoading(false)
        if (queued && !disposed) {
          queued = false
          void refresh()
        }
      }
    }
  }

  function setChatId(nextChatId: string): void {
    if (nextChatId === chatId) return
    chatId = nextChatId
    requestSerial += 1
    queued = false
    lastEtag = undefined
    lastJobs = []
    activeController?.abort()
    activeController = null
    inFlight = false
    stopPolling()
    void refresh()
  }

  function dispose(): void {
    disposed = true
    queued = false
    activeController?.abort()
    activeController = null
    stopPolling()
  }

  return {
    refresh,
    setChatId,
    dispose,
  }
}
