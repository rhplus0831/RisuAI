import { get, writable } from 'svelte/store'
import type { ActiveMessageTranslation } from './bootstrap'

const ACTIVE_MESSAGE_TRANSLATION_REFRESH_MS = 5_000

/**
 * Message translations still running server-side, as surfaced by bootstrap.
 * Unlike generation jobs there is no stream to reattach to; rows use this only
 * to preserve their spinner/disabled state across a page refresh.
 */
export const activeMessageTranslations = writable<ActiveMessageTranslation[]>([])

let refreshWired = false
let refreshTimer: ReturnType<typeof setTimeout> | null = null

export function setActiveMessageTranslations(jobs: readonly ActiveMessageTranslation[]): void {
  activeMessageTranslations.set([...jobs])
}

export function clearActiveMessageTranslation(messageId: string): void {
  activeMessageTranslations.update((jobs) => jobs.filter((job) => job.messageId !== messageId))
}

export function startActiveMessageTranslationRefresh(): void {
  if (refreshWired) return
  refreshWired = true
  activeMessageTranslations.subscribe(scheduleActiveMessageTranslationRefresh)
}

function scheduleActiveMessageTranslationRefresh(jobs: readonly ActiveMessageTranslation[]): void {
  if (jobs.length === 0 || refreshTimer) return
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void refreshActiveMessageTranslations()
  }, ACTIVE_MESSAGE_TRANSLATION_REFRESH_MS)
}

async function refreshActiveMessageTranslations(): Promise<void> {
  if (get(activeMessageTranslations).length === 0) return
  try {
    const { fetchServerBootstrapReadOnly } = await import('./bootstrap')
    const bootstrap = await fetchServerBootstrapReadOnly(null, { cacheRevision: false })
    if (bootstrap.status === 'ok') {
      setActiveMessageTranslations(bootstrap.bootstrap.activeMessageTranslations ?? [])
    }
  } catch (error) {
    console.warn('Message translation pending refresh failed', error)
  } finally {
    scheduleActiveMessageTranslationRefresh(get(activeMessageTranslations))
  }
}
