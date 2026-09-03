<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte'
  import type { character, Database, Message } from 'src/ts/storage/database.svelte'
  import Chat from './Chat.svelte'
  import { getCharImage } from 'src/ts/characterImage'
  import { ReloadChatPointer } from 'src/ts/stores.svelte'
  import { createSimpleCharacter } from 'src/ts/simpleCharacter'
  import {
    RegexDisplayReloadPointer,
    RegexDisplayReloadScope,
    regexDisplayReloadTokenForContext,
  } from 'src/ts/process/regexDisplayReload'
  import { chatFoldedStateMessageIndex } from 'src/ts/globalApi.svelte'
  import { get } from 'svelte/store'
  import { getTranscriptWindowRange } from './DefaultChatScreen.loadPages'
  import { getCharacterDisplayName } from 'src/ts/characterDisplayName'
  import { didChatOwnerChange } from './ChatsUnread'
  import { isMemoryLimitMessage } from './memoryLimitMarker'
  import {
    buildGenerationPersistenceStateLookup,
    generationPersistenceStateFromLookup,
    getGenerationFinalizationPersistencesForChat,
    type GenerationPersistenceIndicatorState,
  } from 'src/ts/process/generationPersistenceState'
  import { halfStreamingProgress } from 'src/ts/process/halfStreamingProgress'
  import {
    automaticTranslationMessageIds,
    consumeAutomaticTranslationEligibility,
    replaceAutomaticTranslationMessageIds,
    serverOwnedGeneratedMessageIds,
  } from 'src/ts/process/generatedMessageTranslationEligibility'
  import { newlyAppendedMessageIds } from './newMessageTranslationEligibility'
  import type { ActiveChatTarget } from 'src/ts/chatCommands'
  import { clearVisibleChat, markChatRead, markChatUnread, setVisibleChat } from 'src/ts/process/chatUnread.svelte'
  import { recordChatRowsBuild } from './chatRowsBuildInstrumentation'
  import { createInitialDisplayReadiness, shouldAwaitInitialDisplayParse } from './initialDisplayReadiness'
  import {
    finishGenerationDisplayProjection,
    generationDisplayProjections,
    type GenerationDisplayProjection,
  } from 'src/ts/process/generationDisplayProjection.svelte'
  import { activateDisplaySourceChat, releaseDisplaySourceChat } from 'src/ts/server/displaySources'
  import {
    charactersResourceState,
    getCharacterResourceOwner,
    getChatMetadataOwnerState,
    settingsResourceState,
  } from 'src/ts/server/resourceState.svelte'
  import { projectChatMetadata } from 'src/ts/server/chatMetadataOwner'
  import type { ChatGenerationActivity } from 'src/ts/process/generationActivity.svelte'
  import type { ChatGenerationLoadingPhase } from './chatGenerationLoading'

  const getCurrentChatRoomId = () => chatId ?? null

  let {
    messages,
    chatId,
    currentCharacter,
    onReroll,
    unReroll,
    onNewReroll,
    onSelectRerollCandidate,
    rerollTarget,
    currentUsername,
    userIcon,
    loadPages,
    userIconPortrait,
    scrollContainer = null,
    isGenerationActive = false,
    regenerateTargetMessageId = null,
    generationActivity = undefined,
    generationPhase = undefined,
    generationStage = 0,
    hasNewUnreadMessage = $bindable(false),
    initialDisplayPending = $bindable(false),
    initialRowsPending = false,
  }: {
    messages: Message[]
    chatId?: string | null
    currentCharacter: character
    onReroll: () => void
    unReroll: () => void
    onNewReroll: () => void
    onSelectRerollCandidate: (index: number) => void
    rerollTarget: ActiveChatTarget | null
    currentUsername: string
    userIcon: string
    loadPages: number
    userIconPortrait?: boolean
    scrollContainer?: HTMLDivElement | null
    isGenerationActive?: boolean
    regenerateTargetMessageId?: string | null
    generationActivity?: ChatGenerationActivity
    generationPhase?: ChatGenerationLoadingPhase
    generationStage?: number
    hasNewUnreadMessage?: boolean
    initialDisplayPending?: boolean
    initialRowsPending?: boolean
  } = $props()

  function legacyChatMetadataFallback(): ReturnType<typeof projectChatMetadata> | undefined {
    if (!chatId) return undefined
    const characterId = currentCharacter.chaId
    if (typeof characterId !== 'string' || characterId.trim().length === 0) return undefined

    const rows = charactersResourceState.characters
    if (rows.length > 0) {
      if (charactersResourceState.rowStatuses[characterId] === 'error') return undefined
      const characterMatches = rows.filter((candidate) => candidate?.chaId === characterId)
      if (characterMatches.length !== 1) return undefined
      const chatMatches = characterMatches[0].chats?.filter((candidate) => candidate?.id === chatId) ?? []
      const globalChatMatches = rows.reduce(
        (count, character) => count + (character.chats ?? []).filter((candidate) => candidate?.id === chatId).length,
        0,
      )
      return chatMatches.length === 1 && globalChatMatches === 1
        ? projectChatMetadata(chatId, chatMatches[0])
        : undefined
    }

    const compatibilityChats = currentCharacter.chats?.filter((candidate) => candidate?.id === chatId) ?? []
    return compatibilityChats.length === 1 ? projectChatMetadata(chatId, compatibilityChats[0]) : undefined
  }

  let currentChatMetadata = $derived.by(() => {
    if (!chatId) return undefined
    if (charactersResourceState.status === 'ready') {
      const characterId = currentCharacter.chaId
      if (typeof characterId !== 'string' || characterId.trim().length === 0) return undefined
      const characterOwner = getCharacterResourceOwner(characterId)
      if (!characterOwner || charactersResourceState.rowStatuses[characterId] === 'error') return undefined
      const chatMatches = characterOwner.chats?.filter((candidate) => candidate?.id === chatId) ?? []
      return chatMatches.length === 1 ? getChatMetadataOwnerState(chatId) : undefined
    }
    if (charactersResourceState.status !== 'idle' && charactersResourceState.status !== 'loading') return undefined
    return legacyChatMetadataFallback()
  })

  function readSettingsGroup(group: 'display' | 'sidebar'): Partial<Database> {
    const status = settingsResourceState.groupStatuses[group] ?? 'idle'
    if (status === 'ready') return settingsResourceState.value as Partial<Database>
    if (status === 'idle' || status === 'loading') return settingsResourceState.value as Partial<Database>
    return {}
  }

  let showMemoryLimit = $derived(readSettingsGroup('display').showMemoryLimit === true)
  let autoScrollToNewMessage = $derived(
    settingsResourceState.groupStatuses.sidebar === 'error'
      ? false
      : readSettingsGroup('sidebar').autoScrollToNewMessage !== false,
  )
  let alwaysScrollToNewMessage = $derived(readSettingsGroup('sidebar').alwaysScrollToNewMessage === true)

  let chatBody: HTMLDivElement
  let latestMessageResizeObserver: ResizeObserver | null = null
  let latestMessageResizeTarget: HTMLElement | null = null
  let scrollContainerResizeObserver: ResizeObserver | null = null
  let scrollContainerResizeTarget: HTMLElement | null = null
  let latestMessageEndReassertQueued = false
  let latestMessageEndReassertVersion = 0
  type TranscriptAnchor = 'end' | 'free'
  let transcriptAnchor: TranscriptAnchor = 'free'
  let transcriptAnchorKey: string | null = null
  let pendingGeneratedMessageEndKey: string | null = null
  let chatsComponentDestroyed = false
  const initialDisplayReadiness = createInitialDisplayReadiness((pending) => {
    initialDisplayPending = pending
  }, tick)
  let activeHalfStreamingTokensPerSecond = $derived.by(() => {
    const currentChatId = getCurrentChatRoomId()
    const progress = $halfStreamingProgress.find(
      (entry) => entry.characterId === currentCharacter.chaId && entry.chatId === currentChatId,
    )
    return progress?.tokensPerSecond
  })
  let activeRegenerateProjection = $derived.by(() => {
    const currentChatId = getCurrentChatRoomId()
    if (!currentChatId) return undefined
    return $generationDisplayProjections
      .filter((projection) => projection.chatId === currentChatId && projection.mode === 'regenerate')
      .sort(
        (left, right) =>
          left.projectionEpoch - right.projectionEpoch ||
          left.attemptNo - right.attemptNo ||
          left.operationId.localeCompare(right.operationId),
      )
      .at(-1)
  })
  let activeAppendActivity = $derived.by(() => {
    if (
      !isGenerationActive ||
      generationActivity?.kind !== 'message' ||
      generationActivity.mode !== 'send' ||
      generationActivity.chatId !== getCurrentChatRoomId()
    ) {
      return undefined
    }
    return generationActivity
  })
  let activeAppendMessageIndex = $derived.by(() => {
    const generationId = activeAppendActivity?.generationId
    if (!generationId) return -1
    return messages.findIndex(
      (message) =>
        message.role === 'char' &&
        (message.chatId === generationId || message.generationInfo?.generationId === generationId),
    )
  })
  let activeAppendPresentationKey = $derived(
    activeAppendActivity ? `generation-activity:${activeAppendActivity.id}` : null,
  )
  let presentationKeyAliases: Record<string, string> = $state({})
  let appendPresentationKeyAliases: Record<string, string> = $state({})
  let regexDisplayReloadToken = $derived(
    regexDisplayReloadTokenForContext($RegexDisplayReloadPointer, $RegexDisplayReloadScope, {
      characterId: currentCharacter?.chaId,
      chatId: chatId ?? undefined,
    }),
  )

  const chatRows = $derived.by(() => {
    void regexDisplayReloadToken
    void activeRegenerateProjection
    void activeAppendActivity
    void activeAppendMessageIndex
    const charImage = getCharImage(currentCharacter.image, 'css')
    const userImage = getCharImage(userIcon, 'css')
    const simpleChar = createSimpleCharacter(
      currentCharacter,
      untrack(() => currentCharacter.customscript),
    )
    const currentChatId = chatId ?? null
    recordChatRowsBuild(currentChatId)
    const generationPersistenceLookup = buildGenerationPersistenceStateLookup(
      getGenerationFinalizationPersistencesForChat(currentChatId),
    )
    const lastMemoryId = currentChatMetadata?.lastMemory
    const { loadStart, loadEnd } = getTranscriptWindowRange({
      messageCount: messages.length,
      loadPages,
      foldedMessageIndex: chatFoldedStateMessageIndex.index,
    })

    const reloadPointerMap = get(ReloadChatPointer)
    const rows: {
      key: string
      message: Message
      idx: number
      img: string | Promise<string>
      largePortrait: boolean
      name: string
      character: ReturnType<typeof createSimpleCharacter>
      isLastMemory: boolean
      generationPersistenceState: GenerationPersistenceIndicatorState | null
      scopeId: string | null
      awaitInitialDisplayParse: boolean
      isRegenerationTarget: boolean
      isAppendGenerationPresentation: boolean
      generationPresentationMode?: 'send' | 'regenerate'
      generationDisplayProjection?: GenerationDisplayProjection
    }[] = []

    for (let i = loadStart; i >= loadEnd; i--) {
      if (i < 0) break // Prevent out of bounds
      const message = messages[i]
      const messageLargePortrait =
        message.role === 'user' ? (userIconPortrait ?? false) : ((currentCharacter as character).largePortrait ?? false)
      const reloadPointer = reloadPointerMap[i] ?? 0
      const generationDisplayProjection =
        activeRegenerateProjection &&
        (activeRegenerateProjection.targetMessageId === message.chatId ||
          activeRegenerateProjection.generationId === message.chatId)
          ? activeRegenerateProjection
          : undefined
      const presentationKey =
        (generationDisplayProjection?.targetMessageId
          ? (presentationKeyAliases[generationDisplayProjection.targetMessageId] ??
            generationDisplayProjection.targetMessageId)
          : message.chatId
            ? presentationKeyAliases[message.chatId]
            : undefined) ??
        message.chatId ??
        `message-${i}`
      const isAppendGenerationPresentation = activeAppendMessageIndex === i && activeAppendPresentationKey !== null
      const rowKey =
        (message.chatId ? appendPresentationKeyAliases[message.chatId] : undefined) ??
        (isAppendGenerationPresentation ? activeAppendPresentationKey : `${presentationKey}:${i}:${reloadPointer}`)
      rows.push({
        key: rowKey,
        message,
        idx: i,
        img: message.role === 'user' ? userImage : charImage,
        largePortrait: messageLargePortrait,
        name: message.role === 'user' ? currentUsername : getCharacterDisplayName(currentCharacter),
        character: simpleChar,
        generationPersistenceState: generationPersistenceStateFromLookup(generationPersistenceLookup, message),
        isLastMemory: isMemoryLimitMessage(showMemoryLimit, lastMemoryId, message.chatId),
        scopeId: currentChatId ?? null,
        awaitInitialDisplayParse: shouldAwaitInitialDisplayParse(i, messages.length),
        isRegenerationTarget:
          isGenerationActive && regenerateTargetMessageId !== null && regenerateTargetMessageId === message.chatId,
        isAppendGenerationPresentation,
        ...(isAppendGenerationPresentation ? { generationPresentationMode: 'send' as const } : {}),
        ...(generationDisplayProjection ? { generationPresentationMode: 'regenerate' as const } : {}),
        ...(generationDisplayProjection ? { generationDisplayProjection } : {}),
      })
    }

    if (activeAppendActivity && activeAppendMessageIndex < 0 && activeAppendPresentationKey) {
      rows.unshift({
        key: activeAppendPresentationKey,
        message: {
          role: 'char',
          data: '',
          saying: currentCharacter.chaId,
          time: activeAppendActivity.startedAt,
          ...(activeAppendActivity.generationId
            ? {
                chatId: activeAppendActivity.generationId,
                generationInfo: { generationId: activeAppendActivity.generationId },
              }
            : {}),
        },
        idx: messages.length,
        img: charImage,
        largePortrait: (currentCharacter as character).largePortrait ?? false,
        name: getCharacterDisplayName(currentCharacter),
        character: simpleChar,
        generationPersistenceState: null,
        isLastMemory: false,
        scopeId: currentChatId,
        awaitInitialDisplayParse: false,
        isRegenerationTarget: false,
        isAppendGenerationPresentation: true,
        generationPresentationMode: 'send',
      })
    }

    return rows
  })

  // The row that reveals the dynamic (swipe) icons. Comment rows — e.g. the
  // branch-provenance marker appended by branching — can occupy the newest
  // slot but render no reroll controls, so anchoring on the newest row
  // unconditionally would leave the chat with no visible swipe controls.
  const dynaIconRowKey = $derived(chatRows.find((row) => !row.message.isComment)?.key ?? null)

  function getLatestMessageElement(): HTMLElement | null {
    return chatBody?.querySelector<HTMLElement>(':scope > .chat-message-container') ?? null
  }

  function getLatestMessageAlignmentKey(): string | null {
    const chatRoomId = getCurrentChatRoomId()
    const latestRow = chatRows[0]
    if (!chatRoomId || !latestRow) return null
    return `${chatRoomId}:row:${latestRow.key}`
  }

  function currentTranscriptAnchor(): TranscriptAnchor {
    const latestMessageKey = getLatestMessageAlignmentKey()
    if (!latestMessageKey || transcriptAnchorKey !== latestMessageKey) return 'free'
    return transcriptAnchor
  }

  function setTranscriptAnchor(nextAnchor: TranscriptAnchor, latestMessageKey = getLatestMessageAlignmentKey()): void {
    if (nextAnchor === 'free' || !latestMessageKey) {
      transcriptAnchor = 'free'
      transcriptAnchorKey = null
      return
    }

    transcriptAnchor = nextAnchor
    transcriptAnchorKey = latestMessageKey
  }

  function checkIfAtBottom() {
    if (!scrollContainer) return true
    const lastEl = getLatestMessageElement()
    if (!lastEl) return true
    const rect = lastEl.getBoundingClientRect()
    const scRect = scrollContainer.getBoundingClientRect()
    return rect.top <= scRect.bottom + 100
  }

  function transcriptIsAtLatestPosition(): boolean {
    return !scrollContainer || Math.max(0, -scrollContainer.scrollTop) <= 1
  }

  function reassertTranscriptEnd(latestMessageKey: string): void {
    if (
      currentTranscriptAnchor() === 'end' &&
      transcriptAnchorKey === latestMessageKey &&
      getLatestMessageAlignmentKey() === latestMessageKey &&
      scrollContainer
    ) {
      scrollContainer.scrollTop = 0
    }
    void tick().then(() => {
      if (
        currentTranscriptAnchor() === 'end' &&
        transcriptAnchorKey === latestMessageKey &&
        getLatestMessageAlignmentKey() === latestMessageKey &&
        scrollContainer
      ) {
        scrollContainer.scrollTop = 0
      }
    })
  }

  function followLatestAtNaturalEnd(latestMessageKey = getLatestMessageAlignmentKey()): void {
    if (!latestMessageKey) {
      if (scrollContainer) scrollContainer.scrollTop = 0
      return
    }
    setTranscriptAnchor('end', latestMessageKey)
    reassertTranscriptEnd(latestMessageKey)
  }

  function scheduleLatestMessageEndReassert(): void {
    if (latestMessageEndReassertQueued || chatsComponentDestroyed) return

    latestMessageEndReassertQueued = true
    const version = latestMessageEndReassertVersion
    const reassert = () => {
      latestMessageEndReassertQueued = false
      if (
        chatsComponentDestroyed ||
        version !== latestMessageEndReassertVersion ||
        latestMessageResizeTarget !== getLatestMessageElement() ||
        scrollContainerResizeTarget !== scrollContainer
      ) {
        return
      }

      const latestMessageKey = getLatestMessageAlignmentKey()
      if (latestMessageKey && currentTranscriptAnchor() === 'end') reassertTranscriptEnd(latestMessageKey)
    }

    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(reassert)
    else setTimeout(reassert, 0)
  }

  function observeLatestMessageSize(target: HTMLElement | null): boolean {
    if (target === latestMessageResizeTarget) return false

    latestMessageResizeObserver?.disconnect()
    latestMessageResizeObserver = null
    latestMessageResizeTarget = target
    latestMessageEndReassertVersion += 1
    latestMessageEndReassertQueued = false

    if (!target || typeof ResizeObserver === 'undefined') return true

    latestMessageResizeObserver = new ResizeObserver(() => {
      if (target !== latestMessageResizeTarget) return
      scheduleLatestMessageEndReassert()
    })
    latestMessageResizeObserver.observe(target)
    return true
  }

  function observeScrollContainerSize(target: HTMLElement | null): boolean {
    if (target === scrollContainerResizeTarget) return false

    scrollContainerResizeObserver?.disconnect()
    scrollContainerResizeObserver = null
    scrollContainerResizeTarget = target
    latestMessageEndReassertVersion += 1
    latestMessageEndReassertQueued = false

    if (!target || typeof ResizeObserver === 'undefined') return true

    scrollContainerResizeObserver = new ResizeObserver(() => {
      if (target !== scrollContainerResizeTarget) return
      scheduleLatestMessageEndReassert()
    })
    scrollContainerResizeObserver.observe(target)
    return true
  }

  export const scrollToLatestMessage = () => {
    hasNewUnreadMessage = false
    const chatRoomId = getCurrentChatRoomId()
    markChatRead(chatRoomId)
    pendingEntryChatRoomId = null
    followLatestAtNaturalEnd()
  }

  interface GenerationFollowState {
    projectionKey: string
    follow: boolean
    userCancelled: boolean
  }

  let generationFollowState: GenerationFollowState | null = null
  let previousGenerationPresentationKey: string | null = null
  let pendingGenerationWasAtLatest = true
  let transcriptUserIntentPending = false

  function regenerateProjectionKey(projection: GenerationDisplayProjection | undefined): string | null {
    return projection ? `${projection.operationId}:${projection.attemptNo}` : null
  }

  function currentGenerationPresentationKey(): string | null {
    return regenerateProjectionKey(activeRegenerateProjection) ?? activeAppendPresentationKey
  }

  function reassertGenerationNaturalEnd(projectionKey: string): void {
    void tick().then(() => {
      if (
        generationFollowState?.projectionKey === projectionKey &&
        generationFollowState.follow &&
        currentGenerationPresentationKey() === projectionKey &&
        scrollContainer
      ) {
        scrollContainer.scrollTop = 0
      }
    })
  }

  export const handleTranscriptUserInteraction = () => {
    if (generationFollowState?.follow) transcriptUserIntentPending = true
  }

  export const handleTranscriptScroll = () => {
    if (transcriptIsAtLatestPosition()) {
      transcriptUserIntentPending = false
      followLatestAtNaturalEnd()
      return
    }
    if (generationFollowState?.follow) {
      if (transcriptUserIntentPending) {
        generationFollowState = { ...generationFollowState, follow: false, userCancelled: true }
        transcriptUserIntentPending = false
        setTranscriptAnchor('free')
        return
      }
      reassertGenerationNaturalEnd(generationFollowState.projectionKey)
      return
    }

    transcriptUserIntentPending = false
    setTranscriptAnchor('free')
  }

  let previousLength = 0
  let previousChatRoomId: string | null = null
  let previousMessageIds: (string | null)[] = []
  let wasAtBottomBeforeUpdate = true
  let pendingEntryChatRoomId: string | null = null
  let visibleChatRoomId: string | null = null
  let previousIsGenerationActive = false

  $effect.pre(() => {
    const projectionKey = currentGenerationPresentationKey()
    if (projectionKey && projectionKey !== previousGenerationPresentationKey) {
      pendingGenerationWasAtLatest = transcriptIsAtLatestPosition()
    }
  })

  $effect(() => {
    chatRows
    const projection = activeRegenerateProjection
    const projectionKey = currentGenerationPresentationKey()
    const currentChatRoomId = getCurrentChatRoomId()

    const activeAppendMessageId =
      activeAppendMessageIndex >= 0 ? messages[activeAppendMessageIndex]?.chatId : activeAppendActivity?.generationId
    if (activeAppendMessageId && activeAppendPresentationKey) {
      if (appendPresentationKeyAliases[activeAppendMessageId] !== activeAppendPresentationKey) {
        appendPresentationKeyAliases = {
          ...appendPresentationKeyAliases,
          [activeAppendMessageId]: activeAppendPresentationKey,
        }
      }
    }

    if (projection?.targetMessageId) {
      const inheritedKey = presentationKeyAliases[projection.targetMessageId] ?? projection.targetMessageId
      const nextAliases = {
        ...presentationKeyAliases,
        [projection.targetMessageId]: inheritedKey,
        ...(projection.generationId ? { [projection.generationId]: inheritedKey } : {}),
      }
      if (
        presentationKeyAliases[projection.targetMessageId] !== inheritedKey ||
        (projection.generationId && presentationKeyAliases[projection.generationId] !== inheritedKey)
      ) {
        presentationKeyAliases = nextAliases
      }
    }

    if (
      projection?.status === 'finalizing' &&
      projection.generationId &&
      messages.some(
        (message) =>
          message.role === 'char' &&
          (message.chatId === projection.generationId ||
            message.generationInfo?.generationId === projection.generationId),
      )
    ) {
      finishGenerationDisplayProjection(projection)
      return
    }

    if (projectionKey && projectionKey !== previousGenerationPresentationKey) {
      const follow = autoScrollToNewMessage && (pendingGenerationWasAtLatest || alwaysScrollToNewMessage)
      generationFollowState = { projectionKey, follow, userCancelled: false }
      transcriptUserIntentPending = false
      if (follow) {
        followLatestAtNaturalEnd()
        reassertGenerationNaturalEnd(projectionKey)
      }
      previousGenerationPresentationKey = projectionKey
      return
    }

    if (projectionKey && generationFollowState?.projectionKey === projectionKey && generationFollowState.follow) {
      followLatestAtNaturalEnd()
      reassertGenerationNaturalEnd(projectionKey)
      return
    }

    if (!projectionKey && previousGenerationPresentationKey) {
      const settledFollow = generationFollowState
      previousGenerationPresentationKey = null
      generationFollowState = null
      transcriptUserIntentPending = false
      if (settledFollow?.follow && !settledFollow.userCancelled && currentChatRoomId) {
        followLatestAtNaturalEnd()
      }
    }
  })

  onDestroy(() => {
    chatsComponentDestroyed = true
    releaseDisplaySourceChat(getCurrentChatRoomId())
    initialDisplayReadiness.destroy()
    latestMessageEndReassertVersion += 1
    latestMessageResizeObserver?.disconnect()
    scrollContainerResizeObserver?.disconnect()
    clearVisibleChat(visibleChatRoomId)
  })

  $effect.pre(() => {
    activateDisplaySourceChat(getCurrentChatRoomId())
    chatRows
    wasAtBottomBeforeUpdate = checkIfAtBottom()
  })

  $effect.pre(() => {
    initialDisplayReadiness.updateScope(getCurrentChatRoomId(), chatRows.length > 0, initialRowsPending)
  })

  $effect(() => {
    chatRows
    const latestMessage = getLatestMessageElement()
    const latestMessageTargetChanged = observeLatestMessageSize(latestMessage)
    const scrollContainerTargetChanged = observeScrollContainerSize(scrollContainer)
    const currentChatRoomId = getCurrentChatRoomId()
    const isSameChat = currentChatRoomId === previousChatRoomId
    if (didChatOwnerChange(previousChatRoomId, currentChatRoomId)) {
      presentationKeyAliases = {}
      appendPresentationKeyAliases = {}
      clearVisibleChat(visibleChatRoomId)
      setVisibleChat(currentChatRoomId)
      visibleChatRoomId = currentChatRoomId
      setTranscriptAnchor('free')
      transcriptUserIntentPending = false
      pendingGeneratedMessageEndKey = null
      pendingEntryChatRoomId = currentChatRoomId
      hasNewUnreadMessage = false
      markChatRead(currentChatRoomId)
      replaceAutomaticTranslationMessageIds([])
      previousIsGenerationActive = isGenerationActive
    } else {
      const residentMessageIds = new Set(messages.map((message) => message.chatId).filter((id): id is string => !!id))
      const retainedIds = untrack(() => $automaticTranslationMessageIds).filter(
        (id) => residentMessageIds.has(id) && !$serverOwnedGeneratedMessageIds.has(id),
      )
      const appendedIds = newlyAppendedMessageIds({
        previousChatId: previousChatRoomId,
        currentChatId: currentChatRoomId,
        previousMessageIds,
        messages,
        autoTranslate: currentChatMetadata?.autoTranslate === true,
      })
      replaceAutomaticTranslationMessageIds([
        ...retainedIds,
        ...appendedIds.filter((id) => !$serverOwnedGeneratedMessageIds.has(id)),
      ])
    }

    // A chat can first render as a message-less hydration shell. Keep entry
    // following pending until its newest persisted row reaches the DOM.
    if (currentChatRoomId && pendingEntryChatRoomId === currentChatRoomId && chatRows.length > 0 && scrollContainer) {
      pendingEntryChatRoomId = null
      followLatestAtNaturalEnd()
    }

    // Only auto-scroll if it's the same chat and new messages were added
    if (isSameChat && messages.length > previousLength) {
      const lastMsg = messages[messages.length - 1]
      if (lastMsg && lastMsg.role === 'char') {
        const latestMessageKey = getLatestMessageAlignmentKey()
        const isAssistantPlaceholder = lastMsg.data === '' && latestMessageKey !== null
        const shouldFollowLatest = autoScrollToNewMessage && (wasAtBottomBeforeUpdate || alwaysScrollToNewMessage)

        if (isAssistantPlaceholder) pendingGeneratedMessageEndKey = latestMessageKey

        if (shouldFollowLatest) {
          followLatestAtNaturalEnd(latestMessageKey)
        } else if (!wasAtBottomBeforeUpdate) {
          hasNewUnreadMessage = true
          markChatUnread(currentChatRoomId)
        }
      }
    }

    // DefaultChatScreen scopes this prop to its displayed chat id, so its
    // same-chat falling edge cannot be caused by a background generation.
    if (
      isSameChat &&
      previousIsGenerationActive &&
      !isGenerationActive &&
      pendingGeneratedMessageEndKey !== null &&
      pendingGeneratedMessageEndKey === getLatestMessageAlignmentKey()
    ) {
      const completedLatestMessageKey = pendingGeneratedMessageEndKey
      pendingGeneratedMessageEndKey = null
      const wasAtLatestPosition = transcriptIsAtLatestPosition()

      const shouldFollowLatest = autoScrollToNewMessage && (wasAtLatestPosition || alwaysScrollToNewMessage)
      if (
        shouldFollowLatest &&
        currentChatRoomId &&
        getCurrentChatRoomId() === currentChatRoomId &&
        getLatestMessageAlignmentKey() === completedLatestMessageKey
      ) {
        followLatestAtNaturalEnd(completedLatestMessageKey)
      } else if (!wasAtLatestPosition) {
        hasNewUnreadMessage = true
        markChatUnread(currentChatRoomId)
      }
    }

    if ((latestMessageTargetChanged || scrollContainerTargetChanged) && transcriptIsAtLatestPosition()) {
      followLatestAtNaturalEnd()
    }

    previousIsGenerationActive = isGenerationActive
    previousLength = messages.length
    previousMessageIds = messages.map((message) => message.chatId ?? null)
    previousChatRoomId = currentChatRoomId
  })
