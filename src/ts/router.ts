import { tick } from 'svelte'
import { get, writable } from 'svelte/store'
import { changeChar } from './characters'
import { changeChatTo } from './globalApi.svelte'
import { openPlaygroundChat, PLAYGROUND_CHARACTER_ID } from './playground'
import { changeUserPersonaWithOutcome } from './persona'
import { findCharacterIndexbyId } from './characterState'
import { getResourceDatabase as getDatabase } from './server/resourceState.svelte'
import {
  CharEmotion,
  CustomGUISettingMenuStore,
  OpenRealmStore,
  PlaygroundStore,
  ScrollToMessageStore,
  SettingsMenuIndex,
  botMakerMode,
  selectedCharID,
  settingsOpen,
} from './stores.svelte'

export type AppRoute =
  | { kind: 'home'; path: string }
  | { kind: 'settings'; path: string; section: string; index: number; personaId?: string }
  | { kind: 'playground'; path: string; tool: string; index: number }
  | { kind: 'inlay'; path: string }
  | { kind: 'grid'; path: string }
  | { kind: 'character'; path: string; chaId: string; chatId?: string }
  | { kind: 'not-found'; path: string }

interface StateRouteInput {
  currentRouteKind: AppRoute['kind']
  settingsOpen: boolean
  settingsMenuIndex: number
  selectedCharID: number
  playgroundStore: number
  personaId?: string
  characterId?: string
  chatId?: string
}

const DEFAULT_SETTINGS_INDEX = 17
const DEFAULT_PLAYGROUND_INDEX = 1
const GRID_HISTORY_STATE_KEY = '__risuGridNavigation'
const GRID_HISTORY_STATE_VERSION = 1
const SETTINGS_HISTORY_STATE_KEY = '__risuSettingsNavigation'
const SETTINGS_HISTORY_STATE_VERSION = 1
const CHARACTER_SIDEBAR_VIEW_STATE_KEY = '__risuCharacterSidebarView'
const CHARACTER_SIDEBAR_VIEW_STATE_VERSION = 1

interface GridHistoryState {
  [GRID_HISTORY_STATE_KEY]: {
    originPath: string
    version: typeof GRID_HISTORY_STATE_VERSION
  }
}

interface SettingsHistoryState {
  [SETTINGS_HISTORY_STATE_KEY]: {
    originPath: string
    version: typeof SETTINGS_HISTORY_STATE_VERSION
  }
}

interface CharacterSidebarViewState {
  [CHARACTER_SIDEBAR_VIEW_STATE_KEY]: {
    characterId: string
    routeKey: string
    version: typeof CHARACTER_SIDEBAR_VIEW_STATE_VERSION
  }
}

const settingIndexBySlug = new Map<string, number>([
  ['backup', 0],
  ['backup-restore', 0],
  ['request-history', 21],
  ['requesthistory', 21],
  ['user', 0],
  ['chat-bot', 1],
  ['chatbot', 1],
  ['bot', 1],
  ['bot-preset', 1],
  ['botpreset', 1],
  ['preset', 1],
  ['presets', 1],
  ['model', 17],
  ['model-settings', 17],
  ['models', 17],
  ['other-bots', 2],
  ['otherbots', 2],
  ['display', 3],
  ['plugin', 4],
  ['plugins', 4],
  ['advanced', 6],
  ['advanced-settings', 6],
  ['community', 7],
  ['communities', 7],
  ['global-lorebook', 8],
  ['lorebook', 8],
  ['lore', 8],
  ['global-regex', 9],
  ['regex', 9],
  ['language', 10],
  ['accessibility', 11],
  ['persona', 12],
  ['prompt', 13],
  ['prompt-template', 13],
  ['agent-preset', 19],
  ['agent-presets', 19],
  ['input-hooks', 20],
  ['prompt-settings', 18],
  ['prompt-preset', 18],
  ['prompt-presets', 18],
  ['prompts', 18],
  ['modules', 14],
  ['module', 14],
  ['hotkey', 15],
  ['hotkeys', 15],
  ['supporter', 77],
  ['thanks', 77],
])

const settingSlugByIndex = new Map<number, string>([
  [0, 'backup'],
  [1, 'bot-preset'],
  [2, 'other-bots'],
  [3, 'display'],
  [4, 'plugins'],
  [6, 'advanced'],
  [7, 'communities'],
  [8, 'global-lorebook'],
  [9, 'global-regex'],
  [10, 'language'],
  [11, 'accessibility'],
  [12, 'persona'],
  [13, 'prompt'],
  [14, 'modules'],
  [15, 'hotkeys'],
  [17, 'model'],
  [18, 'prompt-settings'],
  [19, 'agent-presets'],
  [20, 'input-hooks'],
  [21, 'request-history'],
  [77, 'supporter'],
])

