import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MASKED_PROVIDER_SECRET } from '../providerSecretMask'
import { resolveModelProfile } from './modelProfileResolver'
import { canonicalModelProfileFixture } from '../../../test/fixtures/canonicalModelProfile'

const mutationMocks = vi.hoisted(() => ({
  commandCalls: [] as Array<{ name: string; input: Record<string, unknown> }>,
  dispatchThrows: false,
  result: { status: 'ok' } as Record<string, unknown>,
  retained: false,
  runInputs: [] as Array<Record<string, unknown>>,
  settlementListeners: new Map<string, (settlement: 'accepted' | 'discarded') => void>(),
  stageThrows: false,
  staged: [] as Array<{ key: string; intent: unknown }>,
}))

vi.mock('../server/pendingMutationOutbox', () => ({
  stagePendingMutation: (key: string, intent: unknown) => {
    if (mutationMocks.stageThrows) throw new Error('stage failed')
    mutationMocks.staged.push({ key, intent })
    return {
      key,
      mutationId: `mutation-${mutationMocks.staged.length}`,
      databaseLineage: 'database-models',
      ready: Promise.resolve('persisted'),
    }
  },
  isPendingMutationCurrent: vi.fn(async () => mutationMocks.retained),
}))

vi.mock('../server/durableMutationDispatch', () => ({
  dispatchDurableMutation: vi.fn(
    async (_handle: unknown, _intent: unknown, dispatch: (transport: Record<string, unknown>) => Promise<unknown>) => {
      if (mutationMocks.dispatchThrows) throw new Error('dispatch failed')
      return dispatch({ mutationId: 'mutation-id', databaseLineage: 'database-models' })
    },
  ),
  registerDurableMutationSettlementListener: vi.fn(
    (mutationId: string, listener: (settlement: 'accepted' | 'discarded') => void) => {
      mutationMocks.settlementListeners.set(mutationId, listener)
      return () => mutationMocks.settlementListeners.delete(mutationId)
    },
  ),
}))

vi.mock('../server/commands', () => {
  const command = (name: string) => async (input: Record<string, unknown>) => {
    mutationMocks.commandCalls.push({ name, input })
    return mutationMocks.result
  }
  return {
    convertLegacyModelProfilesCommand: command('convert'),
    createModelProfileCommand: command('create'),
    createProviderCredentialCommand: command('credential-create'),
    deleteModelProfileCommand: command('delete'),
    deleteProviderCredentialCommand: command('credential-delete'),
    duplicateModelProfileCommand: command('duplicate'),
    reorderModelProfilesCommand: command('reorder'),
    updateModelProfileCommand: command('update'),
    updateModelRoleProfilesCommand: command('roles'),
    updateModelRuntimeDefaultsCommand: command('runtime'),
    updateProviderCredentialCommand: command('credential-update'),
    runServerCommand: async (input: Record<string, unknown>) => {
      mutationMocks.runInputs.push(input)
      return (input.command as (baseRevision: number) => Promise<unknown>)(41)
    },
  }
})

import {
  beginPendingModelMutation,
  convertLegacyModelProfilesDurably,
  createModelProfileDurably,
  createProviderCredentialDurably,
  deleteModelProfileDurably,
  deleteProviderCredentialDurably,
  duplicateModelProfileDurably,
  finishPendingModelMutation,
  getPendingModelMutations,
  isPendingModelMutationProjectionApplied,
  modelProfileProjectionFingerprint,
  providerCredentialProjectionFingerprint,
  retainPendingModelMutation,
  reorderModelProfilesDurably,
  subscribePendingModelMutations,
  updateModelProfileDurably,
  updateModelRoleProfilesDurably,
  updateModelRuntimeDefaultsDurably,
  updateProviderCredentialDurably,
} from './modelProfileMutations'

beforeEach(() => {
  for (const lane of ['model-profiles', 'model-runtime-defaults', 'provider-credentials'] as const) {
    for (const pending of getPendingModelMutations(lane)) finishPendingModelMutation(pending.token)
  }
  mutationMocks.commandCalls.length = 0
  mutationMocks.dispatchThrows = false
  mutationMocks.result = { status: 'ok' }
  mutationMocks.retained = false
  mutationMocks.runInputs.length = 0
  mutationMocks.settlementListeners.clear()
  mutationMocks.stageThrows = false
  mutationMocks.staged.length = 0
})

