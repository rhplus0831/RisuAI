// A4R-provider-capability fixture: minimal stand-in for the shared table.
export type ProviderCapabilityVerdict =
  | { routable: true; provider: string }
  | { routable: false; reason: string }

export function resolveProviderCapability(input: { format: number }): ProviderCapabilityVerdict {
  return input.format === 0
    ? { routable: true, provider: 'openai' }
    : { routable: false, reason: 'format-not-server-routable' }
}
