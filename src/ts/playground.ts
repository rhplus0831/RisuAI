import { get } from 'svelte/store'
import { characterFormatUpdate, createBlankChar } from './characters'
import type { character } from './storage/database.svelte'
import { PlaygroundStore, selectedCharID } from './stores.svelte'
import {
  applyCharacterRowMutationScoped,
  cloneJsonValue,
  currentCharacterSelectionSnapshot,
  dispatchCreateAndSelectCharacter,
  dispatchSelectCharacter,
  restoreCharacterSelection,
  type CharacterStateSnapshot,
} from './characterCommands'
import { canUseServerCommands } from './server/commands'
import type { CharacterMutationOutcome } from './characterCommands'
import { alertNormal } from './alert'
import { language } from '../lang'
import { charactersResourceState } from './server/resourceState.svelte'

export const PLAYGROUND_CHARACTER_ID = '§playground'

interface InFlightPlaygroundCreate {
  completion: Promise<CharacterMutationOutcome>
  freshnessChecks: Set<() => boolean>
  previousPlaygroundMode: number
}

interface PlaygroundCharacterOwner {
  characters: character[]
  characterOrder: CharacterStateSnapshot['characterOrder']
  currentChar: number
  playgroundIndex: number
}

interface PlaygroundCreateProjectionFence {
  listRevision: number | null
  orderRevision: number | null
  selectionRevision: number | null
  characterIndex: number
}

let inFlightPlaygroundCreate: InFlightPlaygroundCreate | null = null

export async function openPlaygroundChat(options: { isFresh?: () => boolean } = {}): Promise<void> {
  const isFresh = options.isFresh ?? (() => true)
  if (!isFresh()) return

  if (inFlightPlaygroundCreate) {
    inFlightPlaygroundCreate.freshnessChecks.add(isFresh)
    PlaygroundStore.set(2)
    await settlePlaygroundCreateForRoute(inFlightPlaygroundCreate, isFresh)
    return
  }

  const previousPlaygroundMode = get(PlaygroundStore)
  const owner = currentPlaygroundCharacterOwner()
  if (!owner) return

  const charIndex = owner.playgroundIndex
  PlaygroundStore.set(2)

  if (charIndex !== -1) {
    if (owner.currentChar === charIndex) {
      selectedCharID.set(charIndex)
      return
    }

    const previous = currentCharacterSelectionSnapshot(PLAYGROUND_CHARACTER_ID)
    const lastInteraction = Date.now()
    const durable = canUseServerCommands()
    if (!formatPlaygroundCharacterAtIndex(charIndex, lastInteraction, durable)) {
      PlaygroundStore.set(previousPlaygroundMode)
      return
    }

    charactersResourceState.currentChar = charIndex
    selectedCharID.set(charIndex)
    if (!durable) return
    try {
      dispatchSelectCharacter(PLAYGROUND_CHARACTER_ID, previous, lastInteraction)
    } catch (error) {
      restoreCharacterSelection(previous)
      if (isFresh()) PlaygroundStore.set(previousPlaygroundMode)
      console.warn('Unable to select playground character', error)
    }
    return
  }

  const character = createBlankChar()
  character.chaId = PLAYGROUND_CHARACTER_ID
  character.utilityBot = true
  character.name = 'assistant'
  character.firstMessage = '{{none}}'
  const formattedChar = characterFormatUpdate(character)
  const lastInteraction = Date.now()
  formattedChar.lastInteraction = lastInteraction

  if (canUseServerCommands()) {
    const freshnessChecks = new Set([isFresh])
    const previous = currentPlaygroundCharacterStateSnapshot(owner)
    const projectionFence = stagePlaygroundCreateProjection(formattedChar)

    let pending: Promise<CharacterMutationOutcome> | undefined
    try {
      pending = dispatchCreateAndSelectCharacter(formattedChar, previous, lastInteraction, {
        shouldRestoreSelection: () => hasFreshPlaygroundCreateRoute(freshnessChecks),
      })
    } catch (error) {
      freshnessChecks.clear()
      rollbackStagedPlaygroundCreate(previous, formattedChar, projectionFence)
      if (isFresh()) PlaygroundStore.set(previousPlaygroundMode)
      console.warn('Unable to create playground character', error)
      return
    }
    if (!pending) {
      freshnessChecks.clear()
      rollbackStagedPlaygroundCreate(previous, formattedChar, projectionFence)
      if (isFresh()) PlaygroundStore.set(previousPlaygroundMode)
      return
    }

    const attempt: InFlightPlaygroundCreate = {
      completion: pending,
      freshnessChecks,
      previousPlaygroundMode,
    }
    inFlightPlaygroundCreate = attempt
    await settlePlaygroundCreateForRoute(attempt, isFresh)
    return
  }

  // Narrow local-only compatibility: a revision-less owner may still be used by
  // non-server test/dev runtimes. It never enters the aggregate database facade.
  stagePlaygroundCreateProjection(formattedChar)
}

async function settlePlaygroundCreateForRoute(
  attempt: InFlightPlaygroundCreate,
  isFresh: () => boolean,
): Promise<void> {
  try {
    const result = await attempt.completion
    if (!isFresh()) return
    if (result.status !== 'failed' && activateExistingPlaygroundProjection()) {
      if (result.status === 'queued') alertNormal(language.characterCreationQueued)
      return
    }
    PlaygroundStore.set(attempt.previousPlaygroundMode)
    console.warn('Unable to create playground character', result)
  } finally {
    attempt.freshnessChecks.delete(isFresh)
    if (inFlightPlaygroundCreate === attempt && attempt.freshnessChecks.size === 0) {
      inFlightPlaygroundCreate = null
    }
  }
}

