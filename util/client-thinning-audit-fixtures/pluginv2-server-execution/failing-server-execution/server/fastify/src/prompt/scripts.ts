// Violation: the server assembler imports the browser plugin runtime and runs a
// pluginV2 edit hook.
import { pluginV2 } from '../../../../../src/ts/plugins/plugins.svelte'

export function applyPluginEditProcess(data: string): string {
  for (const fn of pluginV2.editprocess) {
    data = (fn as unknown as (d: string) => string)(data)
  }
  return data
}
