import { selectedCharID } from '../stores.svelte'
import { charactersResourceState, getResourceDatabase as getDatabase } from './resourceState.svelte'
import { selectCharacterOwner } from '../characterState'

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
  const characterId = selectedIndex >= 0 ? selectedCharacterForRefresh(selectedIndex)?.chaId : undefined
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

  const preservedIndex = target.characterId ? uniqueOwnerIndex(target.characterId) : -1
  if (preservedIndex >= 0) return preservedIndex

  const currentChar = charactersResourceState.currentChar
  const currentIndex =
    Number.isInteger(currentChar) &&
    (currentChar as number) >= 0 &&
    (currentChar as number) < charactersResourceState.characters.length
      ? (currentChar as number)
      : -1
  if (currentIndex >= 0 && selectedCharacterForRefresh(currentIndex)) return currentIndex
  if (charactersResourceState.status === 'ready') return -1
  return legacySelectedCharacterIndex(target.characterId)
}

function selectedCharacterForRefresh(selectedIndex: number) {
  const owner = selectCharacterOwner(charactersResourceState.characters, selectedIndex)
  if (owner) return owner
  if (charactersResourceState.status === 'ready') return undefined
  return getDatabase().characters?.[selectedIndex]
}

function uniqueOwnerIndex(characterId: string): number {
  let ownerIndex = -1
  for (const [index, candidate] of charactersResourceState.characters.entries()) {
    if (candidate?.chaId !== characterId) continue
    if (ownerIndex >= 0) return -1
    ownerIndex = index
  }
  if (ownerIndex >= 0 || charactersResourceState.status === 'ready') return ownerIndex
  return legacySelectedCharacterIndex(characterId)
}

/** Compatibility fallback for local/offline databases before the owner list is ready. */
function legacySelectedCharacterIndex(characterId: string | undefined): number {
  if (!characterId) return -1
  return getDatabase().characters?.findIndex((candidate) => candidate?.chaId === characterId) ?? -1
}
