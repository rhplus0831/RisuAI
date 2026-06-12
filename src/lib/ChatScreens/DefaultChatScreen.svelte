<script lang="ts">
  import Suggestion from './Suggestion.svelte'
  import {
    CameraIcon,
    DatabaseIcon,
    DicesIcon,
    GlobeIcon,
    ImagePlusIcon,
    LanguagesIcon,
    Laugh,
    MenuIcon,
    MicOffIcon,
    PackageIcon,
    Plus,
    RefreshCcwIcon,
    ReplyIcon,
    Send,
    StepForwardIcon,
    XIcon,
    BrainIcon,
    ArrowDown,
    SparkleIcon,
  } from '@lucide/svelte'
  import {
    selectedCharID,
    PlaygroundStore,
    createSimpleCharacter,
    hypaV3ModalOpen,
    ScrollToMessageStore,
    additionalChatMenu,
    additionalFloatingActionButtons,
    easyPanelStore,
  } from '../../ts/stores.svelte'
  import { tick } from 'svelte'
  import Chat from './Chat.svelte'
  import {
    getCharacterByIndex,
    setCharacterByIndex,
    type Message,
  } from '../../ts/storage/database.svelte'
  import { DBState } from 'src/ts/stores.svelte'
  import { getCharImage } from '../../ts/characters'
  import {
    abortActiveGeneration,
    chatProcessStage,
    clearActiveGenerationAbortController,
    createActiveGenerationAbortController,
    doingChat,
    sendChat,
  } from '../../ts/process/index.svelte'
  import { sleep } from '../../ts/util'
  import { language } from '../../lang'
  import { isExpTranslator, translate } from '../../ts/translator/translator'
  import { alertError, alertNormal, alertWait } from '../../ts/alert'
  import sendSound from '../../etc/send.mp3'
  import CreatorQuote from './CreatorQuote.svelte'
  import { stopTTS } from 'src/ts/process/tts'
  import { resetBgmObserverForChatSwitch } from 'src/ts/observer.svelte'
  import MainMenu from '../UI/MainMenu.svelte'
  import AssetInput from './AssetInput.svelte'
  import {
    aiLawApplies,
    chatFoldedState,
    chatFoldedStateMessageIndex,
    downloadFile,
  } from 'src/ts/globalApi.svelte'
  import { v4 } from 'uuid'
  import {
    reroll as rerollNav,
    unReroll as unRerollNav,
    recordGeneratedReroll,
    resetRerollOnCharChange,
    clearRerollBuffer,
    markRerollChar,
  } from 'src/ts/process/rerollNavigation.svelte'
  import { processMultiCommand } from 'src/ts/process/command'
  import { postChatFile } from 'src/ts/process/files/multisend'
  import { getInlayAsset } from 'src/ts/process/files/inlays'
  import { applySuccessfulSendChatEffects } from 'src/ts/process/sendChatCompletion'
  import { coldStorageHeader, preLoadChat } from 'src/ts/process/coldstorage.svelte'
  import Chats from './Chats.svelte'
  import Button from '../UI/GUI/Button.svelte'
  import PluginDefinedIcon from '../Others/PluginDefinedIcon.svelte'
  import {
    appendCurrentChatUserMessageForSend,
    cloneJsonValue,
    currentChatScopedSnapshot,
    currentChatStateSnapshot,
    dispatchReplaceMessagesScoped,
    dispatchUpdateChat,
  } from 'src/ts/chatCommands'
  import { applyServerBackedSetting } from 'src/ts/server/settingsBridge.svelte'
  import { withTrustedServerProjectionWrite } from 'src/ts/server/projectionWriteGuard.svelte'
  import {
    hydrateActiveChatFully,
    hydrateActiveChatWindow,
    isChatMessageHydrationPending,
  } from 'src/ts/server/chatMessageHydration.svelte'
  import {
    buildTranscriptWindowIdentity,
    getLoadPagesForMessageJump,
  } from './DefaultChatScreen.loadPages'
  import { normalizeChatDisplayTailCount } from 'src/ts/chatDisplayTailCount'
  import { guardActiveChatGenerationSettingsForSend } from 'src/ts/activeChatGenerationSettings'
  import { characterRoutePath, currentRoute, navigate } from 'src/ts/router'

  const loadPlaygroundMenu = () =>
    import('../Playground/PlaygroundMenu.svelte').then((m) => m.default)

  interface Props {
    openModuleList?: boolean
    openChatList?: boolean
    customStyle?: string
  }

  let messageInput: string = $state('')
  let messageInputTranslate: string = $state('')
  let openMenu = $state(false)
  let loadPages = $state(normalizeChatDisplayTailCount(DBState.db.chatDisplayTailCount))
  let doingChatInputTranslate = false
  let toggleStickers: boolean = $state(false)
  let fileInput: string[] = $state([])
  let showNewMessageButton = $state(false)
  let chatsInstance: any = $state()
  let isScrollingToMessage = $state(false)
  let preparingSend = $state(false)
  let scrollToMessageRunId = 0
  let activeTranscriptWindowIdentity: string | null = $state(null)
  let activeBgmObserverIdentity: string | null = $state(null)
  let {
    openModuleList = $bindable(false),
    openChatList = $bindable(false),
    customStyle = '',
  }: Props = $props()
  let currentCharacter = $derived(DBState.db.characters[$selectedCharID])
  let activeChatOpen = $derived.by(() => {
    if ($selectedCharID < 0) return false
    const characterId = DBState.db.characters?.[$selectedCharID]?.chaId
    if (characterId === '§playground') return $PlaygroundStore === 2
    return (
      $currentRoute.kind === 'character' &&
      $currentRoute.chaId === characterId &&
      typeof $currentRoute.chatId === 'string'
    )
  })
  let currentChat = $derived(currentCharacter?.chats[currentCharacter.chatPage]?.message ?? [])
  let configuredChatLoadPages = $derived(
    normalizeChatDisplayTailCount(DBState.db.chatDisplayTailCount),
  )
  // The open chat ships as a message-less stub until `/projection/chatMessages`
  // resolves; show a loading state over the message area until then so the
  // history does not flash in over the greeting-only stub.
  let activeChatMessagesLoading = $derived(
    activeChatOpen &&
      isChatMessageHydrationPending(
        currentCharacter?.chats[currentCharacter.chatPage]?.id,
        currentChat.length,
      ),
  )

  function scrollToBottom() {
    chatsInstance?.scrollToLatestMessage()
  }

  function getActiveTranscriptWindowIdentity(): string | null {
    const selectedCharacterIndex = $selectedCharID
    const character = DBState.db.characters?.[selectedCharacterIndex]
    const chatPage = character?.chatPage ?? null
    const chat = chatPage === null ? null : character?.chats?.[chatPage]

    return buildTranscriptWindowIdentity({
      selectedCharacterIndex,
      characterId: character?.chaId,
      chatPage,
      chatId: chat?.id,
    })
  }

  function resetTranscriptWindowForChatSwitch() {
    loadPages = configuredChatLoadPages
    isScrollingToMessage = false
    scrollToMessageRunId += 1
    chatFoldedState.data = null
    chatFoldedStateMessageIndex.index = -1
  }

  let mostRecentChat = $derived.by(() => {
    const character = DBState.db.characters?.[$selectedCharID]
    return character?.chats?.[character.chatPage] ?? character?.chats?.[0] ?? null
  })

  function openMostRecentChat() {
    const character = DBState.db.characters?.[$selectedCharID]
    const chat = character?.chats?.[character.chatPage] ?? character?.chats?.[0]
    if (!character?.chaId || !chat?.id) return

    navigate(characterRoutePath(character.chaId, chat.id))
  }

  async function expandTranscriptWindow(nextLoadPages: number) {
    const targetIdentity = getActiveTranscriptWindowIdentity()
    if (!targetIdentity || nextLoadPages <= loadPages) return
    await hydrateActiveChatWindow(nextLoadPages)
    if (getActiveTranscriptWindowIdentity() !== targetIdentity) return
    loadPages = Math.max(loadPages, nextLoadPages)
  }

  $effect(() => {
    const nextIdentity = getActiveTranscriptWindowIdentity()
    if (activeTranscriptWindowIdentity === nextIdentity) {
      return
    }

    const previousIdentity = activeTranscriptWindowIdentity
    activeTranscriptWindowIdentity = nextIdentity
    loadPages = configuredChatLoadPages

    if (previousIdentity !== null) {
      resetTranscriptWindowForChatSwitch()
    }
  })

  $effect.pre(() => {
    const nextIdentity = getActiveTranscriptWindowIdentity()
    if (activeBgmObserverIdentity === nextIdentity) {
      return
    }

    const previousIdentity = activeBgmObserverIdentity
    activeBgmObserverIdentity = nextIdentity
    if (previousIdentity !== null) {
      resetBgmObserverForChatSwitch()
    }
  })

  $effect(() => {
    if (ScrollToMessageStore.value !== -1) {
      const index = ScrollToMessageStore.value
      ScrollToMessageStore.value = -1
      scrollToMessage(index)
    }
  })

  async function scrollToMessage(index: number) {
    const targetIdentity = getActiveTranscriptWindowIdentity()
    if (!targetIdentity || !Number.isInteger(index) || index < 0) {
      return
    }

    const runId = ++scrollToMessageRunId
    const isCurrentJump = () =>
      scrollToMessageRunId === runId && getActiveTranscriptWindowIdentity() === targetIdentity

    // Forces the loading of past messages not rendered on the screen
    isScrollingToMessage = true
    try {
      const totalMessages = currentChat.length
      const neededLoadPages = getLoadPagesForMessageJump(loadPages, totalMessages, index)

      if (loadPages < neededLoadPages) {
        await hydrateActiveChatWindow(neededLoadPages)
        if (!isCurrentJump()) {
          return
        }
        loadPages = neededLoadPages
        await tick()
        if (!isCurrentJump()) {
          return
        }
      }

      let element: Element | null = null
      // Poll for element existence (max 5 seconds)
      for (let i = 0; i < 50; i++) {
        if (!isCurrentJump()) {
          return
        }
        element = document.querySelector(`[data-chat-index="${index}"]`)
        if (element) break
        await sleep(100)
      }

      if (!isCurrentJump()) {
        return
      }

      const preIndex = Math.max(0, index - 3)
      const preElement = document.querySelector(`[data-chat-index="${preIndex}"]`)
      if (preElement) {
        preElement.scrollIntoView({ behavior: 'instant', block: 'start' })
      } else {
        element?.scrollIntoView({ behavior: 'instant', block: 'start' })
      }
      await sleep(50)

      if (!isCurrentJump()) {
        return
      }

      if (element) {
        // Wait for images to load to prevent layout shift
        const chatContainer = document.querySelector('.default-chat-screen')
        if (chatContainer) {
          const images = Array.from(chatContainer.querySelectorAll('img'))
          const promises = images.map((img) => {
            if (img.complete) return Promise.resolve()
            return new Promise((resolve) => {
              img.onload = () => resolve(null)
              img.onerror = () => resolve(null)
            })
          })
          // Wait for all images or timeout after 4 seconds
          await Promise.race([Promise.all(promises), sleep(4000)])
        }

        element.scrollIntoView({ behavior: 'instant', block: 'start' })
        if (!isCurrentJump()) {
          return
        }

        // Small delay and scroll again to ensure position is correct after any final layout adjustments
        await sleep(50)
        if (!isCurrentJump()) {
          return
        }
        element.scrollIntoView({ behavior: 'instant', block: 'start' })

        element.classList.add('ring-2', 'ring-blue-500')
        setTimeout(() => {
          element.classList.remove('ring-2', 'ring-blue-500')
        }, 2000)
      }
    } finally {
      if (scrollToMessageRunId === runId) {
        isScrollingToMessage = false
      }
    }
  }

  async function send() {
    return sendMain(false)
  }
  async function sendContinue() {
    return sendMain(true)
  }

  async function sendMain(continueResponse: boolean) {
    let selectedChar = $selectedCharID
    if ($doingChat || preparingSend) {
      return
    }
    preparingSend = true
    try {
      const generationSettingsGuard = guardActiveChatGenerationSettingsForSend()
      if (generationSettingsGuard.status === 'error') {
        alertError(generationSettingsGuard.error)
        await sleep(10)
        updateInputSizeAll()
        return
      }

      resetRerollOnCharChange()
      const targetIdentity = getActiveTranscriptWindowIdentity()
      await hydrateActiveChatFully()
      if (targetIdentity !== getActiveTranscriptWindowIdentity()) {
        return
      }

      const currentChatRecord =
        DBState.db.characters[selectedChar].chats[DBState.db.characters[selectedChar].chatPage]
      let userMessage: Message | null = null

      if (messageInput.startsWith('/')) {
        const commandProcessed = await processMultiCommand(messageInput)
        if (commandProcessed !== false) {
          messageInput = ''
          return
        }
      }

      if (fileInput.length > 0) {
        for (const file of fileInput) {
          messageInput += `{{inlayed::${file}}}`
        }
        fileInput = []
      }

      if (!continueResponse) {
        if (messageInput === '') {
          const messages = currentChatRecord.message ?? []
          if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
            if (DBState.db.useSayNothing) {
              userMessage = {
                role: 'user',
                data: '*says nothing*',
                name: null,
              }
            }
          }
        } else {
          // Server prompt assembly owns submit-time input triggers/editinput.
          userMessage = {
            role: 'user',
            data: messageInput,
            time: Date.now(),
            name: null,
          }
        }
      }
      messageInput = ''
      messageInputTranslate = ''
      if (userMessage) {
        const appended = await appendCurrentChatUserMessageForSend(userMessage)
        if (appended.status !== 'ok') {
          alertError(appended.error)
          await sleep(10)
          updateInputSizeAll()
          return
        }
      }
      await sleep(10)
      updateInputSizeAll()
      // Clear the reroll buffer only after send/continue succeeds.
      await sendChatMain(continueResponse, undefined, true)
    } finally {
      preparingSend = false
    }
  }

  async function reroll() {
    if ($doingChat) {
      return
    }
    await hydrateActiveChatFully()
    await rerollNav({ sendChatMain, closeMenu: () => (openMenu = false) })
  }

  async function unReroll() {
    if ($doingChat) {
      return
    }
    await hydrateActiveChatFully()
    await unRerollNav()
  }

  function playSendSoundIfEnabled() {
    if (DBState.db.playMessage) {
      const audio = new Audio(sendSound)
      audio.play().catch(() => {})
    }
  }

  async function sendChatMain(
    continued: boolean = false,
    regenerateMessageId?: string,
    confirmBoundary: boolean = false,
  ) {
    let previousLength =
      DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage]
        .message.length
    messageInput = ''
    const abortController = createActiveGenerationAbortController()
    try {
      const ok = await sendChat(-1, {
        signal: abortController.signal,
        continue: continued,
        regenerateMessageId,
      })
      if (
        !applySuccessfulSendChatEffects(
          { sendSucceeded: ok, previousLength, confirmBoundary },
          {
            clearRerollBuffer,
            recordGeneratedReroll,
            markRerollChar,
            playSendSound: playSendSoundIfEnabled,
          },
        )
      ) {
        return
      }
    } catch (error) {
      console.error(error)
      alertError(error)
    } finally {
      clearActiveGenerationAbortController(abortController)
    }
  }

  function abortChat() {
    abortActiveGeneration()
  }

  let { userIconPortrait, currentUsername, userIcon } = $derived.by(() => {
    const bindedPersona =
      DBState?.db?.characters?.[$selectedCharID]?.chats?.[
        DBState?.db?.characters?.[$selectedCharID]?.chatPage
      ]?.bindedPersona

    if (bindedPersona) {
      const persona = DBState.db.personas.find((p) => p.id === bindedPersona)
      if (persona) {
        return {
          currentUsername: persona.name,
          userIconPortrait: persona.largePortrait,
          userIcon: persona.icon,
        }
      }
    }

    const selectedPersonaIndex = DBState.db.selectedPersona
    return {
      currentUsername: DBState.db.username,
      userIconPortrait: DBState.db.personas[selectedPersonaIndex].largePortrait,
      userIcon: DBState.db.personas[selectedPersonaIndex].icon,
    }
  })

  let inputHeight = $state('44px')
  let inputEle: HTMLTextAreaElement = $state()
  let inputTranslateHeight = $state('44px')
  let inputTranslateEle: HTMLTextAreaElement = $state()

  function updateInputSizeAll() {
    updateInputSize()
    updateInputTranslateSize()
  }

  function updateInputTranslateSize() {
    if (inputTranslateEle) {
      inputTranslateEle.style.height = '0'
      inputTranslateHeight = inputTranslateEle.scrollHeight + 'px'
      inputTranslateEle.style.height = inputTranslateHeight
    }
  }
  function updateInputSize() {
    if (inputEle) {
      inputEle.style.height = '0'
      inputHeight = inputEle.scrollHeight + 'px'
      inputEle.style.height = inputHeight
    }
  }

  $effect.pre(() => {
    updateInputSizeAll()
  })

  async function updateInputTransateMessage(reverse: boolean) {
    if (!DBState.db.useAutoTranslateInput) {
      return
    }
    if (isExpTranslator()) {
      if (!reverse) {
        messageInputTranslate = ''
        return
      }
      if (messageInputTranslate === '') {
        messageInput = ''
        return
      }
      const lastMessageInputTranslate = messageInputTranslate
      await sleep(1500)
      if (lastMessageInputTranslate === messageInputTranslate) {
        translate(reverse ? messageInputTranslate : messageInput, reverse).then(
          (translatedMessage) => {
            if (translatedMessage) {
              if (reverse) messageInput = translatedMessage
              else messageInputTranslate = translatedMessage
            }
          },
        )
      }
      return
    }
    if (reverse && messageInputTranslate === '') {
      messageInput = ''
      return
    }
    if (!reverse && messageInput === '') {
      messageInputTranslate = ''
      return
    }
    translate(reverse ? messageInputTranslate : messageInput, reverse).then((translatedMessage) => {
      if (translatedMessage) {
        if (reverse) messageInput = translatedMessage
        else messageInputTranslate = translatedMessage
      }
    })
  }

  async function screenShot() {
    const screenshotIdentity = getActiveTranscriptWindowIdentity()
    const previousLoadPages = loadPages
    let canvases: Array<HTMLCanvasElement | null> = []
    let mergedCanvas: HTMLCanvasElement | null = null
    try {
      await hydrateActiveChatFully()
      loadPages = Infinity
      await tick()
      const html2canvas = await import('html-to-image')
      const chats = document.querySelectorAll('.default-chat-screen .risu-chat')
      alertWait('Taking screenShot...')

      for (const chat of chats) {
        const cnv = await html2canvas.toCanvas(chat as HTMLElement)
        alertWait('Taking screenShot... ' + canvases.length + '/' + chats.length)
        canvases.push(cnv)
      }

      canvases.reverse()

      alertWait('Merging images...')

      mergedCanvas = document.createElement('canvas')
      mergedCanvas.width = 0
      mergedCanvas.height = 0
      let mergedCtx = mergedCanvas.getContext('2d')

      let totalHeight = 0
      let maxWidth = 0
      for (let i = 0; i < canvases.length; i++) {
        let canvas = canvases[i]
        if (!canvas) continue
        totalHeight += canvas.height
        maxWidth = Math.max(maxWidth, canvas.width)

        mergedCanvas.width = maxWidth
        mergedCanvas.height = totalHeight
      }

      mergedCtx.fillStyle = 'var(--risu-theme-bgcolor)'
      mergedCtx.fillRect(0, 0, maxWidth, totalHeight)
      let indh = 0
      for (let i = 0; i < canvases.length; i++) {
        let canvas = canvases[i]
        if (!canvas) continue
        indh += canvas.height
        mergedCtx.drawImage(canvas, 0, indh - canvas.height)
        canvas.remove()
        canvases[i] = null
      }

      if (mergedCanvas) {
        await downloadFile(
          `chat-${v4()}.png`,
          Buffer.from(mergedCanvas.toDataURL('png').split(',').at(-1), 'base64'),
        )
        mergedCanvas.remove()
        mergedCanvas = null
      }
      alertNormal(language.screenshotSaved)
    } catch (error) {
      console.error(error)
      alertError('Error while taking screenshot')
    } finally {
      for (const canvas of canvases) {
        canvas?.remove()
      }
      mergedCanvas?.remove()
      loadPages =
        getActiveTranscriptWindowIdentity() === screenshotIdentity
          ? previousLoadPages
          : configuredChatLoadPages
    }
  }

  function updateGreetingIndex(fmIndex: number) {
    const selectedChar = $selectedCharID
    const character = DBState.db.characters[selectedChar]
    const chat = character?.chats[character.chatPage]
    if (!chat) return
    const previous = currentChatStateSnapshot()
    withTrustedServerProjectionWrite(() => {
      const liveCharacter = DBState.db.characters[selectedChar]
      const liveChat = liveCharacter?.chats[liveCharacter.chatPage]
      if (liveChat?.id === chat.id) {
        liveChat.fmIndex = fmIndex
      }
    })
    if (chat.id) {
      dispatchUpdateChat(chat.id, { fmIndex }, previous)
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="w-full h-full relative"
  style={customStyle}
  onclick={() => {
    openMenu = false
  }}
>
  {#if showNewMessageButton}
    {#if DBState.db.newMessageButtonStyle === 'bottom-center' || !DBState.db.newMessageButtonStyle}
      <button
        class="absolute bottom-16 left-1/2 -translate-x-1/2 bg-blue-500 text-white px-4 py-2 rounded-full shadow-lg z-50 flex items-center gap-2 hover:bg-blue-600 transition-colors"
        onclick={scrollToBottom}
      >
        <ArrowDown size={16} />
        <span>{language.newMessage}</span>
      </button>
    {/if}

    {#if DBState.db.newMessageButtonStyle === 'bottom-right'}
      <button
        class="absolute bottom-20 right-4 bg-blue-500 text-white px-4 py-2 rounded-full shadow-lg z-50 flex items-center gap-2 hover:bg-blue-600 transition-colors"
        onclick={scrollToBottom}
      >
        <ArrowDown size={16} />
        <span>{language.newMessage}</span>
      </button>
    {/if}

    {#if DBState.db.newMessageButtonStyle === 'bottom-left'}
      <button
        class="absolute bottom-20 left-4 bg-blue-500 text-white px-4 py-2 rounded-full shadow-lg z-50 flex items-center gap-2 hover:bg-blue-600 transition-colors"
        onclick={scrollToBottom}
      >
        <ArrowDown size={16} />
        <span>{language.newMessage}</span>
      </button>
    {/if}

    {#if DBState.db.newMessageButtonStyle === 'floating-circle'}
      <button
        class="absolute bottom-36 right-4 bg-blue-500 text-white w-12 h-12 rounded-full shadow-lg z-50 flex items-center justify-center hover:bg-blue-600 transition-colors"
        onclick={scrollToBottom}
        title="4. 원형 (우하단)"
      >
        <ArrowDown size={20} />
      </button>
    {/if}

    {#if DBState.db.newMessageButtonStyle === 'right-center'}
      <button
        class="absolute top-1/2 right-2 -translate-y-1/2 bg-blue-500 text-white px-2 py-3 rounded-l-lg shadow-lg z-50 flex flex-col items-center gap-1 hover:bg-blue-600 transition-colors"
        onclick={scrollToBottom}
      >
        <ArrowDown size={14} />
        <span class="text-xs writing-mode-vertical">{language.newMessage}</span>
      </button>
    {/if}

    {#if DBState.db.newMessageButtonStyle === 'top-bar'}
      <button
        class="absolute top-2 left-1/2 -translate-x-1/2 bg-blue-500 text-white px-6 py-1.5 rounded-full shadow-lg z-50 flex items-center gap-2 hover:bg-blue-600 transition-colors text-sm"
        onclick={scrollToBottom}
      >
        <ArrowDown size={14} />
        <span>{language.newMessage}</span>
      </button>
    {/if}
  {/if}
  {#if isScrollingToMessage}
    <div
      class="absolute inset-0 z-50 flex items-center justify-center bg-black/50 text-white text-xl font-bold backdrop-blur-sm"
    >
      Loading...
    </div>
  {/if}
  {#if $selectedCharID >= 0 && activeChatMessagesLoading}
    <div class="absolute inset-0 z-40 flex items-center justify-center bg-bgcolor">
      <div class="flex flex-col items-center text-textcolor2">
        <svg
          class="animate-spin h-6 w-6 mb-3"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
          ></circle>
          <path
            class="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          ></path>
        </svg>
        <span class="text-sm">{language.loadingChatData}</span>
      </div>
    </div>
  {/if}
  {#if $selectedCharID < 0}
    {#if $PlaygroundStore === 0}
      <MainMenu />
    {:else}
      {#await loadPlaygroundMenu() then PlaygroundMenu}
        <PlaygroundMenu />
      {/await}
    {/if}
  {:else if !activeChatOpen}
    <div
      class="h-full w-full flex flex-col items-center justify-center text-center px-6"
      data-risu-chat-empty-state
    >
      <h2 class="text-2xl font-bold mb-2">{DBState.db.characters[$selectedCharID]?.name}</h2>
      <p class="text-textcolor2">{language.selectChatToOpen}</p>
      {#if mostRecentChat}
        <Button className="mt-4 flex items-center gap-2" onclick={openMostRecentChat}>
          <StepForwardIcon size={18} />
          <span>{language.openMostRecentChat}</span>
        </Button>
        <span class="mt-2 max-w-full truncate text-sm text-textcolor2">{mostRecentChat.name}</span>
      {/if}
    </div>
  {:else}
    <div
      class="h-full w-full flex flex-col-reverse overflow-y-auto relative default-chat-screen"
      onscroll={(e) => {
        //@ts-expect-error scrollHeight/clientHeight/scrollTop don't exist on EventTarget, but target is HTMLElement here
        const scrolled = e.target.scrollHeight - e.target.clientHeight + e.target.scrollTop
        if (
          scrolled < 100 &&
          DBState.db.characters[$selectedCharID].chats[
            DBState.db.characters[$selectedCharID].chatPage
          ].message.length > loadPages
        ) {
          void expandTranscriptWindow(loadPages + 15)
        }
        const chatTarget = e.target as HTMLElement
        const chatsContainer =
          DBState.db.fixedChatTextarea && chatTarget.children[1]
            ? chatTarget.children[1]
            : chatTarget.children[0]
        const lastEl = chatsContainer?.firstElementChild
        const isAtBottom = lastEl
          ? lastEl.getBoundingClientRect().top <= chatTarget.getBoundingClientRect().bottom + 100
          : true
        if (isAtBottom) {
          showNewMessageButton = false
        }
      }}
    >
      <div
        class="{DBState.db.fixedChatTextarea
          ? 'sticky pt-2 pb-2 right-0 bottom-0 bg-bgcolor'
          : 'mt-2 mb-2'} flex items-stretch w-full"
        style={DBState.db.fixedChatTextarea ? 'z-index:29;' : ''}
      >
        {#if DBState.db.useChatSticker}
          <div
            onclick={() => {
              toggleStickers = !toggleStickers
            }}
            class={'ml-4 bg-textcolor2 flex justify-center items-center  w-12 h-12 rounded-md hover:bg-blue-500 transition-colors ' +
              (toggleStickers ? 'text-green-500' : 'text-textcolor')}
          >
            <Laugh />
          </div>
        {/if}

        <textarea
          data-testid="default-chat-composer"
          class="peer text-input-area focus:border-textcolor transition-colors outline-hidden text-textcolor p-2 min-w-0 border border-r-0 bg-transparent rounded-md rounded-r-none input-text text-xl grow ml-4 border-darkborderc resize-none overflow-y-hidden overflow-x-hidden max-w-full placeholder:text-sm"
          bind:value={messageInput}
          bind:this={inputEle}
          onkeydown={(e) => {
            if (e.key.toLocaleLowerCase() === 'enter' && !e.isComposing) {
              if (DBState.db.sendWithEnter && !e.shiftKey) {
                send()
                e.preventDefault()
              } else if (!DBState.db.sendWithEnter && e.shiftKey) {
                send()
                e.preventDefault()
              }
            }
            if (e.key.toLocaleLowerCase() === 'm' && e.ctrlKey) {
              reroll()
              e.preventDefault()
            }
          }}
          onpaste={(e) => {
            const items = e.clipboardData?.items
            if (!items) {
              return
            }
            let canceled = false

            for (const item of items) {
              if (item.kind === 'file' && item.type.startsWith('image')) {
                if (!canceled) {
                  e.preventDefault()
                  canceled = true
                }
                const file = item.getAsFile()
                if (file) {
                  const reader = new FileReader()
                  reader.onload = async (e) => {
                    const buf = e.target?.result as ArrayBuffer
                    const uint8 = new Uint8Array(buf)
                    const results = await postChatFile({
                      name: file.name,
                      data: uint8,
                    })
                    if (!results) return
                    for (const res of results) {
                      if (res?.type === 'asset') {
                        fileInput.push(res.data)
                      }
                      if (res?.type === 'text') {
                        messageInput += `{{file::${res.name}::${res.data}}}`
                      }
                    }
                    updateInputSizeAll()
                  }
                  reader.readAsArrayBuffer(file)
                }
              }
            }
          }}
          oninput={() => {
            updateInputSizeAll()
            updateInputTransateMessage(false)
          }}
          style:height={inputHeight}
        ></textarea>

        {#if $doingChat || doingChatInputTranslate}
          <button
            aria-labelledby="cancel"
            class="peer-focus:border-textcolor flex justify-center border-y border-darkborderc items-center text-textcolor p-3 hover:bg-blue-500 hover:text-white transition-colors"
            onclick={abortChat}
            style:height={inputHeight}
          >
            <div class="loadmove chat-process-stage-{$chatProcessStage}"></div>
          </button>
        {:else}
          <button
            data-testid="default-chat-send-button"
            onclick={send}
            class="flex justify-center border-y border-darkborderc items-center text-textcolor p-3 peer-focus:border-textcolor hover:bg-blue-500 hover:text-white transition-colors button-icon-send"
            style:height={inputHeight}
          >
            <Send />
          </button>
        {/if}
        {#if DBState.db.characters[$selectedCharID]?.chaId !== '§playground'}
          <button
            data-testid="default-chat-menu-button"
            onclick={(e) => {
              openMenu = !openMenu
              e.stopPropagation()
            }}
            class="peer-focus:border-textcolor mr-2 flex border-y border-r border-darkborderc justify-center items-center text-textcolor p-3 rounded-r-md hover:bg-blue-500 hover:text-white transition-colors"
            style:height={inputHeight}
          >
            <MenuIcon />
          </button>
        {:else}
          <div
            onclick={(e) => {
              const previous = currentChatScopedSnapshot()
              const selectedChar = $selectedCharID
              const currentChatRecord =
                DBState.db.characters[selectedChar].chats[
                  DBState.db.characters[selectedChar].chatPage
                ]
              const nextMessages = cloneJsonValue(currentChatRecord.message ?? [])
              nextMessages.push({
                role: 'char',
                data: '',
              })
              withTrustedServerProjectionWrite(() => {
                const liveCharacter = DBState.db.characters[selectedChar]
                const liveChat = liveCharacter?.chats[liveCharacter.chatPage]
                if (liveChat && (!currentChatRecord.id || liveChat.id === currentChatRecord.id)) {
                  liveChat.message = cloneJsonValue(nextMessages)
                }
              })
              if (currentChatRecord.id) {
                dispatchReplaceMessagesScoped(currentChatRecord.id, nextMessages, previous)
              }
            }}
            class="peer-focus:border-textcolor mr-2 flex border-y border-r border-darkborderc justify-center items-center text-textcolor p-3 rounded-r-md hover:bg-blue-500 hover:text-white transition-colors"
            style:height={inputHeight}
          >
            <Plus />
          </div>
        {/if}
      </div>
      {#if DBState.db.useAutoTranslateInput && DBState.db.characters[$selectedCharID]?.chaId !== '§playground'}
        <div class="flex items-center mt-2 mb-2">
          <label for="messageInputTranslate" class="text-textcolor ml-4">
            <LanguagesIcon />
          </label>
          <textarea
            id="messageInputTranslate"
            class="text-textcolor rounded-md p-2 min-w-0 bg-transparent input-text text-xl grow ml-4 mr-2 border-darkbutton resize-none focus:bg-selected overflow-y-hidden overflow-x-hidden max-w-full"
            bind:value={messageInputTranslate}
            bind:this={inputTranslateEle}
            onkeydown={(e) => {
              if (e.key.toLocaleLowerCase() === 'enter' && !e.shiftKey) {
                if (DBState.db.sendWithEnter) {
                  send()
                  e.preventDefault()
                }
              }
              if (e.key.toLocaleLowerCase() === 'm' && e.ctrlKey) {
                reroll()
                e.preventDefault()
              }
            }}
            oninput={() => {
              updateInputSizeAll()
              updateInputTransateMessage(true)
            }}
            placeholder={language.enterMessageForTranslateToEnglish}
            style:height={inputTranslateHeight}
          ></textarea>
        </div>
      {/if}

      {#if fileInput.length > 0}
        <div class="flex items-center ml-4 flex-wrap p-2 m-2 border-darkborderc border rounded-md">
          {#each fileInput as file, i}
            {#await getInlayAsset(file) then inlayAsset}
              <div class="relative">
                {#if !inlayAsset}
                  <div
                    class="w-48 h-24 border border-darkborderc rounded-md flex items-center justify-center text-textcolor2"
                  >
                    Missing file
                  </div>
                {:else if inlayAsset.type === 'image'}
                  <img
                    src={inlayAsset.data}
                    alt="Inlay"
                    class="max-w-48 max-h-48 border border-darkborderc"
                  />
                {:else if inlayAsset.type === 'video'}
                  <video controls class="max-w-48 max-h-48 border border-darkborderc">
                    <source src={inlayAsset.data} type="video/mp4" />
                    <track kind="captions" />
                    Your browser does not support the video tag.
                  </video>
                {:else if inlayAsset.type === 'audio'}
                  <audio controls class="max-w-48 max-h-24 border border-darkborderc">
                    <source src={inlayAsset.data} type="audio/mpeg" />
                    Your browser does not support the audio tag.
                  </audio>
                {:else}
                  <div class="max-w-24 max-h-24">{file}</div>
                {/if}
                <button
                  class="absolute -right-1 -top-1 p-1 bg-darkbg text-textcolor rounded-md transition-colors hover:text-draculared focus:text-draculared"
                  onclick={() => {
                    fileInput.splice(i, 1)
                    updateInputSizeAll()
                  }}
                >
                  <XIcon size={18} />
                </button>
              </div>
            {/await}
          {/each}
        </div>
      {/if}

      {#if toggleStickers}
        <div class="ml-4 flex flex-wrap">
          <AssetInput
            {currentCharacter}
            onSelect={(additionalAsset) => {
              let fileType = 'img'
              if (additionalAsset.length > 2 && additionalAsset[2]) {
                const fileExtension = additionalAsset[2]
                if (fileExtension === 'mp4' || fileExtension === 'webm') fileType = 'video'
                else if (fileExtension === 'mp3' || fileExtension === 'wav') fileType = 'audio'
              }
              messageInput += `<span class='notranslate' translate='no'>{{${fileType}::${additionalAsset[0]}}}</span> *${additionalAsset[0]} added*`
              updateInputSizeAll()
            }}
          />
        </div>
      {/if}

      {#if DBState.db.useAutoSuggestions}
        <Suggestion
          messageInput={(msg) =>
            (messageInput =
              (DBState.db.subModel === 'textgen_webui' ||
                DBState.db.subModel === 'mancer' ||
                DBState.db.subModel.startsWith('local_')) &&
              DBState.db.autoSuggestClean
                ? msg.replace(/ +\(.+?\) *$| - [^"'*]*?$/, '')
                : msg)}
          {send}
        />
      {/if}

      {#if DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message?.[0]?.data?.startsWith(coldStorageHeader)}
        {#await preLoadChat($selectedCharID, DBState.db.characters[$selectedCharID].chatPage)}
          <div class="w-full flex justify-center text-textcolor2 italic mb-12">
            {language.loadingChatData}
          </div>
        {:then a}
          <div></div>
        {/await}
      {:else}
        {#if chatFoldedStateMessageIndex.index !== -1}
          <button class="w-full flex justify-center max-w-full p-4">
            <Button
              className="max-w-xl w-full"
              onclick={async () => {
                await expandTranscriptWindow(loadPages + chatFoldedStateMessageIndex.index + 1)
                chatFoldedState.data = null
              }}
            >
              {language.loadMore}
            </Button>
          </button>
        {/if}

        <Chats
          bind:this={chatsInstance}
          messages={currentChat}
          {loadPages}
          onReroll={reroll}
          {unReroll}
          {currentCharacter}
          {currentUsername}
          {userIcon}
          {userIconPortrait}
          bind:hasNewUnreadMessage={showNewMessageButton}
        />

        {#if DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length <= loadPages}
          <Chat
            character={createSimpleCharacter(DBState.db.characters[$selectedCharID])}
            name={DBState.db.characters[$selectedCharID].name}
            message={DBState.db.characters[$selectedCharID].chats[
              DBState.db.characters[$selectedCharID].chatPage
            ].fmIndex === -1
              ? DBState.db.characters[$selectedCharID].firstMessage
              : DBState.db.characters[$selectedCharID].alternateGreetings[
                  DBState.db.characters[$selectedCharID].chats[
                    DBState.db.characters[$selectedCharID].chatPage
                  ].fmIndex
                ]}
            role="char"
            img={getCharImage(DBState.db.characters[$selectedCharID].image, 'css')}
            idx={-1}
            altGreeting={DBState.db.characters[$selectedCharID].alternateGreetings.length > 0}
            largePortrait={DBState.db.characters[$selectedCharID].largePortrait}
            firstMessage={true}
            onReroll={() => {
              const cha = DBState.db.characters[$selectedCharID]
              const chat =
                DBState.db.characters[$selectedCharID].chats[
                  DBState.db.characters[$selectedCharID].chatPage
                ]
              if (chat.fmIndex >= cha.alternateGreetings.length - 1) {
                updateGreetingIndex(-1)
              } else {
                updateGreetingIndex(chat.fmIndex + 1)
              }
            }}
            unReroll={() => {
              const cha = DBState.db.characters[$selectedCharID]
              const chat =
                DBState.db.characters[$selectedCharID].chats[
                  DBState.db.characters[$selectedCharID].chatPage
                ]
              if (chat.fmIndex === -1) {
                updateGreetingIndex(cha.alternateGreetings.length - 1)
              } else {
                updateGreetingIndex(chat.fmIndex - 1)
              }
            }}
            isLastMemory={false}
            currentPage={(DBState.db.characters[$selectedCharID].chats[
              DBState.db.characters[$selectedCharID].chatPage
            ].fmIndex ?? -1) + 2}
            totalPages={DBState.db.characters[$selectedCharID].alternateGreetings.length + 1}
          />
          {#if aiLawApplies() && DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length === 0}
            <div
              class="ml-auto mr-auto mt-4 text-textcolor2 italic max-w-2/3 wrap-break-word text-center"
            >
              {language.aiGenerationWarning}
            </div>
          {/if}
          {#if !DBState.db.characters[$selectedCharID].removedQuotes && DBState.db.characters[$selectedCharID].creatorNotes.length >= 2}
            <CreatorQuote
              quote={DBState.db.characters[$selectedCharID].creatorNotes}
              onRemove={() => {
                const cha = getCharacterByIndex($selectedCharID, { snapshot: true })
                cha.removedQuotes = true
                setCharacterByIndex($selectedCharID, cha)
              }}
            />
          {/if}
        {/if}
      {/if}

      {#if openMenu}
        <div
          class="{DBState.db.fixedChatTextarea
            ? 'fixed'
            : 'absolute'} right-2 bottom-16 p-5 bg-darkbg flex flex-col gap-3 text-textcolor rounded-md"
          onclick={(e) => {
            e.stopPropagation()
          }}
        >
          <!-- svelte-ignore block_empty -->
          {#if DBState.db.characters[$selectedCharID].ttsMode === 'webspeech' || DBState.db.characters[$selectedCharID].ttsMode === 'elevenlab'}
            <div
              class="flex items-center cursor-pointer hover:text-green-500 transition-colors"
              onclick={() => {
                stopTTS()
              }}
            >
              <MicOffIcon />
              <span class="ml-2">{language.ttsStop}</span>
            </div>
          {/if}

          <div
            class="flex items-center cursor-pointer hover:text-green-500 transition-colors"
            class:text-textcolor2={DBState.db.characters[$selectedCharID].chats[
              DBState.db.characters[$selectedCharID].chatPage
            ].message.length < 2 ||
              DBState.db.characters[$selectedCharID].chats[
                DBState.db.characters[$selectedCharID].chatPage
              ].message[
                DBState.db.characters[$selectedCharID].chats[
                  DBState.db.characters[$selectedCharID].chatPage
                ].message.length - 1
              ].role !== 'char'}
            onclick={() => {
              if (
                DBState.db.characters[$selectedCharID].chats[
                  DBState.db.characters[$selectedCharID].chatPage
                ].message.length < 2 ||
                DBState.db.characters[$selectedCharID].chats[
                  DBState.db.characters[$selectedCharID].chatPage
                ].message[
                  DBState.db.characters[$selectedCharID].chats[
                    DBState.db.characters[$selectedCharID].chatPage
                  ].message.length - 1
                ].role !== 'char'
              ) {
                return
              }
              sendContinue()
            }}
          >
            <StepForwardIcon />
            <span class="ml-2">{language.continueResponse}</span>
          </div>

          {#if DBState.db.showMenuChatList}
            <div
              class="flex items-center cursor-pointer hover:text-green-500 transition-colors"
              onclick={() => {
                openChatList = true
                openMenu = false
              }}
            >
              <DatabaseIcon />
              <span class="ml-2">{language.chatList}</span>
            </div>
          {/if}

          {#if DBState.db.enableRisuaiProTools}
            <div
              class="flex items-center cursor-pointer hover:text-green-500 transition-colors"
              onclick={() => {
                easyPanelStore.open = !easyPanelStore.open
              }}
            >
              <SparkleIcon />
              <span class="ml-2">{language.easyPanel}</span>
            </div>
          {/if}

          {#each additionalChatMenu as menu}
            <div
              class="flex items-center cursor-pointer hover:text-green-500 transition-colors"
              onclick={() => {
                menu.callback()
                openMenu = false
              }}
            >
              <PluginDefinedIcon ico={menu} />
              <span class="ml-2">{menu.name}</span>
            </div>
          {/each}

          {#if DBState.db.showMenuHypaMemoryModal && DBState.db.hypaV3}
            <div
              class="flex items-center cursor-pointer hover:text-green-500 transition-colors"
              onclick={() => {
                $hypaV3ModalOpen = true
                openMenu = false
              }}
            >
              <BrainIcon />
              <span class="ml-2">{language.hypaMemoryV3Modal}</span>
            </div>
          {/if}

          {#if DBState.db.translator !== ''}
            <div
              class={'flex items-center cursor-pointer ' +
                (DBState.db.useAutoTranslateInput ? 'text-green-500' : 'lg:hover:text-green-500')}
              onclick={() => {
                applyServerBackedSetting('useAutoTranslateInput', !DBState.db.useAutoTranslateInput)
              }}
            >
              <GlobeIcon />
              <span class="ml-2">{language.autoTranslateInput}</span>
            </div>
          {/if}

          <div
            data-testid="default-chat-screenshot-button"
            class="flex items-center cursor-pointer hover:text-green-500 transition-colors"
            onclick={() => {
              screenShot()
            }}
          >
            <CameraIcon />
            <span class="ml-2">{language.screenshot}</span>
          </div>

          <div
            class="flex items-center cursor-pointer hover:text-green-500 transition-colors"
            onclick={async () => {
              const results = await postChatFile(messageInput)
              if (!results) return
              for (const res of results) {
                if (res?.type === 'asset') {
                  fileInput.push(res.data)
                }
                if (res?.type === 'text') {
                  messageInput += `{{file::${res.name}::${res.data}}}`
                }
              }
              updateInputSizeAll()
            }}
          >
            <ImagePlusIcon />
            <span class="ml-2">{language.postFile}</span>
          </div>

          <div
            class={'flex items-center cursor-pointer ' +
              (DBState.db.useAutoSuggestions ? 'text-green-500' : 'lg:hover:text-green-500')}
            onclick={async () => {
              applyServerBackedSetting('useAutoSuggestions', !DBState.db.useAutoSuggestions)
            }}
          >
            <ReplyIcon />
            <span class="ml-2">{language.autoSuggest}</span>
          </div>

          <div
            class="flex items-center cursor-pointer hover:text-green-500 transition-colors"
            onclick={() => {
              openModuleList = true
              openMenu = false
            }}
          >
            <PackageIcon />
            <span class="ml-2">{language.modules}</span>
          </div>

          {#if DBState.db.sideMenuRerollButton}
            <div
              class="flex items-center cursor-pointer hover:text-green-500 transition-colors"
              onclick={reroll}
            >
              <RefreshCcwIcon />
              <span class="ml-2">{language.reroll}</span>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if additionalFloatingActionButtons.length > 0}
  <div class="fixed top-4 right-4 flex flex-col gap-3 z-50">
    {#each additionalFloatingActionButtons as button}
      <button
        class="bg-blue-500 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 hover:bg-blue-600 transition-colors"
        onclick={() => {
          button.callback()
        }}
      >
        <PluginDefinedIcon ico={button} />
      </button>
    {/each}
  </div>
{/if}

<style>
  .chat-process-stage-1 {
    border-top: 0.4rem solid #60a5fa;
    border-left: 0.4rem solid #60a5fa;
  }

  .chat-process-stage-2 {
    border-top: 0.4rem solid #db2777;
    border-left: 0.4rem solid #db2777;
  }

  .chat-process-stage-3 {
    border-top: 0.4rem solid #34d399;
    border-left: 0.4rem solid #34d399;
  }

  .chat-process-stage-4 {
    border-top: 0.4rem solid #8b5cf6;
    border-left: 0.4rem solid #8b5cf6;
  }

  .autoload {
    border-top: 0.4rem solid #10b981;
    border-left: 0.4rem solid #10b981;
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
</style>
