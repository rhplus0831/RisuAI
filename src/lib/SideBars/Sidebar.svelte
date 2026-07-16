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
    EllipsisVerticalIcon,
    ListTreeIcon,
  } from '@lucide/svelte'
  import { addCharacter, changeChar, getCharImage } from '../../ts/characters'
  import CharConfig from './CharConfig.svelte'
  import { language } from '../../lang'
  import SidebarAvatar from './SidebarAvatar.svelte'
  import BaseRoundedButton from '../UI/BaseRoundedButton.svelte'
  import { selectSingleFile } from 'src/ts/util'
  import { getFileSrc, saveAsset } from 'src/ts/globalApi.svelte'
  import { alertInput, alertSelect } from 'src/ts/alert'
  import SideChatList from './SideChatList.svelte'
  import { sideBarSize } from 'src/ts/gui/guisize'
  import DevTool from './DevTool.svelte'
  import QuickSettingsGui from '../Others/QuickSettingsGUI.svelte'
  import PluginDefinedIcon from '../Others/PluginDefinedIcon.svelte'
  import {
    createCharacterOrderFolder,
    moveCharacterOrderItem,
    updateCharacterOrderFolder,
    type CharacterOrderDragPosition,
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
  import {
    createSidebarCharacterDragController,
    isSidebarCharacterDrag,
    SIDEBAR_CHARACTER_DRAG_TYPE,
  } from './sidebarDrag'
  import {
    resolveSidebarOrganizerCreateFolder,
    resolveSidebarOrganizerMoveOut,
    resolveSidebarOrganizerMoveToFolder,
    resolveSidebarOrganizerStep,
    sidebarOrganizerFolderPartnerIds,
    sidebarOrganizerFolderTargetIds,
    type SidebarOrganizerItemReference,
    type SidebarOrganizerMove,
  } from './sidebarOrganizer'
  import {
    characterRoutePath,
    closeSettingsRoute,
    navigate,
    openSettingsRoute as openSettingsPath,
    setCharacterSidebarViewMode,
  } from 'src/ts/router'
  let sideBarMode = $state(0)
  let editMode = $state(false)
  let menuMode = $state(0)
  let devTool = $state(false)
  const characterFolderColors = ['red', 'green', 'blue', 'yellow', 'indigo', 'purple', 'pink', 'default'] as const

  type CharacterFolderColor = (typeof characterFolderColors)[number]

  type CharacterOrganizerAction =
    | { kind: 'move'; direction: 'up' | 'down'; label: string }
    | { kind: 'moveToFolder'; label: string }
    | { kind: 'moveOut'; label: string }
    | { kind: 'createFolder'; label: string }

  type FolderAction =
    | { kind: 'move'; direction: 'up' | 'down'; label: string }
    | { kind: 'rename'; label: string }
    | { kind: 'color'; label: string }
    | { kind: 'image'; label: string }

  function parseAlertSelection(value: unknown, optionCount: number): number | null {
    if (typeof value !== 'string') return null

    const normalized = value.trim()
    if (!/^\d+$/.test(normalized)) return null

    const selection = Number(normalized)
    if (!Number.isSafeInteger(selection) || selection < 0 || selection >= optionCount) return null
    return selection
  }

  function characterNameById(characterId: string): string {
    const character = getDatabase().characters.find((candidate) => candidate?.chaId === characterId)
    return character?.displayName?.trim() || character?.name?.trim() || characterId
  }

  function folderNameById(folderId: string): string {
    const entry = getDatabase().characterOrder.find(
      (candidate) => typeof candidate !== 'string' && candidate?.id === folderId,
    )
    return typeof entry === 'string' || !entry ? folderId : entry.name || folderId
  }

  function runOrganizerMove(move: SidebarOrganizerMove | null): boolean {
    return move ? moveCharacterOrderItem(move.source, move.target) : false
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

  async function openCharacterOrganizerActions(characterId: string, characterName: string) {
    const reference: SidebarOrganizerItemReference = { kind: 'character', characterId }
    const order = getDatabase().characterOrder
    const actions: CharacterOrganizerAction[] = []

    if (resolveSidebarOrganizerStep(order, reference, 'up')) {
      actions.push({ kind: 'move', direction: 'up', label: language.moveUp })
    }
    if (resolveSidebarOrganizerStep(order, reference, 'down')) {
      actions.push({ kind: 'move', direction: 'down', label: language.moveDown })
    }
    if (sidebarOrganizerFolderTargetIds(order, reference).length > 0) {
      actions.push({ kind: 'moveToFolder', label: language.moveToFolder })
    }
    if (resolveSidebarOrganizerMoveOut(order, reference)) {
      actions.push({ kind: 'moveOut', label: language.moveOutOfFolder })
    }
    if (sidebarOrganizerFolderPartnerIds(order, reference).length > 0) {
      actions.push({ kind: 'createFolder', label: language.createFolderWith })
    }
    if (actions.length === 0) return

    const selectedAction = parseAlertSelection(
      await alertSelect(
        actions.map((action) => action.label),
        language.characterActionsFor(characterName),
      ),
      actions.length,
    )
    if (selectedAction === null) return

    const action = actions[selectedAction]
    if (!action) return

    if (action.kind === 'move') {
      runOrganizerMove(resolveSidebarOrganizerStep(getDatabase().characterOrder, reference, action.direction))
      return
    }

    if (action.kind === 'moveOut') {
      runOrganizerMove(resolveSidebarOrganizerMoveOut(getDatabase().characterOrder, reference))
      return
    }

    if (action.kind === 'moveToFolder') {
      const targetFolderIds = sidebarOrganizerFolderTargetIds(getDatabase().characterOrder, reference)
      if (targetFolderIds.length === 0) return
      const selectedFolder = parseAlertSelection(
        await alertSelect(targetFolderIds.map(folderNameById), language.chooseDestinationFolder),
        targetFolderIds.length,
      )
      if (selectedFolder === null) return

      const targetFolderId = targetFolderIds[selectedFolder]
      if (!targetFolderId) return
      runOrganizerMove(resolveSidebarOrganizerMoveToFolder(getDatabase().characterOrder, reference, targetFolderId))
      return
    }

    const partnerIds = sidebarOrganizerFolderPartnerIds(getDatabase().characterOrder, reference)
    if (partnerIds.length === 0) return
    const selectedPartner = parseAlertSelection(
      await alertSelect(partnerIds.map(characterNameById), language.chooseFolderPartner),
      partnerIds.length,
    )
    if (selectedPartner === null) return

    const partnerId = partnerIds[selectedPartner]
    if (!partnerId) return
    const positions = resolveSidebarOrganizerCreateFolder(getDatabase().characterOrder, reference, partnerId)
    if (!positions) return
    createCharacterOrderFolder(positions.source, positions.target, undefined, language.newCharacterFolderName)
  }

  async function openFolderActions(folderId: string, folderName: string) {
    const reference: SidebarOrganizerItemReference = { kind: 'folder', folderId }
    const actions: FolderAction[] = []

    if (editMode && resolveSidebarOrganizerStep(getDatabase().characterOrder, reference, 'up')) {
      actions.push({ kind: 'move', direction: 'up', label: language.moveUp })
    }
    if (editMode && resolveSidebarOrganizerStep(getDatabase().characterOrder, reference, 'down')) {
      actions.push({ kind: 'move', direction: 'down', label: language.moveDown })
    }
    actions.push(
      { kind: 'rename', label: language.renameFolder },
      { kind: 'color', label: language.changeFolderColor },
      { kind: 'image', label: language.changeFolderImage },
    )

    const selectedAction = parseAlertSelection(
      await alertSelect(
        actions.map((action) => action.label),
        language.folderActionsFor(folderName),
      ),
      actions.length,
    )
    if (selectedAction === null) return

    const action = actions[selectedAction]
    if (!action) return

    if (action.kind === 'move') {
      runOrganizerMove(resolveSidebarOrganizerStep(getDatabase().characterOrder, reference, action.direction))
      return
    }

    if (action.kind === 'rename') {
      const value = await alertInput(language.changeFolderName, [], folderName)
      if (value) updateCharacterOrderFolder(folderId, { name: value })
      return
    }

    if (action.kind === 'color') {
      const selectedColor = parseAlertSelection(
        await alertSelect(characterFolderColors.map(localizedFolderColor), language.chooseFolderColor),
        characterFolderColors.length,
      )
      if (selectedColor === null) return

      const color = characterFolderColors[selectedColor]
      if (color) updateCharacterOrderFolder(folderId, { color })
      return
    }

    const imageActions = [language.resetFolderImage, language.selectFolderImageFile]
    const selectedImageAction = parseAlertSelection(
      await alertSelect(imageActions, language.changeFolderImage),
      imageActions.length,
    )
    if (selectedImageAction === null) return

    if (selectedImageAction === 0) {
      updateCharacterOrderFolder(folderId, { imgFile: null, img: '' })
    } else {
      await uploadCharacterFolderImage(folderId)
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

  async function uploadCharacterFolderImage(folderId: string) {
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

    if (!folderImage || !folderImageUpload) {
      return
    }
    const freshFolderImageUpload = folderImageUpload

    try {
      if (
        !isFreshCharacterFolderImageUpload({
          operation: freshFolderImageUpload,
          characterOrder: getDatabase().characterOrder,
        })
      ) {
        return
      }

      const folderImageData = await saveAsset(folderImage.data)

      if (
        !isFreshCharacterFolderImageUpload({
          operation: freshFolderImageUpload,
          characterOrder: getDatabase().characterOrder,
        })
      ) {
        return
      }

      const folderImageSrc = await getFileSrc(folderImageData)

      if (
        !isFreshCharacterFolderImageUpload({
          operation: freshFolderImageUpload,
          characterOrder: getDatabase().characterOrder,
        })
      ) {
        return
      }

      const freshImagePatch = resolveFreshCharacterFolderImageUploadPatch({
        operation: freshFolderImageUpload,
        characterOrder: getDatabase().characterOrder,
        patch: { imgFile: folderImageData, img: folderImageSrc },
      })

      if (!freshImagePatch) {
        return
      }

      updateCharacterOrderFolder(freshFolderImageUpload.folderId, freshImagePatch)
    } finally {
      clearCharacterFolderImageUpload(freshFolderImageUpload)
    }
  }

  function openCharacterRoute(index: number) {
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
  let openFolders: string[] = $state([])
  const sidebarCharacterDrag = createSidebarCharacterDragController()
  interface Props {
    openGrid?: any
    hidden?: boolean
  }

  let { openGrid = () => {}, hidden = false }: Props = $props()

  sideBarClosing.set(false)

  const inserter = (mainIndex: DragData, targetIndex: DragData) => moveCharacterOrderItem(mainIndex, targetIndex)

  function scrollToActiveCharacter() {
    const selectedId = $selectedCharID
    if (selectedId === -1) return

    const characterId = getDatabase().characters[selectedId]?.chaId
    if (!characterId) return

    let targetFolderId: string | null = null

    for (const item of charImages) {
      if (item.type === 'folder') {
        const foundChar = item.folder.find((c) => getDatabase().characters[c.index]?.chaId === characterId)
        if (foundChar) {
          targetFolderId = item.id
          break
        }
      }
    }

    if (targetFolderId && !openFolders.includes(targetFolderId)) {
      openFolders.push(targetFolderId)
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
      scrollToActiveCharacter()
    }

    window.addEventListener('scrollToActiveCharacter', handler)

    return () => {
      window.removeEventListener('scrollToActiveCharacter', handler)
    }
  })

  const createFolder = (mainIndex: DragData, targetIndex: DragData) =>
    createCharacterOrderFolder(mainIndex, targetIndex, undefined, language.newCharacterFolderName)

  type DragEv = DragEvent & {
    currentTarget: EventTarget & HTMLDivElement
  }
  type DragData = CharacterOrderDragPosition
  const avatarDragStart = (ind: DragData, e: DragEv) => {
    if (!sidebarCharacterDrag.begin(ind, getDatabase().characterOrder)) return

    e.dataTransfer.setData('text/plain', '')
    e.dataTransfer.setData(SIDEBAR_CHARACTER_DRAG_TYPE, 'true')
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
    const drag = sidebarCharacterDrag.consume(e.dataTransfer.types, getDatabase().characterOrder)
    if (!drag) return

    e.preventDefault()
    try {
      createFolder(drag, ind)
    } catch (error) {}
  }

  const dropZoneDragOver = (e: DragEv) => {
    if (!isSidebarCharacterDrag(e.dataTransfer.types)) return

    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    e.currentTarget.classList.add('bg-green-500')
  }

  const consumeDropZoneDrag = (e: DragEv) => {
    e.currentTarget.classList.remove('bg-green-500')
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
    <div
      class="flex grow w-full flex-col items-center overflow-x-hidden overflow-y-auto pr-0"
      data-risu-sidebar-character-controls
      inert={menuMode === 1}>
      <button
        type="button"
        data-risu-sidebar-organizer-toggle
        aria-label={language.organizeCharacters}
        title={language.organizeCharacters}
        aria-pressed={editMode}
        class="sticky top-0 z-30 mt-2 flex h-8 min-h-8 w-14 min-w-14 cursor-pointer select-none items-center justify-center rounded-md border border-textcolor2 bg-bgcolor text-gray-300 shadow transition-colors hover:border-gray-300"
        class:bg-blue-500={editMode}
        onclick={() => {
          editMode = !editMode
        }}>
        <ListTreeIcon size={20} aria-hidden="true" />
      </button>
      <div
        class="h-4 min-h-4 w-14"
        role="listitem"
        ondragover={dropZoneDragOver}
        ondragleave={(e) => {
          e.currentTarget.classList.remove('bg-green-500')
        }}
        ondrop={(e) => {
          const da = consumeDropZoneDrag(e)
          if (da) {
            inserter(da, { index: 0 })
          }
        }}
        ondragenter={preventCharacterDrag}>
      </div>
      {#each charImages as char, ind}
        {@const characterId = char.type === 'normal' ? getDatabase().characters[char.index]?.chaId : undefined}
        <div
          class="group relative flex items-center px-2"
          role="listitem"
          draggable="true"
          ondragstart={(e) => {
            avatarDragStart({ index: ind }, e)
          }}
          ondragend={sidebarCharacterDrag.clear}
          ondragover={avatarDragOver}
          ondrop={(e) => {
            avatarDrop({ index: ind }, e)
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
                      void openFolderActions(char.id, char.name)
                    }}
                    onClick={() => {
                      if (char.type !== 'folder') {
                        return
                      }
                      if (openFolders.includes(char.id)) {
                        openFolders.splice(openFolders.indexOf(char.id), 1)
                      } else {
                        openFolders.push(char.id)
                      }
                      openFolders = openFolders
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
          {#if char.type === 'folder'}
            <button
              type="button"
              draggable="false"
              data-risu-sidebar-folder-actions={char.id}
              aria-label={language.folderActionsFor(char.name)}
              title={language.folderActionsFor(char.name)}
              class="absolute -right-1 -top-1 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-selected bg-bgcolor text-textcolor shadow hover:bg-darkbg"
              onclick={(event) => {
                event.stopPropagation()
                void openFolderActions(char.id, char.name)
              }}
              ondragstart={(event) => event.stopPropagation()}>
              <EllipsisVerticalIcon size={18} aria-hidden="true" />
            </button>
          {:else if editMode && characterId && charImages.length > 1}
            <button
              type="button"
              draggable="false"
              data-risu-sidebar-organizer-action={characterId}
              aria-label={language.characterActionsFor(char.name)}
              title={language.characterActionsFor(char.name)}
              class="absolute -right-1 -top-1 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-selected bg-bgcolor text-textcolor shadow hover:bg-darkbg"
              onclick={(event) => {
                event.stopPropagation()
                void openCharacterOrganizerActions(characterId, char.name)
              }}
              ondragstart={(event) => event.stopPropagation()}>
              <EllipsisVerticalIcon size={18} aria-hidden="true" />
            </button>
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
              {#each char.folder as char2, ind}
                {@const nestedCharacterId = getDatabase().characters[char2.index]?.chaId}
                <div
                  class="group relative flex items-center px-2 z-10"
                  role="listitem"
                  draggable="true"
                  ondragstart={(e) => {
                    if (char.type === 'folder') {
                      avatarDragStart({ index: ind, folder: char.id }, e)
                    }
                  }}
                  ondragend={sidebarCharacterDrag.clear}
                  ondragover={avatarDragOver}
                  ondrop={(e) => {
                    if (char.type === 'folder') {
                      avatarDrop({ index: ind, folder: char.id }, e)
                    }
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
                  {#if editMode && nestedCharacterId}
                    <button
                      type="button"
                      draggable="false"
                      data-risu-sidebar-organizer-action={nestedCharacterId}
                      aria-label={language.characterActionsFor(char2.name)}
                      title={language.characterActionsFor(char2.name)}
                      class="absolute -right-1 -top-1 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-selected bg-bgcolor text-textcolor shadow hover:bg-darkbg"
                      onclick={(event) => {
                        event.stopPropagation()
                        void openCharacterOrganizerActions(nestedCharacterId, char2.name)
                      }}
                      ondragstart={(event) => event.stopPropagation()}>
                      <EllipsisVerticalIcon size={18} aria-hidden="true" />
                    </button>
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
                    if (da && char.type === 'folder') {
                      inserter(da, { index: ind + 1, folder: char.id })
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
            if (da) {
              inserter(da, { index: ind + 1 })
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
        <QuickSettingsGui />
      {:else if devTool}
        <DevTool />
      {:else if $botMakerMode}
        <div class="contents" data-risu-sidebar-panel="character">
          <CharConfig />
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
