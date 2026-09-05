import { RESOURCE_SURFACE_MANIFEST } from 'src/ts/server/resourceManifest'
import { collectionsResourceState, settingsResourceState } from 'src/ts/server/resourceState.svelte'
import type { PluginRuntimePhase } from 'src/ts/plugins/plugins.svelte'

/** The route loader owns these reads; this gate observes only display dependencies. */
export function chatDisplayDependencyStatus(
  pluginPhase: PluginRuntimePhase,
  pluginStartupFailed = false,
): 'loading' | 'ready' | 'error' {
  const statuses = RESOURCE_SURFACE_MANIFEST['runtime:chat-display'].requirements.map((requirement) => {
    switch (requirement.kind) {
      case 'settings-group':
        return settingsResourceState.groupStatuses[requirement.group]
      case 'collection':
        return collectionsResourceState.statuses[requirement.collection]
      case 'standalone-setting':
        return settingsResourceState.standaloneStatuses[requirement.setting]
    }
  })
  if (pluginPhase === 'error' || pluginStartupFailed || statuses.includes('error')) return 'error'
  return pluginPhase === 'ready' && statuses.every((status) => status === 'ready') ? 'ready' : 'loading'
}
