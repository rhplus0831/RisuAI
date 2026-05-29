// A4R-pluginv2 fixture (passing): a regex-only script processor. The comment
// below names `pluginV2[mode]` exactly as the real assembler's deferral header
// does — proving the AST-based invariant ignores comment text and only flags a
// real identifier / import / sandbox node.
//
// Deferred (browser-only, never server-ported):
//   - runLuaEditTrigger
//   - `pluginV2[mode]` browser plugin V2 hooks
export function processScript(data: string): string {
  return data
}
