import type { ModelProfileRecordRuntimeOptions, ModelRoleProfileBinding } from './modelProfileRecords'
import type { ModelRole } from './modelRoles'
import {
  convertLegacyModelProfilesCommand,
  createModelProfileCommand,
  deleteModelProfileCommand,
  duplicateModelProfileCommand,
  runServerCommand,
  updateModelProfileCommand,
  updateModelRoleProfilesCommand,
  updateModelRuntimeDefaultsCommand,
  type ModelProfileSnapshot,
  type ServerCommandResult,
  type ServerCommandTransportOptions,
} from '../server/commands'
import { dispatchDurableMutation } from '../server/durableMutationDispatch'
import {
  isPendingMutationCurrent,
  stagePendingMutation,
  type DurableMutationIntent,
} from '../server/pendingMutationOutbox'

const MODEL_PROFILE_MUTATION_KEY = 'model-profiles'
const MODEL_RUNTIME_DEFAULTS_MUTATION_KEY = 'model-runtime-defaults'

export type ModelProfileMutationOutcome<T extends Record<string, unknown> = {}> =
  | { status: 'accepted'; result: Extract<ServerCommandResult<T>, { status: 'ok' }> }
  | { status: 'queued'; result: Exclude<ServerCommandResult<T>, { status: 'ok' }> }
  | { status: 'failed'; result: Exclude<ServerCommandResult<T>, { status: 'ok' }> }

export function createModelProfileDurably(
  profile: ModelProfileSnapshot,
): Promise<ModelProfileMutationOutcome<{ profileId: string }>> {
  const frozenProfile = cloneJsonValue(profile)
  return dispatchModelProfileMutation(
    {
      version: 1,
      requests: [{ method: 'POST', path: '/model-profiles', body: { profile: frozenProfile } }],
    },
    (baseRevision) => createModelProfileCommand({ baseRevision, profile: cloneJsonValue(frozenProfile) }),
  )
}

export function updateModelProfileDurably(
  profileId: string,
  profile: ModelProfileSnapshot,
  expectedProfile: ModelProfileSnapshot,
): Promise<ModelProfileMutationOutcome<{ profileId: string }>> {
  const frozenProfile = cloneJsonValue(profile)
  const frozenExpectedProfile = cloneJsonValue(expectedProfile)
  const path = `/model-profiles/${encodeURIComponent(profileId)}`
  return dispatchModelProfileMutation(
    {
      version: 1,
      requests: [
        {
          method: 'PATCH',
          path,
          body: { profile: frozenProfile, expectedProfile: frozenExpectedProfile },
        },
      ],
    },
    (baseRevision) =>
      updateModelProfileCommand({
        baseRevision,
        profileId,
        profile: cloneJsonValue(frozenProfile),
        expectedProfile: cloneJsonValue(frozenExpectedProfile),
      }),
  )
}

export function duplicateModelProfileDurably(
  profileId: string,
  name: string,
  includeSecrets: boolean,
): Promise<ModelProfileMutationOutcome<{ profileId: string; sourceProfileId: string }>> {
  const path = `/model-profiles/${encodeURIComponent(profileId)}/duplicate`
  return dispatchModelProfileMutation(
    {
      version: 1,
      requests: [{ method: 'POST', path, body: { name, includeSecrets } }],
    },
    (baseRevision) => duplicateModelProfileCommand({ baseRevision, profileId, name, includeSecrets }),
  )
}

export function deleteModelProfileDurably(
  profileId: string,
  reassignments: Partial<Record<ModelRole, ModelRoleProfileBinding>>,
): Promise<ModelProfileMutationOutcome<{ profileId: string; reassignedRoles: ModelRole[] }>> {
  const frozenReassignments = cloneJsonValue(reassignments)
  const path = `/model-profiles/${encodeURIComponent(profileId)}`
  return dispatchModelProfileMutation(
    {
      version: 1,
      requests: [{ method: 'DELETE', path, body: { reassignments: frozenReassignments } }],
    },
    (baseRevision) =>
      deleteModelProfileCommand({
        baseRevision,
        profileId,
        reassignments: cloneJsonValue(frozenReassignments),
      }),
  )
}

export function updateModelRuntimeDefaultsDurably(
  runtimeDefaults: ModelProfileRecordRuntimeOptions,
): Promise<ModelProfileMutationOutcome> {
  const frozenRuntimeDefaults = cloneJsonValue(runtimeDefaults)
  return dispatchModelMutation(
    MODEL_RUNTIME_DEFAULTS_MUTATION_KEY,
    {
      version: 1,
      requests: [
        {
          method: 'PUT',
          path: '/model-runtime-defaults',
          body: { runtimeDefaults: frozenRuntimeDefaults },
        },
      ],
    },
    (baseRevision) =>
      updateModelRuntimeDefaultsCommand({
        baseRevision,
        runtimeDefaults: cloneJsonValue(frozenRuntimeDefaults),
      }),
  )
}

export function updateModelRoleProfilesDurably(
  bindings: Partial<Record<ModelRole, ModelRoleProfileBinding>>,
  modelPresetId: string | null,
): Promise<ModelProfileMutationOutcome<{ roles: ModelRole[] }>> {
  const frozenBindings = cloneJsonValue(bindings)
  const body = {
    bindings: frozenBindings,
    ...(modelPresetId ? { modelPresetId } : {}),
  }
  return dispatchModelProfileMutation(
    {
      version: 1,
      requests: [{ method: 'PUT', path: '/model-role-profiles', body }],
    },
    (baseRevision) =>
      updateModelRoleProfilesCommand({
        baseRevision,
        bindings: cloneJsonValue(frozenBindings),
        ...(modelPresetId ? { modelPresetId } : {}),
      }),
  )
}

export function convertLegacyModelProfilesDurably(): Promise<
  ModelProfileMutationOutcome<{ profileIdsByRole: Record<ModelRole, string>; convertedRoles: ModelRole[] }>
> {
  return dispatchModelProfileMutation(
    {
      version: 1,
      requests: [{ method: 'POST', path: '/model-profiles/convert-legacy', body: {} }],
    },
    (baseRevision) => convertLegacyModelProfilesCommand({ baseRevision }),
  )
}

function dispatchModelProfileMutation<T extends Record<string, unknown>>(
  intent: DurableMutationIntent,
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
): Promise<ModelProfileMutationOutcome<T>> {
  return dispatchModelMutation(MODEL_PROFILE_MUTATION_KEY, intent, command)
}

async function dispatchModelMutation<T extends Record<string, unknown>>(
  mutationKey: string,
  intent: DurableMutationIntent,
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
): Promise<ModelProfileMutationOutcome<T>> {
  const outbox = stagePendingMutation(mutationKey, intent)
  let result: ServerCommandResult<T>
  try {
    result = await dispatchDurableMutation(outbox, intent, (transport) => runModelProfileCommand(command, transport))
  } catch {
    result = { status: 'unavailable' }
  }
  if (result.status === 'ok') return { status: 'accepted', result }
  return (await isPendingMutationCurrent(outbox)) ? { status: 'queued', result } : { status: 'failed', result }
}

function runModelProfileCommand<T extends Record<string, unknown>>(
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
  transport: ServerCommandTransportOptions,
): Promise<ServerCommandResult<T>> {
  return runServerCommand({ command, ...transport })
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
