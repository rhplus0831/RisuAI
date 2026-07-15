import { selectedCharID } from '../stores.svelte'
import { getResourceDatabase as getDatabase } from './resourceState.svelte'

export interface SelectedCharacterRefreshTarget {
  selectedIndex: number
  characterId: string | undefined
}

export interface SelectedCharacterRefreshSnapshot {
  target: SelectedCharacterRefreshTarget
  selectionChanged: boolean
}

export interface SelectedCharacterRefreshTracker {
  snapshot(): SelectedCharacterRefreshSnapshot
  stop(): void
}

function captureSelectedCharacterTarget(selectedIndex: number): SelectedCharacterRefreshTarget {
  const characterId = selectedIndex >= 0 ? getDatabase().characters?.[selectedIndex]?.chaId : undefined
  return { selectedIndex, characterId }
}

/**
 * Capture character identity when the selected-index store changes while an
 * authoritative read is in flight. Reading the id only after the refresh is
 * unsafe because a replacement character list may assign that index to a
 * different character.
 */
export function trackSelectedCharacterDuringRefresh(): SelectedCharacterRefreshTracker {
  let target: SelectedCharacterRefreshTarget = { selectedIndex: -1, characterId: undefined }
  let selectionChanged = false
  let initialized = false

  const unsubscribe = selectedCharID.subscribe((selectedIndex) => {
    target = captureSelectedCharacterTarget(selectedIndex)
    if (initialized) selectionChanged = true
    initialized = true
  })

  return {
    snapshot: () => ({ target: { ...target }, selectionChanged }),
    stop: unsubscribe,
  }
}

export function resolveSelectedCharacterIndexAfterRefresh(target: SelectedCharacterRefreshTarget): number {
  if (target.selectedIndex < 0) return -1

  const database = getDatabase()
  const preservedIndex = target.characterId
    ? database.characters.findIndex((character) => character?.chaId === target.characterId)
    : -1
  if (preservedIndex >= 0) return preservedIndex

  const currentChar = (database as { currentChar?: unknown }).currentChar
  return Number.isInteger(currentChar) &&
    (currentChar as number) >= 0 &&
    (currentChar as number) < database.characters.length
    ? (currentChar as number)
    : -1
}