const playgroundIndexBySlug = new Map<string, number>([
  ['menu', 1],
  ['chat', 2],
  ['embedding', 3],
  ['tokenizer', 4],
  ['syntax', 5],
  ['jinja', 6],
  ['image-gen', 7],
  ['image-generation', 7],
  ['parser', 8],
  ['subtitle', 9],
  ['subtitles', 9],
  ['image-trans', 10],
  ['image-translation', 10],
  ['translation', 11],
  ['translator', 11],
  ['mcp', 12],
  ['cbs', 13],
  ['docs', 13],
  ['inlay', 14],
  ['inlays', 14],
  ['tool-conversion', 101],
  ['tools', 101],
])

const playgroundSlugByIndex = new Map<number, string>([
  [1, ''],
  [2, 'chat'],
  [3, 'embedding'],
  [4, 'tokenizer'],
  [5, 'syntax'],
  [6, 'jinja'],
  [7, 'image-gen'],
  [8, 'parser'],
  [9, 'subtitles'],
  [10, 'image-trans'],
  [11, 'translation'],
  [12, 'mcp'],
  [13, 'cbs'],
  [14, 'inlays'],
  [101, 'tools'],
])

let routerInstalled = false
let applyingRoute = false
const initialRoute = parseRoute(typeof window === 'undefined' ? '/' : window.location.pathname)
let routeApplicationPending = initialRoute.kind !== 'home'
let skipNextRouteApplication = false
let routeApplicationEpoch = 0
let gridHistoryTraversalPending = false
let settingsHistoryTraversalPending = false

interface PendingChatMessageJump {
  messageIndex: number
  routeKey: string
}

let pendingChatMessageJump: PendingChatMessageJump | null = null

export const currentRoute = writable<AppRoute>(initialRoute)

export function installRouter(): void {
  if (routerInstalled || typeof window === 'undefined') return
  routerInstalled = true
  window.addEventListener('popstate', () => {
    gridHistoryTraversalPending = false
    settingsHistoryTraversalPending = false
    routeApplicationPending = true
    currentRoute.set(parseRoute(window.location.pathname))
  })
}

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (typeof window === 'undefined') return

  const canonicalPath = path
  const nextRoute = parseRoute(canonicalPath)

  if (nextRoute.kind === 'settings') {
    const currentPath = normalizePath(window.location.pathname)
    const currentRouteKind = parseRoute(currentPath).kind
    if (currentRouteKind === 'settings') {
      commitPath(canonicalPath, {
        replace: true,
        stateDriven: false,
        historyState: window.history.state,
      })
      return
    }

    commitPath(canonicalPath, {
      replace: options.replace ?? false,
      stateDriven: false,
      ...((options.replace ?? false) ? {} : { historyState: settingsHistoryState(currentPath) }),
    })
    return
  }

  commitPath(canonicalPath, {
    replace: options.replace ?? false,
    stateDriven: false,
  })
}

export function navigateToCharacterChatMessage(characterId: string, chatId: string, messageIndex: number): void {
  if (!characterId || !chatId || !Number.isInteger(messageIndex) || messageIndex < 0) return

  const path = characterRoutePath(characterId, chatId)
  const targetRoute = parseRoute(path)
  if (targetRoute.kind !== 'character') return

  const request: PendingChatMessageJump = {
    messageIndex,
    routeKey: routeKey(targetRoute),
  }
  pendingChatMessageJump = request
  navigate(path)

  if (routeKey(get(currentRoute)) !== request.routeKey) {
    if (pendingChatMessageJump === request) pendingChatMessageJump = null
    return
  }

  if (!routeApplicationPending && !applyingRoute) {
    void deliverPendingChatMessageJump(targetRoute, () => routeKey(get(currentRoute)) === request.routeKey)
  }
}

export function openSettingsRoute(path = '/settings'): void {
  if (parseRoute(path).kind !== 'settings') return
  settingsHistoryTraversalPending = false
  navigate(path)
}

