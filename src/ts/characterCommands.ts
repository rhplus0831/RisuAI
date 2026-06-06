import { get } from 'svelte/store'
import {
  canUseServerCommands,
  createAndSelectCharacterCommand,
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
import { withTrustedServerProjectionWrite } from './server/projectionWriteGuard.svelte'
import { DBState, selectedCharID } from './stores.svelte'
import type { character, folder } from './storage/database.svelte'

export interface CharacterStateSnapshot {
  characters: character[]
  characterOrder: (string | folder)[]
  currentChar?: number
  selectedCharID: number
}

// Selecting a character only flips `selectedCharID`/`currentChar` and bumps the
// target character's `lastInteraction`, so its rollback never needs the full
// deep-cloned state snapshot. Capturing just these scalars avoids a synchronous
// JSON clone of the entire characters array (with all chat histories) on every
// sidebar click, which otherwise blocks the UI for seconds before the select +
// hydration requests can fire.
export interface CharacterSelectionSnapshot {
  characterId: string
  lastInteraction: number | undefined
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
  withTrustedServerProjectionWrite(() => {
    DBState.db.characters = cloneJsonValue(snapshot.characters)
    DBState.db.characterOrder = cloneJsonValue(snapshot.characterOrder)
    ;(DBState.db as unknown as { currentChar?: number }).currentChar = snapshot.currentChar
    selectedCharID.set(snapshot.selectedCharID)
  })
}

export function currentCharacterSelectionSnapshot(characterId: string): CharacterSelectionSnapshot {
  const character = DBState.db.characters?.find((candidate) => candidate.chaId === characterId)
  return {
    characterId,
    lastInteraction: character?.lastInteraction,
    currentChar: (DBState.db as unknown as { currentChar?: number }).currentChar,
    selectedCharID: get(selectedCharID),
  }
}

export function restoreCharacterSelection(snapshot: CharacterSelectionSnapshot): void {
  withTrustedServerProjectionWrite(() => {
    const character = DBState.db.characters?.find(
      (candidate) => candidate.chaId === snapshot.characterId,
    )
    if (character) {
      character.lastInteraction = snapshot.lastInteraction
    }
    ;(DBState.db as unknown as { currentChar?: number }).currentChar = snapshot.currentChar
    selectedCharID.set(snapshot.selectedCharID)
  })
}

// Narrow single-row rollback. Character field edits, image/emotion writes, and
// `setCurrentCharacter`/`setCharacterByIndex` only mutate one character row (and
// the selection scalars), so the snapshot clones just that row instead of the
// whole `characters` array with every hydrated chat history. The full-array
// `CharacterStateSnapshot` stays for create/delete/reorder.
export interface CharacterRowSnapshot {
  characterId: string | undefined
  index: number
  character: character | undefined
  currentChar?: number
  selectedCharID: number
}

export interface CharacterTrashTimeSnapshot {
  characterId: string | undefined
  index: number
  hadTrashTime: boolean
  trashTime: number | null | undefined
  currentChar?: number
  selectedCharID: number
}

export function currentCharacterRowSnapshot(index: number = get(selectedCharID)): CharacterRowSnapshot {
  const character = DBState.db.characters?.[index]
  return {
    characterId: character?.chaId,
    index,
    character: character ? cloneJsonValue(character) : undefined,
    currentChar: (DBState.db as unknown as { currentChar?: number }).currentChar,
    selectedCharID: get(selectedCharID),
  }
}

export function currentCharacterTrashTimeSnapshot(
  index: number = get(selectedCharID),
): CharacterTrashTimeSnapshot {
  const character = DBState.db.characters?.[index] as
    | (character & { trashTime?: number | null })
    | undefined
  return {
    characterId: character?.chaId,
    index,
    hadTrashTime: !!character && Object.prototype.hasOwnProperty.call(character, 'trashTime'),
    trashTime: character?.trashTime,
    currentChar: (DBState.db as unknown as { currentChar?: number }).currentChar,
    selectedCharID: get(selectedCharID),
  }
}

export function restoreCharacterRow(snapshot: CharacterRowSnapshot): void {
  withTrustedServerProjectionWrite(() => {
    const characters = DBState.db.characters
    if (snapshot.character && characters) {
      const index = locateCharacterIndex(characters, snapshot.characterId, snapshot.index)
      if (index >= 0) {
        characters[index] = cloneJsonValue(snapshot.character) as character
      }
    }
    ;(DBState.db as unknown as { currentChar?: number }).currentChar = snapshot.currentChar
    selectedCharID.set(snapshot.selectedCharID)
  })
}

export function restoreCharacterTrashTime(snapshot: CharacterTrashTimeSnapshot): void {
  withTrustedServerProjectionWrite(() => {
    const characters = DBState.db.characters
    if (characters) {
      const index = locateCharacterIndex(characters, snapshot.characterId, snapshot.index)
      if (index >= 0) {
        const character = characters[index] as character & { trashTime?: number | null }
        if (snapshot.hadTrashTime) {
          character.trashTime = snapshot.trashTime
        } else {
          delete character.trashTime
        }
      }
    }
    ;(DBState.db as unknown as { currentChar?: number }).currentChar = snapshot.currentChar
    selectedCharID.set(snapshot.selectedCharID)
  })
}

function locateCharacterIndex(
  characters: character[],
  characterId: string | undefined,
  fallbackIndex: number,
): number {
  // Prefer the stable id so a stale index can never overwrite the wrong row;
  // fall back to the captured index only when the row carried no id.
  if (characterId) {
    const byId = characters.findIndex((candidate) => candidate.chaId === characterId)
    if (byId >= 0) return byId
  }
  return fallbackIndex >= 0 && fallbackIndex < characters.length ? fallbackIndex : -1
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

export function dispatchCreateAndSelectCharacter(
  character: character,
  previous: CharacterStateSnapshot,
  lastInteraction: number,
): void {
  runCharacterCommand(
    (baseRevision) =>
      createAndSelectCharacterCommand({
        baseRevision,
        character: toCharacterSnapshot(character),
        lastInteraction,
      }),
    () => restoreCharacterState(previous),
  )
}

// `*With(rollback)` core plus a broad (`CharacterStateSnapshot`) and a single-row
// (`CharacterRowSnapshot`) export. The scoped variants restore only the target
// character row on failure; the broad ones remain for create/delete/reorder and
// any caller that still holds a whole-collection snapshot.
function dispatchUpdateCharacterWith(
  characterId: string,
  patch: CharacterSnapshot,
  rollback: () => void,
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
    rollback,
  )
}

export function dispatchUpdateCharacter(
  characterId: string,
  patch: CharacterSnapshot,
  previous: CharacterStateSnapshot,
  rollback: (snapshot: CharacterStateSnapshot) => void = restoreCharacterState,
): void {
  dispatchUpdateCharacterWith(characterId, patch, () => rollback(previous))
}

// Single-row rollback variant of `dispatchUpdateCharacter` for character-FIELD
// edits: a failed update restores only the target character row (and the
// selection scalars), never the whole characters array.
export function dispatchUpdateCharacterScoped(
  characterId: string,
  patch: CharacterSnapshot,
  previous: CharacterRowSnapshot,
): void {
  dispatchUpdateCharacterWith(characterId, patch, () => restoreCharacterRow(previous))
}

export function dispatchUpdateCharacterTrashTime(
  characterId: string,
  trashTime: number,
  previous: CharacterTrashTimeSnapshot,
): void {
  dispatchUpdateCharacterWith(characterId, { trashTime }, () => restoreCharacterTrashTime(previous))
}

function dispatchCompatibleCharacterUpdateWith(
  previousCharacter: character | undefined,
  nextCharacter: character | undefined,
  rollback: () => void,
): void {
  const characterId = nextCharacter?.chaId ?? previousCharacter?.chaId
  if (!characterId || !previousCharacter || !nextCharacter) return

  const patch = changedCharacterFields(previousCharacter, nextCharacter)
  if (Object.keys(patch).length === 0) return
  dispatchUpdateCharacterWith(characterId, patch, rollback)
}

export function dispatchCompatibleCharacterUpdate(
  previousCharacter: character | undefined,
  nextCharacter: character | undefined,
  previous: CharacterStateSnapshot,
): void {
  dispatchCompatibleCharacterUpdateWith(previousCharacter, nextCharacter, () =>
    restoreCharacterState(previous),
  )
}

// Single-row rollback variant of `dispatchCompatibleCharacterUpdate` for the
// character-field update paths (`setCurrentCharacter` / `setCharacterByIndex` and
// their trigger callers): a failed update restores only that one character row.
export function dispatchCompatibleCharacterUpdateScoped(
  previousCharacter: character | undefined,
  nextCharacter: character | undefined,
  previous: CharacterRowSnapshot,
): void {
  dispatchCompatibleCharacterUpdateWith(previousCharacter, nextCharacter, () =>
    restoreCharacterRow(previous),
  )
}

// Factory-list form of dispatchCompatibleCharacterUpdate so the V3 plugin API
// can route through runOptimisticCommandSequence instead of a fire-and-forget
// dispatch. Returns the factories array and a rollback closure.
export function prepareCompatibleCharacterUpdate(
  previousCharacter: character | undefined,
  nextCharacter: character | undefined,
  previous: CharacterStateSnapshot,
): {
  factories: Array<(baseRevision: number) => Promise<ServerCommandResult>>
  rollback: () => void
} {
  const factories: Array<(baseRevision: number) => Promise<ServerCommandResult>> = []
  const characterId = nextCharacter?.chaId ?? previousCharacter?.chaId
  if (characterId && previousCharacter && nextCharacter) {
    const patch = changedCharacterFields(previousCharacter, nextCharacter)
    const commandPatch = sanitizeCharacterPatch(patch)
    if (Object.keys(commandPatch).length > 0) {
      factories.push((baseRevision) =>
        updateCharacterCommand({
          baseRevision,
          characterId,
          patch: commandPatch,
        }),
      )
    }
  }
  return { factories, rollback: () => restoreCharacterState(previous) }
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
  previous: CharacterSelectionSnapshot,
  lastInteraction?: number,
): void {
  runCharacterCommand(
    (baseRevision) =>
      selectCharacterCommand({
        baseRevision,
        characterId,
        lastInteraction,
      }),
    () => restoreCharacterSelection(previous),
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

export function setCharacterSupaMemory(characterId: string, enabled: boolean): void {
  const previous = currentCharacterStateSnapshot()
  if (canUseServerCommands()) {
    dispatchUpdateCharacter(characterId, { supaMemory: enabled }, previous)
    return
  }

  const character = DBState.db.characters.find((candidate) => candidate.chaId === characterId)
  if (character) {
    character.supaMemory = enabled
  }
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

// Diff per kept key without first deep-cloning the whole character (M13). The
// old shape cloned `previous` and `current` in full — `chats` with every
// hydrated history included — and then immediately stripped exactly those heavy
// keys via `sanitizeCharacterPatch`. Skipping `CHARACTER_PATCH_EXCLUDED_KEYS`
// before any clone keeps the diff O(kept fields); per-key JSON comparison on
// the raw values is equivalent to comparing the cloned values (the clone was a
// JSON round-trip, and `JSON.stringify` is stable across that round-trip).
// Only changed kept values are cloned into the patch. Exported for the M13
// clone-cost/parity gate.
export function changedCharacterFields(previous: character, current: character): CharacterSnapshot {
  const patch: CharacterSnapshot = {}
  const previousRecord = (previous ?? {}) as unknown as Record<string, unknown>
  const currentRecord = (current ?? {}) as unknown as Record<string, unknown>
  const keys = new Set([...Object.keys(previousRecord), ...Object.keys(currentRecord)])
  for (const key of keys) {
    if (CHARACTER_PATCH_EXCLUDED_KEYS.has(key)) continue
    if (snapshotJson(previousRecord[key]) !== snapshotJson(currentRecord[key])) {
      // A deleted field clones `undefined` here, exactly like the old shape;
      // `sanitizeCharacterPatch` drops it before the command is built.
      patch[key] = cloneJsonValue(currentRecord[key])
    }
  }
  return patch
}

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}
