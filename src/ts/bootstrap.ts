import { get } from 'svelte/store'
import { getDatabase, setResourceWriteGuardEnabled, type Database } from './storage/database.svelte'
import { botMakerMode, selectedCharID, loadedStore, LoadingStatusState } from './stores.svelte'
import { loadPlugins } from './plugins/plugins.svelte'
import { alertError, alertMd, alertTOS, waitAlert } from './alert'
import { updateAnimationSpeed } from './gui/animation'
import { updateColorScheme, updateTextThemeAndCSS } from './gui/colorscheme'
import { language } from 'src/lang'
import { startObserveDom } from './observer.svelte'
import { updateGuisize } from './gui/guisize'
import { moduleUpdate } from './process/modules'
import { registerModelDynamic } from './model/modellist'
import { fetchServerBootstrap, fetchServerBootstrapReadOnly, type ServerBootstrapRuntime } from './server/bootstrap'
import { subscribeServerCommandEvents, type ServerMemoryEvent } from './server/events'
import { publishServerMemoryJobEvent } from './server/memoryJobEvents'
import {
  canUseServerCommands,
  deferOwnServerCommandReconciliation,
  initializeServerDatabase,
  peekAppliedServerResourceRevision,
  peekCachedServerCommandRevision,
  setAppliedServerResourceRevision,
  setCachedServerCommandRevision,
  setServerCommandSuccessReconciler,
  type CommandEvent,
  type ServerCommandLocalEffect,
} from './server/commands'
import { peekActiveWriterSessionId } from './server/activeWriterSession'
import { startBridgePatchLifecycleFlush } from './server/bridgeFlush'
import {
  acknowledgeCreatedChatTranscriptLocalEffect,
  acknowledgeMessageMutationLocalEffect,
  applyMessageTranslationLocalEffect,
  hydrateActiveChat,
  invalidateChatHydration,
  resetChatHydration,
  startChatMessageHydration,
} from './server/chatMessageHydration.svelte'
import {
  isCharacterLorebookHydrated,
  recordHydratedCharacterLorebooks,
  resetLorebookHydration,
} from './server/lorebookBridge.svelte'
import {
  setActiveGenerationJobs,
  startActiveGenerationReattach,
  triggerOpenChatGenerationReattach,
} from './process/reattach'
import { setActiveMessageTranslations, startActiveMessageTranslationRefresh } from './server/messageTranslationJobs'
import { applyServerHypaV3Progress } from './process/request/serverMemory'
import { shouldAcceptMemoryJobUpdate } from './server/memoryJobOrdering'
import { enableChatCompletionPushNotifications } from './server/pushNotifications'
import { loadInitialServerResources, refreshInvalidatedServerResources } from './server/resourceInvalidation'
import { forceServerResourceRefresh, serverResourceInvalidationHooks } from './server/resourceRefresh'
import {
  applyCharacterCollectionMutationLocalEffect,
  applyCharacterPatchLocalEffect,
  applyCharacterOrderLocalEffect,
  applyCharacterRowMutationLocalEffect,
  applyCharacterSelectionLocalEffect,
  applyChatPatchLocalEffect,
  applyChatGenerationSettingsLocalEffect,
  applySettingsPatchLocalEffect,
  applyPluginCollectionMutationLocalEffect,
  applyPluginProviderLocalEffect,
  applyPluginStorageLocalEffect,
  applyModuleCollectionMutationLocalEffect,
  applyModuleEnabledLocalEffect,
  applyGlobalLorebookMutationLocalEffect,
  applyLoadoutMutationLocalEffect,
  applyLorebookMutationLocalEffect,
  hasCharacterLorebookProjectionEpochChanged,
  hasCharacterRowProjectionEpochChanged,
  hasCollectionProjectionEpochChanged,
  hasLorebookPageProjectionEpochChanged,
  hasSettingsGroupProjectionEpochChanged,
} from './server/resourceState.svelte'
import { withServerResourceApply } from './server/resourceWriteGuard.svelte'
import { hasDestructiveRefreshEpochChanged } from './server/staleStateGuards'
import { ensurePromptTemplateHydrated } from './server/promptTemplateHydration'

const SERVER_RESOURCE_RECONNECT_BASE_DELAY_MS = 1000
const SERVER_RESOURCE_RECONNECT_MAX_DELAY_MS = 30_000
const SERVER_RESOURCE_RECONNECT_JITTER_RATIO = 0.2

let serverResourceEventSubscription: { unsubscribe: () => void } | null = null
let stopBridgePatchLifecycleFlush: (() => void) | null = null
// Serializes resource invalidation so the applied revision cursor advances in
// command-event order.
let serverResourceSyncChain: Promise<void> = Promise.resolve()
let serverResourceEventsDesired = false
let serverResourceReconnectTimer: ReturnType<typeof setTimeout> | null = null
let serverResourceReconnectAttempt = 0

function initialSelectedCharFromDatabase(db: Database): number {
  const currentChar = (db as { currentChar?: unknown }).currentChar
  const characterCount = Array.isArray(db.characters) ? db.characters.length : 0
  if (Number.isInteger(currentChar) && (currentChar as number) >= 0 && (currentChar as number) < characterCount) {
    return currentChar as number
  }
  return -1
}

