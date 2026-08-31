import type { ServerCommandTransportOptions } from './commands'
import { flushPendingSettingsOwnerMutations } from './settingsOwner.svelte'
import { flushPendingCharacterDraftPatches } from './characterDraft.svelte'
import { flushPendingLorebookOwnerMutations } from './lorebookOwner.svelte'
import { flushPendingPromptTemplatePatches } from './promptTemplateMutations.svelte'
import { flushPendingScriptDefinitionMutations } from './scriptDefinitionOwner.svelte'
import { flushRegisteredPendingBridgePatches } from './pendingBridgeFlushRegistry'

export function flushAllPendingBridgePatches(options: ServerCommandTransportOptions = {}): void {
  flushRegisteredPendingBridgePatches(options)
  flushPendingSettingsOwnerMutations(options)
  flushPendingCharacterDraftPatches(options)
  flushPendingLorebookOwnerMutations(options)
  flushPendingPromptTemplatePatches(options)
  flushPendingScriptDefinitionMutations(options)
}

let lifecycleListenerRefs = 0
let stopLifecycleListeners: (() => void) | null = null

export function startBridgePatchLifecycleFlush(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {}
  }

  lifecycleListenerRefs += 1
  if (!stopLifecycleListeners) {
    const flushForLifecycle = () => flushAllPendingBridgePatches({ keepalive: true })
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushForLifecycle()
    }

    window.addEventListener('pagehide', flushForLifecycle)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    stopLifecycleListeners = () => {
      window.removeEventListener('pagehide', flushForLifecycle)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }

  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    lifecycleListenerRefs -= 1
    if (lifecycleListenerRefs > 0) return
    lifecycleListenerRefs = 0
    stopLifecycleListeners?.()
    stopLifecycleListeners = null
  }
}
