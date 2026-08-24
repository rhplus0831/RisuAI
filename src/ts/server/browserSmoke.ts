import { get } from 'svelte/store'
import { loadedStore, selectedCharID } from '../stores/coreStores.svelte'
import { getDatabase, type Database } from '../storage/database.svelte'
import { getRerollBuffer, reroll, unReroll } from '../process/rerollNavigation.svelte'
import { acceptedSendRecoveries } from '../process/acceptedSendRecoveryState'
import { activeChatGenerations } from '../process/generationActivity.svelte'
import { generationFinalizationPersistences } from '../process/generationPersistenceState'
import { activeGenerationJobs, generationJobLifecycles } from '../process/reattach'
import { activeWriterSessionHeader } from './activeWriterSession'
import { hydrateActiveChatFully } from './chatMessageHydration.svelte'
import { peekAppliedServerResourceRevision, type ServerCommandResult } from './commands'
import { dispatchDurableServerBackedSettingsPatch } from './settingsBridge.svelte'
import { getNodeServerProxyAuth } from '../storage/fastifyStorage'
import { alertNormal } from '../alert'
import { generationOperationCancellations, generationOperationProjections } from './generationOperations'
import { listPendingMutations } from './pendingMutationOutbox'
import {
  getStartupReadinessSnapshot,
  waitForStartupMilestone,
  type StartupMilestone,
  type StartupReadinessSnapshot,
} from '../startupReadiness'

export interface FastifyBrowserSmokeLifecycleSnapshot {
  acceptedSendRecoveries: unknown[]
  activeGenerationJobs: unknown[]
  activeChatGenerations: unknown[]
  generationFinalizations: unknown[]
  generationJobLifecycles: Record<string, unknown>
  generationOperationCancellations: unknown[]
  generationOperations: unknown[]
  outbox: Array<{
    key: string
    mutationId: string
    phase: string
    kind?: string
    requests: unknown[]
  }>
}

export interface FastifyBrowserSmokeHook {
  assertDirectProjectionWriteRejected: () => boolean
  activeWriterHeaders: () => Promise<Record<string, string>>
  getAppliedServerResourceRevision: () => number | null
  getDatabaseSnapshot: () => Database
  getLifecycleSnapshot: () => Promise<FastifyBrowserSmokeLifecycleSnapshot>
  getStartupSnapshot: () => StartupReadinessSnapshot
  isLoaded: () => boolean
  patchRuntimeSettings: (patch: Record<string, unknown>) => Promise<ServerCommandResult>
  waitForLoaded: (timeoutMs?: number) => Promise<void>
  waitForStartupMilestone: (milestone: StartupMilestone, timeoutMs?: number) => Promise<void>
  // Swipe-persistence E2E: open a character (drives chat hydration), read the
  // reconstructed reroll candidates, and drive the swipe controls.
  selectCharacter: (index: number) => void
  getRerollCandidates: () => string[]
  refreshActiveChatMessages: () => Promise<void>
  swipeRerollBack: () => Promise<void>
  swipeRerollForward: () => Promise<void>
  showAlert: (message: string) => void
}

declare global {
  interface Window {
    __RISU_FASTIFY_BROWSER_SMOKE__?: FastifyBrowserSmokeHook
  }
}

export function installFastifyBrowserSmokeHook() {
  window.__RISU_FASTIFY_BROWSER_SMOKE__ = {
    activeWriterHeaders: async () => ({
      'risu-auth': await getNodeServerProxyAuth(),
      ...activeWriterSessionHeader(),
    }),
    assertDirectProjectionWriteRejected: () => {
      try {
        ;(getDatabase() as unknown as Record<string, unknown>).language = 'fastify-smoke-direct-write'
      } catch {
        return true
      }
      return false
    },
    getAppliedServerResourceRevision: peekAppliedServerResourceRevision,
    getDatabaseSnapshot: () => getDatabase({ snapshot: true }),
    getLifecycleSnapshot: async () => ({
      acceptedSendRecoveries: structuredClone(get(acceptedSendRecoveries)),
      activeGenerationJobs: structuredClone(get(activeGenerationJobs)),
      activeChatGenerations: get(activeChatGenerations).map(({ controller: _controller, ...activity }) =>
        structuredClone(activity),
      ),
      generationFinalizations: structuredClone(get(generationFinalizationPersistences)),
      generationJobLifecycles: structuredClone(get(generationJobLifecycles)),
      generationOperationCancellations: structuredClone(get(generationOperationCancellations)),
      generationOperations: structuredClone(get(generationOperationProjections)),
      outbox: (await listPendingMutations()).map(({ handle, intent }) => ({
        key: handle.key,
        mutationId: handle.mutationId,
        phase: handle.phase,
        ...(intent.kind ? { kind: intent.kind } : {}),
        requests: structuredClone(intent.requests),
      })),
    }),
    getStartupSnapshot: getStartupReadinessSnapshot,
    isLoaded: () => get(loadedStore),
    // Ride the real durable outbox path so the request carries the mutation
    // receipt + database-lineage headers. The Journey 3 lineage-recovery gate
    // depends on this: an untagged command released after an import only gets
    // a benign revision_conflict, never the database_lineage_conflict reload.
    patchRuntimeSettings: (patch) => dispatchDurableServerBackedSettingsPatch({ patch }),
    waitForLoaded,
    waitForStartupMilestone,
    selectCharacter: (index) => selectedCharID.set(index),
    getRerollCandidates: () =>
      getRerollBuffer().map((entry) => {
        const last = entry.at(-1) as { data?: unknown } | undefined
        return typeof last?.data === 'string' ? last.data : ''
      }),
    refreshActiveChatMessages: () => hydrateActiveChatFully({ force: true }),
    swipeRerollBack: () => unReroll(),
    swipeRerollForward: () => reroll({ sendChatMain: async () => true, closeMenu: () => {} }),
    showAlert: (message) => alertNormal(message),
  }
}

function waitForLoaded(timeoutMs = 10_000): Promise<void> {
  if (get(loadedStore)) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      unsubscribe()
      reject(new Error('Timed out waiting for RisuAI to load'))
    }, timeoutMs)

    const unsubscribe = loadedStore.subscribe((loaded) => {
      if (!loaded) return
      window.clearTimeout(timeout)
      unsubscribe()
      resolve()
    })
  })
}
