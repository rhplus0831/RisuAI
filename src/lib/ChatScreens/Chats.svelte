<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte'
  import { getDatabase, type character, type Message } from 'src/ts/storage/database.svelte'
  import Chat from './Chat.svelte'
  import { getCharImage } from 'src/ts/characters'
  import { createSimpleCharacter, selectedCharID, ReloadChatPointer } from 'src/ts/stores.svelte'
  import { RegexDisplayReloadPointer } from 'src/ts/process/regexDisplayReload'
  import { chatFoldedStateMessageIndex } from 'src/ts/globalApi.svelte'
  import { get } from 'svelte/store'
  import { getTranscriptWindowRange } from './DefaultChatScreen.loadPages'
  import { getCharacterDisplayName } from 'src/ts/characterDisplayName'
  import { didChatOwnerChange } from './ChatsUnread'
  import { scrollElementToContainerStart } from './chatScroll'
  import { isMemoryLimitMessage } from './memoryLimitMarker'
  import {
    generationFinalizationPersistences,
    generationPersistenceStateForMessage,
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
    generationStage = 0,
    hasNewUnreadMessage = $bindable(false),
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
    generationStage?: number
    hasNewUnreadMessage?: boolean
  } = $props()

  let chatBody: HTMLDivElement
  let latestMessageScrollSpacerHeight = $state(0)
  let latestMessageResizeObserver: ResizeObserver | null = null
  let latestMessageResizeTarget: HTMLElement | null = null
  let latestMessageResizeTargetHeight: number | null = null
  let latestMessageResizeMeasureQueued = false
  let latestMessageResizeMeasureVersion = 0
  let latestMessageAlignmentPinned = false
  let chatsComponentDestroyed = false
  let activeHalfStreamingTokensPerSecond = $derived.by(() => {
    const currentChatId = getCurrentChatRoomId()
    const progress = $halfStreamingProgress.find(
      (entry) => entry.characterId === currentCharacter.chaId && entry.chatId === currentChatId,
    )
    return progress?.tokensPerSecond
  })

  const chatRows = $derived.by(() => {
    void $RegexDisplayReloadPointer
    const charImage = getCharImage(currentCharacter.image, 'css')
    const userImage = getCharImage(userIcon, 'css')
    const simpleChar = createSimpleCharacter(
      currentCharacter,
      untrack(() => currentCharacter.customscript),
    )
    const database = getDatabase()
    const currentChat = currentCharacter.chats?.[currentCharacter.chatPage]
    const currentChatId = currentChat?.id
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
    }[] = []

    for (let i = loadStart; i >= loadEnd; i--) {
      if (i < 0) break // Prevent out of bounds
      const message = messages[i]
      const messageLargePortrait =
        message.role === 'user' ? (userIconPortrait ?? false) : ((currentCharacter as character).largePortrait ?? false)
      const reloadPointer = reloadPointerMap[i] ?? 0
      rows.push({
        key: `${message.chatId ?? `message-${i}`}:${i}:${reloadPointer}`,
        message,
        idx: i,
        img: message.role === 'user' ? userImage : charImage,
        largePortrait: messageLargePortrait,
        name: message.role === 'user' ? currentUsername : getCharacterDisplayName(currentCharacter),
        character: simpleChar,
        generationPersistenceState: generationPersistenceStateForMessage(
          $generationFinalizationPersistences,
          currentChatId,
          message,
        ),
        isLastMemory: isMemoryLimitMessage(database.showMemoryLimit, lastMemoryId, message.chatId),
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

  function transcriptIsAtLatestPosition(): boolean {
    return !!scrollContainer && Math.max(0, -scrollContainer.scrollTop) <= 1
  }

  function scheduleLatestMessageResizeMeasure(): void {
    if (latestMessageResizeMeasureQueued || chatsComponentDestroyed) return
    if (!latestMessageAlignmentPinned && !transcriptIsAtLatestPosition()) return

    latestMessageResizeMeasureQueued = true
    const version = latestMessageResizeMeasureVersion
    const measure = () => {
      latestMessageResizeMeasureQueued = false
      if (
        chatsComponentDestroyed ||
        version !== latestMessageResizeMeasureVersion ||
        latestMessageResizeTarget !== getLatestMessageElement() ||
        (!latestMessageAlignmentPinned && !transcriptIsAtLatestPosition())
      ) {
        return
      }

      const chatRoomId = getCurrentChatRoomId()
      if (chatRoomId) void alignLatestMessageToStart(chatRoomId, false)
    }

    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(measure)
    else setTimeout(measure, 0)
  }

  function observeLatestMessageSize(target: HTMLElement | null): void {
    if (target === latestMessageResizeTarget) return

    latestMessageResizeObserver?.disconnect()
    latestMessageResizeObserver = null
    latestMessageResizeTarget = target
    latestMessageResizeTargetHeight = target?.getBoundingClientRect().height ?? null
    latestMessageResizeMeasureVersion += 1
    latestMessageResizeMeasureQueued = false

    if (!target || typeof ResizeObserver === 'undefined') return

    // Streaming text and late parser/media layout can outlive the initial
    // alignment revalidation. Follow only the newest row, and stop as soon as
    // the user scrolls away from the latest position.
    latestMessageResizeObserver = new ResizeObserver(() => {
      if (target !== latestMessageResizeTarget) return
      const nextHeight = target.getBoundingClientRect().height
      if (!Number.isFinite(nextHeight) || nextHeight === latestMessageResizeTargetHeight) return

      latestMessageResizeTargetHeight = nextHeight
      scheduleLatestMessageResizeMeasure()
    })
    latestMessageResizeObserver.observe(target)
  }

  async function alignLatestMessageToStart(chatRoomId: string, revalidateAfterLayout = true): Promise<void> {
    const run = ++latestMessageAlignmentRun
    isAligningLatestMessage = true
    if (run !== latestMessageAlignmentRun || getCurrentChatRoomId() !== chatRoomId || !scrollContainer) {
      if (run === latestMessageAlignmentRun) isAligningLatestMessage = false
      return
    }
    latestMessageAlignmentPinned = true

    // Measure from the reverse scroller's bottom position. When the newest row
    // is shorter than the available viewport, this spacer consumes only the
    // otherwise unreachable distance needed to place the row at the top. The
    // composer and other trailing surfaces remain visible when they already fit.
    scrollContainer.scrollTop = 0
    const latestMessage = getLatestMessageElement()
    if (!latestMessage) {
      isAligningLatestMessage = false
      return
    }

    const messageTop = latestMessage.getBoundingClientRect().top
    const scrollportTop = scrollContainer.getBoundingClientRect().top + scrollContainer.clientTop
    const messageOffset = messageTop - scrollportTop
    const requiredScrollSpace = Math.max(0, latestMessageScrollSpacerHeight + messageOffset)
    if (Number.isFinite(requiredScrollSpace) && requiredScrollSpace !== latestMessageScrollSpacerHeight) {
      latestMessageScrollSpacerHeight = requiredScrollSpace
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

    if (!revalidateAfterLayout) {
      isAligningLatestMessage = false
      return
    }

    // Composer textareas and parsed message content can finish measuring after
    // the first render. Let the initial programmatic scroll event settle, then
    // remeasure once without overriding any scroll the user performs meanwhile.
    await new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
      else setTimeout(resolve, 0)
    })
    if (run !== latestMessageAlignmentRun || getCurrentChatRoomId() !== chatRoomId) return

    isAligningLatestMessage = false
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
    if (run !== latestMessageAlignmentRun || getCurrentChatRoomId() !== chatRoomId) return

    await alignLatestMessageToStart(chatRoomId, false)
  }

  export const scrollToLatestMessage = () => {
    hasNewUnreadMessage = false
    const chatRoomId = getCurrentChatRoomId()
    markChatRead(chatRoomId)
    if (chatRoomId) void alignLatestMessageToStart(chatRoomId)
  }

  export const cancelLatestMessageAlignment = () => {
    pendingEntryChatRoomId = null
    latestMessageAlignmentRun += 1
    isAligningLatestMessage = false
    latestMessageAlignmentPinned = false
  }

  export const handleTranscriptScroll = () => {
    if (isAligningLatestMessage) return
    if (transcriptIsAtLatestPosition()) {
      latestMessageAlignmentPinned = true
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

  onDestroy(() => {
    chatsComponentDestroyed = true
    latestMessageResizeMeasureVersion += 1
    latestMessageResizeObserver?.disconnect()
    clearVisibleChat(visibleChatRoomId)
  })

  $effect.pre(() => {
    chatRows
    wasAtBottomBeforeUpdate = checkIfAtBottom()
  })

  $effect(() => {
    chatRows
    observeLatestMessageSize(getLatestMessageElement())
    const currentChatRoomId = getCurrentChatRoomId()
    const isSameChat = currentChatRoomId === previousChatRoomId
    if (didChatOwnerChange(previousChatRoomId, currentChatRoomId)) {
      clearVisibleChat(visibleChatRoomId)
      setVisibleChat(currentChatRoomId)
      visibleChatRoomId = currentChatRoomId
      latestMessageAlignmentRun += 1
      isAligningLatestMessage = false
      latestMessageAlignmentPinned = false
      pendingEntryChatRoomId = currentChatRoomId
      hasNewUnreadMessage = false
      markChatRead(currentChatRoomId)
      replaceAutomaticTranslationMessageIds([])
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
      if (lastMsg && lastMsg.role === 'char' && database.autoScrollToNewMessage) {
        if (wasAtBottomBeforeUpdate || database.alwaysScrollToNewMessage) {
          setTimeout(() => {
            if (getCurrentChatRoomId() === currentChatRoomId) {
              void alignLatestMessageToStart(currentChatRoomId)
            }
          }, 700)
        } else {
          hasNewUnreadMessage = true
          markChatUnread(currentChatRoomId)
        }
      }
    }
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
    <div class="chat-message-container" data-risu-dyna-icons={row.key === dynaIconRowKey ? 'true' : undefined}>
      <Chat
        message={row.message.data}
        translation={row.message.translation ?? null}
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
        isGenerationLoading={isGenerationActive &&
          row.idx === messages.length - 1 &&
          row.message.role === 'char' &&
          row.message.data === ''}
        isChatGenerating={isGenerationActive}
        halfStreamingTokensPerSecond={row.idx === messages.length - 1 && row.message.role === 'char'
          ? activeHalfStreamingTokensPerSecond
          : undefined}
        autoTranslateOnReady={typeof row.message.chatId === 'string' &&
          $automaticTranslationMessageIds.includes(row.message.chatId) &&
          !$serverOwnedGeneratedMessageIds.has(row.message.chatId)}
        onAutoTranslationEligibilityConsumed={() => consumeAutomaticTranslationEligibility(row.message.chatId ?? '')}
        generationPersistenceState={row.generationPersistenceState}
        {generationStage}
        disabled={row.message.disabled ?? false} />
    </div>
  {/each}
</div>
