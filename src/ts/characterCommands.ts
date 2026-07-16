import { get } from 'svelte/store'
import { v4 } from 'uuid'
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
  type ChatSnapshot,
  type ServerCommandResult,
  type ServerCommandTransportOptions,
} from './server/commands'
import { withTrustedResourceWrite } from './server/resourceWriteGuard.svelte'
import { getResourceDatabase as getDatabase } from './server/resourceState.svelte'
import { applyAttemptedFieldRollback, applyAttemptedKeyedListRollback } from './server/staleStateGuards'
import { recordHydratedCharacterLorebooks } from './server/lorebookBridge.svelte'
import { dispatchDurableMutation } from './server/durableMutationDispatch'
import { flushRegisteredPendingBridgePatches } from './server/pendingBridgeFlushRegistry'
import { stagePendingMutation, type DurableMutationIntent } from './server/pendingMutationOutbox'
import { characterOwnerMutationKey } from './server/resourceOwnerMutationKeys'
import { selectedCharID } from './stores.svelte'
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

interface CharacterSelectionAttempt {
  characterId: string
  lastInteraction: number | undefined
  currentChar?: number
  selectedCharID: number
}

export interface CharacterOrderDragPosition {
  index: number
  folder?: string
}

export type CharacterOrderFolderTarget =
  | string
  | number
  | {
      id?: string | null
      index?: number | null
    }

export interface CharacterOrderFolderMetadataPatch {
  name?: string
  color?: string
  imgFile?: string | null
  img?: string
}

type CharacterOrderFolderMetadataKey = keyof CharacterOrderFolderMetadataPatch

interface CharacterOrderRollback {
  previousOrder: readonly (string | folder)[]
  attemptedOrder: readonly (string | folder)[]
}

interface CharacterOrderFolderMetadataRollback {
  folderId: string
  previous: Partial<Record<CharacterOrderFolderMetadataKey, unknown>>
  attempted: Partial<Record<CharacterOrderFolderMetadataKey, unknown>>
}

interface CharacterCreateRollback {
  characterId: string
  attemptedCharacter: character
  restoreSelection: boolean
  previousCurrentChar?: number
  previousSelectedCharID: number
}

interface CharacterDeleteRollback {
  characterId: string
  character: character
  previousIndex: number
  orderPlacement: CharacterOrderPlacement | null
  previousCurrentChar?: number
  previousSelectedCharID: number
  previousSelectedCharacterId?: string
}

interface CharacterDeleteRollbackSelection {
  liveSelectedCharacterId?: string
  restorePreviousSelection: boolean
}

export interface CharacterOrderNormalizationResult {
  characterOrder: (string | folder)[]
  changed: boolean
}

const CHARACTER_ORDER_FOLDER_METADATA_KEYS: CharacterOrderFolderMetadataKey[] = ['name', 'color', 'imgFile', 'img']

export interface CompatibleCharacterUpdatePreparation {
  characterId?: string
  patch: CharacterSnapshot
  optimisticCharacter?: character
  factories: Array<(baseRevision: number) => Promise<ServerCommandResult>>
  rollback: () => void
}

export const CHARACTER_PATCH_EXCLUDED_KEYS = new Set([
  'chaId',
  'chats',
  'chatFolders',
  'lastInteraction',
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
    characters: cloneJsonValue(getDatabase().characters ?? []),
    characterOrder: cloneJsonValue(getDatabase().characterOrder ?? []),
    currentChar: (getDatabase() as unknown as { currentChar?: number }).currentChar,
    selectedCharID: get(selectedCharID),
  }
}

export function restoreCharacterState(snapshot: CharacterStateSnapshot): void {
  withTrustedResourceWrite(() => {
    getDatabase().characters = cloneJsonValue(snapshot.characters)
    getDatabase().characterOrder = cloneJsonValue(snapshot.characterOrder)
    ;(getDatabase() as unknown as { currentChar?: number }).currentChar = snapshot.currentChar
    selectedCharID.set(snapshot.selectedCharID)
  })
}

function currentCharacterOrderSnapshot(): (string | folder)[] {
  return cloneJsonValue(getDatabase().characterOrder ?? [])
}

export function currentCharacterSelectionSnapshot(characterId: string): CharacterSelectionSnapshot {
  const character = getDatabase().characters?.find((candidate) => candidate.chaId === characterId)
  return {
    characterId,
    lastInteraction: character?.lastInteraction,
    currentChar: (getDatabase() as unknown as { currentChar?: number }).currentChar,
    selectedCharID: get(selectedCharID),
  }
}

export function restoreCharacterSelection(snapshot: CharacterSelectionSnapshot): void {
  withTrustedResourceWrite(() => {
    const character = getDatabase().characters?.find((candidate) => candidate.chaId === snapshot.characterId)
    if (character) {
      character.lastInteraction = snapshot.lastInteraction
    }
    ;(getDatabase() as unknown as { currentChar?: number }).currentChar = snapshot.currentChar
    selectedCharID.set(snapshot.selectedCharID)
  })
}

function currentCharacterSelectionAttempt(
  characterId: string,
  lastInteraction: number | undefined,
): CharacterSelectionAttempt {
  return {
    characterId,
    lastInteraction,
    currentChar: (getDatabase() as unknown as { currentChar?: number }).currentChar,
    selectedCharID: get(selectedCharID),
  }
}

function restoreCharacterSelectionAttempt(
  previous: CharacterSelectionSnapshot,
  attempted: CharacterSelectionAttempt,
): void {
  withTrustedResourceWrite(() => {
    const liveSelectedCharID = get(selectedCharID)
    const liveCurrentChar = (getDatabase() as unknown as { currentChar?: number }).currentChar
    const liveSelectedCharacterId = selectedCharacterIdAt(liveSelectedCharID)
    const attemptedCharacter = getDatabase().characters?.find((candidate) => candidate?.chaId === attempted.characterId)

    if (
      liveSelectedCharID !== attempted.selectedCharID ||
      liveCurrentChar !== attempted.currentChar ||
      liveSelectedCharacterId !== attempted.characterId ||
      (attempted.lastInteraction !== undefined && attemptedCharacter?.lastInteraction !== attempted.lastInteraction)
    ) {
      return
    }

    const previousCharacter = getDatabase().characters?.find((candidate) => candidate.chaId === previous.characterId)
    if (previousCharacter) {
      previousCharacter.lastInteraction = previous.lastInteraction
    }
    ;(getDatabase() as unknown as { currentChar?: number }).currentChar = previous.currentChar
    selectedCharID.set(previous.selectedCharID)
  })
}

