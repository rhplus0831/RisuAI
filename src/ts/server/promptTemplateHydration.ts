import { get, writable } from 'svelte/store'
import { mergeServerProjectionFields, type Database, type PromptPreset } from '../storage/database.svelte'
import { DBState } from '../stores.svelte'
import { peekCachedServerCommandRevision } from './commands'
import { canUseServerProjection, fetchServerProjectionResource } from './projection'
import { withServerProjectionApply } from './projectionWriteGuard.svelte'

export const promptTemplateHydratedStore = writable(false)

let promptTemplateHydrationInFlight = new Map<string, Promise<boolean>>()
let promptTemplateHydrationGeneration = 0
let promptTemplateHydratedOwnerIds = new Set<string | null>()

export function currentPromptTemplateOwnerId(): string | null {
  const selectedIndex = DBState.db?.promptPresetsId
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0) return null
  const preset = DBState.db?.promptPresets?.[selectedIndex]
  return typeof preset?.id === 'string' && preset.id.trim() !== '' ? preset.id : null
}

export function isPromptTemplateHydrated(promptPresetId: string | null = currentPromptTemplateOwnerId()): boolean {
  if (get(promptTemplateHydratedStore) && promptTemplateHydratedOwnerIds.has(promptPresetId)) return true
  return promptPresetId === null && Object.prototype.hasOwnProperty.call(DBState.db ?? {}, 'promptTemplate')
}

export function resetPromptTemplateHydration(): void {
  promptTemplateHydrationGeneration += 1
  promptTemplateHydrationInFlight = new Map()
  promptTemplateHydratedOwnerIds = new Set()
  promptTemplateHydratedStore.set(false)
}

export function markPromptTemplateProjectionApplied(
  promptPresetId: string | null = currentPromptTemplateOwnerId(),
): void {
  promptTemplateHydratedOwnerIds.add(promptPresetId)
  promptTemplateHydratedStore.set(true)
}

export function startPromptTemplateHydration(): void {
  void ensurePromptTemplateHydrated()
}

export async function ensurePromptTemplateHydrated(
  options: { applyProjection?: boolean; force?: boolean; promptPresetId?: string | null } = {},
): Promise<boolean> {
  if (!canUseServerProjection()) return false
  const ownerId = options.promptPresetId === undefined ? currentPromptTemplateOwnerId() : options.promptPresetId
  if (!options.force && isPromptTemplateHydrated(ownerId)) return true
  const ownerKey = ownerId ?? '__legacy__'
  const inFlight = promptTemplateHydrationInFlight.get(ownerKey)
  if (inFlight) return inFlight

  const generation = promptTemplateHydrationGeneration
  const baselineRevision = peekCachedServerCommandRevision()
  if (baselineRevision === null && !options.force) return localPromptTemplateOwnerIsResolved(ownerId)
  const applyProjection = options.applyProjection ?? true
  const request = (async () => {
    const result = await fetchServerProjectionResource('promptItem', ownerId ? { parentId: ownerId } : {})
    if (generation !== promptTemplateHydrationGeneration) return false
    const ownerIsCurrent = ownerId === currentPromptTemplateOwnerId()
    if (applyProjection && !ownerIsCurrent) return false
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

    const fields = result.fields as Partial<Database>
    if (!applyPromptTemplateProjectionFields(fields, ownerId)) return false
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

/**
 * Apply a prompt-item projection to its explicit preset owner. A background
 * preset event must update that preset row without replacing the selected
 * preset's top-level compatibility mirror.
 */
export function applyPromptTemplateProjectionFields(
  fields: Partial<Database>,
  ownerId: string | null = currentPromptTemplateOwnerId(),
): boolean {
  if (ownerId === null) {
    mergeServerProjectionFields(fields)
    return true
  }

  const hasPromptTemplate = Object.prototype.hasOwnProperty.call(fields, 'promptTemplate')
  const promptTemplate = (fields as Record<string, unknown>).promptTemplate
  if (hasPromptTemplate && promptTemplate !== null && !Array.isArray(promptTemplate)) return false

  return withServerProjectionApply(() => {
    const presets = DBState.db?.promptPresets
    if (!Array.isArray(presets)) return false
    const preset = presets.find((candidate): candidate is PromptPreset => candidate?.id === ownerId)
    if (!preset) return false

    if (hasPromptTemplate) {
      if (promptTemplate === null) {
        delete preset.promptTemplate
      } else {
        preset.promptTemplate = promptTemplate as PromptPreset['promptTemplate']
      }
    }

    if (ownerId === currentPromptTemplateOwnerId() && hasPromptTemplate) {
      if (promptTemplate === null) {
        delete (DBState.db as unknown as Record<string, unknown>).promptTemplate
      } else {
        DBState.db.promptTemplate = promptTemplate as Database['promptTemplate']
      }
    }
    return true
  })
}

function localPromptTemplateOwnerIsResolved(promptPresetId: string | null): boolean {
  if (promptPresetId === null) return Object.prototype.hasOwnProperty.call(DBState.db ?? {}, 'promptTemplate')
  const presets = DBState.db?.promptPresets
  if (!Array.isArray(presets)) return false
  const preset = presets.find((candidate) => candidate?.id === promptPresetId)
  return !!preset && Object.prototype.hasOwnProperty.call(preset, 'promptTemplate')
}

function promptTemplateHydrationWarning(message: string): void {
  console.warn(`promptTemplate hydration failed: ${message}`)
}
