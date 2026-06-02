export const ACTIVE_WRITER_SESSION_HEADER = 'risu-writer-session'

let activeWriterSessionId: string | null = null
let staleSessionReloadScheduled = false

export function getActiveWriterSessionId(): string {
  activeWriterSessionId ??= createSessionId()
  return activeWriterSessionId
}

export function peekActiveWriterSessionId(): string | null {
  return activeWriterSessionId
}

export function activeWriterSessionHeader(): Record<string, string> {
  return {
    [ACTIVE_WRITER_SESSION_HEADER]: getActiveWriterSessionId(),
  }
}

export function handleActiveWriterStaleResponse(response: Response): boolean {
  if (response.status !== 423) return false
  scheduleStaleSessionReload()
  return true
}

function createSessionId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function scheduleStaleSessionReload(): void {
  if (staleSessionReloadScheduled) return
  staleSessionReloadScheduled = true
  void notifyStaleSession()
  globalThis.setTimeout(() => {
    globalThis.location?.reload()
  }, 100)
}

async function notifyStaleSession(): Promise<void> {
  const [{ language }, { alertError }] = await Promise.all([
    import('../../lang'),
    import('../alert'),
  ])
  alertError(language.reloadSession)
}
