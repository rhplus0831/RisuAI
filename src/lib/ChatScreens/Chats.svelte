<script lang="ts">
  import { untrack } from 'svelte'
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
  import { queuedGenerationPersistences } from 'src/ts/process/generationPersistenceState'
  import { halfStreamingProgress } from 'src/ts/process/halfStreamingProgress'
  import {
    automaticTranslationMessageIds,
    consumeAutomaticTranslationEligibility,
    replaceAutomaticTranslationMessageIds,
    serverOwnedGeneratedMessageIds,
  } from 'src/ts/process/generatedMessageTranslationEligibility'
  import { newlyAppendedMessageIds } from './newMessageTranslationEligibility'
  import type { ActiveChatTarget } from 'src/ts/chatCommands'

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
    isGenerationActive?: boolean
    generationStage?: number
    hasNewUnreadMessage?: boolean
  } = $props()

  let chatBody: HTMLDivElement
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
      isGenerationPersistenceQueued: boolean
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
        isGenerationPersistenceQueued:
          !!currentChatId &&
          $queuedGenerationPersistences.some(
            (entry) =>
              entry.chatId === currentChatId &&
              (entry.messageId === message.chatId || entry.generationId === message.generationInfo?.generationId),
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

  function checkIfAtBottom() {
    if (!chatBody || !chatBody.parentElement) return true
    const sc = chatBody.parentElement
    const lastEl = chatBody.firstElementChild
    if (!lastEl) return true
    const rect = lastEl.getBoundingClientRect()
    const scRect = sc.getBoundingClientRect()
    return rect.top <= scRect.bottom + 100
  }

  export const scrollToLatestMessage = () => {
    if (!chatBody) return
    hasNewUnreadMessage = false
    const element = chatBody.firstElementChild
    if (element) {
      scrollElementToContainerStart(element, chatBody.parentElement)
    }
  }

  let previousLength = 0
  let previousChatRoomId: string | null = null
  let previousMessageIds: (string | null)[] = []
  let wasAtBottomBeforeUpdate = true

  $effect.pre(() => {
    chatRows
    wasAtBottomBeforeUpdate = checkIfAtBottom()
  })

  $effect(() => {
    chatRows
    const currentChatRoomId = getCurrentChatRoomId()
    const isSameChat = currentChatRoomId === previousChatRoomId
    if (didChatOwnerChange(previousChatRoomId, currentChatRoomId)) {
      hasNewUnreadMessage = false
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

    // Only auto-scroll if it's the same chat and new messages were added
    if (isSameChat && messages.length > previousLength) {
      const lastMsg = messages[messages.length - 1]
      const database = getDatabase()
      if (lastMsg && lastMsg.role === 'char' && database.autoScrollToNewMessage) {
        if (wasAtBottomBeforeUpdate || database.alwaysScrollToNewMessage) {
          const element = chatBody.firstElementChild
          if (element) {
            setTimeout(() => {
              scrollElementToContainerStart(element, chatBody.parentElement)
            }, 700)
          }
        } else {
          hasNewUnreadMessage = true
        }
      }
    }
    previousLength = messages.length
    previousMessageIds = messages.map((message) => message.chatId ?? null)
    previousChatRoomId = currentChatRoomId
  })
</script>

<div class="chat-screen-content-width flex flex-col-reverse" bind:this={chatBody}>
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
        isGenerationPersistenceQueued={row.isGenerationPersistenceQueued}
        {generationStage}
        disabled={row.message.disabled ?? false} />
    </div>
  {/each}
</div>
