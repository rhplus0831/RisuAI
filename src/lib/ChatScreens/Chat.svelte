<script lang="ts">
  import { untrack } from 'svelte'
  import {
    ArrowLeft,
    ArrowLeftRightIcon,
    ArrowRight,
    BookmarkIcon,
    BotIcon,
    CopyIcon,
    PowerOff,
    GitBranch,
    HamburgerIcon,
    LanguagesIcon,
    LoaderCircleIcon,
    PencilIcon,
    RefreshCcwIcon,
    SplitIcon,
    TrashIcon,
    UserIcon,
    Volume2Icon,
    Scissors,
  } from '@lucide/svelte'
  import {
    aiLawApplies,
    changeChatTo,
    foldChatToMessage,
    getFileSrc,
    createChatCopyName,
  } from 'src/ts/globalApi.svelte'
  import { ColorSchemeTypeStore } from 'src/ts/gui/colorscheme'
  import { longpress } from 'src/ts/gui/longtouch'
  import { getModelInfo } from 'src/ts/model/modellist'
  import { runLuaButtonTrigger } from 'src/ts/process/scriptings'
  import { risuChatParser } from 'src/ts/process/scripts'
  import {
    clearManualTriggerAbortController,
    createManualTriggerAbortController,
    runTrigger,
  } from 'src/ts/process/triggers'
  import { sayTTS } from 'src/ts/process/tts'
  import {
    DBState,
    ReloadChatPointer,
    CurrentTriggerIdStore,
    popupStore,
    refreshVariableOnlyGui,
    SizeStore,
    popUpEditorStore,
  } from 'src/ts/stores.svelte'
  import { capitalize, getUserDisplayName, getUserIcon, sleep } from 'src/ts/util'
  import { v4 as uuidv4, v4 } from 'uuid'
  import { language } from '../../lang'
  import { alertClear, alertConfirm, alertInput, alertNormal, alertRequestData, alertWait } from '../../ts/alert'
  import { ParseMarkdown, type CbsConditions, type simpleCharacterArgument } from '../../ts/parser/parser.svelte'
  import {
    getCurrentCharacter,
    getCurrentChat,
    type Chat,
    type Message,
    type MessageGenerationInfo,
    type MessageTranslation,
  } from '../../ts/storage/database.svelte'
  import { selectedCharID } from '../../ts/stores.svelte'
  import { HideIconStore, ReloadGUIPointer, VariableReloadGUIPointer, selIdState } from '../../ts/stores.svelte'
  import AutoresizeArea from '../UI/GUI/TextAreaResizable.svelte'
  import ChatBody from './ChatBody.svelte'
  import PopupButton from '../UI/PopupButton.svelte'
  import RerollList from './RerollList.svelte'
  import PartialEditController from './PartialEditController.svelte'
  import { resolveFreshPartialEditSave, type PartialEditSaveDetail } from './partialEditFreshness'
  import {
    getChatGenerationLoadingLanguageKey,
    getChatGenerationLoadingProgress,
    normalizeChatGenerationLoadingStage,
  } from './chatGenerationLoading'
  import {
    shouldAutoPopupMessageEditor,
    shouldAutoPopupTranslationEditor,
    shouldUseStableMessageEditor,
  } from './messageEditPopup'
  import { renderCustomHtmlTemplate } from './ChatCustomHtmlTemplate'
  import {
    currentChatScopedSnapshot,
    currentChatStateSnapshot,
    cloneJsonValue,
    dispatchCompatibleChatUpdateScoped,
    dispatchDeleteMessageScoped,
    dispatchForkChat,
    dispatchReplaceMessagesScoped,
    dispatchTruncateMessagesScoped,
    dispatchUpdateChatScoped,
    dispatchUpdateMessageScoped,
    ensureMessageId,
  } from 'src/ts/chatCommands'
  import {
    canUseServerCommands,
    runServerCommand,
    translateMessageCommand,
    updateMessageCommand,
  } from 'src/ts/server/commands'
  import { activeMessageTranslations } from 'src/ts/server/messageTranslationJobs'
  import { withTrustedServerProjectionWrite } from 'src/ts/server/projectionWriteGuard.svelte'
  import {
    captureChatButtonTriggerFreshness,
    chatButtonTriggerChatSignature,
    renderedChatButtonTriggerOperationTracker,
    resolveChatButtonTriggerFreshness,
    type ChatButtonTriggerFreshnessSnapshot,
    type ChatButtonTriggerIdentity,
    type ChatButtonTriggerTarget,
  } from './chatButtonTriggerFreshness'

  let translating = $state(false)
  let editMode = $state(false)
  let statusMessage: string = $state('')
  let retranslate = $state(false)
  let editTranslationMode = $state(false)
  let editTranslationText = $state('')
  let editTranslationTarget: TranslationMessageTarget | null = $state(null)
  let bodyRoot: HTMLElement | null = $state(null)
  interface Props {
    message?: string
    translation?: MessageTranslation | null
    name?: string
    largePortrait?: boolean
    isLastMemory: boolean
    img?: string | Promise<string>
    idx?: number
    messageGenerationInfo?: MessageGenerationInfo | null
    rerollIcon?: boolean | 'dynamic'
    role?: string
    totalLength?: number
    onReroll?: () => void
    unReroll?: () => void
    onNewReroll?: () => void
    onSelectRerollCandidate?: (index: number) => void
    character?: simpleCharacterArgument | string | null
    firstMessage?: boolean
    altGreeting?: boolean
    currentPage?: number
    totalPages?: number
    isComment?: boolean
    isGenerationLoading?: boolean
    generationStage?: number
    disabled?: boolean | 'allBefore'
  }

  interface CapturedChatButtonTriggerTarget {
    snapshot: ChatButtonTriggerFreshnessSnapshot
    previous: ReturnType<typeof currentChatScopedSnapshot>
  }

  interface TranslationMessageTarget {
    messageId: string
    chatId?: string
  }

  let {
    message = $bindable(''),
    translation = null,
    name = '',
    largePortrait = false,
    isLastMemory,
    img = '',
    idx = -1,
    rerollIcon = false,
    messageGenerationInfo = null,
    role = null,
    totalLength = 0,
    onReroll = () => {},
    unReroll = () => {},
    onNewReroll = onReroll,
    onSelectRerollCandidate = () => {},
    character = null,
    firstMessage = false,
    altGreeting = false,
    currentPage = 1,
    totalPages = 1,
    isComment = false,
    isGenerationLoading = false,
    generationStage = 0,
    disabled = false,
  }: Props = $props()
  let autoPopupMessageEditorOpen = $state(false)
  let autoPopupTranslationEditorOpen = $state(false)
  let suppressAutoPopupTranslationEditor = $state(false)
  const autoPopupMessageEditor = $derived(
    shouldAutoPopupMessageEditor({
      editMode,
      index: idx,
      disableAutoPopupMessageEditor: DBState.db.disableAutoPopupMessageEditor,
    }),
  )
  const autoPopupTranslationEditor = $derived(
    shouldAutoPopupTranslationEditor({
      editTranslationMode,
      index: idx,
      disableAutoPopupMessageEditor: DBState.db.disableAutoPopupMessageEditor,
      suppressAutoPopupTranslationEditor,
    }),
  )
  const useStableMessageEditor = $derived(
    shouldUseStableMessageEditor({
      editMode,
      index: idx,
      message,
      theme: DBState.db.theme,
    }),
  )
  const useStableTranslationEditor = $derived(
    shouldUseStableMessageEditor({
      editMode: editTranslationMode,
      index: idx,
      message: editTranslationText,
      theme: DBState.db.theme,
    }),
  )

  let msgDisplay = $state('')
  let translated = $state(false)
  let partialEditEnabled = $state(true)
  let lastDisplayParseKey = ''
  let rerollMenuButtonId = Math.random()
  let messageEditOriginalText: string | null = $state(null)

  function beginMessageEdit() {
    if (translationInProgress) return
    if (editMode) return
    messageEditOriginalText = message
    editMode = true
  }

  async function saveMessageEdit() {
    if (translationInProgress) return
    if (!editMode) return
    editMode = false
    await edit()
  }

  function openRerollMenu(e: MouseEvent, children: import('svelte').Snippet): void {
    if (popupStore.openId === rerollMenuButtonId && popupStore.children) {
      popupStore.children = null
      popupStore.openId = 0
      return
    }
    popupStore.mouseX = e.clientX
    popupStore.mouseY = e.clientY
    popupStore.children = children
    popupStore.openId = rerollMenuButtonId
  }

  async function openAutoPopupMessageEditor() {
    if (autoPopupMessageEditorOpen || popUpEditorStore.open) return

    autoPopupMessageEditorOpen = true
    const messageIndex = idx
    messageEditOriginalText ??= message
    popUpEditorStore.value = message
    popUpEditorStore.mode = 'default'
    popUpEditorStore.language = 'markdown'
    popUpEditorStore.open = true

    try {
      while (popUpEditorStore.open) {
        await sleep(100)
      }

      if (idx !== messageIndex || !editMode) return

      message = popUpEditorStore.value
      await saveMessageEdit()
    } finally {
      autoPopupMessageEditorOpen = false
    }
  }

  async function openAutoPopupTranslationEditor() {
    if (autoPopupTranslationEditorOpen || popUpEditorStore.open) return

    autoPopupTranslationEditorOpen = true
    const messageIndex = idx
    popUpEditorStore.value = editTranslationText
    popUpEditorStore.mode = 'default'
    popUpEditorStore.language = 'markdown'
    popUpEditorStore.open = true

    try {
      while (popUpEditorStore.open) {
        await sleep(100)
      }

      if (idx !== messageIndex || !editTranslationMode) return

      suppressAutoPopupTranslationEditor = true
      editTranslationText = popUpEditorStore.value
      await saveTranslationEdit()
    } finally {
      autoPopupTranslationEditorOpen = false
    }
  }

  $effect(() => {
    if (autoPopupMessageEditor) {
      void openAutoPopupMessageEditor()
    }
  })

  $effect(() => {
    if (autoPopupTranslationEditor) {
      void openAutoPopupTranslationEditor()
    }
  })

  function cloneMessagesWithIds(chat: Chat): Message[] {
    const messages = cloneJsonValue(chat.message ?? [])
    for (const item of messages) {
      item.chatId ||= uuidv4()
    }
    return messages
  }

  function dispatchReplaceMessagesForChat(
    chat: Chat,
    messages: Message[],
    previous: ReturnType<typeof currentChatScopedSnapshot>,
  ) {
    if (chat.id) {
      dispatchReplaceMessagesScoped(chat.id, messages, previous)
    }
  }

  function localChatMutation(callback: () => void) {
    if (!canUseServerCommands()) {
      callback()
    }
  }

  function supportsServerRawTranslation() {
    return (
      canUseServerCommands() &&
      idx >= 0 &&
      DBState.db.translator !== '' &&
      (DBState.db.translatorType === 'google' ||
        DBState.db.translatorType === 'deepl' ||
        DBState.db.translatorType === 'deeplX' ||
        DBState.db.translatorType === 'llm')
    )
  }

  function currentLiveMessage(): Message | null {
    const character = DBState.db.characters?.[selIdState.selId]
    const chatPage = character?.chatPage
    if (chatPage === undefined || chatPage === null || idx < 0) return null
    return character.chats?.[chatPage]?.message?.[idx] ?? null
  }

  function captureTranslationMessageTarget(): TranslationMessageTarget | null {
    const liveMessage = currentLiveMessage()
    const messageId = liveMessage?.chatId || messageRowId
    if (!messageId) return null
    return {
      messageId,
      chatId: currentChatId || undefined,
    }
  }

  function isRenderingTranslationMessageTarget(target: TranslationMessageTarget): boolean {
    return messageRowId === target.messageId && (!target.chatId || currentChatId === target.chatId)
  }

  function resultTranslationMessageTarget(
    capturedTarget: TranslationMessageTarget,
    result: { chatId?: string; messageId?: string },
  ): TranslationMessageTarget | null {
    const resultMessageId = result.messageId || capturedTarget.messageId
    if (resultMessageId !== capturedTarget.messageId) return null
    return {
      messageId: resultMessageId,
      chatId: result.chatId || capturedTarget.chatId,
    }
  }

  function findLiveMessageByTarget(target: TranslationMessageTarget): Message | null {
    const matches: Message[] = []

    for (const character of DBState.db.characters ?? []) {
      for (const chat of character.chats ?? []) {
        if (target.chatId && chat.id !== target.chatId) continue

        for (const candidate of chat.message ?? []) {
          if (candidate.chatId === target.messageId) {
            matches.push(candidate)
          }
        }
      }
    }

    return matches.length === 1 ? matches[0] : null
  }

  function isSameTranslation(left: MessageTranslation | null | undefined, right: MessageTranslation | null): boolean {
    if (!left || !right) return left == null && right === null
    return (
      left.source === right.source &&
      left.text === right.text &&
      left.sourceHash === right.sourceHash &&
      left.targetLanguage === right.targetLanguage &&
      left.inputLanguage === right.inputLanguage &&
      left.translatorType === right.translatorType &&
      left.settingsHash === right.settingsHash &&
      left.updatedAt === right.updatedAt
    )
  }

  function applyLocalTranslation(
    target: TranslationMessageTarget,
    nextTranslation: MessageTranslation | null,
    options: { expectedCurrentTranslation?: MessageTranslation | null } = {},
  ): boolean {
    let applied = false
    withTrustedServerProjectionWrite(() => {
      const liveMessage = findLiveMessageByTarget(target)
      if (!liveMessage) return
      if (
        'expectedCurrentTranslation' in options &&
        !isSameTranslation(liveMessage.translation, options.expectedCurrentTranslation ?? null)
      ) {
        return
      }
      liveMessage.translation = nextTranslation
      applied = true
    })
    return applied
  }

  function activeRawTranslation(): MessageTranslation | null {
    if (!supportsServerRawTranslation()) return null
    const currentTranslation = translation ?? currentLiveMessage()?.translation
    return currentTranslation?.source === 'raw' && typeof currentTranslation.text === 'string'
      ? currentTranslation
      : null
  }

  function liveRawTranslationForTarget(target: TranslationMessageTarget): MessageTranslation | null {
    const currentTranslation = findLiveMessageByTarget(target)?.translation
    return currentTranslation?.source === 'raw' && typeof currentTranslation.text === 'string'
      ? currentTranslation
      : null
  }

  async function requestServerRawTranslation() {
    if (translationInProgress) return
    const target = captureTranslationMessageTarget()
    if (!target) {
      setStatusMessage('Message is not ready to translate yet.', 2500)
      return
    }
    translating = true
    editTranslationMode = false
    editTranslationTarget = null
    try {
      const result = await runServerCommand({
        command: (baseRevision) => translateMessageCommand({ baseRevision, messageId: target.messageId }),
      })
      if (result.status === 'ok') {
        const resultTarget = resultTranslationMessageTarget(target, result)
        if (resultTarget) {
          applyLocalTranslation(resultTarget, result.translation)
        }
        if (isRenderingTranslationMessageTarget(target)) {
          translated = true
          editTranslationMode = false
        }
        return
      }
      if (isRenderingTranslationMessageTarget(target)) {
        translated = false
      }
      if (result.status === 'conflict') {
        setStatusMessage(`Translation conflict (${result.currentRevision}).`, 3000)
      } else if (result.status === 'unavailable') {
        setStatusMessage('Server commands are unavailable.', 3000)
      } else {
        setStatusMessage(result.error, 3000)
      }
    } finally {
      translating = false
    }
  }

  async function saveServerTranslationEdit() {
    const target = editTranslationTarget ?? captureTranslationMessageTarget()
    const existing = target
      ? (liveRawTranslationForTarget(target) ??
        (isRenderingTranslationMessageTarget(target) ? activeRawTranslation() : null))
      : null
    if (!existing || !target) return
    if (editTranslationText === existing.text) {
      editTranslationMode = false
      editTranslationTarget = null
      return
    }
    const nextTranslation: MessageTranslation = {
      ...existing,
      text: editTranslationText,
      updatedAt: Date.now(),
    }
    applyLocalTranslation(target, nextTranslation)
    editTranslationMode = false
    editTranslationTarget = null
    await runServerCommand({
      command: (baseRevision) =>
        updateMessageCommand({
          baseRevision,
          messageId: target.messageId,
          patch: { translation: nextTranslation },
        }),
      rollback: () => {
        applyLocalTranslation(target, existing, {
          expectedCurrentTranslation: nextTranslation,
        })
        if (isRenderingTranslationMessageTarget(target)) {
          editTranslationMode = true
          editTranslationTarget = target
        }
      },
    })
  }

  async function rm(e: MouseEvent, rec?: boolean) {
    if (translationInProgress) return
    const previous = currentChatScopedSnapshot()
    const chat = DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage]
    if (e.shiftKey) {
      if (canUseServerCommands()) {
        const afterMessageId = idx > 0 ? chat.message[idx - 1]?.chatId : null
        if (chat.id && (idx === 0 || afterMessageId)) {
          dispatchTruncateMessagesScoped(chat.id, afterMessageId, previous)
        } else {
          dispatchReplaceMessagesForChat(chat, cloneMessagesWithIds(chat).slice(0, idx), previous)
        }
      } else {
        let msg = chat.message
        const afterMessageId = idx > 0 ? ensureMessageId(msg[idx - 1]) : null
        msg = msg.slice(0, idx)
        chat.message = msg
        if (chat.id) {
          dispatchTruncateMessagesScoped(chat.id, afterMessageId, previous)
        }
      }
      return
    }

    const rm = DBState.db.askRemoval ? await alertConfirm(language.removeChat) : true
    if (rm) {
      if (DBState.db.instantRemove || rec) {
        const r = await alertConfirm(language.instantRemoveConfirm)
        let msg = chat.message
        if (!r) {
          if (canUseServerCommands()) {
            const afterMessageId = idx > 0 ? chat.message[idx - 1]?.chatId : null
            if (chat.id && (idx === 0 || afterMessageId)) {
              dispatchTruncateMessagesScoped(chat.id, afterMessageId, previous)
            } else {
              dispatchReplaceMessagesForChat(chat, cloneMessagesWithIds(chat).slice(0, idx), previous)
            }
          } else {
            const afterMessageId = idx > 0 ? ensureMessageId(msg[idx - 1]) : null
            msg = msg.slice(0, idx)
            chat.message = msg
            if (chat.id) {
              dispatchTruncateMessagesScoped(chat.id, afterMessageId, previous)
            }
          }
        } else {
          if (canUseServerCommands()) {
            const messageId = chat.message[idx]?.chatId
            if (messageId) {
              dispatchDeleteMessageScoped(messageId, previous)
            } else {
              const nextMessages = cloneMessagesWithIds(chat)
              nextMessages.splice(idx, 1)
              dispatchReplaceMessagesForChat(chat, nextMessages, previous)
            }
          } else {
            const messageId = ensureMessageId(msg[idx])
            msg.splice(idx, 1)
            chat.message = msg
            dispatchDeleteMessageScoped(messageId, previous)
          }
        }
      } else {
        if (canUseServerCommands()) {
          const messageId = chat.message[idx]?.chatId
          if (messageId) {
            dispatchDeleteMessageScoped(messageId, previous)
          } else {
            const nextMessages = cloneMessagesWithIds(chat)
            nextMessages.splice(idx, 1)
            dispatchReplaceMessagesForChat(chat, nextMessages, previous)
          }
        } else {
          let msg = chat.message
          const messageId = ensureMessageId(msg[idx])
          msg.splice(idx, 1)
          chat.message = msg
          dispatchDeleteMessageScoped(messageId, previous)
        }
      }
    }
  }

  async function edit() {
    const originalText = messageEditOriginalText
    messageEditOriginalText = null
    if (originalText !== null && message === originalText) return

    const previous = currentChatScopedSnapshot()
    const chat = DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage]
    const liveMessage = chat.message[idx]
    if (!liveMessage || liveMessage.data === message) return

    const messageId = liveMessage.chatId
    if (canUseServerCommands()) {
      if (messageId) {
        dispatchUpdateMessageScoped(messageId, { data: message }, previous)
      } else {
        const nextMessages = cloneMessagesWithIds(chat)
        if (nextMessages[idx]) {
          nextMessages[idx].data = message
          dispatchReplaceMessagesForChat(chat, nextMessages, previous)
        }
      }
      return
    }

    const localMessageId = ensureMessageId(chat.message[idx])
    chat.message[idx].data = message
    dispatchUpdateMessageScoped(localMessageId, { data: message }, previous)
  }

  function handlePartialEditSave(e: CustomEvent<PartialEditSaveDetail>) {
    if (idx >= 0) {
      const character = DBState.db.characters?.[selIdState.selId]
      const chatPage = character?.chatPage
      const chat = chatPage !== undefined && chatPage !== null ? character?.chats?.[chatPage] : undefined
      const liveMessage = chat?.message?.[idx]
      const freshness = resolveFreshPartialEditSave(
        e.detail,
        liveMessage && chat
          ? {
              chatIndex: idx,
              chatId: chat.id,
              messageId: liveMessage.chatId,
              data: liveMessage.data,
            }
          : null,
      )

      if (!freshness.ok || !chat || !liveMessage) return

      const previous = currentChatScopedSnapshot()
      const nextData = freshness.detail.newData
      message = nextData
      const messageId = liveMessage.chatId
      if (canUseServerCommands()) {
        if (messageId) {
          dispatchUpdateMessageScoped(messageId, { data: nextData }, previous)
        } else {
          const nextMessages = cloneMessagesWithIds(chat)
          if (nextMessages[idx]) {
            nextMessages[idx].data = nextData
            dispatchReplaceMessagesForChat(chat, nextMessages, previous)
          }
        }
      } else {
        const localMessageId = ensureMessageId(liveMessage)
        liveMessage.data = nextData
        dispatchUpdateMessageScoped(localMessageId, { data: nextData }, previous)
      }
      displaya(nextData)
    }
  }

  function getCbsCondition() {
    try {
      const cbsConditions: CbsConditions = {
        firstmsg: firstMessage ?? false,
        chatRole: role ?? null,
      }
      return cbsConditions
    } catch (e) {
      return {
        firstmsg: firstMessage ?? false,
        chatRole: null,
      }
    }
  }

  async function loadTranslationForEdit() {
    const target = captureTranslationMessageTarget()
    if (!target) return
    suppressAutoPopupTranslationEditor = false
    editTranslationTarget = target
    editTranslationText = liveRawTranslationForTarget(target)?.text ?? activeRawTranslation()?.text ?? ''
    editTranslationMode = true
  }

  async function saveTranslationEdit() {
    await saveServerTranslationEdit()
  }

  function displaya(message: string) {
    const cbsConditions = getCbsCondition()
    const chara = name
    const chatID = idx
    msgDisplay = untrack(() => {
      return risuChatParser(message, {
        chara,
        chatID,
        rmVar: true,
        visualize: true,
        cbsConditions,
      })
    })
  }

  function chatScriptstateSignature(chat: Chat | undefined): string {
    return JSON.stringify(chat?.scriptstate ?? null)
  }

  const setStatusMessage = (message: string, timeout: number = 0) => {
    statusMessage = message
    if (timeout === 0) return
    setTimeout(() => {
      statusMessage = ''
    }, timeout)
  }

  let blankMessage = $derived(
    ((message === '{{none}}' || message === '{{blank}}' || message === '') && idx === -1) || isComment,
  )
  let messageRowId = $derived.by(() => {
    const character = DBState.db.characters?.[selIdState.selId]
    const chatPage = character?.chatPage
    if (idx < 0 || chatPage === undefined || chatPage === null) {
      return ''
    }
    return character.chats?.[chatPage]?.message?.[idx]?.chatId ?? ''
  })
  let currentChatId = $derived.by(() => {
    const character = DBState.db.characters?.[selIdState.selId]
    const chatPage = character?.chatPage
    if (chatPage === undefined || chatPage === null) {
      return ''
    }
    return character.chats?.[chatPage]?.id ?? ''
  })
  let serverTranslationInProgress = $derived.by(() => {
    if (!messageRowId) return false
    return $activeMessageTranslations.some((job) => job.messageId === messageRowId)
  })
  let translationInProgress = $derived(translating || serverTranslationInProgress)
  let sawServerTranslationInProgress = $state(false)
  let displayMessage = $derived.by(() => {
    const rawTranslation = activeRawTranslation()
    return translated && rawTranslation ? rawTranslation.text : message
  })
  let normalizedGenerationStage = $derived(normalizeChatGenerationLoadingStage(generationStage))
  let generationLoadingText = $derived(language[getChatGenerationLoadingLanguageKey(normalizedGenerationStage)])
  let generationLoadingProgress = $derived(getChatGenerationLoadingProgress(normalizedGenerationStage))

  $effect(() => {
    if (serverTranslationInProgress) {
      sawServerTranslationInProgress = true
      return
    }
    if (sawServerTranslationInProgress && activeRawTranslation()) {
      translated = true
    }
    sawServerTranslationInProgress = false
  })

  $effect.pre(() => {
    const reloadEpoch = $ReloadGUIPointer
    const chatReloadEpoch = $ReloadChatPointer[idx] ?? 0
    const variableReloadEpoch = idx < 0 ? $VariableReloadGUIPointer : 0
    const chatScopeKey = idx < 0 ? currentChatId : ''
    const displayParseKey = JSON.stringify([
      displayMessage,
      name,
      idx,
      role,
      firstMessage,
      chatScopeKey,
      reloadEpoch,
      chatReloadEpoch,
      variableReloadEpoch,
    ])
    if (displayParseKey !== lastDisplayParseKey) {
      lastDisplayParseKey = displayParseKey
      displaya(displayMessage)
    }
  })

  function RenderGUIHtml(html: string, cacheScopeKey: string) {
    return renderCustomHtmlTemplate(html, getCbsCondition(), cacheScopeKey)
  }

  function hasCustomHtmlTemplate(html: unknown): html is string {
    return typeof html === 'string' && html.trim().length > 0
  }

  function getRisuButtonAttributes(dom: HTMLElement) {
    const attributes: Record<string, string> = {}

    for (const attr of ['risu-trigger', 'risu-btn', 'risu-id']) {
      const value = dom.getAttribute(attr)
      if (value !== null) {
        attributes[attr] = value
      }
    }

    return attributes
  }

  function readChatButtonTriggerLiveTarget(identity: ChatButtonTriggerIdentity): ChatButtonTriggerTarget | null {
    const selectedCharacterIndex = selIdState.selId
    const character = DBState.db.characters?.[selectedCharacterIndex]
    const chatPage = character?.chatPage
    if (!character || typeof chatPage !== 'number') {
      return null
    }

    const chat = character.chats?.[chatPage]
    if (!chat) {
      return null
    }

    const messages = chat.message ?? []
    const sourceMessage = idx >= 0 ? messages[idx] : undefined
    if (idx >= 0 && !sourceMessage) {
      return null
    }
    const tailMessage = messages.at(-1)

    return {
      selectedCharacterIndex,
      characterId: character.chaId,
      chatPage,
      chatId: chat.id,
      messageIndex: idx,
      messageId: sourceMessage?.chatId,
      messageData: sourceMessage?.data ?? null,
      messageRole: sourceMessage?.role ?? null,
      transcriptLength: messages.length,
      tailMessageId: tailMessage?.chatId,
      tailMessageData: tailMessage?.data ?? null,
      tailMessageRole: tailMessage?.role ?? null,
      chatStateSignature: chatButtonTriggerChatSignature(chat),
      triggerName: identity.triggerName,
      triggerId: identity.triggerId,
      btnEvent: identity.btnEvent,
    }
  }

  function captureChatButtonTriggerTarget(identity: ChatButtonTriggerIdentity): CapturedChatButtonTriggerTarget | null {
    const liveTarget = readChatButtonTriggerLiveTarget(identity)
    if (!liveTarget) {
      return null
    }

    const character = DBState.db.characters?.[liveTarget.selectedCharacterIndex]
    const chat = character?.chats?.[liveTarget.chatPage]
    if (!chat) {
      return null
    }

    return {
      snapshot: captureChatButtonTriggerFreshness(liveTarget, renderedChatButtonTriggerOperationTracker),
      previous: {
        selectedCharID: liveTarget.selectedCharacterIndex,
        characterId: liveTarget.characterId ?? undefined,
        chatId: liveTarget.chatId ?? undefined,
        chat: cloneJsonValue(chat) as Chat,
      },
    }
  }

  function isChatButtonTriggerTargetFresh(target: CapturedChatButtonTriggerTarget): boolean {
    const liveTarget = readChatButtonTriggerLiveTarget(target.snapshot)
    if (!liveTarget) {
      return false
    }

    return resolveChatButtonTriggerFreshness(target.snapshot, liveTarget, renderedChatButtonTriggerOperationTracker).ok
  }

  function applyFreshChatButtonTriggerResult(target: CapturedChatButtonTriggerTarget, nextChat: Chat): boolean {
    if (!isChatButtonTriggerTargetFresh(target)) {
      return false
    }

    const nextChatSnapshot = cloneJsonValue(nextChat) as Chat
    let applied = false

    withTrustedServerProjectionWrite(() => {
      const characters = DBState.db.characters ?? []
      const character = target.snapshot.characterId
        ? characters.find((candidate) => candidate.chaId === target.snapshot.characterId)
        : characters[target.snapshot.selectedCharacterIndex]
      if (!character?.chats) {
        return
      }

      const chatIndex = target.snapshot.chatId
        ? character.chats.findIndex((candidate) => candidate.id === target.snapshot.chatId)
        : target.snapshot.chatPage
      if (chatIndex < 0 || !character.chats[chatIndex]) {
        return
      }

      character.chats[chatIndex] = nextChatSnapshot
      applied = true
    })

    if (applied) {
      dispatchCompatibleChatUpdateScoped(target.previous.chat, nextChatSnapshot, target.previous)
    }
    return applied
  }

  async function handleButtonTriggerWithin(event: UIEvent) {
    const currentChar = getCurrentCharacter()
    if (!currentChar) {
      return
    }

    const target = event.target as HTMLElement
    const origin = target.closest('[risu-trigger], [risu-btn]')
    if (!origin) {
      return
    }

    const triggerName = origin.getAttribute('risu-trigger')
    const triggerId = origin.getAttribute('risu-id')
    const btnEvent = origin.getAttribute('risu-btn')
    const triggerTarget = captureChatButtonTriggerTarget({
      triggerName,
      triggerId,
      btnEvent,
    })
    if (!triggerTarget) {
      return
    }

    let triggerResult = null
    if (triggerName) {
      const triggerController = createManualTriggerAbortController()
      try {
        triggerResult = await runTrigger(currentChar, 'manual', {
          chat: triggerTarget.previous.chat ?? getCurrentChat(),
          manualName: triggerName,
          triggerId: triggerId || undefined,
          signal: triggerController.signal,
          isFresh: () => isChatButtonTriggerTargetFresh(triggerTarget),
          deferLiveChatSideEffects: true,
        })
      } finally {
        clearManualTriggerAbortController(triggerController)
      }
    } else if (btnEvent) {
      triggerResult = await runLuaButtonTrigger(currentChar, btnEvent, {
        chat: triggerTarget.previous.chat,
        isFresh: () => isChatButtonTriggerTargetFresh(triggerTarget),
        deferLiveChatSideEffects: true,
      })
    }

    if (triggerResult?.chat && applyFreshChatButtonTriggerResult(triggerTarget, triggerResult.chat)) {
      if (chatScriptstateSignature(triggerTarget.previous.chat) !== chatScriptstateSignature(triggerResult.chat)) {
        refreshVariableOnlyGui()
      }
      ReloadChatPointer.update((v) => {
        v[idx] = (v[idx] ?? 0) + 1
        return v
      })
    }

    if (triggerName && triggerId) {
      setTimeout(() => {
        CurrentTriggerIdStore.set(null)
      }, 100) // Small delay to allow display mode to complete
    }
  }

  let isBookmarked = $derived(
    DBState.db.characters[selIdState.selId]?.chats[
      DBState.db.characters[selIdState.selId].chatPage
    ]?.bookmarks?.includes(
      DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage].message[idx]
        ?.chatId,
    ) ?? false,
  )

  async function toggleBookmark() {
    const previous = currentChatScopedSnapshot()
    const chat = DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage]

    if (!chat.message[idx]) return

    const nextMessages = canUseServerCommands() ? cloneMessagesWithIds(chat) : null
    let messageId = canUseServerCommands() ? nextMessages?.[idx]?.chatId : chat.message[idx]?.chatId
    const messageContent = chat.message[idx]?.data ?? ''
    const hadMessageId = Boolean(chat.message[idx]?.chatId)

    if (!messageId) {
      messageId = uuidv4()
      localChatMutation(() => {
        chat.message[idx].chatId = messageId
      })
    }

    const bookmarks = [...(chat.bookmarks ?? [])]
    const bookmarkNames = { ...(chat.bookmarkNames ?? {}) }

    const bookmarkIndex = bookmarks.indexOf(messageId)

    if (bookmarkIndex > -1) {
      bookmarks.splice(bookmarkIndex, 1)
      delete bookmarkNames[messageId]
    } else {
      bookmarks.push(messageId)

      const msgSender = chat.message[idx]?.role === 'user' ? name || getUserDisplayName() : name
      const newName = await alertInput(language.bookmarkAskNameOrDefault, [], bookmarkNames[messageId] || '')

      if (newName && newName.trim() !== '') {
        bookmarkNames[messageId] = newName
      } else {
        let defaultName

        const blacklist = [
          '!',
          '@',
          '#',
          '$',
          '%',
          '^',
          '&',
          '*',
          '(',
          ')',
          '_',
          '+',
          '-',
          '=',
          '[',
          ']',
          '{',
          '}',
          '|',
          ';',
          ':',
          '"',
          "'",
          ',',
          '.',
          '<',
          '>',
          '/',
          '?',
        ]
        let lines = messageContent.split('\n')
        lines = lines.splice(Math.floor(lines.length * 0.5))
        for (const line of lines) {
          if (line && !blacklist.some((char) => line.startsWith(char))) {
            defaultName = line.trim().slice(0, 50) + '...'
            break
          }
        }
        if (!defaultName) {
          defaultName = messageContent.slice(0, 50) + '...'
        }
        bookmarkNames[messageId] = msgSender + '| ' + defaultName
      }
    }

    localChatMutation(() => {
      if (!hadMessageId) {
        chat.message[idx].chatId = messageId
      }
      chat.bookmarks = [...bookmarks]
      chat.bookmarkNames = bookmarkNames
    })
    if (!hadMessageId && chat.id) {
      dispatchReplaceMessagesScoped(
        chat.id,
        canUseServerCommands() && nextMessages ? nextMessages : chat.message,
        previous,
      )
    }
    if (chat.id) {
      dispatchUpdateChatScoped(
        chat.id,
        {
          bookmarks,
          bookmarkNames,
        },
        previous,
      )
    }
  }
