import { getDatabase, saveImage } from './storage/database.svelte'
import { selectSingleFile, sleep } from './util'
import { alertError, alertNormal, alertStore } from './alert'
import { AppendableBuffer, downloadFile, readImage } from './globalApi.svelte'
import { language } from 'src/lang'
import { reencodeImage } from './process/files/inlays'
import { PngChunk } from './pngChunk'
import { v4 } from 'uuid'
import { DBState } from './stores.svelte'
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

export type Persona = (typeof DBState.db.personas)[number]

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
  largePortrait: boolean
}

export type SelectedPersonaProfileField = 'username' | 'userNote' | 'personaPrompt'
export type SelectedPersonaDirtyField = SelectedPersonaProfileField | 'largePortrait'

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
    personas: cloneJsonValue(DBState.db.personas ?? []),
    selectedPersona: DBState.db.selectedPersona,
    username: DBState.db.username,
    userIcon: DBState.db.userIcon,
    personaPrompt: DBState.db.personaPrompt,
    userNote: DBState.db.userNote,
  }
}

export function currentSelectedPersonaProjectionSnapshot(): SelectedPersonaProjectionSnapshot {
  return {
    selectedPersona: DBState.db.selectedPersona,
    username: DBState.db.username,
    userIcon: DBState.db.userIcon,
    personaPrompt: DBState.db.personaPrompt,
    userNote: DBState.db.userNote,
    largePortrait: DBState.db.personas[DBState.db.selectedPersona]?.largePortrait ?? false,
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
    DBState.db.personas = cloneJsonValue(snapshot.personas)
    DBState.db.selectedPersona = snapshot.selectedPersona
    DBState.db.username = snapshot.username
    DBState.db.userIcon = snapshot.userIcon
    DBState.db.personaPrompt = snapshot.personaPrompt
    DBState.db.userNote = snapshot.userNote
  })
}

