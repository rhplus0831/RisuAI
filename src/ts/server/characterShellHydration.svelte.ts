import { get } from 'svelte/store'
import { DBState, selectedCharID } from '../stores.svelte'
import { isServerCharacterShell, mergeServerProjectionCharacterRow } from '../storage/database.svelte'
import { hydrateActiveCharacterLorebook, hydrateActiveChat } from './chatMessageHydration.svelte'
import { peekCachedServerCommandRevision } from './commands'
import { canUseServerProjection, fetchServerProjectionResource } from './projection'

const inFlight = new Map<string, Promise<boolean>>()
let stopSelectionSubscription: (() => void) | null = null
let shellHydrationGeneration = 0

export function startSelectedCharacterShellHydration(): void {
  if (stopSelectionSubscription || !canUseServerProjection()) return
  stopSelectionSubscription = selectedCharID.subscribe(() => {
    void hydrateSelectedCharacterShell()
  })
}

export function stopSelectedCharacterShellHydration(): void {
  stopSelectionSubscription?.()
  stopSelectionSubscription = null
  shellHydrationGeneration += 1
  inFlight.clear()
}

export async function hydrateSelectedCharacterShell(): Promise<boolean> {
  const index = get(selectedCharID)
  if (index < 0) return false
  const character = DBState.db.characters?.[index]
  if (!isServerCharacterShell(character)) return false
  const characterId = character?.chaId
  if (typeof characterId !== 'string' || characterId.trim() === '') return false
  return hydrateCharacterShell(characterId)
}

export async function hydrateCharacterShell(characterId: string): Promise<boolean> {
  if (!canUseServerProjection()) return false

  const existing = DBState.db.characters?.find((candidate) => candidate?.chaId === characterId)
  if (!isServerCharacterShell(existing)) return false

  const current = inFlight.get(characterId)
  if (current) return current

  const generation = shellHydrationGeneration
  const baselineRevision = peekCachedServerCommandRevision()
  const targetSnapshot = snapshotJson(existing)
  const request = (async () => {
    const result = await fetchServerProjectionResource('characterRow', { id: characterId })
    if (generation !== shellHydrationGeneration) return false
    if (result.status !== 'ok') {
      shellHydrationWarning(characterId, result.status === 'error' ? result.error : 'server projection unavailable')
      return false
    }
    if (result.mode !== 'character-row') {
      shellHydrationWarning(characterId, `response mode was ${result.mode}`)
      return false
    }
    if (result.characterId !== characterId) {
      shellHydrationWarning(characterId, `response was for character ${result.characterId}`)
      return false
    }
    if (isOlderThanRevision(result.revision, baselineRevision)) {
      return false
    }
    const currentTarget = DBState.db.characters?.find((candidate) => candidate?.chaId === characterId)
    if (!isServerCharacterShell(currentTarget) || snapshotJson(currentTarget) !== targetSnapshot) {
      return false
    }

    const applied = mergeServerProjectionCharacterRow(result.character)
    if (!applied) return false
    void hydrateActiveChat()
    void hydrateActiveCharacterLorebook()
    return true
  })().finally(() => {
    if (inFlight.get(characterId) === request) {
      inFlight.delete(characterId)
    }
  })

  inFlight.set(characterId, request)
  return request
}

function isOlderThanRevision(revision: number, comparisonRevision: number | null): boolean {
  return comparisonRevision !== null && revision < comparisonRevision
}

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function shellHydrationWarning(characterId: string, message: string): void {
  console.warn(`character ${characterId} hydration failed: ${message}`)
}
