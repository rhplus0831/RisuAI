// Invariant: the /chat dispatcher may keep unrelated helpers while provider
// routing still comes from the shared capability table.
import { resolveProviderCapability } from '../../../../src/ts/process/request/providerCapability'

function resolveProviderModel(format: number): string {
  return `model-${format}`
}

export function dispatchChatProvider(format: number): string {
  const verdict = resolveProviderCapability({ format })
  if (!verdict.routable) throw new Error(verdict.reason)
  return `${verdict.provider}:${resolveProviderModel(format)}`
}
