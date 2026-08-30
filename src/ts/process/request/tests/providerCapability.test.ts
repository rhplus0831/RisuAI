import { describe, expect, it } from 'vitest'
import { LLMFormat } from '../../../model/types'
import { MASKED_PROVIDER_SECRET } from '../../../providerSecretMask'
import * as sharedCapability from '@risuai/shared-core/provider-capability'
import { formatToServerProvider, resolveProviderCapability, type ProviderCapabilityInput } from '../providerCapability'

describe('provider-capability browser compatibility facade', () => {
  it('re-exports the shared owner without wrapping the routing table', () => {
    expect(formatToServerProvider).toBe(sharedCapability.formatToServerProvider)
    expect(resolveProviderCapability).toBe(sharedCapability.resolveProviderCapability)
  })

  it('preserves masked-credential preflight behavior through the facade', () => {
    const input: ProviderCapabilityInput = {
      format: LLMFormat.AWSBedrockClaude,
      aiModel: 'anthropic.claude-3-5-sonnet',
      internalID: 'claude-3-5-sonnet',
      config: { claudeAPIKey: MASKED_PROVIDER_SECRET },
    }

    expect(resolveProviderCapability(input)).toEqual({ routable: true, provider: 'bedrock' })
  })
})
