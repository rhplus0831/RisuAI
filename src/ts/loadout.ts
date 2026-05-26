import { changeUserPersona } from './persona'
import { currentModuleStateSnapshot, dispatchEnableModule } from './moduleCommands'
import {
  canUseServerCommands,
  createLoadoutCommand,
  deleteLoadoutCommand,
  favoriteLoadoutCommand,
  runServerCommand,
  touchLoadoutCommand,
  type LoadoutSnapshot,
  type ServerCommandResult,
} from './server/commands'
import { withTrustedServerProjectionWrite } from './server/projectionWriteGuard.svelte'
import { changeToPreset, getCurrentCharacter } from './storage/database.svelte'
import { DBState } from './stores.svelte'

export type Loadout = {
  name: string
  id: string
  lastUsed: number
  favorite: boolean
  characterIds: string[]
  modules: string[]
  globalVariables: { [key: string]: string }
  presetName: string
  personaId: string
}

export function makeLoadout(options: { name: string }): Loadout {
  const character = getCurrentCharacter()
  const id = crypto.randomUUID()
  const preset = DBState.db.botPresets[DBState.db.botPresetsId]
  return safeStructuredClone({
    name: options.name,
    id: id,
    lastUsed: Date.now(),
    favorite: false,
    characterIds: character ? [character.chaId] : [],
    modules: DBState.db.enabledModules,
    globalVariables: DBState.db.globalChatVariables,
    presetName: preset.name ?? '',
    personaId: DBState.db.personas[DBState.db.selectedPersona]?.id,
  })
}

type LoadoutApplyOption = 'modules' | 'globalVariables' | 'preset' | 'persona'

export interface LoadoutStateSnapshot {
  loadouts: Loadout[]
  lastLoadedLoadoutName: string
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export function currentLoadoutStateSnapshot(): LoadoutStateSnapshot {
  return {
    loadouts: cloneJsonValue(DBState.db.loadouts ?? []),
    lastLoadedLoadoutName: DBState.db.lastLoadedLoadoutName,
  }
}

export function restoreLoadoutState(snapshot: LoadoutStateSnapshot): void {
  withTrustedServerProjectionWrite(() => {
    DBState.db.loadouts = cloneJsonValue(snapshot.loadouts)
    DBState.db.lastLoadedLoadoutName = snapshot.lastLoadedLoadoutName
  })
}

function runLoadoutCommand<T extends Record<string, unknown>>(
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
  rollback: () => void,
): void {
  if (!canUseServerCommands()) return
  void runServerCommand({ command, rollback })
}

function toLoadoutSnapshot(loadout: Loadout): LoadoutSnapshot {
  return cloneJsonValue(loadout) as LoadoutSnapshot
}

function dispatchCreateLoadout(loadout: Loadout, previous: LoadoutStateSnapshot): void {
  runLoadoutCommand(
    (baseRevision) =>
      createLoadoutCommand({
        baseRevision,
        loadout: toLoadoutSnapshot(loadout),
      }),
    () => restoreLoadoutState(previous),
  )
}

export function dispatchDeleteLoadout(loadoutId: string, previous: LoadoutStateSnapshot): void {
  runLoadoutCommand(
    (baseRevision) =>
      deleteLoadoutCommand({
        baseRevision,
        loadoutId,
      }),
    () => restoreLoadoutState(previous),
  )
}

export function dispatchFavoriteLoadout(
  loadoutId: string,
  favorite: boolean,
  previous: LoadoutStateSnapshot,
): void {
  runLoadoutCommand(
    (baseRevision) =>
      favoriteLoadoutCommand({
        baseRevision,
        loadoutId,
        favorite,
      }),
    () => restoreLoadoutState(previous),
  )
}

function dispatchTouchLoadout(
  loadoutId: string,
  lastUsed: number,
  characterId: string | undefined,
  previous: LoadoutStateSnapshot,
): void {
  runLoadoutCommand(
    (baseRevision) =>
      touchLoadoutCommand({
        baseRevision,
        loadoutId,
        lastUsed,
        characterId,
      }),
    () => restoreLoadoutState(previous),
  )
}

export function applyLoadout(
  loadout: Loadout,
  apply: LoadoutApplyOption[] = ['modules', 'globalVariables', 'preset', 'persona'],
) {
  const previous = currentLoadoutStateSnapshot()
  const currentCharacterId = getCurrentCharacter()?.chaId
  loadout.lastUsed = Date.now()
  loadout.characterIds.push(currentCharacterId as string)
  if (apply.includes('persona')) {
    let personaIndex = DBState.db.personas?.findIndex((p) => p.id === loadout.personaId)
    if (personaIndex !== -1) {
      changeUserPersona(personaIndex)
    }
  }
  if (apply.includes('preset')) {
    let presetIndex = DBState.db.botPresets?.findIndex((p) => p.name === loadout.presetName)
    if (presetIndex !== -1) {
      changeToPreset(presetIndex)
    }
  }
  if (apply.includes('modules')) {
    const modulePrevious = currentModuleStateSnapshot()
    const previousModules = new Set(DBState.db.enabledModules ?? [])
    const nextModules = new Set(loadout.modules ?? [])
    DBState.db.enabledModules = loadout.modules
    for (const moduleId of nextModules) {
      if (!previousModules.has(moduleId)) {
        dispatchEnableModule(moduleId, true, modulePrevious)
      }
    }
    for (const moduleId of previousModules) {
      if (!nextModules.has(moduleId)) {
        dispatchEnableModule(moduleId, false, modulePrevious)
      }
    }
  }
  if (apply.includes('globalVariables')) {
    DBState.db.globalChatVariables = loadout.globalVariables
  }
  DBState.db.lastLoadedLoadoutName = loadout.name
  dispatchTouchLoadout(loadout.id, loadout.lastUsed, currentCharacterId, previous)
}

export function saveCurrentLoadout(name: string) {
  const previous = currentLoadoutStateSnapshot()
  const loadout = makeLoadout({ name })
  DBState.db.loadouts.push(loadout)
  dispatchCreateLoadout(loadout, previous)
  return loadout
}
