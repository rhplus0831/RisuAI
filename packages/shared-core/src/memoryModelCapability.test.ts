import { describe, expect, it } from 'vitest'
import { resolveMemoryModelCapability } from './memoryModelCapability.js'

describe('memory model capability', () => {
  it.each(['openai', 'openrouter', 'nanogpt'] as const)('accepts the %s provider', (provider) => {
    expect(resolveMemoryModelCapability({ providerCapability: { routable: true, provider } })).toEqual({
      ok: true,
      provider,
    })
  })

  it('rejects an unsupported routable provider', () => {
    expect(resolveMemoryModelCapability({ providerCapability: { routable: true, provider: 'anthropic' } })).toEqual({
      ok: false,
      error: 'summarization memory provider is not API-backed OpenAI-compatible: anthropic',
    })
  })

  it('preserves an unroutable capability reason', () => {
    expect(
      resolveMemoryModelCapability({ providerCapability: { routable: false, reason: 'config-incomplete' } }),
    ).toEqual({
      ok: false,
      error: 'summarization memory provider is not API-backed OpenAI-compatible: config-incomplete',
    })
  })
})