describe('durable model-profile mutations', () => {
  it('creates a canonical credential, profile, and role binding that survives a masked reload projection', async () => {
    const { credential, profile, bindings, staleFlat } = canonicalModelProfileFixture

    await createProviderCredentialDurably(credential)
    await createModelProfileDurably(profile)
    await updateModelRoleProfilesDurably(bindings)

    expect(mutationMocks.commandCalls.map(({ name }) => name)).toEqual(['credential-create', 'create', 'roles'])
    expect(mutationMocks.commandCalls[0]?.input.credential).toEqual(credential)
    expect(mutationMocks.commandCalls[1]?.input.profile).toEqual(profile)
    expect(mutationMocks.commandCalls[2]?.input.bindings).toEqual(bindings)

    const maskedProjection = {
      modelProfiles: [profile],
      providerCredentials: [{ ...credential, apiKey: MASKED_PROVIDER_SECRET }],
      modelRoleProfiles: bindings,
    }
    const resolved = resolveModelProfile({
      database: {
        ...staleFlat,
        ...maskedProjection,
      } as never,
      role: 'memory',
    })

    expect(resolved.source.kind).toBe('durable-profile')
    expect(resolved.modelId).toBe(profile.modelId)
    expect(resolved.requestModel).toBe(profile.providerOptions.requestModel)
    const serializedClientProjection = JSON.stringify(maskedProjection)
    expect(serializedClientProjection).not.toContain(credential.apiKey)
    expect(serializedClientProjection).not.toContain(staleFlat.openAIKey)
  })

  it('freezes and dispatches a durable profile reorder', async () => {
    const order = [
      { kind: 'profile' as const, profileId: 'profile-b' },
      { kind: 'divider' as const, id: 'divider-a' },
      { kind: 'profile' as const, profileId: 'profile-a' },
    ]

    await reorderModelProfilesDurably(order)
    order.reverse()

    expect(mutationMocks.staged).toEqual([
      {
        key: 'model-profiles',
        intent: {
          version: 1,
          requests: [
            {
              method: 'POST',
              path: '/model-profiles/reorder',
              body: {
                order: [
                  { kind: 'profile', profileId: 'profile-b' },
                  { kind: 'divider', id: 'divider-a' },
                  { kind: 'profile', profileId: 'profile-a' },
                ],
              },
            },
          ],
        },
      },
    ])
    expect(mutationMocks.commandCalls).toEqual([
      {
        name: 'reorder',
        input: {
          baseRevision: 41,
          order: [
            { kind: 'profile', profileId: 'profile-b' },
            { kind: 'divider', id: 'divider-a' },
            { kind: 'profile', profileId: 'profile-a' },
          ],
        },
      },
    ])
  })

  it('freezes every replay body and dispatches the matching command', async () => {
    const profile = { id: 'profile-a', name: 'Profile A', providerOptions: { credentialId: 'credential-a' } }
    const expectedProfile = { ...profile, name: 'Old Profile' }
    const credential = { id: 'credential-a', name: 'Credential A', type: 'apiKey' as const, apiKey: 'secret' }
    const expectedCredential = { ...credential, name: 'Old Credential' }
    const reassignments = { chatMain: { mode: 'legacy' as const } }
    const bindings = { chatMain: { mode: 'profile' as const, profileId: 'profile-a' } }

    await createModelProfileDurably(profile)
    await updateModelProfileDurably('profile/a', profile, expectedProfile)
    await duplicateModelProfileDurably('profile/a', 'Profile A Copy')
    await deleteModelProfileDurably('profile/a', reassignments)
    await createProviderCredentialDurably(credential)
    await updateProviderCredentialDurably('credential/a', credential, expectedCredential)
    await deleteProviderCredentialDurably('credential/a')
    await updateModelRuntimeDefaultsDurably({ maxContext: 8192 })
    await updateModelRoleProfilesDurably(bindings, 'preset-a')
    await convertLegacyModelProfilesDurably()

    expect(mutationMocks.staged).toEqual([
      {
        key: 'model-profiles',
        intent: {
          version: 1,
          requests: [{ method: 'POST', path: '/model-profiles', body: { profile } }],
        },
      },
      {
        key: 'model-profiles',
        intent: {
          version: 1,
          requests: [
            {
              method: 'PATCH',
              path: '/model-profiles/profile%2Fa',
              body: { profile, expectedProfile },
            },
          ],
        },
      },
      {
        key: 'model-profiles',
        intent: {
          version: 1,
          requests: [
            {
              method: 'POST',
              path: '/model-profiles/profile%2Fa/duplicate',
              body: { name: 'Profile A Copy' },
            },
          ],
        },
      },
      {
        key: 'model-profiles',
        intent: {
          version: 1,
          requests: [
            {
              method: 'DELETE',
              path: '/model-profiles/profile%2Fa',
              body: { reassignments },
            },
          ],
        },
      },
      {
        key: 'provider-credentials',
        intent: {
          version: 1,
          requests: [{ method: 'POST', path: '/provider-credentials', body: { credential } }],
        },
      },
      {
        key: 'provider-credentials',
        intent: {
          version: 1,
          requests: [
            {
              method: 'PATCH',
              path: '/provider-credentials/credential%2Fa',
              body: { credential, expectedCredential },
            },
          ],
        },
      },
      {
        key: 'provider-credentials',
        intent: {
          version: 1,
          requests: [{ method: 'DELETE', path: '/provider-credentials/credential%2Fa', body: {} }],
        },
      },
      {
        key: 'model-runtime-defaults',
        intent: {
          version: 1,
          requests: [
            {
              method: 'PUT',
              path: '/model-runtime-defaults',
              body: { runtimeDefaults: { maxContext: 8192 } },
            },
          ],
        },
      },
      {
        key: 'model-profiles',
        intent: {
          version: 1,
          requests: [
            {
              method: 'PUT',
              path: '/model-role-profiles',
              body: { bindings, modelPresetId: 'preset-a' },
            },
          ],
        },
      },
      {
        key: 'model-profiles',
        intent: {
          version: 1,
          requests: [{ method: 'POST', path: '/model-profiles/convert-legacy', body: {} }],
        },
      },
    ])
    expect(mutationMocks.commandCalls).toEqual([
      { name: 'create', input: { baseRevision: 41, profile } },
      {
        name: 'update',
        input: { baseRevision: 41, profileId: 'profile/a', profile, expectedProfile },
      },
      {
        name: 'duplicate',
        input: {
          baseRevision: 41,
          profileId: 'profile/a',
          name: 'Profile A Copy',
        },
      },
      {
        name: 'delete',
        input: { baseRevision: 41, profileId: 'profile/a', reassignments },
      },
      { name: 'credential-create', input: { baseRevision: 41, credential } },
      {
        name: 'credential-update',
        input: { baseRevision: 41, credentialId: 'credential/a', credential, expectedCredential },
      },
      { name: 'credential-delete', input: { baseRevision: 41, credentialId: 'credential/a' } },
      { name: 'runtime', input: { baseRevision: 41, runtimeDefaults: { maxContext: 8192 } } },
      {
        name: 'roles',
        input: { baseRevision: 41, bindings, modelPresetId: 'preset-a' },
      },
      { name: 'convert', input: { baseRevision: 41 } },
    ])
    expect(mutationMocks.runInputs).toHaveLength(10)
    expect(mutationMocks.runInputs.every((input) => input.mutationId === 'mutation-id')).toBe(true)
  })

  it('distinguishes retained retries from terminal failures and accepted writes', async () => {
    await expect(updateModelRuntimeDefaultsDurably({ maxContext: 4096 })).resolves.toMatchObject({
      status: 'accepted',
    })

    mutationMocks.result = { status: 'unavailable' }
    mutationMocks.retained = true
    await expect(updateModelRuntimeDefaultsDurably({ maxContext: 8192 })).resolves.toEqual({
      status: 'queued',
      result: { status: 'unavailable' },
      mutationId: 'mutation-2',
    })

    mutationMocks.retained = false
    await expect(updateModelRuntimeDefaultsDurably({ maxContext: 16384 })).resolves.toEqual({
      status: 'failed',
      result: { status: 'unavailable' },
    })

    mutationMocks.dispatchThrows = true
    mutationMocks.retained = true
    await expect(updateModelRuntimeDefaultsDurably({ maxContext: 32768 })).resolves.toEqual({
      status: 'queued',
      result: { status: 'unavailable' },
      mutationId: 'mutation-4',
    })
  })

  it('turns staging and input-freezing exceptions into retryable terminal outcomes', async () => {
    mutationMocks.stageThrows = true
    await expect(updateModelRuntimeDefaultsDurably({ maxContext: 8192 })).resolves.toEqual({
      status: 'failed',
      result: { status: 'unavailable' },
    })

    const circular: any = { name: 'Circular' }
    circular.self = circular
    await expect(createModelProfileDurably(circular)).resolves.toEqual({
      status: 'failed',
      result: { status: 'unavailable' },
    })
  })

  it('shares one synchronous lane reservation across remount subscribers until settlement or projection', () => {
    const snapshots: string[][] = []
    const unsubscribe = subscribePendingModelMutations('model-profiles', (pending) => {
      snapshots.push(pending.map((entry) => entry.phase))
    })
    const token = beginPendingModelMutation('model-profiles', {
      kind: 'profile-create',
      baselineIds: ['profile-a'],
      attemptedFingerprint: 'attempt',
    })
    expect(token).toBeTypeOf('string')
    expect(
      beginPendingModelMutation('model-profiles', {
        kind: 'profile-delete',
        profileId: 'profile-a',
      }),
    ).toBeNull()

    retainPendingModelMutation(token!, 'mutation-remount')
    expect(getPendingModelMutations('model-profiles')).toMatchObject([
      { token, mutationId: 'mutation-remount', phase: 'queued' },
    ])
    mutationMocks.settlementListeners.get('mutation-remount')?.('accepted')
    expect(getPendingModelMutations('model-profiles')[0]?.phase).toBe('accepted-replay')

    finishPendingModelMutation(token!)
    expect(getPendingModelMutations('model-profiles')).toEqual([])
    expect(snapshots).toEqual([[], ['dispatching'], ['queued'], ['accepted-replay'], []])
    unsubscribe()

    const discardedToken = beginPendingModelMutation('model-profiles', {
      kind: 'profile-delete',
      profileId: 'profile-a',
    })
    retainPendingModelMutation(discardedToken!, 'mutation-discarded')
    mutationMocks.settlementListeners.get('mutation-discarded')?.('discarded')
    expect(getPendingModelMutations('model-profiles')).toMatchObject([
      { token: discardedToken, mutationId: 'mutation-discarded', phase: 'discarded' },
    ])
    finishPendingModelMutation(discardedToken!)
    expect(getPendingModelMutations('model-profiles')).toEqual([])
  })

  it('matches retained model and credential projections without exposing secret differences', () => {
    const attempted = {
      name: 'Copy',
      providerId: 'vertex',
      modelId: 'vertex-model',
      providerOptions: { credentialId: 'credential-vertex', vertex: { projectId: 'project-a' } },
    }
    const projected = {
      id: 'server-id',
      ...attempted,
    }
    expect(
      isPendingModelMutationProjectionApplied(
        {
          kind: 'profile-create',
          baselineIds: ['old-id'],
          attemptedFingerprint: modelProfileProjectionFingerprint(attempted, true),
        },
        { modelProfiles: [projected] },
      ),
    ).toBe(true)
    const attemptedCredential = {
      name: 'Vertex',
      type: 'vertexServiceAccount' as const,
      vertex: { clientEmail: 'service@example.com', privateKey: 'private' },
    }
    const projectedCredential = {
      id: 'credential-vertex',
      ...attemptedCredential,
      vertex: { ...attemptedCredential.vertex, privateKey: '__RISU_SECRET_MASKED__' },
    }
    expect(
      isPendingModelMutationProjectionApplied(
        {
          kind: 'credential-create',
          baselineIds: ['old-credential'],
          attemptedFingerprint: providerCredentialProjectionFingerprint(attemptedCredential, true),
        },
        { providerCredentials: [projectedCredential] },
      ),
    ).toBe(true)
    expect(
      isPendingModelMutationProjectionApplied(
        { kind: 'runtime-defaults', runtimeDefaults: { maxContext: 8192 } },
        { modelRuntimeDefaults: { maxContext: 8192 } },
      ),
    ).toBe(true)
    expect(
      isPendingModelMutationProjectionApplied(
        { kind: 'role-bindings', bindings: { chatMain: { mode: 'profile', profileId: 'server-id' } } },
        { modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'server-id' } } },
      ),
    ).toBe(true)
    expect(
      isPendingModelMutationProjectionApplied(
        {
          kind: 'profile-reorder',
          order: [
            { kind: 'profile', profileId: 'profile-b' },
            { kind: 'profile', profileId: 'profile-a' },
          ],
        },
        {
          modelProfiles: [
            { id: 'profile-b', name: 'B' },
            { id: 'profile-a', name: 'A' },
          ],
        },
      ),
    ).toBe(true)
    expect(
      isPendingModelMutationProjectionApplied(
        {
          kind: 'profile-reorder',
          order: [
            { kind: 'profile', profileId: 'profile-b' },
            { kind: 'profile', profileId: 'profile-a' },
          ],
        },
        {
          modelProfiles: [
            { id: 'profile-a', name: 'A' },
            { id: 'profile-b', name: 'B' },
          ],
        },
      ),
    ).toBe(false)
    expect(
      isPendingModelMutationProjectionApplied(
        {
          kind: 'profile-reorder',
          order: [
            { kind: 'profile', profileId: 'profile-b' },
            { kind: 'divider', id: 'divider-a' },
            { kind: 'profile', profileId: 'profile-a' },
          ],
        },
        {
          modelProfiles: [
            { id: 'profile-b', name: 'B' },
            { id: 'profile-a', name: 'A' },
          ],
          modelProfileOrder: [
            { kind: 'profile', profileId: 'profile-b' },
            { kind: 'divider', id: 'divider-a' },
            { kind: 'profile', profileId: 'profile-a' },
          ],
        },
      ),
    ).toBe(true)
  })
})
