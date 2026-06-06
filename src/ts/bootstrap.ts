import { checkNullish } from './util'
import { v4 as uuidv4 } from 'uuid'
import { get } from 'svelte/store'
import {
  applyServerCharacterLorebookProjection,
  applyServerCharacterSelectionProjection,
  applyServerProjectionDatabase,
  mergeServerProjectionFields,
  mergeServerProjectionCharacterRow,
  setDatabase,
  defaultSdDataFunc,
  getDatabase,
  setServerProjectionWriteGuardEnabled,
  type Database,
} from './storage/database.svelte'
import {
  MobileGUI,
  botMakerMode,
  selectedCharID,
  loadedStore,
  DBState,
  LoadingStatusState,
} from './stores.svelte'
import { loadPlugins } from './plugins/plugins.svelte'
import { alertError, alertMd, alertTOS, waitAlert, alertConfirm, alertInput } from './alert'
import {
  defaultJailbreak,
  defaultMainPrompt,
  oldJailbreak,
  oldMainPrompt,
} from './storage/defaultPrompts'
import { updateAnimationSpeed } from './gui/animation'
import { updateColorScheme, updateTextThemeAndCSS } from './gui/colorscheme'
import { language } from 'src/lang'
import { startObserveDom } from './observer.svelte'
import { updateGuisize } from './gui/guisize'
import { updateLorebooks } from './characters'
import { initMobileGesture } from './hotkey'
import { moduleUpdate } from './process/modules'
import { checkCharOrder } from './globalApi.svelte'
import { registerModelDynamic } from './model/modellist'
import {
  fetchServerBootstrapProjection,
  fetchServerBootstrapProjectionReadOnly,
} from './server/bootstrap'
import { subscribeServerCommandEvents, type ServerMemoryEvent } from './server/events'
import { publishServerMemoryJobEvent } from './server/memoryJobEvents'
import {
  canUseServerCommands,
  initializeServerDatabase,
  peekCachedServerCommandRevision,
  setCachedServerCommandRevision,
  type CommandEvent,
} from './server/commands'
import { peekActiveWriterSessionId } from './server/activeWriterSession'
import { fetchServerProjectionResource } from './server/projection'
import { forceServerProjectionResync } from './server/projectionResync'
import {
  applyServerChatMessagesProjection,
  hydrateActiveCharacterLorebook,
  hydrateActiveChat,
  resetChatHydration,
  startChatMessageHydration,
} from './server/chatMessageHydration.svelte'
import {
  recordHydratedCharacterLorebooks,
  resetLorebookHydration,
} from './server/lorebookBridge.svelte'
import {
  setActiveGenerationJobs,
  startActiveGenerationReattach,
  triggerOpenChatGenerationReattach,
} from './process/reattach'
import { applyServerHypaV3Progress } from './process/request/serverMemory'

// Delay before re-subscribing to the command-event stream after it drops. On
// reconnect we full-bootstrap to recover any events missed while disconnected.
const SERVER_PROJECTION_RECONNECT_DELAY_MS = 1000

let serverProjectionEventSubscription: { unsubscribe: () => void } | null = null
// Serializes the surgical-sync decision tree so inbound command events are
// applied strictly in arrival order (gap detection per-event, not batched).
let serverProjectionSyncChain: Promise<void> = Promise.resolve()
let serverProjectionEventsDesired = false
let serverProjectionReconnectTimer: ReturnType<typeof setTimeout> | null = null
/**
 * Loads the application data.
 */
