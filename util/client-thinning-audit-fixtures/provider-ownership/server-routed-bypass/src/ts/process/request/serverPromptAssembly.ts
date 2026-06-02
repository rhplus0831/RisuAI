// EC1 fixture: the prompt-assembly classifier unconditionally makes the supported
// text-send subset server-mandatory. Out-of-subset sends are reported unsupported
// instead of silently assembling locally.

type Route = { type: 'local' } | { type: 'server' } | { type: 'unsupported'; reason: string }

export function resolveServerPromptAssembly(inSubset: boolean): Route {
  if (!inSubset) {
    return { type: 'unsupported', reason: 'model is not supported in Fastify server mode' }
  }
  return { type: 'server' }
}
