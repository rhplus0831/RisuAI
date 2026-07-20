<script module lang="ts">
  export interface SuggestionTranslationRun {
    runId: number
    requestId: number
    toggle: boolean
    messages: readonly string[] | undefined
    translationEnabled: () => boolean
    getCurrentRunId: () => number
    getCurrentRequestId: () => number
    getCurrentMessages: () => readonly string[] | undefined
    isOwnerCurrent: () => boolean
    translateMessage: (message: string) => Promise<string>
    clear: () => void
    commit: (messages: string[]) => void
  }

  interface SharedSuggestionRequestOwnership {
    key: string
    token: number
  }

  let nextSuggestionRequestOwnershipToken = 0
  const suggestionRequestOwners = new Map<string, number>()

  function claimSuggestionRequestOwnership(key: string): SharedSuggestionRequestOwnership {
    const ownership = { key, token: ++nextSuggestionRequestOwnershipToken }
    suggestionRequestOwners.set(key, ownership.token)
    return ownership
  }

  function isSharedSuggestionRequestOwnerCurrent(ownership: SharedSuggestionRequestOwnership): boolean {
    return suggestionRequestOwners.get(ownership.key) === ownership.token
  }

  function releaseSuggestionRequestOwnership(ownership: SharedSuggestionRequestOwnership): void {
    if (isSharedSuggestionRequestOwnerCurrent(ownership)) {
      suggestionRequestOwners.delete(ownership.key)
    }
  }

  function isSameSuggestionSource(currentMessages: readonly string[] | undefined, snapshot: readonly string[]) {
    return (
      currentMessages !== undefined &&
      currentMessages.length === snapshot.length &&
      snapshot.every((message, index) => currentMessages[index] === message)
    )
  }

  export async function runSuggestionTranslation({
    runId,
    requestId,
    toggle,
    messages,
    translationEnabled,
    getCurrentRunId,
    getCurrentRequestId,
    getCurrentMessages,
    isOwnerCurrent,
    translateMessage,
    clear,
    commit,
  }: SuggestionTranslationRun) {
    const snapshot = messages ? [...messages] : []

    const isCurrentOwner = () => isOwnerCurrent() && runId === getCurrentRunId() && requestId === getCurrentRequestId()
    const isCurrentRun = () => isCurrentOwner() && toggle && translationEnabled()

    if (!toggle || !translationEnabled() || snapshot.length === 0) {
      if (isCurrentOwner()) {
        clear()
      }
      return
    }

    if (!isCurrentOwner()) return
    clear()

    const translatedMessages: string[] = []

    for (let i = 0; i < snapshot.length; i++) {
      translatedMessages[i] = await translateMessage(snapshot[i])
      if (!isCurrentRun()) {
        return
      }
    }

    if (isCurrentRun() && isSameSuggestionSource(getCurrentMessages(), snapshot)) {
      commit(translatedMessages)
    }
  }
</script>

