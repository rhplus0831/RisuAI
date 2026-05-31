import { get } from 'svelte/store'
import { loadedStore, selectedCharID } from '../stores.svelte'
import { getDatabase, type Database } from '../storage/database.svelte'
import { getRerollBuffer, reroll, unReroll } from '../process/rerollNavigation.svelte'
import { activeWriterSessionHeader } from './activeWriterSession'
import { patchRuntimeSettings, runServerCommand, type ServerCommandResult } from './commands'
import { getNodeServerProxyAuth } from '../storage/nodeStorage'

declare global {
  interface Window {
    __RISU_FASTIFY_BROWSER_SMOKE__?: {
      assertDirectProjectionWriteRejected: () => boolean
      activeWriterHeaders: () => Promise<Record<string, string>>
      getDatabaseSnapshot: () => Database
      isLoaded: () => boolean
      patchRuntimeSettings: (
        patch: Record<string, unknown>,
      ) => Promise<ServerCommandResult<Record<string, unknown>>>
      waitForLoaded: (timeoutMs?: number) => Promise<void>
      // Swipe-persistence E2E: open a character (drives chat hydration), read the
      // reconstructed reroll candidates, and drive the swipe controls.
      selectCharacter: (index: number) => void
      getRerollCandidates: () => string[]
      swipeRerollBack: () => Promise<void>
      swipeRerollForward: () => Promise<void>
    }
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
        ;(getDatabase() as unknown as Record<string, unknown>).language =
          'fastify-smoke-direct-write'
      } catch {
        return true
      }
      return false
    },
    getDatabaseSnapshot: () => getDatabase({ snapshot: true }),
    isLoaded: () => get(loadedStore),
    patchRuntimeSettings: (patch) =>
      runServerCommand({
        command: (baseRevision) => patchRuntimeSettings({ baseRevision, patch }),
      }),
    waitForLoaded,
    selectCharacter: (index) => selectedCharID.set(index),
    getRerollCandidates: () =>
      getRerollBuffer().map((entry) => {
        const last = entry.at(-1) as { data?: unknown } | undefined
        return typeof last?.data === 'string' ? last.data : ''
      }),
    swipeRerollBack: () => unReroll(),
    swipeRerollForward: () => reroll({ sendChatMain: async () => {}, closeMenu: () => {} }),
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
