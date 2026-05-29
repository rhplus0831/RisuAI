// A4R-pluginv2 fixture: the classifier still carries the permanent pluginV2 gate
// (imports the registry, inspects an edit set, hard-fails). The audit failure
// here comes purely from the server assembler having a plugin execution path —
// proving the negative half catches a real port even when the gate is intact.
import { pluginV2 } from '../../../plugins/plugins.svelte'

declare const isFastifyServer: boolean
type Route = { type: 'local' } | { type: 'server' } | { type: 'unsupported'; reason: string }

function hasPluginV2EditSet(): boolean {
  return pluginV2.editinput.size > 0 || pluginV2.editprocess.size > 0
}

export function resolveServerPromptAssembly(): Route {
  if (!isFastifyServer) return { type: 'local' }
  if (hasPluginV2EditSet()) {
    return { type: 'unsupported', reason: 'Plugin (V2) scripts are not supported.' }
  }
  return { type: 'server' }
}
