<script lang="ts">
  import { getDatabase, type character, type Message } from 'src/ts/storage/database.svelte'
  import Chat from './Chat.svelte'
  import { getCharImage } from 'src/ts/characters'
  import { createSimpleCharacter, selectedCharID, ReloadChatPointer } from 'src/ts/stores.svelte'
  import { chatFoldedStateMessageIndex } from 'src/ts/globalApi.svelte'
  import { get } from 'svelte/store'
  import { getTranscriptWindowRange } from './DefaultChatScreen.loadPages'
  import { getCharacterDisplayName } from 'src/ts/characterDisplayName'
  import { chatProcessStage } from 'src/ts/process/index.svelte'
  import { didChatOwnerChange } from './ChatsUnread'
  import { scrollElementToContainerStart } from './chatScroll'
  import { isMemoryLimitMessage } from './memoryLimitMarker'

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
    currentUsername,
    userIcon,
    loadPages,
    userIconPortrait,
    isGenerationActive = false,
    hasNewUnreadMessage = $bindable(false),
  }: {
    messages: Message[]
    currentCharacter: character
    onReroll: () => void
    unReroll: () => void
    onNewReroll: () => void
    onSelectRerollCandidate: (index: number) => void
    currentUsername: string
    userIcon: string
    loadPages: number
    userIconPortrait?: boolean
    isGenerationActive?: boolean
    hasNewUnreadMessage?: boolean
  } = $props()

  let chatBody: HTMLDivElement

  const chatRows = $derived.by(() => {
    const charImage = getCharImage(currentCharacter.image, 'css')
    const userImage = getCharImage(userIcon, 'css')
    const simpleChar = createSimpleCharacter(currentCharacter)
    const database = getDatabase()
    const lastMemoryId = currentCharacter.chats?.[currentCharacter.chatPage]?.lastMemory
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
        isLastMemory: isMemoryLimitMessage(database.showMemoryLimit, lastMemoryId, message.chatId),
      })
    }

    return rows
  })

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
    previousChatRoomId = currentChatRoomId
  })
</script>

<div class="flex flex-col-reverse" bind:this={chatBody}>
  {#each chatRows as row (row.key)}
    <div class="chat-message-container">
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
        generationStage={$chatProcessStage}
        disabled={row.message.disabled ?? false} />
    </div>
  {/each}
</div>
