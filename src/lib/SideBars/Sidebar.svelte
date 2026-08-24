<script lang="ts">
  import {
    CharEmotion,
    DynamicGUI,
    botMakerMode,
    selectedCharID,
    settingsOpen,
    sideBarClosing,
    sideBarStore,
    PlaygroundStore,
    QuickSettings,
    additionalHamburgerMenu,
  } from '../../ts/stores.svelte'
  import { getDatabase, setDatabase } from '../../ts/storage/database.svelte'
  import BarIcon from './BarIcon.svelte'
  import SidebarIndicator from './SidebarIndicator.svelte'
  import {
    ShellIcon,
    Settings,
    ListIcon,
    LayoutGridIcon,
    FolderIcon,
    FolderOpenIcon,
    HomeIcon,
    WrenchIcon,
    User2Icon,
  } from '@lucide/svelte'
  import { getCharImage } from '../../ts/characterImage'
  import { language } from '../../lang'
  import SidebarAvatar from './SidebarAvatar.svelte'
  import BaseRoundedButton from '../UI/BaseRoundedButton.svelte'
  import { selectSingleFile } from 'src/ts/filePicker'
  import { getFileSrc, saveAsset } from 'src/ts/globalApi.svelte'
  import { alertConfirm, alertError, alertInput, alertNormal, alertSelect } from 'src/ts/alert'
  import SideChatList from './SideChatList.svelte'
  import { sideBarSize } from 'src/ts/gui/guisize'
  import LazyComponent from '../UI/LazyComponent.svelte'
  import PluginDefinedIcon from '../Others/PluginDefinedIcon.svelte'
  import {
    createCharacterOrderFolderWithOutcome,
    moveCharacterOrderItemWithOutcome,
    updateCharacterOrderFolderWithOutcome,
    type CharacterOrderDragPosition,
    type CharacterOrderMutationHandle,
  } from 'src/ts/characterCommands'
  import {
    beginCharacterFolderImageUpload,
    captureCharacterFolderImageUploadTarget,
    clearCharacterFolderImageUpload,
    isFreshCharacterFolderImageUpload,
    resolveFreshCharacterFolderImageUploadPatch,
    type CharacterFolderImageUploadOperation,
  } from 'src/ts/server/characterFolderImageUpload'
  import { createSidebarCharacterListMemo, type SidebarCharacterListItem } from './sidebarCharList'
  import { createSidebarCharacterDragController, isSidebarCharacterDrag } from './sidebarDrag'
  import { RISU_SIDEBAR_DRAG_TYPE } from 'src/ts/dragTypes'
  import {
    characterRoutePath,
    closeSettingsRoute,
    navigate,
    openSettingsRoute as openSettingsPath,
    setCharacterSidebarViewMode,
  } from 'src/ts/router'
  import { canOpenCharacterFolder } from 'src/ts/characterFolderOpening'
  import GenerationIndicator from './GenerationIndicator.svelte'
  import PinnedChatsRail from './PinnedChatsRail.svelte'
  import {
    characterFolderHasGeneratingChat,
    characterHasGeneratingChat,
    collectExhaustedGenerationChatIds,
    collectGeneratingChatIds,
    collectPinnedChats,
    type PinnedChatItem,
  } from './sidebarMultitasking'
  import { activeChatGenerations } from 'src/ts/process/generationActivity.svelte'
  import { activeGenerationJobs, generationJobLifecycles } from 'src/ts/process/reattach'
  import { markChatRead, unreadChatIds } from 'src/ts/process/chatUnread.svelte'
  import UnreadIndicator from './UnreadIndicator.svelte'
  import { addCharacter, changeChar } from '../../ts/characters'

  const loadCharConfig = () => import('./CharConfig.svelte')
  const loadDevTool = () => import('./DevTool.svelte')
  const loadQuickSettings = () => import('../Others/QuickSettingsGUI.svelte')
  let sideBarMode = $state(0)
  let editMode = $state(false)
  let menuMode = $state(0)
  let devTool = $state(false)
  const characterFolderColors = ['red', 'green', 'blue', 'yellow', 'indigo', 'purple', 'pink', 'default'] as const
  type CharacterOrganizationActionKind = 'order' | 'folder'
  interface CharacterOrganizationActionState {
    kind: CharacterOrganizationActionKind
    label: string
    status: 'pending' | 'queued' | 'failed'
  }
  let characterOrganizationActions = $state<Record<string, CharacterOrganizationActionState>>({})
  let characterOrganizationMutationPending = $derived(
    Object.values(characterOrganizationActions).some((action) => action.status === 'pending'),
  )

  type CharacterFolderColor = (typeof characterFolderColors)[number]

  function characterFolderActionKey(folderId: string): string {
    return `folder:${folderId}`
  }

  function characterOrganizationActionMessage(state: CharacterOrganizationActionState): string {
    if (state.kind === 'folder') {
      if (state.status === 'pending') return language.characterFolderOrganizationPending(state.label)
      if (state.status === 'queued') return language.characterFolderOrganizationQueued(state.label)
      return language.characterFolderOrganizationFailed(state.label)
    }
    if (state.status === 'pending') return language.characterOrganizationPending
    if (state.status === 'queued') return language.characterOrganizationQueued
    return language.characterOrganizationFailed
  }

  function isCharacterOrganizationActionPending(key: string): boolean {
    return characterOrganizationActions[key]?.status === 'pending'
  }

  async function runCharacterOrganizationAction(
    key: string,
    kind: CharacterOrganizationActionKind,
    label: string,
    action: () => CharacterOrderMutationHandle | null | Promise<CharacterOrderMutationHandle | null>,
  ): Promise<void> {
    const conflictingActionPending =
      key === 'order'
        ? characterOrganizationMutationPending
        : isCharacterOrganizationActionPending('order') || isCharacterOrganizationActionPending(key)
    if (conflictingActionPending) return
    characterOrganizationActions[key] = { kind, label, status: 'pending' }
    try {
      const handle = await action()
      if (!handle?.applied || !handle.settlement) {
        delete characterOrganizationActions[key]
        return
      }
      const outcome = await handle.settlement
      if (outcome.status === 'accepted') {
        delete characterOrganizationActions[key]
        return
      }
      characterOrganizationActions[key] = { kind, label, status: outcome.status }
      const message = characterOrganizationActionMessage(characterOrganizationActions[key])
      if (outcome.status === 'queued') alertNormal(message)
      else alertError(message)
    } catch {
      characterOrganizationActions[key] = { kind, label, status: 'failed' }
      alertError(characterOrganizationActionMessage(characterOrganizationActions[key]))
    }
  }

  function runCharacterOrderAction(action: () => CharacterOrderMutationHandle): void {
    void runCharacterOrganizationAction('order', 'order', '', action)
  }

  async function runCharacterFolderAction(
    folderId: string,
    folderName: string,
    action: () => CharacterOrderMutationHandle | null | Promise<CharacterOrderMutationHandle | null>,
  ): Promise<void> {
    await runCharacterOrganizationAction(characterFolderActionKey(folderId), 'folder', folderName, action)
  }

  function parseAlertSelection(value: unknown, optionCount: number): number | null {
    if (typeof value !== 'string') return null

    const normalized = value.trim()
    if (!/^\d+$/.test(normalized)) return null

    const selection = Number(normalized)
    if (!Number.isSafeInteger(selection) || selection < 0 || selection >= optionCount) return null
    return selection
  }

  function localizedFolderColor(color: CharacterFolderColor): string {
    switch (color) {
      case 'red':
        return language.folderColorRed
      case 'green':
        return language.folderColorGreen
      case 'blue':
        return language.folderColorBlue
      case 'yellow':
        return language.folderColorYellow
      case 'indigo':
        return language.folderColorIndigo
      case 'purple':
        return language.folderColorPurple
      case 'pink':
        return language.folderColorPink
      case 'default':
        return language.folderColorDefault
    }
  }

  async function openFolderActions(folderId: string, folderName: string, askBeforeOpening: boolean): Promise<void> {
    if (
      isCharacterOrganizationActionPending('order') ||
      isCharacterOrganizationActionPending(characterFolderActionKey(folderId))
    ) {
      return
    }
    const folderActions = [
      language.renameFolder,
      language.changeFolderColor,
      language.changeFolderImage,
      language.askBeforeOpening(askBeforeOpening),
    ]
    const selectedAction = parseAlertSelection(
      await alertSelect(folderActions, language.folderActionsFor(folderName)),
      folderActions.length,
    )
    if (selectedAction === null) return

    if (selectedAction === 0) {
      const value = await alertInput(language.changeFolderName, [], folderName)
      if (value) {
        await runCharacterFolderAction(folderId, folderName, () =>
          updateCharacterOrderFolderWithOutcome(folderId, { name: value }),
        )
      }
      return
    }

    if (selectedAction === 1) {
      const selectedColor = parseAlertSelection(
        await alertSelect(characterFolderColors.map(localizedFolderColor), language.chooseFolderColor),
        characterFolderColors.length,
      )
      if (selectedColor === null) return
      const color = characterFolderColors[selectedColor]
      if (color) {
        await runCharacterFolderAction(folderId, folderName, () =>
          updateCharacterOrderFolderWithOutcome(folderId, { color }),
        )
      }
      return
    }

    if (selectedAction === 3) {
      await runCharacterFolderAction(folderId, folderName, () =>
        updateCharacterOrderFolderWithOutcome(folderId, { askBeforeOpening: !askBeforeOpening }),
      )
      return
    }

    const imageActions = [language.resetFolderImage, language.selectFolderImageFile]
    const selectedImageAction = parseAlertSelection(
      await alertSelect(imageActions, language.changeFolderImage),
      imageActions.length,
    )
    if (selectedImageAction === null) return
    if (selectedImageAction === 0) {
      await runCharacterFolderAction(folderId, folderName, () =>
        updateCharacterOrderFolderWithOutcome(folderId, { imgFile: null, img: '' }),
      )
    } else {
      await uploadCharacterFolderImage(folderId, folderName)
    }
  }

  function reseter() {
    menuMode = 0
    sideBarMode = 0
    editMode = false
    settingsOpen.set(false)
    CharEmotion.set({})
  }

  function openHomeRoute() {
    reseter()
    navigate('/')
  }

  function openSettingsRoute() {
    if ($settingsOpen) {
      closeSettingsRoute()
      return
    }
    reseter()
    openSettingsPath()
  }

  function openPlaygroundRoute() {
    reseter()
    navigate($selectedCharID === -1 && $PlaygroundStore !== 0 ? '/' : '/playground')
  }

  async function uploadCharacterFolderImage(folderId: string, folderName: string): Promise<void> {
    await runCharacterFolderAction(folderId, folderName, async () => {
      let folderImageUpload: CharacterFolderImageUploadOperation | null = null
      const folderImage = await selectSingleFile(['png', 'jpg', 'webp'], {
        onFileSelected: () => {
          const folderImageTarget = captureCharacterFolderImageUploadTarget({
            characterOrder: getDatabase().characterOrder,
            folderId,
          })
          if (!folderImageTarget) return
          folderImageUpload = beginCharacterFolderImageUpload(folderImageTarget)
        },
      })

      if (!folderImage || !folderImageUpload) return null
      const freshFolderImageUpload = folderImageUpload

      try {
        if (
          !isFreshCharacterFolderImageUpload({
            operation: freshFolderImageUpload,
            characterOrder: getDatabase().characterOrder,
          })
        ) {
          return null
        }

        const folderImageData = await saveAsset(folderImage.data, '', folderImage.name)

        if (
          !isFreshCharacterFolderImageUpload({
            operation: freshFolderImageUpload,
            characterOrder: getDatabase().characterOrder,
          })
        ) {
          return null
        }

        const folderImageSrc = await getFileSrc(folderImageData)

        if (
          !isFreshCharacterFolderImageUpload({
            operation: freshFolderImageUpload,
            characterOrder: getDatabase().characterOrder,
          })
        ) {
          return null
        }

        const freshImagePatch = resolveFreshCharacterFolderImageUploadPatch({
          operation: freshFolderImageUpload,
          characterOrder: getDatabase().characterOrder,
          patch: { imgFile: folderImageData, img: folderImageSrc },
        })

        if (!freshImagePatch) return null
        return updateCharacterOrderFolderWithOutcome(freshFolderImageUpload.folderId, freshImagePatch)
      } finally {
        clearCharacterFolderImageUpload(freshFolderImageUpload)
      }
    })
  }

  async function openCharacterRoute(index: number) {
    const character = getDatabase().characters?.[index]
    if (!character?.chaId) {
      changeChar(index, { reseter })
      return
    }
    reseter()
    navigate(characterRoutePath(character.chaId))
  }

  const getSidebarCharacterList = createSidebarCharacterListMemo()
  let charImages: SidebarCharacterListItem[] = $derived.by(
    () => getSidebarCharacterList(getDatabase().characterOrder, getDatabase().characters).items,
  )
  let IconRounded = $derived(getDatabase().roundIcons)
  let warningChatIds = $derived(collectExhaustedGenerationChatIds($generationJobLifecycles))
  let generatingChatIds = $derived(
    collectGeneratingChatIds($activeGenerationJobs, $activeChatGenerations, warningChatIds),
  )
  let pinnedChats = $derived(collectPinnedChats(getDatabase().characters, getDatabase().characterOrder))
  let openFolders: string[] = $state([])
  const sidebarCharacterDrag = createSidebarCharacterDragController()
  interface Props {
    openGrid?: any
    hidden?: boolean
  }

  let { openGrid = () => {}, hidden = false }: Props = $props()

  sideBarClosing.set(false)

  const inserter = (mainIndex: DragData, targetIndex: DragData) => {
    if (characterOrganizationMutationPending) return
    runCharacterOrderAction(() => moveCharacterOrderItemWithOutcome(mainIndex, targetIndex))
  }

  function characterOrderPosition(characterId: string | undefined): DragData | null {
    if (!characterId) return null
    for (const [index, entry] of getDatabase().characterOrder.entries()) {
      if (typeof entry === 'string') {
        if (entry === characterId) return { index }
        continue
      }
      const childIndex = entry.data.indexOf(characterId)
      if (childIndex >= 0) return { folder: entry.id, index: childIndex }
    }
    return null
  }

  function openPinnedChat(item: PinnedChatItem): void {
    markChatRead(item.chatId)
    reseter()
    navigate(characterRoutePath(item.characterId, item.chatId))
  }

  function openNarrowPinnedChat(item: PinnedChatItem): void {
    if (menuMode === 1) return
    openPinnedChat(item)
  }

  function characterIsGenerating(index: number): boolean {
    return characterHasGeneratingChat(getDatabase().characters?.[index], generatingChatIds)
  }

  function characterFolderIsGenerating(indexes: readonly number[]): boolean {
    return characterFolderHasGeneratingChat(indexes, getDatabase().characters, generatingChatIds)
  }

  function characterHasReattachWarning(index: number): boolean {
    return characterHasGeneratingChat(getDatabase().characters?.[index], warningChatIds)
  }

  function characterFolderHasReattachWarning(indexes: readonly number[]): boolean {
    return characterFolderHasGeneratingChat(indexes, getDatabase().characters, warningChatIds)
  }

  function characterHasUnreadChat(index: number): boolean {
    return characterHasGeneratingChat(getDatabase().characters?.[index], $unreadChatIds)
  }

  function characterFolderHasUnreadChat(indexes: readonly number[]): boolean {
    return characterFolderHasGeneratingChat(indexes, getDatabase().characters, $unreadChatIds)
  }

  function sidebarItemPosition(item: SidebarCharacterListItem): DragData | null {
    if (item.type === 'normal') {
      return characterOrderPosition(getDatabase().characters[item.index]?.chaId)
    }
    const index = getDatabase().characterOrder.findIndex((entry) => typeof entry !== 'string' && entry.id === item.id)
    return index < 0 ? null : { index }
  }

  function positionAfter(position: DragData | null): DragData | null {
    if (!position) return null
    return position.folder ? { folder: position.folder, index: position.index + 1 } : { index: position.index + 1 }
  }

  async function requestCharacterFolderOpening(
    characterFolder: Extract<SidebarCharacterListItem, { type: 'folder' }>,
  ): Promise<boolean> {
    return canOpenCharacterFolder({
      folderId: characterFolder.id,
      askBeforeOpening: characterFolder.askBeforeOpening,
      confirm: () => alertConfirm(language.confirmFolderOpening(characterFolder.name)),
    })
  }

  async function toggleCharacterFolder(
    characterFolder: Extract<SidebarCharacterListItem, { type: 'folder' }>,
  ): Promise<void> {
    const openIndex = openFolders.indexOf(characterFolder.id)
    if (openIndex >= 0) {
      openFolders.splice(openIndex, 1)
      openFolders = openFolders
      return
    }

    if (!(await requestCharacterFolderOpening(characterFolder))) return
    if (!openFolders.includes(characterFolder.id)) {
      openFolders.push(characterFolder.id)
      openFolders = openFolders
    }
  }

  async function scrollToActiveCharacter() {
    const selectedId = $selectedCharID
    if (selectedId === -1) return

    const characterId = getDatabase().characters[selectedId]?.chaId
    if (!characterId) return

    let targetFolder: Extract<SidebarCharacterListItem, { type: 'folder' }> | null = null

    for (const item of charImages) {
      if (item.type === 'folder') {
        const foundChar = item.folder.find((c) => getDatabase().characters[c.index]?.chaId === characterId)
        if (foundChar) {
          targetFolder = item
          break
        }
      }
    }

    if (targetFolder && !openFolders.includes(targetFolder.id)) {
      if (!(await requestCharacterFolderOpening(targetFolder))) return
      openFolders.push(targetFolder.id)
      openFolders = openFolders
    }

    setTimeout(() => {
      const activeElement = document.querySelector(`[data-char-id="${characterId}"]`)
      if (activeElement) {
        activeElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        })
      }
    }, 100)
  }

  $effect(() => {
    if (typeof window === 'undefined') return

    const handler = () => {
      void scrollToActiveCharacter()
    }

    window.addEventListener('scrollToActiveCharacter', handler)

    return () => {
      window.removeEventListener('scrollToActiveCharacter', handler)
    }
  })

  const createFolder = (mainIndex: DragData, targetIndex: DragData) => {
    if (characterOrganizationMutationPending) return
    runCharacterOrderAction(() =>
      createCharacterOrderFolderWithOutcome(mainIndex, targetIndex, undefined, language.newCharacterFolderName),
    )
  }

  type DragEv = DragEvent & {
    currentTarget: EventTarget & HTMLDivElement
  }
  type DragData = CharacterOrderDragPosition
  const avatarDragStart = (ind: DragData, e: DragEv) => {
    if (characterOrganizationMutationPending) return
    if (!sidebarCharacterDrag.begin(ind, getDatabase().characterOrder)) return

    e.dataTransfer.setData('text/plain', '')
    e.dataTransfer.setData(RISU_SIDEBAR_DRAG_TYPE, 'true')
    const avatar = e.currentTarget.querySelector('.avatar')
    if (avatar) {
      e.dataTransfer.setDragImage(avatar, 10, 10)
    }
  }

  const avatarDragOver = (e: DragEv) => {
    if (!isSidebarCharacterDrag(e.dataTransfer.types)) return

    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const avatarDrop = (ind: DragData, e: DragEv) => {
    if (characterOrganizationMutationPending) return
    const drag = sidebarCharacterDrag.consume(e.dataTransfer.types, getDatabase().characterOrder)
    if (!drag) return

    e.preventDefault()
    try {
      createFolder(drag, ind)
    } catch (error) {}
  }

  const dropZoneDragOver = (e: DragEv) => {
    if (characterOrganizationMutationPending) return
    if (!isSidebarCharacterDrag(e.dataTransfer.types)) return

    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    e.currentTarget.classList.add('bg-green-500')
  }

  const consumeDropZoneDrag = (e: DragEv) => {
    e.currentTarget.classList.remove('bg-green-500')
    if (characterOrganizationMutationPending) return null
    const drag = sidebarCharacterDrag.consume(e.dataTransfer.types, getDatabase().characterOrder)
    if (!drag) return null

    e.preventDefault()
    return drag
  }

  const preventAll = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
    return false
  }

  const preventCharacterDrag = (e: DragEv) => {
    if (!isSidebarCharacterDrag(e.dataTransfer.types)) return
    return preventAll(e)
  }
