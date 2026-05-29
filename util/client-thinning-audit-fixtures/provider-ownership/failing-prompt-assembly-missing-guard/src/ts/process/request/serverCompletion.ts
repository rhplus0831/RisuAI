// EC1 fixture: the completion route is well-formed here; this fixture fails only
// on the prompt-assembly classifier missing its Fastify guard.

declare const isFastifyServer: boolean

interface RouteResult {
  type: 'local' | 'server'
}

export function resolveServerCompletionRoute(provider: string, isPreview: boolean): RouteResult {
  if (!isFastifyServer) return { type: 'local' }
  if (isPreview) {
    throw new Error('Provider preview bodies are not supported in Fastify server mode')
  }
  if (!isSupportedProvider(provider)) {
    throw new Error(`Provider ${provider} is not supported in Fastify server mode`)
  }
  return { type: 'server' }
}

function isSupportedProvider(provider: string): boolean {
  return provider === 'openai' || provider === 'anthropic'
}
