// Invariant: the browser completion classifier consumes the shared capability table.
import { resolveProviderCapability } from './providerCapability'

export function resolveServerCompletionRoute(format: number) {
  const verdict = resolveProviderCapability({ format })
  return verdict.routable
    ? { type: 'server' as const, provider: verdict.provider }
    : { type: 'unsupported' as const, reason: verdict.reason }
}
