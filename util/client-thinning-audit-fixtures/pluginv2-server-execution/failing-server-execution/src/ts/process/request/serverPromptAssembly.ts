// Invariant: the classifier keeps the pluginV2 hard-fail gate; any failure here
// comes from the server assembler execution path.
import { pluginV2 } from '../../../plugins/plugins.svelte'

type Route = { type: 'local' } | { type: 'server' } | { type: 'unsupported'; reason: string }

function hasPluginV2EditSet(): boolean {
  return pluginV2.editinput.size > 0 || pluginV2.editprocess.size > 0
}

export function resolveServerPromptAssembly(): Route {
  if (hasPluginV2EditSet()) {
    return { type: 'unsupported', reason: 'Plugin (V2) scripts are not supported.' }
  }
  return { type: 'server' }
}
