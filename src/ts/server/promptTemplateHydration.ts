import { get, writable } from 'svelte/store'
import { getDatabase, mergeServerResourceFields, type Database, type PromptPreset } from '../storage/database.svelte'
import { normalizePromptTemplate } from '../process/promptTemplateNormalization'
import { peekCachedServerCommandRevision } from './commands'
import { fetchServerPromptPresetTemplate } from './hydrationReads'
import { withServerResourceApply } from './resourceWriteGuard.svelte'

export interface PromptTemplateHydrationState {
  hydratedOwnerIds: ReadonlySet<string | null>
  version: number
}

let promptTemplateHydrationState: PromptTemplateHydrationState = {
  hydratedOwnerIds: new Set(),
  version: 0,
}

export const promptTemplateHydrationStateStore = writable(promptTemplateHydrationState)

let promptTemplateHydrationInFlight = new Map<string, Promise<boolean>>()
let promptTemplateHydrationGeneration = 0
let promptTemplateSelectedFallbackOwnerIds = new Set<string>()
let promptTemplateSelectedFallbacks = new Map<string, Database['promptTemplate']>()
let nextPromptTemplateOwnerProjectionEpoch = 0
let promptTemplateOwnerProjectionBaseline = 0
let promptTemplateOwnerProjectionEpochs = new Map<string | null, number>()
let promptTemplateOwnerRevisions = new Map<string | null, number>()
let promptTemplateOwnerAcknowledgementTaints = new Set<string | null>()

export function currentPromptTemplateOwnerId(): string | null {
  const selectedIndex = getDatabase().promptPresetsId
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0) return null
  const preset = getDatabase().promptPresets?.[selectedIndex]
  return typeof preset?.id === 'string' && preset.id.trim() !== '' ? preset.id : null
}

export function isPromptTemplateHydrated(promptPresetId: string | null = currentPromptTemplateOwnerId()): boolean {
  return isPromptTemplateHydratedInState(get(promptTemplateHydrationStateStore), promptPresetId)
}

export function isPromptTemplateHydratedInState(
  state: PromptTemplateHydrationState,
  promptPresetId: string | null = currentPromptTemplateOwnerId(),
): boolean {
  if (state.hydratedOwnerIds.has(promptPresetId)) return true
  return promptPresetId === null && Object.prototype.hasOwnProperty.call(getDatabase(), 'promptTemplate')
}

export function promptTemplateOwnerUsesSelectedFallback(
  promptPresetId: string | null = currentPromptTemplateOwnerId(),
): boolean {
  return promptPresetId !== null && promptTemplateSelectedFallbackOwnerIds.has(promptPresetId)
}

export function clonePromptTemplateSelectedFallback(
  promptPresetId: string | null = currentPromptTemplateOwnerId(),
): Database['promptTemplate'] | undefined {
  if (promptPresetId === null || !promptTemplateSelectedFallbackOwnerIds.has(promptPresetId)) return undefined
  const fallback = promptTemplateSelectedFallbacks.get(promptPresetId)
  return Array.isArray(fallback) ? JSON.parse(JSON.stringify(fallback)) : undefined
}

export function capturePromptTemplateOwnerProjectionEpoch(
  promptPresetId: string | null = currentPromptTemplateOwnerId(),
): number {
  return promptTemplateOwnerProjectionEpochs.get(promptPresetId) ?? promptTemplateOwnerProjectionBaseline
}

export function hasPromptTemplateOwnerProjectionEpochChanged(promptPresetId: string | null, epoch: number): boolean {
  return capturePromptTemplateOwnerProjectionEpoch(promptPresetId) !== epoch
}

export function peekPromptTemplateOwnerRevision(
  promptPresetId: string | null = currentPromptTemplateOwnerId(),
): number | null {
  return promptTemplateOwnerRevisions.get(promptPresetId) ?? null
}

export function isPromptTemplateOwnerAcknowledgementTainted(promptPresetId: string | null): boolean {
  return promptTemplateOwnerAcknowledgementTaints.has(promptPresetId)
}

export function markPromptTemplateOwnerAcknowledgementTainted(promptPresetId: string | null): void {
  promptTemplateOwnerAcknowledgementTaints.add(promptPresetId)
}