export function closeSettingsRoute(): void {
  if (typeof window === 'undefined') return

  const isSettingsRoute = parseRoute(window.location.pathname).kind === 'settings'
  if (isSettingsRoute && settingsOriginPath(window.history.state)) {
    if (settingsHistoryTraversalPending) return
    settingsHistoryTraversalPending = true
    window.history.back()
    return
  }

  settingsHistoryTraversalPending = false
  navigate('/', { replace: true })
}

export function openGridRoute(): void {
  if (typeof window === 'undefined') return

  gridHistoryTraversalPending = false
  const originPath = normalizePath(window.location.pathname)
  if (parseRoute(originPath).kind === 'grid') return

  const historyState: GridHistoryState = {
    [GRID_HISTORY_STATE_KEY]: {
      originPath,
      version: GRID_HISTORY_STATE_VERSION,
    },
  }
  commitPath('/grid', {
    replace: false,
    stateDriven: false,
    historyState,
  })
}

export function closeGridRoute(): void {
  if (typeof window === 'undefined') return

  const isGridRoute = parseRoute(window.location.pathname).kind === 'grid'
  if (isGridRoute && gridOriginPath(window.history.state)) {
    if (gridHistoryTraversalPending) return
    gridHistoryTraversalPending = true
    window.history.back()
    return
  }

  gridHistoryTraversalPending = false
  navigate('/', { replace: true })
}

export function syncRouteFromState(input: StateRouteInput): void {
  if (applyingRoute || typeof window === 'undefined') return
  const path = routePathFromState(input)

  const currentPath = normalizePath(window.location.pathname)
  const currentRouteKind = parseRoute(currentPath).kind
  if (parseRoute(path).kind === 'settings') {
    commitPath(path, {
      replace: currentRouteKind === 'settings',
      stateDriven: true,
      historyState: currentRouteKind === 'settings' ? window.history.state : settingsHistoryState(currentPath),
    })
    return
  }

  commitPath(path, { replace: true, stateDriven: true })
}

export function consumeStateDrivenRouteUpdate(): boolean {
  if (!skipNextRouteApplication) return false
  skipNextRouteApplication = false
  return true
}

export function isApplyingRouteToStores(): boolean {
  return applyingRoute
}

export function hasPendingRouteApplication(): boolean {
  return routeApplicationPending
}

/** Keep the character/chat sidebar choice on this exact history entry. */
export function setCharacterSidebarViewMode(view: 'chat' | 'character'): void {
  const characterView = view === 'character'
  botMakerMode.set(characterView)
  if (typeof window === 'undefined') return

  const previousState = historyStateRecord(window.history.state)
  if (!characterView) {
    if (!Object.prototype.hasOwnProperty.call(previousState, CHARACTER_SIDEBAR_VIEW_STATE_KEY)) return
    delete previousState[CHARACTER_SIDEBAR_VIEW_STATE_KEY]
    replaceCurrentHistoryState(previousState)
    return
  }

  const route = parseRoute(window.location.pathname)
  if (route.kind !== 'character') return
  previousState[CHARACTER_SIDEBAR_VIEW_STATE_KEY] = {
    characterId: route.chaId,
    routeKey: routeKey(route),
    version: CHARACTER_SIDEBAR_VIEW_STATE_VERSION,
  }
  replaceCurrentHistoryState(previousState)
}

export async function applyRouteToStores(route: AppRoute): Promise<void> {
  const applicationEpoch = ++routeApplicationEpoch
  const isFreshRouteApplication = () => applicationEpoch === routeApplicationEpoch
  applyingRoute = true
  try {
    closeRouteBlockingViews()
    switch (route.kind) {
      case 'home': {
        selectedCharID.set(-1)
        settingsOpen.set(false)
        PlaygroundStore.set(0)
        OpenRealmStore.set(false)
        break
      }
      case 'settings': {
        selectedCharID.set(-1)
        settingsOpen.set(true)
        SettingsMenuIndex.set(route.index)
        PlaygroundStore.set(0)
        OpenRealmStore.set(false)
        if (route.index === 12 && route.personaId) {
          await selectRoutedPersona(route.personaId, isFreshRouteApplication)
        }
        break
      }
      case 'grid': {
        selectedCharID.set(-1)
        settingsOpen.set(false)
        PlaygroundStore.set(0)
        OpenRealmStore.set(false)
        break
      }
      case 'inlay': {
        selectedCharID.set(-1)
        settingsOpen.set(false)
        PlaygroundStore.set(14)
        OpenRealmStore.set(false)
        break
      }
      case 'playground': {
        settingsOpen.set(false)
        OpenRealmStore.set(false)
        if (route.index === 2) {
          await openPlaygroundChat({ isFresh: isFreshRouteApplication })
          if (!isFreshRouteApplication()) return
        } else {
          selectedCharID.set(-1)
          PlaygroundStore.set(route.index)
        }
        break
      }
      case 'character': {
        await openCharacterRoute(route.chaId, route.chatId, isFreshRouteApplication)
        restoreCharacterSidebarViewMode(route, isFreshRouteApplication)
        await deliverPendingChatMessageJump(route, isFreshRouteApplication)
        break
      }
      case 'not-found': {
        selectedCharID.set(-1)
        settingsOpen.set(false)
        PlaygroundStore.set(0)
        OpenRealmStore.set(false)
        break
      }
    }
  } finally {
    queueMicrotask(() => {
      if (!isFreshRouteApplication()) return
      if (pendingChatMessageJump && pendingChatMessageJump.routeKey !== routeKey(get(currentRoute))) {
        pendingChatMessageJump = null
      }
      applyingRoute = false
      routeApplicationPending = false
    })
  }
}

