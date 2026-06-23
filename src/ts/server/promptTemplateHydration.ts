import { get, writable } from 'svelte/store'
import { mergeServerProjectionFields, type Database } from '../storage/database.svelte'
import { DBState } from '../stores.svelte'
import { peekCachedServerCommandRevision } from './commands'
import { canUseServerProjection, fetchServerProjectionResource } from './projection'

export const promptTemplateHydratedStore = writable(false)

let promptTemplateHydrationInFlight = new Map<string, Promise<boolean>>()
let promptTemplateHydrationGeneration = 0
let promptTemplateHydratedOwnerId: string | null = null

export function currentPromptTemplateOwnerId(): string | null {
  const selectedIndex = DBState.db?.promptPresetsId
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0) return null
  const preset = DBState.db?.promptPresets?.[selectedIndex]
  return typeof preset?.id === 'string' && preset.id.trim() !== '' ? preset.id : null
}

export function isPromptTemplateHydrated(promptPresetId: string | null = currentPromptTemplateOwnerId()): boolean {
  if (get(promptTemplateHydratedStore) && promptTemplateHydratedOwnerId === promptPresetId) return true
  return promptPresetId === null && Object.prototype.hasOwnProperty.call(DBState.db ?? {}, 'promptTemplate')
}

export function resetPromptTemplateHydration(): void {
  promptTemplateHydrationGeneration += 1
  promptTemplateHydrationInFlight = new Map()
  promptTemplateHydratedOwnerId = null
  promptTemplateHydratedStore.set(false)
}

export function markPromptTemplateProjectionApplied(
  promptPresetId: string | null = currentPromptTemplateOwnerId(),
): void {
  promptTemplateHydratedOwnerId = promptPresetId
  promptTemplateHydratedStore.set(true)
}

export function startPromptTemplateHydration(): void {
  void ensurePromptTemplateHydrated()
}

export async function ensurePromptTemplateHydrated(
  options: { force?: boolean; promptPresetId?: string | null } = {},
): Promise<boolean> {
  if (!canUseServerProjection()) return false
  const ownerId = options.promptPresetId === undefined ? currentPromptTemplateOwnerId() : options.promptPresetId
  if (!options.force && isPromptTemplateHydrated(ownerId)) return true
  const ownerKey = ownerId ?? '__legacy__'
  const inFlight = promptTemplateHydrationInFlight.get(ownerKey)
  if (inFlight) return inFlight

  const generation = promptTemplateHydrationGeneration
  const baselineRevision = peekCachedServerCommandRevision()
  if (baselineRevision === null && !options.force) return false
  const request = (async () => {
    const result = await fetchServerProjectionResource('promptItem', ownerId ? { parentId: ownerId } : {})
    if (generation !== promptTemplateHydrationGeneration) return false
    if (ownerId !== currentPromptTemplateOwnerId()) return false
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
    if ((result.fields as Record<string, unknown>).promptTemplate === null) {
      delete (DBState.db as unknown as Record<string, unknown>).promptTemplate
    }
    markPromptTemplateProjectionApplied(ownerId)
    return true
  })().finally(() => {
    if (promptTemplateHydrationInFlight.get(ownerKey) === request) {
      promptTemplateHydrationInFlight.delete(ownerKey)
    }
  })

  promptTemplateHydrationInFlight.set(ownerKey, request)
  return request
}

function isOlderThanRevision(revision: number, comparisonRevision: number | null): boolean {
  return comparisonRevision !== null && revision < comparisonRevision
}

function promptTemplateHydrationWarning(message: string): void {
  console.warn(`promptTemplate hydration failed: ${message}`)
}
