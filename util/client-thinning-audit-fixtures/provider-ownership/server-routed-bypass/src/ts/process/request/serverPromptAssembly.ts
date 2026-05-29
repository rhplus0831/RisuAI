// EC1 fixture: in Fastify server mode the prompt-assembly classifier makes the
// supported text-send subset server-mandatory. The browser-local verdict is only
// returned when NOT in Fastify mode; out-of-subset sends are reported unsupported
// instead of silently assembling locally.

declare const isFastifyServer: boolean

type Route = { type: 'local' } | { type: 'server' } | { type: 'unsupported'; reason: string }

export function resolveServerPromptAssembly(inSubset: boolean): Route {
  if (!isFastifyServer) return { type: 'local' }
  if (!inSubset) return { type: 'unsupported', reason: 'out of the supported subset' }
  return { type: 'server' }
}