// Narrow single-row rollback. Character field edits, image/emotion writes, and
// `setCurrentCharacter`/`setCharacterByIndex` only mutate one character row (and
// the selection scalars), so the snapshot clones just that row instead of the
// whole `characters` array with every hydrated chat history. The full-array
// `CharacterStateSnapshot` stays for create/delete/import-era call sites.
export interface CharacterRowSnapshot {
  characterId: string | undefined
  index: number
  character: character | undefined
  currentChar?: number
  selectedCharID: number
  attempted?: CharacterSnapshot
}

export interface CharacterTrashTimeSnapshot {
  characterId: string | undefined
  index: number
  hadTrashTime: boolean
  trashTime: number | null | undefined
  orderPlacement: CharacterOrderPlacement | null
  currentChar?: number
  selectedCharID: number
}

export interface CharacterSupaMemorySnapshot {
  characterId: string
  hadSupaMemory: boolean
  supaMemory: boolean | undefined
}

export interface CharacterInputTranslationHookSnapshot {
  characterId: string
  hadUseInputTranslationHook: boolean
  useInputTranslationHook: boolean | undefined
}

interface CharacterOrderPlacement {
  characterId: string
  rootIndex?: number
  folderIndex?: number
  folderId?: string
  folderDataIndex?: number
  folder?: folder
}

export function currentCharacterRowSnapshot(index: number = get(selectedCharID)): CharacterRowSnapshot {
  const character = getDatabase().characters?.[index]
  return {
    characterId: character?.chaId,
    index,
    character: character ? cloneJsonValue(character) : undefined,
    currentChar: (getDatabase() as unknown as { currentChar?: number }).currentChar,
    selectedCharID: get(selectedCharID),
  }
}

export function currentCharacterTrashTimeSnapshot(index: number = get(selectedCharID)): CharacterTrashTimeSnapshot {
  const character = getDatabase().characters?.[index] as (character & { trashTime?: number | null }) | undefined
  return {
    characterId: character?.chaId,
    index,
    hadTrashTime: !!character && Object.prototype.hasOwnProperty.call(character, 'trashTime'),
    trashTime: character?.trashTime,
    orderPlacement: character?.chaId ? currentCharacterOrderPlacement(character.chaId) : null,
    currentChar: (getDatabase() as unknown as { currentChar?: number }).currentChar,
    selectedCharID: get(selectedCharID),
  }
}

export function currentCharacterSupaMemorySnapshot(characterId: string): CharacterSupaMemorySnapshot | null {
  const character = getDatabase().characters?.find((candidate) => candidate.chaId === characterId)
  if (!character) return null
  return {
    characterId,
    hadSupaMemory: Object.prototype.hasOwnProperty.call(character, 'supaMemory'),
    supaMemory: character.supaMemory,
  }
}

export function currentCharacterInputTranslationHookSnapshot(
  characterId: string,
): CharacterInputTranslationHookSnapshot | null {
  const character = getDatabase().characters?.find((candidate) => candidate.chaId === characterId)
  if (!character) return null
  return {
    characterId,
    hadUseInputTranslationHook: Object.prototype.hasOwnProperty.call(character, 'useInputTranslationHook'),
    useInputTranslationHook: character.useInputTranslationHook,
  }
}

export function restoreCharacterRow(snapshot: CharacterRowSnapshot): void {
  withTrustedResourceWrite(() => {
    const characters = getDatabase().characters
    if (snapshot.character && characters) {
      const index = locateCharacterIndex(characters, snapshot.characterId, snapshot.index)
      if (index >= 0) {
        if (snapshot.attempted) {
          applyAttemptedFieldRollback({
            target: characters[index] as unknown as Record<string, unknown>,
            previous: snapshot.character as unknown as Record<string, unknown>,
            attempted: snapshot.attempted,
            deleteMissingPrevious: true,
          })
        } else {
          characters[index] = cloneJsonValue(snapshot.character) as character
        }
      }
    }
    ;(getDatabase() as unknown as { currentChar?: number }).currentChar = snapshot.currentChar
    selectedCharID.set(snapshot.selectedCharID)
  })
}

function restoreCompatibleCharacterRowAttempt(snapshot: CharacterRowSnapshot): void {
  if (!snapshot.character || !snapshot.attempted) return
  withTrustedResourceWrite(() => {
    const characters = getDatabase().characters
    if (!characters) return
    const index = locateCharacterIndex(characters, snapshot.characterId, snapshot.index)
    if (index < 0) return
    applyAttemptedFieldRollback({
      target: characters[index] as unknown as Record<string, unknown>,
      previous: snapshot.character as unknown as Record<string, unknown>,
      attempted: snapshot.attempted,
      deleteMissingPrevious: true,
    })
  })
}

export function restoreCharacterTrashTime(snapshot: CharacterTrashTimeSnapshot): void {
  withTrustedResourceWrite(() => {
    const characters = getDatabase().characters
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
    restoreCharacterOrderPlacement(snapshot)
    ;(getDatabase() as unknown as { currentChar?: number }).currentChar = snapshot.currentChar
    selectedCharID.set(snapshot.selectedCharID)
  })
}

export function restoreCharacterSupaMemory(snapshot: CharacterSupaMemorySnapshot): void {
  withTrustedResourceWrite(() => {
    const character = getDatabase().characters?.find((candidate) => candidate.chaId === snapshot.characterId)
    if (!character) return
    if (snapshot.hadSupaMemory) {
      character.supaMemory = snapshot.supaMemory
    } else {
      delete character.supaMemory
    }
  })
}

export function restoreCharacterInputTranslationHook(snapshot: CharacterInputTranslationHookSnapshot): void {
  withTrustedResourceWrite(() => {
    const character = getDatabase().characters?.find((candidate) => candidate.chaId === snapshot.characterId)
    if (!character) return
    if (snapshot.hadUseInputTranslationHook) {
      character.useInputTranslationHook = snapshot.useInputTranslationHook
    } else {
      delete character.useInputTranslationHook
    }
  })
}

function locateCharacterIndex(characters: character[], characterId: string | undefined, fallbackIndex: number): number {
  // Prefer the stable id so a stale index can never overwrite the wrong row;
  // fall back to the captured index only when the row carried no id.
  if (characterId) {
    const byId = characters.findIndex((candidate) => candidate.chaId === characterId)
    if (byId >= 0) return byId
  }
  return fallbackIndex >= 0 && fallbackIndex < characters.length ? fallbackIndex : -1
}

function currentCharacterOrderPlacement(characterId: string): CharacterOrderPlacement | null {
  return characterOrderPlacementFromOrder(getDatabase().characterOrder ?? [], characterId)
}

function characterOrderPlacementFromOrder(
  characterOrder: readonly (string | folder)[],
  characterId: string,
): CharacterOrderPlacement | null {
  for (let index = 0; index < characterOrder.length; index += 1) {
    const entry = characterOrder[index]
    if (entry === characterId) {
      return { characterId, rootIndex: index }
    }
    if (!isCharacterOrderFolder(entry)) continue
    const folderDataIndex = entry.data.indexOf(characterId)
    if (folderDataIndex === -1) continue
    return {
      characterId,
      folderIndex: index,
      folderId: entry.id,
      folderDataIndex,
      folder: cloneJsonValue(entry),
    }
  }
  return null
}

