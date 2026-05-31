import type { Database } from '../storage/database.svelte'
import { applyServerProjectionDatabase } from '../storage/database.svelte'
import { setActiveGenerationJobs } from '../process/reattach'
import { fetchServerBootstrapProjectionReadOnly } from './bootstrap'
import { setCachedServerCommandRevision } from './commands'
import {
  hydrateActiveCharacterLorebook,
  hydrateActiveChat,
  resetChatHydration,
} from './chatMessageHydration.svelte'
import { recordHydratedCharacterLorebooks, resetLorebookHydration } from './lorebookBridge.svelte'
import { recordFullBootstrapResync } from './protocolDiagnostics'

export type ServerProjectionResyncResult =
  | { status: 'ok'; revision: number }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

let serverProjectionRefreshPromise: Promise<ServerProjectionResyncResult> | null = null
let serverProjectionRefreshPending = false

/** Raw projection characters before format defaults hide lorebook stubs. */
function rawProjectionCharacters(
  database: Database | undefined,
): ReadonlyArray<{ chaId?: string; globalLore?: unknown }> | undefined {
  return database?.characters as ReadonlyArray<{ chaId?: string; globalLore?: unknown }> | undefined
}

export async function forceServerProjectionResync(
  reason: string,
): Promise<ServerProjectionResyncResult> {
  recordFullBootstrapResync(reason)
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
  let applied: ServerProjectionResyncResult | null = null
  let lastFailure: ServerProjectionResyncResult | null = null

  do {
    serverProjectionRefreshPending = false
    const bootstrap = await fetchServerBootstrapProjectionReadOnly(null, { cacheRevision: false })
    if (bootstrap.status === 'ok') {
      if (bootstrap.projection.database == null) {
        const error = 'Server projection refresh returned an empty database'
        console.warn(error)
        lastFailure = { status: 'error', error }
        continue
      }
      applyServerProjectionDatabase(bootstrap.projection.database)
      setCachedServerCommandRevision(bootstrap.projection.revision)
      setActiveGenerationJobs(bootstrap.projection.activeGenerationJobs ?? [])
      // The full re-apply re-stubbed every chat; forget cached hydration and
      // re-hydrate the open chat.
      resetChatHydration()
      void hydrateActiveChat({ force: true })
      // The re-apply also re-stubs character globalLore: re-record hydrated
      // marks from the fresh raw projection, then re-hydrate the open character
      // globalLore (no-op unless stubs are on).
      resetLorebookHydration()
      recordHydratedCharacterLorebooks(rawProjectionCharacters(bootstrap.projection.database))
      void hydrateActiveCharacterLorebook({ force: true })
      applied = { status: 'ok', revision: bootstrap.projection.revision }
    } else if (bootstrap.status === 'error') {
      console.warn(`Server projection refresh failed: ${bootstrap.error}`)
      lastFailure = { status: 'error', error: bootstrap.error }
    } else {
      lastFailure = { status: 'unavailable' }
    }
  } while (serverProjectionRefreshPending)

  return (
    applied ??
    lastFailure ?? {
      status: 'error',
      error: 'Server projection refresh did not complete',
    }
  )
}
