import { get } from 'svelte/store'
import {
  canUseServerCommands,
  createCharacterCommand,
  deleteCharacterCommand,
  reorderCharactersCommand,
  runServerCommand,
  selectCharacterCommand,
  updateCharacterCommand,
  type CharacterOrderEntry,
  type CharacterSnapshot,
  type ServerCommandResult,
} from './server/commands'
import { DBState, selectedCharID } from './stores.svelte'
import type { character, folder } from './storage/database.svelte'

export interface CharacterStateSnapshot {
  characters: character[]
  characterOrder: (string | folder)[]
  currentChar?: number
  selectedCharID: number
}

export const CHARACTER_PATCH_EXCLUDED_KEYS = new Set([
  'chaId',
  'chats',
  'chatFolders',
  'globalLore',
  'customscript',
  'triggerscript',
  'scriptstate',
  'additionalAssets',
  'ccAssets',
  'emotionImages',
  'image',
  'modules',
  'coldstorage',
  'coldStoragedChats',
])

export function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export function currentCharacterStateSnapshot(): CharacterStateSnapshot {
  return {
    characters: cloneJsonValue(DBState.db.characters ?? []),
    characterOrder: cloneJsonValue(DBState.db.characterOrder ?? []),
    currentChar: (DBState.db as unknown as { currentChar?: number }).currentChar,
    selectedCharID: get(selectedCharID),
  }
}

export function restoreCharacterState(snapshot: CharacterStateSnapshot): void {
  DBState.db.characters = cloneJsonValue(snapshot.characters)
  DBState.db.characterOrder = cloneJsonValue(snapshot.characterOrder)
  ;(DBState.db as unknown as { currentChar?: number }).currentChar = snapshot.currentChar
  selectedCharID.set(snapshot.selectedCharID)
}

export function runCharacterCommand<T extends Record<string, unknown>>(
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
  rollback: () => void,
): void {
  if (!canUseServerCommands()) return
  void runServerCommand({ command, rollback })
}

export function dispatchCreateCharacter(
  character: character,
  previous: CharacterStateSnapshot,
): void {
  runCharacterCommand(
    (baseRevision) =>
      createCharacterCommand({
        baseRevision,
        character: toCharacterSnapshot(character),
      }),
    () => restoreCharacterState(previous),
  )
}

export function dispatchUpdateCharacter(
  characterId: string,
  patch: CharacterSnapshot,
  previous: CharacterStateSnapshot,
  rollback: (snapshot: CharacterStateSnapshot) => void = restoreCharacterState,
): void {
  const commandPatch = sanitizeCharacterPatch(patch)
  if (Object.keys(commandPatch).length === 0) return
  runCharacterCommand(
    (baseRevision) =>
      updateCharacterCommand({
        baseRevision,
        characterId,
        patch: commandPatch,
      }),
    () => rollback(previous),
  )
}

export function dispatchCompatibleCharacterUpdate(
  previousCharacter: character | undefined,
  nextCharacter: character | undefined,
  previous: CharacterStateSnapshot,
): void {
  const characterId = nextCharacter?.chaId ?? previousCharacter?.chaId
  if (!characterId || !previousCharacter || !nextCharacter) return

  const patch = changedCharacterFields(previousCharacter, nextCharacter)
  if (Object.keys(patch).length === 0) return
  dispatchUpdateCharacter(characterId, patch, previous)
}

export function dispatchDeleteCharacter(
  characterId: string,
  previous: CharacterStateSnapshot,
): void {
  runCharacterCommand(
    (baseRevision) =>
      deleteCharacterCommand({
        baseRevision,
        characterId,
      }),
    () => restoreCharacterState(previous),
  )
}

export function dispatchSelectCharacter(
  characterId: string,
  previous: CharacterStateSnapshot,
): void {
  runCharacterCommand(
    (baseRevision) =>
      selectCharacterCommand({
        baseRevision,
        characterId,
      }),
    () => restoreCharacterState(previous),
  )
}

export function dispatchReorderCharacters(previous: CharacterStateSnapshot): void {
  runCharacterCommand(
    (baseRevision) =>
      reorderCharactersCommand({
        baseRevision,
        characterOrder: cloneJsonValue(DBState.db.characterOrder ?? []) as CharacterOrderEntry[],
      }),
    () => restoreCharacterState(previous),
  )
}

export function toCharacterSnapshot(character: character): CharacterSnapshot {
  return cloneJsonValue(character) as unknown as CharacterSnapshot
}

export function sanitizeCharacterPatch(patch: CharacterSnapshot): CharacterSnapshot {
  const sanitized: CharacterSnapshot = {}
  for (const [key, value] of Object.entries(patch)) {
    if (CHARACTER_PATCH_EXCLUDED_KEYS.has(key) || value === undefined) continue
    sanitized[key] = cloneJsonValue(value)
  }
  return sanitized
}

function changedCharacterFields(previous: character, current: character): CharacterSnapshot {
  const patch: CharacterSnapshot = {}
  const previousSnapshot = sanitizeCharacterPatch(
    cloneJsonValue(previous) as unknown as CharacterSnapshot,
  )
  const currentSnapshot = sanitizeCharacterPatch(
    cloneJsonValue(current) as unknown as CharacterSnapshot,
  )
  const keys = new Set([...Object.keys(previousSnapshot), ...Object.keys(currentSnapshot)])
  for (const key of keys) {
    if (snapshotJson(previousSnapshot[key]) !== snapshotJson(currentSnapshot[key])) {
      patch[key] = cloneJsonValue(currentSnapshot[key])
    }
  }
  return patch
}

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}
