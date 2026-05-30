// Violation: the /chat dispatcher forks provider routing instead of using the
// shared capability table.
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