</script>

<div class="chat-screen-content-width flex flex-col-reverse" bind:this={chatBody}>
  {#each chatRows as row (row.key)}
    <div
      class="chat-message-container"
      data-risu-dyna-icons={row.key === dynaIconRowKey ? 'true' : undefined}
      data-generation-display-projection={row.generationPresentationMode}>
      <Chat
        message={row.generationDisplayProjection ? (row.generationDisplayProjection.text ?? '') : row.message.data}
        translation={row.generationDisplayProjection ? null : (row.message.translation ?? null)}
        isLastMemory={row.isLastMemory}
        idx={row.idx}
        totalLength={messages.length}
        img={row.img}
        {onReroll}
        {unReroll}
        {onNewReroll}
        {onSelectRerollCandidate}
        {rerollTarget}
        rerollIcon="dynamic"
        character={row.character}
        largePortrait={row.largePortrait}
        messageGenerationInfo={row.message.generationInfo}
        role={row.message.role}
        name={row.name}
        isComment={row.message.isComment ?? false}
        isGenerationLoading={row.isRegenerationTarget ||
          row.isAppendGenerationPresentation ||
          row.generationDisplayProjection !== undefined ||
          (isGenerationActive &&
            row.idx === messages.length - 1 &&
            row.message.role === 'char' &&
            row.message.data === '')}
        isGenerationProjection={row.isAppendGenerationPresentation || row.generationDisplayProjection !== undefined}
        generationPresentationMode={row.generationPresentationMode}
        isChatGenerating={isGenerationActive}
        halfStreamingTokensPerSecond={row.isAppendGenerationPresentation ||
        (row.idx === messages.length - 1 && row.message.role === 'char')
          ? activeHalfStreamingTokensPerSecond
          : undefined}
        autoTranslateOnReady={typeof row.message.chatId === 'string' &&
          $automaticTranslationMessageIds.includes(row.message.chatId) &&
          !$serverOwnedGeneratedMessageIds.has(row.message.chatId)}
        onAutoTranslationEligibilityConsumed={() => consumeAutomaticTranslationEligibility(row.message.chatId ?? '')}
        onInitialDisplayParseStart={row.awaitInitialDisplayParse
          ? (registration) => initialDisplayReadiness.start(row.scopeId, registration)
          : undefined}
        onInitialDisplayParseSettled={row.awaitInitialDisplayParse
          ? (registration) => initialDisplayReadiness.settle(row.scopeId, registration)
          : undefined}
        displayPriority={row.awaitInitialDisplayParse ? 'critical' : 'background'}
        generationPersistenceState={row.generationPersistenceState}
        {generationPhase}
        generationStartedAt={row.isAppendGenerationPresentation ? generationActivity?.startedAt : undefined}
        {generationStage}
        disabled={row.message.disabled ?? false} />
    </div>
  {/each}
</div>
