// EC1 fixture: the server unconditionally owns provider dispatch. Preview bodies
// and unsupported providers fail explicitly instead of falling back.

interface RouteResult {
  type: 'local' | 'server'
}

export function resolveServerCompletionRoute(provider: string, isPreview: boolean): RouteResult {
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