function restoreCharacterOrderPlacement(snapshot: CharacterTrashTimeSnapshot): void {
  const placement = snapshot.orderPlacement
  if (!placement?.characterId) return

  const character = getDatabase().characters?.find((candidate) => candidate.chaId === placement.characterId)
  if (!character || character.trashTime) return

  if (characterOrderIncludes(ensureCharacterOrder(), placement.characterId)) return
  restoreMissingCharacterOrderPlacement(placement)
}

function resolveRestoredFolderIndex(characterOrder: (string | folder)[], placement: CharacterOrderPlacement): number {
  if (placement.folderId) {
    const folderIndex = findCharacterOrderFolderIndex(characterOrder, placement.folderId)
    if (folderIndex !== -1) return folderIndex
  }
  const fallbackIndex = placement.folderIndex
  if (typeof fallbackIndex === 'number' && isCharacterOrderFolder(characterOrder[fallbackIndex])) {
    return fallbackIndex
  }
  return -1
}

function characterOrderIncludes(characterOrder: readonly (string | folder)[], characterId: string): boolean {
  for (const entry of characterOrder) {
    if (entry === characterId) return true
    if (isCharacterOrderFolder(entry) && entry.data.includes(characterId)) return true
  }
  return false
}

function clampInsertionIndex(index: number | undefined, length: number): number {
  if (typeof index !== 'number' || !Number.isFinite(index)) return length
  return Math.max(0, Math.min(index, length))
}

function characterCreateRollbackFromState(
  character: character,
  previous: CharacterStateSnapshot,
  restoreSelection: boolean,
): CharacterCreateRollback | null {
  const characterId = character.chaId
  if (!characterId) return null

  return {
    characterId,
    attemptedCharacter: cloneJsonValue(character),
    restoreSelection,
    previousCurrentChar: previous.currentChar,
    previousSelectedCharID: previous.selectedCharID,
  }
}

function restoreCreatedCharacterAttempt(rollback: CharacterCreateRollback | null): void {
  if (!rollback) return

  withTrustedResourceWrite(() => {
    const characters = getDatabase().characters
    if (!characters) return

    const shouldRestoreSelection =
      rollback.restoreSelection && shouldRestorePreviousSelectionAfterCreatedCharacterRollback(rollback.characterId)
    const rolledBack = applyAttemptedKeyedListRollback<character, string>({
      list: characters,
      entries: [
        {
          key: rollback.characterId,
          previous: null,
          attempted: rollback.attemptedCharacter,
        },
      ],
      getKey: (candidate) => candidate?.chaId,
    })
    if (rolledBack.length === 0) return

    getDatabase().characters = characters
    replaceCharacterOrderWithNormalized()
    if (shouldRestoreSelection) {
      restoreCharacterSelectionScalars(rollback.previousCurrentChar, rollback.previousSelectedCharID)
    }
  })
}

function characterDeleteRollbackFromState(
  characterId: string,
  previous: CharacterStateSnapshot,
): CharacterDeleteRollback | null {
  const previousIndex = previous.characters.findIndex((candidate) => candidate?.chaId === characterId)
  if (previousIndex === -1) return null

  return {
    characterId,
    character: cloneJsonValue(previous.characters[previousIndex]),
    previousIndex,
    orderPlacement: characterOrderPlacementFromOrder(previous.characterOrder, characterId),
    previousCurrentChar: previous.currentChar,
    previousSelectedCharID: previous.selectedCharID,
    previousSelectedCharacterId: previous.characters[previous.selectedCharID]?.chaId,
  }
}

function restoreDeletedCharacterAttempt(rollback: CharacterDeleteRollback | null): void {
  if (!rollback) return

  withTrustedResourceWrite(() => {
    const characters = getDatabase().characters
    if (!characters) return

    const selection = currentDeletedCharacterRollbackSelection()
    const rolledBack = applyAttemptedKeyedListRollback<character, string>({
      list: characters,
      entries: [
        {
          key: rollback.characterId,
          previous: rollback.character,
          attempted: null,
          previousIndex: rollback.previousIndex,
        },
      ],
      getKey: (candidate) => candidate?.chaId,
    })
    if (rolledBack.length === 0) return

    getDatabase().characters = characters
    restoreMissingCharacterOrderPlacement(rollback.orderPlacement)
    if (selection.restorePreviousSelection) {
      restoreCharacterSelectionScalars(rollback.previousCurrentChar, rollback.previousSelectedCharID)
    } else if (selection.liveSelectedCharacterId && selection.liveSelectedCharacterId !== rollback.characterId) {
      restoreCharacterSelectionById(selection.liveSelectedCharacterId)
    }
  })
}

function shouldRestorePreviousSelectionAfterCreatedCharacterRollback(characterId: string): boolean {
  const liveSelectedCharID = get(selectedCharID)
  if (isCharacterSelectionEmptyOrStale(liveSelectedCharID)) return true
  return selectedCharacterIdAt(liveSelectedCharID) === characterId
}

function currentDeletedCharacterRollbackSelection(): CharacterDeleteRollbackSelection {
  const liveSelectedCharID = get(selectedCharID)
  const liveSelectedCharacterId = selectedCharacterIdAt(liveSelectedCharID)
  return {
    liveSelectedCharacterId,
    restorePreviousSelection: shouldRestorePreviousSelectionAfterDeletedCharacterRollback(
      liveSelectedCharID,
      liveSelectedCharacterId,
    ),
  }
}

function shouldRestorePreviousSelectionAfterDeletedCharacterRollback(
  liveSelectedCharID: number,
  liveSelectedCharacterId: string | undefined,
): boolean {
  return liveSelectedCharID < 0 || !liveSelectedCharacterId
}

function isCharacterSelectionEmptyOrStale(index: number): boolean {
  return index < 0 || !getDatabase().characters?.[index]
}

function selectedCharacterIdAt(index: number): string | undefined {
  if (index < 0) return undefined
  return getDatabase().characters?.[index]?.chaId
}

function restoreCharacterSelectionScalars(currentChar: number | undefined, selectedCharacterIndex: number): void {
  ;(getDatabase() as unknown as { currentChar?: number }).currentChar = currentChar
  selectedCharID.set(selectedCharacterIndex)
}

function restoreCharacterSelectionById(characterId: string): void {
  const index = getDatabase().characters?.findIndex((candidate) => candidate?.chaId === characterId) ?? -1
  if (index === -1) return
  restoreCharacterSelectionScalars(index, index)
}

