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
    Undo2Icon,
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
    getDatabase,
    getCharacterByIndex,
    isServerCharacterShell,
    setCharacterByIndex,
    type character,
    type Message,
  } from '../../ts/storage/database.svelte'
  import { getCharImage } from '../../ts/characters'
  import {
    abortActiveGeneration,
    activeGenerationTarget,
    chatProcessStage,
    clearActiveGenerationAbortController,
    createActiveGenerationAbortController,
    doingChat,
    sendChat,
  } from '../../ts/process/index.svelte'
  import { getUserDisplayName, getUserIcon, getUserIconProtrait, sleep } from '../../ts/util'
  import { language } from '../../lang'
  import { isExpTranslator, runInputTranslator, translate } from '../../ts/translator/translator'
  import {
    alertError,
    alertNormal,
    beginAlertWait,
    clearAlertWait,
    updateAlertWait,
    type AlertWaitHandle,
  } from '../../ts/alert'
  import sendSound from '../../etc/send.mp3'
  import CreatorQuote from './CreatorQuote.svelte'
  import { stopTTS } from 'src/ts/process/tts'
  import { resetBgmObserverForChatSwitch } from 'src/ts/observer.svelte'
  import MainMenu from '../UI/MainMenu.svelte'
  import AssetInput from './AssetInput.svelte'
  import { aiLawApplies, chatFoldedState, chatFoldedStateMessageIndex, downloadFile } from 'src/ts/globalApi.svelte'
  import { getCharacterDisplayName } from 'src/ts/characterDisplayName'
  import { v4 } from 'uuid'
  import {
    reroll as rerollNav,
    unReroll as unRerollNav,
    newReroll as newRerollNav,
    selectRerollCandidate as selectRerollCandidateNav,
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
    appendCurrentChatEmptyCharMessage,
    appendCurrentChatUserMessageForSend,
    captureActiveChatTarget,
    currentChatScopedSnapshot,
    dispatchDeleteMessageScoped,
    isActiveChatTargetFresh,
    setCurrentChatGreetingIndex,
    type ActiveChatTarget,
  } from 'src/ts/chatCommands'
  import { applyServerBackedSetting } from 'src/ts/server/settingsBridge.svelte'
  import {
    hasChatMessageHydrationFailed,
    hydrateActiveChat,
    hydrateActiveChatFully,
    hydrateActiveChatWindow,
    isChatMessageHydrationPending,
  } from 'src/ts/server/chatMessageHydration.svelte'
  import { buildTranscriptWindowIdentity, getLoadPagesForMessageJump } from './DefaultChatScreen.loadPages'
  import { normalizeChatDisplayTailCount } from 'src/ts/chatDisplayTailCount'
  import { guardActiveChatGenerationSettingsForSend } from 'src/ts/activeChatGenerationSettings'
  import { characterRoutePath, currentRoute, navigate } from 'src/ts/router'
  import { createLatestOperationGuard } from 'src/ts/server/staleStateGuards'
  import PostGenerationScriptProgress from './PostGenerationScriptProgress.svelte'
  import AgentPresetProgress from './AgentPresetProgress.svelte'

  const loadPlaygroundMenu = () => import('../Playground/PlaygroundMenu.svelte').then((m) => m.default)
  const composerFileOperationGuard = createLatestOperationGuard<string>()
  const composerOperationGuard = createLatestOperationGuard<string>()

  type PostChatFileResults = NonNullable<Awaited<ReturnType<typeof postChatFile>>>
  type ComposerFileOperation = {
    token: ReturnType<typeof composerFileOperationGuard.issue>
    targetIdentity: string
    composerVersion: number
  }
  type ComposerOperationKind = 'send' | 'continue'
  type ComposerDraftField = 'message' | 'translation' | 'files'
  type ComposerTextField = 'message' | 'translation'
  type ComposerOperation = {
    token: ReturnType<typeof composerOperationGuard.issue>
    kind: ComposerOperationKind
    targetIdentity: string
    composerVersion: number
    messageInput: string
    messageInputTranslate: string
    fileInput: string[]
  }
  type AutoTranslateOperation = {
    sourceField: ComposerTextField
    targetField: ComposerTextField
    sourceText: string
    targetVersion: number
    targetIdentity: string | null
  }
  type InputTranslationRollback = {
    target: ActiveChatTarget
    transcriptIdentity: string
    messageId: string
    originalText: string
    fileInput: string[]
  }
  type ScreenshotOperation = {
    target: ActiveChatTarget
    transcriptIdentity: string
    previousLoadPages: number
  }

  interface Props {
    openModuleList?: boolean
    openChatList?: boolean
    customStyle?: string
  }

  let messageInput: string = $state('')
  let messageInputTranslate: string = $state('')
  let openMenu = $state(false)
  let chatMenuButton: HTMLButtonElement | null = $state(null)
  let chatMenuElement: HTMLDivElement | null = $state(null)
  let loadPages = $state(normalizeChatDisplayTailCount(getDatabase().chatDisplayTailCount))
  let doingChatInputTranslate = $state(false)
  let toggleStickers: boolean = $state(false)
  let fileInput: string[] = $state([])
  let showNewMessageButton = $state(false)
  let chatsInstance: any = $state()
  let isScrollingToMessage = $state(false)
  let preparingSend = $state(false)
  let scrollToMessageRunId = 0
  let composerMutationVersion = 0
  let messageInputMutationVersion = 0
  let messageInputTranslateMutationVersion = 0
  let activeTranscriptWindowIdentity: string | null = $state(null)
  let activeBgmObserverIdentity: string | null = $state(null)
  let lastInputTranslationRollback: InputTranslationRollback | null = $state(null)
  let activeScreenshotOperation: ScreenshotOperation | null = null
  let { openModuleList = $bindable(false), openChatList = $bindable(false), customStyle = '' }: Props = $props()
  let currentCharacter = $derived(getDatabase().characters[$selectedCharID])
  let activeChatOpen = $derived.by(() => {
    if ($selectedCharID < 0) return false
    const character = getDatabase().characters?.[$selectedCharID]
    if (character?.chaId === '§playground') {
      const activePlaygroundChat = character.chats?.[character.chatPage]
      return $PlaygroundStore === 2 && Array.isArray(activePlaygroundChat?.message)
    }
    return (
      $currentRoute.kind === 'character' &&
      $currentRoute.chaId === character?.chaId &&
      typeof $currentRoute.chatId === 'string'
    )
  })
  let currentChat = $derived(currentCharacter?.chats[currentCharacter.chatPage]?.message ?? [])
  let currentChatId = $derived(currentCharacter?.chats[currentCharacter.chatPage]?.id)
  let canContinueFromMenu = $derived(currentChat.length >= 2 && currentChat[currentChat.length - 1]?.role === 'char')
  let currentChatOwnsGeneration = $derived.by(() => {
    const target = $activeGenerationTarget
    if (!$doingChat || !target || !currentCharacter) return false
    if (target.characterId !== undefined || currentCharacter.chaId !== undefined) {
      if (target.characterId !== currentCharacter.chaId) return false
    } else if (target.selectedCharID !== $selectedCharID) {
      return false
    }
    if (target.chatId !== undefined || currentChatId !== undefined) {
      return target.chatId === currentChatId
    }
    return target.chatPage === currentCharacter.chatPage
  })
  let configuredChatLoadPages = $derived(normalizeChatDisplayTailCount(getDatabase().chatDisplayTailCount))
  // The open chat ships as a message-less shell until the chat-messages resource
  // resolves; show a loading state over the message area until then so the
  // history does not flash in over the greeting-only stub.
  let activeChatMessagesLoading = $derived(
    activeChatOpen && isChatMessageHydrationPending(currentChatId, currentChat.length),
  )
  let activeChatMessagesFailed = $derived(
    activeChatOpen && hasChatMessageHydrationFailed(currentChatId, currentChat.length),
  )

  async function retryActiveChatHydration() {
    await hydrateActiveChat({ force: true })
  }

  function getChatMenuItems(): HTMLButtonElement[] {
    return Array.from(
      chatMenuElement?.querySelectorAll<HTMLButtonElement>('[data-default-chat-menu-item]:not(:disabled)') ?? [],
    )
  }

  function closeChatMenu(options: { restoreFocus?: boolean } = {}): void {
    if (!openMenu) return

    const focusWasInMenu = chatMenuElement?.contains(document.activeElement) ?? false
    openMenu = false

    void tick().then(() => {
      if (!chatMenuButton?.isConnected) return

      const activeElement = document.activeElement
      const focusIsUnclaimed = !activeElement || activeElement === document.body
      if (options.restoreFocus || (focusWasInMenu && focusIsUnclaimed)) {
        chatMenuButton.focus()
      }
    })
  }

  function toggleChatMenu(event: MouseEvent): void {
    event.stopPropagation()

    if (openMenu) {
      closeChatMenu({ restoreFocus: true })
      return
    }

    openMenu = true
    void tick().then(() => {
      getChatMenuItems()[0]?.focus()
    })
  }

  function handleChatMenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeChatMenu({ restoreFocus: true })
      return
    }

    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return

    const items = getChatMenuItems()
    if (items.length === 0) return

    event.preventDefault()
    event.stopPropagation()

    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Home') {
      items[0].focus()
      return
    }
    if (event.key === 'End') {
      items[items.length - 1].focus()
      return
    }

    const nextIndex =
      event.key === 'ArrowDown'
        ? currentIndex < 0
          ? 0
          : (currentIndex + 1) % items.length
        : currentIndex <= 0
          ? items.length - 1
          : currentIndex - 1
    items[nextIndex].focus()
  }

  function scrollToBottom() {
    chatsInstance?.scrollToLatestMessage()
  }

  function getActiveTranscriptWindowIdentity(): string | null {
    const selectedCharacterIndex = $selectedCharID
    const character = getDatabase().characters?.[selectedCharacterIndex]
    const chatPage = character?.chatPage ?? null
    const chat = chatPage === null ? null : character?.chats?.[chatPage]

    return buildTranscriptWindowIdentity({
      selectedCharacterIndex,
      characterId: character?.chaId,
      chatPage,
      chatId: chat?.id,
    })
  }

  function beginScreenshotOperation(): ScreenshotOperation | null {
    const target = captureActiveChatTarget()
    const transcriptIdentity = getActiveTranscriptWindowIdentity()
    if (!target || !transcriptIdentity || !isActiveChatTargetFresh(target)) return null

    const operation = {
      target,
      transcriptIdentity,
      previousLoadPages:
        activeScreenshotOperation?.transcriptIdentity === transcriptIdentity
          ? activeScreenshotOperation.previousLoadPages
          : loadPages,
    }
    activeScreenshotOperation = operation
    return operation
  }

  function isCurrentScreenshotOperation(operation: ScreenshotOperation): boolean {
    return (
      activeScreenshotOperation === operation &&
      getActiveTranscriptWindowIdentity() === operation.transcriptIdentity &&
      isActiveChatTargetFresh(operation.target)
    )
  }

  function restoreScreenshotWindow(operation: ScreenshotOperation): void {
    if (activeScreenshotOperation !== operation) return

    if (getActiveTranscriptWindowIdentity() === operation.transcriptIdentity) {
      loadPages = operation.previousLoadPages
    } else if (loadPages === Infinity) {
      loadPages = configuredChatLoadPages
    }
    activeScreenshotOperation = null
  }

  function markComposerDraftChanged(
    fields: ComposerDraftField | ComposerDraftField[] = ['message', 'translation', 'files'],
  ) {
    const changedFields = Array.isArray(fields) ? fields : [fields]
    composerMutationVersion += 1
    if (changedFields.includes('message')) {
      messageInputMutationVersion += 1
    }
    if (changedFields.includes('translation')) {
      messageInputTranslateMutationVersion += 1
    }
  }

  function beginComposerFileOperation(): ComposerFileOperation | null {
    const targetIdentity = getActiveTranscriptWindowIdentity()
    if (!targetIdentity) return null

    return {
      token: composerFileOperationGuard.issue(targetIdentity),
      targetIdentity,
      composerVersion: composerMutationVersion,
    }
  }

  function isCurrentComposerFileOperation(operation: ComposerFileOperation): boolean {
    return (
      composerFileOperationGuard.isLatest(operation.token) &&
      getActiveTranscriptWindowIdentity() === operation.targetIdentity &&
      composerMutationVersion === operation.composerVersion
    )
  }

  function beginComposerOperation(kind: ComposerOperationKind): ComposerOperation | null {
    const targetIdentity = getActiveTranscriptWindowIdentity()
    if (!targetIdentity) return null

    return {
      token: composerOperationGuard.issue(targetIdentity),
      kind,
      targetIdentity,
      composerVersion: composerMutationVersion,
      messageInput,
      messageInputTranslate,
      fileInput: [...fileInput],
    }
  }

  function isCurrentComposerOperation(operation: ComposerOperation): boolean {
    return (
      composerOperationGuard.isLatest(operation.token) &&
      getActiveTranscriptWindowIdentity() === operation.targetIdentity &&
      composerMutationVersion === operation.composerVersion
    )
  }

  function restoreComposerForCurrentOperation(operation: ComposerOperation): boolean {
    if (!isCurrentComposerOperation(operation)) return false

    messageInput = operation.messageInput
    messageInputTranslate = operation.messageInputTranslate
    fileInput = [...operation.fileInput]
    markComposerDraftChanged()
    updateInputSizeAll()
    return true
  }

  function clearComposerForCurrentOperation(operation: ComposerOperation): boolean {
    if (!isCurrentComposerOperation(operation)) return false

    messageInput = ''
    messageInputTranslate = ''
    fileInput = []
    markComposerDraftChanged()
    updateInputSizeAll()
    return true
  }

  function clearMessageInputForCurrentOperation(operation?: ComposerOperation): boolean {
    if (operation && !isCurrentComposerOperation(operation)) return false

    messageInput = ''
    markComposerDraftChanged('message')
    return true
  }

  function applyChatFileResultsForCurrentComposer(
    results: PostChatFileResults | null,
    operation: ComposerFileOperation,
  ): boolean {
    if (!results || !isCurrentComposerFileOperation(operation)) return false

    let nextMessageInput = messageInput
    const nextFileInput = [...fileInput]
    let changed = false

    for (const res of results) {
      if (res?.type === 'asset') {
        nextFileInput.push(res.data)
        changed = true
      }
      if (res?.type === 'text') {
        nextMessageInput += `{{file::${res.name}::${res.data}}}`
        changed = true
      }
    }

    if (!changed) return false

    messageInput = nextMessageInput
    fileInput = nextFileInput
    markComposerDraftChanged(['message', 'files'])
    updateInputSizeAll()
    return true
  }

  function clearStaleInputTranslationRollback() {
    if (!lastInputTranslationRollback) return
    if (
      !isActiveChatTargetFresh(lastInputTranslationRollback.target) ||
      getActiveTranscriptWindowIdentity() !== lastInputTranslationRollback.transcriptIdentity
    ) {
      lastInputTranslationRollback = null
    }
  }

  function clearInputTranslationRollbackForGenerationStart() {
    clearStaleInputTranslationRollback()
    if (lastInputTranslationRollback) {
      lastInputTranslationRollback = null
    }
  }

  function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (event) => {
        const result = event.target?.result
        if (result instanceof ArrayBuffer) {
          resolve(result)
          return
        }
        reject(new Error('FileReader did not return an ArrayBuffer.'))
      }
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'))
      reader.readAsArrayBuffer(file)
    })
  }

  async function handleComposerPaste(event: ClipboardEvent) {
    const items = event.clipboardData?.items
    if (!items) return

    const files: File[] = []
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image')) {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }

    if (files.length === 0) return

    event.preventDefault()
    const operation = beginComposerFileOperation()
    if (!operation) return

    try {
      const collectedResults: PostChatFileResults = []
      for (const file of files) {
        const buffer = await readFileAsArrayBuffer(file)
        if (!isCurrentComposerFileOperation(operation)) return

        const results = await postChatFile({
          name: file.name,
          data: new Uint8Array(buffer),
        })
        if (!isCurrentComposerFileOperation(operation)) return
        if (results) collectedResults.push(...results)
      }

      applyChatFileResultsForCurrentComposer(collectedResults, operation)
    } catch (error) {
      if (isCurrentComposerFileOperation(operation)) {
        alertError(error)
      }
    } finally {
      composerFileOperationGuard.clear(operation.token)
    }
  }

  async function postFileFromMenu() {
    const operation = beginComposerFileOperation()
    if (!operation) return

    try {
      const results = await postChatFile(messageInput)
      applyChatFileResultsForCurrentComposer(results, operation)
    } finally {
      composerFileOperationGuard.clear(operation.token)
    }
  }

  function resetTranscriptWindowForChatSwitch() {
    loadPages = configuredChatLoadPages
    isScrollingToMessage = false
    scrollToMessageRunId += 1
    chatFoldedState.data = null
    chatFoldedStateMessageIndex.index = -1
  }

  let mostRecentChat = $derived.by(() => {
    const character = getDatabase().characters?.[$selectedCharID]
    return character?.chats?.[character.chatPage] ?? character?.chats?.[0] ?? null
  })

  function openMostRecentChat() {
    const character = getDatabase().characters?.[$selectedCharID]
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
    if (previousIdentity !== nextIdentity) {
      lastInputTranslationRollback = null
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
    const isCurrentJump = () => scrollToMessageRunId === runId && getActiveTranscriptWindowIdentity() === targetIdentity

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

  function shouldRunInputTranslationHook(
    continueResponse: boolean,
    currentCharacter: character | undefined,
    sourceText: string,
  ): boolean {
    return !continueResponse && currentCharacter?.useInputTranslationHook === true && sourceText.trim().length > 0
  }

  function appendInlayMarkers(files: string[]): string {
    return files.map((file) => `{{inlayed::${file}}}`).join('')
  }

  async function runInputTranslationHookForSend(input: {
    composerOperation: ComposerOperation
    activeTarget: ActiveChatTarget
    sourceText: string
    fileSuffix: string
  }): Promise<void> {
    const abortController = createActiveGenerationAbortController()
    doingChatInputTranslate = true
    try {
      const translated = await runInputTranslator(input.sourceText, abortController.signal)
      if (!isActiveChatTargetFresh(input.activeTarget) || !isCurrentComposerOperation(input.composerOperation)) {
        return
      }
      if (translated.trim().length === 0) {
        alertError(language.errors.emptyText)
        return
      }
      const userMessage: Message = {
        role: 'user',
        data: `${translated}${input.fileSuffix}`,
        time: Date.now(),
        name: null,
      }
      const appended = await appendCurrentChatUserMessageForSend(userMessage, { expectedTarget: input.activeTarget })
      if (!isActiveChatTargetFresh(input.activeTarget)) {
        return
      }
      if (appended.status !== 'ok') {
        restoreComposerForCurrentOperation(input.composerOperation)
        alertError(appended.error)
        await sleep(10)
        return
      }
      lastInputTranslationRollback = {
        target: input.activeTarget,
        transcriptIdentity: input.composerOperation.targetIdentity,
        messageId: appended.messageId,
        originalText: input.sourceText,
        fileInput: [...input.composerOperation.fileInput],
      }
      clearComposerForCurrentOperation(input.composerOperation)
      await sleep(10)
      updateInputSizeAll()
    } catch (error) {
      if (!abortController.signal.aborted) {
        restoreComposerForCurrentOperation(input.composerOperation)
        alertError(error)
        await sleep(10)
      }
    } finally {
      doingChatInputTranslate = false
      clearActiveGenerationAbortController(abortController)
    }
  }

  function rollbackLastInputTranslation() {
    clearStaleInputTranslationRollback()
    const rollback = lastInputTranslationRollback
    if (!rollback) return

    const previous = currentChatScopedSnapshot()
    dispatchDeleteMessageScoped(rollback.messageId, previous)
    messageInput = rollback.originalText
    messageInputTranslate = ''
    fileInput = [...rollback.fileInput]
    markComposerDraftChanged()
    lastInputTranslationRollback = null
    updateInputSizeAll()
  }

  async function sendMain(continueResponse: boolean) {
    if ($doingChat || preparingSend) {
      return
    }
    const activeTarget = captureActiveChatTarget()
    if (!activeTarget || !isActiveChatTargetFresh(activeTarget)) {
      return
    }
    const selectedChar = activeTarget.selectedCharID
    preparingSend = true
    const composerOperation = beginComposerOperation(continueResponse ? 'continue' : 'send')
    try {
      if (!composerOperation) {
        return
      }
      const generationSettingsGuard = guardActiveChatGenerationSettingsForSend()
      if (generationSettingsGuard.status === 'error') {
        alertError(generationSettingsGuard.error)
        await sleep(10)
        updateInputSizeAll()
        return
      }

      resetRerollOnCharChange()
      await hydrateActiveChatFully()
      if (
        composerOperation.targetIdentity !== getActiveTranscriptWindowIdentity() ||
        !isActiveChatTargetFresh(activeTarget)
      ) {
        return
      }

      const currentChatRecord =
        getDatabase().characters[selectedChar].chats[getDatabase().characters[selectedChar].chatPage]
      let userMessage: Message | null = null
      const composerBeforeSend = composerOperation.messageInput
      const translatedComposerBeforeSend = composerOperation.messageInputTranslate
      const filesBeforeSend = [...composerOperation.fileInput]

      if (!continueResponse && composerBeforeSend.startsWith('/')) {
        const commandProcessed = await processMultiCommand(composerBeforeSend)
        if (commandProcessed !== false) {
          if (clearMessageInputForCurrentOperation(composerOperation)) {
            updateInputSizeAll()
          }
          return
        }
      }

      const fileSuffix = appendInlayMarkers(filesBeforeSend)
      let messageForSend = composerBeforeSend + fileSuffix

      if (shouldRunInputTranslationHook(continueResponse, getDatabase().characters[selectedChar], composerBeforeSend)) {
        await runInputTranslationHookForSend({
          composerOperation,
          activeTarget,
          sourceText: composerBeforeSend,
          fileSuffix,
        })
        return
      }

      if (!continueResponse) {
        if (messageForSend === '') {
          const messages = currentChatRecord.message ?? []
          if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
            if (getDatabase().useSayNothing) {
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
            data: messageForSend,
            time: Date.now(),
            name: null,
          }
        }
      }
      if (userMessage) {
        const appended = await appendCurrentChatUserMessageForSend(userMessage, { expectedTarget: activeTarget })
        if (!isActiveChatTargetFresh(activeTarget)) {
          return
        }
        if (appended.status !== 'ok') {
          restoreComposerForCurrentOperation({
            ...composerOperation,
            messageInput: composerBeforeSend,
            messageInputTranslate: translatedComposerBeforeSend,
            fileInput: filesBeforeSend,
          })
          alertError(appended.error)
          await sleep(10)
          return
        }
      }
      if (!isActiveChatTargetFresh(activeTarget)) {
        return
      }
      if (!continueResponse) {
        clearComposerForCurrentOperation(composerOperation)
      }
      await sleep(10)
      if (!isActiveChatTargetFresh(activeTarget)) {
        return
      }
      // Clear the reroll buffer only after send/continue succeeds.
      await sendChatMain(continueResponse, undefined, true, composerOperation, activeTarget)
    } finally {
      if (composerOperation) {
        composerOperationGuard.clear(composerOperation.token)
      }
      preparingSend = false
    }
  }

  async function reroll() {
    if ($doingChat) {
      return
    }
    const targetIdentity = getActiveTranscriptWindowIdentity()
    await hydrateActiveChatFully()
    if (getActiveTranscriptWindowIdentity() !== targetIdentity) return
    await rerollNav({ sendChatMain, closeMenu: closeChatMenu })
  }

  async function unReroll() {
    if ($doingChat) {
      return
    }
    const targetIdentity = getActiveTranscriptWindowIdentity()
    await hydrateActiveChatFully()
    if (getActiveTranscriptWindowIdentity() !== targetIdentity) return
    await unRerollNav()
  }

  async function newReroll() {
    if ($doingChat) {
      return
    }
    const targetIdentity = getActiveTranscriptWindowIdentity()
    await hydrateActiveChatFully()
    if (getActiveTranscriptWindowIdentity() !== targetIdentity) return
    await newRerollNav({ sendChatMain, closeMenu: closeChatMenu })
  }

  async function selectRerollCandidate(index: number) {
    if ($doingChat) {
      return
    }
    const targetIdentity = getActiveTranscriptWindowIdentity()
    await hydrateActiveChatFully()
    if (getActiveTranscriptWindowIdentity() !== targetIdentity) return
    await selectRerollCandidateNav(index)
  }

  function playSendSoundIfEnabled() {
    if (getDatabase().playMessage) {
      const audio = new Audio(sendSound)
      audio.play().catch(() => {})
    }
  }

  async function sendChatMain(
    continued: boolean = false,
    regenerateMessageId?: string,
    confirmBoundary: boolean = false,
    composerOperation?: ComposerOperation,
    expectedTarget?: ActiveChatTarget | null,
  ) {
    if (expectedTarget !== undefined && !isActiveChatTargetFresh(expectedTarget)) {
      return
    }
    const currentCharacter = getDatabase().characters[$selectedCharID]
    const currentChatRecord = currentCharacter?.chats[currentCharacter.chatPage]
    if (!currentChatRecord) {
      return
    }
    let previousLength = currentChatRecord.message.length
    if (!continued) {
      clearMessageInputForCurrentOperation(composerOperation)
    }
    const abortController = createActiveGenerationAbortController()
    try {
      clearInputTranslationRollbackForGenerationStart()
      const ok = await sendChat(-1, {
        signal: abortController.signal,
        continue: continued,
        regenerateMessageId,
        ...(expectedTarget !== undefined ? { expectedTarget } : {}),
      })
      if (expectedTarget !== undefined && !isActiveChatTargetFresh(expectedTarget)) {
        return
      }
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
    return {
      currentUsername: getUserDisplayName(),
      userIconPortrait: getUserIconProtrait(),
      userIcon: getUserIcon(),
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

  $effect(() => {
    const hasMessageInput = messageInput.length > 0
    const hasMessageInputTranslate = messageInputTranslate.length > 0
    const hasInputEle = Boolean(inputEle)
    const hasInputTranslateEle = Boolean(inputTranslateEle)

    if (hasMessageInput || hasMessageInputTranslate || hasInputEle || hasInputTranslateEle) {
      updateInputSizeAll()
    }
  })

  function getComposerTextFieldValue(field: ComposerTextField): string {
    return field === 'message' ? messageInput : messageInputTranslate
  }

  function getComposerTextFieldVersion(field: ComposerTextField): number {
    return field === 'message' ? messageInputMutationVersion : messageInputTranslateMutationVersion
  }

  function isCurrentAutoTranslateOperation(operation: AutoTranslateOperation): boolean {
    return (
      getActiveTranscriptWindowIdentity() === operation.targetIdentity &&
      getComposerTextFieldValue(operation.sourceField) === operation.sourceText &&
      getComposerTextFieldVersion(operation.targetField) === operation.targetVersion
    )
  }

  function applyAutoTranslateResult(operation: AutoTranslateOperation, translatedMessage: string): boolean {
    if (!translatedMessage || !isCurrentAutoTranslateOperation(operation)) return false

    if (operation.targetField === 'message') {
      messageInput = translatedMessage
      markComposerDraftChanged('message')
    } else {
      messageInputTranslate = translatedMessage
      markComposerDraftChanged('translation')
    }
    return true
  }

  async function translateComposerInputForCurrentFields(reverse: boolean, delayMs = 0) {
    const sourceField: ComposerTextField = reverse ? 'translation' : 'message'
    const targetField: ComposerTextField = reverse ? 'message' : 'translation'
    const operation: AutoTranslateOperation = {
      sourceField,
      targetField,
      sourceText: getComposerTextFieldValue(sourceField),
      targetVersion: getComposerTextFieldVersion(targetField),
      targetIdentity: getActiveTranscriptWindowIdentity(),
    }

    if (delayMs > 0) {
      await sleep(delayMs)
      if (!isCurrentAutoTranslateOperation(operation)) return
    }

    if (!isCurrentAutoTranslateOperation(operation)) return
    const translatedMessage = await translate(operation.sourceText, reverse)
    applyAutoTranslateResult(operation, translatedMessage)
  }

  async function updateInputTransateMessage(reverse: boolean) {
    if (!getDatabase().useAutoTranslateInput) {
      return
    }
    if (isExpTranslator()) {
      if (!reverse) {
        if (messageInputTranslate !== '') {
          messageInputTranslate = ''
          markComposerDraftChanged('translation')
        }
        return
      }
      if (messageInputTranslate === '') {
        if (messageInput !== '') {
          messageInput = ''
          markComposerDraftChanged('message')
        }
        return
      }
      await translateComposerInputForCurrentFields(reverse, 1500)
      return
    }
    if (reverse && messageInputTranslate === '') {
      if (messageInput !== '') {
        messageInput = ''
        markComposerDraftChanged('message')
      }
      return
    }
    if (!reverse && messageInput === '') {
      if (messageInputTranslate !== '') {
        messageInputTranslate = ''
        markComposerDraftChanged('translation')
      }
      return
    }
    await translateComposerInputForCurrentFields(reverse)
  }

  async function screenShot() {
    const operation = beginScreenshotOperation()
    if (!operation) return

    let canvases: Array<HTMLCanvasElement | null> = []
    let mergedCanvas: HTMLCanvasElement | null = null
    let waitHandle: AlertWaitHandle | null = null
    try {
      await hydrateActiveChatFully()
      if (!isCurrentScreenshotOperation(operation)) return

      loadPages = Infinity
      await tick()
      if (!isCurrentScreenshotOperation(operation)) return

      const html2canvas = await import('html-to-image')
      if (!isCurrentScreenshotOperation(operation)) return

      const chats = document.querySelectorAll('.default-chat-screen .risu-chat')
      waitHandle = beginAlertWait('Taking screenShot...')

      for (const chat of chats) {
        const cnv = await html2canvas.toCanvas(chat as HTMLElement)
        canvases.push(cnv)
        if (!isCurrentScreenshotOperation(operation)) return

        updateAlertWait(waitHandle, 'Taking screenShot... ' + canvases.length + '/' + chats.length)
      }

      canvases.reverse()

      updateAlertWait(waitHandle, 'Merging images...')

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

      const themeBackground = getComputedStyle(document.documentElement).getPropertyValue('--risu-theme-bgcolor').trim()
      mergedCtx.fillStyle = themeBackground || '#282a36'
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
        if (!isCurrentScreenshotOperation(operation)) return

        await downloadFile(`chat-${v4()}.png`, Buffer.from(mergedCanvas.toDataURL('png').split(',').at(-1), 'base64'))
        if (!isCurrentScreenshotOperation(operation)) return

        mergedCanvas.remove()
        mergedCanvas = null
      }
      alertNormal(language.screenshotSaved)
    } catch (error) {
      if (!isCurrentScreenshotOperation(operation)) return

      console.error(error)
      alertError('Error while taking screenshot')
    } finally {
      for (const canvas of canvases) {
        canvas?.remove()
      }
      mergedCanvas?.remove()
      if (waitHandle) clearAlertWait(waitHandle)
      restoreScreenshotWindow(operation)
    }
  }

  function updateGreetingIndex(fmIndex: number) {
    setCurrentChatGreetingIndex(fmIndex, { selectedChar: $selectedCharID })
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="w-full h-full relative"
  style={customStyle}
  onclick={() => {
    closeChatMenu()
  }}>
  {#if showNewMessageButton}
    {#if getDatabase().newMessageButtonStyle === 'bottom-center' || !getDatabase().newMessageButtonStyle}
      <button
        class="absolute bottom-16 left-1/2 -translate-x-1/2 bg-blue-500 text-white px-4 py-2 rounded-full shadow-lg z-50 flex items-center gap-2 hover:bg-blue-600 transition-colors"
        onclick={scrollToBottom}>
        <ArrowDown size={16} />
        <span>{language.newMessage}</span>
      </button>
    {/if}

    {#if getDatabase().newMessageButtonStyle === 'bottom-right'}
      <button
        class="absolute bottom-20 right-4 bg-blue-500 text-white px-4 py-2 rounded-full shadow-lg z-50 flex items-center gap-2 hover:bg-blue-600 transition-colors"
        onclick={scrollToBottom}>
        <ArrowDown size={16} />
        <span>{language.newMessage}</span>
      </button>
    {/if}

    {#if getDatabase().newMessageButtonStyle === 'bottom-left'}
      <button
        class="absolute bottom-20 left-4 bg-blue-500 text-white px-4 py-2 rounded-full shadow-lg z-50 flex items-center gap-2 hover:bg-blue-600 transition-colors"
        onclick={scrollToBottom}>
        <ArrowDown size={16} />
        <span>{language.newMessage}</span>
      </button>
    {/if}

    {#if getDatabase().newMessageButtonStyle === 'floating-circle'}
      <button
        class="absolute bottom-36 right-4 bg-blue-500 text-white w-12 h-12 rounded-full shadow-lg z-50 flex items-center justify-center hover:bg-blue-600 transition-colors"
        onclick={scrollToBottom}
        title="4. 원형 (우하단)">
        <ArrowDown size={20} />
      </button>
    {/if}

    {#if getDatabase().newMessageButtonStyle === 'right-center'}
      <button
        class="absolute top-1/2 right-2 -translate-y-1/2 bg-blue-500 text-white px-2 py-3 rounded-l-lg shadow-lg z-50 flex flex-col items-center gap-1 hover:bg-blue-600 transition-colors"
        onclick={scrollToBottom}>
        <ArrowDown size={14} />
        <span class="text-xs writing-mode-vertical">{language.newMessage}</span>
      </button>
    {/if}

    {#if getDatabase().newMessageButtonStyle === 'top-bar'}
      <button
        class="absolute top-2 left-1/2 -translate-x-1/2 bg-blue-500 text-white px-6 py-1.5 rounded-full shadow-lg z-50 flex items-center gap-2 hover:bg-blue-600 transition-colors text-sm"
        onclick={scrollToBottom}>
        <ArrowDown size={14} />
        <span>{language.newMessage}</span>
      </button>
    {/if}
  {/if}
  {#if isScrollingToMessage}
    <div
      class="absolute inset-0 z-50 flex items-center justify-center bg-black/50 text-white text-xl font-bold backdrop-blur-sm">
      Loading...
    </div>
  {/if}
  {#if $selectedCharID >= 0 && activeChatMessagesLoading}
    <div class="absolute inset-0 z-40 flex items-center justify-center bg-bgcolor">
      <div class="flex flex-col items-center text-textcolor2">
        <svg class="animate-spin h-6 w-6 mb-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
        <span class="text-sm">{language.loadingChatData}</span>
      </div>
    </div>
  {/if}
  {#if $selectedCharID >= 0 && activeChatMessagesFailed}
    <div
      class="absolute inset-0 z-40 flex items-center justify-center bg-bgcolor px-6"
      role="alert"
      data-testid="chat-hydration-error">
      <div class="flex flex-col items-center gap-3 text-center text-textcolor2">
        <span class="text-sm">{language.chatDataLoadFailed}</span>
        <button
          type="button"
          class="flex items-center gap-2 rounded-md border border-darkborderc px-3 py-2 text-sm text-textcolor transition-colors hover:border-textcolor hover:bg-selected focus:border-textcolor focus:bg-selected"
          onclick={retryActiveChatHydration}>
          <RefreshCcwIcon size={16} />
          <span>{language.retry}</span>
        </button>
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
    <div class="h-full w-full flex flex-col items-center justify-center text-center px-6" data-risu-chat-empty-state>
      <h2 class="text-2xl font-bold mb-2">{getCharacterDisplayName(getDatabase().characters[$selectedCharID])}</h2>
      <p class="text-textcolor2">{language.selectChatToOpen}</p>
      {#if mostRecentChat}
        <Button className="mt-4 flex flex-col gap-2" onclick={openMostRecentChat}>
          <div class="flex flex-row gap-2 items-center">
            <StepForwardIcon size={18} />
            <span>{language.openMostRecentChat}</span>
          </div>
          <hr class="border-darkborderc w-full" />
          <span class="max-w-full truncate text-sm text-textcolor2">{mostRecentChat.name}</span>
        </Button>
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
          getDatabase().characters[$selectedCharID].chats[getDatabase().characters[$selectedCharID].chatPage].message
            .length > loadPages
        ) {
          void expandTranscriptWindow(loadPages + 15)
        }
        const chatTarget = e.target as HTMLElement
        const chatsContainer =
          getDatabase().fixedChatTextarea && chatTarget.children[1] ? chatTarget.children[1] : chatTarget.children[0]
        const lastEl = chatsContainer?.firstElementChild
        const isAtBottom = lastEl
          ? lastEl.getBoundingClientRect().top <= chatTarget.getBoundingClientRect().bottom + 100
          : true
        if (isAtBottom) {
          showNewMessageButton = false
        }
      }}>
      <div
        class="{getDatabase().fixedChatTextarea
          ? 'sticky pt-2 pb-2 right-0 bottom-0 bg-bgcolor'
          : 'mt-2 mb-2'} flex items-stretch w-full"
        style={getDatabase().fixedChatTextarea ? 'z-index:29;' : ''}>
        {#if getDatabase().useChatSticker}
          <button
            type="button"
            aria-label={language.stickers}
            aria-pressed={toggleStickers}
            onclick={() => {
              toggleStickers = !toggleStickers
            }}
            class={'ml-4 bg-textcolor2 flex justify-center items-center  w-12 h-12 rounded-md hover:bg-blue-500 transition-colors ' +
              (toggleStickers ? 'text-green-500' : 'text-textcolor')}>
            <Laugh />
          </button>
        {/if}

        <textarea
          data-testid="default-chat-composer"
          aria-label={language.messageInput}
          class="peer text-input-area focus:border-textcolor transition-colors outline-hidden text-textcolor p-2 min-w-0 border border-r-0 bg-transparent rounded-md rounded-r-none input-text text-xl grow ml-4 border-darkborderc resize-none overflow-y-hidden overflow-x-hidden max-w-full placeholder:text-sm"
          bind:value={messageInput}
          bind:this={inputEle}
          onkeydown={(e) => {
            if (e.key.toLocaleLowerCase() === 'enter' && !e.isComposing) {
              if (getDatabase().sendWithEnter && !e.shiftKey) {
                send()
                e.preventDefault()
              } else if (!getDatabase().sendWithEnter && e.shiftKey) {
                send()
                e.preventDefault()
              }
            }
            if (e.key.toLocaleLowerCase() === 'm' && e.ctrlKey) {
              reroll()
              e.preventDefault()
            }
          }}
          onpaste={(e) => void handleComposerPaste(e)}
          oninput={() => {
            markComposerDraftChanged('message')
            updateInputSizeAll()
            updateInputTransateMessage(false)
          }}
          style:height={inputHeight}></textarea>

        {#if currentChatOwnsGeneration || doingChatInputTranslate}
          <button
            data-testid="default-chat-cancel-button"
            aria-label={language.cancelGeneration}
            class="peer-focus:border-textcolor flex justify-center border-y border-darkborderc items-center text-textcolor p-3 hover:bg-blue-500 hover:text-white transition-colors"
            onclick={abortChat}
            style:height={inputHeight}>
            <div class="loadmove chat-process-stage-{$chatProcessStage}"></div>
          </button>
        {:else}
          <button
            data-testid="default-chat-send-button"
            aria-label={language.hotkeyDesc.send}
            onclick={send}
            disabled={$doingChat}
            class="flex justify-center border-y border-darkborderc items-center text-textcolor p-3 peer-focus:border-textcolor hover:bg-blue-500 hover:text-white transition-colors button-icon-send disabled:cursor-not-allowed disabled:opacity-50"
            style:height={inputHeight}>
            <Send />
          </button>
        {/if}
        {#if getDatabase().characters[$selectedCharID]?.chaId !== '§playground'}
          <button
            bind:this={chatMenuButton}
            type="button"
            data-testid="default-chat-menu-button"
            aria-label={language.menu}
            aria-expanded={openMenu}
            aria-haspopup="menu"
            aria-controls="default-chat-overflow-menu"
            onclick={toggleChatMenu}
            class="peer-focus:border-textcolor mr-2 flex border-y border-r border-darkborderc justify-center items-center text-textcolor p-3 rounded-r-md hover:bg-blue-500 hover:text-white transition-colors"
            style:height={inputHeight}>
            <MenuIcon />
          </button>
        {:else}
          <button
            type="button"
            aria-label={language.addEmptyMessage}
            onclick={() => appendCurrentChatEmptyCharMessage()}
            class="peer-focus:border-textcolor mr-2 flex border-y border-r border-darkborderc justify-center items-center text-textcolor p-3 rounded-r-md hover:bg-blue-500 hover:text-white transition-colors"
            style:height={inputHeight}>
            <Plus />
          </button>
        {/if}
      </div>
      {#if lastInputTranslationRollback && getDatabase().characters[$selectedCharID]?.chaId !== '§playground'}
        <div class="flex justify-end mr-2">
          <button
            data-testid="default-chat-input-translation-rollback"
            class="flex items-center gap-2 rounded-md border border-darkborderc px-3 py-2 text-sm text-textcolor transition-colors hover:border-textcolor hover:bg-selected"
            title={language.rollbackInputTranslation}
            aria-label={language.rollbackInputTranslation}
            onclick={rollbackLastInputTranslation}>
            <Undo2Icon size={16} />
            <span>{language.rollbackInputTranslation}</span>
          </button>
        </div>
      {/if}
      {#if getDatabase().useAutoTranslateInput && getDatabase().characters[$selectedCharID]?.chaId !== '§playground'}
        <div class="flex items-center mt-2 mb-2">
          <label for="messageInputTranslate" class="text-textcolor ml-4">
            <LanguagesIcon />
          </label>
          <textarea
            aria-label={language.messageInput}
            id="messageInputTranslate"
            class="text-textcolor rounded-md p-2 min-w-0 bg-transparent input-text text-xl grow ml-4 mr-2 border-darkbutton resize-none focus:bg-selected overflow-y-hidden overflow-x-hidden max-w-full"
            bind:value={messageInputTranslate}
            bind:this={inputTranslateEle}
            onkeydown={(e) => {
              if (e.key.toLocaleLowerCase() === 'enter' && !e.shiftKey) {
                if (getDatabase().sendWithEnter) {
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
              markComposerDraftChanged('translation')
              updateInputSizeAll()
              updateInputTransateMessage(true)
            }}
            placeholder={language.enterMessageForTranslateToEnglish}
            style:height={inputTranslateHeight}></textarea>
        </div>
      {/if}

      {#if fileInput.length > 0}
        <div class="flex items-center ml-4 flex-wrap p-2 m-2 border-darkborderc border rounded-md">
          {#each fileInput as file, i}
            {#await getInlayAsset(file) then inlayAsset}
              <div class="relative">
                {#if !inlayAsset}
                  <div
                    class="w-48 h-24 border border-darkborderc rounded-md flex items-center justify-center text-textcolor2">
                    Missing file
                  </div>
                {:else if inlayAsset.type === 'image'}
                  <img src={inlayAsset.data} alt="Inlay" class="max-w-48 max-h-48 border border-darkborderc" />
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
                    markComposerDraftChanged('files')
                    updateInputSizeAll()
                  }}>
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
              markComposerDraftChanged('message')
              updateInputSizeAll()
            }} />
        </div>
      {/if}

      {#if getDatabase().useAutoSuggestions}
        <Suggestion
          messageInput={(msg) => {
            messageInput =
              (getDatabase().subModel === 'textgen_webui' ||
                getDatabase().subModel === 'mancer' ||
                getDatabase().subModel.startsWith('local_')) &&
              getDatabase().autoSuggestClean
                ? msg.replace(/ +\(.+?\) *$| - [^"'*]*?$/, '')
                : msg
            markComposerDraftChanged('message')
          }}
          {send} />
      {/if}

      {#if getDatabase().characters[$selectedCharID].chats[getDatabase().characters[$selectedCharID].chatPage].message?.[0]?.data?.startsWith(coldStorageHeader)}
        {#await preLoadChat($selectedCharID, getDatabase().characters[$selectedCharID].chatPage)}
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
              }}>
              {language.loadMore}
            </Button>
          </button>
        {/if}

        <AgentPresetProgress />
        <PostGenerationScriptProgress characterId={currentCharacter.chaId} chatId={currentChatId} />

        <Chats
          bind:this={chatsInstance}
          messages={currentChat}
          {loadPages}
          onReroll={reroll}
          {unReroll}
          onNewReroll={newReroll}
          onSelectRerollCandidate={selectRerollCandidate}
          {currentCharacter}
          {currentUsername}
          {userIcon}
          {userIconPortrait}
          isGenerationActive={currentChatOwnsGeneration}
          bind:hasNewUnreadMessage={showNewMessageButton} />

        <!-- A bootstrap shell strips firstMessage/alternateGreetings (not in
             BOOTSTRAP_CHARACTER_SHELL_FIELDS); skip the greeting render until the
             row hydrates so the unguarded `alternateGreetings.length` reads below
             cannot throw on the correct lazy-shell state. -->
        {#if !isServerCharacterShell(currentCharacter) && getDatabase().characters[$selectedCharID].chats[getDatabase().characters[$selectedCharID].chatPage].message.length <= loadPages}
          <Chat
            character={createSimpleCharacter(getDatabase().characters[$selectedCharID])}
            name={getCharacterDisplayName(getDatabase().characters[$selectedCharID])}
            message={getDatabase().characters[$selectedCharID].chats[getDatabase().characters[$selectedCharID].chatPage]
              .fmIndex === -1
              ? getDatabase().characters[$selectedCharID].firstMessage
              : getDatabase().characters[$selectedCharID].alternateGreetings[
                  getDatabase().characters[$selectedCharID].chats[getDatabase().characters[$selectedCharID].chatPage]
                    .fmIndex
                ]}
            role="char"
            img={getCharImage(getDatabase().characters[$selectedCharID].image, 'css')}
            idx={-1}
            altGreeting={getDatabase().characters[$selectedCharID].alternateGreetings.length > 0}
            largePortrait={getDatabase().characters[$selectedCharID].largePortrait}
            firstMessage={true}
            onReroll={() => {
              const cha = getDatabase().characters[$selectedCharID]
              const chat =
                getDatabase().characters[$selectedCharID].chats[getDatabase().characters[$selectedCharID].chatPage]
              if (chat.fmIndex >= cha.alternateGreetings.length - 1) {
                updateGreetingIndex(-1)
              } else {
                updateGreetingIndex(chat.fmIndex + 1)
              }
            }}
            unReroll={() => {
              const cha = getDatabase().characters[$selectedCharID]
              const chat =
                getDatabase().characters[$selectedCharID].chats[getDatabase().characters[$selectedCharID].chatPage]
              if (chat.fmIndex === -1) {
                updateGreetingIndex(cha.alternateGreetings.length - 1)
              } else {
                updateGreetingIndex(chat.fmIndex - 1)
              }
            }}
            isLastMemory={false}
            currentPage={(getDatabase().characters[$selectedCharID].chats[
              getDatabase().characters[$selectedCharID].chatPage
            ].fmIndex ?? -1) + 2}
            totalPages={getDatabase().characters[$selectedCharID].alternateGreetings.length + 1} />
          {#if aiLawApplies() && getDatabase().characters[$selectedCharID].chats[getDatabase().characters[$selectedCharID].chatPage].message.length === 0}
            <div class="ml-auto mr-auto mt-4 text-textcolor2 italic max-w-2/3 wrap-break-word text-center">
              {language.aiGenerationWarning}
            </div>
          {/if}
          {#if !getDatabase().characters[$selectedCharID].removedQuotes && getDatabase().characters[$selectedCharID].creatorNotes.length >= 2}
            <CreatorQuote
              quote={getDatabase().characters[$selectedCharID].creatorNotes}
              onRemove={() => {
                const cha = getCharacterByIndex($selectedCharID, { snapshot: true })
                cha.removedQuotes = true
                setCharacterByIndex($selectedCharID, cha)
              }} />
          {/if}
        {/if}
      {/if}

      {#if openMenu}
        <div
          bind:this={chatMenuElement}
          id="default-chat-overflow-menu"
          data-testid="default-chat-overflow-menu"
          role="menu"
          tabindex="-1"
          aria-label={language.menu}
          class="{getDatabase().fixedChatTextarea
            ? 'fixed'
            : 'absolute'} right-2 bottom-16 p-5 bg-darkbg flex flex-col gap-3 text-textcolor rounded-md"
          onkeydown={handleChatMenuKeydown}
          onclick={(e) => {
            e.stopPropagation()
          }}>
          <!-- svelte-ignore block_empty -->
          {#if getDatabase().characters[$selectedCharID].ttsMode && getDatabase().characters[$selectedCharID].ttsMode !== 'none'}
            <button
              type="button"
              role="menuitem"
              data-default-chat-menu-item
              class="flex w-full items-center cursor-pointer text-left hover:text-green-500 transition-colors"
              onclick={() => {
                stopTTS()
              }}>
              <MicOffIcon />
              <span class="ml-2">{language.ttsStop}</span>
            </button>
          {/if}

          <button
            type="button"
            role="menuitem"
            data-default-chat-menu-item
            disabled={!canContinueFromMenu}
            class="flex w-full items-center cursor-pointer text-left hover:text-green-500 transition-colors disabled:cursor-not-allowed disabled:text-textcolor2"
            onclick={sendContinue}>
            <StepForwardIcon />
            <span class="ml-2">{language.continueResponse}</span>
          </button>

          {#if getDatabase().showMenuChatList}
            <button
              type="button"
              role="menuitem"
              data-default-chat-menu-item
              class="flex w-full items-center cursor-pointer text-left hover:text-green-500 transition-colors"
              onclick={() => {
                openChatList = true
                closeChatMenu()
              }}>
              <DatabaseIcon />
              <span class="ml-2">{language.chatList}</span>
            </button>
          {/if}

          {#if getDatabase().enableRisuaiProTools}
            <button
              type="button"
              role="menuitem"
              data-default-chat-menu-item
              class="flex w-full items-center cursor-pointer text-left hover:text-green-500 transition-colors"
              onclick={() => {
                easyPanelStore.open = !easyPanelStore.open
              }}>
              <SparkleIcon />
              <span class="ml-2">{language.easyPanel}</span>
            </button>
          {/if}

          {#each additionalChatMenu as menu}
            <button
              type="button"
              role="menuitem"
              data-default-chat-menu-item
              class="flex w-full items-center cursor-pointer text-left hover:text-green-500 transition-colors"
              onclick={() => {
                menu.callback()
                closeChatMenu()
              }}>
              <PluginDefinedIcon ico={menu} />
              <span class="ml-2">{menu.name}</span>
            </button>
          {/each}

          {#if getDatabase().showMenuHypaMemoryModal && getDatabase().hypaV3}
            <button
              type="button"
              role="menuitem"
              data-default-chat-menu-item
              class="flex w-full items-center cursor-pointer text-left hover:text-green-500 transition-colors"
              onclick={() => {
                $hypaV3ModalOpen = true
                closeChatMenu()
              }}>
              <BrainIcon />
              <span class="ml-2">{language.hypaMemoryV3Modal}</span>
            </button>
          {/if}

          {#if getDatabase().translator !== ''}
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={getDatabase().useAutoTranslateInput}
              data-default-chat-menu-item
              class={'flex w-full items-center cursor-pointer text-left ' +
                (getDatabase().useAutoTranslateInput ? 'text-green-500' : 'lg:hover:text-green-500')}
              onclick={() => {
                applyServerBackedSetting('useAutoTranslateInput', !getDatabase().useAutoTranslateInput)
              }}>
              <GlobeIcon />
              <span class="ml-2">{language.autoTranslateInput}</span>
            </button>
          {/if}

          <button
            type="button"
            role="menuitem"
            data-default-chat-menu-item
            data-testid="default-chat-screenshot-button"
            class="flex w-full items-center cursor-pointer text-left hover:text-green-500 transition-colors"
            onclick={() => {
              screenShot()
            }}>
            <CameraIcon />
            <span class="ml-2">{language.screenshot}</span>
          </button>

          <button
            type="button"
            role="menuitem"
            data-default-chat-menu-item
            class="flex w-full items-center cursor-pointer text-left hover:text-green-500 transition-colors"
            onclick={postFileFromMenu}>
            <ImagePlusIcon />
            <span class="ml-2">{language.postFile}</span>
          </button>

          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={getDatabase().useAutoSuggestions}
            data-default-chat-menu-item
            class={'flex w-full items-center cursor-pointer text-left ' +
              (getDatabase().useAutoSuggestions ? 'text-green-500' : 'lg:hover:text-green-500')}
            onclick={async () => {
              applyServerBackedSetting('useAutoSuggestions', !getDatabase().useAutoSuggestions)
            }}>
            <ReplyIcon />
            <span class="ml-2">{language.autoSuggest}</span>
          </button>

          <button
            type="button"
            role="menuitem"
            data-default-chat-menu-item
            class="flex w-full items-center cursor-pointer text-left hover:text-green-500 transition-colors"
            onclick={() => {
              openModuleList = true
              closeChatMenu()
            }}>
            <PackageIcon />
            <span class="ml-2">{language.modules}</span>
          </button>

          {#if getDatabase().sideMenuRerollButton}
            <button
              type="button"
              role="menuitem"
              data-default-chat-menu-item
              class="flex w-full items-center cursor-pointer text-left hover:text-green-500 transition-colors"
              onclick={reroll}>
              <RefreshCcwIcon />
              <span class="ml-2">{language.reroll}</span>
            </button>
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
        }}>
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
