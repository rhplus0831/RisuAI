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
    loadedStore,
    alertStore,
    LoadingStatusState,
    bookmarkListOpen,
    popupStore,
    easyPanelStore,
    popUpEditorStore,
    loadoutModalStore,
    irisStore,
    customSideBarConfigDialogStore,
    PlaygroundStore,
    selectedCharID,
    SettingsMenuIndex,
  } from './ts/stores.svelte'
  import Sidebar from './lib/SideBars/Sidebar.svelte'
  import ChatScreen from './lib/ChatScreens/ChatScreen.svelte'
  import AlertComp from './lib/Others/AlertComp.svelte'
  import RealmPopUp from './lib/UI/Realm/RealmPopUp.svelte'
  import GridChars from './lib/Others/GridCatalog.svelte'
  import BookmarkList from './lib/Others/BookmarkList.svelte'
  import Settings from './lib/Setting/Settings.svelte'
  import { showRealmInfoStore, importCharacterProcess } from './ts/characterCards'
  import { importPreset } from './ts/storage/database.svelte'
  import { getResourceDatabase as getDatabase } from './ts/server/resourceState.svelte'
  import { language } from './lang'
  import SavePopupIconComp from './lib/Others/SavePopupIcon.svelte'
  import Botpreset from './lib/Setting/botpreset.svelte'
  import ListedPersona from './lib/Setting/listedPersona.svelte'
  import ChatGenerationTogglePresetDialog from './lib/SideBars/ChatGenerationTogglePresetDialog.svelte'
  import CustomGUISettingMenu from './lib/Setting/Pages/CustomGUISettingMenu.svelte'
  import { checkCharOrder } from './ts/globalApi.svelte'
  import { ArrowUpIcon, GlobeIcon, PlusIcon } from '@lucide/svelte'
  import { hypaV3ModalOpen, hypaV3ProgressStore } from './ts/stores.svelte'
  import HypaV3Modal from './lib/Others/HypaV3Modal.svelte'
  import HypaV3Progress from './lib/Others/HypaV3Progress.svelte'
  import PopupList from './lib/UI/PopupList.svelte'
  import EasyPanel from './lib/Others/ProTools/EasyPanel.svelte'
  import sendSound from './etc/send.mp3'
  import PopupEditor from './lib/Others/PopupEditor.svelte'
  import LoadoutModal from './lib/Others/LoadoutModal.svelte'
  import IrisModal from './lib/Others/IrisModal.svelte'
  import CustomSidebarConfig from './lib/Others/CustomSidebarConfig.svelte'
  import { importRisuModuleData } from './ts/process/modules'
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

  let aprilFools = $state(new Date().getMonth() === 3 && new Date().getDate() === 1)
  let aprilFoolsPage = $state(0)
  let keepingSessionAlive = $state(false)

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
    if (!$loadedStore) return
    const route = $currentRoute
    if (consumeStateDrivenRouteUpdate()) return
    untrack(() => {
      void applyRouteToStores(route)
    })
  })

  $effect(() => {
    if (!$loadedStore) return

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
        await importPreset({ name: file.name, data })
      } else if (name.endsWith('.risum')) {
        const data = new Uint8Array(await file.arrayBuffer())
        await importRisuModuleData(data)
        return
      } else {
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
  {:else if !$loadedStore}
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
    <CustomGUISettingMenu />
  {:else if $settingsOpen}
    <Settings />
  {:else if $currentRoute.kind === 'grid'}
    <GridChars endGrid={closeGridRoute} />
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
    <AlertComp />
  {/if}
  {#if $showRealmInfoStore}
    <RealmPopUp bind:openedData={$showRealmInfoStore} />
  {/if}
  {#if $openPresetList}
    <Botpreset
      mode={presetListModalStore.mode}
      kind={presetListModalStore.kind}
      target={presetListModalStore.target}
      close={closePresetListModal} />
  {/if}
  {#if $openPersonaList}
    <ListedPersona
      mode={personaListModalStore.mode}
      target={personaListModalStore.target}
      close={closePersonaListModal} />
  {/if}
  {#if $openChatGenerationTogglePresetList}
    <ChatGenerationTogglePresetDialog
      target={chatGenerationTogglePresetListModalStore.target}
      close={closeChatGenerationTogglePresetListModal} />
  {/if}
  {#if $bookmarkListOpen}
    <BookmarkList />
  {/if}
  {#if $hypaV3ModalOpen}
    <HypaV3Modal />
  {/if}
  <SavePopupIconComp />
  {#if $hypaV3ProgressStore.open}
    <HypaV3Progress />
  {/if}
  {#if popupStore.children}
    <PopupList />
  {/if}
  {#if easyPanelStore.open}
    <EasyPanel />
  {/if}
  {#if popUpEditorStore.open}
    {#key popUpEditorStore.sessionId}
      <PopupEditor />
    {/key}
  {/if}
  {#if loadoutModalStore.open}
    <LoadoutModal />
  {/if}
  {#if irisStore.open}
    <IrisModal />
  {/if}
  {#if customSideBarConfigDialogStore.open}
    <CustomSidebarConfig />
  {/if}
</main>