export function resetPromptTemplateHydration(): void {
  promptTemplateHydrationGeneration += 1
  promptTemplateHydrationInFlight = new Map()
  promptTemplateSelectedFallbackOwnerIds = new Set()
  promptTemplateSelectedFallbacks = new Map()
  promptTemplateOwnerProjectionBaseline = ++nextPromptTemplateOwnerProjectionEpoch
  promptTemplateOwnerProjectionEpochs = new Map()
  promptTemplateOwnerRevisions = new Map()
  promptTemplateOwnerAcknowledgementTaints = new Set()
  publishPromptTemplateHydratedOwnerIds(new Set())
}

export function invalidatePromptTemplateHydration(
  promptPresetId: string | null = currentPromptTemplateOwnerId(),
): void {
  if (promptPresetId !== null) {
    promptTemplateSelectedFallbackOwnerIds.delete(promptPresetId)
    promptTemplateSelectedFallbacks.delete(promptPresetId)
  }
  if (promptPresetId !== null) promptTemplateHydrationInFlight.delete(promptPresetId)
  promptTemplateOwnerProjectionEpochs.set(promptPresetId, ++nextPromptTemplateOwnerProjectionEpoch)
  setPromptTemplateOwnerHydrated(promptPresetId, false)
}

export function markPromptTemplateProjectionApplied(
  promptPresetId: string | null = currentPromptTemplateOwnerId(),
  revision?: number,
  options: { advanceProjectionEpoch?: boolean } = {},
): void {
  if (options.advanceProjectionEpoch ?? true) {
    promptTemplateOwnerProjectionEpochs.set(promptPresetId, ++nextPromptTemplateOwnerProjectionEpoch)
    promptTemplateOwnerAcknowledgementTaints.delete(promptPresetId)
  }
  if (Number.isInteger(revision) && (revision as number) >= 0) {
    promptTemplateOwnerRevisions.set(
      promptPresetId,
      Math.max(promptTemplateOwnerRevisions.get(promptPresetId) ?? -1, revision as number),
    )
  }
  setPromptTemplateOwnerHydrated(promptPresetId, true)
}

export function startPromptTemplateHydration(): void {
  void ensurePromptTemplateHydrated()
}

