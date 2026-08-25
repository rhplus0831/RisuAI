import { get, writable } from 'svelte/store'
import type { AppRoute } from '../routerRoute'
import { routeKey } from '../routerRoute'
import { hydrateActiveChat } from './chatMessageHydration.svelte'
import { peekAppliedServerResourceRevision } from './commands'
import { getServerInlayCatalogResource } from './inlayCatalog'
import { SERVER_CHARACTER_SHELL_MARKER } from './characterSummaryProtocol'
import {
  RESOURCE_SURFACE_MANIFEST,
  resolveResourceRequirements,
  resourceRequirementIdentity,
  resourceSurfacesForRoute,
  type ResourceRequirement,
  type ResourceSurfaceId,
} from './resourceManifest'
import { refreshServerResourceTargets, type ServerResourceRefreshResult } from './resourceInvalidation'
import { fetchServerStandaloneSetting } from './resourceReads'
import {
  applyStandaloneSettingResource,
  beginCollectionsResourceLoad,
  beginSettingsGroupResourceLoad,
  beginStandaloneSettingResourceLoad,
  charactersResourceState,
  collectionsResourceState,
  failCollectionsResourceLoad,
  failSettingsGroupResourceLoad,
  failStandaloneSettingResourceLoad,
  getResourceDatabase,
  settingsResourceState,
} from './resourceState.svelte'
import { currentPromptTemplateOwnerId, ensurePromptTemplateHydrated } from './promptTemplateHydration'
import { withServerResourceApply } from './resourceWriteGuard.svelte'

export type RouteResourceLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface RouteResourceLoadState {
  error: string | null
  routeKey: string | null
  status: RouteResourceLoadStatus
}

interface ActiveRouteLoad {
  controller: AbortController
  key: string
}

interface RequirementLoadResult {
  error?: string
  identity: string
  ok: boolean
}

interface InFlightRequirementLoad {
  minimumRevision: number | undefined
  promise: Promise<RequirementLoadResult>
  signal: AbortSignal | null
}

interface PendingCharacterPrefetch {
  characterId: string
  controller: AbortController
  idleHandle: number | null
}

const initialState: RouteResourceLoadState = { error: null, routeKey: null, status: 'idle' }

export const routeResourceLoadState = writable<RouteResourceLoadState>(initialState)

let activeRouteLoad: ActiveRouteLoad | null = null
let pendingCharacterPrefetch: PendingCharacterPrefetch | null = null
const deferredSurfaceRequests = new Map<string, Promise<void>>()
const requirementRequests = new Map<string, InFlightRequirementLoad>()

/** Load the non-shell resources needed before route stores can be applied safely. */
export async function prepareRouteResources(route: AppRoute): Promise<boolean> {
  cancelCharacterPrefetch()
  const key = routeKey(route)
  activeRouteLoad?.controller.abort()
  const controller = new AbortController()
  const load: ActiveRouteLoad = { controller, key }
  activeRouteLoad = load
  routeResourceLoadState.set({ error: null, routeKey: key, status: 'loading' })

  const surfaces = resourceSurfacesForRoute(route).filter((surface) => surface !== 'shared:app-shell')
  const requirements = resolveResourceRequirements(surfaces).filter(
    (requirement) => !isPostRouteRequirement(requirement),
  )
  const minimumRevision = peekAppliedServerResourceRevision() ?? undefined
  const results = await Promise.all(
    requirements.map((requirement) => safeLoadRequirement(requirement, route, controller.signal, minimumRevision)),
  )

  if (!isCurrentRouteLoad(load)) return false
  const failure = results.find((result) => !result.ok)
  if (failure) {
    routeResourceLoadState.set({
      error: failure.error ?? `Failed to load ${failure.identity}`,
      routeKey: key,
      status: 'error',
    })
    return false
  }
  return true
}

