import { describe, expect, it } from 'vitest'
import * as sharedCapability from '@risuai/shared-core/provider-capability'
import { formatToServerProvider, resolveProviderCapability } from '../providerCapability'

describe('provider-capability browser compatibility facade', () => {
  it('re-exports the shared owner without wrapping the routing table', () => {
    expect(formatToServerProvider).toBe(sharedCapability.formatToServerProvider)
    expect(resolveProviderCapability).toBe(sharedCapability.resolveProviderCapability)
  })
})
