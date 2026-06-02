// EC1 anti-pattern: prompt assembly must not use the useServerPromptAssembly flag
// to route to local assembly.

declare const useServerPromptAssembly: boolean

type Route = { type: 'local' } | { type: 'server' } | { type: 'unsupported'; reason: string }

export function resolveServerPromptAssembly(inSubset: boolean): Route {
  if (!useServerPromptAssembly) return { type: 'local' }
  if (!inSubset) return { type: 'unsupported', reason: 'out of the supported subset' }
  return { type: 'server' }
}
