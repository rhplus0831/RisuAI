// A4R-pluginv2 fixture (failing): a hypothetical — and forbidden — server-side
// port of the pluginV2 `editprocess` hook. Importing the browser plugin runtime
// and iterating the registry is exactly the "silent port into a server sandbox"
// the invariant exists to catch.
import { pluginV2 } from '../../../../../src/ts/plugins/plugins.svelte'

export function applyPluginEditProcess(data: string): string {
  for (const fn of pluginV2.editprocess) {
    data = (fn as unknown as (d: string) => string)(data)
  }
  return data
}
