// A4R-provider-capability fixture (passing): the server /chat dispatcher
// consumes the shared table and declares no local capability fork.
import { resolveProviderCapability } from '../../../../src/ts/process/request/providerCapability'

export function dispatchChatProvider(format: number): string {
  const verdict = resolveProviderCapability({ format })
  if (!verdict.routable) throw new Error(verdict.reason)
  return verdict.provider
}
