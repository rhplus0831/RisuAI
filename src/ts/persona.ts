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
  runServerCommand,
  selectPersonaCommand,
  updatePersonaCommand,
  type PersonaSnapshot,
  type ServerCommandResult,
} from './server/commands'
import { withTrustedServerProjectionWrite } from './server/projectionWriteGuard.svelte'

type Persona = (typeof DBState.db.personas)[number]

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function snapshotPersonas(): {
  personas: Persona[]
  selectedPersona: number
  username: string
  userIcon: string
  personaPrompt: string
  userNote: string
} {
  return {
    personas: cloneJsonValue(DBState.db.personas ?? []),
    selectedPersona: DBState.db.selectedPersona,
    username: DBState.db.username,
    userIcon: DBState.db.userIcon,
    personaPrompt: DBState.db.personaPrompt,
    userNote: DBState.db.userNote,
  }
}

function restorePersonaSnapshot(snapshot: ReturnType<typeof snapshotPersonas>): void {
  withTrustedServerProjectionWrite(() => {
    DBState.db.personas = cloneJsonValue(snapshot.personas)
    DBState.db.selectedPersona = snapshot.selectedPersona
    DBState.db.username = snapshot.username
    DBState.db.userIcon = snapshot.userIcon
    DBState.db.personaPrompt = snapshot.personaPrompt
    DBState.db.userNote = snapshot.userNote
  })
}

export function normalizePersonaIds(): void {
  withTrustedServerProjectionWrite(() => {
    const seen = new Set<string>()
    for (const persona of DBState.db.personas ?? []) {
      const id = typeof persona.id === 'string' && persona.id.trim() ? persona.id : v4()
      persona.id = seen.has(id) ? v4() : id
      seen.add(persona.id)
    }
  })
}

function selectedPersonaId(): string | null {
  normalizePersonaIds()
  return DBState.db.personas[DBState.db.selectedPersona]?.id ?? null
}

function personaPatchFromLegacyProfile(): PersonaSnapshot {
  return {
    name: DBState.db.username,
    icon: DBState.db.userIcon,
    personaPrompt: DBState.db.personaPrompt,
    note: DBState.db.userNote,
  }
}

function runPersonaCommand<T extends Record<string, unknown>>(
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
  rollback?: () => void,
): void {
  if (!canUseServerCommands()) return
  void runServerCommand({ command, rollback })
}

export async function selectUserImg() {
  const selected = await selectSingleFile(['png'])
  if (!selected) {
    return
  }
  const previous = snapshotPersonas()
  const img = selected.data
  const imgp = await saveImage(img)
  DBState.db.userIcon = imgp
  DBState.db.personas[DBState.db.selectedPersona] = {
    ...DBState.db.personas[DBState.db.selectedPersona],
    name: DBState.db.username,
    icon: DBState.db.userIcon,
    personaPrompt: DBState.db.personaPrompt,
    note: DBState.db.userNote,
    id: DBState.db.personas[DBState.db.selectedPersona]?.id ?? v4(),
  }
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
      () => restorePersonaSnapshot(previous),
    )
  }
}

export function saveUserPersona(options: { dispatch?: boolean } = {}) {
  const dispatch = options.dispatch ?? true
  const previous = snapshotPersonas()
  if (!DBState.db.personas[DBState.db.selectedPersona]) return
  DBState.db.personas[DBState.db.selectedPersona].name = DBState.db.username
  DBState.db.personas[DBState.db.selectedPersona].icon = DBState.db.userIcon
  DBState.db.personas[DBState.db.selectedPersona].personaPrompt = DBState.db.personaPrompt
  DBState.db.personas[DBState.db.selectedPersona].note = DBState.db.userNote
  const personaId = selectedPersonaId()
  if (dispatch && personaId) {
    runPersonaCommand(
      (baseRevision) =>
        updatePersonaCommand({
          baseRevision,
          personaId,
          patch: personaPatchFromLegacyProfile(),
          mirrorLegacyProfile: true,
        }),
      () => restorePersonaSnapshot(previous),
    )
  }
}

export function changeUserPersona(id: number, save: 'save' | 'noSave' = 'save') {
  const previous = snapshotPersonas()
  const target = DBState.db.personas[id]
  if (!target) return
  if (save === 'save') {
    saveUserPersona({ dispatch: false })
  }
  normalizePersonaIds()
  const personaId = target.id
  const pr = target
  DBState.db.personaPrompt = pr.personaPrompt
  DBState.db.username = pr.name
  DBState.db.userIcon = pr.icon
  DBState.db.userNote = pr.note
  DBState.db.selectedPersona = id
  if (personaId) {
    runPersonaCommand(
      (baseRevision) =>
        selectPersonaCommand({
          baseRevision,
          personaId,
          saveCurrent: save === 'save',
          mirrorLegacyProfile: true,
        }),
      () => restorePersonaSnapshot(previous),
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
      const previous = snapshotPersonas()
      const persona = {
        name: data.name,
        icon: await saveImage(await reencodeImage(v.data)),
        personaPrompt: data.personaPrompt,
        note: data.note,
        id: v4(),
      }
      DBState.db.personas.push(persona)
      runPersonaCommand(
        (baseRevision) =>
          createPersonaCommand({
            baseRevision,
            persona: cloneJsonValue(persona) as PersonaSnapshot,
          }),
        () => restorePersonaSnapshot(previous),
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
