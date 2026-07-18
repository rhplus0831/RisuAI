import { getDatabase, saveImage, type Database } from './storage/database.svelte'
import { selectSingleFile, sleep } from './util'
import { alertError, alertNormal, alertStore } from './alert'
import { AppendableBuffer, downloadFile, readImage } from './globalApi.svelte'
import { language } from 'src/lang'
import { reencodeImage } from './process/files/inlays'
import { PngChunk } from './pngChunk'
import { v4 } from 'uuid'
import {
  canUseServerCommands,
  createPersonaCommand,
  deletePersonaCommand,
  reorderPersonasCommand,
  runServerCommand,
  selectPersonaCommand,
  updatePersonaCommand,
  type PersonaLegacyProfileProjection,
  type PersonaMutationOptimisticAcknowledgement,
  type PersonaMutationOperation,
  type PersonaPatchOptimisticAcknowledgement,
  type PersonaSnapshot,
  type ServerCommandResult,
  type ServerCommandTransportOptions,
} from './server/commands'
import { registerPendingBridgePatchFlusher } from './server/pendingBridgeFlushRegistry'
import { dispatchDurableMutation } from './server/durableMutationDispatch'
import {
  acknowledgePendingMutation,
  isPendingMutationCurrent,
  pendingMutationSettingsFieldProjectionTarget,
  recordPendingMutationProjectionTargets,
  stagePendingMutation,
  type DurableMutationIntent,
  type PendingMutationHandle,
} from './server/pendingMutationOutbox'
import { subscribeServerCommandLocalEffectApplied } from './server/commandLocalEffectEvents'
import { withTrustedResourceWrite } from './server/resourceWriteGuard.svelte'
import {
  beginPersonaIconUpload,
  capturePersonaIconUploadTarget,
  clearPersonaIconUpload,
  resolveFreshPersonaIconUploadIndex,
  type PersonaIconUploadOperation,
} from './server/personaIconUpload'
import { applyAttemptedFieldRollback, applyAttemptedKeyedListRollback } from './server/staleStateGuards'
import { PERSONA_SELECTION_MUTATION_KEY, personaOwnerMutationKey } from './server/personaMutationKeys'
import {
  captureCollectionProjectionEpoch,
  captureSettingsProjectionEpoch,
  hasCollectionProjectionEpochChanged,
  markCollectionAcknowledgementTainted,
  markSettingsAcknowledgementTainted,
} from './server/resourceState.svelte'
import { optimisticallyRehomeGenerationReferences } from './generationReferenceCascade'

export type Persona = Database['personas'][number]

export interface PersonaStateSnapshot {
  personas: Persona[]
  selectedPersona: number
  username: string
  userIcon: string
  personaPrompt: string
  userNote: string
}

export interface SelectedPersonaProjectionSnapshot {
  selectedPersona: number
  username: string
  userIcon: string
  personaPrompt: string
  userNote: string
  displayName: string
  largePortrait: boolean
}

export type SelectedPersonaProfileField = 'username' | 'userNote' | 'personaPrompt'
export type SelectedPersonaDirtyField = SelectedPersonaProfileField | 'userIcon' | 'displayName' | 'largePortrait'
export type PersonaPersistenceStatus = 'accepted' | 'queued' | 'failed'
type PersonaProfileMirrorField = 'username' | 'userIcon' | 'personaPrompt' | 'userNote'
type PersonaRowProfileField = 'name' | 'icon' | 'personaPrompt' | 'note'
type PersonaRowRollbackField = PersonaRowProfileField | 'displayName' | 'largePortrait'

interface PersonaProfileMirrorRollbackSnapshot {
  selectedPersona: number
  selectedPersonaId: string | null
  username: string
  userIcon: string
  personaPrompt: string
  userNote: string
}

interface PersonaProfileMirrorRollbackMatches {
  selectedPersona: boolean
  fields: Record<PersonaProfileMirrorField, boolean>
  liveSelectedPersonaId: string | null
}

const pendingPersonaUpdate = {
  timer: null as ReturnType<typeof setTimeout> | null,
  previous: null as PersonaStateSnapshot | null,
  durableAttempted: null as PersonaStateSnapshot | null,
  attempted: null as PersonaStateSnapshot | null,
  personaId: null as string | null,
  patch: null as PersonaSnapshot | null,
  collectionProjectionEpoch: null as number | null,
  settingsProjectionEpoch: null as number | null,
  intent: null as DurableMutationIntent | null,
  outbox: null as PendingMutationHandle | null,
  promise: null as Promise<ServerCommandResult<{ personaId: string }> | null> | null,
}

interface PendingImportedPersonaCreate {
  operationId: number
  personaId: string
  draftPersona: Persona
  collectionProjectionEpoch: number
}

let personaSettingsWatcherSuppressed = false
let personaSettingsWatcherSuppressionToken = 0
let nextImportedPersonaCreateOperationId = 1
const pendingImportedPersonaCreates: PendingImportedPersonaCreate[] = []
const dirtySelectedPersonaFieldsById = new Map<string, Map<SelectedPersonaDirtyField, string | boolean>>()
const personaProfileMirrorFields: readonly PersonaProfileMirrorField[] = [
  'username',
  'userIcon',
  'personaPrompt',
  'userNote',
]
const personaRowProfileFields: readonly PersonaRowProfileField[] = ['name', 'icon', 'personaPrompt', 'note']
const personaRowRollbackFields = new Set<PersonaRowRollbackField>([
  'name',
  'icon',
  'personaPrompt',
  'note',
  'displayName',
  'largePortrait',
])

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isExactJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (!value || typeof value !== 'object' || ancestors.has(value)) return false

  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false
  if (Object.getOwnPropertySymbols(value).some((symbol) => Object.prototype.propertyIsEnumerable.call(value, symbol))) {
    return false
  }

  ancestors.add(value)
  const valid = Array.isArray(value)
    ? Object.keys(value).length === value.length &&
      value.every(
        (entry, index) => Object.prototype.hasOwnProperty.call(value, index) && isExactJsonValue(entry, ancestors),
      )
    : Object.values(value).every((entry) => isExactJsonValue(entry, ancestors))
  ancestors.delete(value)
  return valid
}

function exactJsonRecordClone(value: unknown): Record<string, unknown> | null {
  if (!isPlainRecord(value) || !isExactJsonValue(value)) return null
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function exactJsonValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (left === null || right === null || typeof left !== typeof right) return false
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => exactJsonValuesEqual(entry, right[index]))
    )
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) => Object.prototype.hasOwnProperty.call(right, key) && exactJsonValuesEqual(left[key], right[key]),
    )
  )
}

export function snapshotPersonaJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

export function currentPersonaStateSnapshot(): PersonaStateSnapshot {
  return {
    personas: cloneJsonValue(getDatabase().personas ?? []),
    selectedPersona: getDatabase().selectedPersona,
    username: getDatabase().username,
    userIcon: getDatabase().userIcon,
    personaPrompt: getDatabase().personaPrompt,
    userNote: getDatabase().userNote,
  }
}

export function currentSelectedPersonaProjectionSnapshot(): SelectedPersonaProjectionSnapshot {
  const selectedPersona = getDatabase().personas[getDatabase().selectedPersona]
  return {
    selectedPersona: getDatabase().selectedPersona,
    username: getDatabase().username,
    userIcon: getDatabase().userIcon,
    personaPrompt: getDatabase().personaPrompt,
    userNote: getDatabase().userNote,
    displayName: selectedPersona?.displayName ?? '',
    largePortrait: selectedPersona?.largePortrait ?? false,
  }
}

export function isPersonaSettingsWatcherSuppressed(): boolean {
  return personaSettingsWatcherSuppressed
}

function suppressPersonaSettingsWatcherUntilNextTask(): void {
  const token = ++personaSettingsWatcherSuppressionToken
  personaSettingsWatcherSuppressed = true
  setTimeout(() => {
    if (personaSettingsWatcherSuppressionToken === token) {
      personaSettingsWatcherSuppressed = false
    }
  }, 0)
}

function withSuppressedPersonaSettingsWatcher<T>(callback: () => T): T {
  const token = ++personaSettingsWatcherSuppressionToken
  personaSettingsWatcherSuppressed = true
  try {
    return callback()
  } finally {
    queueMicrotask(() => {
      if (personaSettingsWatcherSuppressionToken === token) {
        personaSettingsWatcherSuppressed = false
      }
    })
  }
}

export function applyPersonaStateSnapshotLocally(snapshot: PersonaStateSnapshot): void {
  suppressPersonaSettingsWatcherUntilNextTask()
  withTrustedResourceWrite(() => {
    getDatabase().personas = cloneJsonValue(snapshot.personas)
    getDatabase().selectedPersona = snapshot.selectedPersona
    getDatabase().username = snapshot.username
    getDatabase().userIcon = snapshot.userIcon
    getDatabase().personaPrompt = snapshot.personaPrompt
    getDatabase().userNote = snapshot.userNote
  })
}

export function restorePersonaStateSnapshot(snapshot: PersonaStateSnapshot): void {
  const token = ++personaSettingsWatcherSuppressionToken
  personaSettingsWatcherSuppressed = true
  try {
    withTrustedResourceWrite(() => {
      getDatabase().personas = cloneJsonValue(snapshot.personas)
      getDatabase().selectedPersona = snapshot.selectedPersona
      getDatabase().username = snapshot.username
      getDatabase().userIcon = snapshot.userIcon
      getDatabase().personaPrompt = snapshot.personaPrompt
      getDatabase().userNote = snapshot.userNote
    })
  } finally {
    queueMicrotask(() => {
      if (personaSettingsWatcherSuppressionToken === token) {
        personaSettingsWatcherSuppressed = false
      }
    })
  }
}

function nonBlankPersonaId(persona: Persona | undefined): string | null {
  const id = persona?.id
  return typeof id === 'string' && id.trim().length > 0 ? id : null
}

function findPersonaIndexById(personas: readonly Persona[], personaId: string | null): number {
  if (!personaId) return -1
  return personas.findIndex((persona) => nonBlankPersonaId(persona) === personaId)
}

