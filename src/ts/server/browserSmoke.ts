import { get } from 'svelte/store'
import { loadedStore } from '../stores.svelte'
import { getDatabase, type Database } from '../storage/database.svelte'
import { patchRuntimeSettings, runServerCommand, type ServerCommandResult } from './commands'

declare global {
  interface Window {
    __RISU_FASTIFY_BROWSER_SMOKE__?: {
      getDatabaseSnapshot: () => Database
      isLoaded: () => boolean
      patchRuntimeSettings: (
        patch: Record<string, unknown>,
      ) => Promise<ServerCommandResult<Record<string, unknown>>>
      waitForLoaded: (timeoutMs?: number) => Promise<void>
    }
  }
}

export function installFastifyBrowserSmokeHook() {
  window.__RISU_FASTIFY_BROWSER_SMOKE__ = {
    getDatabaseSnapshot: () => getDatabase({ snapshot: true }),
    isLoaded: () => get(loadedStore),
    patchRuntimeSettings: (patch) =>
      runServerCommand({
        command: (baseRevision) => patchRuntimeSettings({ baseRevision, patch }),
      }),
    waitForLoaded,
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