function restoreMissingCharacterOrderPlacement(placement: CharacterOrderPlacement | null): void {
  if (!placement?.characterId) return

  const characterOrder = ensureCharacterOrder()
  removeCharacterIdFromOrder(characterOrder, placement.characterId)

  if (placement.folder) {
    const folderIndex = resolveRestoredFolderIndex(characterOrder, placement)
    if (folderIndex !== -1) {
      const targetFolder = characterOrder[folderIndex]
      if (isCharacterOrderFolder(targetFolder)) {
        targetFolder.data.splice(
          clampInsertionIndex(placement.folderDataIndex, targetFolder.data.length),
          0,
          placement.characterId,
        )
        characterOrder[folderIndex] = targetFolder
        getDatabase().characterOrder = characterOrder
        return
      }
    }

    const restoredFolder = cloneJsonValue(placement.folder)
    restoredFolder.data = [placement.characterId]
    characterOrder.splice(clampInsertionIndex(placement.folderIndex, characterOrder.length), 0, restoredFolder)
    getDatabase().characterOrder = characterOrder
    return
  }

  characterOrder.splice(clampInsertionIndex(placement.rootIndex, characterOrder.length), 0, placement.characterId)
  getDatabase().characterOrder = characterOrder
}

function removeCharacterIdFromOrder(characterOrder: (string | folder)[], characterId: string): void {
  for (let index = characterOrder.length - 1; index >= 0; index -= 1) {
    const entry = characterOrder[index]
    if (entry === characterId) {
      characterOrder.splice(index, 1)
      continue
    }
    if (isCharacterOrderFolder(entry)) {
      entry.data = entry.data.filter((id) => id !== characterId)
      characterOrder[index] = entry
    }
  }
}

export function runCharacterCommand<T extends Record<string, unknown>>(
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
  rollback: () => void,
  options: ServerCommandTransportOptions = {},
): Promise<ServerCommandResult<T>> | undefined {
  if (!canUseServerCommands()) return
  return runServerCommand({ command, rollback, ...options })
}

export function dispatchCreateCharacter(character: character, previous: CharacterStateSnapshot): void {
  recordHydratedCharacterLorebooks([character])
  const rollback = characterCreateRollbackFromState(character, previous, false)
  repairCharacterOrderOptimistically({ dispatchReorder: false })
  runCharacterCommand(
    (baseRevision) =>
      createCharacterCommand({
        baseRevision,
        character: toCharacterSnapshot(character),
        initialChat: initialCharacterChatSnapshot(character),
      }),
    () => restoreCreatedCharacterAttempt(rollback),
  )
}

export function dispatchCreateAndSelectCharacter(
  character: character,
  previous: CharacterStateSnapshot,
  lastInteraction: number,
): void {
  recordHydratedCharacterLorebooks([character])
  const rollback = characterCreateRollbackFromState(character, previous, true)
  repairCharacterOrderOptimistically({ dispatchReorder: false })
  runCharacterCommand(
    (baseRevision) =>
      createAndSelectCharacterCommand({
        baseRevision,
        character: toCharacterSnapshot(character),
        lastInteraction,
        initialChat: initialCharacterChatSnapshot(character),
      }),
    () => restoreCreatedCharacterAttempt(rollback),
  )
}

// `*With(rollback)` core plus a broad (`CharacterStateSnapshot`) and a single-row
// (`CharacterRowSnapshot`) export. The scoped variants restore only the target
// character row on failure; the broad ones remain for create/delete/import and
// any caller that still holds a whole-collection snapshot.
function dispatchUpdateCharacterWith(
  characterId: string,
  patch: CharacterSnapshot,
  rollback: () => void,
  options: ServerCommandTransportOptions = {},
): Promise<ServerCommandResult> | undefined {
  const commandPatch = sanitizeCharacterPatch(patch)
  if (Object.keys(commandPatch).length === 0) return
  return runCharacterCommand(
    (baseRevision) =>
      updateCharacterCommand(
        {
          baseRevision,
          characterId,
          patch: commandPatch,
        },
        options.signal,
        options.keepalive,
      ),
    rollback,
    options,
  )
}

export function dispatchUpdateCharacter(
  characterId: string,
  patch: CharacterSnapshot,
  previous: CharacterStateSnapshot,
  rollback: (snapshot: CharacterStateSnapshot) => void = restoreCharacterState,
  options: ServerCommandTransportOptions = {},
): Promise<ServerCommandResult> | undefined {
  return dispatchUpdateCharacterWith(characterId, patch, () => rollback(previous), options)
}

// Single-row rollback variant of `dispatchUpdateCharacter` for character-FIELD
// edits: a failed update restores only the target character row (and the
// selection scalars), never the whole characters array.
export function dispatchUpdateCharacterScoped(
  characterId: string,
  patch: CharacterSnapshot,
  previous: CharacterRowSnapshot,
): void {
  const attempted = sanitizeCharacterPatch(patch)
  if (Object.keys(attempted).length === 0) return
  dispatchUpdateCharacterWith(characterId, attempted, () => restoreCharacterRow({ ...previous, attempted }))
}

export function dispatchUpdateCharacterTrashTime(
  characterId: string,
  trashTime: number,
  previous: CharacterTrashTimeSnapshot,
): void {
  dispatchUpdateCharacterWith(characterId, { trashTime }, () => restoreCharacterTrashTime(previous))
}

export function dispatchUpdateCharacterSupaMemory(
  characterId: string,
  enabled: boolean,
  previous: CharacterSupaMemorySnapshot,
): void {
  dispatchUpdateCharacterWith(characterId, { supaMemory: enabled }, () => restoreCharacterSupaMemory(previous))
}

export function dispatchUpdateCharacterInputTranslationHook(
  characterId: string,
  enabled: boolean,
  previous: CharacterInputTranslationHookSnapshot,
): void {
  dispatchUpdateCharacterWith(characterId, { useInputTranslationHook: enabled }, () =>
    restoreCharacterInputTranslationHook(previous),
  )
}

function dispatchCompatibleCharacterUpdateWith(
  previousCharacter: character | undefined,
  nextCharacter: character | undefined,
  rollback: () => void,
): void {
  const characterId = previousCharacter?.chaId
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
  dispatchCompatibleCharacterUpdateWith(previousCharacter, nextCharacter, () => restoreCharacterState(previous))
}

// Single-row rollback variant of `dispatchCompatibleCharacterUpdate` for the
// character-field update paths (`setCurrentCharacter` / `setCharacterByIndex` and
// their trigger callers): a failed update restores only that one character row.
export function dispatchCompatibleCharacterUpdateScoped(
  previousCharacter: character | undefined,
  nextCharacter: character | undefined,
  previous: CharacterRowSnapshot,
): void {
  const characterId = previousCharacter?.chaId
  if (!characterId || !previousCharacter || !nextCharacter) return
  const attempted = sanitizeCharacterPatch(changedCharacterFields(previousCharacter, nextCharacter))
  if (Object.keys(attempted).length === 0) return
  dispatchUpdateCharacterWith(characterId, attempted, () => restoreCharacterRow({ ...previous, attempted }))
}