<script lang="ts">
  import { requestChatData } from 'src/ts/process/request/request'
  import { doingChat, type OpenAIChat } from '../../ts/process/index.svelte'
  import { getDatabase, type character, type Message } from '../../ts/storage/database.svelte'
  import { selectedCharID } from '../../ts/stores.svelte'
  import { translate } from 'src/ts/translator/translator'
  import { CopyIcon, LanguagesIcon, RefreshCcwIcon } from '@lucide/svelte'
  import { alertConfirm } from 'src/ts/alert'
  import { language } from 'src/lang'
  import { getUserName, replacePlaceholders } from '../../ts/util'
  import { onDestroy, untrack } from 'svelte'
  import { get } from 'svelte/store'
  import { ParseMarkdown } from 'src/ts/parser/parser.svelte'
  import { defaultAutoSuggestPrompt } from '../../ts/storage/defaultPrompts.js'
  import { dispatchUpdateChatRow, type ChatRowMetadataSnapshot } from 'src/ts/chatCommands'
  import {
    rollbackServerBackedChatRowMetadata,
    syncServerBackedChatMetadataBaselines,
  } from 'src/ts/server/chatBridge.svelte'
  import { withTrustedResourceWrite } from 'src/ts/server/resourceWriteGuard.svelte'
  import { resolveModelForRole } from 'src/ts/model/modelRoles'

  interface Props {
    send: () => any
    messageInput: (string: string) => any
  }

  interface SuggestionTargetSnapshot {
    selectedCharID: number
    characterId: string | undefined
    chatId: string | undefined
    suggestMessages: string[]
  }

  interface SuggestionRequestOwnership extends SharedSuggestionRequestOwnership {
    requestId: number
    controller: AbortController
  }

  let { send, messageInput }: Props = $props()
  const initialCharacter = getDatabase().characters[$selectedCharID]
  let suggestMessages: string[] | undefined = $state(
    initialCharacter?.chats[initialCharacter.chatPage]?.suggestMessages,
  )
  let suggestMessagesTranslated: string[] = $state()
  let toggleTranslate: boolean = $state(getDatabase().autoTranslate)
  let progress: boolean = $state()
  let abortController: AbortController | undefined
  let chatPage: number | undefined = $state()
  let progressChatId: string | undefined
  let suggestionRequestId = 0
  let suggestionTranslationId = 0
  let suggestionTarget: SuggestionTargetSnapshot | undefined = $state()
  let activeSuggestionRequest: SuggestionRequestOwnership | undefined
  let destroyed = false
  let observedTranscriptOwner: string | undefined
  let observedResidentMessageCount = 0

  function copySuggestionMessages(messages: readonly string[] | undefined): string[] {
    return [...(messages ?? [])]
  }

  function suggestionRequestOwnershipKey(target: SuggestionTargetSnapshot): string {
    return JSON.stringify([target.characterId ?? target.selectedCharID, target.chatId ?? null])
  }

  function isSuggestionRequestOwnerCurrent(ownership: SuggestionRequestOwnership): boolean {
    return (
      !destroyed &&
      activeSuggestionRequest === ownership &&
      ownership.requestId === suggestionRequestId &&
      !ownership.controller.signal.aborted &&
      isSharedSuggestionRequestOwnerCurrent(ownership)
    )
  }

  function abandonActiveSuggestionRequest(): void {
    suggestionRequestId += 1
    const ownership = activeSuggestionRequest
    activeSuggestionRequest = undefined
    if (ownership) {
      ownership.controller.abort()
      releaseSuggestionRequestOwnership(ownership)
    } else {
      abortController?.abort()
    }
    abortController = undefined
    if (!destroyed) {
      progress = false
      progressChatId = undefined
    }
  }

  function activeSuggestionTarget(messages: readonly string[] | undefined): SuggestionTargetSnapshot | undefined {
    const selectedChar = $selectedCharID
    const currentChar = getDatabase().characters?.[selectedChar]
    const currentChat = currentChar?.chats?.[currentChar.chatPage]
    if (selectedChar < 0 || !currentChar || !currentChat) return undefined
    return {
      selectedCharID: selectedChar,
      characterId: currentChar.chaId,
      chatId: currentChat.id,
      suggestMessages: copySuggestionMessages(messages),
    }
  }

  function cloneSuggestionTarget(target: SuggestionTargetSnapshot): SuggestionTargetSnapshot {
    return {
      ...target,
      suggestMessages: copySuggestionMessages(target.suggestMessages),
    }
  }

  function setVisibleSuggestions(
    messages: readonly string[] | undefined,
    target: SuggestionTargetSnapshot | undefined = activeSuggestionTarget(messages),
  ) {
    if (destroyed) return
    suggestMessages = messages === undefined ? undefined : copySuggestionMessages(messages)
    suggestionTarget = target
      ? {
          selectedCharID: target.selectedCharID,
          characterId: target.characterId,
          chatId: target.chatId,
          suggestMessages: copySuggestionMessages(messages),
        }
      : undefined
  }

  function captureSuggestionTarget(): SuggestionTargetSnapshot | undefined {
    return suggestionTarget ? cloneSuggestionTarget(suggestionTarget) : undefined
  }

  function suggestionMessagesMatch(currentMessages: readonly string[] | undefined, snapshot: readonly string[]) {
    const current = currentMessages ?? []
    return current.length === snapshot.length && snapshot.every((message, index) => current[index] === message)
  }

  function isFreshSuggestionTarget(target: SuggestionTargetSnapshot | undefined) {
    if (destroyed) return false
    if (!target) return false
    if ($selectedCharID !== target.selectedCharID) return false
    const currentChar = getDatabase().characters?.[target.selectedCharID]
    const currentChat = currentChar?.chats?.[currentChar.chatPage]
    return (
      currentChar?.chaId === target.characterId &&
      currentChat?.id === target.chatId &&
      suggestionMessagesMatch(suggestMessages, target.suggestMessages)
    )
  }

  const updateSuggestions = () => {
    if (destroyed) return
    if ($selectedCharID > -1 && !$doingChat) {
      const currentChar = getDatabase().characters[$selectedCharID]
      const currentChat = currentChar?.chats[currentChar.chatPage]
      if (progress && progressChatId && progressChatId !== currentChat?.id) {
        abandonActiveSuggestionRequest()
      }
      setVisibleSuggestions(currentChat?.suggestMessages)
    }
  }

  function persistSuggestions(
    target: SuggestionTargetSnapshot,
    suggestions: string[],
    ownership?: SuggestionRequestOwnership,
  ) {
    if (destroyed || (ownership && !isSuggestionRequestOwnerCurrent(ownership))) return
    if (!target.chatId) return
    let applied = false
    withTrustedResourceWrite(() => {
      if (destroyed || (ownership && !isSuggestionRequestOwnerCurrent(ownership))) return
      const character = target.characterId
        ? getDatabase().characters?.find((candidate) => candidate.chaId === target.characterId)
        : getDatabase().characters?.[target.selectedCharID]
      const chat = character?.chats?.find((candidate) => candidate.id === target.chatId)
      if (!chat || !suggestionMessagesMatch(chat.suggestMessages, target.suggestMessages)) return
      chat.suggestMessages = copySuggestionMessages(suggestions)
      applied = true
    })
    if (!applied || destroyed || (ownership && !isSuggestionRequestOwnerCurrent(ownership))) return
    syncServerBackedChatMetadataBaselines()

    if (destroyed || (ownership && !isSuggestionRequestOwnerCurrent(ownership))) return

    const rollback: ChatRowMetadataSnapshot = {
      selectedCharID: target.selectedCharID,
      characterId: target.characterId,
      chatId: target.chatId,
      metadata: {
        suggestMessages: copySuggestionMessages(target.suggestMessages),
      },
    }
    dispatchUpdateChatRow(
      target.chatId,
      { suggestMessages: copySuggestionMessages(suggestions) },
      rollback,
      {},
      rollbackServerBackedChatRowMetadata,
    )
  }

  function clearFreshSuggestions(target: SuggestionTargetSnapshot | undefined) {
    if (destroyed) return false
    if (!target || !isFreshSuggestionTarget(target)) return false
    setVisibleSuggestions([], target)
    persistSuggestions(target, [])
    return true
  }

  function sendFreshSuggestion(suggest: string, index: number) {
    if (destroyed) return
    const target = captureSuggestionTarget()
    if (target?.suggestMessages[index] !== suggest) return
    if (!clearFreshSuggestions(target)) return
    messageInput(suggest)
    send()
  }

  function copyFreshSuggestion(suggest: string, index: number) {
    if (destroyed) return
    const target = captureSuggestionTarget()
    if (target?.suggestMessages[index] !== suggest || !isFreshSuggestionTarget(target)) return
    messageInput(suggest)
  }

  function rerollFreshSuggestions() {
    if (destroyed) return
    const target = captureSuggestionTarget()
    alertConfirm(language.askReRollAutoSuggestions).then((result) => {
      if (destroyed) return
      if (!result || get(doingChat)) return
      if (clearFreshSuggestions(target)) requestSuggestions()
    })
  }

  function handleDoingChatChange(v: boolean): void {
    if (destroyed) return
    if (v) {
      abandonActiveSuggestionRequest()
      const target = captureSuggestionTarget() ?? activeSuggestionTarget(suggestMessages)
      if (!target || target.suggestMessages.length === 0 || !clearFreshSuggestions(target)) {
        setVisibleSuggestions([])
      }
    }
    if (!v) requestSuggestions()
  }

  function requestSuggestions(): void {
    if (destroyed || get(doingChat)) return
    if ($selectedCharID > -1 && (!suggestMessages || suggestMessages.length === 0) && !progress) {
      const requestSelectedCharId = $selectedCharID
      const database = getDatabase()
      let currentChar: character = database.characters[$selectedCharID]
      const requestCharacterId = currentChar?.chaId
      const requestChatPage = currentChar?.chatPage
      const requestChat = currentChar?.chats[requestChatPage]
      const requestChatId = requestChat?.id
      if (!currentChar || !requestChat) return
      const requestSuggestionTarget: SuggestionTargetSnapshot = {
        selectedCharID: requestSelectedCharId,
        characterId: requestCharacterId,
        chatId: requestChatId,
        suggestMessages: copySuggestionMessages(suggestMessages),
      }
      let messages: Message[] = []

      messages = [...messages, ...requestChat.message]
      let lastMessages: Message[] = messages.slice(Math.max(messages.length - 10, 0))
      if (lastMessages.length === 0) return
      const prompt =
        database.autoSuggestPrompt && database.autoSuggestPrompt.length > 0
          ? database.autoSuggestPrompt
          : defaultAutoSuggestPrompt
      const autoSuggestionModel = resolveModelForRole(database, 'otherAx')
      let promptbody: OpenAIChat[] = [
        {
          role: 'system',
          content: replacePlaceholders(prompt, currentChar.name),
        },
        {
          role: 'user',
          content: lastMessages
            .map((b) => (b.role === 'char' ? currentChar.name : getUserName()) + ':' + b.data)
            .reduce((a, b) => a + ',' + b),
        },
      ]

      if (
        autoSuggestionModel === 'textgen_webui' ||
        autoSuggestionModel === 'mancer' ||
        autoSuggestionModel.startsWith('local_')
      ) {
        promptbody = [
          {
            role: 'system',
            content: replacePlaceholders(prompt, currentChar.name),
          },
          ...lastMessages.map(({ role, data }) => ({
            role: role === 'user' ? ('user' as const) : ('assistant' as const),
            content: data,
          })),
        ]
      }

      progress = true
      progressChatId = requestChatId
      const controller = new AbortController()
      abortController = controller
      const requestId = ++suggestionRequestId
      const sharedOwnership = claimSuggestionRequestOwnership(suggestionRequestOwnershipKey(requestSuggestionTarget))
      const ownership: SuggestionRequestOwnership = {
        ...sharedOwnership,
        requestId,
        controller,
      }
      activeSuggestionRequest = ownership
      requestChatData(
        {
          formated: promptbody,
          bias: {},
          currentChar: currentChar as character,
        },
        'otherAx',
        controller.signal,
      )
        .then((rq2) => {
          if (!isSuggestionRequestOwnerCurrent(ownership)) return
          const liveChar = getDatabase().characters[$selectedCharID]
          const liveChat = liveChar?.chats[liveChar.chatPage]
          const staleResponse =
            !isSuggestionRequestOwnerCurrent(ownership) ||
            requestSelectedCharId !== $selectedCharID ||
            requestCharacterId !== liveChar?.chaId ||
            requestChatId !== liveChat?.id ||
            !isFreshSuggestionTarget(requestSuggestionTarget)
          if (
            rq2.type !== 'fail' &&
            rq2.type !== 'streaming' &&
            rq2.type !== 'multiline' &&
            progress &&
            !staleResponse
          ) {
            const suggestMessagesNew = rq2.result
              .split('\n')
              .filter((msg) => msg.startsWith('-'))
              .map((msg) => msg.replace('-', '').trim())
            if (!isSuggestionRequestOwnerCurrent(ownership)) return
            setVisibleSuggestions(suggestMessagesNew, {
              ...requestSuggestionTarget,
              suggestMessages: suggestMessagesNew,
            })
            persistSuggestions(requestSuggestionTarget, suggestMessagesNew, ownership)
          }
        })
        .catch((error) => {
          if (!isSuggestionRequestOwnerCurrent(ownership)) return
          console.error('Failed to generate suggestions:', error)
        })
        .finally(() => {
          if (isSuggestionRequestOwnerCurrent(ownership)) {
            activeSuggestionRequest = undefined
            abortController = undefined
            progress = false
            progressChatId = undefined
          }
          releaseSuggestionRequestOwnership(ownership)
        })
    }
  }

  const unsub = doingChat.subscribe(handleDoingChatChange)

  const translateSuggest = async (toggle: boolean, messages: string[] | undefined) => {
    if (destroyed) return
    const runId = ++suggestionTranslationId
    const requestId = suggestionRequestId
    const isCurrentOwner = () => !destroyed && runId === suggestionTranslationId && requestId === suggestionRequestId

    await runSuggestionTranslation({
      runId,
      requestId,
      toggle,
      messages,
      translationEnabled: () => getDatabase().translator !== '',
      getCurrentRunId: () => suggestionTranslationId,
      getCurrentRequestId: () => suggestionRequestId,
      getCurrentMessages: () => suggestMessages,
      isOwnerCurrent: () => !destroyed,
      translateMessage: (message) => translate(message, false),
      clear: () => {
        if (!isCurrentOwner()) return
        suggestMessagesTranslated = []
      },
      commit: (messages) => {
        if (!isCurrentOwner()) return
        suggestMessagesTranslated = messages
      },
    })
  }

  onDestroy(() => {
    destroyed = true
    suggestionTranslationId += 1
    abandonActiveSuggestionRequest()
    unsub()
  })

  $effect.pre(() => {
    $selectedCharID
    // Reads chatPage so suggestions update when the selected chat changes.
    const currentCharacter = getDatabase().characters[$selectedCharID]
    chatPage = currentCharacter?.chatPage
    const currentChat = currentCharacter?.chats[chatPage]
    const residentMessageCount = currentChat?.message?.length ?? 0
    const persistedSuggestionCount = currentChat?.suggestMessages?.length ?? 0
    const transcriptOwner = currentChat
      ? JSON.stringify([currentCharacter?.chaId ?? $selectedCharID, currentChat.id ?? chatPage])
      : undefined
    const hydrationCompleted =
      transcriptOwner !== undefined &&
      transcriptOwner === observedTranscriptOwner &&
      observedResidentMessageCount === 0 &&
      residentMessageCount > 0
    observedTranscriptOwner = transcriptOwner
    observedResidentMessageCount = residentMessageCount
    updateSuggestions()
    if (hydrationCompleted && !$doingChat && persistedSuggestionCount === 0) {
      untrack(() => {
        void handleDoingChatChange(false)
      })
    }
  })
  $effect.pre(() => {
    translateSuggest(toggleTranslate, suggestMessages)
  })
