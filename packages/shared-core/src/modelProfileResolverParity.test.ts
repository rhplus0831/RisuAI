import { describe, expect, it } from 'vitest'
import * as browserResolver from '../../../src/ts/model/modelProfileResolver'
import * as sharedResolver from './modelProfileResolver.js'

describe('model-profile-resolver browser compatibility', () => {
  it('re-exports the shared resolver contracts and entrypoints by identity', () => {
    expect(browserResolver.FIRST_CLASS_MODEL_PROFILE_PROVIDER_IDS).toBe(
      sharedResolver.FIRST_CLASS_MODEL_PROFILE_PROVIDER_IDS,
    )
    expect(browserResolver.resolveModelProfile).toBe(sharedResolver.resolveModelProfile)
    expect(browserResolver.resolveModelProfileWithLegacyCompatibility).toBe(
      sharedResolver.resolveModelProfileWithLegacyCompatibility,
    )
    expect(browserResolver.resolveModelProfileByProfileId).toBe(sharedResolver.resolveModelProfileByProfileId)
    expect(browserResolver.resolveServerSafeModelInfo).toBe(sharedResolver.resolveServerSafeModelInfo)
    expect(browserResolver.buildProfileProviderCapabilityInput).toBe(sharedResolver.buildProfileProviderCapabilityInput)
  })
})
