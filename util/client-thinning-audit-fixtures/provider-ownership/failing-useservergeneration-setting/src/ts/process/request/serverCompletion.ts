// EC1 fixture: in Fastify server mode the server owns provider dispatch. The
// browser-local route is only returned when NOT in Fastify mode; preview bodies
// and unsupported providers fail explicitly instead of falling back.

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
