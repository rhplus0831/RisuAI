import { selectedCharID } from '../stores.svelte'
import {
  mergePendingAgentPresetCharactersResource,
  mergePendingAgentPresetLoadoutsResource,
  mergePendingAgentPresetSettingsResource,
} from '../agentPresets'
import {
  mergePendingPluginCollectionResource,
  mergePendingPluginProviderResource,
  mergePendingPluginStorageResource,
} from '../pluginCommands'
import { reapplyPendingPresetProjections } from '../storage/database.svelte'
import { reapplyPendingPromptTemplateStructuralProjections } from './promptTemplateBridge.svelte'
import { setActiveGenerationJobs, triggerOpenChatGenerationReattach } from '../process/reattach'
import { applyServerChatMessagesResource, hydrateActiveChat, resetChatHydration } from './chatMessageHydration.svelte'
import {
  clearAppliedServerResourceRevision,
  clearCachedServerCommandRevision,
  peekAppliedServerResourceRevision,
  setAppliedServerResourceRevision,
  setCachedServerCommandRevision,
  type CommandEvent,
} from './commands'
import {
  applyServerCharacterLorebookResource,
  markCharacterLorebookHydrated,
  recordCanonicalCharacterLorebookScopes,
  recordCanonicalLorebookCollections,
  recordHydratedCharacterLorebooks,
  resetLorebookHydration,
} from './lorebookBridge.svelte'
import {
  getResourceDatabase as getDatabase,
  resetServerResourceRevisionFencesForDatabaseReplacement,
} from './resourceState.svelte'
import { clearActiveMessageTranslation, setActiveMessageTranslations } from './messageTranslationJobs'
import { fetchServerBootstrapReadOnly } from './bootstrap'
import { recordFullResourceRefresh } from './protocolDiagnostics'
import { ensurePromptTemplateHydrated } from './promptTemplateHydration'
import {
  refreshAllServerResources,
  refreshInvalidatedServerResources,
  type ServerResourceInvalidationHooks,
} from './resourceInvalidation'
import {
  resolveSelectedCharacterIndexAfterRefresh,
  trackSelectedCharacterDuringRefresh,
  type SelectedCharacterRefreshSnapshot,
} from './selectedCharacterRefresh'

export type ServerResourceRefreshResult =
  | { status: 'ok'; revision: number }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

let serverResourceRefreshPromise: Promise<ServerResourceRefreshResult> | null = null
let serverResourceRefreshPending = false
let serverDatabaseReplacementRefreshPending = false

