// A4R-provider-capability fixture (failing): the browser side is correct; only
// the /chat dispatcher re-forks, so the failure is attributable to chatDispatch.
import { resolveProviderCapability } from './providerCapability'

export function resolveServerCompletionRoute(format: number) {
  const verdict = resolveProviderCapability({ format })
  return verdict.routable
    ? { type: 'server' as const, provider: verdict.provider }
    : { type: 'unsupported' as const, reason: verdict.reason }
}
