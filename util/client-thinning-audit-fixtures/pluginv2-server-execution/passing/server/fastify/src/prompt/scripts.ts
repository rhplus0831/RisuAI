// Invariant: comment-only references to pluginV2 do not count as server plugin
// execution paths.
//
// Deferred (browser-only, never server-ported):
//   - runLuaEditTrigger
//   - `pluginV2[mode]` browser plugin V2 hooks
export function processScript(data: string): string {
  return data
}
