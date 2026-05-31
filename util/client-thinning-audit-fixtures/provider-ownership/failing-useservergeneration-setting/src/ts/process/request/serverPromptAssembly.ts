// EC1 fixture: prompt assembly must not carry a Fastify flag-off branch.

declare const isFastifyServer: boolean
declare const useServerPromptAssembly: boolean

type Route = { type: 'local' } | { type: 'server' } | { type: 'unsupported'; reason: string }

export function resolveServerPromptAssembly(inSubset: boolean): Route {
  if (!isFastifyServer) return { type: 'local' }
  if (!useServerPromptAssembly) return { type: 'local' }
  if (!inSubset) return { type: 'unsupported', reason: 'out of the supported subset' }
  return { type: 'server' }
}
