import {
  normalizeModelProfileOrder,
  normalizeModelRoleProfiles,
  normalizeModelRuntimeDefaults,
  type ModelProfileOrderEntry,
  type ModelProfileRecord,
  type ModelProfileRecordRuntimeOptions,
  type ModelRoleProfileBinding,
} from './modelProfileRecords'
import { MODEL_ROLES, type ModelRole } from './modelRoles'
import {
  convertLegacyModelProfilesCommand,
  createModelProfileCommand,
  deleteModelProfileCommand,
  duplicateModelProfileCommand,
  reorderModelProfilesCommand,
  runServerCommand,
  updateModelProfileCommand,
  updateModelRoleProfilesCommand,
  updateModelRuntimeDefaultsCommand,
  createProviderCredentialCommand,
  deleteProviderCredentialCommand,
  updateProviderCredentialCommand,
  type ModelProfileSnapshot,
  type ProviderCredentialSnapshot,
  type ServerCommandResult,
  type ServerCommandTransportOptions,
} from '../server/commands'
import { MASKED_PROVIDER_SECRET } from '../providerSecretMask'
import type { ProviderCredentialRecord } from './providerCredentialRecords'
import { dispatchDurableMutation, registerDurableMutationSettlementListener } from '../server/durableMutationDispatch'
import {
  isPendingMutationCurrent,
  stagePendingMutation,
  type DurableMutationIntent,
} from '../server/pendingMutationOutbox'

const MODEL_PROFILE_MUTATION_KEY = 'model-profiles'
const MODEL_RUNTIME_DEFAULTS_MUTATION_KEY = 'model-runtime-defaults'
const PROVIDER_CREDENTIAL_MUTATION_KEY = 'provider-credentials'

export type ModelMutationLane =
  | typeof MODEL_PROFILE_MUTATION_KEY
  | typeof MODEL_RUNTIME_DEFAULTS_MUTATION_KEY
  | typeof PROVIDER_CREDENTIAL_MUTATION_KEY

export type PendingModelMutationProjection =
  | { kind: 'profile-create' | 'profile-duplicate'; baselineIds: string[]; attemptedFingerprint: string }
  | { kind: 'profile-update'; profileId: string; attemptedFingerprint: string }
  | { kind: 'profile-delete'; profileId: string }
  | { kind: 'profile-reorder'; order: ModelProfileOrderEntry[] }
  | {
      kind: 'role-bindings'
      bindings: Partial<Record<ModelRole, ModelRoleProfileBinding>>
    }
  | { kind: 'legacy-conversion'; baselineIds: string[] }
  | { kind: 'runtime-defaults'; runtimeDefaults: ModelProfileRecordRuntimeOptions }
  | { kind: 'credential-create'; baselineIds: string[]; attemptedFingerprint: string }
  | { kind: 'credential-update'; credentialId: string; attemptedFingerprint: string }
  | { kind: 'credential-delete'; credentialId: string }

export interface PendingModelMutation {
  token: string
  lane: ModelMutationLane
  mutationId: string | null
  phase: 'dispatching' | 'queued' | 'accepted-replay' | 'discarded'
  projection: PendingModelMutationProjection
}

export interface ModelMutationProjectionSnapshot {
  modelProfiles?: ModelProfileRecord[]
  modelProfileOrder?: ModelProfileOrderEntry[]
  modelRoleProfiles?: unknown
  modelRuntimeDefaults?: unknown
  providerCredentials?: ProviderCredentialRecord[]
}

type PendingModelMutationListener = (pending: PendingModelMutation[]) => void

interface InternalPendingModelMutation extends PendingModelMutation {
  unregisterSettlement: (() => void) | null
}

const pendingModelMutations = new Map<string, InternalPendingModelMutation>()
const pendingModelMutationListeners = new Map<ModelMutationLane, Set<PendingModelMutationListener>>()
let nextPendingModelMutationToken = 0

export type ModelProfileMutationOutcome<T extends Record<string, unknown> = {}> =
  | { status: 'accepted'; result: Extract<ServerCommandResult<T>, { status: 'ok' }> }
  | { status: 'queued'; result: Exclude<ServerCommandResult<T>, { status: 'ok' }>; mutationId: string }
  | { status: 'failed'; result: Exclude<ServerCommandResult<T>, { status: 'ok' }> }

