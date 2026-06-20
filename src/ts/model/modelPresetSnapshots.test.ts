import { describe, expect, it } from 'vitest'
import { createModelRoleBindingPresetSnapshot } from './modelPresetSnapshots'

describe('model preset snapshots', () => {
  it('captures durable role bindings without cloning profile records or runtime defaults', () => {
    const snapshot = createModelRoleBindingPresetSnapshot(
      {
        modelProfiles: [{ id: 'profile-a', name: 'Profile A', modelId: 'gpt-5' }],
        modelRoleProfiles: {
          chatMain: { mode: 'profile', profileId: 'profile-a' },
          memory: { mode: 'inherit' },
        },
        modelRuntimeDefaults: { maxContext: 8192 },
      },
      'Story Models',
    )

    expect(snapshot).toMatchObject({
      name: 'Story Models',
      modelRoleProfiles: {
        chatMain: { mode: 'profile', profileId: 'profile-a' },
        memory: { mode: 'inherit' },
      },
    })
    expect(snapshot).not.toHaveProperty('modelProfiles')
    expect(snapshot).not.toHaveProperty('modelRuntimeDefaults')
  })

  it('normalizes absent role bindings to the legacy-compatible role map', () => {
    const snapshot = createModelRoleBindingPresetSnapshot({}, 'Legacy')

    expect(snapshot.modelRoleProfiles.chatMain).toEqual({ mode: 'legacy' })
    expect(snapshot.modelRoleProfiles.chatAux).toEqual({ mode: 'legacy' })
  })
})
