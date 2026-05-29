// A4R-provider-capability fixture (bypass): the browser completion classifier
// consumes the shared table.
import { resolveProviderCapability } from './providerCapability'

export function resolveServerCompletionRoute(format: number) {
  const verdict = resolveProviderCapability({ format })
  return verdict.routable
    ? { type: 'server' as const, provider: verdict.provider }
    : { type: 'unsupported' as const, reason: verdict.reason }
}