export async function loadData() {
  const loaded = get(loadedStore)
  if (!loaded) {
    try {
      await loadWebInitialDatabase()
      LoadingStatusState.text = 'Loading Plugins...'
      try {
        await loadPlugins()
      } catch (error) {}
      LoadingStatusState.text = 'Checking For Format Update...'
      const db = getDatabase()

      LoadingStatusState.text = 'Updating States...'
      updateColorScheme()
      updateTextThemeAndCSS()
      updateAnimationSpeed()
      updateHeightMode()
      updateErrorHandling()
      updateGuisize()
      if (
        !localStorage.getItem('nightlyWarned') &&
        window.location.hostname === 'nightly.risuai.xyz'
      ) {
        alertMd(language.nightlyWarning)
        await waitAlert()
        //for testing, leave empty
        localStorage.setItem('nightlyWarned', '')
      }
      if (db.botSettingAtStart) {
        botMakerMode.set(true)
      }
      if (
        (db.betaMobileGUI && window.innerWidth <= 800) ||
        import.meta.env.VITE_RISU_LITE === 'TRUE'
      ) {
        initMobileGesture()
        MobileGUI.set(true)
      }
      loadedStore.set(true)
      selectedCharID.set(-1)
      startObserveDom()
      registerModelDynamic()
      moduleUpdate()
      alertTOS().then((a) => {
        if (a === false) {
          location.reload()
        }
      })
    } catch (error) {
      alertError(error)
    }
  }
}

export async function loadWebInitialDatabase() {
  LoadingStatusState.text = 'Loading Server Projection...'
  const bootstrap = await fetchServerBootstrapProjection()
  if (bootstrap.status !== 'ok') {
    throw new Error(
      bootstrap.status === 'unavailable' ? 'Server bootstrap is unavailable' : bootstrap.error,
    )
  }
  const projection =
    bootstrap.projection.database == null
      ? await initializeFreshServerDatabase()
      : bootstrap.projection
  applyServerProjectionDatabase(projection.database)
  // Record which characters arrive with a REAL (resident) globalLore. The
  // lorebook watcher only persists hydrated characters.
  resetLorebookHydration()
  recordHydratedCharacterLorebooks(projection.database.characters)
  // Seed the surgical-sync baseline: subsequent command events are decided
  // against the revision this client has applied.
  setCachedServerCommandRevision(projection.revision)
  setServerProjectionWriteGuardEnabled(true)
  // Surface any in-flight server generations so opening their chat re-attaches
  // to the live stream.
  setActiveGenerationJobs(projection.activeGenerationJobs ?? [])
  startActiveGenerationReattach()
  // Chats arrive as message-free stubs; hydrate the open chat's messages on
  // open (and re-hydrate after a re-stub).
  startChatMessageHydration()
  void hydrateActiveChat()
  await startServerProjectionEvents()
}

/**
 * One-time first-run seed. When bootstrap returns `database: null`, ask the
 * server to create its default database and then refetch the server-shaped
 * projection. A failed seed is fatal for this startup: the app should not enter
 * the home screen while the server still has no db.json-backed database.
 */
async function initializeFreshServerDatabase(): Promise<{
  revision: number
  database: Database
  activeGenerationJobs?: Array<{ chatId: string; jobId: string }>
}> {
  if (!canUseServerCommands()) {
    throw new Error('Initial server database seed failed: server commands unavailable')
  }

  const result = await initializeServerDatabase()
  if (result.status === 'ok') {
    setCachedServerCommandRevision(result.revision)
    const bootstrap = await fetchServerBootstrapProjectionReadOnly()
    if (bootstrap.status !== 'ok') {
      throw new Error(
        bootstrap.status === 'unavailable' ? 'Server bootstrap is unavailable' : bootstrap.error,
      )
    }
    if (bootstrap.projection.database == null) {
      throw new Error('Initial server database seed failed: server returned an empty projection')
    }
    return {
      revision: bootstrap.projection.revision,
      database: bootstrap.projection.database,
      activeGenerationJobs: bootstrap.projection.activeGenerationJobs,
    }
  }

  throw new Error(`Initial server database seed failed: ${serverCommandFailureMessage(result)}`)
}

