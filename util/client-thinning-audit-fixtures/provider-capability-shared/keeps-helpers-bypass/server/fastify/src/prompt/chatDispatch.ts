// A4R-provider-capability fixture (bypass): the /chat dispatcher consumes the
// shared table AND keeps an unrelated dispatch helper whose name shares the
// `resolveProvider` prefix. The invariant must NOT flag it — only the removed
// deciders resolveProvider / unsupportedChatProviderReason are forbidden, by
// exact name — so this fixture must pass.
import { resolveProviderCapability } from '../../../../src/ts/process/request/providerCapability'

function resolveProviderModel(format: number): string {
  return `model-${format}`
}

export function dispatchChatProvider(format: number): string {
  const verdict = resolveProviderCapability({ format })
  if (!verdict.routable) throw new Error(verdict.reason)
  return `${verdict.provider}:${resolveProviderModel(format)}`
}
