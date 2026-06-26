export const ACTIVE_WRITER_SESSION_HEADER = 'risu-writer-session'

// Keep the writer identity stable across same-tab reloads, including mobile notification resumes.
const ACTIVE_WRITER_SESSION_STORAGE_KEY = 'risu:active-writer-session-id'
const ACTIVE_WRITER_SESSION_ID_MAX_LENGTH = 128

let activeWriterSessionId: string | null = null
let staleSessionReloadScheduled = false

export function getActiveWriterSessionId(): string {
  activeWriterSessionId ??= readStoredActiveWriterSessionId() ?? createSessionId()
  writeStoredActiveWriterSessionId(activeWriterSessionId)
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

function readStoredActiveWriterSessionId(): string | null {
  try {
    const sessionId = globalThis.sessionStorage?.getItem(ACTIVE_WRITER_SESSION_STORAGE_KEY)?.trim() ?? ''
    return isUsableActiveWriterSessionId(sessionId) ? sessionId : null
  } catch {
    return null
  }
}

function writeStoredActiveWriterSessionId(sessionId: string): void {
  try {
    globalThis.sessionStorage?.setItem(ACTIVE_WRITER_SESSION_STORAGE_KEY, sessionId)
  } catch {}
}

function isUsableActiveWriterSessionId(sessionId: string): boolean {
  return sessionId.length > 0 && sessionId.length <= ACTIVE_WRITER_SESSION_ID_MAX_LENGTH
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
  const [{ language }, { alertError }] = await Promise.all([import('../../lang'), import('../alert')])
  alertError(language.reloadSession)
}
