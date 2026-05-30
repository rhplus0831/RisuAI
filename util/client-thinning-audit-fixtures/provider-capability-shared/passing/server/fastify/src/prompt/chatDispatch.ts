// Invariant: the server /chat dispatcher consumes the shared capability table.
import { resolveProviderCapability } from '../../../../src/ts/process/request/providerCapability'

export function dispatchChatProvider(format: number): string {
  const verdict = resolveProviderCapability({ format })
  if (!verdict.routable) throw new Error(verdict.reason)
  return verdict.provider
}
