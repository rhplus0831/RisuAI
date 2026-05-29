// A4R-provider-capability fixture (failing): the /chat dispatcher re-forks the
// provider-routing decision locally instead of consuming the shared
// resolveProviderCapability table — exactly the drift the invariant forbids.
function resolveProvider(format: number): string | null {
  return format === 0 ? 'openai' : null
}

function unsupportedChatProviderReason(format: number): string | null {
  return format === 0 ? null : 'unsupported /chat provider: must use local dispatch'
}

export function dispatchChatProvider(format: number): string {
  const reason = unsupportedChatProviderReason(format)
  if (reason) throw new Error(reason)
  const provider = resolveProvider(format)
  if (provider === null) throw new Error('unsupported')
  return provider
}