export function applyCharacterRowMutationScoped(
  index: number,
  characterId: string,
  mutate: (character: character) => void,
): boolean {
  const previous = currentCharacterRowSnapshot(index)
  let applied = false
  withTrustedResourceWrite(() => {
    const target = getDatabase().characters?.[index]
    if (!target || target.chaId !== characterId) return
    mutate(target)
    applied = true
  })

  if (applied) {
    dispatchCompatibleCharacterUpdateScoped(previous.character, getDatabase().characters?.[index], previous)
  }
  return applied
}

// Factory-list form of dispatchCompatibleCharacterUpdate so the V3 plugin API
// can route through runOptimisticCommandSequence instead of a fire-and-forget
// dispatch. Returns the factories array and a rollback closure.
export function prepareCompatibleCharacterUpdate(
  previousCharacter: character | undefined,
  nextCharacter: character | undefined,
  previous: CharacterStateSnapshot,
): CompatibleCharacterUpdatePreparation {
  const factories: Array<(baseRevision: number) => Promise<ServerCommandResult>> = []
  const compatibleUpdate = prepareCompatibleCharacterProjectionUpdate(previousCharacter, nextCharacter)
  if (compatibleUpdate.characterId && Object.keys(compatibleUpdate.patch).length > 0) {
    const characterId = compatibleUpdate.characterId
    const commandPatch = compatibleUpdate.patch
    factories.push((baseRevision) =>
      updateCharacterCommand({
        baseRevision,
        characterId,
        patch: commandPatch,
      }),
    )
  }
  return { ...compatibleUpdate, factories, rollback: () => restoreCharacterState(previous) }
}

// Scoped factory-list form for plugin compatibility bridges. It uses the same
// optimistic projection and command patch as the broad helper, but failed
// commands roll back only the attempted target-row fields. Later sibling edits
// and selection changes are left alone.
export function prepareCompatibleCharacterUpdateScoped(
  previousCharacter: character | undefined,
  nextCharacter: character | undefined,
  previous: CharacterRowSnapshot,
): CompatibleCharacterUpdatePreparation {
  const factories: Array<(baseRevision: number) => Promise<ServerCommandResult>> = []
  const compatibleUpdate = prepareCompatibleCharacterProjectionUpdate(previousCharacter, nextCharacter)
  if (compatibleUpdate.characterId && Object.keys(compatibleUpdate.patch).length > 0) {
    const characterId = compatibleUpdate.characterId
    const commandPatch = compatibleUpdate.patch
    factories.push((baseRevision) =>
      updateCharacterCommand({
        baseRevision,
        characterId,
        patch: commandPatch,
      }),
    )
  }
  return {
    ...compatibleUpdate,
    factories,
    rollback: () => restoreCompatibleCharacterRowAttempt({ ...previous, attempted: compatibleUpdate.patch }),
  }
}

export function prepareCompatibleCharacterProjectionUpdate(
  previousCharacter: character | undefined,
  nextCharacter: character | undefined,
): Pick<CompatibleCharacterUpdatePreparation, 'characterId' | 'patch' | 'optimisticCharacter'> {
  const characterId = previousCharacter?.chaId
  if (!characterId || !previousCharacter || !nextCharacter) {
    return { patch: {} }
  }

  const commandPatch = sanitizeCharacterPatch(changedCharacterFields(previousCharacter, nextCharacter))
  if (Object.keys(commandPatch).length === 0) {
    return { characterId, patch: commandPatch }
  }

  return {
    characterId,
    patch: commandPatch,
    optimisticCharacter: applyCompatibleCharacterPatch(previousCharacter, commandPatch),
  }
}

export function applyCompatibleCharacterPatch(previousCharacter: character, patch: CharacterSnapshot): character {
  const sanitizedPatch = sanitizeCharacterPatch(patch)
  const nextRecord = { ...(previousCharacter as unknown as Record<string, unknown>) }
  for (const [key, value] of Object.entries(sanitizedPatch)) {
    nextRecord[key] = cloneJsonValue(value)
  }
  return nextRecord as unknown as character
}

export function dispatchDeleteCharacter(characterId: string, previous: CharacterStateSnapshot): void {
  const rollback = characterDeleteRollbackFromState(characterId, previous)
  repairCharacterOrderOptimistically({ dispatchReorder: false })
  normalizeCurrentCharacterPointerAfterDelete(characterId, previous)
  if (!canUseServerCommands()) return

  flushRegisteredPendingBridgePatches({})
  const intent: DurableMutationIntent = {
    version: 1,
    requests: [
      {
        method: 'DELETE',
        path: `/characters/${encodeURIComponent(characterId)}`,
        body: {},
      },
    ],
  }
  const outbox = stagePendingMutation(characterOwnerMutationKey(characterId), intent)
  void dispatchDurableMutation(
    outbox,
    intent,
    (transport) =>
      runCharacterCommand(
        (baseRevision) =>
          deleteCharacterCommand({
            baseRevision,
            characterId,
          }),
        () => restoreDeletedCharacterAttempt(rollback),
        transport,
      ) ?? Promise.resolve({ status: 'unavailable' as const }),
  )
}

function normalizeCurrentCharacterPointerAfterDelete(characterId: string, previous: CharacterStateSnapshot): void {
  const characters = getDatabase().characters ?? []
  if (characters.some((candidate) => candidate?.chaId === characterId)) return

  withTrustedResourceWrite(() => {
    const database = getDatabase() as unknown as { currentChar?: number }
    const previousCurrentCharacterId = Number.isInteger(previous.currentChar)
      ? previous.characters[previous.currentChar as number]?.chaId
      : undefined
    if (previousCurrentCharacterId && previousCurrentCharacterId !== characterId) {
      const preservedIndex = characters.findIndex((candidate) => candidate?.chaId === previousCurrentCharacterId)
      if (preservedIndex >= 0) {
        database.currentChar = preservedIndex
        return
      }
    }

    let currentChar = database.currentChar
    if (!Number.isInteger(currentChar)) {
      currentChar = characters.length > 0 ? 0 : -1
    }
    if ((currentChar as number) >= characters.length) {
      currentChar = characters.length > 0 ? characters.length - 1 : -1
    }
    if ((currentChar as number) < -1) {
      currentChar = characters.length > 0 ? 0 : -1
    }
    database.currentChar = currentChar
  })
}