function uniquePersonaIdAt(personas: readonly Persona[], index: number): string | null {
  const id = nonBlankPersonaId(personas[index])
  if (!id) return null

  let matches = 0
  for (const persona of personas) {
    if (nonBlankPersonaId(persona) === id) {
      matches += 1
    }
  }
  return matches === 1 ? id : null
}

export function validUniquePersonaIdAt(index: number): string | null {
  return uniquePersonaIdAt(getDatabase().personas ?? [], index)
}

function personaCommandIdList(personas: readonly Persona[] = getDatabase().personas ?? []): string[] | null {
  const ids: string[] = []
  const seen = new Set<string>()

  for (const persona of personas) {
    const id = nonBlankPersonaId(persona)
    if (!id || seen.has(id)) return null
    seen.add(id)
    ids.push(id)
  }

  return ids
}

function stringArraysEqual(left: readonly string[] | null, right: readonly string[] | null): boolean {
  if (!left || !right || left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

export function selectedPersonaId(): string | null {
  return validUniquePersonaIdAt(getDatabase().selectedPersona)
}

function personaOwnerDependencyKeys(...personaIds: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(personaIds.filter((personaId): personaId is string => Boolean(personaId)).map(personaOwnerMutationKey)),
  )
}

function profileMirrorRollbackSnapshotFromState(snapshot: PersonaStateSnapshot): PersonaProfileMirrorRollbackSnapshot {
  return {
    selectedPersona: snapshot.selectedPersona,
    selectedPersonaId: uniquePersonaIdAt(snapshot.personas, snapshot.selectedPersona),
    username: snapshot.username,
    userIcon: snapshot.userIcon,
    personaPrompt: snapshot.personaPrompt,
    userNote: snapshot.userNote,
  }
}

function currentProfileMirrorRollbackSnapshot(): PersonaProfileMirrorRollbackSnapshot {
  return profileMirrorRollbackSnapshotFromState(currentPersonaStateSnapshot())
}

function liveSelectedPersonaMatchesProfileSnapshot(snapshot: PersonaProfileMirrorRollbackSnapshot): boolean {
  if (snapshot.selectedPersonaId) return selectedPersonaId() === snapshot.selectedPersonaId
  return getDatabase().selectedPersona === snapshot.selectedPersona
}

function captureProfileMirrorRollbackMatches(
  attempted: PersonaProfileMirrorRollbackSnapshot,
): PersonaProfileMirrorRollbackMatches {
  const fields = {} as Record<PersonaProfileMirrorField, boolean>
  for (const field of personaProfileMirrorFields) {
    fields[field] = getDatabase()[field] === attempted[field]
  }

  return {
    selectedPersona: liveSelectedPersonaMatchesProfileSnapshot(attempted),
    fields,
    liveSelectedPersonaId: selectedPersonaId(),
  }
}

function resolveProfileMirrorSelectionIndex(snapshot: PersonaProfileMirrorRollbackSnapshot): number {
  const personas = getDatabase().personas ?? []
  const selectedIndexById = findPersonaIndexById(personas, snapshot.selectedPersonaId)
  if (selectedIndexById !== -1) return selectedIndexById
  if (snapshot.selectedPersona >= 0 && snapshot.selectedPersona < personas.length) return snapshot.selectedPersona
  return Math.max(0, Math.min(snapshot.selectedPersona, personas.length - 1))
}

function applyProfileMirrorRollback(
  previous: PersonaProfileMirrorRollbackSnapshot,
  matches: PersonaProfileMirrorRollbackMatches,
): void {
  if (matches.selectedPersona) {
    getDatabase().selectedPersona = resolveProfileMirrorSelectionIndex(previous)
  } else {
    const liveSelectedIndex = findPersonaIndexById(getDatabase().personas ?? [], matches.liveSelectedPersonaId)
    if (liveSelectedIndex !== -1) {
      getDatabase().selectedPersona = liveSelectedIndex
    }
  }

  for (const field of personaProfileMirrorFields) {
    if (matches.fields[field]) {
      getDatabase()[field] = previous[field]
    }
  }
}

function applyCreatePersonaRollback(input: {
  createdPersonaId: string
  attemptedCreatedPersona: Persona
  previousProfile: PersonaProfileMirrorRollbackSnapshot
  attemptedProfile: PersonaProfileMirrorRollbackSnapshot
}): void {
  withSuppressedPersonaSettingsWatcher(() => {
    withTrustedResourceWrite(() => {
      const matches = captureProfileMirrorRollbackMatches(input.attemptedProfile)
      applyAttemptedKeyedListRollback<Persona, string>({
        list: getDatabase().personas,
        entries: [
          {
            key: input.createdPersonaId,
            previous: null,
            attempted: input.attemptedCreatedPersona,
          },
        ],
        getKey: nonBlankPersonaId,
      })
      applyProfileMirrorRollback(input.previousProfile, matches)
    })
  })
}

function applyDeletePersonaRollback(input: {
  deletedPersonaId: string
  previousIndex: number
  previousPersona: Persona
  previousProfile: PersonaProfileMirrorRollbackSnapshot
  attemptedProfile: PersonaProfileMirrorRollbackSnapshot
}): void {
  withSuppressedPersonaSettingsWatcher(() => {
    withTrustedResourceWrite(() => {
      const matches = captureProfileMirrorRollbackMatches(input.attemptedProfile)
      const existingIndex = findPersonaIndexById(getDatabase().personas ?? [], input.deletedPersonaId)
      if (existingIndex === -1) {
        const insertIndex = Math.max(0, Math.min(input.previousIndex, getDatabase().personas.length))
        getDatabase().personas.splice(insertIndex, 0, cloneJsonValue(input.previousPersona))
      }
      applyProfileMirrorRollback(input.previousProfile, matches)
    })
  })
}

function applyReorderPersonaRollback(input: { previousPersonaIds: string[]; attemptedPersonaIds: string[] }): void {
  withSuppressedPersonaSettingsWatcher(() => {
    withTrustedResourceWrite(() => {
      if (!stringArraysEqual(personaCommandIdList(), input.attemptedPersonaIds)) return

      const liveSelectedPersonaId = selectedPersonaId()
      const personasById = new Map<string, Persona>()
      for (const persona of getDatabase().personas) {
        const id = nonBlankPersonaId(persona)
        if (id) personasById.set(id, persona)
      }

      const previousOrder = input.previousPersonaIds
        .map((id) => personasById.get(id))
        .filter((persona): persona is Persona => Boolean(persona))
      if (previousOrder.length !== getDatabase().personas.length) return

      getDatabase().personas = previousOrder
      const selectedIndex = findPersonaIndexById(getDatabase().personas, liveSelectedPersonaId)
      if (selectedIndex !== -1) {
        getDatabase().selectedPersona = selectedIndex
      }
    })
  })
}

function personaRowRollbackKeyForPatchKey(key: string): PersonaRowRollbackField | null {
  return personaRowRollbackFields.has(key as PersonaRowRollbackField) ? (key as PersonaRowRollbackField) : null
}

function personaRowRollbackKeysForPatch(patch: PersonaSnapshot): PersonaRowRollbackField[] {
  const keys: PersonaRowRollbackField[] = []
  for (const key of Object.keys(patch)) {
    const rowKey = personaRowRollbackKeyForPatchKey(key)
    if (rowKey) keys.push(rowKey)
  }
  return keys
}

function legacyProfileFieldForRowField(field: PersonaRowRollbackField): PersonaProfileMirrorField | null {
  if (field === 'name') return 'username'
  if (field === 'icon') return 'userIcon'
  if (field === 'personaPrompt') return 'personaPrompt'
  if (field === 'note') return 'userNote'
  return null
}

function legacyProfileRollbackKeysForRowKeys(rowKeys: readonly PersonaRowRollbackField[]): PersonaProfileMirrorField[] {
  const keys: PersonaProfileMirrorField[] = []
  for (const rowKey of rowKeys) {
    const legacyKey = legacyProfileFieldForRowField(rowKey)
    if (legacyKey && !keys.includes(legacyKey)) keys.push(legacyKey)
  }
  return keys
}

function personaRowFromSnapshot(snapshot: PersonaStateSnapshot, personaId: string): Persona | null {
  const index = findPersonaIndexById(snapshot.personas, personaId)
  return index === -1 ? null : snapshot.personas[index]
}

function personaPatchOptimisticAcknowledgement(input: {
  personaId: string
  patch: PersonaSnapshot
  attempted: PersonaStateSnapshot
  mirrorLegacyProfile: boolean
  collectionProjectionEpoch?: number
  settingsProjectionEpoch?: number
}): PersonaPatchOptimisticAcknowledgement | undefined {
  const attemptedPatch = exactJsonRecordClone(input.patch)
  const attemptedPersona = exactJsonRecordClone(personaRowFromSnapshot(input.attempted, input.personaId))
  if (
    !attemptedPatch ||
    Object.keys(attemptedPatch).length === 0 ||
    !attemptedPersona ||
    attemptedPersona.id !== input.personaId ||
    Object.entries(attemptedPatch).some(
      ([key, value]) =>
        !Object.prototype.hasOwnProperty.call(attemptedPersona, key) ||
        !exactJsonValuesEqual(attemptedPersona[key], value),
    )
  ) {
    return undefined
  }

  const legacyProfileProjectionExpected =
    input.mirrorLegacyProfile &&
    uniquePersonaIdAt(input.attempted.personas, input.attempted.selectedPersona) === input.personaId
  const deterministicLegacyProfile: PersonaLegacyProfileProjection = {
    username: typeof attemptedPersona.name === 'string' ? attemptedPersona.name : '',
    userIcon: typeof attemptedPersona.icon === 'string' ? attemptedPersona.icon : '',
    personaPrompt: typeof attemptedPersona.personaPrompt === 'string' ? attemptedPersona.personaPrompt : '',
    userNote: typeof attemptedPersona.note === 'string' ? attemptedPersona.note : '',
  }
  const attemptedLegacyProfile: PersonaLegacyProfileProjection = {
    username: input.attempted.username,
    userIcon: input.attempted.userIcon,
    personaPrompt: input.attempted.personaPrompt,
    userNote: input.attempted.userNote,
  }
  if (
    legacyProfileProjectionExpected &&
    Object.keys(deterministicLegacyProfile).some(
      (key) =>
        attemptedLegacyProfile[key as keyof PersonaLegacyProfileProjection] !==
        deterministicLegacyProfile[key as keyof PersonaLegacyProfileProjection],
    )
  ) {
    return undefined
  }

  return {
    collectionProjectionEpoch: input.collectionProjectionEpoch ?? captureCollectionProjectionEpoch('personas'),
    settingsProjectionEpoch: input.settingsProjectionEpoch ?? captureSettingsProjectionEpoch(),
    attemptedPersona: attemptedPersona as PersonaSnapshot & { id: string },
    attemptedLegacyProfile,
    legacyProfileProjectionExpected,
  }
}

export function personaMutationOptimisticAcknowledgement(input: {
  operation: PersonaMutationOperation
  previous: PersonaStateSnapshot
  attempted: PersonaStateSnapshot
  mirrorLegacyProfile: boolean
  saveCurrent: boolean
  collectionProjectionEpoch?: number
  settingsProjectionEpoch?: number
}): PersonaMutationOptimisticAcknowledgement | undefined {
  const beforePersonaIds = personaCommandIdList(input.previous.personas)
  const attemptedPersonaIds = personaCommandIdList(input.attempted.personas)
  if (!beforePersonaIds || !attemptedPersonaIds) return undefined
  const attemptedPersonas: Array<PersonaSnapshot & { id: string }> = []
  for (let index = 0; index < input.attempted.personas.length; index += 1) {
    const persona = exactJsonRecordClone(input.attempted.personas[index])
    if (!persona || persona.id !== attemptedPersonaIds[index]) return undefined
    attemptedPersonas.push(persona as PersonaSnapshot & { id: string })
  }

  const beforeSelectedPersonaId = uniquePersonaIdAt(input.previous.personas, input.previous.selectedPersona)
  const attemptedSelectedPersonaId = uniquePersonaIdAt(input.attempted.personas, input.attempted.selectedPersona)
  if (input.mirrorLegacyProfile && !attemptedSelectedPersonaId) return undefined

  const attemptedLegacyProfile = input.mirrorLegacyProfile ? personaProfileDigestValueFromState(input.attempted) : null
  if (attemptedLegacyProfile && attemptedSelectedPersonaId) {
    const selectedPersona = personaRowFromSnapshot(input.attempted, attemptedSelectedPersonaId)
    if (!selectedPersona || !personaProfileDigestValueMatchesPersona(attemptedLegacyProfile, selectedPersona)) {
      return undefined
    }
  }

  const savedPersonaId = input.saveCurrent ? beforeSelectedPersonaId : null
  const attemptedSavedPersonaProfile = savedPersonaId ? personaProfileDigestValueFromState(input.previous) : null
  if (attemptedSavedPersonaProfile && input.operation !== 'delete') {
    const savedPersona = personaRowFromSnapshot(input.attempted, savedPersonaId)
    if (!savedPersona || !personaProfileDigestValueMatchesPersona(attemptedSavedPersonaProfile, savedPersona)) {
      return undefined
    }
  }
  if (attemptedSavedPersonaProfile && input.operation === 'delete' && attemptedPersonaIds.includes(savedPersonaId)) {
    const savedPersona = personaRowFromSnapshot(input.attempted, savedPersonaId)
    if (!savedPersona || !personaProfileDigestValueMatchesPersona(attemptedSavedPersonaProfile, savedPersona)) {
      return undefined
    }
  }

  const collectionWritten = input.operation !== 'select' || input.saveCurrent
  const settingsWritten =
    input.mirrorLegacyProfile ||
    (input.operation !== 'create' && input.previous.selectedPersona !== input.attempted.selectedPersona)
  return {
    operation: input.operation,
    collectionProjectionEpoch: input.collectionProjectionEpoch ?? captureCollectionProjectionEpoch('personas'),
    settingsProjectionEpoch: input.settingsProjectionEpoch ?? captureSettingsProjectionEpoch(),
    beforePersonaIds,
    attemptedPersonaIds,
    attemptedPersonas,
    beforeSelectedPersonaId,
    attemptedSelectedPersonaId,
    collectionWritten,
    settingsWritten,
    legacyProfileProjectionExpected: input.mirrorLegacyProfile,
    attemptedLegacyProfile,
  }
}

function personaProfileDigestValueFromState(snapshot: PersonaStateSnapshot): {
  name: string
  icon: string
  personaPrompt: string
  note: string
} {
  return {
    name: snapshot.username,
    icon: snapshot.userIcon,
    personaPrompt: snapshot.personaPrompt,
    note: snapshot.userNote,
  }
}

function personaProfileDigestValueMatchesPersona(
  profile: ReturnType<typeof personaProfileDigestValueFromState>,
  persona: Persona,
): boolean {
  return (
    profile.name === (persona.name ?? '') &&
    profile.icon === (persona.icon ?? '') &&
    profile.personaPrompt === (persona.personaPrompt ?? '') &&
    profile.note === (persona.note ?? '')
  )
}

function applyPersonaRowFieldRollback(input: {
  personaId: string
  previous: Persona | null
  attempted: Persona | null
  keys: readonly PersonaRowRollbackField[]
}): void {
  if (!input.previous || !input.attempted || input.keys.length === 0) return
  const liveIndex = findPersonaIndexById(getDatabase().personas ?? [], input.personaId)
  if (liveIndex === -1) return

  applyAttemptedFieldRollback({
    target: getDatabase().personas[liveIndex] as unknown as Record<string, unknown>,
    previous: input.previous as unknown as Record<string, unknown>,
    attempted: input.attempted as unknown as Record<string, unknown>,
    keys: input.keys,
    deleteMissingPrevious: true,
  })
}

function applyPersonaProfileFieldRollback(input: {
  previousProfile: PersonaProfileMirrorRollbackSnapshot
  attemptedProfile: PersonaProfileMirrorRollbackSnapshot
  keys: readonly PersonaProfileMirrorField[]
}): void {
  if (input.keys.length === 0) return
  if (!liveSelectedPersonaMatchesProfileSnapshot(input.attemptedProfile)) return

  applyAttemptedFieldRollback({
    target: getDatabase() as unknown as Record<string, unknown>,
    previous: input.previousProfile as unknown as Record<string, unknown>,
    attempted: input.attemptedProfile as unknown as Record<string, unknown>,
    keys: input.keys,
  })
}

function applyPersonaProfileCommandRollback(input: {
  personaId: string
  previous: PersonaStateSnapshot
  attempted: PersonaStateSnapshot
  rowKeys: readonly PersonaRowRollbackField[]
  legacyKeys?: readonly PersonaProfileMirrorField[]
}): void {
  withSuppressedPersonaSettingsWatcher(() => {
    withTrustedResourceWrite(() => {
      applyPersonaRowFieldRollback({
        personaId: input.personaId,
        previous: personaRowFromSnapshot(input.previous, input.personaId),
        attempted: personaRowFromSnapshot(input.attempted, input.personaId),
        keys: input.rowKeys,
      })
      applyPersonaProfileFieldRollback({
        previousProfile: profileMirrorRollbackSnapshotFromState(input.previous),
        attemptedProfile: profileMirrorRollbackSnapshotFromState(input.attempted),
        keys: input.legacyKeys ?? legacyProfileRollbackKeysForRowKeys(input.rowKeys),
      })
    })
  })
}

function allPersonaProfileMirrorFieldsMatch(snapshot: PersonaProfileMirrorRollbackSnapshot): boolean {
  return personaProfileMirrorFields.every((field) => getDatabase()[field] === snapshot[field])
}

function applySelectPersonaRollback(input: {
  previous: PersonaStateSnapshot
  attempted: PersonaStateSnapshot
  saveCurrent: boolean
}): void {
  withSuppressedPersonaSettingsWatcher(() => {
    withTrustedResourceWrite(() => {
      if (input.saveCurrent) {
        const savedPersonaId = uniquePersonaIdAt(input.previous.personas, input.previous.selectedPersona)
        if (savedPersonaId) {
          applyPersonaRowFieldRollback({
            personaId: savedPersonaId,
            previous: personaRowFromSnapshot(input.previous, savedPersonaId),
            attempted: personaRowFromSnapshot(input.attempted, savedPersonaId),
            keys: personaRowProfileFields,
          })
        }
      }

      const previousProfile = profileMirrorRollbackSnapshotFromState(input.previous)
      const attemptedProfile = profileMirrorRollbackSnapshotFromState(input.attempted)
      if (!liveSelectedPersonaMatchesProfileSnapshot(attemptedProfile)) return
      if (!allPersonaProfileMirrorFieldsMatch(attemptedProfile)) return

      getDatabase().selectedPersona = resolveProfileMirrorSelectionIndex(previousProfile)
      applyAttemptedFieldRollback({
        target: getDatabase() as unknown as Record<string, unknown>,
        previous: previousProfile as unknown as Record<string, unknown>,
        attempted: attemptedProfile as unknown as Record<string, unknown>,
        keys: personaProfileMirrorFields,
      })
    })
  })
}

function applyImportPersonaRollback(input: { createdPersonaId: string; attemptedPersona: Persona }): void {
  withSuppressedPersonaSettingsWatcher(() => {
    withTrustedResourceWrite(() => {
      const liveSelectedPersonaId = selectedPersonaId()
      const rolledBack = applyAttemptedKeyedListRollback<Persona, string>({
        list: getDatabase().personas,
        entries: [
          {
            key: input.createdPersonaId,
            previous: null,
            attempted: input.attemptedPersona,
          },
        ],
        getKey: nonBlankPersonaId,
      })
      if (rolledBack.length === 0) return

      const selectedIndex = findPersonaIndexById(getDatabase().personas, liveSelectedPersonaId)
      if (selectedIndex !== -1) {
        getDatabase().selectedPersona = selectedIndex
      } else if (getDatabase().selectedPersona >= getDatabase().personas.length) {
        getDatabase().selectedPersona = Math.max(0, getDatabase().personas.length - 1)
      }
    })
  })
}

function registerPendingImportedPersonaCreate(persona: Persona): PendingImportedPersonaCreate {
  const attempt: PendingImportedPersonaCreate = {
    operationId: nextImportedPersonaCreateOperationId++,
    personaId: persona.id,
    draftPersona: cloneJsonValue(persona),
    collectionProjectionEpoch: captureCollectionProjectionEpoch('personas'),
  }
  pendingImportedPersonaCreates.push(attempt)
  return attempt
}

function removePendingImportedPersonaCreate(operationId: number): void {
  const index = pendingImportedPersonaCreates.findIndex((attempt) => attempt.operationId === operationId)
  if (index !== -1) pendingImportedPersonaCreates.splice(index, 1)
}

function updatePendingImportedPersonaDraft(personaId: string, attempted: PersonaStateSnapshot): void {
  const persona = personaRowFromSnapshot(attempted, personaId)
  if (!persona) return
  for (const attempt of pendingImportedPersonaCreates) {
    if (attempt.personaId === personaId) attempt.draftPersona = cloneJsonValue(persona)
  }
}

function reassertPendingImportedPersonaCreates(): void {
  if (pendingImportedPersonaCreates.length === 0) return
  const selectedId = selectedPersonaId()

  withSuppressedPersonaSettingsWatcher(() => {
    withTrustedResourceWrite(() => {
      for (const attempt of [...pendingImportedPersonaCreates].sort(
        (left, right) => left.operationId - right.operationId,
      )) {
        const existingIndex = findPersonaIndexById(getDatabase().personas, attempt.personaId)
        if (existingIndex !== -1) {
          if (hasCollectionProjectionEpochChanged('personas', attempt.collectionProjectionEpoch)) {
            removePendingImportedPersonaCreate(attempt.operationId)
            continue
          }
          attempt.draftPersona = cloneJsonValue(getDatabase().personas[existingIndex])
          continue
        }
        getDatabase().personas.push(cloneJsonValue(attempt.draftPersona))
        attempt.collectionProjectionEpoch = captureCollectionProjectionEpoch('personas')
      }

      const selectedIndex = findPersonaIndexById(getDatabase().personas, selectedId)
      if (selectedIndex !== -1) getDatabase().selectedPersona = selectedIndex
    })
  })
}

function personaPatchFromLegacyProfile(): PersonaSnapshot {
  const selectedPersona = getDatabase().personas[getDatabase().selectedPersona]
  return {
    name: getDatabase().username,
    displayName: selectedPersona?.displayName ?? '',
    icon: getDatabase().userIcon,
    personaPrompt: getDatabase().personaPrompt,
    note: getDatabase().userNote,
  }
}

function selectedPersonaPatch(): PersonaSnapshot {
  return {
    ...personaPatchFromLegacyProfile(),
    largePortrait: getDatabase().personas[getDatabase().selectedPersona]?.largePortrait ?? false,
  }
}

function selectedPersonaPatchFromState(snapshot: PersonaStateSnapshot, personaId: string): PersonaSnapshot | null {
  const personaIndex = findPersonaIndexById(snapshot.personas, personaId)
  if (personaIndex < 0) return null
  const persona = snapshot.personas[personaIndex]
  const selectedId = uniquePersonaIdAt(snapshot.personas, snapshot.selectedPersona)
  const selected = selectedId === personaId
  return {
    name: selected ? snapshot.username : persona.name,
    displayName: persona.displayName ?? '',
    icon: selected ? snapshot.userIcon : persona.icon,
    personaPrompt: selected ? snapshot.personaPrompt : persona.personaPrompt,
    note: selected ? snapshot.userNote : persona.note,
    largePortrait: persona.largePortrait ?? false,
  }
}

function changedSelectedPersonaPatch(
  personaId: string,
  previous: PersonaStateSnapshot,
  attempted: PersonaStateSnapshot,
): PersonaSnapshot {
  const previousPatch = selectedPersonaPatchFromState(previous, personaId)
  const attemptedPatch = selectedPersonaPatchFromState(attempted, personaId)
  if (!attemptedPatch) return {}
  if (!previousPatch) return cloneJsonValue(attemptedPatch)

  const changed: PersonaSnapshot = {}
  for (const [key, value] of Object.entries(attemptedPatch)) {
    if (snapshotPersonaJson(previousPatch[key]) !== snapshotPersonaJson(value)) {
      changed[key] = cloneJsonValue(value)
    }
  }
  return changed
}

function changedPersonaProfilePatch(
  personaId: string,
  previous: PersonaStateSnapshot,
  attempted: PersonaStateSnapshot,
): PersonaSnapshot {
  const previousPersona = personaRowFromSnapshot(previous, personaId)
  const attemptedPersona = personaRowFromSnapshot(attempted, personaId)
  if (!attemptedPersona) return {}

  const previousRow: PersonaSnapshot | null = previousPersona
    ? {
        name: previousPersona.name ?? '',
        displayName: previousPersona.displayName ?? '',
        icon: previousPersona.icon ?? '',
        personaPrompt: previousPersona.personaPrompt ?? '',
        note: previousPersona.note ?? '',
        largePortrait: previousPersona.largePortrait ?? false,
      }
    : null
  const attemptedRow: PersonaSnapshot = {
    name: attemptedPersona.name ?? '',
    displayName: attemptedPersona.displayName ?? '',
    icon: attemptedPersona.icon ?? '',
    personaPrompt: attemptedPersona.personaPrompt ?? '',
    note: attemptedPersona.note ?? '',
    largePortrait: attemptedPersona.largePortrait ?? false,
  }
  const changed = changedSelectedPersonaPatch(personaId, previous, attempted)
  for (const [key, value] of Object.entries(attemptedRow)) {
    if (!previousRow || snapshotPersonaJson(previousRow[key]) !== snapshotPersonaJson(value)) {
      changed[key] = cloneJsonValue(value)
    }
  }
  return changed
}

function selectedPersonaProfileRowField(
  field: SelectedPersonaProfileField | 'userIcon',
): 'name' | 'icon' | 'note' | 'personaPrompt' {
  if (field === 'username') return 'name'
  if (field === 'userIcon') return 'icon'
  if (field === 'userNote') return 'note'
  return 'personaPrompt'
}

function isSelectedPersonaProfileField(
  field: SelectedPersonaDirtyField,
): field is SelectedPersonaProfileField | 'userIcon' {
  return field === 'username' || field === 'userIcon' || field === 'userNote' || field === 'personaPrompt'
}

function selectedPersonaFieldProjectionValue(
  persona: Persona | undefined,
  field: SelectedPersonaDirtyField,
): string | boolean | undefined {
  if (field === 'largePortrait') {
    return persona?.largePortrait ?? false
  }
  if (field === 'displayName') {
    return persona?.displayName ?? ''
  }
  const rowField = selectedPersonaProfileRowField(field)
  return persona?.[rowField] ?? ''
}

function selectedPersonaLegacyProjectionValue(field: SelectedPersonaProfileField | 'userIcon'): string {
  return getDatabase()[field] ?? ''
}

function markSelectedPersonaFieldDirty(field: SelectedPersonaDirtyField, value: string | boolean): void {
  const personaId = selectedPersonaId()
  if (!personaId) return
  let dirtyFields = dirtySelectedPersonaFieldsById.get(personaId)
  if (!dirtyFields) {
    dirtyFields = new Map()
    dirtySelectedPersonaFieldsById.set(personaId, dirtyFields)
  }
  dirtyFields.set(field, value)
}

function selectedPersonaDirtyFieldForRowField(field: PersonaRowRollbackField): SelectedPersonaDirtyField {
  if (field === 'name') return 'username'
  if (field === 'icon') return 'userIcon'
  if (field === 'note') return 'userNote'
  return field
}

function markPersonaPatchDirtyFields(personaId: string, attempted: PersonaStateSnapshot, patch: PersonaSnapshot): void {
  if (uniquePersonaIdAt(attempted.personas, attempted.selectedPersona) !== personaId) return
  const attemptedPersona = personaRowFromSnapshot(attempted, personaId)
  if (!attemptedPersona) return

  for (const rowField of personaRowRollbackKeysForPatch(patch)) {
    const field = selectedPersonaDirtyFieldForRowField(rowField)
    const value = selectedPersonaFieldProjectionValue(attemptedPersona, field)
    if (value !== undefined) markSelectedPersonaFieldDirty(field, value)
  }
}

function clearPersonaPatchDirtyFields(
  personaId: string,
  attempted: PersonaStateSnapshot,
  rowFields: readonly PersonaRowRollbackField[],
): void {
  const dirtyFields = dirtySelectedPersonaFieldsById.get(personaId)
  const attemptedPersona = personaRowFromSnapshot(attempted, personaId)
  if (!dirtyFields || !attemptedPersona) return

  for (const rowField of rowFields) {
    const field = selectedPersonaDirtyFieldForRowField(rowField)
    const attemptedValue = selectedPersonaFieldProjectionValue(attemptedPersona, field)
    if (attemptedValue !== undefined && dirtyFields.get(field) === attemptedValue) {
      dirtyFields.delete(field)
    }
  }
  if (dirtyFields.size === 0) dirtySelectedPersonaFieldsById.delete(personaId)
}

function clearDirtySelectedPersonaFieldsMatchingProjection(
  persona: Persona | undefined,
  dirtyFields: Map<SelectedPersonaDirtyField, string | boolean>,
): void {
  for (const [field, value] of Array.from(dirtyFields.entries())) {
    const rowValue = selectedPersonaFieldProjectionValue(persona, field)
    const projectionMatchesDirtyValue =
      field === 'largePortrait'
        ? rowValue === value
        : field === 'displayName'
          ? rowValue === value
          : rowValue === value && selectedPersonaLegacyProjectionValue(field) === value
    if (projectionMatchesDirtyValue) {
      dirtyFields.delete(field)
    }
  }
}

/**
 * Settle only dirty fields covered by this accepted PATCH and only while the
 * dirty value still matches that command's attempted value. A newer edit to
 * the same field remains dirty for its own queued command.
 */
export function settleAcceptedPersonaPatchDirtyFields(
  personaId: string,
  attemptedPatch: PersonaSnapshot,
  attemptedPersona: PersonaSnapshot,
  legacyProfileProjectionApplied: boolean,
): void {
  const dirtyFields = dirtySelectedPersonaFieldsById.get(personaId)
  if (!dirtyFields || dirtyFields.size === 0) return

  const acceptedFields: SelectedPersonaDirtyField[] = []
  if (legacyProfileProjectionApplied) {
    if (Object.prototype.hasOwnProperty.call(attemptedPatch, 'name')) acceptedFields.push('username')
    if (Object.prototype.hasOwnProperty.call(attemptedPatch, 'icon')) acceptedFields.push('userIcon')
    if (Object.prototype.hasOwnProperty.call(attemptedPatch, 'note')) acceptedFields.push('userNote')
    if (Object.prototype.hasOwnProperty.call(attemptedPatch, 'personaPrompt')) {
      acceptedFields.push('personaPrompt')
    }
  }
  if (Object.prototype.hasOwnProperty.call(attemptedPatch, 'displayName')) acceptedFields.push('displayName')
  if (Object.prototype.hasOwnProperty.call(attemptedPatch, 'largePortrait')) acceptedFields.push('largePortrait')

  for (const field of acceptedFields) {
    const attemptedValue = selectedPersonaFieldProjectionValue(attemptedPersona as Persona, field)
    if (attemptedValue !== undefined && dirtyFields.get(field) === attemptedValue) {
      dirtyFields.delete(field)
    }
  }
  if (dirtyFields.size === 0) dirtySelectedPersonaFieldsById.delete(personaId)
}

subscribeServerCommandLocalEffectApplied((_event, localEffect) => {
  if (localEffect.kind === 'personaMutation' && localEffect.operation === 'create' && localEffect.targetPersonaId) {
    for (const attempt of [...pendingImportedPersonaCreates]) {
      if (attempt.personaId === localEffect.targetPersonaId) {
        removePendingImportedPersonaCreate(attempt.operationId)
      }
    }
    return
  }
  if (localEffect.kind !== 'personaPatch') return
  settleAcceptedPersonaPatchDirtyFields(
    localEffect.personaId,
    localEffect.attemptedPatch,
    localEffect.attemptedPersona,
    localEffect.legacyProfileProjectionApplied,
  )
})

export function reconcileSelectedPersonaProjectionEpoch(): void {
  reassertPendingImportedPersonaCreates()
  const personaId = selectedPersonaId()
  if (!personaId) return
  const dirtyFields = dirtySelectedPersonaFieldsById.get(personaId)
  if (!dirtyFields || dirtyFields.size === 0) return

  const selectedIndex = getDatabase().selectedPersona
  const selectedPersona = getDatabase().personas[selectedIndex]
  if (nonBlankPersonaId(selectedPersona) !== personaId) return

  clearDirtySelectedPersonaFieldsMatchingProjection(selectedPersona, dirtyFields)
  if (dirtyFields.size === 0) {
    dirtySelectedPersonaFieldsById.delete(personaId)
    return
  }

  withSuppressedPersonaSettingsWatcher(() => {
    withTrustedResourceWrite(() => {
      if (getDatabase().selectedPersona !== selectedIndex) return
      const persona = getDatabase().personas[selectedIndex]
      if (nonBlankPersonaId(persona) !== personaId) return

      for (const [field, value] of dirtyFields) {
        if (field === 'largePortrait') {
          persona.largePortrait = value === true
          continue
        }
        if (field === 'displayName') {
          persona.displayName = String(value)
          continue
        }
        if (!isSelectedPersonaProfileField(field)) continue

        const stringValue = String(value)
        getDatabase()[field] = stringValue
        persona[selectedPersonaProfileRowField(field)] = stringValue
      }
    })
  })
}

function clearPendingSelectedPersonaUpdate(): void {
  if (pendingPersonaUpdate.timer) {
    clearTimeout(pendingPersonaUpdate.timer)
  }
  pendingPersonaUpdate.timer = null
  pendingPersonaUpdate.previous = null
  pendingPersonaUpdate.durableAttempted = null
  pendingPersonaUpdate.attempted = null
  pendingPersonaUpdate.personaId = null
  pendingPersonaUpdate.patch = null
  pendingPersonaUpdate.collectionProjectionEpoch = null
  pendingPersonaUpdate.settingsProjectionEpoch = null
  pendingPersonaUpdate.intent = null
  if (pendingPersonaUpdate.outbox) void acknowledgePendingMutation(pendingPersonaUpdate.outbox)
  pendingPersonaUpdate.outbox = null
}

interface PersonaCommandAcknowledgementTaintScope {
  personas: boolean
  settings: boolean
}

function taintPersonaCommandAcknowledgements(scope: PersonaCommandAcknowledgementTaintScope): void {
  if (scope.personas) markCollectionAcknowledgementTainted('personas')
  if (scope.settings) markSettingsAcknowledgementTainted()
}

function personaCommandRollback(scope: PersonaCommandAcknowledgementTaintScope, rollback?: () => void): () => void {
  return () => {
    taintPersonaCommandAcknowledgements(scope)
    rollback?.()
  }
}

async function isPersonaMutationRetained(outbox: PendingMutationHandle | null): Promise<boolean> {
  if (!outbox?.ownerWriterSessionId || outbox.writerEpoch === null || !outbox.databaseLineage) return false
  return isPendingMutationCurrent(outbox)
}

async function personaPersistenceStatus(
  result: ServerCommandResult,
  outbox: PendingMutationHandle,
): Promise<PersonaPersistenceStatus> {
  if (result.status === 'ok') return 'accepted'
  return (await isPersonaMutationRetained(outbox)) ? 'queued' : 'failed'
}

function settlePersonaStructuralMutation(
  mutation: Promise<ServerCommandResult>,
  outbox: PendingMutationHandle,
): Promise<PersonaPersistenceStatus> {
  return mutation.then(
    (result) => personaPersistenceStatus(result, outbox),
    async () => ((await isPersonaMutationRetained(outbox)) ? 'queued' : 'failed'),
  )
}

function dispatchPersonaProfilePatch(input: {
  personaId: string
  patch: PersonaSnapshot
  previous: PersonaStateSnapshot
  attempted: PersonaStateSnapshot
  rollbackRowKeys: readonly PersonaRowRollbackField[]
  rollbackLegacyKeys?: readonly PersonaProfileMirrorField[]
  projectionLegacyKeys?: readonly PersonaProfileMirrorField[]
}): Promise<PersonaPersistenceStatus> {
  if (!canUseServerCommands()) return Promise.resolve('accepted')

  void flushPendingSelectedPersonaUpdate()
  markPersonaPatchDirtyFields(input.personaId, input.attempted, input.patch)
  updatePendingImportedPersonaDraft(input.personaId, input.attempted)

  const optimisticAcknowledgement = personaPatchOptimisticAcknowledgement({
    personaId: input.personaId,
    patch: input.patch,
    attempted: input.attempted,
    mirrorLegacyProfile: true,
  })
  const intent = selectedPersonaUpdateDurableIntent(input.personaId, input.patch)
  const outbox = stagePendingMutation(personaOwnerMutationKey(input.personaId), intent)
  const legacyKeys = input.rollbackLegacyKeys ?? legacyProfileRollbackKeysForRowKeys(input.rollbackRowKeys)
  const projectionLegacyKeys =
    input.projectionLegacyKeys ?? legacyProfileRollbackKeysForRowKeys(personaRowRollbackKeysForPatch(input.patch))
  recordPendingMutationProjectionTargets(outbox, projectionLegacyKeys.map(pendingMutationSettingsFieldProjectionTarget))

  return dispatchDurableMutation(outbox, intent, (transport) =>
    runServerCommand({
      command: (baseRevision) =>
        updatePersonaCommand({
          baseRevision,
          personaId: input.personaId,
          patch: input.patch,
          mirrorLegacyProfile: true,
          optimisticAcknowledgement,
        }),
      rollback: personaCommandRollback({ personas: true, settings: true }, () => {
        applyPersonaProfileCommandRollback({
          personaId: input.personaId,
          previous: input.previous,
          attempted: input.attempted,
          rowKeys: input.rollbackRowKeys,
          legacyKeys,
        })
        clearPersonaPatchDirtyFields(input.personaId, input.attempted, input.rollbackRowKeys)
      }),
      ...transport,
    }),
  ).then(
    (result) => personaPersistenceStatus(result, outbox),
    async () => ((await isPersonaMutationRetained(outbox)) ? 'queued' : 'failed'),
  )
}

function dispatchCreatePersona(persona: Persona, previous: PersonaStateSnapshot): Promise<PersonaPersistenceStatus> {
  if (!canUseServerCommands()) return Promise.resolve('accepted')
  const createdPersonaId = nonBlankPersonaId(persona)
  if (!createdPersonaId) return Promise.resolve('failed')
  const previousPersonaId = uniquePersonaIdAt(previous.personas, previous.selectedPersona)
  const previousProfile = profileMirrorRollbackSnapshotFromState(previous)
  const attemptedProfile = currentProfileMirrorRollbackSnapshot()
  const attempted = currentPersonaStateSnapshot()
  const attemptedCreatedPersona = cloneJsonValue(persona)
  const optimisticAcknowledgement = personaMutationOptimisticAcknowledgement({
    operation: 'create',
    previous,
    attempted,
    mirrorLegacyProfile: true,
    saveCurrent: false,
  })
  void flushPendingSelectedPersonaUpdate()
  const intent: DurableMutationIntent = {
    version: 1,
    requests: [
      {
        method: 'POST',
        path: '/personas',
        body: {
          persona: cloneJsonValue(attemptedCreatedPersona) as PersonaSnapshot,
          mirrorLegacyProfile: true,
        },
      },
    ],
    dependencyKeys: personaOwnerDependencyKeys(previousPersonaId),
  }
  const outbox = stagePendingMutation(PERSONA_SELECTION_MUTATION_KEY, intent)
  return settlePersonaStructuralMutation(
    dispatchDurableMutation(outbox, intent, (transport) =>
      runServerCommand({
        command: (baseRevision) =>
          createPersonaCommand({
            baseRevision,
            persona: cloneJsonValue(attemptedCreatedPersona) as PersonaSnapshot,
            mirrorLegacyProfile: true,
            optimisticAcknowledgement,
          }),
        rollback: personaCommandRollback({ personas: true, settings: true }, () =>
          applyCreatePersonaRollback({
            createdPersonaId,
            attemptedCreatedPersona,
            previousProfile,
            attemptedProfile,
          }),
        ),
        ...transport,
      }),
    ),
    outbox,
  )
}

function dispatchImportedPersonaCreate(
  persona: Persona,
  previous: PersonaStateSnapshot,
): Promise<PersonaPersistenceStatus> {
  if (!canUseServerCommands()) return Promise.resolve('accepted')
  const personaId = nonBlankPersonaId(persona)
  if (!personaId) return Promise.resolve('failed')

  const attemptedPersona = cloneJsonValue(persona)
  const attempted = currentPersonaStateSnapshot()
  const optimisticAcknowledgement = personaMutationOptimisticAcknowledgement({
    operation: 'create',
    previous,
    attempted,
    mirrorLegacyProfile: false,
    saveCurrent: false,
  })
  void flushPendingSelectedPersonaUpdate()
  const intent: DurableMutationIntent = {
    version: 1,
    requests: [
      {
        method: 'POST',
        path: '/personas',
        body: { persona: cloneJsonValue(attemptedPersona) as PersonaSnapshot },
      },
    ],
    dependencyKeys: personaOwnerDependencyKeys(uniquePersonaIdAt(previous.personas, previous.selectedPersona)),
  }
  const attempt = registerPendingImportedPersonaCreate(attemptedPersona)
  const outbox = stagePendingMutation(PERSONA_SELECTION_MUTATION_KEY, intent)

  return dispatchDurableMutation(outbox, intent, (transport) =>
    runServerCommand({
      command: (baseRevision) =>
        createPersonaCommand({
          baseRevision,
          persona: cloneJsonValue(attemptedPersona) as PersonaSnapshot,
          optimisticAcknowledgement,
        }),
      rollback: personaCommandRollback({ personas: true, settings: false }, () => {
        removePendingImportedPersonaCreate(attempt.operationId)
        applyImportPersonaRollback({
          createdPersonaId: personaId,
          attemptedPersona,
        })
      }),
      ...transport,
    }),
  ).then(
    async (result) => {
      const status = await personaPersistenceStatus(result, outbox)
      if (status !== 'queued') removePendingImportedPersonaCreate(attempt.operationId)
      return status
    },
    async () => {
      const retained = await isPersonaMutationRetained(outbox)
      if (!retained) removePendingImportedPersonaCreate(attempt.operationId)
      return retained ? 'queued' : 'failed'
    },
  )
}

function dispatchDeletePersona(
  personaId: string,
  selectPersonaId: string | undefined,
  previous: PersonaStateSnapshot,
  rollbackReferences: () => void,
): Promise<PersonaPersistenceStatus> {
  if (!canUseServerCommands()) return Promise.resolve('accepted')
  const previousIndex = findPersonaIndexById(previous.personas, personaId)
  const previousPersona = previousIndex === -1 ? null : previous.personas[previousIndex]
  if (!previousPersona) return Promise.resolve('failed')
  const previousProfile = profileMirrorRollbackSnapshotFromState(previous)
  const attemptedProfile = currentProfileMirrorRollbackSnapshot()
  void flushPendingSelectedPersonaUpdate()
  const intent: DurableMutationIntent = {
    version: 1,
    requests: [
      {
        method: 'DELETE',
        path: `/personas/${encodeURIComponent(personaId)}`,
        body: {
          ...(selectPersonaId ? { selectPersonaId } : {}),
          mirrorLegacyProfile: true,
          saveCurrent: true,
        },
      },
    ],
    dependencyKeys: [personaOwnerMutationKey(personaId)],
  }
  const outbox = stagePendingMutation(PERSONA_SELECTION_MUTATION_KEY, intent)
  return settlePersonaStructuralMutation(
    dispatchDurableMutation(outbox, intent, (transport) =>
      runServerCommand({
        command: (baseRevision) =>
          deletePersonaCommand({
            baseRevision,
            personaId,
            selectPersonaId,
            mirrorLegacyProfile: true,
            saveCurrent: true,
          }),
        // Persona mutation certificates cover the collection/settings slices,
        // but deletion also rewrites chats and loadouts. Leave this command
        // without a local-effect acknowledgement so success reconciliation reads
        // every cascaded slice through the authoritative invalidation plan.
        rollback: personaCommandRollback({ personas: true, settings: true }, () => {
          applyDeletePersonaRollback({
            deletedPersonaId: personaId,
            previousIndex,
            previousPersona,
            previousProfile,
            attemptedProfile,
          })
          if (findPersonaIndexById(getDatabase().personas, personaId) !== -1) rollbackReferences()
        }),
        ...transport,
      }),
    ),
    outbox,
  )
}

function dispatchReorderPersonas(previous: PersonaStateSnapshot): Promise<PersonaPersistenceStatus> {
  if (!canUseServerCommands()) return Promise.resolve('accepted')
  const personaIds = personaCommandIdList()
  if (!personaIds) return Promise.resolve('failed')
  const previousPersonaIds = personaCommandIdList(previous.personas)
  if (!previousPersonaIds) return Promise.resolve('failed')
  const attemptedPersonaIds = [...personaIds]
  const attempted = currentPersonaStateSnapshot()
  const settingsProjectionChanged = attempted.selectedPersona !== previous.selectedPersona
  const optimisticAcknowledgement = personaMutationOptimisticAcknowledgement({
    operation: 'reorder',
    previous,
    attempted,
    mirrorLegacyProfile: false,
    saveCurrent: false,
  })
  void flushPendingSelectedPersonaUpdate()
  const intent: DurableMutationIntent = {
    version: 1,
    requests: [
      {
        method: 'POST',
        path: '/personas/reorder',
        body: { personaIds: [...personaIds] },
      },
    ],
    dependencyKeys: personaOwnerDependencyKeys(...personaIds),
  }
  const outbox = stagePendingMutation(PERSONA_SELECTION_MUTATION_KEY, intent)
  return settlePersonaStructuralMutation(
    dispatchDurableMutation(outbox, intent, (transport) =>
      runServerCommand({
        command: (baseRevision) =>
          reorderPersonasCommand({
            baseRevision,
            personaIds,
            optimisticAcknowledgement,
          }),
        rollback: personaCommandRollback({ personas: true, settings: settingsProjectionChanged }, () =>
          applyReorderPersonaRollback({
            previousPersonaIds,
            attemptedPersonaIds,
          }),
        ),
        ...transport,
      }),
    ),
    outbox,
  )
}

export function queueSelectedPersonaUpdate(previous: PersonaStateSnapshot, attempted: PersonaStateSnapshot): void {
  if (!canUseServerCommands() || personaSettingsWatcherSuppressed) return
  const personaId = selectedPersonaId()
  if (!personaId) return
  if (pendingPersonaUpdate.personaId && pendingPersonaUpdate.personaId !== personaId) {
    clearPendingSelectedPersonaUpdate()
  }
  pendingPersonaUpdate.personaId = personaId
  pendingPersonaUpdate.previous ??= cloneJsonValue(previous)
  pendingPersonaUpdate.collectionProjectionEpoch ??= captureCollectionProjectionEpoch('personas')
  pendingPersonaUpdate.settingsProjectionEpoch ??= captureSettingsProjectionEpoch()
  const priorDurableAttempted = pendingPersonaUpdate.durableAttempted ?? pendingPersonaUpdate.previous
  const netPatch = changedSelectedPersonaPatch(personaId, pendingPersonaUpdate.previous, attempted)
  const correctionPatch = changedSelectedPersonaPatch(personaId, priorDurableAttempted, attempted)
  pendingPersonaUpdate.attempted = cloneJsonValue(attempted)
  pendingPersonaUpdate.patch = { ...netPatch, ...correctionPatch }
  if (pendingPersonaUpdate.timer) clearTimeout(pendingPersonaUpdate.timer)
  if (Object.keys(pendingPersonaUpdate.patch).length === 0) {
    clearPendingSelectedPersonaUpdate()
    return
  }
  const intent = selectedPersonaUpdateDurableIntent(personaId, pendingPersonaUpdate.patch)
  pendingPersonaUpdate.intent = intent
  pendingPersonaUpdate.outbox = stagePendingMutation(
    personaOwnerMutationKey(personaId),
    intent,
    pendingPersonaUpdate.outbox,
  )
  pendingPersonaUpdate.durableAttempted = cloneJsonValue(attempted)
  const correctionOnly = Object.keys(netPatch).length === 0 && Object.keys(correctionPatch).length > 0
  if (correctionOnly) {
    void flushPendingSelectedPersonaUpdate()
  } else {
    pendingPersonaUpdate.timer = setTimeout(() => {
      void flushPendingSelectedPersonaUpdate()
    }, 250)
  }
}

function takePendingSelectedPersonaUpdate(): {
  personaId: string
  patch: PersonaSnapshot
  previous: PersonaStateSnapshot | null
  attempted: PersonaStateSnapshot | null
  collectionProjectionEpoch: number | null
  settingsProjectionEpoch: number | null
  intent: DurableMutationIntent
  outbox: PendingMutationHandle
} | null {
  if (pendingPersonaUpdate.timer) {
    clearTimeout(pendingPersonaUpdate.timer)
  }

  const personaId = pendingPersonaUpdate.personaId
  const patch = pendingPersonaUpdate.patch
  const previous = pendingPersonaUpdate.previous
  const attempted = pendingPersonaUpdate.attempted
  const collectionProjectionEpoch = pendingPersonaUpdate.collectionProjectionEpoch
  const settingsProjectionEpoch = pendingPersonaUpdate.settingsProjectionEpoch
  const intent = pendingPersonaUpdate.intent
  const outbox = pendingPersonaUpdate.outbox

  pendingPersonaUpdate.timer = null
  pendingPersonaUpdate.previous = null
  pendingPersonaUpdate.durableAttempted = null
  pendingPersonaUpdate.attempted = null
  pendingPersonaUpdate.personaId = null
  pendingPersonaUpdate.patch = null
  pendingPersonaUpdate.collectionProjectionEpoch = null
  pendingPersonaUpdate.settingsProjectionEpoch = null
  pendingPersonaUpdate.intent = null
  pendingPersonaUpdate.outbox = null

  if (!personaId || !patch || !intent || !outbox) {
    if (outbox) void acknowledgePendingMutation(outbox)
    return null
  }
  return {
    personaId,
    patch,
    previous,
    attempted,
    collectionProjectionEpoch,
    settingsProjectionEpoch,
    intent,
    outbox,
  }
}

export function flushPendingSelectedPersonaUpdate(
  options: ServerCommandTransportOptions = {},
): Promise<ServerCommandResult<{ personaId: string }> | null> {
  if (!canUseServerCommands()) return Promise.resolve(null)

  const pending = takePendingSelectedPersonaUpdate()
  if (!pending) {
    return pendingPersonaUpdate.promise ?? Promise.resolve(null)
  }

  const optimisticAcknowledgement =
    pending.attempted && pending.collectionProjectionEpoch !== null && pending.settingsProjectionEpoch !== null
      ? personaPatchOptimisticAcknowledgement({
          personaId: pending.personaId,
          patch: pending.patch,
          attempted: pending.attempted,
          mirrorLegacyProfile: true,
          collectionProjectionEpoch: pending.collectionProjectionEpoch,
          settingsProjectionEpoch: pending.settingsProjectionEpoch,
        })
      : undefined
  // runServerCommand's global queue already serializes this PATCH behind any
  // older command. Enqueue it synchronously so a structural persona action in
  // the same task cannot overtake the debounced row update and force a digest
  // mismatch followed by an authoritative collection/settings read.
  const next = dispatchDurableMutation(pending.outbox, pending.intent, (transport) =>
    runServerCommand({
      command: (baseRevision) =>
        updatePersonaCommand(
          {
            baseRevision,
            personaId: pending.personaId,
            patch: pending.patch,
            mirrorLegacyProfile: true,
            optimisticAcknowledgement,
          },
          options.signal,
          options.keepalive,
        ),
      rollback: personaCommandRollback({ personas: true, settings: true }, () => {
        if (!pending.previous || !pending.attempted) return
        applyPersonaProfileCommandRollback({
          personaId: pending.personaId,
          previous: pending.previous,
          attempted: pending.attempted,
          rowKeys: personaRowRollbackKeysForPatch(pending.patch),
        })
      }),
      ...options,
      ...transport,
    }),
  ).finally(() => {
    if (pendingPersonaUpdate.promise === next) {
      pendingPersonaUpdate.promise = null
    }
  })

  pendingPersonaUpdate.promise = next
  return next
}

function selectedPersonaUpdateDurableIntent(personaId: string, patch: PersonaSnapshot): DurableMutationIntent {
  return {
    version: 1,
    dependencyKeys: [PERSONA_SELECTION_MUTATION_KEY],
    requests: [
      {
        method: 'PATCH',
        path: `/personas/${encodeURIComponent(personaId)}`,
        body: {
          patch: cloneJsonValue(patch),
          mirrorLegacyProfile: true,
        },
      },
    ],
  }
}

registerPendingBridgePatchFlusher('selected-persona-profile', (options) => {
  void flushPendingSelectedPersonaUpdate(options)
})

export function updateSelectedPersonaField(field: SelectedPersonaProfileField, value: string): void {
  markSelectedPersonaFieldDirty(field, value)
  withTrustedResourceWrite(() => {
    getDatabase()[field] = value
    const persona = getDatabase().personas[getDatabase().selectedPersona]
    if (!persona) return
    if (field === 'username') {
      persona.name = value
    } else if (field === 'userNote') {
      persona.note = value
    } else {
      persona.personaPrompt = value
    }
  })
}

export function updateSelectedPersonaLargePortrait(value: boolean): void {
  const persona = getDatabase().personas[getDatabase().selectedPersona]
  if (!persona) return
  markSelectedPersonaFieldDirty('largePortrait', value)
  withTrustedResourceWrite(() => {
    getDatabase().personas[getDatabase().selectedPersona].largePortrait = value
  })
}

export function updateSelectedPersonaDisplayName(value: string): void {
  const persona = getDatabase().personas[getDatabase().selectedPersona]
  if (!persona) return
  markSelectedPersonaFieldDirty('displayName', value)
  withTrustedResourceWrite(() => {
    getDatabase().personas[getDatabase().selectedPersona].displayName = value
  })
}

export interface NewUserPersonaMutation {
  persona: Persona
  persistence: Promise<PersonaPersistenceStatus>
}

export function createNewUserPersonaWithOutcome(): NewUserPersonaMutation {
  const previous = currentPersonaStateSnapshot()
  const persona = {
    id: v4(),
    name: 'New Persona',
    displayName: '',
    icon: '',
    personaPrompt: '',
    note: '',
  } as Persona

  suppressPersonaSettingsWatcherUntilNextTask()
  withTrustedResourceWrite(() => {
    getDatabase().personas.push(persona)
    getDatabase().selectedPersona = getDatabase().personas.length - 1
    getDatabase().username = persona.name
    getDatabase().userIcon = persona.icon
    getDatabase().personaPrompt = persona.personaPrompt
    getDatabase().userNote = persona.note ?? ''
  })
  return {
    persona,
    persistence: dispatchCreatePersona(persona, previous),
  }
}

export function createNewUserPersona(): Persona {
  return createNewUserPersonaWithOutcome().persona
}

export function beginPersonaReorder(): string | null {
  if (!personaCommandIdList()) return null
  const personaId = selectedPersonaId()
  if (!personaId) return null
  saveUserPersona({ dispatch: false })
  return personaId
}

export function reorderUserPersonasByIndicesWithOutcome(
  indices: number[],
  selectedPersonaId: string | null,
): Promise<PersonaPersistenceStatus> | null {
  const previous = currentPersonaStateSnapshot()
  const personas = indices
    .map((index) => getDatabase().personas[index])
    .filter((persona): persona is Persona => Boolean(persona))
  if (personas.length !== getDatabase().personas.length) return null
  if (!personaCommandIdList(personas)) return null

  suppressPersonaSettingsWatcherUntilNextTask()
  withTrustedResourceWrite(() => {
    getDatabase().personas = personas
    const selectedPersona = getDatabase().personas.findIndex((persona) => persona.id === selectedPersonaId)
    getDatabase().selectedPersona = selectedPersona !== -1 ? selectedPersona : 0
  })
  return dispatchReorderPersonas(previous)
}

export function reorderUserPersonasByIndices(indices: number[], selectedPersonaId: string | null): boolean {
  return reorderUserPersonasByIndicesWithOutcome(indices, selectedPersonaId) !== null
}

export function deleteSelectedUserPersonaWithOutcome(
  expectedPersonaId?: string,
): Promise<PersonaPersistenceStatus> | null {
  if (getDatabase().personas.length === 1) return null
  if (!personaCommandIdList()) return null
  const personaId = selectedPersonaId()
  if (!personaId || (expectedPersonaId !== undefined && personaId !== expectedPersonaId)) return null
  saveUserPersona({ dispatch: false })
  const previous = currentPersonaStateSnapshot()

  const personas = [...getDatabase().personas]
  personas.splice(getDatabase().selectedPersona, 1)
  const selectedId = uniquePersonaIdAt(personas, 0) ?? undefined

  suppressPersonaSettingsWatcherUntilNextTask()
  withTrustedResourceWrite(() => {
    getDatabase().personas = personas
    getDatabase().selectedPersona = 0
    const selected = getDatabase().personas[0]
    getDatabase().username = selected.name
    getDatabase().userIcon = selected.icon
    getDatabase().personaPrompt = selected.personaPrompt
    getDatabase().userNote = selected.note ?? ''
  })
  const references = optimisticallyRehomeGenerationReferences({
    getDatabase: () => getDatabase(),
    kind: 'persona',
    deletedId: personaId,
    replacement: selectedId ? { id: selectedId } : null,
  })
  return dispatchDeletePersona(personaId, selectedId, previous, references.rollback)
}

export function deleteSelectedUserPersona(expectedPersonaId?: string): boolean {
  return deleteSelectedUserPersonaWithOutcome(expectedPersonaId) !== null
}

export async function selectUserImg() {
  const target = capturePersonaIconUploadTarget({
    selectedPersona: getDatabase().selectedPersona,
    userIcon: getDatabase().userIcon,
    personas: getDatabase().personas,
  })
  if (!target) return
  const commandBaseline = currentPersonaStateSnapshot()

  let operation: PersonaIconUploadOperation | null = null
  try {
    const selected = await selectSingleFile(['png'], {
      onFileSelected: () => {
        operation = beginPersonaIconUpload(target)
      },
    })
    if (!selected || !operation) {
      return
    }

    if (
      resolveFreshPersonaIconUploadIndex(operation, {
        selectedPersona: getDatabase().selectedPersona,
        userIcon: getDatabase().userIcon,
        personas: getDatabase().personas,
      }) === null
    ) {
      return
    }

    const imgp = await saveImage(selected.data)
    const personaIndex = resolveFreshPersonaIconUploadIndex(operation, {
      selectedPersona: getDatabase().selectedPersona,
      userIcon: getDatabase().userIcon,
      personas: getDatabase().personas,
    })
    if (personaIndex === null) {
      return
    }

    const previous = currentPersonaStateSnapshot()
    let attempted: PersonaStateSnapshot | null = null
    let applied = false
    withSuppressedPersonaSettingsWatcher(() => {
      withTrustedResourceWrite(() => {
        const freshIndex = resolveFreshPersonaIconUploadIndex(operation, {
          selectedPersona: getDatabase().selectedPersona,
          userIcon: getDatabase().userIcon,
          personas: getDatabase().personas,
        })
        if (freshIndex === null) return
        const persona = getDatabase().personas[freshIndex]
        if (!persona) return

        getDatabase().userIcon = imgp
        getDatabase().personas[freshIndex] = {
          ...persona,
          icon: imgp,
        }
        attempted = currentPersonaStateSnapshot()
        applied = true
      })
    })

    if (!applied || !attempted) {
      return
    }

    const patch = changedPersonaProfilePatch(operation.personaId, commandBaseline, attempted)
    if (Object.keys(patch).length === 0) {
      return
    }
    const status = await dispatchPersonaProfilePatch({
      personaId: operation.personaId,
      patch,
      previous,
      attempted,
      rollbackRowKeys: ['icon'],
      rollbackLegacyKeys: ['userIcon'],
    })
    if (status === 'queued') {
      alertNormal(language.personaIconSaveQueued)
    } else if (status === 'failed') {
      alertError(language.personaIconSaveFailed)
    }
    return status
  } catch (error) {
    console.error(error)
    alertError(language.personaIconSaveFailed)
    return 'failed'
  } finally {
    if (operation) {
      clearPersonaIconUpload(operation)
    }
  }
}

export function saveUserPersona(options: { dispatch?: boolean } = {}): Promise<PersonaPersistenceStatus> {
  const dispatch = options.dispatch ?? true
  const previous = currentPersonaStateSnapshot()
  if (!getDatabase().personas[getDatabase().selectedPersona]) return Promise.resolve('failed')
  withTrustedResourceWrite(() => {
    getDatabase().personas[getDatabase().selectedPersona].name = getDatabase().username
    getDatabase().personas[getDatabase().selectedPersona].icon = getDatabase().userIcon
    getDatabase().personas[getDatabase().selectedPersona].personaPrompt = getDatabase().personaPrompt
    getDatabase().personas[getDatabase().selectedPersona].note = getDatabase().userNote
  })
  if (!dispatch) return Promise.resolve('accepted')
  const attempted = currentPersonaStateSnapshot()
  const personaId = selectedPersonaId()
  if (personaId) {
    const patch = changedPersonaProfilePatch(personaId, previous, attempted)
    if (Object.keys(patch).length === 0) return Promise.resolve('accepted')
    return dispatchPersonaProfilePatch({
      personaId,
      patch,
      previous,
      attempted,
      rollbackRowKeys: personaRowRollbackKeysForPatch(patch),
      rollbackLegacyKeys: [],
    })
  }
  return Promise.resolve('failed')
}

export function setSelectedPersonaPromptFromTrigger(value: string): Promise<PersonaPersistenceStatus> {
  const persona = getDatabase().personas[getDatabase().selectedPersona]
  if (!persona) return Promise.resolve('failed')
  const personaId = selectedPersonaId()
  if (!personaId) return Promise.resolve('failed')
  const previous = currentPersonaStateSnapshot()

  withSuppressedPersonaSettingsWatcher(() => {
    withTrustedResourceWrite(() => {
      const selectedPersona = getDatabase().personas[getDatabase().selectedPersona]
      if (!selectedPersona) return
      getDatabase().personaPrompt = value
      selectedPersona.name = getDatabase().username
      selectedPersona.icon = getDatabase().userIcon
      selectedPersona.personaPrompt = value
      selectedPersona.note = getDatabase().userNote
    })
  })

  const attempted = currentPersonaStateSnapshot()
  const patch = changedPersonaProfilePatch(personaId, previous, attempted)
  if (Object.keys(patch).length === 0) return Promise.resolve('accepted')
  return dispatchPersonaProfilePatch({
    personaId,
    patch,
    previous,
    attempted,
    rollbackRowKeys: personaRowRollbackKeysForPatch(patch),
    rollbackLegacyKeys: Object.prototype.hasOwnProperty.call(patch, 'personaPrompt') ? ['personaPrompt'] : [],
  })
}

export function selectUserPersonaLocally(id: number, save: 'save' | 'noSave' = 'save'): boolean {
  if (!personaCommandIdList()) return false
  if (!validUniquePersonaIdAt(id)) return false
  const target = getDatabase().personas[id]
  if (!target) return false

  suppressPersonaSettingsWatcherUntilNextTask()
  if (save === 'save') {
    saveUserPersona({ dispatch: false })
  }

  withTrustedResourceWrite(() => {
    getDatabase().personaPrompt = target.personaPrompt
    getDatabase().username = target.name
    getDatabase().userIcon = target.icon
    getDatabase().userNote = target.note
    getDatabase().selectedPersona = id
  })
  return true
}

export function changeUserPersonaWithOutcome(
  id: number,
  save: 'save' | 'noSave' = 'save',
): Promise<PersonaPersistenceStatus> | null {
  if (!personaCommandIdList()) return null
  const personaId = validUniquePersonaIdAt(id)
  if (!personaId) return null
  const previous = currentPersonaStateSnapshot()
  if (!selectUserPersonaLocally(id, save)) return null
  const attempted = currentPersonaStateSnapshot()
  const optimisticAcknowledgement = personaMutationOptimisticAcknowledgement({
    operation: 'select',
    previous,
    attempted,
    mirrorLegacyProfile: true,
    saveCurrent: save === 'save',
  })
  if (personaId && canUseServerCommands()) {
    const previousPersonaId = uniquePersonaIdAt(previous.personas, previous.selectedPersona)
    void flushPendingSelectedPersonaUpdate()
    const intent: DurableMutationIntent = {
      version: 1,
      requests: [
        {
          method: 'POST',
          path: '/personas/select',
          body: {
            personaId,
            saveCurrent: save === 'save',
            mirrorLegacyProfile: true,
          },
        },
      ],
      dependencyKeys: personaOwnerDependencyKeys(save === 'save' ? previousPersonaId : null, personaId),
    }
    const outbox = stagePendingMutation(PERSONA_SELECTION_MUTATION_KEY, intent)
    recordPendingMutationProjectionTargets(
      outbox,
      (['username', 'userIcon', 'personaPrompt', 'userNote'] as const)
        .filter((key) => !exactJsonValuesEqual(previous[key], attempted[key]))
        .map(pendingMutationSettingsFieldProjectionTarget),
    )
    return settlePersonaStructuralMutation(
      dispatchDurableMutation(outbox, intent, (transport) =>
        runServerCommand({
          command: (baseRevision) =>
            selectPersonaCommand({
              baseRevision,
              personaId,
              saveCurrent: save === 'save',
              mirrorLegacyProfile: true,
              optimisticAcknowledgement,
            }),
          rollback: personaCommandRollback({ personas: save === 'save', settings: true }, () =>
            applySelectPersonaRollback({
              previous,
              attempted,
              saveCurrent: save === 'save',
            }),
          ),
          ...transport,
        }),
      ),
      outbox,
    )
  }
  return Promise.resolve('accepted')
}

export function changeUserPersona(id: number, save: 'save' | 'noSave' = 'save'): void {
  void changeUserPersonaWithOutcome(id, save)
}

interface PersonaCard {
  name: string
  displayName?: string
  personaPrompt: string
  note?: string
}

export async function exportUserPersona() {
  let db = getDatabase({ snapshot: true })
  if (!db.username || !db.personaPrompt) {
    alertError('username or persona prompt is empty')
    return
  }

  let img: Uint8Array
  if (!db.userIcon) {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 256
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'rgb(100, 116, 139)'
    ctx.fillRect(0, 0, 256, 256)
    const dataUrl = canvas.toDataURL('image/png')
    const base64 = dataUrl.split(',')[1]
    img = new Uint8Array(Buffer.from(base64, 'base64'))
  } else {
    img = await readImage(db.userIcon)
  }

  let card: PersonaCard = safeStructuredClone({
    name: db.username,
    displayName: db.personas[db.selectedPersona]?.displayName ?? '',
    personaPrompt: db.personaPrompt,
    note: db.userNote,
  })

  alertStore.set({
    type: 'wait',
    msg: 'Loading... (Writing Exif)',
  })

  await sleep(10)

  img = (await PngChunk.write(await reencodeImage(img), {
    persona: Buffer.from(JSON.stringify(card)).toString('base64'),
  })) as Uint8Array

  alertStore.set({
    type: 'wait',
    msg: 'Loading... (Writing)',
  })

  await sleep(10)
  await downloadFile(`${db.username.replace(/[<>:"/\\|?*\.\,]/g, '')}_export.png`, img)

  alertNormal(language.successExport)
}

export async function importUserPersona() {
  try {
    const v = await selectSingleFile(['png'])
    if (!v) {
      return
    }
    const readGenerator = PngChunk.readGenerator(v.data)
    let decoded: string | undefined

    for await (const chunk of readGenerator) {
      if (chunk && !(chunk instanceof AppendableBuffer) && chunk.key === 'persona') {
        decoded = chunk.value
        break
      }
    }

    if (!decoded) {
      alertError(language.errors.noData)
      return
    }
    const data: PersonaCard = JSON.parse(Buffer.from(decoded, 'base64').toString('utf-8'))
    if (data.name && data.personaPrompt) {
      const persona = {
        name: data.name,
        displayName: data.displayName ?? '',
        icon: await saveImage(await reencodeImage(v.data)),
        personaPrompt: data.personaPrompt,
        note: data.note,
        id: v4(),
      }
      const previous = currentPersonaStateSnapshot()
      withTrustedResourceWrite(() => {
        getDatabase().personas.push(persona)
      })
      const status = await dispatchImportedPersonaCreate(persona, previous)
      if (status === 'queued') {
        alertNormal(language.personaImportQueued)
      } else if (status === 'failed') {
        alertError(language.personaImportFailed)
      } else {
        alertNormal(language.successImport)
      }
      return status
    } else {
      alertError(language.errors.noData)
    }
  } catch (error) {
    console.error(error)
    alertError(language.personaImportFailed)
    return 'failed'
  }
}
