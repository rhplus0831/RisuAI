import { get, writable } from 'svelte/store'
import { getDatabase, mergeServerResourceFields, type Database, type PromptPreset } from '../storage/database.svelte'
import { peekCachedServerCommandRevision } from './commands'
import { fetchServerPromptPresetTemplate } from './hydrationReads'
import { withServerResourceApply } from './resourceWriteGuard.svelte'

export const promptTemplateHydratedStore = writable(false)

let promptTemplateHydrationInFlight = new Map<string, Promise<boolean>>()
let promptTemplateHydrationGeneration = 0
let promptTemplateHydratedOwnerIds = new Set<string | null>()

export function currentPromptTemplateOwnerId(): string | null {
  const selectedIndex = getDatabase().promptPresetsId
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0) return null
  const preset = getDatabase().promptPresets?.[selectedIndex]
  return typeof preset?.id === 'string' && preset.id.trim() !== '' ? preset.id : null
}

export function isPromptTemplateHydrated(promptPresetId: string | null = currentPromptTemplateOwnerId()): boolean {
  if (get(promptTemplateHydratedStore) && promptTemplateHydratedOwnerIds.has(promptPresetId)) return true
  return promptPresetId === null && Object.prototype.hasOwnProperty.call(getDatabase(), 'promptTemplate')
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
  const ownerId = options.promptPresetId === undefined ? currentPromptTemplateOwnerId() : options.promptPresetId
  if (!options.force && isPromptTemplateHydrated(ownerId)) return true
  // The top-level compatibility template belongs to the collection resources
  // and is already part of the initial collection read. Only preset-owned templates
  // need a separate lazy body request.
  if (ownerId === null) return localPromptTemplateOwnerIsResolved(null)
  const ownerKey = ownerId ?? '__legacy__'
  const inFlight = promptTemplateHydrationInFlight.get(ownerKey)
  if (inFlight) return inFlight

  const generation = promptTemplateHydrationGeneration
  const baselineRevision = peekCachedServerCommandRevision()
  if (baselineRevision === null && !options.force) return localPromptTemplateOwnerIsResolved(ownerId)
  const applyProjection = options.applyProjection ?? true
  const includeCompatibilityProjection =
    ownerId === null || (applyProjection && ownerId === currentPromptTemplateOwnerId())
  const ownerSnapshot = promptTemplateOwnerSnapshot(ownerId, includeCompatibilityProjection)
  const request = (async () => {
    const result = await fetchServerPromptPresetTemplate(ownerId)
    if (generation !== promptTemplateHydrationGeneration) return false
    const ownerIsCurrent = ownerId === currentPromptTemplateOwnerId()
    if (applyProjection && !ownerIsCurrent) return false
    if (result.status !== 'ok') {
      promptTemplateHydrationWarning(result.status === 'error' ? result.error : 'server resource read unavailable')
      return false
    }
    if (isOlderThanRevision(result.revision, baselineRevision)) {
      return false
    }
    if (promptTemplateOwnerSnapshot(ownerId, includeCompatibilityProjection) !== ownerSnapshot) {
      return false
    }

    const fields = { promptTemplate: result.promptTemplate } as Partial<Database>
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

function promptTemplateOwnerSnapshot(ownerId: string | null, includeCompatibilityProjection: boolean): string {
  const preset =
    ownerId === null || !Array.isArray(getDatabase().promptPresets)
      ? undefined
      : getDatabase().promptPresets.find((candidate) => candidate?.id === ownerId)
  return snapshotJson({
    ownerId,
    ownerExists: ownerId === null || preset !== undefined,
    owner: preset,
    ...(includeCompatibilityProjection
      ? {
          compatibilityPresent: Object.prototype.hasOwnProperty.call(getDatabase(), 'promptTemplate'),
          compatibility: getDatabase().promptTemplate,
        }
      : {}),
  })
}

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

/**
 * Apply a prompt-template resource to its explicit preset owner. A background
 * preset event must update that preset row without replacing the selected
 * preset's top-level compatibility mirror.
 */
export function applyPromptTemplateProjectionFields(
  fields: Partial<Database>,
  ownerId: string | null = currentPromptTemplateOwnerId(),
): boolean {
  if (ownerId === null) {
    mergeServerResourceFields(fields)
    return true
  }

  const hasPromptTemplate = Object.prototype.hasOwnProperty.call(fields, 'promptTemplate')
  const promptTemplate = (fields as Record<string, unknown>).promptTemplate
  if (hasPromptTemplate && promptTemplate !== null && !Array.isArray(promptTemplate)) return false

  return withServerResourceApply(() => {
    const database = getDatabase()
    const presets = database.promptPresets
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
        delete (database as unknown as Record<string, unknown>).promptTemplate
      } else {
        database.promptTemplate = promptTemplate as Database['promptTemplate']
      }
    }
    return true
  })
}

function localPromptTemplateOwnerIsResolved(promptPresetId: string | null): boolean {
  if (promptPresetId === null) return Object.prototype.hasOwnProperty.call(getDatabase(), 'promptTemplate')
  const presets = getDatabase().promptPresets
  if (!Array.isArray(presets)) return false
  const preset = presets.find((candidate) => candidate?.id === promptPresetId)
  return !!preset && Object.prototype.hasOwnProperty.call(preset, 'promptTemplate')
}

function promptTemplateHydrationWarning(message: string): void {
  console.warn(`promptTemplate hydration failed: ${message}`)
}