async function deliverPendingChatMessageJump(route: AppRoute, isFresh: () => boolean): Promise<void> {
  const request = pendingChatMessageJump
  if (!request || request.routeKey !== routeKey(route)) return

  await tick()
  if (pendingChatMessageJump !== request || !isFresh() || request.routeKey !== routeKey(get(currentRoute))) {
    return
  }

  pendingChatMessageJump = null
  ScrollToMessageStore.value = request.messageIndex
}

export function parseRoute(pathname: string): AppRoute {
  const path = normalizePath(pathname)
  const parts = splitPath(path)

  if (parts.length === 0) {
    return { kind: 'home', path }
  }

  if (parts[0] === 'settings') {
    const section = normalizeSlug(parts[1] ?? '')
    if (!section) {
      return {
        kind: 'settings',
        path,
        section: '',
        index: -1,
      }
    }
    if (section === 'context-agent' || section === 'contextagent') {
      return { kind: 'not-found', path }
    }

    const index = settingIndexBySlug.get(section) ?? numericSettingIndex(section)
    return {
      kind: 'settings',
      path,
      section,
      index: index ?? DEFAULT_SETTINGS_INDEX,
      ...(section === 'persona' && parts[2] ? { personaId: decodeSegment(parts[2]) } : {}),
    }
  }

  if (parts[0] === 'playground') {
    const tool = normalizeSlug(parts[1] ?? '')
    const index = playgroundIndexBySlug.get(tool) ?? numericPlaygroundIndex(tool)
    return {
      kind: 'playground',
      path,
      tool: tool || playgroundSlugByIndex.get(DEFAULT_PLAYGROUND_INDEX) || '',
      index: index ?? DEFAULT_PLAYGROUND_INDEX,
    }
  }

  if (parts[0] === 'inlay' || parts[0] === 'inlays') {
    return { kind: 'inlay', path }
  }

  if (parts[0] === 'grid' || (parts[0] === 'characters' && parts.length === 1)) {
    return { kind: 'grid', path }
  }

  if (parts[0] === 'character' && parts[1]) {
    return {
      kind: 'character',
      path,
      chaId: decodeSegment(parts[1]),
      chatId: parts[2] ? decodeSegment(parts[2]) : undefined,
    }
  }

  if (parts[0] === 'characters' && parts[1]) {
    return {
      kind: 'character',
      path,
      chaId: decodeSegment(parts[1]),
      chatId: parts[2] === 'chats' && parts[3] ? decodeSegment(parts[3]) : undefined,
    }
  }

  return { kind: 'not-found', path }
}

export function characterRoutePath(characterId: string, chatId?: string): string {
  const encodedCharacterId = encodeURIComponent(characterId)
  return chatId ? `/character/${encodedCharacterId}/${encodeURIComponent(chatId)}` : `/character/${encodedCharacterId}`
}

export function personaSettingsRoutePath(personaId?: string): string {
  return typeof personaId === 'string' && personaId.trim()
    ? `/settings/persona/${encodeURIComponent(personaId)}`
    : '/settings/persona'
}

export function navigateToPersonaSettings(personaId: string): void {
  if (!personaId.trim()) return
  navigate(personaSettingsRoutePath(personaId), { replace: true })
}