/**
 * Reserve a UI semantic lane before awaiting a durable command. This survives
 * settings-tab remounts and closes the interval where a remounted control could
 * submit the same generated-ID mutation while the first request is still in flight.
 * A hard reload is fenced separately by bootstrap, which replays every retained
 * outbox row before loading authoritative resources and mounting the application.
 */
export function beginPendingModelMutation(
  lane: ModelMutationLane,
  projection: PendingModelMutationProjection,
): string | null {
  if (Array.from(pendingModelMutations.values()).some((pending) => pending.lane === lane)) return null
  let frozenProjection: PendingModelMutationProjection
  try {
    frozenProjection = cloneJsonValue(projection)
  } catch {
    return null
  }
  const token = `model-mutation-${++nextPendingModelMutationToken}`
  pendingModelMutations.set(token, {
    token,
    lane,
    mutationId: null,
    phase: 'dispatching',
    projection: frozenProjection,
    unregisterSettlement: null,
  })
  publishPendingModelMutations(lane)
  return token
}

/** Match a retained attempt against an authoritative resource projection. */
export function isPendingModelMutationProjectionApplied(
  projection: PendingModelMutationProjection,
  snapshot: ModelMutationProjectionSnapshot,
): boolean {
  if (projection.kind === 'credential-delete') {
    return !(snapshot.providerCredentials ?? []).some((credential) => credential.id === projection.credentialId)
  }
  if (projection.kind === 'credential-update') {
    const credential = (snapshot.providerCredentials ?? []).find(
      (candidate) => candidate.id === projection.credentialId,
    )
    return !!credential && providerCredentialProjectionFingerprint(credential) === projection.attemptedFingerprint
  }
  if (projection.kind === 'credential-create') {
    const baseline = new Set(projection.baselineIds)
    return (snapshot.providerCredentials ?? []).some(
      (credential) =>
        !baseline.has(credential.id) &&
        providerCredentialProjectionFingerprint(credential, true) === projection.attemptedFingerprint,
    )
  }

  if (projection.kind === 'runtime-defaults') {
    return (
      jsonSnapshot(normalizeModelRuntimeDefaults(projection.runtimeDefaults)) ===
      jsonSnapshot(normalizeModelRuntimeDefaults(snapshot.modelRuntimeDefaults))
    )
  }

  if (projection.kind === 'role-bindings') {
    const authoritative = normalizeModelRoleProfiles(snapshot.modelRoleProfiles)
    return Object.entries(projection.bindings).every(([role, binding]) => {
      if (!binding) return true
      return jsonSnapshot(authoritative[role as ModelRole]) === jsonSnapshot(binding)
    })
  }

  const profiles = snapshot.modelProfiles ?? []
  if (projection.kind === 'profile-reorder') {
    return (
      jsonSnapshot(normalizeModelProfileOrder(snapshot.modelProfileOrder, profiles)) === jsonSnapshot(projection.order)
    )
  }
  if (projection.kind === 'profile-delete') {
    return !profiles.some((profile) => profile.id === projection.profileId)
  }
  if (projection.kind === 'profile-update') {
    const profile = profiles.find((candidate) => candidate.id === projection.profileId)
    return !!profile && modelProfileProjectionFingerprint(profile) === projection.attemptedFingerprint
  }
  if (projection.kind === 'legacy-conversion') {
    const baseline = new Set(projection.baselineIds)
    const newProfileCount = profiles.filter((profile) => !baseline.has(profile.id)).length
    const roleProfiles = normalizeModelRoleProfiles(snapshot.modelRoleProfiles)
    return newProfileCount >= 2 && MODEL_ROLES.every((role) => roleProfiles[role].mode !== 'legacy')
  }

  const baseline = new Set(projection.baselineIds)
  return profiles.some(
    (profile) =>
      !baseline.has(profile.id) && modelProfileProjectionFingerprint(profile, true) === projection.attemptedFingerprint,
  )
}