export const serverResourceInvalidationHooks: ServerResourceInvalidationHooks = {
  reapplyPendingPresetProjections,
  reapplyPendingPromptTemplateStructuralProjections,
  mergePendingAgentPresetSettings: mergePendingAgentPresetSettingsResource,
  mergePendingAgentPresetLoadouts: mergePendingAgentPresetLoadoutsResource,
  mergePendingAgentPresetCharacters: mergePendingAgentPresetCharactersResource,
  mergePendingPluginCollection: mergePendingPluginCollectionResource,
  mergePendingPluginProvider: mergePendingPluginProviderResource,
  mergePendingPluginStorage: mergePendingPluginStorageResource,
  applyChatMessages: applyServerChatMessagesResource,
  applyCharacterLorebook: applyServerCharacterLorebookResource,
  markCharacterLorebookHydrated,
  recordCanonicalCharacterLorebookScopes,
  recordCanonicalLorebookCollections,
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

/** Force a full snapshot that may legitimately rewind every server revision. */
export function forceServerDatabaseReplacementRefresh(
  reason: string,
  options: { resource?: string } = {},
): Promise<ServerResourceRefreshResult> {
  serverDatabaseReplacementRefreshPending = true
  clearCachedServerCommandRevision()
  clearAppliedServerResourceRevision()
  return forceServerResourceRefresh(reason, options)
}

/**
 * Apply the character-list invalidation returned by a successful Realm import.
 * The imported character originates on the server, so it still needs one
 * authoritative character read, but unrelated settings, collections, runtime
 * jobs, and already-hydrated chat bodies do not.
 *
 * A revision gap can contain an unrelated write that must not be skipped. Keep
 * the complete-refresh fallback for that recovery case; the normal contiguous
 * response and an event already applied from SSE stay narrow.
 */
export async function refreshServerRealmImportResources(input: {
  revision: number
  event: CommandEvent
  characterId: string
}): Promise<ServerResourceRefreshResult> {
  const appliedRevision = peekAppliedServerResourceRevision()
  if (!isMatchingRealmCharacterCreatedEvent(input) || appliedRevision === null) {
    return forceServerResourceRefresh('realm-import', { resource: input.event.resource })
  }
  if (input.event.revision > appliedRevision + 1) {
    return forceServerResourceRefresh('realm-import', { resource: input.event.resource })
  }

  const selectionTracker = trackSelectedCharacterDuringRefresh()
  try {
    const result = await refreshInvalidatedServerResources(input.event, {
      appliedRevision,
      hooks: serverResourceInvalidationHooks,
    })
    if (result.status !== 'ok') return result

    if (result.scope === 'full') {
      // This is not expected for a validated, contiguous character.created
      // event, but retain full-refresh hydration semantics if the invalidation
      // planner broadens the event in the future.
      recordFullResourceRefresh('realm-import', input.event.resource)
      return completeFullServerResourceRefresh(result.revision, selectionTracker.snapshot())
    }

    if (result.scope === 'targeted') {
      // Preserve existing hydration identities. Only mark characters whose
      // character-list payload actually carried a resident lorebook.
      recordHydratedCharacterLorebooks(getDatabase().characters)
    }
    setCachedServerCommandRevision(result.revision)
    setAppliedServerResourceRevision(result.revision)
    return { status: 'ok', revision: result.revision }
  } finally {
    selectionTracker.stop()
  }
}

async function runServerResourceRefresh(): Promise<ServerResourceRefreshResult> {
  let latestResult: ServerResourceRefreshResult | null = null

  do {
    serverResourceRefreshPending = false
    if (serverDatabaseReplacementRefreshPending) {
      serverDatabaseReplacementRefreshPending = false
      // A replacement request can join an older full refresh that was already
      // reading the previous database. Reset again after that iteration drains
      // so its higher revision cannot fence out the replacement snapshot.
      clearCachedServerCommandRevision()
      clearAppliedServerResourceRevision()
      resetServerResourceRevisionFencesForDatabaseReplacement()
    }
    const selectionTracker = trackSelectedCharacterDuringRefresh()
    try {
      const result = await refreshAllServerResources({ hooks: serverResourceInvalidationHooks })
      if (result.status !== 'ok') {
        latestResult = result
        continue
      }

      latestResult = await completeFullServerResourceRefresh(result.revision, selectionTracker.snapshot())
    } finally {
      selectionTracker.stop()
    }
  } while (serverResourceRefreshPending || serverDatabaseReplacementRefreshPending)

  return latestResult ?? { status: 'error', error: 'Server resource refresh did not complete' }
}

async function completeFullServerResourceRefresh(
  revision: number,
  selection: SelectedCharacterRefreshSnapshot,
): Promise<ServerResourceRefreshResult> {
  syncSelectedCharacterAfterRefresh(selection)

  // Full character reads intentionally carry message-free chat rows. Reset
  // hydration identities before any later hydration can fail so every chat is
  // fetched again from its REST body endpoint, including same-id transcripts
  // replaced by a backup restore.
  resetChatHydration()
  resetLorebookHydration()
  recordHydratedCharacterLorebooks(getDatabase().characters)
  void hydrateActiveChat({ force: true })

  if (!(await ensurePromptTemplateHydrated({ force: true, minimumRevision: revision }))) {
    return { status: 'error', error: 'Selected prompt-template owner hydration failed' }
  }
  reapplyPendingPresetProjections()
  reapplyPendingPromptTemplateStructuralProjections()
  setCachedServerCommandRevision(revision)
  setAppliedServerResourceRevision(revision)
  await refreshRuntimeJobs()
  triggerOpenChatGenerationReattach()
  return { status: 'ok', revision }
}

function isMatchingRealmCharacterCreatedEvent(input: {
  revision: number
  event: CommandEvent
  characterId: string
}): boolean {
  return (
    Number.isInteger(input.revision) &&
    input.revision >= 0 &&
    input.event.revision === input.revision &&
    input.event.type === 'character.created' &&
    input.event.resource === 'character' &&
    input.event.id === input.characterId
  )
}

function syncSelectedCharacterAfterRefresh(selection: SelectedCharacterRefreshSnapshot): void {
  if (selection.target.selectedIndex < 0) return
  selectedCharID.set(resolveSelectedCharacterIndexAfterRefresh(selection.target))
}

async function refreshRuntimeJobs(): Promise<void> {
  const runtime = await fetchServerBootstrapReadOnly(null, { cacheRevision: false })
  if (runtime.status !== 'ok') return
  setActiveGenerationJobs(runtime.bootstrap.activeGenerationJobs ?? [])
  setActiveMessageTranslations(runtime.bootstrap.activeMessageTranslations ?? [])
}
