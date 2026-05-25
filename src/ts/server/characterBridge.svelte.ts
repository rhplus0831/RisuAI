import { untrack } from 'svelte'
import { get } from 'svelte/store'
import {
  CHARACTER_PATCH_EXCLUDED_KEYS,
  cloneJsonValue,
  currentCharacterStateSnapshot,
  dispatchUpdateCharacter,
  restoreCharacterState,
  sanitizeCharacterPatch,
  type CharacterStateSnapshot,
} from '../characterCommands'
import { canUseServerCommands, type CharacterSnapshot } from './commands'
import { DBState, selectedCharID } from '../stores.svelte'

interface PendingCharacterPatch {
  characterId: string
  patch: CharacterSnapshot
  previous: CharacterStateSnapshot
  timer: ReturnType<typeof setTimeout> | null
}

let pendingPatch: PendingCharacterPatch | null = null
let suppressRollbackDispatch = false

export interface WatchServerBackedCharacterProfileOptions {
  delayMs?: number
}

export function watchServerBackedCharacterProfile(
  options: WatchServerBackedCharacterProfileOptions = {},
): () => void {
  if (!canUseServerCommands()) return () => {}

  const delayMs = options.delayMs ?? 300
  let initialized = false
  let previousSelected = -1
  let previousProfileSnapshot = ''
  let previousState = currentCharacterStateSnapshot()

  const stop = $effect.root(() => {
    $effect(() => {
      const index = get(selectedCharID)
      const character = DBState.db.characters?.[index]
      const currentState = currentCharacterStateSnapshot()
      const currentProfile = character
        ? scalarCharacterProfile(character as unknown as Record<string, unknown>)
        : {}
      const currentProfileSnapshot = snapshotJson(currentProfile)

      if (!initialized || index !== previousSelected || !character?.chaId) {
        initialized = true
        previousSelected = index
        previousProfileSnapshot = currentProfileSnapshot
        previousState = currentState
        return
      }

      if (
        suppressRollbackDispatch ||
        currentProfileSnapshot === previousProfileSnapshot ||
        !character.chaId
      ) {
        previousState = currentState
        return
      }

      const previousProfile = JSON.parse(previousProfileSnapshot) as CharacterSnapshot
      const patch = changedProfileFields(previousProfile, currentProfile)
      if (Object.keys(patch).length > 0) {
        untrack(() => queueCharacterPatch(character.chaId, patch, previousState, delayMs))
      }

      previousProfileSnapshot = currentProfileSnapshot
      previousState = currentState
    })
  })

  return stop
}

function queueCharacterPatch(
  characterId: string,
  patch: CharacterSnapshot,
  previous: CharacterStateSnapshot,
  delay: number,
): void {
  if (pendingPatch?.timer) clearTimeout(pendingPatch.timer)

  pendingPatch =
    pendingPatch && pendingPatch.characterId === characterId
      ? {
          ...pendingPatch,
          patch: { ...pendingPatch.patch, ...patch },
          timer: null,
        }
      : {
          characterId,
          patch,
          previous,
          timer: null,
        }

  pendingPatch.timer = setTimeout(() => {
    const commandPatch = pendingPatch
    pendingPatch = null
    if (!commandPatch) return

    dispatchUpdateCharacter(
      commandPatch.characterId,
      commandPatch.patch,
      {
        ...commandPatch.previous,
        selectedCharID: get(selectedCharID),
      },
      rollbackServerBackedCharacterProfile,
    )
  }, delay)
}

function scalarCharacterProfile(character: Record<string, unknown>): CharacterSnapshot {
  return sanitizeCharacterPatch(cloneJsonValue(character) as CharacterSnapshot)
}

function changedProfileFields(
  previous: CharacterSnapshot,
  current: CharacterSnapshot,
): CharacterSnapshot {
  const patch: CharacterSnapshot = {}
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)])
  for (const key of keys) {
    if (CHARACTER_PATCH_EXCLUDED_KEYS.has(key)) continue
    if (snapshotJson(previous[key]) !== snapshotJson(current[key])) {
      patch[key] = cloneJsonValue(current[key])
    }
  }
  return patch
}

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

export function rollbackServerBackedCharacterProfile(snapshot: CharacterStateSnapshot): void {
  suppressRollbackDispatch = true
  try {
    restoreCharacterState(snapshot)
  } finally {
    queueMicrotask(() => {
      suppressRollbackDispatch = false
    })
  }
}