function routePathFromState(input: StateRouteInput): string {
  if (input.settingsOpen) {
    if (input.settingsMenuIndex < 0) return '/settings'
    if (input.settingsMenuIndex === 12) return personaSettingsRoutePath(input.personaId)
    return `/settings/${settingSlugByIndex.get(input.settingsMenuIndex) ?? 'model'}`
  }

  if (input.selectedCharID >= 0 && input.characterId) {
    if (input.characterId === PLAYGROUND_CHARACTER_ID) {
      return '/playground/chat'
    }
    return characterRoutePath(input.characterId, input.chatId)
  }

  if (input.playgroundStore > 0) {
    if (input.playgroundStore === 14) return '/inlay'
    const slug = playgroundSlugByIndex.get(input.playgroundStore)
    return slug ? `/playground/${slug}` : '/playground'
  }

  if (input.currentRouteKind === 'grid') {
    return '/grid'
  }

  return '/'
}

async function selectRoutedPersona(personaId: string, isFresh: () => boolean): Promise<void> {
  const index = uniquePersonaIndex(personaId)
  if (index < 0) {
    canonicalizePersonaSettingsRoute(isFresh)
    return
  }
  if (getDatabase().selectedPersona === index) return

  const persistence = changeUserPersonaWithOutcome(index)
  if (!persistence) {
    canonicalizePersonaSettingsRoute(isFresh)
    return
  }

  const status = await persistence
  if (status === 'failed') canonicalizePersonaSettingsRoute(isFresh)
}

function uniquePersonaIndex(personaId: string): number {
  let index = -1
  for (const [candidateIndex, persona] of (getDatabase().personas ?? []).entries()) {
    if (persona?.id !== personaId) continue
    if (index !== -1) return -1
    index = candidateIndex
  }
  return index
}

function canonicalizePersonaSettingsRoute(isFresh: () => boolean): void {
  if (!isFresh()) return
  const selectedPersona = getDatabase().personas?.[getDatabase().selectedPersona]
  const selectedId = typeof selectedPersona?.id === 'string' ? selectedPersona.id : undefined
  const path =
    selectedId && uniquePersonaIndex(selectedId) >= 0 ? personaSettingsRoutePath(selectedId) : '/settings/persona'
  commitPath(path, { replace: true, stateDriven: true, historyState: window.history.state })
}

async function openCharacterRoute(
  characterId: string,
  chatId: string | undefined,
  isFreshRouteApplication: () => boolean,
): Promise<void> {
  const isFreshCharacterRoute = () => isFreshRouteApplication()
  const index = findCharacterIndexbyId(characterId)
  if (index < 0) {
    selectedCharID.set(-1)
    settingsOpen.set(false)
    PlaygroundStore.set(0)
    return
  }

  settingsOpen.set(false)
  PlaygroundStore.set(0)
  OpenRealmStore.set(false)

  if (get(selectedCharID) !== index) {
    await changeChar(index, { isFresh: isFreshCharacterRoute })
  }

  if (!isFreshCharacterRoute()) return
  const liveIndex = findCharacterIndexbyId(characterId)
  if (liveIndex < 0) {
    restoreSelectedCharacterRoute()
    return
  }
  const liveSelectedIndex = get(selectedCharID)
  if (liveSelectedIndex !== liveIndex || getDatabase().characters?.[liveSelectedIndex]?.chaId !== characterId) {
    restoreSelectedCharacterRoute()
    return
  }

  if (!chatId) return
  const character = getDatabase().characters?.[liveIndex]
  const chatIndex = character?.chats?.findIndex((chat) => chat.id === chatId) ?? -1
  if (!character) return
  if (chatIndex < 0) {
    if (!isFreshCharacterRoute()) return
    commitPath(characterRoutePath(characterId), { replace: true, stateDriven: true })
    return
  }
  if (character.chatPage === chatIndex) return
  if (!isFreshCharacterRoute()) return
  changeChatTo(chatId)
}

function restoreSelectedCharacterRoute(): void {
  const selectedCharacter = getDatabase().characters?.[get(selectedCharID)]
  if (!selectedCharacter?.chaId) {
    commitPath('/', { replace: true, stateDriven: true })
    return
  }

  const selectedChatId = selectedCharacter.chats?.[selectedCharacter.chatPage]?.id
  commitPath(characterRoutePath(selectedCharacter.chaId, selectedChatId), {
    replace: true,
    stateDriven: true,
  })
}

function closeRouteBlockingViews(): void {
  CustomGUISettingMenuStore.set(false)
  botMakerMode.set(false)
  CharEmotion.set({})
}