export function dispatchSelectCharacter(
  characterId: string,
  previous: CharacterSelectionSnapshot,
  lastInteraction?: number,
): void {
  const attempted = currentCharacterSelectionAttempt(characterId, lastInteraction)
  const intent: DurableMutationIntent = {
    version: 1,
    requests: [
      {
        method: 'POST',
        path: '/characters/select',
        body: {
          characterId,
          ...(lastInteraction === undefined ? {} : { lastInteraction }),
        },
      },
    ],
  }
  const outbox = stagePendingMutation(characterOwnerMutationKey(characterId), intent)
  void dispatchDurableMutation(
    outbox,
    intent,
    (transport) =>
      runCharacterCommand(
        (baseRevision) =>
          selectCharacterCommand({
            baseRevision,
            characterId,
            lastInteraction,
          }),
        () => restoreCharacterSelectionAttempt(previous, attempted),
        transport,
      ) ?? Promise.resolve({ status: 'unavailable' as const }),
  )
}

function dispatchCharacterOrderCommand(attemptedOrder: readonly (string | folder)[], rollback: () => void): void {
  const commandOrder = cloneJsonValue(attemptedOrder)
  runCharacterCommand(
    (baseRevision) =>
      reorderCharactersCommand({
        baseRevision,
        characterOrder: cloneJsonValue(commandOrder) as CharacterOrderEntry[],
      }),
    rollback,
  )
}

export function dispatchReorderCharacters(previousOrder: (string | folder)[]): void {
  const rollback = characterOrderRollbackFromOrders(previousOrder, getDatabase().characterOrder ?? [])
  dispatchCharacterOrderCommand(rollback.attemptedOrder, () => restoreCharacterOrderAttempt(rollback))
}

function characterOrderRollbackFromOrders(
  previousOrder: readonly (string | folder)[],
  attemptedOrder: readonly (string | folder)[],
): CharacterOrderRollback {
  return {
    previousOrder: cloneJsonValue(previousOrder),
    attemptedOrder: cloneJsonValue(attemptedOrder),
  }
}

function restoreCharacterOrderAttempt(rollback: CharacterOrderRollback): void {
  withTrustedResourceWrite(() => {
    const liveOrder = getDatabase().characterOrder ?? []
    if (!characterOrderStructureEquals(liveOrder, rollback.attemptedOrder)) return

    getDatabase().characterOrder = restoreCharacterOrderStructure(rollback.previousOrder, liveOrder)
  })
}

function restoreCharacterOrderStructure(
  previousOrder: readonly (string | folder)[],
  liveOrder: readonly (string | folder)[],
): (string | folder)[] {
  const liveFoldersById = new Map<string, folder>()
  for (const entry of liveOrder) {
    if (isCharacterOrderFolder(entry)) {
      liveFoldersById.set(entry.id, entry)
    }
  }

  return previousOrder.map((entry) => {
    if (typeof entry === 'string') return entry
    if (!isCharacterOrderFolder(entry)) return cloneJsonValue(entry) as string | folder

    const restoredFolder = cloneJsonValue(liveFoldersById.get(entry.id) ?? entry)
    restoredFolder.data = cloneJsonValue(entry.data)
    return restoredFolder
  })
}

function characterOrderStructureEquals(
  left: readonly (string | folder)[],
  right: readonly (string | folder)[],
): boolean {
  return JSON.stringify(characterOrderStructure(left)) === JSON.stringify(characterOrderStructure(right))
}

function characterOrderStructure(order: readonly (string | folder)[]): unknown[] {
  return order.map((entry) => {
    if (typeof entry === 'string') return entry
    if (!isCharacterOrderFolder(entry)) return cloneJsonValue(entry)
    return { id: entry.id, data: [...entry.data] }
  })
}

export function normalizeCharacterOrder(
  characterOrder: readonly (string | folder | null | undefined)[] | null | undefined,
  characters: readonly character[] | null | undefined,
): CharacterOrderNormalizationResult {
  const rawOrder = Array.isArray(characterOrder) ? characterOrder : []
  const activeIds = new Set<string>()
  const normalized: (string | folder)[] = []
  const seen = new Set<string>()

  for (const char of characters ?? []) {
    const charId = char?.chaId
    if (isCharacterOrderableId(charId) && !char.trashTime) {
      activeIds.add(charId)
    }
  }

  for (const entry of rawOrder) {
    if (typeof entry === 'string') {
      if (activeIds.has(entry) && !seen.has(entry)) {
        normalized.push(entry)
        seen.add(entry)
      }
      continue
    }

    if (!isCharacterOrderFolder(entry)) continue
    const normalizedFolder = cloneJsonValue(entry)
    normalizedFolder.data = []
    for (const id of entry.data) {
      if (activeIds.has(id) && !seen.has(id)) {
        normalizedFolder.data.push(id)
        seen.add(id)
      }
    }
    if (normalizedFolder.data.length > 0) {
      normalized.push(normalizedFolder)
    }
  }

  for (const id of activeIds) {
    if (!seen.has(id)) {
      normalized.push(id)
    }
  }

  return {
    characterOrder: normalized,
    changed: !Array.isArray(characterOrder) || !characterOrderEquals(rawOrder, normalized),
  }
}

export function repairCharacterOrderOptimistically(
  options: {
    dispatchReorder?: boolean
  } = {},
): boolean {
  const normalized = normalizeCharacterOrder(getDatabase().characterOrder, getDatabase().characters)
  if (!normalized.changed) return false

  const shouldDispatchReorder = options.dispatchReorder ?? true
  const previousOrder = shouldDispatchReorder ? currentCharacterOrderSnapshot() : null
  withTrustedResourceWrite(() => {
    getDatabase().characterOrder = normalized.characterOrder
  })
  if (previousOrder) {
    dispatchReorderCharacters(previousOrder)
  }
  return true
}

