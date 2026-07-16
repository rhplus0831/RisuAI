export const ACTIVE_WRITER_SESSION_HEADER = 'risu-writer-session'

// Keep the writer identity stable across same-tab reloads, including mobile notification resumes.
const ACTIVE_WRITER_SESSION_STORAGE_KEY = 'risu:active-writer-session-id'
const ACTIVE_WRITER_SESSION_ID_MAX_LENGTH = 128

let activeWriterSessionId: string | null = null
let serverStateReloadScheduled = false

export function getActiveWriterSessionId(): string {
  activeWriterSessionId ??= readStoredActiveWriterSessionId() ?? createSessionId()
  writeStoredActiveWriterSessionId(activeWriterSessionId)
  return activeWriterSessionId
}

export function peekActiveWriterSessionId(): string | null {
  return activeWriterSessionId
}

/** Adopt a durable outbox owner only when neither memory nor sessionStorage has an identity. */
export function adoptPendingMutationWriterSessionId(sessionId: string): boolean {
  if (!isUsableActiveWriterSessionId(sessionId)) return false
  if (activeWriterSessionId || readStoredActiveWriterSessionId()) return false
  activeWriterSessionId = sessionId
  writeStoredActiveWriterSessionId(sessionId)
  return true
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

export function scheduleServerOwnershipReload(): void {
  scheduleServerStateReload('stale-session')
}

/**
 * A terminally rejected durable predecessor no longer has its original live
 * rollback closure. Reload so startup can replay every surviving successor
 * before authoritative resources replace the optimistic projection.
 */
export function schedulePendingMutationRecoveryReload(): void {
  scheduleServerStateReload('pending-mutation')
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
  scheduleServerStateReload('stale-session')
}

function scheduleServerStateReload(reason: 'pending-mutation' | 'stale-session'): void {
  if (serverStateReloadScheduled) return
  serverStateReloadScheduled = true
  void notifyServerStateReload(reason)
  globalThis.setTimeout(() => {
    globalThis.location?.reload()
  }, 100)
}

async function notifyServerStateReload(reason: 'pending-mutation' | 'stale-session'): Promise<void> {
  const [{ language }, { alertError }] = await Promise.all([import('../../lang'), import('../alert')])
  alertError(reason === 'pending-mutation' ? language.pendingMutationRecoveryReload : language.reloadSession)
}