</script>

<div class="chat-screen-content-width ml-4 flex flex-wrap">
  {#if progress}
    <div class="flex bg-textcolor2 p-2 rounded-lg items-center">
      <div class="loadmove mx-2"></div>
      <div>{language.creatingSuggestions}</div>
    </div>
  {:else if !$doingChat}
    {#if getDatabase().translator !== ''}
      <div class="flex mr-2 mb-2">
        <button
          aria-label={language.translate}
          aria-pressed={toggleTranslate}
          class={'bg-textcolor2 hover:bg-darkbutton font-bold py-2 px-4 rounded-sm ' +
            (toggleTranslate ? 'text-green-500' : 'text-textcolor')}
          onclick={() => {
            toggleTranslate = !toggleTranslate
          }}>
          <LanguagesIcon />
        </button>
      </div>
    {/if}

    <div class="flex mr-2 mb-2">
      <button
        aria-label={language.reroll}
        class="bg-textcolor2 hover:bg-darkbutton font-bold py-2 px-4 rounded-sm text-textcolor"
        onclick={rerollFreshSuggestions}>
        <RefreshCcwIcon />
      </button>
    </div>
    {#each suggestMessages ?? [] as suggest, i}
      <div class="flex mr-2 mb-2">
        <button
          aria-label={suggest}
          class="bg-textcolor2 hover:bg-darkbutton text-textcolor font-bold py-2 px-4 rounded-sm"
          onclick={() => {
            sendFreshSuggestion(suggest, i)
          }}>
          {#await ParseMarkdown(getDatabase().translator !== '' && toggleTranslate && suggestMessagesTranslated && suggestMessagesTranslated.length > 0 ? (suggestMessagesTranslated[i] ?? suggest) : suggest) then md}
            {@html md}
          {/await}
        </button>
        <button
          aria-label={`${language.copy}: ${suggest}`}
          class="bg-textcolor2 hover:bg-darkbutton text-textcolor font-bold py-2 px-4 rounded-sm ml-1"
          onclick={() => {
            copyFreshSuggestion(suggest, i)
          }}>
          <CopyIcon />
        </button>
      </div>
    {/each}
  {/if}
</div>

<style>
  .loadmove {
    animation: spin 1s linear infinite;
    border-radius: 50%;
    border: 0.4rem solid rgba(0, 0, 0, 0);
    width: 1rem;
    height: 1rem;
    border-top: 0.4rem solid var(--risu-theme-textcolor);
    border-left: 0.4rem solid var(--risu-theme-textcolor);
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
