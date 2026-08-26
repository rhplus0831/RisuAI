<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte'
  import { getDatabase, type character, type Message } from 'src/ts/storage/database.svelte'
  import Chat from './Chat.svelte'
  import { getCharImage } from 'src/ts/characterImage'
  import { selectedCharID, ReloadChatPointer } from 'src/ts/stores.svelte'
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
  import { scrollElementToContainerStart } from './chatScroll'
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

  const getCurrentChatRoomId = () => {
    const charId = get(selectedCharID)
    if (charId < 0) return null
    const char = getDatabase().characters[charId]
    if (!char) return null
    return char.chats?.[char.chatPage]?.id ?? null
  }

  let {
    messages,
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
    generationStage = 0,
    hasNewUnreadMessage = $bindable(false),
    initialDisplayPending = $bindable(false),
    initialRowsPending = false,
  }: {
    messages: Message[]
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
    generationStage?: number
    hasNewUnreadMessage?: boolean
    initialDisplayPending?: boolean
    initialRowsPending?: boolean
  } = $props()

  let chatBody: HTMLDivElement
  let latestMessageScrollSpacerHeight = $state(0)
  let latestMessageDerivedSpacerHeight = 0
  let latestMessageResizeObserver: ResizeObserver | null = null
  let latestMessageResizeTarget: HTMLElement | null = null
  let scrollContainerResizeObserver: ResizeObserver | null = null
  let scrollContainerResizeTarget: HTMLElement | null = null
  let latestMessageGeometryMeasureQueued = false
  let latestMessageGeometryMeasureSawRowResize = false
  let latestMessageGeometryMeasureVersion = 0
  let latestMessageGeometryKey: string | null = null
  let latestMessageAlignmentPinned = false
  let latestMessageNaturalEndKey: string | null = null
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
  let presentationKeyAliases: Record<string, string> = $state({})
  let regexDisplayReloadToken = $derived(
    regexDisplayReloadTokenForContext($RegexDisplayReloadPointer, $RegexDisplayReloadScope, {
      characterId: currentCharacter?.chaId,
      chatId: currentCharacter?.chats?.[currentCharacter.chatPage]?.id,
    }),
  )

  const chatRows = $derived.by(() => {
    void regexDisplayReloadToken
    void activeRegenerateProjection
    const charImage = getCharImage(currentCharacter.image, 'css')
    const userImage = getCharImage(userIcon, 'css')
    const simpleChar = createSimpleCharacter(
      currentCharacter,
      untrack(() => currentCharacter.customscript),
    )
    const database = getDatabase()
    const currentChat = currentCharacter.chats?.[currentCharacter.chatPage]
    const currentChatId = currentChat?.id
    recordChatRowsBuild(currentChatId)
    const generationPersistenceLookup = buildGenerationPersistenceStateLookup(
      getGenerationFinalizationPersistencesForChat(currentChatId),
    )
    const lastMemoryId = currentChat?.lastMemory
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
      rows.push({
        key: `${presentationKey}:${i}:${reloadPointer}`,
        message,
        idx: i,
        img: message.role === 'user' ? userImage : charImage,
        largePortrait: messageLargePortrait,
        name: message.role === 'user' ? currentUsername : getCharacterDisplayName(currentCharacter),
        character: simpleChar,
        generationPersistenceState: generationPersistenceStateFromLookup(generationPersistenceLookup, message),
        isLastMemory: isMemoryLimitMessage(database.showMemoryLimit, lastMemoryId, message.chatId),
        scopeId: currentChatId ?? null,
        awaitInitialDisplayParse: shouldAwaitInitialDisplayParse(i, messages.length),
        isRegenerationTarget:
          isGenerationActive && regenerateTargetMessageId !== null && regenerateTargetMessageId === message.chatId,
        ...(generationDisplayProjection ? { generationDisplayProjection } : {}),
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

  function latestMessageUsesNaturalEnd(): boolean {
    return latestMessageNaturalEndKey !== null && latestMessageNaturalEndKey === getLatestMessageAlignmentKey()
  }

  function checkIfAtBottom() {
    if (!scrollContainer) return true
    const lastEl = getLatestMessageElement()
    if (!lastEl) return true
    const rect = lastEl.getBoundingClientRect()
    const scRect = scrollContainer.getBoundingClientRect()
    return rect.top <= scRect.bottom + 100
  }

  let latestMessageAlignmentRun = 0
  let isAligningLatestMessage = false
  const latestMessageSpacerEpsilon = 0.5

  function transcriptIsAtLatestPosition(): boolean {
    return !scrollContainer || Math.max(0, -scrollContainer.scrollTop) <= 1
  }

  function appliedSpacerDomHeight(): number {
    const spacer = chatBody?.querySelector<HTMLElement>(':scope > [data-latest-message-scroll-spacer]')
    if (!spacer) return 0

    const rectHeight = spacer.getBoundingClientRect().height
    const inlineHeight = Number.parseFloat(spacer.style.height)
    if (Number.isFinite(rectHeight) && rectHeight > 0) return rectHeight
    return Number.isFinite(inlineHeight) ? Math.max(0, inlineHeight) : 0
  }

  function scrollerContentEnd(): number | null {
    if (!scrollContainer) return null

    let detachedComposerHeight = 0
    let child = scrollContainer.firstElementChild
    while (child instanceof HTMLElement) {
      const rect = child.getBoundingClientRect()
      if (child.matches('[data-default-chat-composer-flow][data-floating-chat-input="true"]')) {
        detachedComposerHeight += Math.max(0, rect.height)
        child = child.nextElementSibling
        continue
      }

      const position = getComputedStyle(child).position
      if (position !== 'absolute' && position !== 'fixed') return rect.bottom + detachedComposerHeight
      child = child.nextElementSibling
    }

    return null
  }

  function applyLatestMessageSpacerHeight(): boolean {
    const nextHeight = latestMessageUsesNaturalEnd() ? 0 : latestMessageDerivedSpacerHeight
    const pendingDomFlush = Math.abs(nextHeight - appliedSpacerDomHeight()) >= latestMessageSpacerEpsilon
    if (Math.abs(nextHeight - latestMessageScrollSpacerHeight) < latestMessageSpacerEpsilon) return pendingDomFlush

    latestMessageScrollSpacerHeight = nextHeight
    return true
  }

  function recomputeLatestMessageGeometry(forceApply = false): boolean {
    const latestMessage = getLatestMessageElement()
    const contentEnd = scrollerContentEnd()
    if (!scrollContainer || !latestMessage || contentEnd === null) {
      latestMessageDerivedSpacerHeight = 0
      return forceApply ? applyLatestMessageSpacerHeight() : false
    }

    const latestMessageTop = latestMessage.getBoundingClientRect().top
    const currentSpacerHeight = appliedSpacerDomHeight()
    // Both rect edges translate together with scroll. Removing the spacer's
    // rendered height leaves only the row and trailing in-scroller surfaces.
    const distanceToContentEnd = Math.max(0, contentEnd - latestMessageTop - currentSpacerHeight)
    const nextDerivedHeight = Math.max(0, scrollContainer.clientHeight - distanceToContentEnd)
    if (Number.isFinite(nextDerivedHeight)) {
      if (Math.abs(nextDerivedHeight - latestMessageDerivedSpacerHeight) >= latestMessageSpacerEpsilon) {
        latestMessageDerivedSpacerHeight = nextDerivedHeight
      }
    }

    const shouldApply =
      forceApply || latestMessageAlignmentPinned || transcriptIsAtLatestPosition() || latestMessageUsesNaturalEnd()
    return shouldApply ? applyLatestMessageSpacerHeight() : false
  }

  function scheduleLatestMessageGeometryMeasure(): void {
    if (latestMessageGeometryMeasureQueued || chatsComponentDestroyed) return

    latestMessageGeometryMeasureQueued = true
    const version = latestMessageGeometryMeasureVersion
    const measure = () => {
      latestMessageGeometryMeasureQueued = false
      const sawRowResize = latestMessageGeometryMeasureSawRowResize
      latestMessageGeometryMeasureSawRowResize = false
      if (
        chatsComponentDestroyed ||
        version !== latestMessageGeometryMeasureVersion ||
        latestMessageResizeTarget !== getLatestMessageElement() ||
        scrollContainerResizeTarget !== scrollContainer
      ) {
        return
      }

      const chatRoomId = getCurrentChatRoomId()
      // A scrollport-only resize (the mobile keyboard opening or closing) must
      // not move a transcript resting at its natural end: re-asserting start
      // alignment scrolls away from the end whenever the newest row overflows
      // the scrollport. Newest-row resizes still re-align so a growing row
      // keeps its start pinned at the top.
      const shouldRealign = sawRowResize || !transcriptIsAtLatestPosition()
      if (latestMessageAlignmentPinned && !latestMessageUsesNaturalEnd() && chatRoomId && shouldRealign) {
        void alignLatestMessageToStart(chatRoomId)
      } else {
        recomputeLatestMessageGeometry()
      }
    }

    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(measure)
    else setTimeout(measure, 0)
  }

  function observeLatestMessageSize(target: HTMLElement | null): boolean {
    if (target === latestMessageResizeTarget) return false

    latestMessageResizeObserver?.disconnect()
    latestMessageResizeObserver = null
    latestMessageResizeTarget = target
    latestMessageGeometryMeasureVersion += 1
    latestMessageGeometryMeasureQueued = false
    latestMessageGeometryMeasureSawRowResize = false

    if (!target || typeof ResizeObserver === 'undefined') return true

    latestMessageResizeObserver = new ResizeObserver(() => {
      if (target !== latestMessageResizeTarget) return
      latestMessageGeometryMeasureSawRowResize = true
      scheduleLatestMessageGeometryMeasure()
    })
    latestMessageResizeObserver.observe(target)
    return true
  }

  function observeScrollContainerSize(target: HTMLElement | null): boolean {
    if (target === scrollContainerResizeTarget) return false

    scrollContainerResizeObserver?.disconnect()
    scrollContainerResizeObserver = null
    scrollContainerResizeTarget = target
    latestMessageGeometryMeasureVersion += 1
    latestMessageGeometryMeasureQueued = false
    latestMessageGeometryMeasureSawRowResize = false

    if (!target || typeof ResizeObserver === 'undefined') return true

    scrollContainerResizeObserver = new ResizeObserver(() => {
      if (target !== scrollContainerResizeTarget) return
      scheduleLatestMessageGeometryMeasure()
    })
    scrollContainerResizeObserver.observe(target)
    return true
  }

  function clearLatestMessageAlignmentAfterFrame(run: number): void {
    const clear = () => {
      if (run === latestMessageAlignmentRun) isAligningLatestMessage = false
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(clear)
    else setTimeout(clear, 0)
  }

  async function alignLatestMessageToStart(chatRoomId: string): Promise<void> {
    if (latestMessageUsesNaturalEnd()) return
    const run = ++latestMessageAlignmentRun
    isAligningLatestMessage = true
    if (run !== latestMessageAlignmentRun || getCurrentChatRoomId() !== chatRoomId || !scrollContainer) {
      if (run === latestMessageAlignmentRun) isAligningLatestMessage = false
      return
    }
    latestMessageAlignmentPinned = true

    const spacerHeightChanged = recomputeLatestMessageGeometry(true)
    if (!getLatestMessageElement()) {
      isAligningLatestMessage = false
      return
    }
    if (spacerHeightChanged) {
      await tick()
    }

    if (run !== latestMessageAlignmentRun || getCurrentChatRoomId() !== chatRoomId || !scrollContainer) {
      if (run === latestMessageAlignmentRun) isAligningLatestMessage = false
      return
    }

    const currentLatestMessage = getLatestMessageElement()
    if (currentLatestMessage) {
      scrollElementToContainerStart(currentLatestMessage, scrollContainer)
    }
    clearLatestMessageAlignmentAfterFrame(run)
  }

  export const scrollToLatestMessage = () => {
    hasNewUnreadMessage = false
    const chatRoomId = getCurrentChatRoomId()
    markChatRead(chatRoomId)
    if (chatRoomId) {
      latestMessageNaturalEndKey = null
      void alignLatestMessageToStart(chatRoomId)
    }
  }

  export const cancelLatestMessageAlignment = () => {
    pendingEntryChatRoomId = null
    latestMessageAlignmentRun += 1
    isAligningLatestMessage = false
    latestMessageAlignmentPinned = false
  }

  interface GenerationFollowState {
    projectionKey: string
    follow: boolean
    userCancelled: boolean
  }

  let generationFollowState: GenerationFollowState | null = null
  let previousRegenerateProjectionKey: string | null = null
  let pendingRegenerateWasAtLatest = true
  let transcriptUserIntentPending = false

  function regenerateProjectionKey(projection: GenerationDisplayProjection | undefined): string | null {
    return projection ? `${projection.operationId}:${projection.attemptNo}` : null
  }

  function reassertGenerationNaturalEnd(projectionKey: string): void {
    void tick().then(() => {
      if (
        generationFollowState?.projectionKey === projectionKey &&
        generationFollowState.follow &&
        regenerateProjectionKey(activeRegenerateProjection) === projectionKey &&
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
    if (isAligningLatestMessage) return
    if (generationFollowState?.follow) {
      if (transcriptIsAtLatestPosition()) {
        transcriptUserIntentPending = false
        latestMessageAlignmentPinned = false
        recomputeLatestMessageGeometry()
        return
      }
      if (transcriptUserIntentPending) {
        generationFollowState = { ...generationFollowState, follow: false, userCancelled: true }
        transcriptUserIntentPending = false
        latestMessageNaturalEndKey = null
        cancelLatestMessageAlignment()
        recomputeLatestMessageGeometry(true)
        return
      }
      reassertGenerationNaturalEnd(generationFollowState.projectionKey)
      return
    }
    if (transcriptIsAtLatestPosition()) {
      latestMessageAlignmentPinned = !latestMessageUsesNaturalEnd()
      recomputeLatestMessageGeometry()
      return
    }
    cancelLatestMessageAlignment()
  }

  let previousLength = 0
  let previousChatRoomId: string | null = null
  let previousMessageIds: (string | null)[] = []
  let wasAtBottomBeforeUpdate = true
  let pendingEntryChatRoomId: string | null = null
  let visibleChatRoomId: string | null = null
  let previousIsGenerationActive = false

  $effect.pre(() => {
    const projectionKey = regenerateProjectionKey(activeRegenerateProjection)
    if (projectionKey && projectionKey !== previousRegenerateProjectionKey) {
      pendingRegenerateWasAtLatest = transcriptIsAtLatestPosition()
    }
  })

  $effect(() => {
    chatRows
    const projection = activeRegenerateProjection
    const projectionKey = regenerateProjectionKey(projection)
    const currentChatRoomId = getCurrentChatRoomId()

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

    if (projectionKey && projectionKey !== previousRegenerateProjectionKey) {
      const database = getDatabase()
      const follow =
        database.autoScrollToNewMessage && (pendingRegenerateWasAtLatest || database.alwaysScrollToNewMessage)
      generationFollowState = { projectionKey, follow, userCancelled: false }
      transcriptUserIntentPending = false
      if (follow) {
        latestMessageNaturalEndKey = getLatestMessageAlignmentKey()
        latestMessageAlignmentRun += 1
        isAligningLatestMessage = false
        latestMessageAlignmentPinned = false
        latestMessageDerivedSpacerHeight = 0
        applyLatestMessageSpacerHeight()
        reassertGenerationNaturalEnd(projectionKey)
      }
      previousRegenerateProjectionKey = projectionKey
      return
    }

    if (projectionKey && generationFollowState?.projectionKey === projectionKey && generationFollowState.follow) {
      latestMessageNaturalEndKey = getLatestMessageAlignmentKey()
      latestMessageDerivedSpacerHeight = 0
      applyLatestMessageSpacerHeight()
      reassertGenerationNaturalEnd(projectionKey)
      return
    }

    if (!projectionKey && previousRegenerateProjectionKey) {
      const settledFollow = generationFollowState
      previousRegenerateProjectionKey = null
      generationFollowState = null
      transcriptUserIntentPending = false
      if (settledFollow?.follow && !settledFollow.userCancelled && currentChatRoomId) {
        latestMessageNaturalEndKey = null
        recomputeLatestMessageGeometry(true)
        void alignLatestMessageToStart(currentChatRoomId)
      }
    }
  })

  onDestroy(() => {
    chatsComponentDestroyed = true
    releaseDisplaySourceChat(getCurrentChatRoomId())
    initialDisplayReadiness.destroy()
    latestMessageGeometryMeasureVersion += 1
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
    const nextGeometryKey = getLatestMessageAlignmentKey()
    const latestMessageIdentityChanged = latestMessageTargetChanged || nextGeometryKey !== latestMessageGeometryKey
    latestMessageGeometryKey = nextGeometryKey
    const currentChatRoomId = getCurrentChatRoomId()
    const isSameChat = currentChatRoomId === previousChatRoomId
    if (didChatOwnerChange(previousChatRoomId, currentChatRoomId)) {
      presentationKeyAliases = {}
      clearVisibleChat(visibleChatRoomId)
      setVisibleChat(currentChatRoomId)
      visibleChatRoomId = currentChatRoomId
      latestMessageAlignmentRun += 1
      isAligningLatestMessage = false
      latestMessageAlignmentPinned = false
      latestMessageNaturalEndKey = null
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
      const currentChat = currentCharacter.chats?.[currentCharacter.chatPage]
      const appendedIds = newlyAppendedMessageIds({
        previousChatId: previousChatRoomId,
        currentChatId: currentChatRoomId,
        previousMessageIds,
        messages,
        autoTranslate: currentChat?.autoTranslate === true,
      })
      replaceAutomaticTranslationMessageIds([
        ...retainedIds,
        ...appendedIds.filter((id) => !$serverOwnedGeneratedMessageIds.has(id)),
      ])
    }

    // A chat can first render as a message-less hydration shell. Keep the
    // entry alignment pending until its newest persisted row reaches the DOM.
    if (currentChatRoomId && pendingEntryChatRoomId === currentChatRoomId && chatRows.length > 0 && scrollContainer) {
      pendingEntryChatRoomId = null
      void alignLatestMessageToStart(currentChatRoomId)
    }

    // Only auto-scroll if it's the same chat and new messages were added
    if (isSameChat && messages.length > previousLength) {
      const lastMsg = messages[messages.length - 1]
      const database = getDatabase()
      if (lastMsg && lastMsg.role === 'char') {
        const latestMessageKey = getLatestMessageAlignmentKey()
        const isAssistantPlaceholder = lastMsg.data === '' && latestMessageKey !== null
        const shouldFollowLatest =
          database.autoScrollToNewMessage && (wasAtBottomBeforeUpdate || database.alwaysScrollToNewMessage)

        if (isAssistantPlaceholder) {
          // A newly appended empty assistant row is the generation placeholder.
          // Keep it at the reverse scroller's natural end instead of manufacturing
          // enough trailing space to pull the loading indicator to the viewport top.
          latestMessageNaturalEndKey = latestMessageKey
          latestMessageAlignmentRun += 1
          isAligningLatestMessage = false
          latestMessageAlignmentPinned = false
          latestMessageDerivedSpacerHeight = 0
          applyLatestMessageSpacerHeight()
          void tick().then(() => {
            if (
              shouldFollowLatest &&
              getCurrentChatRoomId() === currentChatRoomId &&
              getLatestMessageAlignmentKey() === latestMessageKey &&
              scrollContainer
            ) {
              scrollContainer.scrollTop = 0
            }
          })
        } else if (shouldFollowLatest) {
          latestMessageNaturalEndKey = null
          setTimeout(() => {
            if (getCurrentChatRoomId() === currentChatRoomId && getLatestMessageAlignmentKey() === latestMessageKey) {
              void alignLatestMessageToStart(currentChatRoomId)
            }
          }, 700)
        } else if (database.autoScrollToNewMessage) {
          hasNewUnreadMessage = true
          markChatUnread(currentChatRoomId)
        }
      }
    }

    // DefaultChatScreen scopes this prop to its displayed chat id, so its
    // same-chat falling edge cannot be caused by a background generation.
    if (isSameChat && previousIsGenerationActive && !isGenerationActive && latestMessageUsesNaturalEnd()) {
      const completedLatestMessageKey = getLatestMessageAlignmentKey()
      const wasAtLatestPosition = transcriptIsAtLatestPosition()
      const database = getDatabase()
      latestMessageNaturalEndKey = null
      recomputeLatestMessageGeometry(true)

      const shouldFollowLatest =
        database.autoScrollToNewMessage && (wasAtLatestPosition || database.alwaysScrollToNewMessage)
      if (
        shouldFollowLatest &&
        currentChatRoomId &&
        getCurrentChatRoomId() === currentChatRoomId &&
        getLatestMessageAlignmentKey() === completedLatestMessageKey
      ) {
        void alignLatestMessageToStart(currentChatRoomId)
      } else if (database.autoScrollToNewMessage) {
        hasNewUnreadMessage = true
        markChatUnread(currentChatRoomId)
      }
    }

    if (latestMessageIdentityChanged) {
      recomputeLatestMessageGeometry(true)
    } else if (scrollContainerTargetChanged) {
      recomputeLatestMessageGeometry()
    }

    previousIsGenerationActive = isGenerationActive
    previousLength = messages.length
    previousMessageIds = messages.map((message) => message.chatId ?? null)
    previousChatRoomId = currentChatRoomId
  })
</script>

<div class="chat-screen-content-width flex flex-col-reverse" bind:this={chatBody}>
  {#if chatRows.length > 0}
    <div
      class="shrink-0"
      data-latest-message-scroll-spacer
      aria-hidden="true"
      style={`height: ${latestMessageScrollSpacerHeight}px`}>
    </div>
  {/if}
  {#each chatRows as row (row.key)}
    <div
      class="chat-message-container"
      data-risu-dyna-icons={row.key === dynaIconRowKey ? 'true' : undefined}
      data-generation-display-projection={row.generationDisplayProjection ? 'regenerate' : undefined}>
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
          row.generationDisplayProjection !== undefined ||
          (isGenerationActive &&
            row.idx === messages.length - 1 &&
            row.message.role === 'char' &&
            row.message.data === '')}
        isGenerationProjection={row.generationDisplayProjection !== undefined}
        isChatGenerating={isGenerationActive}
        halfStreamingTokensPerSecond={row.idx === messages.length - 1 && row.message.role === 'char'
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
        {generationStage}
        disabled={row.message.disabled ?? false} />
    </div>
  {/each}
</div>
