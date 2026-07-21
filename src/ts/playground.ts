import { get } from 'svelte/store'
import { findCharacterIndexbyId } from './characterState'
import { characterFormatUpdate, createBlankChar } from './characters'
import { getDatabase, setCharacterByIndex, type character } from './storage/database.svelte'
import { PlaygroundStore, selectedCharID } from './stores.svelte'
import {
  currentCharacterStateSnapshot,
  currentCharacterSelectionSnapshot,
  dispatchCreateAndSelectCharacter,
  dispatchSelectCharacter,
  restoreCharacterState,
} from './characterCommands'
import { withTrustedResourceWrite } from './server/resourceWriteGuard.svelte'
import { canUseServerCommands, type ServerCommandResult } from './server/commands'

export const PLAYGROUND_CHARACTER_ID = '§playground'

interface InFlightPlaygroundCreate {
  completion: Promise<ServerCommandResult>
  freshnessChecks: Set<() => boolean>
  previousPlaygroundMode: number
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
  const charIndex = findCharacterIndexbyId(PLAYGROUND_CHARACTER_ID)
  PlaygroundStore.set(2)

  if (charIndex !== -1) {
    if (get(selectedCharID) === charIndex) {
      return
    }

    const previous = currentCharacterSelectionSnapshot(PLAYGROUND_CHARACTER_ID)
    const lastInteraction = Date.now()
    const formattedChar = formatPlaygroundCharacterAtIndex(charIndex, lastInteraction)

    selectedCharID.set(charIndex)
    dispatchSelectCharacter(formattedChar.chaId, previous, lastInteraction)
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
    const previous = currentCharacterStateSnapshot()
    withTrustedResourceWrite(() => {
      const database = getDatabase()
      database.characters.push(formattedChar)
      const index = database.characters.length - 1
      ;(database as unknown as { currentChar?: number }).currentChar = index
      selectedCharID.set(index)
    })

    let pending: Promise<ServerCommandResult> | undefined
    try {
      pending = dispatchCreateAndSelectCharacter(formattedChar, previous, lastInteraction, {
        shouldRestoreSelection: () => hasFreshPlaygroundCreateRoute(freshnessChecks),
      })
    } catch (error) {
      freshnessChecks.clear()
      restoreCharacterState(previous)
      selectedCharID.set(previous.selectedCharID)
      if (isFresh()) PlaygroundStore.set(previousPlaygroundMode)
      console.warn('Unable to create playground character', error)
      return
    }
    if (!pending) {
      freshnessChecks.clear()
      restoreCharacterState(previous)
      selectedCharID.set(previous.selectedCharID)
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

  withTrustedResourceWrite(() => {
    const database = getDatabase()
    database.characters.push(formattedChar)
    const index = database.characters.length - 1
    ;(database as unknown as { currentChar?: number }).currentChar = index
    selectedCharID.set(index)
  })
}

async function settlePlaygroundCreateForRoute(
  attempt: InFlightPlaygroundCreate,
  isFresh: () => boolean,
): Promise<void> {
  try {
    const result = await attempt.completion
    if (!isFresh()) return
    if (activateExistingPlaygroundProjection()) return
    PlaygroundStore.set(attempt.previousPlaygroundMode)
    if (result.status !== 'ok') console.warn('Unable to create playground character', result)
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
  const index = findCharacterIndexbyId(PLAYGROUND_CHARACTER_ID)
  if (index === -1) return false
  withTrustedResourceWrite(() => {
    ;(getDatabase() as unknown as { currentChar?: number }).currentChar = index
    selectedCharID.set(index)
  })
  PlaygroundStore.set(2)
  return true
}

function formatPlaygroundCharacterAtIndex(index: number, lastInteraction = Date.now()): character {
  const char = structuredClone(getDatabase().characters[index]) as character
  char.utilityBot = true
  char.name = 'assistant'
  char.firstMessage = '{{none}}'
  const formattedChar = characterFormatUpdate(char)
  formattedChar.lastInteraction = lastInteraction
  setCharacterByIndex(index, formattedChar)
  return formattedChar
}