/**
 * Loads the application data.
 */
export async function loadData() {
  const loaded = get(loadedStore)
  if (!loaded) {
    try {
      await loadWebInitialDatabase()
      const db = getDatabase()
      if (db.notification === true) {
        void enableChatCompletionPushNotifications()
      }
      LoadingStatusState.text = 'Loading Plugins...'
      try {
        await loadPlugins()
      } catch (error) {}
      LoadingStatusState.text = 'Checking For Format Update...'

      LoadingStatusState.text = 'Updating States...'
      updateColorScheme()
      updateTextThemeAndCSS()
      updateAnimationSpeed()
      updateHeightMode()
      updateErrorHandling()
      updateGuisize()
      if (!localStorage.getItem('nightlyWarned') && window.location.hostname === 'nightly.risuai.xyz') {
        alertMd(language.nightlyWarning)
        await waitAlert()
        //for testing, leave empty
        localStorage.setItem('nightlyWarned', '')
      }
      if (db.botSettingAtStart) {
        botMakerMode.set(true)
      }
      loadedStore.set(true)
      selectedCharID.set(initialSelectedCharFromDatabase(db))
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
  LoadingStatusState.text = 'Loading Server Data...'
  const firstBootstrap = await fetchServerBootstrap()
  if (firstBootstrap.status !== 'ok') {
    throw new Error(firstBootstrap.status === 'unavailable' ? 'Server bootstrap is unavailable' : firstBootstrap.error)
  }
  const runtime = firstBootstrap.bootstrap.initialized
    ? firstBootstrap.bootstrap
    : await initializeFreshServerDatabase(firstBootstrap.bootstrap)

  const resources = await loadInitialServerResources({ hooks: serverResourceInvalidationHooks })
  if (resources.status !== 'ok') {
    throw new Error(
      resources.status === 'unavailable'
        ? 'Server resource APIs are unavailable'
        : `Server resource load failed: ${resources.error}`,
    )
  }

  const database = getDatabase()
  selectedCharID.set(initialSelectedCharFromDatabase(database))
  resetChatHydration()
  resetLorebookHydration()
  recordHydratedCharacterLorebooks(database.characters)
  if (!(await ensurePromptTemplateHydrated({ minimumRevision: resources.revision }))) {
    throw new Error('Selected prompt-template owner hydration failed')
  }
  setCachedServerCommandRevision(resources.revision)
  setAppliedServerResourceRevision(resources.revision)
  setServerCommandSuccessReconciler((event, coalescedEvents, localEffects) =>
    enqueueServerResourceSync(() =>
      processServerCommandEvents(coalescedEvents.length > 0 ? coalescedEvents : [event], localEffects),
    ),
  )
  setResourceWriteGuardEnabled(true)
  setActiveGenerationJobs(runtime.activeGenerationJobs ?? [])
  setActiveMessageTranslations(runtime.activeMessageTranslations ?? [])
  startActiveMessageTranslationRefresh()
  startActiveGenerationReattach()
  startChatMessageHydration()
  void hydrateActiveChat()
  stopBridgePatchLifecycleFlush?.()
  stopBridgePatchLifecycleFlush = startBridgePatchLifecycleFlush()
  await startServerResourceEvents()
}

/**
 * One-time first-run seed. The initialize response supplies the new revision,
 * so the pre-initialize runtime metadata remains valid when this client wins
 * the initialization race. A read-only bootstrap retry is only needed when a
 * different client initialized the database first.
 */
async function initializeFreshServerDatabase(initialRuntime: ServerBootstrapRuntime): Promise<ServerBootstrapRuntime> {
  if (!canUseServerCommands()) {
    throw new Error('Initial server database seed failed: server commands unavailable')
  }

  const result = await initializeServerDatabase()
  if (result.status === 'ok') {
    setCachedServerCommandRevision(result.revision)
    if (result.initialized === true) {
      return {
        ...initialRuntime,
        initialized: true,
        revision: result.revision,
      }
    }

    const bootstrap = await fetchServerBootstrapReadOnly()
    if (bootstrap.status !== 'ok') {
      throw new Error(bootstrap.status === 'unavailable' ? 'Server bootstrap is unavailable' : bootstrap.error)
    }
    if (!bootstrap.bootstrap.initialized) {
      throw new Error('Initial server database seed failed: server is still uninitialized')
    }
    return bootstrap.bootstrap
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

export function stopServerResourceEvents() {
  serverResourceEventsDesired = false
  serverResourceEventSubscription?.unsubscribe()
  serverResourceEventSubscription = null
  stopBridgePatchLifecycleFlush?.()
  stopBridgePatchLifecycleFlush = null
  setServerCommandSuccessReconciler(null)
  if (serverResourceReconnectTimer) {
    clearTimeout(serverResourceReconnectTimer)
    serverResourceReconnectTimer = null
  }
  serverResourceReconnectAttempt = 0
}

async function startServerResourceEvents() {
  teardownServerResourceSubscription()
  serverResourceEventsDesired = true
  const subscription = await subscribeServerCommandEvents({
    sinceRevision: peekAppliedServerResourceRevision(),
    onCommandEvent: handleServerCommandEvent,
    onMemoryEvent: applyServerMemoryEvent,
    onError: (error) => {
      console.warn(error)
      if (error.includes('Malformed command event frame')) {
        enqueueServerResourceSync(async () => {
          await forceServerResourceRefresh('malformed-command-event')
          scheduleServerResourceReconnect()
        })
        return
      }
      scheduleServerResourceReconnect()
    },
    onClose: () => {
      scheduleServerResourceReconnect()
    },
  })
  if (subscription.status === 'ok') {
    serverResourceReconnectAttempt = 0
    serverResourceEventSubscription = subscription
  } else if (subscription.status === 'error') {
    console.warn(`Server event subscription failed: ${subscription.error}`)
    scheduleServerResourceReconnect()
  } else if (subscription.status === 'replay-unavailable') {
    console.warn(`Server event replay unavailable at revision ${subscription.currentRevision}; refreshing resources`)
    enqueueServerResourceSync(async () => {
      await forceServerResourceRefresh('event-replay-unavailable')
      scheduleServerResourceReconnect()
    })
  }
}

function teardownServerResourceSubscription() {
  serverResourceEventSubscription?.unsubscribe()
  serverResourceEventSubscription = null
}

function scheduleServerResourceReconnect() {
  if (serverResourceReconnectTimer || !serverResourceEventsDesired) return
  const delayMs = calculateServerResourceReconnectDelayMs(serverResourceReconnectAttempt)
  serverResourceReconnectAttempt += 1
  serverResourceReconnectTimer = setTimeout(() => {
    serverResourceReconnectTimer = null
    if (!serverResourceEventsDesired) return
    void (async () => {
      await startServerResourceEvents()
    })()
  }, delayMs)
}

export function calculateServerResourceReconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const normalizedAttempt = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0
  const exponentialDelay = Math.min(
    SERVER_RESOURCE_RECONNECT_MAX_DELAY_MS,
    SERVER_RESOURCE_RECONNECT_BASE_DELAY_MS * 2 ** normalizedAttempt,
  )
  const randomValue = random()
  const normalizedRandom = Number.isFinite(randomValue) && randomValue >= 0 && randomValue <= 1 ? randomValue : 0.5
  const jitterMultiplier =
    1 - SERVER_RESOURCE_RECONNECT_JITTER_RATIO + normalizedRandom * SERVER_RESOURCE_RECONNECT_JITTER_RATIO * 2
  const jitteredDelay = Math.round(exponentialDelay * jitterMultiplier)

  return Math.min(SERVER_RESOURCE_RECONNECT_MAX_DELAY_MS, Math.max(1, jitteredDelay))
}

function applyServerMemoryEvent(event: ServerMemoryEvent) {
  if (!shouldAcceptMemoryJobUpdate({ chatId: event.chatId, ...event.job })) return
  if (event.sideEffect?.kind === 'hypav3_progress') {
    applyServerHypaV3Progress(event.sideEffect.payload)
  }
  publishServerMemoryJobEvent(event)
}

/**
 * Apply API resource invalidations in command revision order. Dedicated read
 * endpoints own the mapping from event resources to settings, collections,
 * character rows, transcripts, and lorebooks; revision gaps fall back to one
 * complete resource refresh.
 */
function handleServerCommandEvent(event: CommandEvent) {
  if (isOwnCommandEvent(event) && deferOwnServerCommandReconciliation(event)) return
  enqueueServerResourceSync(() => processServerCommandEvents([event]))
}

function enqueueServerResourceSync(task: () => Promise<void>): Promise<void> {
  serverResourceSyncChain = serverResourceSyncChain
    .then(task)
    .catch((error) => console.warn('Server resource sync failed', error))
  return serverResourceSyncChain
}

async function processServerCommandEvents(
  events: readonly CommandEvent[],
  localEffects: ReadonlyMap<number, ServerCommandLocalEffect> = new Map(),
): Promise<void> {
  if (events.length === 0) return

  const sortedEvents = [...events].sort((left, right) => left.revision - right.revision)
  let pendingAuthoritativeEvents: CommandEvent[] = []

  const flushPendingAuthoritativeEvents = async (): Promise<boolean> => {
    if (pendingAuthoritativeEvents.length === 0) return true
    const pending = pendingAuthoritativeEvents
    pendingAuthoritativeEvents = []
    return processAuthoritativeServerCommandEvents(pending)
  }

  for (const event of sortedEvents) {
    const localEffect = localEffects.get(event.revision)
    if (!localEffect) {
      pendingAuthoritativeEvents.push(event)
      continue
    }

    if (!(await flushPendingAuthoritativeEvents())) return
    const appliedRevision = peekAppliedServerResourceRevision()
    if (appliedRevision !== null && event.revision <= appliedRevision) continue

    if (
      appliedRevision !== null &&
      event.revision === appliedRevision + 1 &&
      applyContiguousServerCommandLocalEffect(event, localEffect)
    ) {
      advanceKnownServerCommandRevision(event.revision)
      setAppliedServerResourceRevision(event.revision)
      continue
    }

    // A local acknowledgement can only advance a contiguous cursor. A gap or
    // an effect whose target disappeared must retain the ordinary authoritative
    // invalidation path.
    if (!(await processAuthoritativeServerCommandEvents([event]))) return
  }

  await flushPendingAuthoritativeEvents()
}

function applyContiguousServerCommandLocalEffect(event: CommandEvent, localEffect: ServerCommandLocalEffect): boolean {
  switch (localEffect.kind) {
    case 'chatGenerationSettings':
      if (event.id !== localEffect.chatId || event.parentId !== localEffect.characterId) return false
      return withServerResourceApply(() =>
        applyChatGenerationSettingsLocalEffect({
          revision: event.revision,
          characterId: localEffect.characterId,
          chatId: localEffect.chatId,
          attemptedGenerationSettings: localEffect.attemptedGenerationSettings,
          generationSettings: localEffect.generationSettings,
        }),
      )
    case 'characterPatch':
      if (event.resource !== 'characterRow' || event.id !== localEffect.characterId) return false
      return withServerResourceApply(() =>
        applyCharacterPatchLocalEffect({
          revision: event.revision,
          characterId: localEffect.characterId,
          patch: localEffect.patch,
        }),
      )
    case 'characterSelection':
      if (event.resource !== 'characterSelection' || event.id !== localEffect.characterId) return false
      return withServerResourceApply(() =>
        applyCharacterSelectionLocalEffect({
          revision: event.revision,
          characterId: localEffect.characterId,
          lastInteraction: localEffect.lastInteraction,
        }),
      )
    case 'characterCollectionMutation': {
      const expectedType =
        localEffect.operation === 'create'
          ? 'character.created'
          : localEffect.operation === 'createAndSelect'
            ? 'character.createdAndSelected'
            : 'character.deleted'
      if (
        event.type !== expectedType ||
        event.resource !== 'character' ||
        event.id !== localEffect.characterId ||
        event.parentId !== undefined
      ) {
        return false
      }
      return withServerResourceApply(() =>
        applyCharacterCollectionMutationLocalEffect({
          revision: event.revision,
          operation: localEffect.operation,
          characterId: localEffect.characterId,
          selectedCharacterId: localEffect.selectedCharacterId,
        }),
      )
    }
    case 'chatPatch':
      if (
        event.resource !== 'characterRow' ||
        event.id !== localEffect.chatId ||
        event.parentId !== localEffect.characterId
      ) {
        return false
      }
      return withServerResourceApply(() =>
        applyChatPatchLocalEffect({
          revision: event.revision,
          characterId: localEffect.characterId,
          chatId: localEffect.chatId,
          patch: localEffect.patch,
          select: localEffect.select,
        }),
      )
    case 'chatStructureMutation': {
      if (hasDestructiveRefreshEpochChanged(localEffect.optimisticEpoch)) return false
      if (hasCharacterRowProjectionEpochChanged(localEffect.characterId, localEffect.optimisticRowEpoch)) {
        return false
      }
      const expectedType =
        localEffect.operation === 'create'
          ? 'chat.created'
          : localEffect.operation === 'delete'
            ? 'chat.deleted'
            : localEffect.operation === 'fork'
              ? 'chat.forked'
              : localEffect.operation === 'reorder'
                ? 'chat.reordered'
                : localEffect.operation === 'folderCreate'
                  ? 'chatFolder.created'
                  : localEffect.operation === 'folderDelete'
                    ? 'chatFolder.deleted'
                    : 'chatFolder.reordered'
      const createsTranscript = localEffect.operation === 'create' || localEffect.operation === 'fork'
      const reorders = localEffect.operation === 'reorder' || localEffect.operation === 'folderReorder'
      if (
        event.type !== expectedType ||
        event.parentId !== localEffect.characterId ||
        (event.resource !== 'characterRow' && !(createsTranscript && event.resource === 'chatTranscript')) ||
        (reorders ? event.id !== undefined : event.id !== localEffect.targetId)
      ) {
        return false
      }
      if (
        reorders &&
        (!Array.isArray(localEffect.attemptedIds) ||
          localEffect.attemptedIds.some((id) => typeof id !== 'string' || id.trim() === '') ||
          new Set(localEffect.attemptedIds).size !== localEffect.attemptedIds.length)
      ) {
        return false
      }
      if (!reorders && (typeof localEffect.targetId !== 'string' || localEffect.targetId.trim() === '')) return false

      if (createsTranscript) {
        const attemptedGenerationSettings = localEffect.attemptedGenerationSettings
        const generationSettings = localEffect.generationSettings
        if (
          !Object.prototype.hasOwnProperty.call(localEffect, 'attemptedGenerationSettings') ||
          !Object.prototype.hasOwnProperty.call(localEffect, 'generationSettings') ||
          (attemptedGenerationSettings !== null &&
            (!attemptedGenerationSettings ||
              typeof attemptedGenerationSettings !== 'object' ||
              Array.isArray(attemptedGenerationSettings))) ||
          (generationSettings !== null &&
            (!generationSettings || typeof generationSettings !== 'object' || Array.isArray(generationSettings)))
        ) {
          return false
        }
      }

      let createdChatMatches: Array<{ characterId: string; message: unknown }> = []
      if (createsTranscript) {
        createdChatMatches = (getDatabase().characters ?? []).flatMap((character) =>
          (character.chats ?? [])
            .filter((chat) => chat.id === localEffect.targetId)
            .map((chat) => ({ characterId: character.chaId, message: chat.message })),
        )
        if (
          createdChatMatches.length !== 1 ||
          createdChatMatches[0].characterId !== localEffect.characterId ||
          !Array.isArray(createdChatMatches[0].message)
        ) {
          return false
        }
      }

      return withServerResourceApply(() => {
        if (
          !applyCharacterRowMutationLocalEffect({
            revision: event.revision,
            characterId: localEffect.characterId,
            targetId: localEffect.targetId ?? localEffect.characterId,
          })
        ) {
          return false
        }
        if (createsTranscript && localEffect.targetId) {
          const createdChat = (getDatabase().characters ?? [])
            .find((character) => character.chaId === localEffect.characterId)
            ?.chats?.find((chat) => chat.id === localEffect.targetId)
          if (
            createdChat &&
            JSON.stringify(createdChat.generationSettings ?? null) ===
              JSON.stringify(localEffect.attemptedGenerationSettings)
          ) {
            if (localEffect.generationSettings === null) {
              delete createdChat.generationSettings
            } else {
              createdChat.generationSettings = JSON.parse(
                JSON.stringify(localEffect.generationSettings),
              ) as typeof createdChat.generationSettings
            }
          }
          return acknowledgeCreatedChatTranscriptLocalEffect(localEffect.targetId)
        }
        if (localEffect.operation === 'delete' && localEffect.targetId) {
          invalidateChatHydration(localEffect.targetId)
        }
        return true
      })
    }
    case 'settingsPatch':
      if (event.id !== localEffect.group) return false
      return withServerResourceApply(() =>
        applySettingsPatchLocalEffect({
          revision: event.revision,
          group: localEffect.group,
          attemptedPatch: localEffect.attemptedPatch,
          settings: localEffect.settings,
        }),
      )
    case 'pluginStorage': {
      const expectedType =
        localEffect.operation === 'put'
          ? 'pluginStorage.updated'
          : localEffect.operation === 'delete'
            ? 'pluginStorage.deleted'
            : 'pluginStorage.bulkUpdated'
      if (event.resource !== 'pluginStorage' || event.type !== expectedType) return false
      if (localEffect.operation === 'bulk' ? event.id !== undefined : event.id !== localEffect.key) return false
      return withServerResourceApply(() => applyPluginStorageLocalEffect({ revision: event.revision }))
    }
    case 'pluginCollectionMutation': {
      const expectedType =
        localEffect.operation === 'create'
          ? 'plugin.created'
          : localEffect.operation === 'update'
            ? 'plugin.updated'
            : localEffect.operation === 'delete'
              ? 'plugin.deleted'
              : localEffect.operation === 'enable'
                ? 'plugin.enabled'
                : 'plugin.reordered'
      if (event.resource !== 'pluginCollection' || event.type !== expectedType) return false
      if (localEffect.operation === 'reorder' ? event.id !== undefined : event.id !== localEffect.pluginId) return false
      return withServerResourceApply(() =>
        applyPluginCollectionMutationLocalEffect({
          revision: event.revision,
          operation: localEffect.operation,
          pluginId: localEffect.pluginId,
          pluginIds: localEffect.pluginIds,
        }),
      )
    }
    case 'pluginProvider':
      if (
        event.type !== 'plugin.provider.selected' ||
        event.resource !== 'pluginProvider' ||
        event.id !== localEffect.provider
      ) {
        return false
      }
      return withServerResourceApply(() =>
        applyPluginProviderLocalEffect({ revision: event.revision, provider: localEffect.provider }),
      )
    case 'moduleCollectionMutation': {
      const expectedType =
        localEffect.operation === 'create'
          ? 'module.created'
          : localEffect.operation === 'update'
            ? 'module.updated'
            : localEffect.operation === 'reorder'
              ? 'module.reordered'
              : localEffect.operation === 'lorebooks'
                ? 'lorebook.entries.replaced'
                : localEffect.operation === 'scripts'
                  ? 'scriptDefinitions.replaced'
                  : 'triggerDefinitions.replaced'
      const expectedResource =
        localEffect.operation === 'create'
          ? 'moduleCreated'
          : localEffect.operation === 'reorder'
            ? 'moduleReordered'
            : localEffect.operation === 'scripts'
              ? 'moduleScriptDefinition'
              : localEffect.operation === 'triggers'
                ? 'moduleTriggerDefinition'
                : 'moduleUpdated'
      if (event.type !== expectedType || event.resource !== expectedResource || event.parentId !== undefined) {
        return false
      }
      if (localEffect.operation === 'reorder' ? event.id !== undefined : event.id !== localEffect.moduleId) {
        return false
      }
      return withServerResourceApply(() =>
        applyModuleCollectionMutationLocalEffect({
          revision: event.revision,
          operation: localEffect.operation,
          moduleId: localEffect.moduleId,
          moduleIds: localEffect.moduleIds,
        }),
      )
    }
    case 'moduleEnabled':
      if (
        event.type !== 'module.enabled' ||
        event.resource !== 'moduleEnabled' ||
        event.id !== localEffect.moduleId ||
        event.parentId !== undefined
      ) {
        return false
      }
      return withServerResourceApply(() =>
        applyModuleEnabledLocalEffect({
          revision: event.revision,
          moduleId: localEffect.moduleId,
          enabled: localEffect.enabled,
        }),
      )
    case 'globalLorebookMutation': {
      const expectedType =
        localEffect.operation === 'create'
          ? 'lorebook.created'
          : localEffect.operation === 'update'
            ? 'lorebook.updated'
            : localEffect.operation === 'delete'
              ? 'lorebook.deleted'
              : localEffect.operation === 'reorder'
                ? 'lorebook.reordered'
                : 'lorebook.selected'
      if (event.type !== expectedType || event.resource !== 'globalLorebook' || event.parentId !== undefined) {
        return false
      }

      const changesCollection = localEffect.operation !== 'select'
      const changesPage =
        localEffect.operation === 'delete' || localEffect.operation === 'reorder' || localEffect.operation === 'select'
      if (
        changesCollection &&
        (typeof localEffect.collectionProjectionEpoch !== 'number' ||
          !Number.isInteger(localEffect.collectionProjectionEpoch) ||
          localEffect.collectionProjectionEpoch < 0 ||
          hasCollectionProjectionEpochChanged('loreBook', localEffect.collectionProjectionEpoch))
      ) {
        return false
      }
      if (
        changesPage &&
        (typeof localEffect.pageProjectionEpoch !== 'number' ||
          !Number.isInteger(localEffect.pageProjectionEpoch) ||
          localEffect.pageProjectionEpoch < 0 ||
          hasLorebookPageProjectionEpochChanged(localEffect.pageProjectionEpoch))
      ) {
        return false
      }

      if (localEffect.operation === 'reorder') {
        if (
          event.id !== undefined ||
          !Array.isArray(localEffect.lorebookIds) ||
          localEffect.lorebookIds.some((id) => typeof id !== 'string' || id.trim() === '') ||
          new Set(localEffect.lorebookIds).size !== localEffect.lorebookIds.length ||
          (localEffect.selectedLorebookId !== null &&
            (typeof localEffect.selectedLorebookId !== 'string' ||
              localEffect.selectedLorebookId.trim() === '' ||
              !localEffect.lorebookIds.includes(localEffect.selectedLorebookId)))
        ) {
          return false
        }
      } else if (
        typeof localEffect.lorebookId !== 'string' ||
        localEffect.lorebookId.trim() === '' ||
        event.id !== localEffect.lorebookId ||
        (localEffect.operation === 'select' && localEffect.selectedLorebookId !== localEffect.lorebookId)
      ) {
        return false
      }

      return withServerResourceApply(() =>
        applyGlobalLorebookMutationLocalEffect({
          revision: event.revision,
          operation: localEffect.operation,
          lorebookId: localEffect.lorebookId,
          lorebookIds: localEffect.lorebookIds,
          selectedLorebookId: localEffect.selectedLorebookId,
        }),
      )
    }
    case 'lorebookMutation': {
      if (
        localEffect.operation !== 'replace' &&
        localEffect.operation !== 'upsert' &&
        localEffect.operation !== 'delete' &&
        localEffect.operation !== 'reorder'
      ) {
        return false
      }

      if (localEffect.scope === 'global') {
        if (
          event.type !== 'lorebook.entries.replaced' ||
          event.resource !== 'globalLorebook' ||
          event.id !== localEffect.lorebookId ||
          event.parentId !== undefined ||
          typeof localEffect.collectionProjectionEpoch !== 'number' ||
          !Number.isInteger(localEffect.collectionProjectionEpoch) ||
          localEffect.collectionProjectionEpoch < 0 ||
          hasCollectionProjectionEpochChanged('loreBook', localEffect.collectionProjectionEpoch)
        ) {
          return false
        }
      } else if (localEffect.scope === 'character') {
        if (
          event.type !== 'lorebook.entries.replaced' ||
          event.resource !== 'characterLorebook' ||
          event.id !== localEffect.characterId ||
          event.parentId !== undefined ||
          typeof localEffect.characterRowProjectionEpoch !== 'number' ||
          !Number.isInteger(localEffect.characterRowProjectionEpoch) ||
          localEffect.characterRowProjectionEpoch < 0 ||
          typeof localEffect.characterLorebookProjectionEpoch !== 'number' ||
          !Number.isInteger(localEffect.characterLorebookProjectionEpoch) ||
          localEffect.characterLorebookProjectionEpoch < 0 ||
          typeof localEffect.characterId !== 'string' ||
          !isCharacterLorebookHydrated(localEffect.characterId) ||
          hasCharacterRowProjectionEpochChanged(localEffect.characterId, localEffect.characterRowProjectionEpoch) ||
          hasCharacterLorebookProjectionEpochChanged(
            localEffect.characterId,
            localEffect.characterLorebookProjectionEpoch,
          )
        ) {
          return false
        }
      } else if (
        localEffect.scope !== 'chat' ||
        event.type !== 'lorebook.entries.replaced' ||
        event.resource !== 'characterRow' ||
        event.id !== localEffect.chatId ||
        event.parentId !== localEffect.characterId ||
        typeof localEffect.characterId !== 'string' ||
        typeof localEffect.characterRowProjectionEpoch !== 'number' ||
        !Number.isInteger(localEffect.characterRowProjectionEpoch) ||
        localEffect.characterRowProjectionEpoch < 0 ||
        hasCharacterRowProjectionEpochChanged(localEffect.characterId, localEffect.characterRowProjectionEpoch)
      ) {
        return false
      }

      return withServerResourceApply(() =>
        applyLorebookMutationLocalEffect({
          revision: event.revision,
          scope: localEffect.scope,
          operation: localEffect.operation,
          lorebookId: localEffect.lorebookId,
          characterId: localEffect.characterId,
          chatId: localEffect.chatId,
        }),
      )
    }
    case 'loadoutMutation': {
      const expectedType = {
        create: 'loadout.created',
        delete: 'loadout.deleted',
        favorite: 'loadout.favorited',
        touch: 'loadout.touched',
      }[localEffect.operation]
      if (
        event.type !== expectedType ||
        event.resource !== 'loadout' ||
        event.id !== localEffect.loadoutId ||
        event.parentId !== undefined ||
        typeof localEffect.loadoutsProjectionEpoch !== 'number' ||
        !Number.isInteger(localEffect.loadoutsProjectionEpoch) ||
        localEffect.loadoutsProjectionEpoch < 0 ||
        hasCollectionProjectionEpochChanged('loadouts', localEffect.loadoutsProjectionEpoch)
      ) {
        return false
      }
      if (
        localEffect.operation === 'touch' &&
        (typeof localEffect.settingsProjectionEpoch !== 'number' ||
          !Number.isInteger(localEffect.settingsProjectionEpoch) ||
          localEffect.settingsProjectionEpoch < 0 ||
          typeof localEffect.loadedName !== 'string' ||
          localEffect.loadedName.trim() === '' ||
          hasSettingsGroupProjectionEpochChanged('sidebar', localEffect.settingsProjectionEpoch))
      ) {
        return false
      }
      return withServerResourceApply(() =>
        applyLoadoutMutationLocalEffect({
          revision: event.revision,
          operation: localEffect.operation,
          loadoutId: localEffect.loadoutId,
        }),
      )
    }
    case 'characterDefinitionMutation': {
      const expectedType =
        localEffect.operation === 'scripts' ? 'scriptDefinitions.replaced' : 'triggerDefinitions.replaced'
      if (
        event.type !== expectedType ||
        event.resource !== 'characterRow' ||
        event.id !== localEffect.characterId ||
        event.parentId !== undefined ||
        !Number.isInteger(localEffect.optimisticRowEpoch) ||
        localEffect.optimisticRowEpoch < 0 ||
        hasCharacterRowProjectionEpochChanged(localEffect.characterId, localEffect.optimisticRowEpoch)
      ) {
        return false
      }
      return withServerResourceApply(() =>
        applyCharacterRowMutationLocalEffect({
          revision: event.revision,
          characterId: localEffect.characterId,
          targetId: localEffect.characterId,
        }),
      )
    }
    case 'messageTranslation':
      if (
        event.type !== 'message.updated' ||
        event.resource !== 'message' ||
        event.id !== localEffect.messageId ||
        event.parentId !== localEffect.chatId
      ) {
        return false
      }
      return withServerResourceApply(() =>
        applyMessageTranslationLocalEffect(localEffect.chatId, localEffect.messageId, localEffect.translation),
      )
    case 'messageMutation': {
      const expectedType =
        localEffect.operation === 'append'
          ? 'message.appended'
          : localEffect.operation === 'update'
            ? 'message.updated'
            : localEffect.operation === 'delete'
              ? 'message.deleted'
              : localEffect.operation === 'truncate'
                ? 'message.truncated'
                : 'messages.replaced'
      if (
        event.type !== expectedType ||
        event.resource !== 'message' ||
        event.parentId !== localEffect.chatId ||
        (localEffect.messageId === undefined ? event.id !== undefined : event.id !== localEffect.messageId)
      ) {
        return false
      }
      return withServerResourceApply(() => acknowledgeMessageMutationLocalEffect(localEffect.chatId))
    }
    case 'characterRowMutation': {
      const expectedType =
        localEffect.operation === 'chatFolderUpdate' ? 'chatFolder.updated' : 'chat.scriptstate.updated'
      if (
        event.type !== expectedType ||
        event.resource !== 'characterRow' ||
        event.id !== localEffect.targetId ||
        event.parentId !== localEffect.characterId
      ) {
        return false
      }
      return withServerResourceApply(() =>
        applyCharacterRowMutationLocalEffect({
          revision: event.revision,
          characterId: localEffect.characterId,
          targetId: localEffect.targetId,
        }),
      )
    }
    case 'characterOrder':
      if (event.type !== 'character.reordered' || event.resource !== 'characterOrder' || event.id !== undefined) {
        return false
      }
      return withServerResourceApply(() =>
        applyCharacterOrderLocalEffect({ revision: event.revision, attemptedOrder: localEffect.attemptedOrder }),
      )
  }
}

async function processAuthoritativeServerCommandEvents(events: readonly CommandEvent[]): Promise<boolean> {
  if (events.length === 0) return true

  const previousSelectedIndex = get(selectedCharID)
  const previousSelectedCharacterId =
    previousSelectedIndex >= 0 ? getDatabase().characters?.[previousSelectedIndex]?.chaId : undefined
  const result = await refreshInvalidatedServerResources(events, {
    appliedRevision: peekAppliedServerResourceRevision(),
    hooks: serverResourceInvalidationHooks,
  })

  if (result.status !== 'ok') {
    if (result.status === 'error') console.warn(`Server resource invalidation failed: ${result.error}`)
    scheduleServerResourceReconnect()
    return false
  }
  if (result.scope === 'none') return true

  if (
    result.scope === 'full' &&
    !(await ensurePromptTemplateHydrated({ force: true, minimumRevision: result.revision }))
  ) {
    console.warn('Server resource invalidation failed: selected prompt-template owner hydration failed')
    scheduleServerResourceReconnect()
    return false
  }

  reconcileSelectedCharacterAfterResourceRefresh(events, previousSelectedIndex, previousSelectedCharacterId)
  recordHydratedCharacterLorebooks(getDatabase().characters)

  if (result.scope === 'full') {
    resetChatHydration()
    resetLorebookHydration()
    recordHydratedCharacterLorebooks(getDatabase().characters)
    void hydrateActiveChat({ force: true })
    triggerOpenChatGenerationReattach()
  }

  advanceKnownServerCommandRevision(result.revision)
  setAppliedServerResourceRevision(result.revision)
  return true
}

function reconcileSelectedCharacterAfterResourceRefresh(
  events: readonly CommandEvent[],
  previousIndex: number,
  previousCharacterId: string | undefined,
): void {
  const database = getDatabase()
  if (events.some((event) => event.resource === 'characterSelection')) {
    selectedCharID.set(initialSelectedCharFromDatabase(database))
    return
  }
  if (previousIndex < 0) return

  const preservedIndex = previousCharacterId
    ? database.characters.findIndex((character) => character?.chaId === previousCharacterId)
    : -1
  selectedCharID.set(preservedIndex >= 0 ? preservedIndex : initialSelectedCharFromDatabase(database))
}

function isOwnCommandEvent(event: CommandEvent): boolean {
  const writerSessionId = peekActiveWriterSessionId()
  return !!writerSessionId && event.origin?.writerSessionId === writerSessionId
}

function advanceKnownServerCommandRevision(revision: number): void {
  const cached = peekCachedServerCommandRevision()
  if (cached === null || revision > cached) {
    setCachedServerCommandRevision(revision)
  }
}

/**
 * Updates the error handling by adding custom handlers for errors and unhandled promise rejections.
 */
export function createGlobalErrorHandlers() {
  const errorHandler = (event: ErrorEvent | Event) => {
    console.error(getGlobalErrorLogPayload(event))
    if (isResourceOrWorkerErrorTarget(event.target)) {
      return
    }
    const alertPayload = getUsableGlobalErrorAlertPayload(event)
    if (alertPayload !== null) {
      alertError(alertPayload)
    }
  }
  const rejectHandler = (event: PromiseRejectionEvent) => {
    console.error(event.reason)
    const alertPayload = getUsableRejectionAlertPayload(event.reason)
    if (alertPayload !== null) {
      alertError(alertPayload)
    }
  }
  return { errorHandler, rejectHandler }
}

function updateErrorHandling() {
  const { errorHandler, rejectHandler } = createGlobalErrorHandlers()
  window.addEventListener('error', errorHandler)
  window.addEventListener('unhandledrejection', rejectHandler)
}

function getGlobalErrorLogPayload(event: ErrorEvent | Event): unknown {
  if ('error' in event) {
    return event.error
  }
  return event
}

function isResourceOrWorkerErrorTarget(target: EventTarget | null): boolean {
  if (target === null || target === window) {
    return false
  }
  if (typeof Worker !== 'undefined' && target instanceof Worker) {
    return true
  }
  return typeof Element !== 'undefined' && target instanceof Element
}

function getUsableGlobalErrorAlertPayload(event: ErrorEvent | Event): Error | string | null {
  const error = 'error' in event ? event.error : undefined
  const errorPayload = getUsableErrorLikeAlertPayload(error)
  if (errorPayload !== null) {
    return errorPayload
  }

  const message = 'message' in event ? event.message : undefined
  return getUsableErrorLikeAlertPayload(message)
}

function getUsableRejectionAlertPayload(reason: unknown): Error | string | null {
  return getUsableErrorLikeAlertPayload(reason)
}

function getUsableErrorLikeAlertPayload(value: unknown): Error | string | null {
  if (value instanceof Error) {
    return value.message.trim() ? value : null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  return null
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
