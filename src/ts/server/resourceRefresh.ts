import { get } from 'svelte/store'
import { selectedCharID } from '../stores.svelte'
import { mergePendingPluginStorageProjection } from '../pluginCommands'
import { setActiveGenerationJobs, triggerOpenChatGenerationReattach } from '../process/reattach'
import { applyServerChatMessagesProjection, hydrateActiveChat, resetChatHydration } from './chatMessageHydration.svelte'
import { setAppliedServerProjectionRevision, setCachedServerCommandRevision } from './commands'
import {
  applyServerCharacterLorebookResource,
  markCharacterLorebookHydrated,
  recordHydratedCharacterLorebooks,
  resetLorebookHydration,
} from './lorebookBridge.svelte'
import { getResourceDatabase as getDatabase } from './resourceState.svelte'
import { clearActiveMessageTranslation, setActiveMessageTranslations } from './messageTranslationJobs'
import { fetchServerBootstrapReadOnly } from './bootstrap'
import { recordFullResourceRefresh } from './protocolDiagnostics'
import { refreshAllServerResources, type ServerResourceInvalidationHooks } from './resourceInvalidation'

export type ServerResourceRefreshResult =
  | { status: 'ok'; revision: number }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

let serverResourceRefreshPromise: Promise<ServerResourceRefreshResult> | null = null
let serverResourceRefreshPending = false

export const serverResourceInvalidationHooks: ServerResourceInvalidationHooks = {
  mergePendingPluginStorage: mergePendingPluginStorageProjection,
  applyChatMessages: applyServerChatMessagesProjection,
  applyCharacterLorebook: applyServerCharacterLorebookResource,
  markCharacterLorebookHydrated,
  triggerOpenChatGenerationReattach,
  clearActiveMessageTranslation,
}

/**
 * Coalesced, authoritative refresh used after restores, replay gaps, and other
 * cases where a narrow command-event invalidation is not safe.
 */
export async function forceServerResourceRefresh(
  reason: string,
  options: { resource?: string } = {},
): Promise<ServerResourceRefreshResult> {
  recordFullResourceRefresh(reason, options.resource)
  if (serverResourceRefreshPromise) {
    serverResourceRefreshPending = true
    return serverResourceRefreshPromise
  }

  serverResourceRefreshPromise = runServerResourceRefresh()
  try {
    return await serverResourceRefreshPromise
  } finally {
    serverResourceRefreshPromise = null
  }
}

async function runServerResourceRefresh(): Promise<ServerResourceRefreshResult> {
  let latestResult: ServerResourceRefreshResult | null = null

  do {
    serverResourceRefreshPending = false
    const selectedIndex = get(selectedCharID)
    const selectedCharacterId = selectedIndex >= 0 ? getDatabase().characters?.[selectedIndex]?.chaId : undefined
    const result = await refreshAllServerResources({ hooks: serverResourceInvalidationHooks })
    if (result.status !== 'ok') {
      latestResult = result
      continue
    }

    syncSelectedCharacterAfterRefresh(selectedIndex, selectedCharacterId)
    setCachedServerCommandRevision(result.revision)
    setAppliedServerProjectionRevision(result.revision)

    // Full character reads intentionally carry message-free chat rows. Reset
    // hydration identities so every chat is fetched again from its REST body
    // endpoint, including same-id transcripts replaced by a backup restore.
    resetChatHydration()
    resetLorebookHydration()
    recordHydratedCharacterLorebooks(getDatabase().characters)
    void hydrateActiveChat({ force: true })
    triggerOpenChatGenerationReattach()
    await refreshRuntimeJobs()
    latestResult = { status: 'ok', revision: result.revision }
  } while (serverResourceRefreshPending)

  return latestResult ?? { status: 'error', error: 'Server resource refresh did not complete' }
}

function syncSelectedCharacterAfterRefresh(previousIndex: number, previousCharacterId: string | undefined): void {
  if (previousIndex < 0) return
  const database = getDatabase()
  const preservedIndex = previousCharacterId
    ? database.characters.findIndex((character) => character?.chaId === previousCharacterId)
    : -1
  selectedCharID.set(preservedIndex >= 0 ? preservedIndex : selectedCharFromDatabase())
}

function selectedCharFromDatabase(): number {
  const database = getDatabase()
  const currentChar = (database as { currentChar?: unknown }).currentChar
  return Number.isInteger(currentChar) &&
    (currentChar as number) >= 0 &&
    (currentChar as number) < database.characters.length
    ? (currentChar as number)
    : -1
}

async function refreshRuntimeJobs(): Promise<void> {
  const runtime = await fetchServerBootstrapReadOnly(null, { cacheRevision: false })
  if (runtime.status !== 'ok') return
  setActiveGenerationJobs(runtime.bootstrap.activeGenerationJobs ?? [])
  setActiveMessageTranslations(runtime.bootstrap.activeMessageTranslations ?? [])
}