function serverCommandFailureMessage(
  result: Exclude<Awaited<ReturnType<typeof initializeServerDatabase>>, { status: 'ok' }>,
): string {
  switch (result.status) {
    case 'conflict':
      return `revision conflict at ${result.currentRevision}`
    case 'error':
      return result.error
    case 'unavailable':
      return 'server commands unavailable'
  }
}

export function stopServerProjectionEvents() {
  serverProjectionEventsDesired = false
  serverProjectionEventSubscription?.unsubscribe()
  serverProjectionEventSubscription = null
  if (serverProjectionReconnectTimer) {
    clearTimeout(serverProjectionReconnectTimer)
    serverProjectionReconnectTimer = null
  }
}

async function startServerProjectionEvents() {
  teardownServerProjectionSubscription()
  serverProjectionEventsDesired = true
  const subscription = await subscribeServerCommandEvents({
    sinceRevision: peekCachedServerCommandRevision(),
    onCommandEvent: handleServerCommandEvent,
    onMemoryEvent: applyServerMemoryEvent,
    onError: (error) => {
      console.warn(error)
      scheduleServerProjectionReconnect()
    },
    onClose: () => {
      scheduleServerProjectionReconnect()
    },
  })
  if (subscription.status === 'ok') {
    serverProjectionEventSubscription = subscription
  } else if (subscription.status === 'error') {
    console.warn(`Server event subscription failed: ${subscription.error}`)
    scheduleServerProjectionReconnect()
  } else if (subscription.status === 'replay-unavailable') {
    console.warn(
      `Server event replay unavailable at revision ${subscription.currentRevision}; refreshing projection`,
    )
    enqueueServerProjectionSync(async () => {
      await forceServerProjectionResync('event-replay-unavailable')
      scheduleServerProjectionReconnect()
    })
  }
}

function teardownServerProjectionSubscription() {
  serverProjectionEventSubscription?.unsubscribe()
  serverProjectionEventSubscription = null
}

function scheduleServerProjectionReconnect() {
  if (serverProjectionReconnectTimer || !serverProjectionEventsDesired) return
  serverProjectionReconnectTimer = setTimeout(() => {
    serverProjectionReconnectTimer = null
    if (!serverProjectionEventsDesired) return
    void (async () => {
      await startServerProjectionEvents()
    })()
  }, SERVER_PROJECTION_RECONNECT_DELAY_MS)
}

function applyServerMemoryEvent(event: ServerMemoryEvent) {
  if (event.sideEffect?.kind === 'hypav3_progress') {
    applyServerHypaV3Progress(event.sideEffect.payload)
  }
  publishServerMemoryJobEvent(event)
}

/**
 * Surgical inbound sync for server projection command events. Each event is
 * decided against the last revision this client applied:
 *   - `event.revision <= cached` → own echo / already applied → skip.
 *   - `event.revision === cached + 1` → contiguous foreign event → targeted
 *     fetch of just that resource (or full bootstrap if the server cannot
 *     narrow it).
 *   - `event.revision > cached + 1` (gap) or no baseline → full bootstrap.
 * Events are processed strictly in arrival order via a serial chain so gap
 * detection is per-event rather than batched.
 */
function handleServerCommandEvent(event: CommandEvent) {
  enqueueServerProjectionSync(() => processServerCommandEvent(event))
}

function enqueueServerProjectionSync(task: () => Promise<void>) {
  serverProjectionSyncChain = serverProjectionSyncChain
    .then(task)
    .catch((error) => console.warn('Server projection sync failed', error))
}

