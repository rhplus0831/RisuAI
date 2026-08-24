<script lang="ts">
  import { untrack } from 'svelte'
  import {
    DynamicGUI,
    settingsOpen,
    sideBarClosing,
    sideBarStore,
    openPresetList,
    openPersonaList,
    openChatGenerationTogglePresetList,
    closePresetListModal,
    closePersonaListModal,
    closeChatGenerationTogglePresetListModal,
    presetListModalStore,
    personaListModalStore,
    chatGenerationTogglePresetListModalStore,
    CustomGUISettingMenuStore,
    bookmarkListOpen,
    popupStore,
    easyPanelStore,
    popUpEditorStore,
    loadoutModalStore,
    irisStore,
    customSideBarConfigDialogStore,
    PlaygroundStore,
    SettingsMenuIndex,
    closePopupEditorSession,
  } from './ts/stores.svelte'
  import { alertStore, LoadingStatusState, selectedCharID } from './ts/stores/coreStores.svelte'
  import { startupCoordinatorStore } from './ts/startupReadiness'
  import { pluginRuntimeStateStore } from './ts/plugins/plugins.svelte'
  import Sidebar from './lib/SideBars/Sidebar.svelte'
  import ChatScreen from './lib/ChatScreens/ChatScreen.svelte'
  import { showRealmInfoStore } from './ts/realmInfoStore'
  import { getResourceDatabase as getDatabase } from './ts/server/resourceState.svelte'
  import { language } from './lang'
  import LazyComponent from './lib/UI/LazyComponent.svelte'
  import SavePopupIconComp from './lib/Others/SavePopupIcon.svelte'
  import { ArrowUpIcon, GlobeIcon, PlusIcon } from '@lucide/svelte'
  import { hypaV3ModalOpen } from './ts/stores.svelte'
  import { activeMemoryJobsStore } from './ts/server/memoryJobProjection.svelte'
  import sendSound from './etc/send.mp3'
  import {
    applyRouteToStores,
    closeGridRoute,
    consumeStateDrivenRouteUpdate,
    currentRoute,
    hasPendingRouteApplication,
    isApplyingRouteToStores,
    navigate,
    openGridRoute,
    syncRouteFromState,
  } from './ts/router'
  import { modalFocusTrap } from './ts/gui/modalFocusTrap'
  import { alertError } from './ts/alert'
  import { hasDragType, RISU_APP_INTERNAL_DRAG_TYPE, RISU_SIDEBAR_DRAG_TYPE } from './ts/dragTypes'

  const loadAlert = () => import('./lib/Others/AlertComp.svelte')
  const loadRealmPopup = () => import('./lib/UI/Realm/LazyRealmPopUp.svelte')
  const loadGrid = () => import('./lib/Others/GridCatalog.svelte')
  const loadBookmarkList = () => import('./lib/Others/BookmarkList.svelte')
  const loadSettings = () => import('./lib/Setting/Settings.svelte')
  const loadBotPreset = () => import('./lib/Setting/botpreset.svelte')
  const loadPersonaList = () => import('./lib/Setting/listedPersona.svelte')
  const loadChatGenerationTogglePresetDialog = () => import('./lib/SideBars/ChatGenerationTogglePresetDialog.svelte')
  const loadCustomGUISettingMenu = () => import('./lib/Setting/Pages/CustomGUISettingMenu.svelte')
  const loadHypaV3Modal = () => import('./lib/Others/HypaV3Modal.svelte')
  const loadHypaV3Progress = () => import('./lib/Others/HypaV3Progress.svelte')
  const loadPopupList = () => import('./lib/UI/PopupList.svelte')
  const loadEasyPanel = () => import('./lib/Others/ProTools/EasyPanel.svelte')
  const loadPopupEditor = () => import('./lib/Others/PopupEditor.svelte')
  const loadLoadoutModal = () => import('./lib/Others/LoadoutModal.svelte')
  const loadIrisModal = () => import('./lib/Others/IrisModal.svelte')
  const loadCustomSidebarConfig = () => import('./lib/Others/CustomSidebarConfig.svelte')

  let aprilFools = $state(new Date().getMonth() === 3 && new Date().getDate() === 1)
  let aprilFoolsPage = $state(0)
  let keepingSessionAlive = $state(false)
  let retryingPluginRuntime = $state(false)
  let pluginStartupFailed = $derived($startupCoordinatorStore.failures.pluginsReady !== undefined)
  let pluginRuntimeFailed = $derived($pluginRuntimeStateStore.phase === 'error')

  async function retryPlugins(): Promise<void> {
    if (retryingPluginRuntime) return
    retryingPluginRuntime = true
    try {
      if (pluginStartupFailed) {
        const { retryPluginStartup } = await import('./ts/bootstrap')
        await retryPluginStartup()
      } else {
        const { retryPluginRuntime } = await import('./ts/plugins/plugins.svelte')
        await retryPluginRuntime()
      }
    } finally {
      retryingPluginRuntime = false
    }
  }

  function getMainDropEffect(event: DragEvent): DataTransfer['dropEffect'] {
    const types = event.dataTransfer?.types
    if (hasDragType(types, RISU_SIDEBAR_DRAG_TYPE) || hasDragType(types, RISU_APP_INTERNAL_DRAG_TYPE)) {
      return 'none'
    }
    return hasDragType(types, 'Files') ? 'copy' : 'none'
  }

  function isAppInternalDrag(event: DragEvent): boolean {
    const types = event.dataTransfer?.types
    return hasDragType(types, RISU_APP_INTERNAL_DRAG_TYPE) || hasDragType(types, RISU_SIDEBAR_DRAG_TYPE)
  }

  function markAppInternalDrag(event: DragEvent): void {
    event.dataTransfer?.setData(RISU_APP_INTERNAL_DRAG_TYPE, 'true')
  }

  function closeResponsiveSidebar(): void {
    if ($sideBarClosing) return
    sideBarClosing.set(true)
  }

  function handleResponsiveSidebarKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    closeResponsiveSidebar()
  }

  let routeChatIsOpen = $derived($currentRoute.kind === 'character' && typeof $currentRoute.chatId === 'string')

  $effect(() => {
    if (!$startupCoordinatorStore.capabilities.canApplyRoutes) return
    const route = $currentRoute
    if (consumeStateDrivenRouteUpdate()) return
    untrack(() => {
      void applyRouteToStores(route)
    })
  })

  $effect(() => {
    if (!$startupCoordinatorStore.capabilities.canApplyRoutes) return

    // Read every state value that can drive the URL before checking the route
    // application guard. Route application writes these stores while the guard
    // is active; retaining their subscriptions lets the next user-owned write
    // re-run this effect after the route settles.
    const currentRouteKind = $currentRoute.kind
    const settingsAreOpen = $settingsOpen
    const settingsMenuIndex = $SettingsMenuIndex
    const selectedCharacterIndex = $selectedCharID
    const playgroundIndex = $PlaygroundStore
    const chatIsOpen = routeChatIsOpen
    const database = getDatabase()
    const character = database.characters?.[selectedCharacterIndex]
    const persona = database.personas?.[database.selectedPersona]

    if (isApplyingRouteToStores() || hasPendingRouteApplication()) return
    syncRouteFromState({
      currentRouteKind,
      settingsOpen: settingsAreOpen,
      settingsMenuIndex,
      selectedCharID: selectedCharacterIndex,
      playgroundStore: playgroundIndex,
      personaId: typeof persona?.id === 'string' ? persona.id : undefined,
      characterId: character?.chaId,
      chatId: chatIsOpen ? character?.chats?.[character.chatPage]?.id : undefined,
    })
  })
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<main
  data-risu-visual-viewport-shell
  class="flex bg-bg w-full h-full max-w-100vw text-textcolor"
  ondragover={(e) => {
    if (isAppInternalDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = getMainDropEffect(e)
  }}
  ondragstart={markAppInternalDrag}
  ondrop={async (e) => {
    if (isAppInternalDrag(e)) {
      e.preventDefault()
      return
    }
    const file = e.dataTransfer.files[0]
    if (!file) {
      e.preventDefault()
      return
    }
    e.preventDefault()
    try {
      const name = file.name.toLowerCase()

      if (name.endsWith('.risup')) {
        const data = new Uint8Array(await file.arrayBuffer())
        const { importPreset } = await import('./ts/storage/database.svelte')
        await importPreset({ name: file.name, data })
      } else if (name.endsWith('.risum')) {
        const data = new Uint8Array(await file.arrayBuffer())
        const { importRisuModuleData } = await import('./ts/process/modules')
        await importRisuModuleData(data)
        return
      } else {
        const [{ importCharacterProcess }, { checkCharOrder }] = await Promise.all([
          import('./ts/characterCards'),
          import('./ts/globalApi.svelte'),
        ])
        await importCharacterProcess({
          name: file.name,
          data: file,
        })
        checkCharOrder()
      }
    } catch (error) {
      alertError(error as Error)
    }
  }}
  onclick={() => {
    if (keepingSessionAlive) {
      return
    }

    const aliveMode = getDatabase().keepSessionAlive
    switch (aliveMode) {
      case 'sound': {
        console.log('Starting silent audio to keep session alive')
        const silentAudio = new Audio(sendSound)
        silentAudio.loop = true
        silentAudio.volume = 0.000001
        silentAudio.play()
        keepingSessionAlive = true
        break
      }
    }
  }}>
  {#if $startupCoordinatorStore.capabilities.canRenderShell && (pluginStartupFailed || pluginRuntimeFailed)}
    <div
      class="fixed top-3 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-md border border-yellow-600 bg-bg px-4 py-3 text-sm shadow-lg"
      role="status"
      aria-live="polite"
      data-plugin-runtime-status>
      <span>{language.pluginRuntime.failed}</span>
      <button
        type="button"
        class="shrink-0 rounded bg-yellow-700 px-3 py-1.5 text-white disabled:cursor-wait disabled:opacity-60"
        disabled={retryingPluginRuntime}
        onclick={(event) => {
          event.stopPropagation()
          void retryPlugins()
        }}>
        {retryingPluginRuntime ? language.pluginRuntime.retrying : language.pluginRuntime.retry}
      </button>
    </div>
  {/if}
  {#if aprilFools}
    <div class="bg-[#212121] w-full h-screen min-h-screen text-black flex relative">
      <div class="w-full max-w-3xl mx-auto py-8 px-4 flex justify-center items-center">
        <div class="flex flex-col w-full items-center text-[#bbbbbb]">
          {#if aprilFoolsPage === 0}
            <h1 class="text-3xl text-white font-bold mb-6">What can I help you?</h1>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="resize-none relative w-full bg-[#303030] rounded-3xl h-[110px] mb-6 text-[#bbbbbb]"
              placeholder="Ask me"
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  aprilFoolsPage = 1
                }
              }}>
              <textarea
                class="absolute top-0 left-0 w-full placeholder-[#bbbbbb] rounded-3xl h-full p-4 bg-transparent resize-none"
                placeholder="Ask me"></textarea>
              <div class="absolute bottom-2 left-4 flex gap-1.5">
                <button class="p-2 rounded-full border border-[#bbbbbb30]">
                  <PlusIcon size={18} color="#bbbbbb" />
                </button>
                <button class="p-2 rounded-full border border-[#bbbbbb30]">
                  <GlobeIcon size={18} color="#bbbbbb" />
                </button>
              </div>
              <div class="absolute bottom-2 right-4 flex">
                <button class="p-2 rounded-full bg-[#bbbbbb]">
                  <ArrowUpIcon size={18} color="#00000080" />
                </button>
              </div>
            </div>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="flex gap-1.5"
              onclick={() => {
                aprilFoolsPage = 1
              }}>
              <button class="rounded-full border border-[#bbbbbb15] px-4 py-2">
                <span class="text-[#bbbbbb]">🔍</span>
                Search
              </button>
              <button class="rounded-full border border-[#bbbbbb15] px-4 py-2">
                <span class="text-[#bbbbbb]">🎮</span>
                Games
              </button>
              <button class="rounded-full border border-[#bbbbbb15] px-4 py-2">
                <span class="text-[#bbbbbb]">🎨</span>
                Roleplay
              </button>
              <button class="rounded-full border border-[#bbbbbb15] px-4 py-2"> More </button>
            </div>
          {:else}
            <h1 class="text-3xl text-white font-bold mb-6">We do not have search results.</h1>
            <p class="text-[#bbbbbb] mb-6">
              <!-- svelte-ignore a11y_missing_attribute -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <a
                class="text-blue-500 cursor-pointer"
                onclick={() => {
                  aprilFoolsPage = 0
                  aprilFools = false
                }}>
                Go to Risuai
              </a>
            </p>
          {/if}
        </div>
      </div>
      <span class="absolute top-4 left-4 font-bold text-[#bbbbbb] text-md md:text-lg">RisyGTP 9+ Mytho Ultra Free</span>
    </div>
  {:else if !$startupCoordinatorStore.capabilities.canRenderShell}
    <div
      class="w-full h-full flex justify-center items-center text-textcolor text-xl bg-gray-900 flex-col"
      role="status"
      aria-live="polite"
      aria-busy="true">
      <div class="flex flex-row items-center">
        <svg
          class="animate-spin -ml-1 mr-3 h-5 w-5 text-textcolor"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
        <span>Loading...</span>
      </div>

      <span class="text-sm mt-2 text-textcolor2">{LoadingStatusState.text}</span>
    </div>
  {:else if $CustomGUISettingMenuStore}
    <LazyComponent loader={loadCustomGUISettingMenu} fill testId="custom-gui-settings" />
  {:else if $settingsOpen}
    <LazyComponent loader={loadSettings} fill label={language.settings} testId="settings" />
  {:else if $currentRoute.kind === 'grid'}
    <LazyComponent
      loader={loadGrid}
      componentProps={{ endGrid: closeGridRoute }}
      fill
      label={language.grid}
      testId="character-grid" />
  {:else}
    {#if !$DynamicGUI}
      <Sidebar openGrid={openGridRoute} hidden={!$sideBarStore} />
    {:else if $sideBarStore}
      <div
        data-modal-root
        use:modalFocusTrap
        role="dialog"
        aria-modal="true"
        aria-label={language.menu}
        tabindex="-1"
        class="fixed top-0 w-full h-full left-0 z-30 flex flex-row items-center"
        onkeydown={handleResponsiveSidebarKeydown}>
        <Sidebar openGrid={openGridRoute} hidden={false} />
      </div>
    {/if}
    <ChatScreen />
  {/if}
  {#if $alertStore.type !== 'none'}
    <LazyComponent loader={loadAlert} modal testId="alert" />
  {/if}
  {#if $showRealmInfoStore}
    <LazyComponent loader={loadRealmPopup} modal onDismiss={() => showRealmInfoStore.set(null)} testId="realm-popup" />
  {/if}
  {#if $openPresetList}
    <LazyComponent
      loader={loadBotPreset}
      componentProps={{
        mode: presetListModalStore.mode,
        kind: presetListModalStore.kind,
        target: presetListModalStore.target,
        close: closePresetListModal,
      }}
      modal
      onDismiss={closePresetListModal}
      testId="preset-list" />
  {/if}
  {#if $openPersonaList}
    <LazyComponent
      loader={loadPersonaList}
      componentProps={{
        mode: personaListModalStore.mode,
        target: personaListModalStore.target,
        close: closePersonaListModal,
      }}
      modal
      onDismiss={closePersonaListModal}
      testId="persona-list" />
  {/if}
  {#if $openChatGenerationTogglePresetList}
    <LazyComponent
      loader={loadChatGenerationTogglePresetDialog}
      componentProps={{
        target: chatGenerationTogglePresetListModalStore.target,
        close: closeChatGenerationTogglePresetListModal,
      }}
      modal
      onDismiss={closeChatGenerationTogglePresetListModal}
      testId="chat-generation-toggle-presets" />
  {/if}
  {#if $bookmarkListOpen}
    <LazyComponent
      loader={loadBookmarkList}
      modal
      onDismiss={() => bookmarkListOpen.set(false)}
      testId="bookmark-list" />
  {/if}
  {#if $hypaV3ModalOpen}
    <LazyComponent loader={loadHypaV3Modal} modal onDismiss={() => hypaV3ModalOpen.set(false)} testId="hypa-v3" />
  {/if}
  <SavePopupIconComp />
  {#if $activeMemoryJobsStore.length > 0}
    <LazyComponent loader={loadHypaV3Progress} testId="hypa-v3-progress" />
  {/if}
  {#if popupStore.children}
    <LazyComponent loader={loadPopupList} testId="popup-list" />
  {/if}
  {#if easyPanelStore.open}
    <LazyComponent loader={loadEasyPanel} modal onDismiss={() => (easyPanelStore.open = false)} testId="easy-panel" />
  {/if}
  {#if popUpEditorStore.open}
    {#key popUpEditorStore.sessionId}
      <LazyComponent
        loader={loadPopupEditor}
        modal
        onDismiss={() => closePopupEditorSession(popUpEditorStore.sessionId)}
        testId="popup-editor" />
    {/key}
  {/if}
  {#if loadoutModalStore.open}
    <LazyComponent
      loader={loadLoadoutModal}
      modal
      onDismiss={() => (loadoutModalStore.open = false)}
      testId="loadout-modal" />
  {/if}
  {#if irisStore.open}
    <LazyComponent loader={loadIrisModal} modal onDismiss={() => (irisStore.open = false)} testId="iris-modal" />
  {/if}
  {#if customSideBarConfigDialogStore.open}
    <LazyComponent
      loader={loadCustomSidebarConfig}
      modal
      onDismiss={() => (customSideBarConfigDialogStore.open = false)}
      testId="custom-sidebar-config" />
  {/if}
</main>