export function restorePersonaStateSnapshot(snapshot: PersonaStateSnapshot): void {
  const token = ++personaSettingsWatcherSuppressionToken
  personaSettingsWatcherSuppressed = true
  try {
    withTrustedServerProjectionWrite(() => {
      DBState.db.personas = cloneJsonValue(snapshot.personas)
      DBState.db.selectedPersona = snapshot.selectedPersona
      DBState.db.username = snapshot.username
      DBState.db.userIcon = snapshot.userIcon
      DBState.db.personaPrompt = snapshot.personaPrompt
      DBState.db.userNote = snapshot.userNote
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
  return uniquePersonaIdAt(DBState.db.personas ?? [], index)
}

function personaCommandIdList(personas: readonly Persona[] = DBState.db.personas ?? []): string[] | null {
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

export function selectedPersonaId(): string | null {
  return validUniquePersonaIdAt(DBState.db.selectedPersona)
}

function personaPatchFromLegacyProfile(): PersonaSnapshot {
  return {
    name: DBState.db.username,
    icon: DBState.db.userIcon,
    personaPrompt: DBState.db.personaPrompt,
    note: DBState.db.userNote,
  }
}

function selectedPersonaPatch(): PersonaSnapshot {
  return {
    ...personaPatchFromLegacyProfile(),
    largePortrait: DBState.db.personas[DBState.db.selectedPersona]?.largePortrait ?? false,
  }
}

function selectedPersonaProfileRowField(field: SelectedPersonaProfileField): 'name' | 'note' | 'personaPrompt' {
  if (field === 'username') return 'name'
  if (field === 'userNote') return 'note'
  return 'personaPrompt'
}

function selectedPersonaFieldProjectionValue(
  persona: Persona | undefined,
  field: SelectedPersonaDirtyField,
): string | boolean | undefined {
  if (field === 'largePortrait') {
    return persona?.largePortrait ?? false
  }
  const rowField = selectedPersonaProfileRowField(field)
  return persona?.[rowField] ?? ''
}

function selectedPersonaLegacyProjectionValue(field: SelectedPersonaProfileField): string {
  return DBState.db[field] ?? ''
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

  const selectedIndex = DBState.db.selectedPersona
  const selectedPersona = DBState.db.personas[selectedIndex]
  if (nonBlankPersonaId(selectedPersona) !== personaId) return

  clearDirtySelectedPersonaFieldsMatchingProjection(selectedPersona, dirtyFields)
  if (dirtyFields.size === 0) {
    dirtySelectedPersonaFieldsById.delete(personaId)
    return
  }

  withSuppressedPersonaSettingsWatcher(() => {
    withTrustedServerProjectionWrite(() => {
      if (DBState.db.selectedPersona !== selectedIndex) return
      const persona = DBState.db.personas[selectedIndex]
      if (nonBlankPersonaId(persona) !== personaId) return

      for (const [field, value] of dirtyFields) {
        if (field === 'largePortrait') {
          persona.largePortrait = value === true
          continue
        }

        const stringValue = String(value)
        DBState.db[field] = stringValue
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
  void runServerCommand({
    command: (baseRevision) =>
      createPersonaCommand({
        baseRevision,
        persona: cloneJsonValue(persona) as PersonaSnapshot,
        mirrorLegacyProfile: true,
      }),
    rollback: () => restorePersonaStateSnapshot(previous),
  })
}

function dispatchDeletePersona(
  personaId: string,
  selectPersonaId: string | undefined,
  previous: PersonaStateSnapshot,
): void {
  if (!canUseServerCommands()) return
  void runServerCommand({
    command: (baseRevision) =>
      deletePersonaCommand({
        baseRevision,
        personaId,
        selectPersonaId,
        mirrorLegacyProfile: true,
        saveCurrent: true,
      }),
    rollback: () => restorePersonaStateSnapshot(previous),
  })
}

function dispatchReorderPersonas(previous: PersonaStateSnapshot): void {
  if (!canUseServerCommands()) return
  const personaIds = personaCommandIdList()
  if (!personaIds) return
  const attempted = currentPersonaStateSnapshot()
  void runServerCommand({
    command: (baseRevision) =>
      reorderPersonasCommand({
        baseRevision,
        personaIds,
      }),
    rollback: () => {
      if (snapshotPersonaJson(currentPersonaStateSnapshot()) === snapshotPersonaJson(attempted)) {
        restorePersonaStateSnapshot(previous)
      }
    },
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
          if (
            pending.previous &&
            pending.attempted &&
            snapshotPersonaJson(currentPersonaStateSnapshot()) === snapshotPersonaJson(pending.attempted)
          ) {
            restorePersonaStateSnapshot(pending.previous)
          }
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
    DBState.db[field] = value
    const persona = DBState.db.personas[DBState.db.selectedPersona]
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
  const persona = DBState.db.personas[DBState.db.selectedPersona]
  if (!persona) return
  markSelectedPersonaFieldDirty('largePortrait', value)
  withTrustedServerProjectionWrite(() => {
    DBState.db.personas[DBState.db.selectedPersona].largePortrait = value
  })
}

export function createNewUserPersona(): Persona {
  const previous = currentPersonaStateSnapshot()
  const persona = {
    id: v4(),
    name: 'New Persona',
    icon: '',
    personaPrompt: '',
    note: '',
  } as Persona

  suppressPersonaSettingsWatcherUntilNextTask()
  withTrustedServerProjectionWrite(() => {
    DBState.db.personas.push(persona)
    DBState.db.selectedPersona = DBState.db.personas.length - 1
    DBState.db.username = persona.name
    DBState.db.userIcon = persona.icon
    DBState.db.personaPrompt = persona.personaPrompt
    DBState.db.userNote = persona.note ?? ''
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
    .map((index) => DBState.db.personas[index])
    .filter((persona): persona is Persona => Boolean(persona))
  if (personas.length !== DBState.db.personas.length) return false
  if (!personaCommandIdList(personas)) return false

  suppressPersonaSettingsWatcherUntilNextTask()
  withTrustedServerProjectionWrite(() => {
    DBState.db.personas = personas
    const selectedPersona = DBState.db.personas.findIndex((persona) => persona.id === selectedPersonaId)
    DBState.db.selectedPersona = selectedPersona !== -1 ? selectedPersona : 0
  })
  dispatchReorderPersonas(previous)
  return true
}

export function deleteSelectedUserPersona(): boolean {
  if (DBState.db.personas.length === 1) return false
  if (!personaCommandIdList()) return false
  const personaId = selectedPersonaId()
  if (!personaId) return false
  const previous = currentPersonaStateSnapshot()
  saveUserPersona({ dispatch: false })

  const personas = [...DBState.db.personas]
  personas.splice(DBState.db.selectedPersona, 1)
  const selectedId = uniquePersonaIdAt(personas, 0) ?? undefined

  suppressPersonaSettingsWatcherUntilNextTask()
  withTrustedServerProjectionWrite(() => {
    DBState.db.personas = personas
    DBState.db.selectedPersona = 0
    const selected = DBState.db.personas[0]
    DBState.db.username = selected.name
    DBState.db.userIcon = selected.icon
    DBState.db.personaPrompt = selected.personaPrompt
    DBState.db.userNote = selected.note ?? ''
  })
  dispatchDeletePersona(personaId, selectedId, previous)
  return true
}

export async function selectUserImg() {
  const target = capturePersonaIconUploadTarget({
    selectedPersona: DBState.db.selectedPersona,
    userIcon: DBState.db.userIcon,
    personas: DBState.db.personas,
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
        selectedPersona: DBState.db.selectedPersona,
        userIcon: DBState.db.userIcon,
        personas: DBState.db.personas,
      }) === null
    ) {
      return
    }

    const imgp = await saveImage(selected.data)
    const personaIndex = resolveFreshPersonaIconUploadIndex(operation, {
      selectedPersona: DBState.db.selectedPersona,
      userIcon: DBState.db.userIcon,
      personas: DBState.db.personas,
    })
    if (personaIndex === null) {
      return
    }

    const previous = currentPersonaStateSnapshot()
    let attempted: PersonaStateSnapshot | null = null
    let applied = false
    withTrustedServerProjectionWrite(() => {
      const freshIndex = resolveFreshPersonaIconUploadIndex(operation, {
        selectedPersona: DBState.db.selectedPersona,
        userIcon: DBState.db.userIcon,
        personas: DBState.db.personas,
      })
      if (freshIndex === null) return
      const persona = DBState.db.personas[freshIndex]
      if (!persona) return

      DBState.db.userIcon = imgp
      DBState.db.personas[freshIndex] = {
        ...persona,
        icon: imgp,
      }
      attempted = currentPersonaStateSnapshot()
      applied = true
    })

    if (!applied || !attempted) {
      return
    }

    runPersonaCommand(
      (baseRevision) =>
        updatePersonaCommand({
          baseRevision,
          personaId: operation.personaId,
          patch: personaPatchFromLegacyProfile(),
          mirrorLegacyProfile: true,
        }),
      () => {
        if (attempted && snapshotPersonaJson(currentPersonaStateSnapshot()) === snapshotPersonaJson(attempted)) {
          restorePersonaStateSnapshot(previous)
        }
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
  if (!DBState.db.personas[DBState.db.selectedPersona]) return
  withTrustedServerProjectionWrite(() => {
    DBState.db.personas[DBState.db.selectedPersona].name = DBState.db.username
    DBState.db.personas[DBState.db.selectedPersona].icon = DBState.db.userIcon
    DBState.db.personas[DBState.db.selectedPersona].personaPrompt = DBState.db.personaPrompt
    DBState.db.personas[DBState.db.selectedPersona].note = DBState.db.userNote
  })
  if (!dispatch) return
  const personaId = selectedPersonaId()
  if (personaId) {
    runPersonaCommand(
      (baseRevision) =>
        updatePersonaCommand({
          baseRevision,
          personaId,
          patch: personaPatchFromLegacyProfile(),
          mirrorLegacyProfile: true,
        }),
      () => restorePersonaStateSnapshot(previous),
    )
  }
}

export function setSelectedPersonaPromptFromTrigger(value: string): void {
  const persona = DBState.db.personas[DBState.db.selectedPersona]
  if (!persona) return
  const personaId = selectedPersonaId()
  if (!personaId) return
  const previous = currentPersonaStateSnapshot()

  withTrustedServerProjectionWrite(() => {
    const selectedPersona = DBState.db.personas[DBState.db.selectedPersona]
    if (!selectedPersona) return
    DBState.db.personaPrompt = value
    selectedPersona.name = DBState.db.username
    selectedPersona.icon = DBState.db.userIcon
    selectedPersona.personaPrompt = value
    selectedPersona.note = DBState.db.userNote
  })

  runPersonaCommand(
    (baseRevision) =>
      updatePersonaCommand({
        baseRevision,
        personaId,
        patch: personaPatchFromLegacyProfile(),
        mirrorLegacyProfile: true,
      }),
    () => restorePersonaStateSnapshot(previous),
  )
}

export function selectUserPersonaLocally(id: number, save: 'save' | 'noSave' = 'save'): boolean {
  if (!personaCommandIdList()) return false
  if (!validUniquePersonaIdAt(id)) return false
  const target = DBState.db.personas[id]
  if (!target) return false

  suppressPersonaSettingsWatcherUntilNextTask()
  if (save === 'save') {
    saveUserPersona({ dispatch: false })
  }

  withTrustedServerProjectionWrite(() => {
    DBState.db.personaPrompt = target.personaPrompt
    DBState.db.username = target.name
    DBState.db.userIcon = target.icon
    DBState.db.userNote = target.note
    DBState.db.selectedPersona = id
  })
  return true
}

export function changeUserPersona(id: number, save: 'save' | 'noSave' = 'save') {
  if (!personaCommandIdList()) return
  const personaId = validUniquePersonaIdAt(id)
  if (!personaId) return
  const previous = currentPersonaStateSnapshot()
  if (!selectUserPersonaLocally(id, save)) return
  if (personaId) {
    runPersonaCommand(
      (baseRevision) =>
        selectPersonaCommand({
          baseRevision,
          personaId,
          saveCurrent: save === 'save',
          mirrorLegacyProfile: true,
        }),
      () => restorePersonaStateSnapshot(previous),
    )
  }
}

interface PersonaCard {
  name: string
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
      const previous = currentPersonaStateSnapshot()
      const persona = {
        name: data.name,
        icon: await saveImage(await reencodeImage(v.data)),
        personaPrompt: data.personaPrompt,
        note: data.note,
        id: v4(),
      }
      withTrustedServerProjectionWrite(() => {
        DBState.db.personas.push(persona)
      })
      runPersonaCommand(
        (baseRevision) =>
          createPersonaCommand({
            baseRevision,
            persona: cloneJsonValue(persona) as PersonaSnapshot,
          }),
        () => restorePersonaStateSnapshot(previous),
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