/** Finish projections whose target is only knowable after route selection is applied. */
export async function finishRouteResources(route: AppRoute): Promise<boolean> {
  const load = activeRouteLoad
  if (!load || load.key !== routeKey(route) || load.controller.signal.aborted) return false

  try {
    if (route.kind === 'character' && route.chatId) {
      if (!(await hydrateActiveChat())) throw new Error('Selected chat hydration failed')
      if (!isCurrentRouteLoad(load)) return false

      const ownerId = activePromptTemplateOwnerId(route.chatId)
      const hydrated = await ensurePromptTemplateHydrated({
        ...(ownerId !== currentPromptTemplateOwnerId() ? { applyProjection: false } : {}),
        minimumRevision: peekAppliedServerResourceRevision() ?? undefined,
        promptPresetId: ownerId,
      })
      if (!hydrated) throw new Error('Selected prompt-template hydration failed')
    }
  } catch (error) {
    if (!isCurrentRouteLoad(load)) return false
    routeResourceLoadState.set({
      error: error instanceof Error ? error.message : String(error),
      routeKey: load.key,
      status: 'error',
    })
    return false
  }

  if (!isCurrentRouteLoad(load)) return false
  routeResourceLoadState.set({ error: null, routeKey: load.key, status: 'ready' })
  return true
}

/** Load a deferred runtime/overlay surface once, sharing concurrent callers. */
export function ensureResourceSurfaces(surfaceIds: readonly ResourceSurfaceId[]): Promise<void> {
  const ids = [...new Set(surfaceIds)].sort()
  const requestKey = ids.join('\u0000')
  const existing = deferredSurfaceRequests.get(requestKey)
  if (existing) return existing

  const request = (async () => {
    const requirements = resolveResourceRequirements(ids).filter((requirement) => !isPostRouteRequirement(requirement))
    const minimumRevision = peekAppliedServerResourceRevision() ?? undefined
    const results = await Promise.all(
      requirements.map((requirement) => safeLoadRequirement(requirement, null, null, minimumRevision)),
    )
    const failure = results.find((result) => !result.ok)
    if (failure) throw new Error(failure.error ?? `Failed to load ${failure.identity}`)
  })().finally(() => {
    if (deferredSurfaceRequests.get(requestKey) === request) deferredSurfaceRequests.delete(requestKey)
  })
  deferredSurfaceRequests.set(requestKey, request)
  return request
}

export function stopRouteResourceLoader(): void {
  activeRouteLoad?.controller.abort()
  activeRouteLoad = null
  cancelCharacterPrefetch()
  routeResourceLoadState.set(initialState)
}

/** Prefetch only the hovered grid row, and only while the browser is idle. */
export function prefetchCharacterRouteResource(characterId: string): void {
  if (
    typeof window === 'undefined' ||
    typeof window.requestIdleCallback !== 'function' ||
    !characterId.trim() ||
    get(routeResourceLoadState).status !== 'ready'
  ) {
    return
  }
  const resident = charactersResourceState.characters.find((candidate) => candidate?.chaId === characterId)
  if (!resident || (resident as unknown as Record<string, unknown>)[SERVER_CHARACTER_SHELL_MARKER] !== true) return
  if (pendingCharacterPrefetch?.characterId === characterId) return

  cancelCharacterPrefetch()
  const controller = new AbortController()
  const prefetch: PendingCharacterPrefetch = { characterId, controller, idleHandle: null }
  pendingCharacterPrefetch = prefetch
  prefetch.idleHandle = window.requestIdleCallback(
    () => {
      prefetch.idleHandle = null
      if (pendingCharacterPrefetch !== prefetch || controller.signal.aborted) return
      void refreshServerResourceTargets(
        {
          characterIds: [characterId],
          minimumRevision: peekAppliedServerResourceRevision() ?? undefined,
        },
        { signal: controller.signal },
      ).finally(() => {
        if (pendingCharacterPrefetch === prefetch) pendingCharacterPrefetch = null
      })
    },
    { timeout: 750 },
  )
}

function cancelCharacterPrefetch(): void {
  const prefetch = pendingCharacterPrefetch
  if (!prefetch) return
  pendingCharacterPrefetch = null
  prefetch.controller.abort()
  if (prefetch.idleHandle !== null && typeof window !== 'undefined') {
    window.cancelIdleCallback(prefetch.idleHandle)
  }
}

function isCurrentRouteLoad(load: ActiveRouteLoad): boolean {
  return activeRouteLoad === load && !load.controller.signal.aborted
}

function isPostRouteRequirement(requirement: ResourceRequirement): boolean {
  return (
    requirement.kind === 'projection' && ['selected-chat', 'selected-prompt-template'].includes(requirement.projection)
  )
}