export function moveCharacterOrderItem(
  mainIndex: CharacterOrderDragPosition,
  targetIndex: CharacterOrderDragPosition,
): boolean {
  if (isSameCharacterOrderPosition(mainIndex, targetIndex)) return false

  const previousOrder = currentCharacterOrderSnapshot()
  let changed = false
  withTrustedResourceWrite(() => {
    const characterOrder = ensureCharacterOrder()
    let mainFolderIndex = mainIndex.folder ? getCharacterOrderFolderIndex(mainIndex.folder) : null
    const targetFolderIndex = targetIndex.folder ? getCharacterOrderFolderIndex(targetIndex.folder) : null
    const mainFolder = mainFolderIndex === null ? null : characterOrder[mainFolderIndex]
    const mainFolderId = mainIndex.folder && isCharacterOrderFolder(mainFolder) ? mainFolder.id : ''
    let movingFolder: folder | false = false
    let mainId = ''

    if (mainIndex.folder) {
      if (!isCharacterOrderFolder(mainFolder)) return
      mainId = mainFolder.data[mainIndex.index]
    } else {
      const item = characterOrder[mainIndex.index]
      if (typeof item !== 'string') {
        if (!isCharacterOrderFolder(item)) return
        mainId = item.id
        movingFolder = cloneJsonValue(item)
        if (targetIndex.folder) return
      } else {
        mainId = item
      }
    }
    if (!mainId) return

    if (targetIndex.folder) {
      if (targetFolderIndex === null) return
      const targetFolder = targetFolderIndex === null ? null : characterOrder[targetFolderIndex]
      if (!isCharacterOrderFolder(targetFolder)) return
      targetFolder.data.splice(targetIndex.index, 0, mainId)
      characterOrder[targetFolderIndex] = targetFolder
    } else if (movingFolder) {
      characterOrder.splice(targetIndex.index, 0, movingFolder)
    } else {
      characterOrder.splice(targetIndex.index, 0, mainId)
    }

    if (mainIndex.folder) {
      mainFolderIndex = findCharacterOrderFolderIndex(characterOrder, mainFolderId)
      if (mainFolderIndex !== -1) {
        const folder = characterOrder[mainFolderIndex]
        if (isCharacterOrderFolder(folder)) {
          const ind =
            mainIndex.index > targetIndex.index ? folder.data.lastIndexOf(mainId) : folder.data.indexOf(mainId)
          if (ind !== -1) {
            folder.data.splice(ind, 1)
          }
          characterOrder[mainFolderIndex] = folder
        }
      } else {
        console.log('folder not found')
      }
    } else if (movingFolder) {
      const idList: string[] = []
      for (const item of characterOrder) {
        idList.push(typeof item === 'string' ? item : item.id)
      }
      const ind = mainIndex.index > targetIndex.index ? idList.lastIndexOf(mainId) : idList.indexOf(mainId)
      if (ind !== -1) {
        characterOrder.splice(ind, 1)
      }
    } else {
      const ind =
        mainIndex.index > targetIndex.index ? characterOrder.lastIndexOf(mainId) : characterOrder.indexOf(mainId)
      if (ind !== -1) {
        characterOrder.splice(ind, 1)
      }
    }

    getDatabase().characterOrder = characterOrder
    replaceCharacterOrderWithNormalized()
    changed = true
  })

  if (!changed) return false
  dispatchReorderCharacters(previousOrder)
  return true
}

export function createCharacterOrderFolder(
  mainIndex: CharacterOrderDragPosition,
  targetIndex: CharacterOrderDragPosition,
  createFolderId: () => string = v4,
): boolean {
  if (isSameCharacterOrderPosition(mainIndex, targetIndex)) return false

  const previousOrder = currentCharacterOrderSnapshot()
  let changed = false
  withTrustedResourceWrite(() => {
    const characterOrder = ensureCharacterOrder()
    const mainFolderIndex = mainIndex.folder ? getCharacterOrderFolderIndex(mainIndex.folder) : null
    const mainFolder = mainFolderIndex === null ? null : characterOrder[mainFolderIndex]
    if (targetIndex.folder) {
      return
    }
    if (mainIndex.folder && !isCharacterOrderFolder(mainFolder)) {
      return
    }

    const main =
      mainIndex.folder && isCharacterOrderFolder(mainFolder)
        ? mainFolder.data[mainIndex.index]
        : characterOrder[mainIndex.index]
    const target = characterOrder[targetIndex.index]
    if (typeof main !== 'string') {
      return
    }
    if (typeof target === 'string') {
      const newFolder: folder = {
        name: 'New Folder',
        data: [main, target],
        color: '',
        id: createFolderId(),
      }
      characterOrder[targetIndex.index] = newFolder
      if (mainIndex.folder && isCharacterOrderFolder(mainFolder) && mainFolderIndex !== null) {
        mainFolder.data.splice(mainIndex.index, 1)
        characterOrder[mainFolderIndex] = mainFolder
      } else {
        characterOrder.splice(mainIndex.index, 1)
      }
    } else {
      if (!isCharacterOrderFolder(target)) return
      target.data.push(main)
      if (mainIndex.folder && isCharacterOrderFolder(mainFolder) && mainFolderIndex !== null) {
        mainFolder.data.splice(mainIndex.index, 1)
        characterOrder[mainFolderIndex] = mainFolder
      } else {
        characterOrder.splice(mainIndex.index, 1)
      }
    }
    getDatabase().characterOrder = characterOrder
    replaceCharacterOrderWithNormalized()
    changed = true
  })

  if (!changed) return false
  dispatchReorderCharacters(previousOrder)
  return true
}

export function updateCharacterOrderFolder(
  folderIdOrIndex: CharacterOrderFolderTarget,
  patch: CharacterOrderFolderMetadataPatch,
): boolean {
  const attemptedPatch = normalizeCharacterOrderFolderMetadataPatch(patch)
  const patchKeys = Object.keys(attemptedPatch) as CharacterOrderFolderMetadataKey[]
  if (patchKeys.length === 0) return false

  let rollback: CharacterOrderFolderMetadataRollback | null = null
  let changed = false
  withTrustedResourceWrite(() => {
    const characterOrder = ensureCharacterOrder()
    const folderIndex = resolveCharacterOrderFolderIndex(characterOrder, folderIdOrIndex)
    if (folderIndex === -1) return

    const targetFolder = characterOrder[folderIndex]
    if (!isCharacterOrderFolder(targetFolder)) return

    const mutableFolder = targetFolder as folder & { imgFile?: string | null }
    const previous = captureCharacterOrderFolderMetadata(mutableFolder, patchKeys)
    for (const key of patchKeys) {
      const value = attemptedPatch[key]
      switch (key) {
        case 'name':
          mutableFolder.name = value as string
          break

        case 'color':
          mutableFolder.color = value as string
          break

        case 'imgFile':
          mutableFolder.imgFile = value as string | null
          break

        case 'img':
          mutableFolder.img = value as string
          break
      }
    }
    rollback = {
      folderId: mutableFolder.id,
      previous,
      attempted: cloneJsonValue(attemptedPatch),
    }
    characterOrder[folderIndex] = mutableFolder
    getDatabase().characterOrder = characterOrder
    changed = true
  })

  if (!changed || !rollback) return false
  const metadataRollback = rollback
  dispatchCharacterOrderCommand(currentCharacterOrderSnapshot(), () =>
    restoreCharacterOrderFolderMetadataAttempt(metadataRollback),
  )
  return true
}

function normalizeCharacterOrderFolderMetadataPatch(
  patch: CharacterOrderFolderMetadataPatch,
): Partial<Record<CharacterOrderFolderMetadataKey, unknown>> {
  const normalized: Partial<Record<CharacterOrderFolderMetadataKey, unknown>> = {}
  for (const key of CHARACTER_ORDER_FOLDER_METADATA_KEYS) {
    const value = patch[key]
    if (value === undefined) continue
    normalized[key] = key === 'color' ? (value as string).toLocaleLowerCase() : cloneJsonValue(value)
  }
  return normalized
}

