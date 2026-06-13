import { get, writable } from 'svelte/store'
import { mergeServerProjectionFields, type Database } from '../storage/database.svelte'
import { DBState } from '../stores.svelte'
import { peekCachedServerCommandRevision } from './commands'
import { canUseServerProjection, fetchServerProjectionResource } from './projection'

export const promptTemplateHydratedStore = writable(false)

let promptTemplateHydrationInFlight: Promise<boolean> | null = null
let promptTemplateHydrationGeneration = 0

export function isPromptTemplateHydrated(): boolean {
  return get(promptTemplateHydratedStore) || Object.prototype.hasOwnProperty.call(DBState.db ?? {}, 'promptTemplate')
}

export function resetPromptTemplateHydration(): void {
  promptTemplateHydrationGeneration += 1
  promptTemplateHydrationInFlight = null
  promptTemplateHydratedStore.set(false)
}

export function markPromptTemplateProjectionApplied(): void {
  promptTemplateHydratedStore.set(true)
}

export function startPromptTemplateHydration(): void {
  void ensurePromptTemplateHydrated()
}

export async function ensurePromptTemplateHydrated(options: { force?: boolean } = {}): Promise<boolean> {
  if (!canUseServerProjection()) return false
  if (!options.force && isPromptTemplateHydrated()) return true
  if (promptTemplateHydrationInFlight) return promptTemplateHydrationInFlight

  const generation = promptTemplateHydrationGeneration
  const baselineRevision = peekCachedServerCommandRevision()
  if (baselineRevision === null && !options.force) return false
  const request = (async () => {
    const result = await fetchServerProjectionResource('promptItem')
    if (generation !== promptTemplateHydrationGeneration) return false
    if (result.status !== 'ok') {
      promptTemplateHydrationWarning(result.status === 'error' ? result.error : 'server projection unavailable')
      return false
    }
    if (result.mode !== 'fields') {
      promptTemplateHydrationWarning(`response mode was ${result.mode}`)
      return false
    }
    if (
      isOlderThanRevision(result.revision, baselineRevision) ||
      isOlderThanRevision(result.revision, peekCachedServerCommandRevision())
    ) {
      return false
    }

    mergeServerProjectionFields(result.fields as Partial<Database>)
    markPromptTemplateProjectionApplied()
    return true
  })().finally(() => {
    if (promptTemplateHydrationInFlight === request) {
      promptTemplateHydrationInFlight = null
    }
  })

  promptTemplateHydrationInFlight = request
  return request
}

function isOlderThanRevision(revision: number, comparisonRevision: number | null): boolean {
  return comparisonRevision !== null && revision < comparisonRevision
}

function promptTemplateHydrationWarning(message: string): void {
  console.warn(`promptTemplate hydration failed: ${message}`)
}
