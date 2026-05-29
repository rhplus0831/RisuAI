// EC1 anti-pattern: the prompt-assembly classifier omits the Fastify guard, so a
// send is routed to the server (or could fall back to local) without the
// `!isFastifyServer` escape that pins the browser-local verdict to dev/web/test.
// The supported subset is no longer guaranteed server-mandatory.

type Route = { type: 'local' } | { type: 'server' } | { type: 'unsupported'; reason: string }

export function resolveServerPromptAssembly(inSubset: boolean): Route {
  // The Fastify-mode escape guard is absent: there is no early local return when
  // the server is not in play, so this verdict is reached unconditionally.
  if (!inSubset) return { type: 'unsupported', reason: 'out of the supported subset' }
  return { type: 'server' }
}
