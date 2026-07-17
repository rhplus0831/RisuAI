import type { ResolvedModelProfile } from './modelProfileResolver'

export type MemorySummaryProvider = 'openai' | 'openrouter' | 'nanogpt'

export type MemoryModelCapability = { ok: true; provider: MemorySummaryProvider } | { ok: false; error: string }

export function resolveMemoryModelCapability(
  profile: Pick<ResolvedModelProfile, 'providerCapability'>,
): MemoryModelCapability {
  const capability = profile.providerCapability
  if (capability.routable === false) {
    return {
      ok: false,
      error: `summarization memory provider is not API-backed OpenAI-compatible: ${capability.reason}`,
    }
  }

  if (capability.provider === 'openai' || capability.provider === 'openrouter' || capability.provider === 'nanogpt') {
    return { ok: true, provider: capability.provider }
  }

  return {
    ok: false,
    error: `summarization memory provider is not API-backed OpenAI-compatible: ${capability.provider}`,
  }
}
