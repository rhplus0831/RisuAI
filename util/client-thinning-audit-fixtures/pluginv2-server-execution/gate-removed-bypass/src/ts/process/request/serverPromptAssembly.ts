// Violation: the classifier drops the pluginV2 detector, so pluginV2 sends can
// fall through to server assembly.
type Route = { type: 'local' } | { type: 'server' } | { type: 'unsupported'; reason: string }

export function resolveServerPromptAssembly(inSubset: boolean): Route {
  if (!inSubset) return { type: 'unsupported', reason: 'out of the supported subset' }
  return { type: 'server' }
}