function restoreCharacterSidebarViewMode(
  route: Extract<AppRoute, { kind: 'character' }>,
  isFresh: () => boolean,
): void {
  if (!isFresh() || !characterSidebarViewStateMatches(route)) return
  const selectedCharacter = getDatabase().characters?.[get(selectedCharID)]
  if (selectedCharacter?.chaId === route.chaId) botMakerMode.set(true)
}

function characterSidebarViewStateMatches(route: Extract<AppRoute, { kind: 'character' }>): boolean {
  if (typeof window === 'undefined') return false
  const candidate = historyStateRecord(window.history.state)[CHARACTER_SIDEBAR_VIEW_STATE_KEY]
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false
  const state = candidate as Partial<CharacterSidebarViewState[typeof CHARACTER_SIDEBAR_VIEW_STATE_KEY]>
  return (
    state.version === CHARACTER_SIDEBAR_VIEW_STATE_VERSION &&
    state.characterId === route.chaId &&
    state.routeKey === routeKey(route)
  )
}

function historyStateRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {}
}

function replaceCurrentHistoryState(state: Record<string, unknown>): void {
  window.history.replaceState(Object.keys(state).length === 0 ? null : state, '', window.location.href)
}

function commitPath(
  path: string,
  options: {
    historyState?: unknown
    replace: boolean
    stateDriven: boolean
  },
): void {
  if (typeof window === 'undefined') return
  const normalizedPath = normalizePath(path)
  const currentPath = normalizePath(window.location.pathname)
  const nextRoute = parseRoute(normalizedPath)
  const routeChanged = routeKey(get(currentRoute)) !== routeKey(nextRoute)
  const pathChanged = currentPath !== normalizedPath

  if (!options.stateDriven) {
    skipNextRouteApplication = false
  }

  if (!pathChanged && !routeChanged) {
    return
  }

  if (pathChanged) {
    const method = options.replace ? 'replaceState' : 'pushState'
    window.history[method](options.historyState ?? null, '', normalizedPath)
  }
  if (options.stateDriven) {
    skipNextRouteApplication = true
    routeApplicationPending = false
  } else {
    routeApplicationPending = true
  }
  currentRoute.set(nextRoute)
}

function gridOriginPath(historyState: unknown): string | null {
  if (!historyState || typeof historyState !== 'object') return null

  const gridState = (historyState as Partial<GridHistoryState>)[GRID_HISTORY_STATE_KEY]
  if (!gridState || gridState.version !== GRID_HISTORY_STATE_VERSION || typeof gridState.originPath !== 'string') {
    return null
  }

  const originPath = normalizePath(gridState.originPath)
  return parseRoute(originPath).kind === 'grid' ? null : originPath
}

function settingsHistoryState(originPath: string): SettingsHistoryState {
  return {
    [SETTINGS_HISTORY_STATE_KEY]: {
      originPath: normalizePath(originPath),
      version: SETTINGS_HISTORY_STATE_VERSION,
    },
  }
}

function settingsOriginPath(historyState: unknown): string | null {
  if (!historyState || typeof historyState !== 'object') return null

  const settingsState = (historyState as Partial<SettingsHistoryState>)[SETTINGS_HISTORY_STATE_KEY]
  if (
    !settingsState ||
    settingsState.version !== SETTINGS_HISTORY_STATE_VERSION ||
    typeof settingsState.originPath !== 'string'
  ) {
    return null
  }

  const originPath = normalizePath(settingsState.originPath)
  return parseRoute(originPath).kind === 'settings' ? null : originPath
}

function normalizePath(pathname: string): string {
  const withoutQuery = pathname.split(/[?#]/u)[0] || '/'
  const withLeadingSlash = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/u, '') : '/'
}

function splitPath(path: string): string[] {
  return path
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function normalizeSlug(segment: string): string {
  return decodeSegment(segment).trim().toLowerCase().replaceAll('_', '-')
}

function numericSettingIndex(slug: string): number | undefined {
  const value = Number(slug)
  return Number.isInteger(value) && settingSlugByIndex.has(value) ? value : undefined
}

function numericPlaygroundIndex(slug: string): number | undefined {
  const value = Number(slug)
  return Number.isInteger(value) && playgroundSlugByIndex.has(value) ? value : undefined
}

function routeKey(route: AppRoute): string {
  switch (route.kind) {
    case 'settings':
      return `${route.kind}:${route.index}:${route.personaId ?? ''}`
    case 'playground':
      return `${route.kind}:${route.index}`
    case 'character':
      return `${route.kind}:${route.chaId}:${route.chatId ?? ''}`
    default:
      return route.kind
  }
}
