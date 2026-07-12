import { get } from 'svelte/store'
import { selectedCharID } from '../stores.svelte'
import { getDatabase, isServerCharacterShell } from '../storage/database.svelte'
import { hydrateActiveCharacterLorebook, hydrateActiveChat } from './chatMessageHydration.svelte'
import { peekCachedServerCommandRevision } from './commands'
import { fetchServerCharacter } from './resourceReads'
import { applyCharacterResource } from './resourceState.svelte'

const inFlight = new Map<string, Promise<boolean>>()
let stopSelectionSubscription: (() => void) | null = null
let shellHydrationGeneration = 0

export function startSelectedCharacterShellHydration(): void {
  if (stopSelectionSubscription) return
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
  const character = getDatabase().characters?.[index]
  if (!isServerCharacterShell(character)) return false
  const characterId = character?.chaId
  if (typeof characterId !== 'string' || characterId.trim() === '') return false
  return hydrateCharacterShell(characterId)
}

export async function hydrateCharacterShell(characterId: string): Promise<boolean> {
  const existing = getDatabase().characters?.find((candidate) => candidate?.chaId === characterId)
  if (!isServerCharacterShell(existing)) return false

  const current = inFlight.get(characterId)
  if (current) return current

  const generation = shellHydrationGeneration
  const baselineRevision = peekCachedServerCommandRevision()
  const targetSnapshot = snapshotJson(existing)
  const request = (async () => {
    const result = await fetchServerCharacter(characterId)
    if (generation !== shellHydrationGeneration) return false
    if (result.status !== 'ok') {
      shellHydrationWarning(characterId, result.status === 'error' ? result.error : 'server resource read unavailable')
      return false
    }
    if (isOlderThanRevision(result.revision, baselineRevision)) {
      return false
    }
    const currentTarget = getDatabase().characters?.find((candidate) => candidate?.chaId === characterId)
    if (!isServerCharacterShell(currentTarget) || snapshotJson(currentTarget) !== targetSnapshot) {
      return false
    }

    const applied = applyCharacterResource(result)
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