async function processServerCommandEvent(event: CommandEvent): Promise<void> {
  if (isOwnCommandEvent(event)) {
    setCachedServerCommandRevision(event.revision)
    return
  }
  const cached = peekCachedServerCommandRevision()
  if (cached === null) {
    // No baseline yet: reconcile from scratch.
    await forceServerProjectionResync('no-baseline', { resource: event.resource })
    return
  }
  if (event.revision <= cached) {
    // Own echo or an event already covered by a prior apply → nothing to do.
    return
  }
  if (event.revision === cached + 1) {
    const result = await fetchServerProjectionResource(event.resource, {
      id: event.id,
      parentId: event.parentId,
    })
    if (result.status === 'ok' && result.mode === 'character-selection') {
      applyServerCharacterSelectionProjection({
        characterId: result.characterId,
        currentChar: result.currentChar,
        lastInteraction: result.lastInteraction,
      })
      setCachedServerCommandRevision(event.revision)
      return
    }
    if (result.status === 'ok' && result.mode === 'character-lorebook') {
      // A foreign character-globalLore edit: surgically replace just that
      // character's globalLore instead of re-shipping every character. Works
      // whether or not lorebook stubs are on (the field is set resident).
      applyServerCharacterLorebookProjection(result.characterId, result.globalLore)
      setCachedServerCommandRevision(event.revision)
      return
    }
    if (result.status === 'ok' && result.mode === 'character-row') {
      // A foreign per-character edit (character field / module-link / chat or
      // folder metadata): surgically replace just that character row, preserving
      // already-hydrated chat messages, instead of re-stubbing every character.
      const applied = mergeServerProjectionCharacterRow(result.character)
      if (applied) {
        setCachedServerCommandRevision(event.revision)
        return
      }
      // Unknown character locally → reconcile from scratch.
      await forceServerProjectionResync('projection-error', { resource: event.resource })
      return
    }
    if (result.status === 'ok' && result.mode === 'generation-chat') {
      // Foreign server-owned generation: apply just the changed chat's message
      // tail and re-arm the open-chat reattach, instead of re-stubbing every
      // character and re-hydrating the open chat.
      applyServerChatMessagesProjection(
        result.chatId,
        result.message,
        result.hypaV3Data,
        result.alternates,
      )
      triggerOpenChatGenerationReattach()
      setCachedServerCommandRevision(event.revision)
      return
    }
    if (result.status === 'ok' && result.mode === 'fields') {
      mergeServerProjectionFields(result.fields)
      // The `characters` fields are message-free stubs and the merge replaces
      // the whole array, so it re-stubs EVERY chat, not just the open one.
      // Forget cached hydration so re-open or bulk reads refetch stale chats,
      // then re-hydrate the open chat eagerly.
      if (Object.prototype.hasOwnProperty.call(result.fields, 'characters')) {
        resetChatHydration()
        void hydrateActiveChat({ force: true })
        // The merge re-stubs every character's globalLore too: forget hydrated
        // marks, re-record from the freshly merged raw characters, then re-hydrate
        // the open character's globalLore (no-op unless stubs are on).
        resetLorebookHydration()
        recordHydratedCharacterLorebooks(result.fields.characters)
        void hydrateActiveCharacterLorebook({ force: true })
        triggerOpenChatGenerationReattach()
      }
      // Advance by exactly one event; the fetch returns the resource as of the
      // server's *current* revision, but later events for other resources must
      // still be processed, so the cursor only moves to this event.
      setCachedServerCommandRevision(event.revision)
      return
    }
    // 'full' mode, error, or unavailable → fall back to a full reconcile.
    await forceServerProjectionResync(
      result.status === 'ok' && result.mode === 'full'
        ? 'projection-full-mode'
        : 'projection-error',
      { resource: event.resource },
    )
    return
  }
  // Gap detected (event.revision > cached + 1) → self-healing full bootstrap.
  await forceServerProjectionResync('revision-gap', { resource: event.resource })
}

function isOwnCommandEvent(event: CommandEvent): boolean {
  const writerSessionId = peekActiveWriterSessionId()
  return !!writerSessionId && event.origin?.writerSessionId === writerSessionId
}

/**
 * Updates the error handling by adding custom handlers for errors and unhandled promise rejections.
 */