export async function ensurePromptTemplateHydrated(
  options: {
    applyProjection?: boolean
    force?: boolean
    minimumRevision?: number
    promptPresetId?: string | null
  } = {},
): Promise<boolean> {
  const ownerId = options.promptPresetId === undefined ? currentPromptTemplateOwnerId() : options.promptPresetId
  const minimumRevision = normalizedMinimumRevision(options.minimumRevision)
  const ownerRevision = peekPromptTemplateOwnerRevision(ownerId)
  if (
    !options.force &&
    promptTemplateHydrationState.hydratedOwnerIds.has(ownerId) &&
    (minimumRevision === null || (ownerRevision !== null && ownerRevision >= minimumRevision))
  ) {
    if (ownerId !== null && (options.applyProjection ?? true)) {
      return applyHydratedOwnerCompatibilityProjection(ownerId)
    }
    return true
  }
  // The top-level compatibility template belongs to the collection resources
  // and is already part of the initial collection read. Only preset-owned templates
  // need a separate lazy body request.
  if (ownerId === null) {
    const resolved = localPromptTemplateOwnerIsResolved(null)
    if (resolved) markPromptTemplateProjectionApplied(null, minimumRevision ?? undefined)
    return resolved
  }
  const ownerKey = ownerId
  const inFlight = promptTemplateHydrationInFlight.get(ownerKey)
  if (inFlight) {
    const applied = await inFlight
    const appliedRevision = peekPromptTemplateOwnerRevision(ownerId)
    if (applied && (minimumRevision === null || (appliedRevision !== null && appliedRevision >= minimumRevision))) {
      if ((options.applyProjection ?? true) && !applyHydratedOwnerCompatibilityProjection(ownerId)) {
        return false
      }
      return true
    }
    if (minimumRevision !== null && (appliedRevision === null || appliedRevision < minimumRevision)) {
      return ensurePromptTemplateHydrated({ ...options, force: true })
    }
    return false
  }

  const generation = promptTemplateHydrationGeneration
  const ownerEpoch = capturePromptTemplateOwnerProjectionEpoch(ownerId)
  const baselineRevision = maximumRevision(peekCachedServerCommandRevision(), ownerRevision, minimumRevision)
  if (baselineRevision === null && !options.force) {
    const resolved = localPromptTemplateOwnerIsResolved(ownerId)
    if (resolved) markPromptTemplateProjectionApplied(ownerId)
    return resolved
  }
  const applyProjection = options.applyProjection ?? true
  const includeCompatibilityProjection =
    ownerId === null || (applyProjection && ownerId === currentPromptTemplateOwnerId())
  const ownerSnapshot = promptTemplateOwnerSnapshot(ownerId, includeCompatibilityProjection)
  const request = (async () => {
    const result = await fetchServerPromptPresetTemplate(ownerId)
    if (generation !== promptTemplateHydrationGeneration) return false
    if (hasPromptTemplateOwnerProjectionEpochChanged(ownerId, ownerEpoch)) return false
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
    const selectedFallbackPromptTemplate = result.selectedFallbackPromptTemplate as
      | Database['promptTemplate']
      | undefined
    if (
      !applyPromptTemplateProjectionFields(fields, ownerId, {
        applyCompatibilityProjection: applyProjection && ownerIsCurrent,
        ...(selectedFallbackPromptTemplate !== undefined ? { selectedFallbackPromptTemplate } : {}),
      })
    ) {
      return false
    }
    if (selectedFallbackPromptTemplate === undefined) {
      promptTemplateSelectedFallbackOwnerIds.delete(ownerId)
      promptTemplateSelectedFallbacks.delete(ownerId)
    } else {
      promptTemplateSelectedFallbackOwnerIds.add(ownerId)
      promptTemplateSelectedFallbacks.set(ownerId, JSON.parse(JSON.stringify(selectedFallbackPromptTemplate)))
    }
    markPromptTemplateProjectionApplied(ownerId, result.revision)
    return true
  })().finally(() => {
    if (promptTemplateHydrationInFlight.get(ownerKey) === request) {
      promptTemplateHydrationInFlight.delete(ownerKey)
    }
  })

  promptTemplateHydrationInFlight.set(ownerKey, request)
  return request
}

function applyHydratedOwnerCompatibilityProjection(ownerId: string): boolean {
  if (ownerId !== currentPromptTemplateOwnerId() || !promptTemplateHydrationState.hydratedOwnerIds.has(ownerId)) {
    return false
  }
  const preset = uniquePromptPresetOwner(ownerId)
  if (!preset) return false
  const hasPromptTemplate = Object.prototype.hasOwnProperty.call(preset, 'promptTemplate')
  if (hasPromptTemplate && !Array.isArray(preset.promptTemplate)) return false
  const usesSelectedFallback = !hasPromptTemplate && promptTemplateSelectedFallbackOwnerIds.has(ownerId)
  const selectedFallbackPromptTemplate = usesSelectedFallback ? promptTemplateSelectedFallbacks.get(ownerId) : undefined
  if (usesSelectedFallback && !Array.isArray(selectedFallbackPromptTemplate)) {
    promptTemplateSelectedFallbackOwnerIds.delete(ownerId)
    promptTemplateSelectedFallbacks.delete(ownerId)
    setPromptTemplateOwnerHydrated(ownerId, false)
    return false
  }
  const fields = {
    promptTemplate: hasPromptTemplate ? JSON.parse(JSON.stringify(preset.promptTemplate)) : null,
  } as Partial<Database>
  const applied = applyPromptTemplateProjectionFields(fields, ownerId, {
    applyCompatibilityProjection: true,
    ...(usesSelectedFallback
      ? { selectedFallbackPromptTemplate: JSON.parse(JSON.stringify(selectedFallbackPromptTemplate)) }
      : {}),
  })
  return applied
}

function setPromptTemplateOwnerHydrated(promptPresetId: string | null, hydrated: boolean): void {
  if (promptTemplateHydrationState.hydratedOwnerIds.has(promptPresetId) === hydrated) return
  const hydratedOwnerIds = new Set(promptTemplateHydrationState.hydratedOwnerIds)
  if (hydrated) hydratedOwnerIds.add(promptPresetId)
  else hydratedOwnerIds.delete(promptPresetId)
  publishPromptTemplateHydratedOwnerIds(hydratedOwnerIds)
}

