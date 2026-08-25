import { get } from 'svelte/store'
import { selectedCharID } from '../stores.svelte'
import { getDatabase, isServerCharacterShell } from '../storage/database.svelte'
import { hydrateActiveCharacterLorebook, hydrateActiveChat } from './chatMessageHydration.svelte'
import { peekCachedServerCommandRevision } from './commands'
import { fetchServerCharacter } from './resourceReads'
import { applyCharacterResource } from './resourceState.svelte'

export const CHARACTER_SHELL_HYDRATION_TIMEOUT_MS = 15_000

export type CharacterShellHydrationStatus = 'idle' | 'loading' | 'ready' | 'error'
export type CharacterShellHydrationError = 'timeout' | 'unavailable' | 'invalid-response'

export interface CharacterShellHydrationRowState {
  status: CharacterShellHydrationStatus
  error: CharacterShellHydrationError | null
}

export interface CharacterShellHydrationOptions {
  signal?: AbortSignal | null
  supersede?: boolean
  timeoutMs?: number
}

interface InFlightCharacterHydration {
  controller: AbortController
  promise: Promise<boolean>
}

export const characterShellHydrationState = $state<{
  rows: Record<string, CharacterShellHydrationRowState>
}>({ rows: {} })

const inFlight = new Map<string, InFlightCharacterHydration>()
let stopSelectionSubscription: (() => void) | null = null
let selectedRequestAbort: AbortController | null = null
let shellHydrationGeneration = 0

export function startSelectedCharacterShellHydration(): void {
  if (stopSelectionSubscription) return
  stopSelectionSubscription = selectedCharID.subscribe(() => {
    selectedRequestAbort?.abort()
    selectedRequestAbort = new AbortController()
    void hydrateSelectedCharacterShell({ signal: selectedRequestAbort.signal, supersede: true })
  })
}

export function stopSelectedCharacterShellHydration(): void {
  stopSelectionSubscription?.()
  stopSelectionSubscription = null
  selectedRequestAbort?.abort()
  selectedRequestAbort = null
  for (const request of inFlight.values()) request.controller.abort()
  shellHydrationGeneration += 1
  inFlight.clear()
}

export async function hydrateSelectedCharacterShell(options: CharacterShellHydrationOptions = {}): Promise<boolean> {
  const index = get(selectedCharID)
  if (index < 0) return false
  const character = getDatabase().characters?.[index]
  if (!character) return false
  if (!isServerCharacterShell(character)) return true
  const characterId = character?.chaId
  if (typeof characterId !== 'string' || characterId.trim() === '') return false
  return hydrateCharacterShell(characterId, options)
}

export async function hydrateCharacterShell(
  characterId: string,
  options: CharacterShellHydrationOptions = {},
): Promise<boolean> {
  const existing = getDatabase().characters?.find((candidate) => candidate?.chaId === characterId)
  if (!isServerCharacterShell(existing)) return false

  const current = inFlight.get(characterId)
  if (current && !options.supersede) return current.promise
  if (current) {
    current.controller.abort()
    inFlight.delete(characterId)
  }
  if (options.signal?.aborted) return false

  const generation = shellHydrationGeneration
  const baselineRevision = peekCachedServerCommandRevision()
  const targetShell = existing
  const controller = new AbortController()
  const timeoutMs = normalizedTimeoutMs(options.timeoutMs)
  let timedOut = false
  const abortFromCaller = () => controller.abort()
  options.signal?.addEventListener('abort', abortFromCaller, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  setCharacterShellHydrationState(characterId, 'loading', null)
  const request = (async () => {
    let result: Awaited<ReturnType<typeof fetchServerCharacter>>
    try {
      result = await fetchServerCharacter(characterId, controller.signal)
    } catch (error) {
      if (generation === shellHydrationGeneration && !controller.signal.aborted) {
        if (targetStillMatches(characterId, targetShell)) {
          setCharacterShellHydrationState(characterId, 'error', 'unavailable')
        }
        shellHydrationWarning(characterId, error instanceof Error ? error.message : String(error))
      }
      return false
    }
    if (generation !== shellHydrationGeneration || controller.signal.aborted) {
      if (timedOut && targetStillMatches(characterId, targetShell)) {
        setCharacterShellHydrationState(characterId, 'error', 'timeout')
        shellHydrationWarning(characterId, 'request timed out')
      }
      return false
    }
    if (result.status !== 'ok') {
      const error = result.status === 'unavailable' ? 'unavailable' : 'invalid-response'
      if (targetStillMatches(characterId, targetShell)) {
        setCharacterShellHydrationState(characterId, 'error', error)
      }
      shellHydrationWarning(characterId, result.status === 'error' ? result.error : 'server resource read unavailable')
      return false
    }
    if (isOlderThanRevision(result.revision, baselineRevision)) {
      if (targetStillMatches(characterId, targetShell)) {
        setCharacterShellHydrationState(characterId, 'error', 'invalid-response')
      }
      return false
    }
    if (!targetStillMatches(characterId, targetShell)) {
      return false
    }

    const applied = applyCharacterResource(result)
    if (!applied) {
      if (targetStillMatches(characterId, targetShell)) {
        setCharacterShellHydrationState(characterId, 'error', 'invalid-response')
      }
      return false
    }
    setCharacterShellHydrationState(characterId, 'ready', null)
    void hydrateActiveChat()
    void hydrateActiveCharacterLorebook()
    return true
  })().finally(() => {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abortFromCaller)
    if (inFlight.get(characterId)?.promise === request) {
      inFlight.delete(characterId)
    }
  })

  inFlight.set(characterId, { controller, promise: request })
  return request
}

export function retryCharacterShellHydration(characterId: string): Promise<boolean> {
  return hydrateCharacterShell(characterId, { supersede: true })
}

export function resetCharacterShellHydrationStateForTests(): void {
  clearCharacterShellHydrationState()
}

/** Abort and forget optional detail reads whose auth/lineage scope is obsolete. */
export function clearCharacterShellHydrationState(): void {
  stopSelectedCharacterShellHydration()
  characterShellHydrationState.rows = {}
}

function isOlderThanRevision(revision: number, comparisonRevision: number | null): boolean {
  return comparisonRevision !== null && revision < comparisonRevision
}

function targetStillMatches(characterId: string, targetShell: unknown): boolean {
  const currentTarget = getDatabase().characters?.find((candidate) => candidate?.chaId === characterId)
  // Chat-message and lorebook hydration intentionally mutate nested body fields
  // on the same shell while this row request is in flight. Preserve those
  // independently fenced writes, but reject any actual row replacement.
  return isServerCharacterShell(currentTarget) && currentTarget === targetShell
}

function normalizedTimeoutMs(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : CHARACTER_SHELL_HYDRATION_TIMEOUT_MS
}

function setCharacterShellHydrationState(
  characterId: string,
  status: CharacterShellHydrationStatus,
  error: CharacterShellHydrationError | null,
): void {
  characterShellHydrationState.rows[characterId] = { status, error }
}

function shellHydrationWarning(characterId: string, message: string): void {
  console.warn(`character ${characterId} hydration failed: ${message}`)
}