</script>

{#if getDatabase().menuSideBar}
  <div
    class="h-full w-20 min-w-20 flex-col items-center bg-bgcolor text-textcolor shadow-lg relative rs-sidebar"
    class:editMode
    class:risu-sub-sidebar={$sideBarClosing}
    class:risu-sub-sidebar-close={$sideBarClosing}
    class:hidden
    class:flex={!hidden}>
    <button
      class="flex items-center justify-center py-2 flex-col gap-1 w-full mt-4"
      class:text-textcolor2={!($selectedCharID < 0 && $PlaygroundStore === 0 && !$settingsOpen)}
      onclick={openHomeRoute}>
      <HomeIcon />
      <span class="text-xs">{language.home}</span>
    </button>
    <button
      class="flex items-center justify-center py-2 flex-col gap-1 w-full"
      class:text-textcolor2={!$settingsOpen}
      onclick={openSettingsRoute}>
      <Settings />
      <span class="text-xs">{language.settings}</span>
    </button>
    <button
      class="flex items-center justify-center py-2 flex-col gap-1 w-full"
      class:text-textcolor2={!($selectedCharID >= 0)}
      onclick={() => {
        reseter()
        openGrid()
      }}>
      <User2Icon />
      <span class="text-xs">{language.character}</span>
    </button>
    <button
      class="flex items-center justify-center py-2 flex-col gap-1 w-full"
      class:text-textcolor2={!($selectedCharID < 0 && $PlaygroundStore !== 0)}
      onclick={openPlaygroundRoute}>
      <ShellIcon />
      <span class="text-xs">{language.playground.playground}</span>
    </button>
    <PinnedChatsRail
      items={pinnedChats}
      {generatingChatIds}
      {warningChatIds}
      unreadChatIds={$unreadChatIds}
      rounded={IconRounded}
      onOpen={openPinnedChat} />
  </div>
{:else}
  <div
    class="h-full w-20 min-w-20 flex-col items-center bg-bgcolor text-textcolor shadow-lg relative rs-sidebar"
    class:editMode
    class:risu-sub-sidebar={$sideBarClosing}
    class:risu-sub-sidebar-close={$sideBarClosing}
    class:hidden
    class:flex={!hidden}>
    {#if !getDatabase().hamburgerButtonBottom}
      <button
        aria-label={language.menu}
        aria-expanded={menuMode === 1}
        class="flex h-8 min-h-8 w-14 min-w-14 cursor-pointer text-white mt-2 items-center justify-center rounded-md bg-textcolor2 transition-colors hover:bg-blue-500"
        onclick={() => {
          menuMode = 1 - menuMode
        }}
        ><ListIcon />
      </button>
      <div class="mt-2 border-b border-b-selected w-full relative text-white">
        {#if menuMode === 1}
          <div
            class="absolute w-20 min-w-20 flex border-b-selected border-b bg-bgcolor flex-col items-center pt-2 rounded-b-md z-20 pb-2">
            <BarIcon onClick={openSettingsRoute} ariaLabel={language.settings}><Settings /></BarIcon>
            <div class="mt-2"></div>
            <BarIcon onClick={openHomeRoute} ariaLabel={language.home}><HomeIcon /></BarIcon>
            <div class="mt-2"></div>
            <BarIcon onClick={openPlaygroundRoute} ariaLabel={language.playground.playground}><ShellIcon /></BarIcon>
            {#each additionalHamburgerMenu as menu}
              <div class="mt-2"></div>
              <BarIcon
                ariaLabel={menu.name}
                onClick={() => {
                  reseter()
                  menu.callback()
                }}>
                <PluginDefinedIcon ico={menu} />
              </BarIcon>
            {/each}
            <div class="mt-2"></div>
            <BarIcon
              ariaLabel={language.grid}
              onClick={() => {
                reseter()
                openGrid()
              }}><LayoutGridIcon /></BarIcon>
          </div>
        {/if}
      </div>
    {/if}
    <PinnedChatsRail
      items={pinnedChats}
      {generatingChatIds}
      {warningChatIds}
      unreadChatIds={$unreadChatIds}
      rounded={IconRounded}
      onOpen={openNarrowPinnedChat}
      isInert={menuMode === 1} />
    <div
      class="flex grow w-full flex-col items-center overflow-x-hidden overflow-y-auto pr-0"
      data-risu-sidebar-character-controls
      inert={menuMode === 1}>
      {#each Object.entries(characterOrganizationActions).filter(([, action]) => action.status === 'failed') as [actionKey, action] (actionKey)}
        <span
          class="w-16 px-1 py-0.5 text-center text-[10px] leading-tight text-textcolor2"
          data-risu-character-organization-status={action.status}
          data-risu-character-organization-key={actionKey}
          role="status"
          aria-live="polite"
          title={characterOrganizationActionMessage(action)}>
          {language.mutationStatusFailed}
        </span>
      {/each}
      <div
        class="h-4 min-h-4 w-14"
        role="listitem"
        ondragover={dropZoneDragOver}
        ondragleave={(e) => {
          e.currentTarget.classList.remove('bg-green-500')
        }}
        ondrop={(e) => {
          const da = consumeDropZoneDrag(e)
          const target = sidebarItemPosition(charImages[0]) ?? { index: 0 }
          if (da && target) {
            inserter(da, target)
          }
        }}
        ondragenter={preventCharacterDrag}>
      </div>
      {#each charImages as char}
        <div
          class="group relative flex items-center px-2"
          role="listitem"
          draggable={!characterOrganizationMutationPending}
          data-risu-character-organization-status={char.type === 'folder'
            ? (characterOrganizationActions[characterFolderActionKey(char.id)]?.status ??
              characterOrganizationActions.order?.status ??
              'idle')
            : (characterOrganizationActions.order?.status ?? 'idle')}
          aria-busy={char.type === 'folder'
            ? isCharacterOrganizationActionPending(characterFolderActionKey(char.id)) ||
              isCharacterOrganizationActionPending('order')
            : isCharacterOrganizationActionPending('order')}
          ondragstart={(e) => {
            const position = sidebarItemPosition(char)
            if (position) avatarDragStart(position, e)
          }}
          ondragend={sidebarCharacterDrag.clear}
          ondragover={avatarDragOver}
          ondrop={(e) => {
            const position = sidebarItemPosition(char)
            if (position) avatarDrop(position, e)
          }}
          ondragenter={preventCharacterDrag}>
          <SidebarIndicator isActive={char.type === 'normal' && $selectedCharID === char.index && sideBarMode !== 1} />
          <div>
            {#if char.type === 'normal'}
              <SidebarAvatar
                src={char.img ? getCharImage(char.img, 'plain') : '/none.webp'}
                size="56"
                rounded={IconRounded}
                name={char.name}
                chaId={getDatabase().characters[char.index]?.chaId}
                onClick={() => openCharacterRoute(char.index)} />
            {:else if char.type === 'folder'}
              {#key char.color}
                {#key char.name}
                  <SidebarAvatar
                    src="slot"
                    size="56"
                    rounded={IconRounded}
                    bordered
                    name={char.name}
                    color={char.color}
                    backgroundimg={char.img ? getCharImage(char.img, 'plain') : ''}
                    oncontextmenu={(e) => {
                      e.preventDefault()
                      void openFolderActions(char.id, char.name, char.askBeforeOpening)
                    }}
                    onClick={() => {
                      if (char.type === 'folder') void toggleCharacterFolder(char)
                    }}>
                    {#if getDatabase().showFolderName}
                      <div class="h-full w-full flex justify-center items-center">
                        <span class="hyphens-auto truncate font-bold">{char.name}</span>
                      </div>
                    {:else if openFolders.includes(char.id)}
                      <FolderOpenIcon />
                    {:else}
                      <FolderIcon />
                    {/if}
                  </SidebarAvatar>
                {/key}
              {/key}
            {/if}
          </div>
          {#if char.type === 'normal' && characterHasReattachWarning(char.index)}
            <GenerationIndicator
              state="warning"
              label={language.generationReattachFailure.sidebarWarning(char.name)}
              onActivate={() => openCharacterRoute(char.index)} />
          {:else if char.type === 'folder' && !openFolders.includes(char.id) && characterFolderHasReattachWarning(char.folder.map((item) => item.index))}
            <GenerationIndicator
              state="warning"
              label={language.generationReattachFailure.sidebarWarning(char.name)}
              onActivate={() => {
                if (char.type === 'folder') void toggleCharacterFolder(char)
              }} />
          {:else if char.type === 'normal' && characterIsGenerating(char.index)}
            <GenerationIndicator
              label={`${language.generatingMessage}: ${char.name}`}
              onActivate={() => openCharacterRoute(char.index)} />
          {:else if char.type === 'folder' && !openFolders.includes(char.id) && characterFolderIsGenerating(char.folder.map((item) => item.index))}
            <GenerationIndicator
              label={`${language.generatingMessage}: ${char.name}`}
              onActivate={() => {
                if (char.type === 'folder') void toggleCharacterFolder(char)
              }} />
          {:else if char.type === 'normal' && characterHasUnreadChat(char.index)}
            <UnreadIndicator
              label={`${language.newMessage}: ${char.name}`}
              onActivate={() => openCharacterRoute(char.index)} />
          {:else if char.type === 'folder' && !openFolders.includes(char.id) && characterFolderHasUnreadChat(char.folder.map((item) => item.index))}
            <UnreadIndicator
              label={`${language.newMessage}: ${char.name}`}
              onActivate={() => {
                if (char.type === 'folder') void toggleCharacterFolder(char)
              }} />
          {/if}
        </div>
        {#if char.type === 'folder' && openFolders.includes(char.id)}
          {#key char.color}
            <div class="p-1 flex flex-col items-center py-1 mt-1 rounded-lg relative">
              <div
                class="absolute top-0 left-1 border border-selected w-full h-full rounded-lg z-0 {char.color === 'red'
                  ? 'bg-red-700/20'
                  : char.color === 'yellow'
                    ? 'bg-yellow-700/20'
                    : char.color === 'green'
                      ? 'bg-green-700/20'
                      : char.color === 'blue'
                        ? 'bg-blue-700/20'
                        : char.color === 'indigo'
                          ? 'bg-indigo-700/20'
                          : char.color === 'purple'
                            ? 'bg-purple-700/20'
                            : char.color === 'pink'
                              ? 'bg-pink-700/20'
                              : 'bg-darkbg/20'}">
              </div>
              <div
                class="h-4 min-h-4 w-14 relative z-10"
                role="listitem"
                ondragover={dropZoneDragOver}
                ondragleave={(e) => {
                  e.currentTarget.classList.remove('bg-green-500')
                }}
                ondrop={(e) => {
                  const da = consumeDropZoneDrag(e)
                  if (da && char.type === 'folder') {
                    inserter(da, { index: 0, folder: char.id })
                  }
                }}
                ondragenter={preventCharacterDrag}>
              </div>
              {#each char.folder as char2}
                <div
                  class="group relative flex items-center px-2 z-10"
                  role="listitem"
                  draggable={!characterOrganizationMutationPending}
                  data-risu-character-organization-status={characterOrganizationActions.order?.status ?? 'idle'}
                  aria-busy={isCharacterOrganizationActionPending('order')}
                  ondragstart={(e) => {
                    const position = characterOrderPosition(getDatabase().characters[char2.index]?.chaId)
                    if (position) avatarDragStart(position, e)
                  }}
                  ondragend={sidebarCharacterDrag.clear}
                  ondragover={avatarDragOver}
                  ondrop={(e) => {
                    const position = characterOrderPosition(getDatabase().characters[char2.index]?.chaId)
                    if (position) avatarDrop(position, e)
                  }}
                  ondragenter={preventCharacterDrag}>
                  <SidebarIndicator isActive={$selectedCharID === char2.index && sideBarMode !== 1} />
                  <div>
                    <SidebarAvatar
                      src={char2.img ? getCharImage(char2.img, 'plain') : '/none.webp'}
                      size="56"
                      rounded={IconRounded}
                      name={char2.name}
                      chaId={getDatabase().characters[char2.index]?.chaId}
                      onClick={() => openCharacterRoute(char2.index)} />
                  </div>
                  {#if characterHasReattachWarning(char2.index)}
                    <GenerationIndicator
                      state="warning"
                      label={language.generationReattachFailure.sidebarWarning(char2.name)}
                      onActivate={() => openCharacterRoute(char2.index)} />
                  {:else if characterIsGenerating(char2.index)}
                    <GenerationIndicator
                      label={`${language.generatingMessage}: ${char2.name}`}
                      onActivate={() => openCharacterRoute(char2.index)} />
                  {:else if characterHasUnreadChat(char2.index)}
                    <UnreadIndicator
                      label={`${language.newMessage}: ${char2.name}`}
                      onActivate={() => openCharacterRoute(char2.index)} />
                  {/if}
                </div>
                <div
                  class="h-4 min-h-4 w-14 relative z-20"
                  role="listitem"
                  ondragover={dropZoneDragOver}
                  ondragleave={(e) => {
                    e.currentTarget.classList.remove('bg-green-500')
                  }}
                  ondrop={(e) => {
                    const da = consumeDropZoneDrag(e)
                    const target = positionAfter(characterOrderPosition(getDatabase().characters[char2.index]?.chaId))
                    if (da && target) {
                      inserter(da, target)
                    }
                  }}
                  ondragenter={preventCharacterDrag}>
                </div>
              {/each}
            </div>
          {/key}
        {/if}
        <div
          class="h-4 min-h-4 w-14"
          role="listitem"
          ondragover={dropZoneDragOver}
          ondragleave={(e) => {
            e.currentTarget.classList.remove('bg-green-500')
          }}
          ondrop={(e) => {
            const da = consumeDropZoneDrag(e)
            const target = positionAfter(sidebarItemPosition(char))
            if (da && target) {
              inserter(da, target)
            }
          }}
          ondragenter={preventCharacterDrag}>
        </div>
      {/each}
      <div class="flex flex-col items-center gap-2 px-2">
        <BaseRoundedButton
          ariaLabel={language.addCharacter}
          onClick={async () => {
            addCharacter({ reseter })
          }}
          ><svg viewBox="0 0 24 24" width="1.2em" height="1.2em"
            ><path
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg
          ></BaseRoundedButton>
      </div>
    </div>
    {#if getDatabase().hamburgerButtonBottom}
      <div class="border-t border-t-selected w-full relative text-white">
        {#if menuMode === 1}
          <div
            class="absolute bottom-full w-20 min-w-20 flex border-t-selected border-t bg-bgcolor flex-col items-center pt-2 rounded-t-md z-20 pb-2">
            <BarIcon onClick={openSettingsRoute} ariaLabel={language.settings}><Settings /></BarIcon>
            <div class="mt-2"></div>
            <BarIcon onClick={openHomeRoute} ariaLabel={language.home}><HomeIcon /></BarIcon>
            <div class="mt-2"></div>
            <BarIcon onClick={openPlaygroundRoute} ariaLabel={language.playground.playground}><ShellIcon /></BarIcon>
            {#each additionalHamburgerMenu as menu}
              <div class="mt-2"></div>
              <BarIcon
                ariaLabel={menu.name}
                onClick={() => {
                  reseter()
                  menu.callback()
                }}>
                <PluginDefinedIcon ico={menu} />
              </BarIcon>
            {/each}
            <div class="mt-2"></div>
            <BarIcon
              ariaLabel={language.grid}
              onClick={() => {
                reseter()
                openGrid()
              }}><LayoutGridIcon /></BarIcon>
          </div>
        {/if}
      </div>
      <button
        aria-label={language.menu}
        aria-expanded={menuMode === 1}
        class="flex h-8 min-h-8 w-14 min-w-14 cursor-pointer text-white mb-2 mt-2 items-center justify-center rounded-md bg-textcolor2 transition-colors hover:bg-blue-500"
        onclick={() => {
          menuMode = 1 - menuMode
        }}
        ><ListIcon />
      </button>
    {/if}
  </div>
{/if}
<div
  class="setting-area h-full flex-col overflow-y-auto overflow-x-hidden bg-darkbg py-6 text-textcolor max-h-full"
  class:risu-sidebar={!$sideBarClosing}
  class:w-96={$sideBarSize === 0}
  class:w-110={$sideBarSize === 1}
  class:w-124={$sideBarSize === 2}
  class:w-138={$sideBarSize === 3}
  class:risu-sidebar-close={$sideBarClosing}
  class:min-w-96={!$DynamicGUI && $sideBarSize === 0}
  class:min-w-110={!$DynamicGUI && $sideBarSize === 1}
  class:min-w-124={!$DynamicGUI && $sideBarSize === 2}
  class:min-w-138={!$DynamicGUI && $sideBarSize === 3}
  class:px-2={$DynamicGUI}
  class:px-4={!$DynamicGUI}
  class:dynamic-sidebar={$DynamicGUI}
  class:hidden
  class:flex={!hidden}
  onanimationend={() => {
    if ($sideBarClosing) {
      $sideBarClosing = false
      sideBarStore.set(false)
    }
  }}>
  {#if sideBarMode === 0}
    {#if $selectedCharID < 0 || $settingsOpen}
      <div>
        <h1 class="text-xl">Welcome to RisuAI!</h1>
        <span class="text-xs text-textcolor2">Select a bot to start chatting</span>
      </div>
    {:else if getDatabase().characters[$selectedCharID]?.chaId === '§playground'}
      <SideChatList chara={getDatabase().characters[$selectedCharID]} />
    {:else}
      <div class="w-full h-8 min-h-8 border-l border-b border-r border-selected relative bottom-6 rounded-b-md flex">
        <button
          onclick={() => {
            devTool = false
            setCharacterSidebarViewMode('chat')
          }}
          data-risu-sidebar-tab="chat"
          data-risu-sidebar-tab-active={!$botMakerMode && !devTool ? 'true' : 'false'}
          aria-current={!$botMakerMode && !devTool ? 'true' : undefined}
          class="grow border-r border-r-selected rounded-bl-md"
          class:text-textcolor2={$botMakerMode || devTool}>{language.Chat}</button>
        <button
          onclick={() => {
            devTool = false
            setCharacterSidebarViewMode('character')
          }}
          data-risu-sidebar-tab="character"
          data-risu-sidebar-tab-active={$botMakerMode && !devTool ? 'true' : 'false'}
          aria-current={$botMakerMode && !devTool ? 'true' : undefined}
          class="grow rounded-br-md"
          class:text-textcolor2={!$botMakerMode || devTool}>{language.character}</button>
        {#if getDatabase().enableDevTools}
          <button
            aria-label={language.enableDevTools}
            aria-pressed={devTool}
            onclick={() => {
              devTool = true
            }}
            class="border-l border-l-selected rounded-br-md px-1"
            class:text-textcolor2={!devTool}>
            <WrenchIcon size={18} />
          </button>
        {/if}
      </div>
      {#if QuickSettings.open}
        <LazyComponent loader={loadQuickSettings} fill testId="quick-settings" />
      {:else if devTool}
        <LazyComponent loader={loadDevTool} fill testId="developer-tools" />
      {:else if $botMakerMode}
        <div class="contents" data-risu-sidebar-panel="character">
          <LazyComponent loader={loadCharConfig} fill testId="character-editor" />
        </div>
      {:else}
        <div class="contents" data-risu-sidebar-panel="chat">
          <SideChatList chara={getDatabase().characters[$selectedCharID]} />
        </div>
      {/if}
    {/if}
  {/if}
</div>

{#if $DynamicGUI}
  <button
    type="button"
    aria-label={language.close}
    class="grow h-full min-w-12"
    class:hidden
    onclick={() => {
      if ($sideBarClosing) {
        return
      }
      $sideBarClosing = true
    }}
    class:sidebar-dark-animation={!$sideBarClosing}
    class:sidebar-dark-close-animation={$sideBarClosing}>
  </button>
{/if}

<style>
  .editMode {
    min-width: 6rem;
  }
  @keyframes sidebar-transition {
    from {
      width: 0rem;
    }
    to {
      width: var(--sidebar-size);
    }
  }
  @keyframes sidebar-transition-close {
    from {
      width: var(--sidebar-size);
      right: 0rem;
    }
    to {
      width: 0rem;
      right: 10rem;
    }
  }
  @keyframes sidebar-transition-non-dynamic {
    from {
      width: 0rem;
      min-width: 0rem;
    }
    to {
      width: var(--sidebar-size);
      min-width: var(--sidebar-size);
    }
  }
  @keyframes sidebar-transition-close-non-dynamic {
    from {
      width: var(--sidebar-size);
      min-width: var(--sidebar-size);
      right: 0rem;
    }
    to {
      width: 0rem;
      min-width: 0rem;
      right: 3rem;
    }
  }
  @keyframes sub-sidebar-transition {
    from {
      width: 0rem;
      min-width: 0rem;
    }
    to {
      width: 5rem;
      min-width: 5rem;
    }
  }
  @keyframes sub-sidebar-transition-close {
    from {
      width: 5rem;
      min-width: 5rem;
      max-width: 5rem;
      right: 0rem;
    }
    to {
      width: 0rem;
      min-width: 0rem;
      max-width: 0rem;
      right: 10rem;
    }
  }
  @keyframes sidebar-dark-animation {
    from {
      background-color: rgba(0, 0, 0, 0) !important;
    }
    to {
      background-color: rgba(0, 0, 0, 0.5) !important;
    }
  }
  @keyframes sidebar-dark-closing-animation {
    from {
      background-color: rgba(0, 0, 0, 0.5) !important;
    }
    to {
      background-color: rgba(0, 0, 0, 0) !important;
    }
  }

  .risu-sidebar:not(.dynamic-sidebar) {
    animation-name: sidebar-transition-non-dynamic;
    animation-duration: var(--risu-animation-speed);
  }
  .risu-sidebar-close:not(.dynamic-sidebar) {
    animation-name: sidebar-transition-close-non-dynamic;
    animation-duration: var(--risu-animation-speed);
    position: relative;
  }
  .risu-sidebar.dynamic-sidebar {
    animation-name: sidebar-transition;
    animation-duration: var(--risu-animation-speed);
  }
  .risu-sidebar-close.dynamic-sidebar {
    animation-name: sidebar-transition-close;
    animation-duration: var(--risu-animation-speed);
    position: relative;
    right: 3rem;
  }

  .risu-sub-sidebar {
    animation-name: sub-sidebar-transition;
    animation-duration: var(--risu-animation-speed);
  }
  .risu-sub-sidebar-close {
    animation-name: sub-sidebar-transition-close;
    animation-duration: var(--risu-animation-speed);
    position: relative;
  }
  .sidebar-dark-animation {
    animation-name: sidebar-dark-transition;
    animation-duration: var(--risu-animation-speed);
    background-color: rgba(0, 0, 0, 0.5);
  }
  .sidebar-dark-close-animation {
    animation-name: sidebar-dark-closing-transition;
    animation-duration: var(--risu-animation-speed);
    background-color: rgba(0, 0, 0, 0);
  }
</style>