export function modelProfileProjectionFingerprint(profile: ModelProfileSnapshot, omitId = false): string {
  const snapshot = cloneJsonValue(profile) as Record<string, unknown>
  if (omitId) delete snapshot.id
  return JSON.stringify(canonicalJsonValue(snapshot))
}

export function providerCredentialProjectionFingerprint(
  credential: ProviderCredentialSnapshot,
  omitId = false,
): string {
  const snapshot = cloneJsonValue(credential) as Record<string, unknown>
  if (omitId) delete snapshot.id
  if (typeof snapshot.apiKey === 'string' && snapshot.apiKey !== '') snapshot.apiKey = MASKED_PROVIDER_SECRET
  const vertex = snapshot.vertex
  if (vertex && typeof vertex === 'object' && !Array.isArray(vertex)) {
    const vertexRecord = vertex as Record<string, unknown>
    if (typeof vertexRecord.privateKey === 'string' && vertexRecord.privateKey !== '') {
      vertexRecord.privateKey = MASKED_PROVIDER_SECRET
    }
  }
  return JSON.stringify(canonicalJsonValue(snapshot))
}

/** Keep a failed command's durable outbox row latched until replay settles. */
export function retainPendingModelMutation(token: string, mutationId: string): void {
  const pending = pendingModelMutations.get(token)
  if (!pending) return

  safelyUnregisterSettlement(pending)
  pending.mutationId = mutationId
  pending.phase = 'queued'
  try {
    pending.unregisterSettlement = registerDurableMutationSettlementListener(mutationId, (settlement) => {
      const current = pendingModelMutations.get(token)
      if (!current || current.mutationId !== mutationId) return
      if (settlement === 'discarded') {
        safelyUnregisterSettlement(current)
        current.phase = 'discarded'
        publishPendingModelMutations(current.lane)
        return
      }

      // Replay acceptance can arrive before resource invalidation is hydrated.
      // Keep controls fenced until a component observes the exact projection.
      current.phase = 'accepted-replay'
      publishPendingModelMutations(current.lane)
    })
  } catch (error) {
    pending.unregisterSettlement = null
    console.error('Unable to observe retained model mutation settlement:', error)
  }
  publishPendingModelMutations(pending.lane)
}

/** Release an in-flight/retained lane after terminal failure or projection convergence. */
export function finishPendingModelMutation(token: string): void {
  const pending = pendingModelMutations.get(token)
  if (!pending) return
  safelyUnregisterSettlement(pending)
  pendingModelMutations.delete(token)
  publishPendingModelMutations(pending.lane)
}

export function getPendingModelMutations(lane: ModelMutationLane): PendingModelMutation[] {
  return Array.from(pendingModelMutations.values())
    .filter((pending) => pending.lane === lane)
    .map(publicPendingModelMutation)
}

export function subscribePendingModelMutations(
  lane: ModelMutationLane,
  listener: PendingModelMutationListener,
): () => void {
  const listeners = pendingModelMutationListeners.get(lane) ?? new Set()
  listeners.add(listener)
  pendingModelMutationListeners.set(lane, listeners)
  try {
    listener(getPendingModelMutations(lane))
  } catch (error) {
    console.error('Pending model mutation listener rejected:', error)
  }
  return () => {
    const current = pendingModelMutationListeners.get(lane)
    current?.delete(listener)
    if (current?.size === 0) pendingModelMutationListeners.delete(lane)
  }
}

export async function createModelProfileDurably(
  profile: ModelProfileSnapshot,
): Promise<ModelProfileMutationOutcome<{ profileId: string }>> {
  try {
    const frozenProfile = cloneJsonValue(profile)
    return await dispatchModelProfileMutation(
      {
        version: 1,
        requests: [{ method: 'POST', path: '/model-profiles', body: { profile: frozenProfile } }],
      },
      (baseRevision) => createModelProfileCommand({ baseRevision, profile: cloneJsonValue(frozenProfile) }),
    )
  } catch {
    return unavailableModelMutationOutcome()
  }
}

