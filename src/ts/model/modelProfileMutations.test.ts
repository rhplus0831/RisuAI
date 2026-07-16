import { beforeEach, describe, expect, it, vi } from 'vitest'

const mutationMocks = vi.hoisted(() => ({
  commandCalls: [] as Array<{ name: string; input: Record<string, unknown> }>,
  dispatchThrows: false,
  result: { status: 'ok' } as Record<string, unknown>,
  retained: false,
  runInputs: [] as Array<Record<string, unknown>>,
  staged: [] as Array<{ key: string; intent: unknown }>,
}))

vi.mock('../server/pendingMutationOutbox', () => ({
  stagePendingMutation: (key: string, intent: unknown) => {
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
}))

vi.mock('../server/commands', () => {
  const command = (name: string) => async (input: Record<string, unknown>) => {
    mutationMocks.commandCalls.push({ name, input })
    return mutationMocks.result
  }
  return {
    convertLegacyModelProfilesCommand: command('convert'),
    createModelProfileCommand: command('create'),
    deleteModelProfileCommand: command('delete'),
    duplicateModelProfileCommand: command('duplicate'),
    updateModelProfileCommand: command('update'),
    updateModelRoleProfilesCommand: command('roles'),
    updateModelRuntimeDefaultsCommand: command('runtime'),
    runServerCommand: async (input: Record<string, unknown>) => {
      mutationMocks.runInputs.push(input)
      return (input.command as (baseRevision: number) => Promise<unknown>)(41)
    },
  }
})

import {
  convertLegacyModelProfilesDurably,
  createModelProfileDurably,
  deleteModelProfileDurably,
  duplicateModelProfileDurably,
  updateModelProfileDurably,
  updateModelRoleProfilesDurably,
  updateModelRuntimeDefaultsDurably,
} from './modelProfileMutations'

beforeEach(() => {
  mutationMocks.commandCalls.length = 0
  mutationMocks.dispatchThrows = false
  mutationMocks.result = { status: 'ok' }
  mutationMocks.retained = false
  mutationMocks.runInputs.length = 0
  mutationMocks.staged.length = 0
})

describe('durable model-profile mutations', () => {
  it('freezes every replay body and dispatches the matching command', async () => {
    const profile = { id: 'profile-a', name: 'Profile A', providerOptions: { apiKey: 'secret' } }
    const expectedProfile = { ...profile, name: 'Old Profile' }
    const reassignments = { chatMain: { mode: 'legacy' as const } }
    const bindings = { chatMain: { mode: 'profile' as const, profileId: 'profile-a' } }

    await createModelProfileDurably(profile)
    await updateModelProfileDurably('profile/a', profile, expectedProfile)
    await duplicateModelProfileDurably('profile/a', 'Profile A Copy', true)
    await deleteModelProfileDurably('profile/a', reassignments)
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
              body: { name: 'Profile A Copy', includeSecrets: true },
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
          includeSecrets: true,
        },
      },
      {
        name: 'delete',
        input: { baseRevision: 41, profileId: 'profile/a', reassignments },
      },
      { name: 'runtime', input: { baseRevision: 41, runtimeDefaults: { maxContext: 8192 } } },
      {
        name: 'roles',
        input: { baseRevision: 41, bindings, modelPresetId: 'preset-a' },
      },
      { name: 'convert', input: { baseRevision: 41 } },
    ])
    expect(mutationMocks.runInputs).toHaveLength(7)
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
    })
  })
})