function updateErrorHandling() {
  const errorHandler = (event: ErrorEvent) => {
    console.error(event.error)
    if (!(event.error.target instanceof Worker)) {
      alertError(event.error)
    }
  }
  const rejectHandler = (event: PromiseRejectionEvent) => {
    console.error(event.reason)
    alertError(event.reason)
  }
  window.addEventListener('error', errorHandler)
  window.addEventListener('unhandledrejection', rejectHandler)
}

/**
 * Updates the height mode of the document based on the value stored in the database.
 */
function updateHeightMode() {
  const db = getDatabase()
  const root = document.querySelector(':root') as HTMLElement
  switch (db.heightMode) {
    case 'auto':
      root.style.setProperty('--risu-height-size', '100%')
      break
    case 'vh':
      root.style.setProperty('--risu-height-size', '100vh')
      break
    case 'dvh':
      root.style.setProperty('--risu-height-size', '100dvh')
      break
    case 'lvh':
      root.style.setProperty('--risu-height-size', '100lvh')
      break
    case 'svh':
      root.style.setProperty('--risu-height-size', '100svh')
      break
    case 'percent':
      root.style.setProperty('--risu-height-size', '100%')
      break
  }
}

/**
 * Checks and updates the database format to the latest version.
 */
async function checkNewFormat(): Promise<void> {
  let db = getDatabase()

  // Check data integrity
  db.characters = db.characters
    .map((v) => {
      if (!v) {
        return null
      }
      v.chaId ??= uuidv4()
      v.type ??= 'character'
      v.chatPage ??= 0
      v.chats ??= []
      // Chats arrive as message-free stubs; keep `message` a valid array so the
      // active-chat UI renders before hydration fills it on open.
      for (const chat of v.chats) {
        if (chat && !Array.isArray(chat.message)) chat.message = []
      }
      v.customscript ??= []
      v.firstMessage ??= ''
      v.globalLore ??= []
      v.name ??= ''
      v.viewScreen ??= 'none'
      v.emotionImages = v.emotionImages ?? []

      if (v.type === 'character') {
        v.bias ??= []
        v.characterVersion ??= ''
        v.creator ??= ''
        v.desc ??= ''
        v.utilityBot ??= false
        v.tags ??= []
        v.systemPrompt ??= ''
        v.scenario ??= ''
      }
      return v
    })
    .filter((v) => {
      return v !== null
    })

  db.modules = await Promise.all(
    (db.modules ?? []).map(async (v) => {
      if (v?.lorebook) {
        if (!Array.isArray(v.lorebook)) {
          console.error('Critical: Invalid lorebook format detected in module')
          console.error('Module data:', JSON.stringify(v, null, 2))

          // Alert user about corrupted data
          alertError(
            language.bootstrap.dataCorruptionDetected(v.name || 'Unknown', typeof v.lorebook),
          )
          await waitAlert()

          // Ask if user wants to report the issue
          const shouldReport = await alertConfirm(language.bootstrap.reportErrorQuestion)

          if (shouldReport) {
            try {
              // Collect diagnostic information (without personal data)
              const diagnosticInfo = {
                timestamp: new Date().toISOString(),
                moduleName: v.name || 'Unknown',
                lorebookType: typeof v.lorebook,
                lorebookValue: JSON.stringify(v.lorebook).substring(0, 500), // First 500 chars only
                isArray: Array.isArray(v.lorebook),
                keys: v.lorebook ? Object.keys(v.lorebook).join(', ') : 'N/A',
                formatVersion: db.formatversion || 'Unknown',
              }

              // Show the diagnostic info and allow user to copy or send
              const reportData = JSON.stringify(diagnosticInfo, null, 2)
              await alertMd(language.bootstrap.diagnosticInformation(reportData))
              await waitAlert()

              console.log('Diagnostic information for developers:', diagnosticInfo)
            } catch (reportError) {
              console.error('Failed to generate diagnostic report:', reportError)
            }
          }

          // Ask if user wants to reset the data
          const shouldReset = await alertConfirm(language.bootstrap.resetLorebookQuestion)

          if (shouldReset) {
            v.lorebook = []
            console.log('Lorebook reset to empty array by user choice')
          } else {
            console.warn('User chose to keep corrupted lorebook data')
          }
        } else {
          v.lorebook = updateLorebooks(v.lorebook)
        }
      }
      return v
    }),
  )

  db.modules = db.modules.filter((v) => {
    return v !== null && v !== undefined
  })

  db.personas = (db.personas ?? [])
    .map((v) => {
      v.id ??= uuidv4()
      return v
    })
    .filter((v) => {
      return v !== null && v !== undefined
    })

  if (!db.formatversion) {
    function checkClean(data: string) {
      if (data.startsWith('assets') || data.length < 3) {
        return data
      } else {
        const d = 'assets/' + data.replace(/\\/g, '/').split('assets/')[1]
        if (!d) {
          return data
        }
        return d
      }
    }

    db.customBackground = checkClean(db.customBackground)
    db.userIcon = checkClean(db.userIcon)

    for (let i = 0; i < db.characters.length; i++) {
      if (db.characters[i].image) {
        db.characters[i].image = checkClean(db.characters[i].image)
      }
      if (db.characters[i].emotionImages) {
        for (let i2 = 0; i2 < db.characters[i].emotionImages.length; i2++) {
          if (
            db.characters[i].emotionImages[i2] &&
            db.characters[i].emotionImages[i2].length >= 2
          ) {
            db.characters[i].emotionImages[i2][1] = checkClean(
              db.characters[i].emotionImages[i2][1],
            )
          }
        }
      }
    }

    db.formatversion = 2
  }
  if (db.formatversion < 3) {
    for (let i = 0; i < db.characters.length; i++) {
      let cha = db.characters[i]
      if (cha.type === 'character') {
        if (checkNullish(cha.sdData)) {
          cha.sdData = defaultSdDataFunc()
        }
      }
    }

    db.formatversion = 3
  }
  if (db.formatversion < 4) {
    //migration removed due to issues
    db.formatversion = 4
  }
  if (db.formatversion < 5) {
    if (db.loreBookToken < 8000) {
      db.loreBookToken = 8000
    }
    db.formatversion = 5
  }
  if (!db.characterOrder) {
    db.characterOrder = []
  }
  if (db.mainPrompt === oldMainPrompt) {
    db.mainPrompt = defaultMainPrompt
  }
  if (db.mainPrompt === oldJailbreak) {
    db.mainPrompt = defaultJailbreak
  }
  for (let i = 0; i < db.characters.length; i++) {
    const trashTime = db.characters[i].trashTime
    const targetTrashTime = trashTime ? trashTime + 1000 * 60 * 60 * 24 * 3 : 0
    if (trashTime && targetTrashTime < Date.now()) {
      db.characters.splice(i, 1)
      i--
    }
  }
  setDatabase(db)
  checkCharOrder()
}

/**
 * Assigns unique IDs to characters and chats.
 */
function assignIds() {
  if (!DBState?.db?.characters) {
    return
  }
  const assignedIds = new Set<string>()
  for (let i = 0; i < DBState.db.characters.length; i++) {
    const cha = DBState.db.characters[i]
    if (!cha.chaId) {
      cha.chaId = uuidv4()
    }
    if (assignedIds.has(cha.chaId)) {
      console.warn(`Duplicate chaId found: ${cha.chaId}. Assigning new ID.`)
      cha.chaId = uuidv4()
    }
    assignedIds.add(cha.chaId)
    for (let i2 = 0; i2 < cha.chats.length; i2++) {
      const chat = cha.chats[i2]
      if (!chat.id) {
        chat.id = uuidv4()
      }
      if (assignedIds.has(chat.id)) {
        console.warn(`Duplicate chat ID found: ${chat.id}. Assigning new ID.`)
        chat.id = uuidv4()
      }
      assignedIds.add(chat.id)
    }
  }
}