export async function updateModelProfileDurably(
  profileId: string,
  profile: ModelProfileSnapshot,
  expectedProfile: ModelProfileSnapshot,
): Promise<ModelProfileMutationOutcome<{ profileId: string }>> {
  try {
    const frozenProfile = cloneJsonValue(profile)
    const frozenExpectedProfile = cloneJsonValue(expectedProfile)
    const path = `/model-profiles/${encodeURIComponent(profileId)}`
    return await dispatchModelProfileMutation(
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
  } catch {
    return unavailableModelMutationOutcome()
  }
}

export async function duplicateModelProfileDurably(
  profileId: string,
  name: string,
): Promise<ModelProfileMutationOutcome<{ profileId: string; sourceProfileId: string }>> {
  try {
    const path = `/model-profiles/${encodeURIComponent(profileId)}/duplicate`
    return await dispatchModelProfileMutation(
      {
        version: 1,
        requests: [{ method: 'POST', path, body: { name } }],
      },
      (baseRevision) => duplicateModelProfileCommand({ baseRevision, profileId, name }),
    )
  } catch {
    return unavailableModelMutationOutcome()
  }
}

export async function reorderModelProfilesDurably(
  order: ModelProfileOrderEntry[],
): Promise<ModelProfileMutationOutcome<{ profileIds: string[]; order: ModelProfileOrderEntry[] }>> {
  try {
    const frozenOrder = cloneJsonValue(order)
    return await dispatchModelProfileMutation(
      {
        version: 1,
        requests: [{ method: 'POST', path: '/model-profiles/reorder', body: { order: frozenOrder } }],
      },
      (baseRevision) => reorderModelProfilesCommand({ baseRevision, order: cloneJsonValue(frozenOrder) }),
    )
  } catch {
    return unavailableModelMutationOutcome()
  }
}

export async function deleteModelProfileDurably(
  profileId: string,
  reassignments: Partial<Record<ModelRole, ModelRoleProfileBinding>>,
): Promise<ModelProfileMutationOutcome<{ profileId: string; reassignedRoles: ModelRole[] }>> {
  try {
    const frozenReassignments = cloneJsonValue(reassignments)
    const path = `/model-profiles/${encodeURIComponent(profileId)}`
    return await dispatchModelProfileMutation(
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
  } catch {
    return unavailableModelMutationOutcome()
  }
}

export async function createProviderCredentialDurably(
  credential: ProviderCredentialSnapshot,
): Promise<ModelProfileMutationOutcome<{ credentialId: string }>> {
  try {
    const frozenCredential = cloneJsonValue(credential)
    return await dispatchModelMutation(
      PROVIDER_CREDENTIAL_MUTATION_KEY,
      {
        version: 1,
        requests: [{ method: 'POST', path: '/provider-credentials', body: { credential: frozenCredential } }],
      },
      (baseRevision) => createProviderCredentialCommand({ baseRevision, credential: cloneJsonValue(frozenCredential) }),
    )
  } catch {
    return unavailableModelMutationOutcome()
  }
}

export async function updateProviderCredentialDurably(
  credentialId: string,
  credential: ProviderCredentialSnapshot,
  expectedCredential: ProviderCredentialSnapshot,
): Promise<ModelProfileMutationOutcome<{ credentialId: string }>> {
  try {
    const frozenCredential = cloneJsonValue(credential)
    const frozenExpected = cloneJsonValue(expectedCredential)
    const path = `/provider-credentials/${encodeURIComponent(credentialId)}`
    return await dispatchModelMutation(
      PROVIDER_CREDENTIAL_MUTATION_KEY,
      {
        version: 1,
        requests: [
          {
            method: 'PATCH',
            path,
            body: { credential: frozenCredential, expectedCredential: frozenExpected },
          },
        ],
      },
      (baseRevision) =>
        updateProviderCredentialCommand({
          baseRevision,
          credentialId,
          credential: cloneJsonValue(frozenCredential),
          expectedCredential: cloneJsonValue(frozenExpected),
        }),
    )
  } catch {
    return unavailableModelMutationOutcome()
  }
}

export async function deleteProviderCredentialDurably(
  credentialId: string,
): Promise<ModelProfileMutationOutcome<{ credentialId: string }>> {
  try {
    const path = `/provider-credentials/${encodeURIComponent(credentialId)}`
    return await dispatchModelMutation(
      PROVIDER_CREDENTIAL_MUTATION_KEY,
      {
        version: 1,
        requests: [{ method: 'DELETE', path, body: {} }],
      },
      (baseRevision) => deleteProviderCredentialCommand({ baseRevision, credentialId }),
    )
  } catch {
    return unavailableModelMutationOutcome()
  }
}

export async function updateModelRuntimeDefaultsDurably(
  runtimeDefaults: ModelProfileRecordRuntimeOptions,
): Promise<ModelProfileMutationOutcome> {
  try {
    const frozenRuntimeDefaults = cloneJsonValue(runtimeDefaults)
    return await dispatchModelMutation(
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
  } catch {
    return unavailableModelMutationOutcome()
  }
}

export async function updateModelRoleProfilesDurably(
  bindings: Partial<Record<ModelRole, ModelRoleProfileBinding>>,
  modelPresetId: string | null,
): Promise<ModelProfileMutationOutcome<{ roles: ModelRole[] }>> {
  try {
    const frozenBindings = cloneJsonValue(bindings)
    const body = {
      bindings: frozenBindings,
      ...(modelPresetId ? { modelPresetId } : {}),
    }
    return await dispatchModelProfileMutation(
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
  } catch {
    return unavailableModelMutationOutcome()
  }
}

export async function convertLegacyModelProfilesDurably(): Promise<
  ModelProfileMutationOutcome<{ profileIdsByRole: Record<ModelRole, string>; convertedRoles: ModelRole[] }>
> {
  try {
    return await dispatchModelProfileMutation(
      {
        version: 1,
        requests: [{ method: 'POST', path: '/model-profiles/convert-legacy', body: {} }],
      },
      (baseRevision) => convertLegacyModelProfilesCommand({ baseRevision }),
    )
  } catch {
    return unavailableModelMutationOutcome()
  }
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
  let outbox: ReturnType<typeof stagePendingMutation>
  try {
    outbox = stagePendingMutation(mutationKey, intent)
  } catch {
    return unavailableModelMutationOutcome()
  }
  let result: ServerCommandResult<T>
  try {
    result = await dispatchDurableMutation(outbox, intent, (transport) => runModelProfileCommand(command, transport))
  } catch {
    result = { status: 'unavailable' }
  }
  if (result.status === 'ok') return { status: 'accepted', result }
  try {
    return (await isPendingMutationCurrent(outbox))
      ? { status: 'queued', result, mutationId: outbox.mutationId }
      : { status: 'failed', result }
  } catch {
    return (await outbox.ready) === 'persisted'
      ? { status: 'queued', result, mutationId: outbox.mutationId }
      : { status: 'failed', result }
  }
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

function unavailableModelMutationOutcome<T extends Record<string, unknown>>(): ModelProfileMutationOutcome<T> {
  return { status: 'failed', result: { status: 'unavailable' } }
}

function publicPendingModelMutation(pending: InternalPendingModelMutation): PendingModelMutation {
  return {
    token: pending.token,
    lane: pending.lane,
    mutationId: pending.mutationId,
    phase: pending.phase,
    projection: cloneJsonValue(pending.projection),
  }
}

function publishPendingModelMutations(lane: ModelMutationLane): void {
  const snapshot = getPendingModelMutations(lane)
  for (const listener of pendingModelMutationListeners.get(lane) ?? []) {
    try {
      listener(snapshot.map(publicPendingModelMutationFromPublic))
    } catch (error) {
      console.error('Pending model mutation listener rejected:', error)
    }
  }
}

function publicPendingModelMutationFromPublic(pending: PendingModelMutation): PendingModelMutation {
  return {
    ...pending,
    projection: cloneJsonValue(pending.projection),
  }
}

function jsonSnapshot(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value ?? {}))
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalJsonValue(child)]),
  )
}

function safelyUnregisterSettlement(pending: InternalPendingModelMutation): void {
  try {
    pending.unregisterSettlement?.()
  } catch (error) {
    console.error('Unable to unregister retained model mutation settlement:', error)
  }
  pending.unregisterSettlement = null
}
