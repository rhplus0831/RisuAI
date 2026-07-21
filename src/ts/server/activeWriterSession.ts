export const ACTIVE_WRITER_SESSION_HEADER = 'risu-writer-session'

// Keep the writer identity stable across same-tab reloads, including mobile notification resumes.
const ACTIVE_WRITER_SESSION_STORAGE_KEY = 'risu:active-writer-session-id'
const ACTIVE_WRITER_SESSION_ID_MAX_LENGTH = 128

let activeWriterSessionId: string | null = null
let forcedServerStateReloadScheduled = false
let writerAccessLost = false
let offlineFreezeObserver: MutationObserver | null = null

const OFFLINE_FROZEN_CLASS = 'risu-offline-frozen'
const OFFLINE_BANNER_ID = 'risu-offline-frozen-banner'
const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

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

export function isWriterAccessLost(): boolean {
  return writerAccessLost
}

export function enterWriterTakeoverFlow(): void {
  if (writerAccessLost) return
  writerAccessLost = true
  void runWriterTakeoverFlow()
}

export function handleActiveWriterStaleResponse(response: Response): boolean {
  if (response.status !== 423) return false
  enterWriterTakeoverFlow()
  return true
}

export function scheduleServerOwnershipReload(): void {
  scheduleForcedServerStateReload('stale-session')
}

/**
 * A terminally rejected durable predecessor no longer has its original live
 * rollback closure. Reload so startup can replay every surviving successor
 * before authoritative resources replace the optimistic projection.
 */
export function schedulePendingMutationRecoveryReload(): void {
  scheduleForcedServerStateReload('pending-mutation')
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

function scheduleForcedServerStateReload(reason: 'pending-mutation' | 'stale-session'): void {
  if (forcedServerStateReloadScheduled) return
  forcedServerStateReloadScheduled = true
  void notifyServerStateReload(reason)
  globalThis.setTimeout(() => {
    globalThis.location?.reload()
  }, 100)
}

async function notifyServerStateReload(reason: 'pending-mutation' | 'stale-session'): Promise<void> {
  const [{ language }, { alertError }] = await Promise.all([import('../../lang'), import('../alert')])
  alertError(reason === 'pending-mutation' ? language.pendingMutationRecoveryReload : language.reloadSession)
}

async function runWriterTakeoverFlow(): Promise<void> {
  const [bootstrap, messageTranslations, generationReattach, chatHydration, { language }, { alertRequiredSelect }] =
    await Promise.all([
      import('../bootstrap'),
      import('./messageTranslationJobs'),
      import('../process/reattach'),
      import('./chatMessageHydration.svelte'),
      import('../../lang'),
      import('../alert'),
    ])

  bootstrap.stopServerResourceEvents()
  messageTranslations.stopActiveMessageTranslationRefresh()
  generationReattach.stopActiveGenerationReattach()
  chatHydration.stopChatMessageHydration()

  const selection = await alertRequiredSelect(
    [language.writerTakeoverRefreshNow, language.writerTakeoverStayOffline],
    language.writerTakeoverBody,
    language.writerTakeoverTitle,
  )
  if (selection === '0') {
    globalThis.location?.reload()
    return
  }
  enterFrozenOfflineState({
    message: language.writerOfflineBanner,
    refresh: language.writerOfflineRefresh,
  })
}

function enterFrozenOfflineState(labels: { message: string; refresh: string }): void {
  if (typeof document === 'undefined') return
  const appRoot = document.getElementById('app')
  if (!appRoot) return

  appRoot.classList.add(OFFLINE_FROZEN_CLASS)
  freezeEditableTree(appRoot)

  let banner = document.getElementById(OFFLINE_BANNER_ID)
  if (!banner) {
    banner = document.createElement('div')
    banner.id = OFFLINE_BANNER_ID
    banner.className = 'risu-offline-banner'
    banner.setAttribute('role', 'status')
    banner.setAttribute('aria-live', 'polite')

    const message = document.createElement('span')
    message.textContent = labels.message
    banner.appendChild(message)

    const refresh = document.createElement('button')
    refresh.type = 'button'
    refresh.textContent = labels.refresh
    refresh.addEventListener('click', () => globalThis.location?.reload())
    banner.appendChild(refresh)
    document.body.appendChild(banner)
  }

  if (!offlineFreezeObserver && typeof MutationObserver !== 'undefined') {
    offlineFreezeObserver = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') {
          freezeEditableTree(record.target)
          continue
        }
        for (const node of record.addedNodes) freezeEditableTree(node)
      }
    })
    offlineFreezeObserver.observe(appRoot, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['contenteditable', 'readonly', 'type'],
    })
  }
}

function freezeEditableTree(node: Node): void {
  if (!(node instanceof Element)) return
  freezeEditableElement(node)
  for (const element of node.querySelectorAll('textarea, input, [contenteditable]')) {
    freezeEditableElement(element)
  }
}

function freezeEditableElement(element: Element): void {
  if (element instanceof HTMLTextAreaElement) {
    element.readOnly = true
  }
  if (element instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(element.type)) {
    element.readOnly = true
  }
  if (element.hasAttribute('contenteditable')) {
    element.setAttribute('contenteditable', 'false')
  }
}