function hasFreshPlaygroundCreateRoute(freshnessChecks: ReadonlySet<() => boolean>): boolean {
  for (const isFresh of freshnessChecks) {
    try {
      if (isFresh()) return true
    } catch {
      // A disposed route check cannot authorize a later selection restore.
    }
  }
  return false
}

function activateExistingPlaygroundProjection(): boolean {
  const owner = currentPlaygroundCharacterOwner()
  if (!owner) return false
  const index = owner.playgroundIndex
  if (index === -1) return false
  charactersResourceState.currentChar = index
  selectedCharID.set(index)
  PlaygroundStore.set(2)
  return true
}

function formatPlaygroundCharacterAtIndex(index: number, lastInteraction: number, durable: boolean): boolean {
  const owner = currentPlaygroundCharacterOwner()
  if (!owner || owner.playgroundIndex !== index) return false
  const char = cloneJsonValue(owner.characters[index])
  char.utilityBot = true
  char.name = 'assistant'
  char.firstMessage = '{{none}}'
  const formattedChar = characterFormatUpdate(char)
  formattedChar.lastInteraction = lastInteraction

  if (!durable) {
    replaceCharacterValue(owner.characters[index], formattedChar)
    return true
  }
  return applyCharacterRowMutationScoped(index, PLAYGROUND_CHARACTER_ID, (target) => {
    replaceCharacterValue(target, formattedChar)
  })
}

function currentPlaygroundCharacterOwner(): PlaygroundCharacterOwner | null {
  if (charactersResourceState.status !== 'ready' || charactersResourceState.error !== null) return null
  const characters = charactersResourceState.characters
  const characterOrder = charactersResourceState.characterOrder
  const currentChar = charactersResourceState.currentChar
  if (!Array.isArray(characters) || !Array.isArray(characterOrder) || !Number.isInteger(currentChar)) return null
  if (currentChar < -1 || currentChar >= characters.length) return null

  const ids = new Set<string>()
  let playgroundIndex = -1
  for (let index = 0; index < characters.length; index += 1) {
    const characterId = characters[index]?.chaId
    if (typeof characterId !== 'string' || !characterId.trim() || ids.has(characterId)) return null
    ids.add(characterId)
    if (characterId === PLAYGROUND_CHARACTER_ID) playgroundIndex = index
  }

  const playgroundStatus = charactersResourceState.rowStatuses[PLAYGROUND_CHARACTER_ID]
  if (
    charactersResourceState.rowErrors[PLAYGROUND_CHARACTER_ID] ||
    (playgroundStatus && playgroundStatus !== 'ready')
  ) {
    return null
  }
  return { characters, characterOrder, currentChar, playgroundIndex }
}

function currentPlaygroundCharacterStateSnapshot(owner: PlaygroundCharacterOwner): CharacterStateSnapshot {
  return {
    characters: cloneJsonValue(owner.characters),
    characterOrder: cloneJsonValue(owner.characterOrder),
    currentChar: owner.currentChar,
    selectedCharID: get(selectedCharID),
  }
}

function stagePlaygroundCreateProjection(character: character): PlaygroundCreateProjectionFence {
  const characterIndex = charactersResourceState.characters.length
  const fence: PlaygroundCreateProjectionFence = {
    listRevision: charactersResourceState.listRevision,
    orderRevision: charactersResourceState.orderRevision,
    selectionRevision: charactersResourceState.selectionRevision,
    characterIndex,
  }
  charactersResourceState.characters.push(character)
  charactersResourceState.currentChar = characterIndex
  selectedCharID.set(characterIndex)
  return fence
}

function rollbackStagedPlaygroundCreate(
  previous: CharacterStateSnapshot,
  attempted: character,
  fence: PlaygroundCreateProjectionFence,
): void {
  if (
    charactersResourceState.status !== 'ready' ||
    charactersResourceState.listRevision !== fence.listRevision ||
    charactersResourceState.selectionRevision !== fence.selectionRevision
  ) {
    return
  }
  const matches = charactersResourceState.characters.filter((candidate) => candidate?.chaId === PLAYGROUND_CHARACTER_ID)
  const live = charactersResourceState.characters[fence.characterIndex]
  if (matches.length !== 1 || live !== matches[0] || !sameCharacterValue(live, attempted)) return

  charactersResourceState.characters.splice(fence.characterIndex, 1)
  if (charactersResourceState.orderRevision === fence.orderRevision) {
    charactersResourceState.characterOrder = cloneJsonValue(previous.characterOrder)
  }
  if (charactersResourceState.currentChar === fence.characterIndex) {
    charactersResourceState.currentChar = previous.currentChar ?? -1
  }
  if (get(selectedCharID) === fence.characterIndex) selectedCharID.set(previous.selectedCharID)
}

function replaceCharacterValue(target: character, next: character): void {
  const targetRecord = target as unknown as Record<string, unknown>
  const nextRecord = cloneJsonValue(next) as unknown as Record<string, unknown>
  for (const key of Object.keys(targetRecord)) {
    if (!Object.prototype.hasOwnProperty.call(nextRecord, key)) delete targetRecord[key]
  }
  Object.assign(targetRecord, nextRecord)
}

function sameCharacterValue(left: character | undefined, right: character): boolean {
  return !!left && JSON.stringify(left) === JSON.stringify(right)
}