function captureCharacterOrderFolderMetadata(
  targetFolder: folder & { imgFile?: string | null },
  keys: readonly CharacterOrderFolderMetadataKey[],
): Partial<Record<CharacterOrderFolderMetadataKey, unknown>> {
  const captured: Partial<Record<CharacterOrderFolderMetadataKey, unknown>> = {}
  const source = targetFolder as unknown as Record<string, unknown>
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      captured[key] = cloneJsonValue(source[key])
    }
  }
  return captured
}

function restoreCharacterOrderFolderMetadataAttempt(rollback: CharacterOrderFolderMetadataRollback): void {
  withTrustedResourceWrite(() => {
    const characterOrder = getDatabase().characterOrder ?? []
    const folderIndex = findCharacterOrderFolderIndex(characterOrder, rollback.folderId)
    if (folderIndex === -1) return

    const targetFolder = characterOrder[folderIndex]
    if (!isCharacterOrderFolder(targetFolder)) return

    const rolledBack = applyAttemptedFieldRollback({
      target: targetFolder as unknown as Record<string, unknown>,
      previous: rollback.previous as Partial<Record<string, unknown>>,
      attempted: rollback.attempted as Partial<Record<string, unknown>>,
      keys: CHARACTER_ORDER_FOLDER_METADATA_KEYS,
      deleteMissingPrevious: true,
    })
    if (rolledBack.length === 0) return

    characterOrder[folderIndex] = targetFolder
    getDatabase().characterOrder = characterOrder
  })
}

function isSameCharacterOrderPosition(
  mainIndex: CharacterOrderDragPosition,
  targetIndex: CharacterOrderDragPosition,
): boolean {
  return mainIndex.index === targetIndex.index && mainIndex.folder === targetIndex.folder
}

function ensureCharacterOrder(): (string | folder)[] {
  getDatabase().characterOrder = getDatabase().characterOrder ?? []
  return getDatabase().characterOrder
}

function isCharacterOrderFolder(value: string | folder | undefined | null): value is folder {
  return !!value && typeof value !== 'string' && Array.isArray((value as folder).data)
}

function getCharacterOrderFolderIndex(id: string): number {
  return findCharacterOrderFolderIndex(getDatabase().characterOrder ?? [], id)
}

function findCharacterOrderFolderIndex(characterOrder: (string | folder)[], id: string): number {
  for (let i = 0; i < characterOrder.length; i++) {
    const data = characterOrder[i]
    if (isCharacterOrderFolder(data) && data.id === id) {
      return i
    }
  }
  return -1
}

function resolveCharacterOrderFolderIndex(
  characterOrder: (string | folder)[],
  folderIdOrIndex: CharacterOrderFolderTarget,
): number {
  if (typeof folderIdOrIndex === 'string') {
    return folderIdOrIndex ? findCharacterOrderFolderIndex(characterOrder, folderIdOrIndex) : -1
  }

  if (typeof folderIdOrIndex === 'number') {
    return isCharacterOrderFolder(characterOrder[folderIdOrIndex]) ? folderIdOrIndex : -1
  }

  const folderId = folderIdOrIndex.id ?? ''
  if (folderId) {
    return findCharacterOrderFolderIndex(characterOrder, folderId)
  }

  const fallbackIndex = folderIdOrIndex.index
  if (typeof fallbackIndex !== 'number') return -1
  return isCharacterOrderFolder(characterOrder[fallbackIndex]) ? fallbackIndex : -1
}

function replaceCharacterOrderWithNormalized(): void {
  const normalized = normalizeCharacterOrder(ensureCharacterOrder(), getDatabase().characters)
  getDatabase().characterOrder = normalized.characterOrder
}

function isCharacterOrderableId(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value !== '§temp'
}

function characterOrderEquals(
  left: readonly (string | folder | null | undefined)[],
  right: readonly (string | folder)[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function setCharacterSupaMemory(characterId: string, enabled: boolean): void {
  if (!characterId) return
  withTrustedResourceWrite(() => {
    const character = getDatabase().characters?.find((candidate) => candidate.chaId === characterId)
    if (!character || Boolean(character.supaMemory) === enabled) return

    const previous = canUseServerCommands() ? currentCharacterSupaMemorySnapshot(characterId) : null
    character.supaMemory = enabled
    if (previous) {
      dispatchUpdateCharacterSupaMemory(characterId, enabled, previous)
    }
  })
}

export function setCharacterInputTranslationHook(characterId: string, enabled: boolean): void {
  if (!characterId) return
  withTrustedResourceWrite(() => {
    const character = getDatabase().characters?.find((candidate) => candidate.chaId === characterId)
    if (!character || Boolean(character.useInputTranslationHook) === enabled) return

    const previous = canUseServerCommands() ? currentCharacterInputTranslationHookSnapshot(characterId) : null
    character.useInputTranslationHook = enabled
    if (previous) {
      dispatchUpdateCharacterInputTranslationHook(characterId, enabled, previous)
    }
  })
}

export function toCharacterSnapshot(character: character): CharacterSnapshot {
  return cloneJsonValue(character) as unknown as CharacterSnapshot
}

export function initialCharacterChatSnapshot(character: character): ChatSnapshot | undefined {
  const chat = character.chats?.[0]
  if (
    !chat ||
    typeof chat.id !== 'string' ||
    !chat.id.trim() ||
    !Array.isArray(chat.message) ||
    chat.message.length > 0 ||
    chat.hypaV3Data !== undefined
  ) {
    return undefined
  }
  return cloneJsonValue(chat) as unknown as ChatSnapshot
}

export function sanitizeCharacterPatch(patch: CharacterSnapshot): CharacterSnapshot {
  const sanitized: CharacterSnapshot = {}
  for (const [key, value] of Object.entries(patch)) {
    if (CHARACTER_PATCH_EXCLUDED_KEYS.has(key) || value === undefined) continue
    sanitized[key] = cloneJsonValue(value)
  }
  return sanitized
}

// Diff per kept key without first deep-cloning the whole character. The
// old shape cloned `previous` and `current` in full — `chats` with every
// hydrated history included — and then immediately stripped exactly those heavy
// keys via `sanitizeCharacterPatch`. Skipping `CHARACTER_PATCH_EXCLUDED_KEYS`
// before any clone keeps the diff O(kept fields); per-key JSON comparison on
// the raw values is equivalent to comparing the cloned values (the clone was a
// JSON round-trip, and `JSON.stringify` is stable across that round-trip).
// Only changed kept values are cloned into the patch. Exported for the
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
