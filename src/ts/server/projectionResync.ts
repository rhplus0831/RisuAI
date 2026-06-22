import type { Database } from '../storage/database.svelte'
import { applyServerProjectionDatabase } from '../storage/database.svelte'
import { setActiveGenerationJobs, triggerOpenChatGenerationReattach } from '../process/reattach'
import { setActiveMessageTranslations } from './messageTranslationJobs'
import { get } from 'svelte/store'
import { selectedCharID } from '../stores.svelte'
import { fetchServerBootstrapProjectionReadOnly } from './bootstrap'
import { hydrateSelectedCharacterShell } from './characterShellHydration.svelte'
import { setCachedServerCommandRevision } from './commands'
import { hydrateActiveCharacterLorebook, hydrateActiveChat, resetChatHydration } from './chatMessageHydration.svelte'
import { recordHydratedCharacterLorebooks, resetLorebookHydration } from './lorebookBridge.svelte'
import { resetPromptTemplateHydration, startPromptTemplateHydration } from './promptTemplateHydration'
import { recordFullBootstrapResync } from './protocolDiagnostics'

export type ServerProjectionResyncResult =
  | { status: 'ok'; revision: number }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

let serverProjectionRefreshPromise: Promise<ServerProjectionResyncResult> | null = null
let serverProjectionRefreshPending = false
let latestServerProjectionRefreshRequestId = 0

/** Raw projection characters before format defaults hide lorebook stubs. */
function rawProjectionCharacters(
  database: Database | undefined,
): ReadonlyArray<{ chaId?: string; globalLore?: unknown }> | undefined {
  return database?.characters as ReadonlyArray<{ chaId?: string; globalLore?: unknown }> | undefined
}

function selectedCharFromDatabase(db: Database): number {
  const currentChar = (db as { currentChar?: unknown }).currentChar
  const characterCount = Array.isArray(db.characters) ? db.characters.length : 0
  if (Number.isInteger(currentChar) && (currentChar as number) >= 0 && (currentChar as number) < characterCount) {
    return currentChar as number
  }
  return -1
}

function syncSelectedCharacterAfterResync(db: Database): void {
  if (get(selectedCharID) < 0) return
  selectedCharID.set(selectedCharFromDatabase(db))
}

export async function forceServerProjectionResync(
  reason: string,
  options: { resource?: string } = {},
): Promise<ServerProjectionResyncResult> {
  latestServerProjectionRefreshRequestId += 1
  recordFullBootstrapResync(reason, options.resource)
  if (serverProjectionRefreshPromise) {
    serverProjectionRefreshPending = true
    return serverProjectionRefreshPromise
  }

  serverProjectionRefreshPromise = runServerProjectionResync()
  try {
    return await serverProjectionRefreshPromise
  } finally {
    serverProjectionRefreshPromise = null
  }
}

async function runServerProjectionResync(): Promise<ServerProjectionResyncResult> {
  let latestResult: ServerProjectionResyncResult | null = null

  do {
    serverProjectionRefreshPending = false
    const requestId = latestServerProjectionRefreshRequestId
    const bootstrap = await fetchServerBootstrapProjectionReadOnly(null, { cacheRevision: false })
    if (requestId !== latestServerProjectionRefreshRequestId) {
      continue
    }
    if (bootstrap.status === 'ok') {
      if (bootstrap.projection.database == null) {
        const error = 'Server projection refresh returned an empty database'
        console.warn(error)
        latestResult = { status: 'error', error }
        continue
      }
      applyServerProjectionDatabase(bootstrap.projection.database)
      resetPromptTemplateHydration()
      syncSelectedCharacterAfterResync(bootstrap.projection.database)
      setCachedServerCommandRevision(bootstrap.projection.revision)
      setActiveGenerationJobs(bootstrap.projection.activeGenerationJobs ?? [])
      setActiveMessageTranslations(bootstrap.projection.activeMessageTranslations ?? [])
      triggerOpenChatGenerationReattach()
      // The full re-apply re-stubbed every chat; forget cached hydration and
      // re-hydrate the open chat.
      resetChatHydration()
      // The re-apply also re-stubs character globalLore: re-record hydrated
      // marks from the fresh raw projection, then re-hydrate the open character
      // globalLore (no-op unless stubs are on).
      resetLorebookHydration()
      recordHydratedCharacterLorebooks(rawProjectionCharacters(bootstrap.projection.database))
      await hydrateSelectedCharacterShell()
      void hydrateActiveChat({ force: true })
      void hydrateActiveCharacterLorebook({ force: true })
      startPromptTemplateHydration()
      latestResult = { status: 'ok', revision: bootstrap.projection.revision }
    } else if (bootstrap.status === 'error') {
      console.warn(`Server projection refresh failed: ${bootstrap.error}`)
      latestResult = { status: 'error', error: bootstrap.error }
    } else {
      latestResult = { status: 'unavailable' }
    }
  } while (serverProjectionRefreshPending)

  return (
    latestResult ?? {
      status: 'error',
      error: 'Server projection refresh did not complete',
    }
  )
}
