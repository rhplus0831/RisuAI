import type { ServerCommandTransportOptions } from './commands'
import { flushPendingServerBackedSettingsPatch } from './settingsBridge.svelte'
import { flushPendingServerBackedCharacterPatches } from './characterBridge.svelte'
import { flushPendingServerBackedLorebookPatches } from './lorebookBridge.svelte'
import { flushPendingPromptTemplatePatches } from './promptTemplateBridge.svelte'
import { flushPendingServerBackedScriptDefinitionPatches } from './scriptDefinitionBridge.svelte'
import { flushRegisteredPendingBridgePatches } from './pendingBridgeFlushRegistry'

export function flushAllPendingBridgePatches(options: ServerCommandTransportOptions = {}): void {
  flushRegisteredPendingBridgePatches(options)
  flushPendingServerBackedSettingsPatch(options)
  flushPendingServerBackedCharacterPatches(options)
  flushPendingServerBackedLorebookPatches(options)
  flushPendingPromptTemplatePatches(options)
  flushPendingServerBackedScriptDefinitionPatches(options)
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