</script>

{#snippet genInfo()}
  <div class="flex flex-col items-end">
    {#if messageGenerationInfo && (DBState.db.requestInfoInsideChat || aiLawApplies())}
      <button
        class="text-sm p-1 text-textcolor2 border-darkborderc float-end mr-2 my-1
                    hover:ring-darkbutton hover:ring-3 rounded-md hover:text-textcolor transition-all flex justify-center items-center"
        onclick={() => {
          const currentGenerationInfo =
            idx >= 0
              ? DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[
                  idx
                ].generationInfo
              : messageGenerationInfo

          alertRequestData({
            genInfo: currentGenerationInfo,
            idx: idx,
          })
        }}>
        <BotIcon size={20} />
        <span class="ml-1">
          {capitalize(getModelInfo(messageGenerationInfo.model).shortName)}
        </span>
      </button>
    {/if}
    {#if supportsServerRawTranslation() && translated && !translationInProgress}
      <button
        class="text-sm p-1 text-textcolor2 border-darkborderc float-end mr-2 my-1
                            hover:ring-darkbutton hover:ring-3 rounded-md hover:text-textcolor transition-all flex justify-center items-center"
        onclick={async () => {
          await requestServerRawTranslation()
        }}>
        <RefreshCcwIcon size={20} />
        <span class="ml-1">
          {language.retranslate}
        </span>
      </button>
      <button
        class={'text-sm p-1 border-darkborderc float-end mr-2 my-1 hover:ring-darkbutton hover:ring-3 rounded-md hover:text-textcolor transition-all flex justify-center items-center ' +
          (editTranslationMode ? 'text-blue-400' : 'text-textcolor2')}
        onclick={() => {
          if (editTranslationMode) {
            saveTranslationEdit()
          } else {
            loadTranslationForEdit()
          }
        }}>
        <PencilIcon size={20} />
        <span class="ml-1">
          {editTranslationMode ? language.editTranslationSave : language.editTranslation}
        </span>
      </button>
    {:else if DBState.db.translatorType === 'llm' && translated && !translationInProgress}
      <button
        class="text-sm p-1 text-textcolor2 border-darkborderc float-end mr-2 my-1
                            hover:ring-darkbutton hover:ring-3 rounded-md hover:text-textcolor transition-all flex justify-center items-center"
        onclick={() => {
          retranslate = true
        }}>
        <RefreshCcwIcon size={20} />
        <span class="ml-1">
          {language.retranslate}
        </span>
      </button>
    {/if}
  </div>
{/snippet}

{#snippet textBox()}
  {#if editTranslationMode}
    <AutoresizeArea
      bind:value={editTranslationText}
      popupEditor
      stableHeight={useStableTranslationEditor}
      handleLongPress={() => {
        saveTranslationEdit()
      }} />
  {:else if editMode}
    <AutoresizeArea
      bind:value={message}
      popupEditor
      stableHeight={useStableMessageEditor}
      handleLongPress={() => {
        editMode = false
      }} />
  {:else if isComment}
    <div class="w-full flex justify-center text-textcolor2 italic mb-12">
      {#if msgDisplay.startsWith('{{specialcomment')}
        {@const parts = msgDisplay.split('::')}
        {@const type = parts[1]}

        {#if type === 'branchedfrom'}
          <button
            class="text-blue-500 hover:underline"
            onclick={() => {
              console.log(parts)
              changeChatTo(parts[2] ?? '')
              foldChatToMessage(parts[4])
            }}>
            <GitBranch size={20} class="inline-block mr-1" />
            {language.branchedText.replace('{}', parts[3] ?? '')}
          </button>
        {/if}
      {:else}
        {msgDisplay}
      {/if}
    </div>
  {:else if isGenerationLoading}
    <div class="chat-generation-loading" role="status" aria-live="polite" aria-busy="true">
      <div class="chat-generation-loading-header">
        <LoaderCircleIcon size={16} class="animate-spin shrink-0" />
        <span>{generationLoadingText}</span>
      </div>
      <div class="chat-generation-loading-track">
        <div
          class={`chat-generation-loading-fill chat-generation-loading-stage-${normalizedGenerationStage}`}
          style:width={`${generationLoadingProgress}%`}>
        </div>
      </div>
    </div>
  {:else if blankMessage}
    <div class="w-full flex justify-center text-textcolor2 italic mb-12">
      {language.noMessage}
    </div>
  {:else}
    {@const variableReloadPointer = idx < 0 ? $VariableReloadGUIPointer : 0}
    {@const chatReloadPointer = $ReloadGUIPointer + ($ReloadChatPointer[idx] ?? 0) + variableReloadPointer}
    {@const chatScopePointer = idx < 0 ? currentChatId : ''}
    {@const totalLengthPointer = idx > totalLength - 6 ? totalLength : 0}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span
      class="text chat-width chattext prose minw-0"
      class:prose-invert={$ColorSchemeTypeStore}
      bind:this={bodyRoot}
      onclick={() => {
        if (DBState.db.clickToEdit && idx > -1) {
          beginMessageEdit()
        }
      }}
      style:font-size="{0.875 * (DBState.db.zoomsize / 100)}rem"
      style:line-height="{(DBState.db.lineHeight ?? 1.25) * (DBState.db.zoomsize / 100)}rem">
      {#key `${totalLengthPointer}|${chatReloadPointer}|${chatScopePointer}`}
        {#if supportsServerRawTranslation()}
          <ChatBody
            {character}
            {firstMessage}
            {idx}
            {msgDisplay}
            {name}
            {bodyRoot}
            modelShortName={messageGenerationInfo ? getModelInfo(messageGenerationInfo?.model).shortName : ''}
            role={role ?? null}
            translated={false}
            bind:translating
            retranslate={false}
            allowClientTranslation={false} />
        {:else}
          <ChatBody
            {character}
            {firstMessage}
            {idx}
            {msgDisplay}
            {name}
            {bodyRoot}
            modelShortName={messageGenerationInfo ? getModelInfo(messageGenerationInfo?.model).shortName : ''}
            role={role ?? null}
            bind:translated
            bind:translating
            bind:retranslate />
        {/if}
      {/key}
      {#if idx >= 0 && !editMode && !translationInProgress && partialEditEnabled && (DBState.db.enableBlockPartialEdit || DBState.db.enableDragPartialEdit)}
        <PartialEditController
          messageData={message}
          chatIndex={idx}
          chatId={currentChatId || undefined}
          messageId={messageRowId || undefined}
          {bodyRoot}
          blockEditEnabled={DBState.db.enableBlockPartialEdit}
          dragEditEnabled={DBState.db.enableDragPartialEdit}
          on:save={handlePartialEditSave} />
      {/if}
    </span>
  {/if}
{/snippet}

{#snippet iconButtons(options: { applyTextColors?: boolean } = {})}
  <div class="grow flex items-center justify-end" class:text-textcolor2={options?.applyTextColors !== false}>
    {#if isComment}
      <button
        class={'flex items-center hover:text-blue-500 transition-colors button-icon-remove ' +
          (translationInProgress ? ' cursor-not-allowed opacity-50' : '')}
        disabled={translationInProgress}
        onclick={async (e) => {
          if (translationInProgress) return
          await rm(e, true)
        }}>
        <TrashIcon size={20} />
      </button>
    {:else if !isGenerationLoading}
      <span class="text-xs">{statusMessage}</span>
      <div class="flex items-center ml-2 gap-2">
        {@render translationButton()}
        {#if $SizeStore.w >= 640}
          {@render majorIconButtonsBody(false)}
          {#if DBState.db.characters[selIdState.selId]}
            <PopupButton>
              {@render minorIconButtonsBody(true)}
            </PopupButton>
          {/if}
        {:else if DBState.db.characters[selIdState.selId]}
          <PopupButton>
            {@render majorIconButtonsBody(true)}
            {@render minorIconButtonsBody(true)}
          </PopupButton>
        {:else}
          {@render majorIconButtonsBody(false)}
        {/if}
        {@render rerolls()}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet majorIconButtonsBody(showNames: boolean)}
  {#if DBState.db.useChatCopy && !blankMessage}
    <button
      class="flex items-center hover:text-blue-500 transition-colors button-icon-copy"
      onclick={async () => {
        if (window.navigator.clipboard.write) {
          try {
            alertWait(language.loading)
            const root = document.querySelector(':root') as HTMLElement

            const parser = new DOMParser()
            const doc = parser.parseFromString(
              await ParseMarkdown(msgDisplay, getCurrentCharacter(), 'normal', idx, getCbsCondition()),
              'text/html',
            )

            doc.querySelectorAll('mark').forEach((el) => {
              const d = el.getAttribute('risu-mark')
              if (d === 'quote1' || d === 'quote2') {
                const newEle = document.createElement('div')
                newEle.textContent = el.textContent
                newEle.setAttribute(
                  'style',
                  `background: transparent; color: ${root.style.getPropertyValue('--FontColorQuote' + d.slice(-1))};`,
                )
                el.replaceWith(newEle)
                return
              }
            })
            doc.querySelectorAll('p').forEach((el) => {
              el.setAttribute('style', `color: ${root.style.getPropertyValue('--FontColorStandard')};`)
            })
            doc.querySelectorAll('em').forEach((el) => {
              el.setAttribute(
                'style',
                `font-style: italic; color: ${root.style.getPropertyValue('--FontColorItalic')};`,
              )
            })
            doc.querySelectorAll('strong').forEach((el) => {
              el.setAttribute('style', `font-weight: bold; color: ${root.style.getPropertyValue('--FontColorBold')};`)
            })
            doc.querySelectorAll('em strong').forEach((el) => {
              el.setAttribute(
                'style',
                `font-weight: bold; font-style: italic; color: ${root.style.getPropertyValue('--FontColorItalicBold')};`,
              )
            })
            doc.querySelectorAll('strong em').forEach((el) => {
              el.setAttribute(
                'style',
                `font-weight: bold; font-style: italic; color: ${root.style.getPropertyValue('--FontColorItalicBold')};`,
              )
            })

            const imgs = doc.querySelectorAll('img')
            for (const img of imgs) {
              img.setAttribute('alt', 'from Risuai')
              const url = img.getAttribute('src')

              img.setAttribute(
                'style',
                `
                        max-width: 100%;
                        margin: 10px 0;
                        border-radius: 8px;
                        box-shadow: rgba(0,0,0,0.1) 0px 2px 8px;
                        display: block;
                        margin-left: auto;
                        margin-right: auto;
                    `,
              )

              if (
                url &&
                (url.startsWith('http://asset.localhost') ||
                  url.startsWith('https://asset.localhost') ||
                  url.startsWith('https://sv.risuai') ||
                  url.startsWith('data:') ||
                  url.startsWith('http') ||
                  url.startsWith('/'))
              ) {
                try {
                  let fetchUrl = url
                  if (url.startsWith('/')) {
                    fetchUrl = window.location.origin + url
                  }

                  const data = await fetch(fetchUrl)
                  if (data.ok) {
                    const canvas = document.createElement('canvas')
                    const ctx = canvas.getContext('2d')
                    const imgElement = new Image()
                    imgElement.crossOrigin = 'anonymous'
                    imgElement.src = await data.blob().then(
                      (b) =>
                        new Promise((resolve, reject) => {
                          const reader = new FileReader()
                          reader.onload = () => resolve(reader.result as string)
                          reader.onerror = reject
                          reader.readAsDataURL(b)
                        }),
                    )
                    await new Promise((resolve) => {
                      imgElement.onload = resolve
                    })
                    canvas.width = imgElement.width
                    canvas.height = imgElement.height
                    ctx.drawImage(imgElement, 0, 0)
                    const dataURL = canvas.toDataURL('image/jpeg', 0.6)
                    img.setAttribute('src', dataURL)
                  }
                } catch (error) {
                  console.error('Image error:', error)
                }
              }
            }

            let iconDataUrl = ''
            let hasValidImage = false

            try {
              const iconImage = (await getFileSrc(DBState.db.characters[selIdState.selId].image ?? '')) ?? ''

              if (
                iconImage &&
                (iconImage.startsWith('http://asset.localhost') ||
                  iconImage.startsWith('https://asset.localhost') ||
                  iconImage.startsWith('https://sv.risuai') ||
                  iconImage.startsWith('data:') ||
                  iconImage.startsWith('http') ||
                  iconImage.startsWith('/'))
              ) {
                if (iconImage.startsWith('data:')) {
                  iconDataUrl = iconImage
                  hasValidImage = true
                } else {
                  const data = await fetch(iconImage)
                  if (data.ok) {
                    const canvas = document.createElement('canvas')
                    const ctx = canvas.getContext('2d')
                    const img = new Image()
                    img.crossOrigin = 'anonymous'
                    img.src = await data.blob().then(
                      (b) =>
                        new Promise((resolve, reject) => {
                          const reader = new FileReader()
                          reader.onload = () => resolve(reader.result as string)
                          reader.onerror = reject
                          reader.readAsDataURL(b)
                        }),
                    )
                    await new Promise((resolve, reject) => {
                      img.onload = () => {
                        canvas.width = img.width
                        canvas.height = img.height
                        ctx.drawImage(img, 0, 0)
                        iconDataUrl = canvas.toDataURL('image/jpeg', 0.9)
                        hasValidImage = true
                        resolve(true)
                      }
                      img.onerror = () => {
                        hasValidImage = false
                        resolve(false)
                      }
                    })
                  }
                }
              }
            } catch (error) {
              console.error('Icon error:', error)
              hasValidImage = false
            }

            const isUserMessage = role === 'user'
            const displayName = isUserMessage ? name || getUserDisplayName() : name
            const modelInfo = messageGenerationInfo
              ? capitalize(getModelInfo(messageGenerationInfo.model).shortName)
              : isUserMessage
                ? 'User'
                : 'AI'

            let finalIconDataUrl = iconDataUrl
            let finalHasValidImage = hasValidImage

            if (isUserMessage) {
              finalHasValidImage = false
              const userIcon = getUserIcon()
              if (userIcon) {
                try {
                  const userIconSrc = await getFileSrc(userIcon)
                  if (
                    userIconSrc &&
                    (userIconSrc.startsWith('http://asset.localhost') ||
                      userIconSrc.startsWith('https://asset.localhost') ||
                      userIconSrc.startsWith('https://sv.risuai') ||
                      userIconSrc.startsWith('data:') ||
                      userIconSrc.startsWith('http') ||
                      userIconSrc.startsWith('/'))
                  ) {
                    if (userIconSrc.startsWith('data:')) {
                      finalIconDataUrl = userIconSrc
                      finalHasValidImage = true
                    } else {
                      const data = await fetch(userIconSrc)
                      if (data.ok) {
                        const canvas = document.createElement('canvas')
                        const ctx = canvas.getContext('2d')
                        const img = new Image()
                        img.crossOrigin = 'anonymous'
                        img.src = await data.blob().then(
                          (b) =>
                            new Promise((resolve, reject) => {
                              const reader = new FileReader()
                              reader.onload = () => resolve(reader.result as string)
                              reader.onerror = reject
                              reader.readAsDataURL(b)
                            }),
                        )
                        await new Promise((resolve, reject) => {
                          img.onload = () => {
                            canvas.width = img.width
                            canvas.height = img.height
                            ctx.drawImage(img, 0, 0)
                            finalIconDataUrl = canvas.toDataURL('image/jpeg', 0.9)
                            finalHasValidImage = true
                            resolve(true)
                          }
                          img.onerror = () => {
                            finalHasValidImage = false
                            resolve(false)
                          }
                        })
                      }
                    }
                  }
                } catch (error) {
                  console.error('User icon error:', error)
                  finalHasValidImage = false
                }
              }
            }

            const html = `<div style="font-family: 'Segoe UI', Roboto, Arial, sans-serif; color: ${root.style.getPropertyValue('--risu-theme-textcolor')}; line-height: 1.6; max-width: 600px; margin: 1rem auto; background: ${root.style.getPropertyValue('--risu-theme-bgcolor')}; border-radius: 12px; box-shadow: 0px 4px 12px rgba(0,0,0,0.15); overflow: hidden;">
<div style="padding: 20px;">
<div style="display: flex; flex-direction: column; align-items: center; margin-bottom: 1rem; text-align: center;">
    ${finalHasValidImage ? `<img style="width: 80px; height: 80px; border-radius: 50%; border: 3px solid ${root.style.getPropertyValue('--risu-theme-darkborderc')}; margin-bottom: 0.75rem; object-fit: cover;" src="${finalIconDataUrl}" alt="profile">` : ''}
    <h3 style="color: ${root.style.getPropertyValue('--risu-theme-textcolor')}; font-weight: 600; font-size: 1.5rem; margin: 0 0 0.5rem 0;">${displayName}</h3>
    ${!isUserMessage ? `<span style="display: inline-block; border-radius: 16px; font-size: 0.8rem; padding: 0.25rem 0.75rem; background: ${root.style.getPropertyValue('--risu-theme-darkbg')}; color: ${root.style.getPropertyValue('--risu-theme-textcolor')}; border: 1px solid ${root.style.getPropertyValue('--risu-theme-darkborderc')};">${modelInfo}</span>` : ''}
</div>
<div style="border-top: 1px solid ${root.style.getPropertyValue('--risu-theme-darkborderc')}; padding-top: 1rem;">
    ${doc.body.innerHTML}
</div>
<div style="text-align: center; margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid ${root.style.getPropertyValue('--risu-theme-darkborderc')};">
    <span style="font-size: 0.75rem; color: ${root.style.getPropertyValue('--risu-theme-textcolor2')}; opacity: 0.7;">From Risuai</span>
</div>
</div>
</div>`

            await window.navigator.clipboard.write([
              new ClipboardItem({
                'text/plain': new Blob([msgDisplay], { type: 'text/plain' }),
                'text/html': new Blob([html], { type: 'text/html' }),
              }),
            ])
            alertNormal(language.copied)
            return
          } catch (e) {
            alertClear()
            window.navigator.clipboard.writeText(msgDisplay).then(() => {
              setStatusMessage(language.copied)
            })
          }
        }
        window.navigator.clipboard.writeText(msgDisplay).then(() => {
          setStatusMessage(language.copied)
        })
      }}>
      <CopyIcon size={20} />
      {#if showNames}
        <span class="ml-1">{language.copy}</span>
      {/if}
    </button>
  {/if}
  {#if idx > -1}
    {#if DBState.db.characters[selIdState.selId].ttsMode !== 'none' && DBState.db.characters[selIdState.selId].ttsMode}
      <button
        class="flex items-center hover:text-blue-500 transition-colors button-icon-tts"
        onclick={() => {
          return sayTTS(null, message)
        }}>
        <Volume2Icon size={20} />
        {#if showNames}
          <span class="ml-1">TTS</span>
        {/if}
      </button>
    {/if}
    <button
      class={'flex items-center hover:text-blue-500 transition-colors button-icon-remove ' +
        (translationInProgress ? ' cursor-not-allowed opacity-50' : '')}
      disabled={translationInProgress}
      onclick={(e) => {
        if (translationInProgress) return
        rm(e, false)
      }}
      use:longpress={(e) => {
        if (translationInProgress) return
        rm(e, true)
      }}>
      <TrashIcon size={20} />

      {#if showNames}
        <span class="ml-1">{language.remove}</span>
      {/if}
    </button>
  {/if}
{/snippet}

{#snippet translationButton(showNames = false)}
  {#if DBState.db.translator !== '' && DBState.db.translatorType !== 'bergamot' && !blankMessage}
    <button
      class={'flex items-center cursor-pointer hover:text-blue-500 transition-colors button-icon-translate ' +
        (translated && !translationInProgress ? 'text-blue-400' : '') +
        (translationInProgress ? ' cursor-wait opacity-70' : '')}
      class:translating={translationInProgress}
      disabled={translationInProgress}
      aria-busy={translationInProgress}
      aria-label={translationInProgress ? language.translating : language.translate}
      onclick={async () => {
        if (translationInProgress) return
        if (!supportsServerRawTranslation()) {
          translated = !translated
          return
        }
        if (translated) {
          translated = false
          editTranslationMode = false
          return
        }
        if (activeRawTranslation()) {
          translated = true
          return
        }
        await requestServerRawTranslation()
      }}>
      {#if translationInProgress}
        <LoaderCircleIcon class="animate-spin" />
      {:else}
        <LanguagesIcon />
      {/if}
      {#if showNames}
        <span class="ml-1">{translationInProgress ? language.translating : language.translate}</span>
      {/if}
    </button>
  {/if}
  {#if idx > -1}
    <button
      class={'flex items-center hover:text-blue-500 transition-colors button-icon-edit ' +
        (editMode ? 'text-blue-400' : '') +
        (translationInProgress ? ' cursor-not-allowed opacity-50' : '')}
      disabled={translationInProgress}
      onclick={async () => {
        if (translationInProgress) return
        if (!editMode) {
          beginMessageEdit()
        } else {
          await saveMessageEdit()
        }
      }}>
      <PencilIcon size={20} />

      {#if showNames}
        <span class="ml-1">{language.edit}</span>
      {/if}
    </button>
  {/if}
{/snippet}

{#snippet rerolls()}
  {#if rerollIcon || altGreeting}
    {#if altGreeting}
      <button
        class={'flex items-center hover:text-blue-500 transition-colors button-icon-unreroll ' +
          (translationInProgress ? ' cursor-not-allowed opacity-50' : '')}
        class:dyna-icon={rerollIcon === 'dynamic'}
        disabled={translationInProgress}
        onclick={() => {
          if (translationInProgress) return
          unReroll()
        }}>
        <ArrowLeft size={22} />
      </button>
      {#if firstMessage && DBState.db.swipe && DBState.db.showFirstMessagePages}
        <span class="flex items-center text-xs text-textcolor2">{currentPage}/{totalPages}</span>
      {/if}
      <button
        class={'flex items-center hover:text-blue-500 transition-colors button-icon-reroll ' +
          (translationInProgress ? ' cursor-not-allowed opacity-50' : '')}
        class:dyna-icon={rerollIcon === 'dynamic'}
        disabled={translationInProgress}
        onclick={() => {
          if (translationInProgress) return
          onReroll()
        }}>
        <ArrowRight size={22} />
      </button>
    {:else if DBState.db.swipe}
      <button
        class={'flex items-center hover:text-blue-500 transition-colors button-icon-reroll ' +
          (translationInProgress ? ' cursor-not-allowed opacity-50' : '')}
        class:dyna-icon={rerollIcon === 'dynamic'}
        disabled={translationInProgress}
        onclick={(e) => {
          if (translationInProgress) return
          openRerollMenu(e, rerollMenu)
        }}>
        <RefreshCcwIcon size={20} />
      </button>
    {:else}
      <button
        class={'flex items-center hover:text-blue-500 transition-colors button-icon-reroll ' +
          (translationInProgress ? ' cursor-not-allowed opacity-50' : '')}
        class:dyna-icon={rerollIcon === 'dynamic'}
        disabled={translationInProgress}
        onclick={() => {
          if (translationInProgress) return
          onReroll()
        }}>
        <RefreshCcwIcon size={20} />
      </button>
    {/if}
  {/if}
{/snippet}

{#snippet rerollMenu()}
  <RerollList currentMessage={message} disabled={translationInProgress} {onNewReroll} {onSelectRerollCandidate} />
{/snippet}

{#snippet minorIconButtonsBody(showNames: boolean)}
  {#if DBState.db.enableBookmark}
    <button
      class="flex items-center hover:text-blue-500 transition-colors button-icon-bookmark {isBookmarked
        ? 'text-yellow-400'
        : ''}"
      onclick={() => {
        void toggleBookmark()
      }}>
      <BookmarkIcon size={20} />
      {#if showNames}
        <span class="ml-1">{language.bookmark}</span>
      {/if}
    </button>
  {/if}

  <button
    class="flex items-center hover:text-blue-500 transition-colors"
    onclick={() => {
      const previous = currentChatStateSnapshot()
      const currentChat =
        DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage]

      let folder
      let sourcePatch: { folderId?: string | null } = {}
      if (DBState.db.createFolderOnBranch && !currentChat.folderId) {
        const folderId = v4()
        folder = {
          id: folderId,
          name: `Branches of ${currentChat.name}`,
          folded: false,
        }
        sourcePatch = { folderId }
        localChatMutation(() => {
          DBState.db.characters[selIdState.selId].chatFolders ??= []
          DBState.db.characters[selIdState.selId].chatFolders.unshift(folder)
          currentChat.folderId = folderId
        })
      }

      const currentMessage = currentChat.message[idx]
      const newChat = cloneJsonValue(currentChat)
      if (sourcePatch.folderId) {
        newChat.folderId = sourcePatch.folderId
      }
      newChat.name = createChatCopyName(newChat.name, 'Branch')
      newChat.id = v4()
      newChat.message = newChat.message.slice(0, idx + 1)
      for (const item of newChat.message) {
        item.chatId = uuidv4()
      }
      newChat.message.push({
        role: 'char',
        data:
          '{{specialcomment::branchedfrom::' +
          currentChat.id +
          '::' +
          currentChat.name +
          '::' +
          currentMessage.chatId +
          '::}}',
        isComment: true,
        disabled: true,
        chatId: v4(),
      })

      localChatMutation(() => {
        DBState.db.characters[selIdState.selId].chats.unshift(newChat)
        changeChatTo(0)
      })
      if (currentChat.id) {
        const existingFolder =
          folder ??
          DBState.db.characters[selIdState.selId].chatFolders?.find(
            (item) => item.id === currentChat.folderId && item.name === `Branches of ${currentChat.name}`,
          )
        dispatchForkChat(currentChat.id, previous, {
          chat: newChat,
          sourcePatch: Object.keys(sourcePatch).length > 0 ? sourcePatch : { folderId: currentChat.folderId ?? null },
          folder: existingFolder,
        })
      }
    }}>
    <SplitIcon size={20} />
    {#if showNames}
      <span class="ml-1">{language.branch}</span>
    {/if}
  </button>

  <button
    class="flex items-center hover:text-blue-500 transition-colors"
    onclick={() => {
      const currentMessage =
        DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage].message[idx]
      const previous = currentChatScopedSnapshot()
      const disabled = !currentMessage.disabled
      const messageId = currentMessage.chatId
      if (canUseServerCommands()) {
        if (messageId) {
          dispatchUpdateMessageScoped(messageId, { disabled }, previous)
        } else {
          const chat = DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage]
          const nextMessages = cloneMessagesWithIds(chat)
          if (nextMessages[idx]) {
            nextMessages[idx].disabled = disabled
            dispatchReplaceMessagesForChat(chat, nextMessages, previous)
          }
        }
      } else {
        const localMessageId = ensureMessageId(currentMessage)
        DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage].message[
          idx
        ].disabled = disabled
        dispatchUpdateMessageScoped(localMessageId, { disabled }, previous)
      }
    }}>
    <PowerOff size={20} />
    {#if showNames}
      <span class="ml-1">{language.disableMessage}</span>
    {/if}
  </button>

  <button
    class="flex items-center hover:text-blue-500 transition-colors"
    onclick={() => {
      const currentMessage =
        DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage].message[idx]
      const previous = currentChatScopedSnapshot()
      const disabled = currentMessage.disabled === 'allBefore' ? false : 'allBefore'
      const messageId = currentMessage.chatId
      if (canUseServerCommands()) {
        if (messageId) {
          dispatchUpdateMessageScoped(messageId, { disabled }, previous)
        } else {
          const chat = DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage]
          const nextMessages = cloneMessagesWithIds(chat)
          if (nextMessages[idx]) {
            nextMessages[idx].disabled = disabled
            dispatchReplaceMessagesForChat(chat, nextMessages, previous)
          }
        }
      } else {
        const localMessageId = ensureMessageId(currentMessage)
        DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage].message[
          idx
        ].disabled = disabled
        dispatchUpdateMessageScoped(localMessageId, { disabled }, previous)
      }
    }}>
    <Scissors size={20} />
    {#if showNames}
      <span class="ml-1">{language.disableAbove}</span>
    {/if}
  </button>
{/snippet}

{#snippet senderIcon(options: { rounded?: boolean; styleFix?: string } = {})}
  {#if !blankMessage && !$HideIconStore}
    {#if DBState.db.characters[selIdState.selId]?.chaId === '§playground'}
      <div
        class="shadow-lg border-textcolor2 border flex justify-center items-center text-textcolor2"
        style={options?.styleFix ??
          `height:${(DBState.db.iconsize * 3.5) / 100}rem;width:${(DBState.db.iconsize * 3.5) / 100}rem;min-width:${(DBState.db.iconsize * 3.5) / 100}rem`}
        class:rounded-md={options?.rounded}
        class:rounded-full={options?.rounded}>
        {#if name === 'assistant'}
          <BotIcon />
        {:else}
          <UserIcon />
        {/if}
      </div>
    {:else}
      {#await img}
        <div
          class="shadow-lg bg-textcolor2"
          style={options?.styleFix ??
            `height:${(DBState.db.iconsize * 3.5) / 100}rem;width:${(DBState.db.iconsize * 3.5) / 100}rem;min-width:${(DBState.db.iconsize * 3.5) / 100}rem`}
          class:rounded-md={!options?.rounded}
          class:rounded-full={options?.rounded}>
        </div>
      {:then m}
        {#if largePortrait && !options?.rounded}
          <div
            class="shadow-lg bg-textcolor2"
            style={m +
              (options?.styleFix ??
                `height:${(DBState.db.iconsize * 3.5) / 100 / 0.75}rem;width:${(DBState.db.iconsize * 3.5) / 100}rem;min-width:${(DBState.db.iconsize * 3.5) / 100}rem`)}
            class:rounded-md={!options?.rounded}
            class:rounded-full={options?.rounded}>
          </div>
        {:else}
          <div
            class="shadow-lg bg-textcolor2"
            style={m +
              (options?.styleFix ??
                `height:${(DBState.db.iconsize * 3.5) / 100}rem;width:${(DBState.db.iconsize * 3.5) / 100}rem;min-width:${(DBState.db.iconsize * 3.5) / 100}rem`)}
            class:rounded-md={!options?.rounded}
            class:rounded-full={options?.rounded}>
          </div>
        {/if}
      {/await}
    {/if}
  {/if}
{/snippet}

{#snippet renderGuiHtmlPart(dom: HTMLElement)}
  {#if dom.tagName === 'IMG'}
    <img
      class={dom.getAttribute('class') ?? ''}
      src={dom.getAttribute('src') ?? ''}
      alt={dom.getAttribute('alt') ?? ''}
      style={dom.getAttribute('style') ?? ''} />
  {:else if dom.tagName === 'A'}
    <a
      target="_blank"
      rel="noreferrer"
      href={dom.getAttribute('href') && dom.getAttribute('href').startsWith('https') ? dom.getAttribute('href') : ''}
      class={dom.getAttribute('class') ?? ''}
      style={dom.getAttribute('style') ?? ''}>
      {@render renderChilds(dom)}
    </a>
  {:else if dom.tagName === 'SPAN'}
    <span class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
      {@render renderChilds(dom)}
    </span>
  {:else if dom.tagName === 'DIV'}
    <div class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
      {@render renderChilds(dom)}
    </div>
  {:else if dom.tagName === 'P'}
    <p class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
      {@render renderChilds(dom)}
    </p>
  {:else if dom.tagName === 'H1'}
    <h1 class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
      {@render renderChilds(dom)}
    </h1>
  {:else if dom.tagName === 'H2'}
    <h2 class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
      {@render renderChilds(dom)}
    </h2>
  {:else if dom.tagName === 'H3'}
    <h3 class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
      {@render renderChilds(dom)}
    </h3>
  {:else if dom.tagName === 'H4'}
    <h4 class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
      {@render renderChilds(dom)}
    </h4>
  {:else if dom.tagName === 'H5'}
    <h5 class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
      {@render renderChilds(dom)}
    </h5>
  {:else if dom.tagName === 'H6'}
    <h6 class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
      {@render renderChilds(dom)}
    </h6>
  {:else if dom.tagName === 'UL'}
    <ul class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
      {@render renderChilds(dom)}
    </ul>
  {:else if dom.tagName === 'OL'}
    <ol class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
      {@render renderChilds(dom)}
    </ol>
  {:else if dom.tagName === 'LI'}
    <li class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
      {@render renderChilds(dom)}
    </li>
  {:else if dom.tagName === 'TABLE'}
    <table class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
      {@render renderChilds(dom)}
    </table>
  {:else if dom.tagName === 'TR'}
    <tr class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
      {@render renderChilds(dom)}
    </tr>
  {:else if dom.tagName === 'TD'}
    <td class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
      {@render renderChilds(dom)}
    </td>
  {:else if dom.tagName === 'TH'}
    <th class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
      {@render renderChilds(dom)}
    </th>
  {:else if dom.tagName === 'HR'}
    <hr class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''} />
  {:else if dom.tagName === 'BR'}
    <br class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''} />
  {:else if dom.tagName === 'CODE'}
    <code class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
      {@render renderChilds(dom)}
    </code>
  {:else if dom.tagName === 'PRE'}
    <pre class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </pre>
  {:else if dom.tagName === 'BLOCKQUOTE'}
    <blockquote class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
      {@render renderChilds(dom)}
    </blockquote>
  {:else if dom.tagName === 'EM'}
    <em class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
      {@render renderChilds(dom)}
    </em>
  {:else if dom.tagName === 'STRONG'}
    <strong class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
      {@render renderChilds(dom)}
    </strong>
  {:else if dom.tagName === 'U'}
    <u class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
      {@render renderChilds(dom)}
    </u>
  {:else if dom.tagName === 'DEL'}
    <del class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
      {@render renderChilds(dom)}
    </del>
  {:else if dom.tagName === 'BUTTON'}
    <button
      {...getRisuButtonAttributes(dom)}
      class={dom.getAttribute('class') ?? ''}
      style={dom.getAttribute('style') ?? ''}>
      {@render renderChilds(dom)}
    </button>
  {:else if dom.tagName === 'RISUTEXTBOX'}
    {@render textBox()}
  {:else if dom.tagName === 'RISUICON'}
    {@render senderIcon()}
  {:else if dom.tagName === 'RISUBUTTONS'}
    {@render iconButtons()}
  {:else if dom.tagName === 'RISUGENINFO'}
    {@render genInfo()}
  {:else if dom.tagName === 'STYLE'}
    <svelte:element this={'style'}>
      {dom.innerHTML}
    </svelte:element>
  {:else}
    <div class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
      {@render renderChilds(dom)}
    </div>
  {/if}
{/snippet}

{#snippet renderChilds(dom: HTMLElement)}
  {#each dom.childNodes as node}
    {#if node.nodeType === Node.TEXT_NODE}
      {node.textContent}
    {:else if node.nodeType === Node.ELEMENT_NODE}
      {@render renderGuiHtmlPart(node as HTMLElement)}
    {/if}
  {/each}
{/snippet}

{#if disabled === true}
  <div class="w-full border-t-2 border-dashed border-blue-500"></div>
{/if}
<div
  class="flex max-w-full justify-center risu-chat"
  data-chat-index={idx}
  data-chat-id={messageRowId}
  data-risu-message-index={idx}
  data-risu-message-id={messageRowId}
  style={isLastMemory ? `border-top:${DBState.db.memoryLimitThickness}px solid rgba(98, 114, 164, 0.7);` : ''}
  onclickcapture={handleButtonTriggerWithin}>
  <div
    class="text-textcolor mt-1 ml-4 mr-4 mb-1 p-2 bg-transparent grow border-t-gray-900 border-opacity/30 border-transparent flexium items-start max-w-full">
    {#if DBState.db.theme === 'mobilechat' && !blankMessage}
      <div class={role === 'user' ? 'flex items-start w-full justify-end' : 'flex items-start'}>
        {#if role !== 'user'}
          {@render senderIcon({ rounded: true })}
        {/if}
        <div
          class="bg-gray-100 rounded-lg p-3 max-w-[70%] mx-2"
          class:rounded-tl-none={role !== 'user'}
          class:rounded-tr-none={role === 'user'}>
          <p class="text-gray-800">{@render textBox()}</p>
          {#if DBState.db.characters?.[selIdState.selId]?.chats?.[DBState.db.characters?.[selIdState.selId]?.chatPage]?.message?.[idx]?.time}
            <span class="text-xs text-textcolor2 mt-1 block">
              {new Intl.DateTimeFormat(undefined, {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                month: '2-digit',
                day: '2-digit',
                hour12: false,
              }).format(
                DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage].message[
                  idx
                ].time,
              )}
            </span>
          {/if}
        </div>
        {#if role === 'user'}
          {@render senderIcon({ rounded: true })}
        {/if}
      </div>
    {:else if DBState.db.theme === 'cardboard' && !blankMessage}
      <div class="w-full flex flex-col px-0 sm:px-4 py-4 relative">
        <div
          class="bg-linear-to-b from-gray-100 to-gray-200 rounded-lg shadow-lg border-gray-400 border p-4 flex flex-col">
          <div class="flex gap-4 mt-2 flex-col sm:flex-row">
            <div class="flex flex-col items-center">
              <div class="sm:h-96 sm:w-72 sm:min-w-72 w-48 h-64">
                {@render senderIcon({ rounded: false, styleFix: 'height:100%;width:100%;' })}
              </div>
              <h2 class="text-base font-bold text-gray-500 text-center mt-2 max-w-full text-ellipsis">
                {name}
              </h2>
            </div>
            {#if editMode}
              <textarea
                class="grow h-138 sm:h-96 overflow-y-auto bg-transparent text-black p-2 mb-2 resize-none message-edit-area"
                bind:value={message}></textarea>
            {:else}
              <div class="grow h-138 sm:h-96 overflow-y-auto p-2 mb-2 sm:mb-0">
                {@render textBox()}
              </div>
            {/if}
          </div>
        </div>
        <div
          class="absolute bottom-0 right-0 bg-linear-to-b from-gray-200 to-gray-300 p-2 rounded-md border border-gray-400 text-gray-400">
          {@render iconButtons({ applyTextColors: false })}
        </div>
      </div>
    {:else if DBState.db.theme === 'customHTML' && !blankMessage && hasCustomHtmlTemplate(DBState.db.guiHTML)}
      {@const customHtmlCacheScopeKey = `${currentChatId}|${$VariableReloadGUIPointer}`}
      {@render renderGuiHtmlPart(RenderGUIHtml(DBState.db.guiHTML, customHtmlCacheScopeKey))}
    {:else}
      {@render senderIcon({ rounded: DBState.db.roundIcons })}
      <span class="flex flex-col ml-4 w-full max-w-full min-w-0 text-black">
        <div class="flexium items-center chat-width">
          {#if DBState.db.characters[selIdState.selId]?.chaId === '§playground' && !blankMessage && DBState.db.characters[selIdState.selId]?.chats?.[DBState.db.characters[selIdState.selId]?.chatPage]?.message?.[idx]}
            <span class="chat-width text-xl border-darkborderc flex items-center text-textcolor">
              <span
                >{DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage]
                  .message[idx].role === 'char'
                  ? 'Assistant'
                  : 'User'}</span>
              <button
                class="ml-2 text-textcolor2 hover:text-textcolor"
                onclick={() => {
                  const previous = currentChatScopedSnapshot()
                  const chat =
                    DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage]
                  const role = chat.message[idx].role === 'char' ? 'user' : 'char'
                  const messageId = chat.message[idx].chatId
                  if (canUseServerCommands()) {
                    if (messageId) {
                      dispatchUpdateMessageScoped(messageId, { role }, previous)
                    } else {
                      const nextMessages = cloneMessagesWithIds(chat)
                      if (nextMessages[idx]) {
                        nextMessages[idx].role = role
                        dispatchReplaceMessagesForChat(chat, nextMessages, previous)
                      }
                    }
                  } else {
                    const localMessageId = ensureMessageId(chat.message[idx])
                    chat.message[idx].role = role
                    dispatchUpdateMessageScoped(localMessageId, { role }, previous)
                  }
                  ReloadChatPointer.update((v) => {
                    v[idx] = (v[idx] ?? 0) + 1
                    return v
                  })
                }}><ArrowLeftRightIcon size="18" /></button>
            </span>
          {:else if !blankMessage && !$HideIconStore}
            <div class="chat-width text-xl unmargin text-textcolor flex items-center">
              <span>{name}</span>
            </div>
          {/if}
          {@render iconButtons()}
        </div>
        {@render genInfo()}
        {@render textBox()}
      </span>
    {/if}
  </div>
</div>

{#if disabled}
  <div
    class={{
      'w-full border-t-2 border-dashed': true,
      'border-blue-500': disabled === true,
      'border-amber-500': disabled === 'allBefore',
    }}>
  </div>
{/if}

<style>
  .chat-generation-loading {
    width: min(34rem, 100%);
    color: var(--risu-theme-textcolor2);
  }

  .chat-generation-loading-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 1.5rem;
    font-size: 0.875rem;
    line-height: 1.25rem;
  }

  .chat-generation-loading-track {
    position: relative;
    height: 0.5rem;
    margin-top: 0.5rem;
    overflow: hidden;
    border: 1px solid var(--risu-theme-darkborderc);
    border-radius: 9999px;
    background: color-mix(in srgb, var(--risu-theme-darkbg) 82%, transparent);
  }

  .chat-generation-loading-fill {
    position: relative;
    height: 100%;
    min-width: 2rem;
    border-radius: inherit;
    background: var(--risu-theme-borderc);
    transition:
      width 0.35s ease,
      background-color 0.35s ease;
  }

  .chat-generation-loading-fill::after {
    position: absolute;
    inset: 0;
    content: '';
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.55), transparent);
    animation: chat-generation-loading-shine 1.25s ease-in-out infinite;
  }

  .chat-generation-loading-stage-1 {
    background: #60a5fa;
  }

  .chat-generation-loading-stage-2 {
    background: #db2777;
  }

  .chat-generation-loading-stage-3 {
    background: #34d399;
  }

  .chat-generation-loading-stage-4 {
    background: #8b5cf6;
  }

  @keyframes chat-generation-loading-shine {
    0% {
      transform: translateX(-100%);
    }

    100% {
      transform: translateX(100%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .chat-generation-loading-fill,
    .chat-generation-loading-fill::after {
      animation: none;
      transition: none;
    }
  }
</style>
