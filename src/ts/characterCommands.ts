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
  type ServerCommandResult,
  type ServerCommandTransportOptions,
} from './server/commands'
import { withTrustedServerProjectionWrite } from './server/projectionWriteGuard.svelte'
import { applyAttemptedFieldRollback } from './server/staleStateGuards'
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

export interface CharacterOrderNormalizationResult {
  characterOrder: (string | folder)[]
  changed: boolean
}

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
    const character = DBState.db.characters?.find((candidate) => candidate.chaId === snapshot.characterId)
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

interface CharacterOrderPlacement {
  characterId: string
  rootIndex?: number
  folderIndex?: number
  folderId?: string
  folderDataIndex?: number
  folder?: folder
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

export function currentCharacterTrashTimeSnapshot(index: number = get(selectedCharID)): CharacterTrashTimeSnapshot {
  const character = DBState.db.characters?.[index] as (character & { trashTime?: number | null }) | undefined
  return {
    characterId: character?.chaId,
    index,
    hadTrashTime: !!character && Object.prototype.hasOwnProperty.call(character, 'trashTime'),
    trashTime: character?.trashTime,
    orderPlacement: character?.chaId ? currentCharacterOrderPlacement(character.chaId) : null,
    currentChar: (DBState.db as unknown as { currentChar?: number }).currentChar,
    selectedCharID: get(selectedCharID),
  }
}

export function currentCharacterSupaMemorySnapshot(characterId: string): CharacterSupaMemorySnapshot | null {
  const character = DBState.db.characters?.find((candidate) => candidate.chaId === characterId)
  if (!character) return null
  return {
    characterId,
    hadSupaMemory: Object.prototype.hasOwnProperty.call(character, 'supaMemory'),
    supaMemory: character.supaMemory,
  }
}

export function restoreCharacterRow(snapshot: CharacterRowSnapshot): void {
  withTrustedServerProjectionWrite(() => {
    const characters = DBState.db.characters
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
    restoreCharacterOrderPlacement(snapshot)
    ;(DBState.db as unknown as { currentChar?: number }).currentChar = snapshot.currentChar
    selectedCharID.set(snapshot.selectedCharID)
  })
}

export function restoreCharacterSupaMemory(snapshot: CharacterSupaMemorySnapshot): void {
  withTrustedServerProjectionWrite(() => {
    const character = DBState.db.characters?.find((candidate) => candidate.chaId === snapshot.characterId)
    if (!character) return
    if (snapshot.hadSupaMemory) {
      character.supaMemory = snapshot.supaMemory
    } else {
      delete character.supaMemory
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
  const characterOrder = DBState.db.characterOrder ?? []
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

  const character = DBState.db.characters?.find((candidate) => candidate.chaId === placement.characterId)
  if (!character || character.trashTime) return

  const characterOrder = ensureCharacterOrder()
  if (characterOrderIncludes(characterOrder, placement.characterId)) return

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
        return
      }
    }

    const restoredFolder = cloneJsonValue(placement.folder)
    if (!restoredFolder.data.includes(placement.characterId)) {
      restoredFolder.data.splice(
        clampInsertionIndex(placement.folderDataIndex, restoredFolder.data.length),
        0,
        placement.characterId,
      )
    }
    characterOrder.splice(clampInsertionIndex(placement.folderIndex, characterOrder.length), 0, restoredFolder)
    return
  }

  characterOrder.splice(clampInsertionIndex(placement.rootIndex, characterOrder.length), 0, placement.characterId)
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

export function runCharacterCommand<T extends Record<string, unknown>>(
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
  rollback: () => void,
  options: ServerCommandTransportOptions = {},
): void {
  if (!canUseServerCommands()) return
  void runServerCommand({ command, rollback, ...options })
}

export function dispatchCreateCharacter(character: character, previous: CharacterStateSnapshot): void {
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
  options: ServerCommandTransportOptions = {},
): void {
  const commandPatch = sanitizeCharacterPatch(patch)
  if (Object.keys(commandPatch).length === 0) return
  runCharacterCommand(
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
): void {
  dispatchUpdateCharacterWith(characterId, patch, () => rollback(previous), options)
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
  const normalized = normalizeCharacterOrder(DBState.db.characterOrder, DBState.db.characters)
  if (!normalized.changed) return false

  const shouldDispatchReorder = options.dispatchReorder ?? true
  const previous = shouldDispatchReorder ? currentCharacterStateSnapshot() : null
  withTrustedServerProjectionWrite(() => {
    DBState.db.characterOrder = normalized.characterOrder
  })
  if (previous) {
    dispatchReorderCharacters(previous)
  }
  return true
}

export function moveCharacterOrderItem(
  mainIndex: CharacterOrderDragPosition,
  targetIndex: CharacterOrderDragPosition,
): boolean {
  if (isSameCharacterOrderPosition(mainIndex, targetIndex)) return false

  const previous = currentCharacterStateSnapshot()
  let changed = false
  withTrustedServerProjectionWrite(() => {
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

    DBState.db.characterOrder = characterOrder
    replaceCharacterOrderWithNormalized()
    changed = true
  })

  if (!changed) return false
  dispatchReorderCharacters(previous)
  return true
}

export function createCharacterOrderFolder(
  mainIndex: CharacterOrderDragPosition,
  targetIndex: CharacterOrderDragPosition,
  createFolderId: () => string = v4,
): boolean {
  if (isSameCharacterOrderPosition(mainIndex, targetIndex)) return false

  const previous = currentCharacterStateSnapshot()
  let changed = false
  withTrustedServerProjectionWrite(() => {
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
    DBState.db.characterOrder = characterOrder
    replaceCharacterOrderWithNormalized()
    changed = true
  })

  if (!changed) return false
  dispatchReorderCharacters(previous)
  return true
}

export function updateCharacterOrderFolder(
  folderIdOrIndex: CharacterOrderFolderTarget,
  patch: CharacterOrderFolderMetadataPatch,
): boolean {
  const patchEntries = Object.entries(patch).filter(([, value]) => value !== undefined)
  if (patchEntries.length === 0) return false

  const previous = currentCharacterStateSnapshot()
  let changed = false
  withTrustedServerProjectionWrite(() => {
    const characterOrder = ensureCharacterOrder()
    const folderIndex = resolveCharacterOrderFolderIndex(characterOrder, folderIdOrIndex)
    if (folderIndex === -1) return

    const targetFolder = characterOrder[folderIndex]
    if (!isCharacterOrderFolder(targetFolder)) return

    const mutableFolder = targetFolder as folder & { imgFile?: string | null }
    for (const [key, value] of patchEntries) {
      switch (key) {
        case 'name':
          mutableFolder.name = value as string
          break

        case 'color':
          mutableFolder.color = (value as string).toLocaleLowerCase()
          break

        case 'imgFile':
          mutableFolder.imgFile = value as string | null
          break

        case 'img':
          mutableFolder.img = value as string
          break
      }
    }
    characterOrder[folderIndex] = mutableFolder
    DBState.db.characterOrder = characterOrder
    changed = true
  })

  if (!changed) return false
  dispatchReorderCharacters(previous)
  return true
}

function isSameCharacterOrderPosition(
  mainIndex: CharacterOrderDragPosition,
  targetIndex: CharacterOrderDragPosition,
): boolean {
  return mainIndex.index === targetIndex.index && mainIndex.folder === targetIndex.folder
}

function ensureCharacterOrder(): (string | folder)[] {
  DBState.db.characterOrder = DBState.db.characterOrder ?? []
  return DBState.db.characterOrder
}

function isCharacterOrderFolder(value: string | folder | undefined | null): value is folder {
  return !!value && typeof value !== 'string' && Array.isArray((value as folder).data)
}

function getCharacterOrderFolderIndex(id: string): number {
  return findCharacterOrderFolderIndex(DBState.db.characterOrder ?? [], id)
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
  const normalized = normalizeCharacterOrder(ensureCharacterOrder(), DBState.db.characters)
  DBState.db.characterOrder = normalized.characterOrder
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
  withTrustedServerProjectionWrite(() => {
    const character = DBState.db.characters?.find((candidate) => candidate.chaId === characterId)
    if (!character || Boolean(character.supaMemory) === enabled) return

    const previous = canUseServerCommands() ? currentCharacterSupaMemorySnapshot(characterId) : null
    character.supaMemory = enabled
    if (previous) {
      dispatchUpdateCharacterSupaMemory(characterId, enabled, previous)
    }
  })
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
