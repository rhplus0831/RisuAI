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
  type PersonaSnapshot,
  type ServerCommandResult,
} from './server/commands'
import { withTrustedServerProjectionWrite } from './server/projectionWriteGuard.svelte'
import {
  beginPersonaIconUpload,
  capturePersonaIconUploadTarget,
  clearPersonaIconUpload,
  resolveFreshPersonaIconUploadIndex,
  type PersonaIconUploadOperation,
} from './server/personaIconUpload'
import { applyAttemptedFieldRollback, applyAttemptedKeyedListRollback } from './server/staleStateGuards'

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
export type SelectedPersonaDirtyField = SelectedPersonaProfileField | 'displayName' | 'largePortrait'
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
  attempted: null as PersonaStateSnapshot | null,
  personaId: null as string | null,
  patch: null as PersonaSnapshot | null,
  promise: null as Promise<ServerCommandResult<{ personaId: string }> | null> | null,
}

let personaSettingsWatcherSuppressed = false
let personaSettingsWatcherSuppressionToken = 0
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
  withTrustedServerProjectionWrite(() => {
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
    withTrustedServerProjectionWrite(() => {
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
    withTrustedServerProjectionWrite(() => {
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
    withTrustedServerProjectionWrite(() => {
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
    withTrustedServerProjectionWrite(() => {
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
    withTrustedServerProjectionWrite(() => {
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
    withTrustedServerProjectionWrite(() => {
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
    withTrustedServerProjectionWrite(() => {
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

function selectedPersonaProfileRowField(field: SelectedPersonaProfileField): 'name' | 'note' | 'personaPrompt' {
  if (field === 'username') return 'name'
  if (field === 'userNote') return 'note'
  return 'personaPrompt'
}

function isSelectedPersonaProfileField(field: SelectedPersonaDirtyField): field is SelectedPersonaProfileField {
  return field === 'username' || field === 'userNote' || field === 'personaPrompt'
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

function selectedPersonaLegacyProjectionValue(field: SelectedPersonaProfileField): string {
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

export function reconcileSelectedPersonaProjectionEpoch(): void {
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
    withTrustedServerProjectionWrite(() => {
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
  pendingPersonaUpdate.attempted = null
  pendingPersonaUpdate.personaId = null
  pendingPersonaUpdate.patch = null
}

function runPersonaCommand<T extends Record<string, unknown>>(
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
  rollback?: () => void,
): void {
  if (!canUseServerCommands()) return
  void runServerCommand({ command, rollback })
}

function dispatchCreatePersona(persona: Persona, previous: PersonaStateSnapshot): void {
  if (!canUseServerCommands()) return
  const createdPersonaId = nonBlankPersonaId(persona)
  if (!createdPersonaId) return
  const previousProfile = profileMirrorRollbackSnapshotFromState(previous)
  const attemptedProfile = currentProfileMirrorRollbackSnapshot()
  const attemptedCreatedPersona = cloneJsonValue(persona)
  void runServerCommand({
    command: (baseRevision) =>
      createPersonaCommand({
        baseRevision,
        persona: cloneJsonValue(attemptedCreatedPersona) as PersonaSnapshot,
        mirrorLegacyProfile: true,
      }),
    rollback: () =>
      applyCreatePersonaRollback({
        createdPersonaId,
        attemptedCreatedPersona,
        previousProfile,
        attemptedProfile,
      }),
  })
}

function dispatchDeletePersona(
  personaId: string,
  selectPersonaId: string | undefined,
  previous: PersonaStateSnapshot,
): void {
  if (!canUseServerCommands()) return
  const previousIndex = findPersonaIndexById(previous.personas, personaId)
  const previousPersona = previousIndex === -1 ? null : previous.personas[previousIndex]
  if (!previousPersona) return
  const previousProfile = profileMirrorRollbackSnapshotFromState(previous)
  const attemptedProfile = currentProfileMirrorRollbackSnapshot()
  void runServerCommand({
    command: (baseRevision) =>
      deletePersonaCommand({
        baseRevision,
        personaId,
        selectPersonaId,
        mirrorLegacyProfile: true,
        saveCurrent: true,
      }),
    rollback: () =>
      applyDeletePersonaRollback({
        deletedPersonaId: personaId,
        previousIndex,
        previousPersona,
        previousProfile,
        attemptedProfile,
      }),
  })
}

function dispatchReorderPersonas(previous: PersonaStateSnapshot): void {
  if (!canUseServerCommands()) return
  const personaIds = personaCommandIdList()
  if (!personaIds) return
  const previousPersonaIds = personaCommandIdList(previous.personas)
  if (!previousPersonaIds) return
  const attemptedPersonaIds = [...personaIds]
  void runServerCommand({
    command: (baseRevision) =>
      reorderPersonasCommand({
        baseRevision,
        personaIds,
      }),
    rollback: () =>
      applyReorderPersonaRollback({
        previousPersonaIds,
        attemptedPersonaIds,
      }),
  })
}

export function queueSelectedPersonaUpdate(previous: PersonaStateSnapshot, attempted: PersonaStateSnapshot): void {
  if (!canUseServerCommands() || personaSettingsWatcherSuppressed) return
  const personaId = selectedPersonaId()
  if (!personaId) return
  if (pendingPersonaUpdate.personaId && pendingPersonaUpdate.personaId !== personaId) {
    clearPendingSelectedPersonaUpdate()
  }
  const patch = cloneJsonValue(selectedPersonaPatch()) as PersonaSnapshot
  pendingPersonaUpdate.personaId = personaId
  pendingPersonaUpdate.previous ??= previous
  pendingPersonaUpdate.attempted = attempted
  pendingPersonaUpdate.patch = patch
  if (pendingPersonaUpdate.timer) clearTimeout(pendingPersonaUpdate.timer)
  pendingPersonaUpdate.timer = setTimeout(() => {
    void flushPendingSelectedPersonaUpdate()
  }, 250)
}

function takePendingSelectedPersonaUpdate(): {
  personaId: string
  patch: PersonaSnapshot
  previous: PersonaStateSnapshot | null
  attempted: PersonaStateSnapshot | null
} | null {
  if (pendingPersonaUpdate.timer) {
    clearTimeout(pendingPersonaUpdate.timer)
  }

  const personaId = pendingPersonaUpdate.personaId
  const patch = pendingPersonaUpdate.patch
  const previous = pendingPersonaUpdate.previous
  const attempted = pendingPersonaUpdate.attempted

  pendingPersonaUpdate.timer = null
  pendingPersonaUpdate.previous = null
  pendingPersonaUpdate.attempted = null
  pendingPersonaUpdate.personaId = null
  pendingPersonaUpdate.patch = null

  if (!personaId || !patch) return null
  return { personaId, patch, previous, attempted }
}

export function flushPendingSelectedPersonaUpdate(): Promise<ServerCommandResult<{ personaId: string }> | null> {
  if (!canUseServerCommands()) return Promise.resolve(null)

  const pending = takePendingSelectedPersonaUpdate()
  if (!pending) {
    return pendingPersonaUpdate.promise ?? Promise.resolve(null)
  }

  const previousPromise = pendingPersonaUpdate.promise ?? Promise.resolve(null)
  const next = previousPromise
    .catch(() => null)
    .then(() =>
      runServerCommand({
        command: (baseRevision) =>
          updatePersonaCommand({
            baseRevision,
            personaId: pending.personaId,
            patch: pending.patch,
            mirrorLegacyProfile: true,
          }),
        rollback: () => {
          if (!pending.previous || !pending.attempted) return
          applyPersonaProfileCommandRollback({
            personaId: pending.personaId,
            previous: pending.previous,
            attempted: pending.attempted,
            rowKeys: personaRowRollbackKeysForPatch(pending.patch),
          })
        },
      }),
    )
    .finally(() => {
      if (pendingPersonaUpdate.promise === next) {
        pendingPersonaUpdate.promise = null
      }
    })

  pendingPersonaUpdate.promise = next
  return next
}

export function updateSelectedPersonaField(field: SelectedPersonaProfileField, value: string): void {
  markSelectedPersonaFieldDirty(field, value)
  withTrustedServerProjectionWrite(() => {
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
  withTrustedServerProjectionWrite(() => {
    getDatabase().personas[getDatabase().selectedPersona].largePortrait = value
  })
}

export function updateSelectedPersonaDisplayName(value: string): void {
  const persona = getDatabase().personas[getDatabase().selectedPersona]
  if (!persona) return
  markSelectedPersonaFieldDirty('displayName', value)
  withTrustedServerProjectionWrite(() => {
    getDatabase().personas[getDatabase().selectedPersona].displayName = value
  })
}

export function createNewUserPersona(): Persona {
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
  withTrustedServerProjectionWrite(() => {
    getDatabase().personas.push(persona)
    getDatabase().selectedPersona = getDatabase().personas.length - 1
    getDatabase().username = persona.name
    getDatabase().userIcon = persona.icon
    getDatabase().personaPrompt = persona.personaPrompt
    getDatabase().userNote = persona.note ?? ''
  })
  dispatchCreatePersona(persona, previous)
  return persona
}

export function beginPersonaReorder(): string | null {
  if (!personaCommandIdList()) return null
  const personaId = selectedPersonaId()
  if (!personaId) return null
  saveUserPersona({ dispatch: false })
  return personaId
}

export function reorderUserPersonasByIndices(indices: number[], selectedPersonaId: string | null): boolean {
  const previous = currentPersonaStateSnapshot()
  const personas = indices
    .map((index) => getDatabase().personas[index])
    .filter((persona): persona is Persona => Boolean(persona))
  if (personas.length !== getDatabase().personas.length) return false
  if (!personaCommandIdList(personas)) return false

  suppressPersonaSettingsWatcherUntilNextTask()
  withTrustedServerProjectionWrite(() => {
    getDatabase().personas = personas
    const selectedPersona = getDatabase().personas.findIndex((persona) => persona.id === selectedPersonaId)
    getDatabase().selectedPersona = selectedPersona !== -1 ? selectedPersona : 0
  })
  dispatchReorderPersonas(previous)
  return true
}

export function deleteSelectedUserPersona(): boolean {
  if (getDatabase().personas.length === 1) return false
  if (!personaCommandIdList()) return false
  const personaId = selectedPersonaId()
  if (!personaId) return false
  const previous = currentPersonaStateSnapshot()
  saveUserPersona({ dispatch: false })

  const personas = [...getDatabase().personas]
  personas.splice(getDatabase().selectedPersona, 1)
  const selectedId = uniquePersonaIdAt(personas, 0) ?? undefined

  suppressPersonaSettingsWatcherUntilNextTask()
  withTrustedServerProjectionWrite(() => {
    getDatabase().personas = personas
    getDatabase().selectedPersona = 0
    const selected = getDatabase().personas[0]
    getDatabase().username = selected.name
    getDatabase().userIcon = selected.icon
    getDatabase().personaPrompt = selected.personaPrompt
    getDatabase().userNote = selected.note ?? ''
  })
  dispatchDeletePersona(personaId, selectedId, previous)
  return true
}

export async function selectUserImg() {
  const target = capturePersonaIconUploadTarget({
    selectedPersona: getDatabase().selectedPersona,
    userIcon: getDatabase().userIcon,
    personas: getDatabase().personas,
  })
  if (!target) return

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
    withTrustedServerProjectionWrite(() => {
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

    if (!applied || !attempted) {
      return
    }

    const patch = cloneJsonValue(personaPatchFromLegacyProfile()) as PersonaSnapshot
    runPersonaCommand(
      (baseRevision) =>
        updatePersonaCommand({
          baseRevision,
          personaId: operation.personaId,
          patch,
          mirrorLegacyProfile: true,
        }),
      () => {
        if (!attempted) return
        applyPersonaProfileCommandRollback({
          personaId: operation.personaId,
          previous,
          attempted,
          rowKeys: ['icon'],
          legacyKeys: ['userIcon'],
        })
      },
    )
  } finally {
    if (operation) {
      clearPersonaIconUpload(operation)
    }
  }
}

export function saveUserPersona(options: { dispatch?: boolean } = {}) {
  const dispatch = options.dispatch ?? true
  const previous = currentPersonaStateSnapshot()
  if (!getDatabase().personas[getDatabase().selectedPersona]) return
  withTrustedServerProjectionWrite(() => {
    getDatabase().personas[getDatabase().selectedPersona].name = getDatabase().username
    getDatabase().personas[getDatabase().selectedPersona].icon = getDatabase().userIcon
    getDatabase().personas[getDatabase().selectedPersona].personaPrompt = getDatabase().personaPrompt
    getDatabase().personas[getDatabase().selectedPersona].note = getDatabase().userNote
  })
  if (!dispatch) return
  const attempted = currentPersonaStateSnapshot()
  const patch = cloneJsonValue(personaPatchFromLegacyProfile()) as PersonaSnapshot
  const personaId = selectedPersonaId()
  if (personaId) {
    runPersonaCommand(
      (baseRevision) =>
        updatePersonaCommand({
          baseRevision,
          personaId,
          patch,
          mirrorLegacyProfile: true,
        }),
      () =>
        applyPersonaProfileCommandRollback({
          personaId,
          previous,
          attempted,
          rowKeys: personaRowProfileFields,
          legacyKeys: [],
        }),
    )
  }
}

export function setSelectedPersonaPromptFromTrigger(value: string): void {
  const persona = getDatabase().personas[getDatabase().selectedPersona]
  if (!persona) return
  const personaId = selectedPersonaId()
  if (!personaId) return
  const previous = currentPersonaStateSnapshot()

  withTrustedServerProjectionWrite(() => {
    const selectedPersona = getDatabase().personas[getDatabase().selectedPersona]
    if (!selectedPersona) return
    getDatabase().personaPrompt = value
    selectedPersona.name = getDatabase().username
    selectedPersona.icon = getDatabase().userIcon
    selectedPersona.personaPrompt = value
    selectedPersona.note = getDatabase().userNote
  })

  const attempted = currentPersonaStateSnapshot()
  const patch = cloneJsonValue(personaPatchFromLegacyProfile()) as PersonaSnapshot
  runPersonaCommand(
    (baseRevision) =>
      updatePersonaCommand({
        baseRevision,
        personaId,
        patch,
        mirrorLegacyProfile: true,
      }),
    () =>
      applyPersonaProfileCommandRollback({
        personaId,
        previous,
        attempted,
        rowKeys: personaRowProfileFields,
        legacyKeys: ['personaPrompt'],
      }),
  )
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

  withTrustedServerProjectionWrite(() => {
    getDatabase().personaPrompt = target.personaPrompt
    getDatabase().username = target.name
    getDatabase().userIcon = target.icon
    getDatabase().userNote = target.note
    getDatabase().selectedPersona = id
  })
  return true
}

export function changeUserPersona(id: number, save: 'save' | 'noSave' = 'save') {
  if (!personaCommandIdList()) return
  const personaId = validUniquePersonaIdAt(id)
  if (!personaId) return
  const previous = currentPersonaStateSnapshot()
  if (!selectUserPersonaLocally(id, save)) return
  const attempted = currentPersonaStateSnapshot()
  if (personaId) {
    runPersonaCommand(
      (baseRevision) =>
        selectPersonaCommand({
          baseRevision,
          personaId,
          saveCurrent: save === 'save',
          mirrorLegacyProfile: true,
        }),
      () =>
        applySelectPersonaRollback({
          previous,
          attempted,
          saveCurrent: save === 'save',
        }),
    )
  }
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
      const attemptedPersona = cloneJsonValue(persona)
      withTrustedServerProjectionWrite(() => {
        getDatabase().personas.push(persona)
      })
      runPersonaCommand(
        (baseRevision) =>
          createPersonaCommand({
            baseRevision,
            persona: cloneJsonValue(attemptedPersona) as PersonaSnapshot,
          }),
        () =>
          applyImportPersonaRollback({
            createdPersonaId: attemptedPersona.id,
            attemptedPersona,
          }),
      )
      alertNormal(language.successImport)
    } else {
      alertError(language.errors.noData)
    }
  } catch (error) {
    alertError(error)
    return
  }
}