function publishPromptTemplateHydratedOwnerIds(hydratedOwnerIds: ReadonlySet<string | null>): void {
  promptTemplateHydrationState = {
    hydratedOwnerIds: new Set(hydratedOwnerIds),
    version: promptTemplateHydrationState.version + 1,
  }
  promptTemplateHydrationStateStore.set(promptTemplateHydrationState)
}

function isOlderThanRevision(revision: number, comparisonRevision: number | null): boolean {
  return comparisonRevision !== null && revision < comparisonRevision
}

function normalizedMinimumRevision(value: number | undefined): number | null {
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null
}

function maximumRevision(...values: Array<number | null>): number | null {
  const revisions = values.filter((value): value is number => value !== null)
  return revisions.length > 0 ? Math.max(...revisions) : null
}

function promptTemplateOwnerSnapshot(ownerId: string | null, includeCompatibilityProjection: boolean): string {
  const ownerMatches =
    ownerId === null || !Array.isArray(getDatabase().promptPresets)
      ? []
      : getDatabase().promptPresets.filter((candidate) => candidate?.id === ownerId)
  return snapshotJson({
    ownerId,
    ownerExists: ownerId === null || ownerMatches.length === 1,
    owner: ownerMatches.length === 1 ? ownerMatches[0] : ownerMatches,
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
  options: {
    applyCompatibilityProjection?: boolean
    selectedFallbackPromptTemplate?: Database['promptTemplate']
  } = {},
): boolean {
  if (ownerId === null) {
    mergeServerResourceFields(fields)
    return true
  }

  const hasPromptTemplate = Object.prototype.hasOwnProperty.call(fields, 'promptTemplate')
  const promptTemplate = (fields as Record<string, unknown>).promptTemplate
  if (hasPromptTemplate && promptTemplate !== null && !Array.isArray(promptTemplate)) return false
  const normalizedPromptTemplate = hasPromptTemplate ? normalizePromptTemplate(promptTemplate) : null
  const normalizedSelectedFallback =
    options.selectedFallbackPromptTemplate === undefined
      ? undefined
      : normalizePromptTemplate(options.selectedFallbackPromptTemplate)

  return withServerResourceApply(() => {
    const database = getDatabase()
    const presets = database.promptPresets
    if (!Array.isArray(presets)) return false
    const matches = presets.filter((candidate): candidate is PromptPreset => candidate?.id === ownerId)
    if (matches.length !== 1) return false
    const preset = matches[0]

    if (hasPromptTemplate) {
      if (promptTemplate === null) {
        delete preset.promptTemplate
      } else {
        preset.promptTemplate = normalizedPromptTemplate as PromptPreset['promptTemplate']
      }
    }

    if (
      (options.applyCompatibilityProjection ?? true) &&
      ownerId === currentPromptTemplateOwnerId() &&
      hasPromptTemplate
    ) {
      if (normalizedSelectedFallback !== undefined) {
        database.promptTemplate = normalizedSelectedFallback as Database['promptTemplate']
      } else if (promptTemplate === null) {
        delete (database as unknown as Record<string, unknown>).promptTemplate
      } else {
        database.promptTemplate = normalizedPromptTemplate as Database['promptTemplate']
      }
    }
    return true
  })
}

function localPromptTemplateOwnerIsResolved(promptPresetId: string | null): boolean {
  if (promptPresetId === null) return Object.prototype.hasOwnProperty.call(getDatabase(), 'promptTemplate')
  const preset = uniquePromptPresetOwner(promptPresetId)
  return !!preset && Object.prototype.hasOwnProperty.call(preset, 'promptTemplate')
}

function uniquePromptPresetOwner(promptPresetId: string): PromptPreset | undefined {
  const presets = getDatabase().promptPresets
  if (!Array.isArray(presets)) return undefined
  const matches = presets.filter((candidate): candidate is PromptPreset => candidate?.id === promptPresetId)
  return matches.length === 1 ? matches[0] : undefined
}

function promptTemplateHydrationWarning(message: string): void {
  console.warn(`promptTemplate hydration failed: ${message}`)
}
