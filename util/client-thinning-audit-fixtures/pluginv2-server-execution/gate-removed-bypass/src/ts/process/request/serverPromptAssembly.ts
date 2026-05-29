// A4R-pluginv2 fixture (bypass): the server assembler is clean, but a "sincere
// simplification" dropped the pluginV2 detector from the classifier — no registry
// import, no edit-set inspection. With the gate gone, a pluginV2 send would fall
// through to server assembly. The positive half of the invariant must catch this.
declare const isFastifyServer: boolean
type Route = { type: 'local' } | { type: 'server' } | { type: 'unsupported'; reason: string }

export function resolveServerPromptAssembly(inSubset: boolean): Route {
  if (!isFastifyServer) return { type: 'local' }
  if (!inSubset) return { type: 'unsupported', reason: 'out of the supported subset' }
  return { type: 'server' }
}
