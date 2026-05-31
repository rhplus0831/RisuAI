<script lang="ts">
  import type { character, Message } from 'src/ts/storage/database.svelte'
  import Chat from './Chat.svelte'
  import { getCharImage } from 'src/ts/characters'
  import {
    createSimpleCharacter,
    DBState,
    selectedCharID,
    ReloadChatPointer,
  } from 'src/ts/stores.svelte'
  import { chatFoldedStateMessageIndex } from 'src/ts/globalApi.svelte'
  import { get } from 'svelte/store'

  const getCurrentChatRoomId = () => {
    const charId = get(selectedCharID)
    if (charId < 0) return null
    const char = DBState.db.characters[charId]
    if (!char) return null
    return char.chats?.[char.chatPage]?.id ?? null
  }

  let {
    messages,
    currentCharacter,
    onReroll,
    unReroll,
    currentUsername,
    userIcon,
    loadPages,
    userIconPortrait,
    hasNewUnreadMessage = $bindable(false),
  }: {
    messages: Message[]
    currentCharacter: character
    onReroll: () => void
    unReroll: () => void
    currentUsername: string
    userIcon: string
    loadPages: number
    userIconPortrait?: boolean
    hasNewUnreadMessage?: boolean
  } = $props()

  let chatBody: HTMLDivElement

  const chatRows = $derived.by(() => {
    const charImage = getCharImage(currentCharacter.image, 'css')
    const userImage = getCharImage(userIcon, 'css')
    const simpleChar = createSimpleCharacter(currentCharacter)
    let loadStart = messages.length - 1
    let loadEnd = messages.length - loadPages

    if (chatFoldedStateMessageIndex.index !== -1) {
      loadStart = chatFoldedStateMessageIndex.index
      loadEnd = Math.max(0, chatFoldedStateMessageIndex.index - loadPages)
    }

    const reloadPointerMap = get(ReloadChatPointer)
    const rows: {
      key: string
      message: Message
      idx: number
      img: string | Promise<string>
      largePortrait: boolean
      name: string
      character: ReturnType<typeof createSimpleCharacter>
    }[] = []

    for (let i = loadStart; i >= loadEnd; i--) {
      if (i < 0) break // Prevent out of bounds
      const message = messages[i]
      const messageLargePortrait =
        message.role === 'user'
          ? (userIconPortrait ?? false)
          : ((currentCharacter as character).largePortrait ?? false)
      const reloadPointer = reloadPointerMap[i] ?? 0
      rows.push({
        key: `${message.chatId ?? `message-${i}`}:${i}:${reloadPointer}`,
        message,
        idx: i,
        img: message.role === 'user' ? userImage : charImage,
        largePortrait: messageLargePortrait,
        name: message.role === 'user' ? currentUsername : currentCharacter.name,
        character: simpleChar,
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
      element.scrollIntoView({ behavior: 'instant', block: 'start' })
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

    // Only auto-scroll if it's the same chat and new messages were added
    if (isSameChat && messages.length > previousLength) {
      const lastMsg = messages[messages.length - 1]
      if (lastMsg && lastMsg.role === 'char' && DBState.db.autoScrollToNewMessage) {
        if (wasAtBottomBeforeUpdate || DBState.db.alwaysScrollToNewMessage) {
          const element = chatBody.firstElementChild
          if (element) {
            setTimeout(() => {
              element.scrollIntoView({ behavior: 'instant', block: 'start' })
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
        isLastMemory={false}
        idx={row.idx}
        totalLength={messages.length}
        img={row.img}
        {onReroll}
        {unReroll}
        rerollIcon="dynamic"
        character={row.character}
        largePortrait={row.largePortrait}
        messageGenerationInfo={row.message.generationInfo}
        role={row.message.role}
        name={row.name}
        isComment={row.message.isComment ?? false}
        disabled={row.message.disabled ?? false}
      />
    </div>
  {/each}
</div>