async function loadRequirement(
  requirement: ResourceRequirement,
  route: AppRoute | null,
  signal: AbortSignal | null,
  minimumRevision: number | undefined,
): Promise<RequirementLoadResult> {
  const identity = resourceRequirementIdentity(requirement)
  const requestKey = requirementRequestKey(requirement, route)
  const existing = requirementRequests.get(requestKey)
  if (
    existing &&
    !existing.signal?.aborted &&
    (minimumRevision === undefined ||
      (existing.minimumRevision !== undefined && existing.minimumRevision >= minimumRevision))
  ) {
    const result = await existing.promise
    if (signal?.aborted) return { identity, ok: false, error: 'Route resource load was cancelled' }
    if (signal === null && existing.signal?.aborted) {
      return loadRequirement(requirement, route, signal, minimumRevision)
    }
    return result
  }

  const request = {} as InFlightRequirementLoad
  request.minimumRevision = minimumRevision
  request.signal = signal
  request.promise = loadRequirementOnce(requirement, route, signal, minimumRevision).finally(() => {
    if (requirementRequests.get(requestKey) === request) requirementRequests.delete(requestKey)
  })
  requirementRequests.set(requestKey, request)
  return request.promise
}

async function safeLoadRequirement(
  requirement: ResourceRequirement,
  route: AppRoute | null,
  signal: AbortSignal | null,
  minimumRevision: number | undefined,
): Promise<RequirementLoadResult> {
  try {
    return await loadRequirement(requirement, route, signal, minimumRevision)
  } catch (error) {
    return {
      identity: resourceRequirementIdentity(requirement),
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function loadRequirementOnce(
  requirement: ResourceRequirement,
  route: AppRoute | null,
  signal: AbortSignal | null,
  minimumRevision: number | undefined,
): Promise<RequirementLoadResult> {
  const identity = resourceRequirementIdentity(requirement)
  if (signal?.aborted) return { identity, ok: false, error: 'Route resource load was cancelled' }
  if (requirementIsReady(requirement, route)) return { identity, ok: true }

  switch (requirement.kind) {
    case 'settings-group': {
      beginSettingsGroupResourceLoad(requirement.group)
      const result = await refreshServerResourceTargets(
        { settingsGroups: [requirement.group], minimumRevision },
        { signal },
      )
      return completeSettingsGroupLoad(requirement.group, identity, result, signal)
    }
    case 'collection': {
      beginCollectionsResourceLoad(requirement.collection)
      const result = await refreshServerResourceTargets(
        { collections: [requirement.collection], minimumRevision },
        { signal },
      )
      return completeCollectionLoad(requirement.collection, identity, result, signal)
    }
    case 'standalone-setting':
      return loadStandaloneSetting(requirement.setting, identity, signal, minimumRevision)
    case 'projection':
      return loadProjection(requirement, route, identity, signal, minimumRevision)
  }
}

async function loadProjection(
  requirement: Extract<ResourceRequirement, { kind: 'projection' }>,
  route: AppRoute | null,
  identity: string,
  signal: AbortSignal | null,
  minimumRevision: number | undefined,
): Promise<RequirementLoadResult> {
  switch (requirement.projection) {
    case 'character-summaries':
    case 'character-selection':
      return charactersResourceState.status === 'ready'
        ? { identity, ok: true }
        : { identity, ok: false, error: 'Character shell is unavailable' }
    case 'selected-character': {
      if (route?.kind !== 'character') return { identity, ok: true }
      const result = await refreshServerResourceTargets({ characterIds: [route.chaId], minimumRevision }, { signal })
      return refreshResult(identity, result)
    }
    case 'inlay-catalog': {
      const result = await refreshServerResourceTargets({ inlayCatalog: true, minimumRevision }, { signal })
      return refreshResult(identity, result)
    }
    case 'selected-chat':
    case 'selected-prompt-template':
      return { identity, ok: true }
  }
}

async function loadStandaloneSetting(
  setting: Extract<ResourceRequirement, { kind: 'standalone-setting' }>['setting'],
  identity: string,
  signal: AbortSignal | null,
  minimumRevision: number | undefined,
): Promise<RequirementLoadResult> {
  beginStandaloneSettingResourceLoad(setting)
  const startingRevision = settingsResourceState.revision
  const result = await fetchServerStandaloneSetting(setting, signal)
  if (signal?.aborted) return { identity, ok: false, error: 'Route resource load was cancelled' }
  if (result.status !== 'ok') {
    const error = result.status === 'error' ? result.error : 'Server resource APIs are unavailable'
    failStandaloneSettingResourceLoad(setting, error)
    return { identity, ok: false, error }
  }
  if (minimumRevision !== undefined && result.revision < minimumRevision) {
    const error = `Standalone setting response revision ${result.revision} is older than ${minimumRevision}`
    failStandaloneSettingResourceLoad(setting, error)
    return { identity, ok: false, error }
  }
  if (settingsResourceState.revision !== startingRevision) {
    const existingRevision = settingsResourceState.standaloneRevisions[setting]
    if (existingRevision !== undefined && existingRevision >= result.revision) return { identity, ok: true }
  }
  const applied = withServerResourceApply(() => applyStandaloneSettingResource(result))
  if (!applied) {
    const error = `Standalone setting ${setting} was superseded before apply`
    failStandaloneSettingResourceLoad(setting, error)
    return { identity, ok: false, error }
  }
  return { identity, ok: true }
}

function requirementIsReady(requirement: ResourceRequirement, route: AppRoute | null): boolean {
  switch (requirement.kind) {
    case 'settings-group':
      return settingsResourceState.groupStatuses[requirement.group] === 'ready'
    case 'collection':
      return collectionsResourceState.statuses[requirement.collection] === 'ready'
    case 'standalone-setting':
      return settingsResourceState.standaloneStatuses[requirement.setting] === 'ready'
    case 'projection':
      switch (requirement.projection) {
        case 'character-summaries':
        case 'character-selection':
          return charactersResourceState.status === 'ready'
        case 'selected-character': {
          if (route?.kind !== 'character') return true
          const resident = charactersResourceState.characters.find((candidate) => candidate?.chaId === route.chaId)
          return !!resident && (resident as unknown as Record<string, unknown>)[SERVER_CHARACTER_SHELL_MARKER] !== true
        }
        case 'inlay-catalog':
          return getServerInlayCatalogResource() !== null
        case 'selected-chat':
        case 'selected-prompt-template':
          return false
      }
  }
}

function completeSettingsGroupLoad(
  group: Extract<ResourceRequirement, { kind: 'settings-group' }>['group'],
  identity: string,
  result: ServerResourceRefreshResult,
  signal: AbortSignal | null,
): RequirementLoadResult {
  const completed = refreshResult(identity, result)
  if (!completed.ok && !signal?.aborted) failSettingsGroupResourceLoad(group, completed.error ?? 'Resource read failed')
  return completed
}

function completeCollectionLoad(
  collection: Extract<ResourceRequirement, { kind: 'collection' }>['collection'],
  identity: string,
  result: ServerResourceRefreshResult,
  signal: AbortSignal | null,
): RequirementLoadResult {
  const completed = refreshResult(identity, result)
  if (!completed.ok && !signal?.aborted) {
    failCollectionsResourceLoad(completed.error ?? 'Resource read failed', collection)
  }
  return completed
}

function refreshResult(identity: string, result: ServerResourceRefreshResult): RequirementLoadResult {
  if (result.status === 'ok') return { identity, ok: true }
  return {
    identity,
    ok: false,
    error: result.status === 'error' ? result.error : 'Server resource APIs are unavailable',
  }
}

function activePromptTemplateOwnerId(chatId: string): string | null {
  for (const character of getResourceDatabase().characters ?? []) {
    const chat = character.chats?.find((candidate) => candidate.id === chatId)
    const ownerId = chat?.generationSettings?.promptPresetId
    if (typeof ownerId === 'string' && ownerId.trim() !== '') return ownerId.trim()
  }
  return currentPromptTemplateOwnerId()
}

function requirementRequestKey(requirement: ResourceRequirement, route: AppRoute | null): string {
  const identity = resourceRequirementIdentity(requirement)
  if (requirement.kind === 'projection' && requirement.projection === 'selected-character') {
    return `${identity}:${route?.kind === 'character' ? route.chaId : ''}`
  }
  return identity
}

export function resourceSurfaceIsDeclared(surfaceId: string): surfaceId is ResourceSurfaceId {
  return Object.prototype.hasOwnProperty.call(RESOURCE_SURFACE_MANIFEST, surfaceId)
}

export function currentRouteResourceLoadState(): RouteResourceLoadState {
  return get(routeResourceLoadState)
}
