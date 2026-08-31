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

  function claimSuggestionRequestOwnership(key: string): SharedSuggestionRequestOwnership | undefined {
    if (suggestionRequestOwners.has(key)) return undefined
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
  import type { OpenAIChat } from '../../ts/process/index.svelte'
  import type { Chat, Database, character, Message } from '../../ts/storage/database.svelte'
  import { translate } from 'src/ts/translator/translator'
  import { CopyIcon, LanguagesIcon, RefreshCcwIcon } from '@lucide/svelte'
  import { alertConfirm } from 'src/ts/alert'
  import { language } from 'src/lang'
  import { getUserName, replacePlaceholders } from '../../ts/utilState'
  import { onDestroy, untrack } from 'svelte'
  import { ParseMarkdown } from 'src/ts/parser/parser.svelte'
  import { defaultAutoSuggestPrompt } from '../../ts/storage/defaultPrompts.js'
  import { dispatchUpdateChatRow, type ActiveChatTarget, type ChatRowMetadataSnapshot } from 'src/ts/chatCommands'
  import { resolveModelForRole } from '@risuai/shared-core/model-roles'
  import {
    consumeChatSuggestionCompletion,
    findPendingChatSuggestionCompletion,
    pendingChatSuggestionCompletions,
  } from 'src/ts/process/chatSuggestionCompletion.svelte'
  import { activeChatGenerations, chatGenerationTargetKey } from 'src/ts/process/generationActivity.svelte'
  import {
    applyChatMetadataOwnerPatch,
    charactersResourceState,
    collectionsResourceState,
    getCharacterResourceOwner,
    getChatMetadataOwnerSnapshot,
    getChatMetadataOwnerState,
    restoreChatMetadataOwnerSnapshot,
    settingsResourceState,
  } from 'src/ts/server/resourceState.svelte'
  import { selectCharacterOwner } from 'src/ts/characterState'
  import { safeStructuredClone } from 'src/ts/safeStructuredClone'

  interface Props {
    send: () => any
    messageInput: (string: string) => any
    isGenerationActive?: boolean
  }

  interface SuggestionTargetSnapshot {
    selectedCharID: number
    chatPage: number
    characterId: string | undefined
    chatId: string | undefined
    suggestMessages: string[]
  }

  interface SuggestionRequestOwnership extends SharedSuggestionRequestOwnership {
    requestId: number
    controller: AbortController
  }

  const suggestionRequestSettingsGroups = ['providers', 'models', 'runtime', 'prompt'] as const

  let { send, messageInput, isGenerationActive }: Props = $props()
  function chatMetadataFor(chat: Chat | undefined) {
    if (!chat?.id) return undefined
    return charactersResourceState.status === 'ready' ? getChatMetadataOwnerState(chat.id) : undefined
  }

  function suggestionMessagesFor(characterId: string | undefined, chat: Chat | undefined): string[] | undefined {
    const messages =
      charactersResourceState.status === 'ready' && characterId && chat?.id
        ? getChatMetadataOwnerSnapshot(characterId, chat.id)?.metadata.suggestMessages
        : undefined
    return Array.isArray(messages) && messages.every((message) => typeof message === 'string') ? messages : undefined
  }

  function selectedCharacterIndex(): number {
    return charactersResourceState.status === 'ready' ? charactersResourceState.currentChar : -1
  }

  function suggestionCharacterOwners(): readonly character[] | undefined {
    return charactersResourceState.status === 'ready' ? charactersResourceState.characters : undefined
  }

  function selectedSuggestionCharacter(): character | undefined {
    const owners = suggestionCharacterOwners()
    return owners ? selectCharacterOwner(owners, selectedCharacterIndex()) : undefined
  }

  function uniqueChatOwner(
    characterOwner: character | undefined,
    chatId: string | undefined,
    characterOwners = suggestionCharacterOwners(),
  ): Chat | undefined {
    if (!characterOwner || !chatId) return undefined
    if (!characterOwners) return undefined
    const ownerCount = characterOwners.reduce(
      (count, character) => count + (character.chats ?? []).filter((candidate) => candidate.id === chatId).length,
      0,
    )
    if (ownerCount !== 1) return undefined
    const matches = (characterOwner.chats ?? []).filter((candidate) => candidate.id === chatId)
    return matches.length === 1 ? matches[0] : undefined
  }

  function selectedSuggestionChat():
    | { character: character; chat: Chat; chatPage: number; selectedCharID: number }
    | undefined {
    const character = selectedSuggestionCharacter()
    const chatPage = character?.chatPage
    const candidate = character?.chats?.[chatPage]
    if (!character || chatPage === undefined || !candidate) return undefined
    if (candidate.id) {
      const chat = uniqueChatOwner(character, candidate.id)
      if (!chat) return undefined
      return { character, chat, chatPage, selectedCharID: selectedCharacterIndex() }
    }
    return undefined
  }

  function resolveSuggestionTarget(target: SuggestionTargetSnapshot): { character: character; chat: Chat } | undefined {
    const characterOwners = suggestionCharacterOwners()
    if (!characterOwners) return undefined
    const character = target.characterId ? getCharacterResourceOwner(target.characterId) : undefined
    if (!character) return undefined
    const chat = target.chatId
      ? uniqueChatOwner(character, target.chatId, characterOwners)
      : character.chats?.[target.chatPage]
    if (!chat || !target.chatId) return undefined
    return { character, chat }
  }

  function translatorEnabled(): boolean {
    if (settingsResourceState.status === 'error') return false
    if ((settingsResourceState.groupStatuses.language ?? 'idle') !== 'ready') return false
    return typeof settingsResourceState.value.translator === 'string' && settingsResourceState.value.translator !== ''
  }

  function suggestionRequestDatabase(): Database | undefined {
    if (
      settingsResourceState.status === 'error' ||
      collectionsResourceState.status === 'error' ||
      charactersResourceState.status !== 'ready'
    ) {
      return undefined
    }
    if (
      suggestionRequestSettingsGroups.some(
        (group) => (settingsResourceState.groupStatuses[group] ?? 'idle') !== 'ready',
      )
    ) {
      return undefined
    }

    const readyCollections = Object.fromEntries(
      Object.entries(collectionsResourceState.values).filter(
        ([name]) =>
          collectionsResourceState.statuses[name as keyof typeof collectionsResourceState.statuses] === 'ready',
      ),
    )
    return safeStructuredClone({
      ...settingsResourceState.value,
      ...readyCollections,
      characters: charactersResourceState.characters,
      characterOrder: charactersResourceState.characterOrder,
      currentChar: charactersResourceState.currentChar,
    }) as Database
  }

  let fallbackGenerationTargetKey = $derived.by(() => {
    const selected = selectedSuggestionChat()
    if (!selected) return null
    return chatGenerationTargetKey({
      selectedCharID: selected.selectedCharID,
      chatPage: selected.chatPage,
      characterId: selected.character.chaId,
      chatId: selected.chat.id,
    })
  })
  let effectiveGenerationActive = $derived(
    isGenerationActive ??
      (fallbackGenerationTargetKey !== null &&
        $activeChatGenerations.some((activity) => activity.targetKey === fallbackGenerationTargetKey)),
  )
  const initialSelection = selectedSuggestionChat()
  const initialChat = initialSelection?.chat
  const initialChatMetadata = chatMetadataFor(initialChat)
  let suggestMessages: string[] | undefined = $state(
    suggestionMessagesFor(initialSelection?.character.chaId, initialChat),
  )
  let suggestMessagesTranslated: string[] = $state()
  let toggleTranslate: boolean = $state(initialChatMetadata?.autoTranslate === true)
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
  let observedMetadataOwner: string | undefined

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
    const selected = selectedSuggestionChat()
    if (!selected || selected.selectedCharID < 0) return undefined
    return {
      selectedCharID: selected.selectedCharID,
      chatPage: selected.chatPage,
      characterId: selected.character.chaId,
      chatId: selected.chat.id,
      suggestMessages: copySuggestionMessages(messages),
    }
  }

  function activeCompletionTarget(): ActiveChatTarget | undefined {
    const selected = selectedSuggestionChat()
    if (!selected || selected.selectedCharID < 0) return undefined
    return {
      selectedCharID: selected.selectedCharID,
      chatPage: selected.chatPage,
      characterId: selected.character.chaId,
      chatId: selected.chat.id,
    }
  }

  function cloneSuggestionTarget(target: SuggestionTargetSnapshot): SuggestionTargetSnapshot {
    return {
      ...target,
      chatPage: target.chatPage,
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
          chatPage: target.chatPage,
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
    const selected = selectedSuggestionChat()
    if (!selected || selected.selectedCharID !== target.selectedCharID) return false
    return (
      selected.character.chaId === target.characterId &&
      selected.chat.id === target.chatId &&
      suggestionMessagesMatch(suggestMessages, target.suggestMessages)
    )
  }

  const updateSuggestions = () => {
    if (destroyed) return
    if (selectedCharacterIndex() > -1 && !effectiveGenerationActive) {
      const selected = selectedSuggestionChat()
      const currentChat = selected?.chat
      if (progress && progressChatId && progressChatId !== currentChat?.id) {
        abandonActiveSuggestionRequest()
      }
      setVisibleSuggestions(suggestionMessagesFor(selected?.character.chaId, currentChat))
    }
  }

  function persistSuggestions(
    target: SuggestionTargetSnapshot,
    suggestions: string[],
    ownership?: SuggestionRequestOwnership,
  ): boolean {
    if (destroyed || (ownership && !isSuggestionRequestOwnerCurrent(ownership))) return false
    if (charactersResourceState.status !== 'ready' || !target.characterId || !target.chatId) return false
    if (!resolveSuggestionTarget(target)) return false
    const metadataOwner = getChatMetadataOwnerSnapshot(target.characterId, target.chatId)
    if (
      !metadataOwner ||
      !suggestionMessagesMatch(
        metadataOwner.metadata.suggestMessages as readonly string[] | undefined,
        target.suggestMessages,
      )
    ) {
      return false
    }
    const applied = applyChatMetadataOwnerPatch(target.characterId, target.chatId, {
      suggestMessages: copySuggestionMessages(suggestions),
    })
    if (!applied || destroyed || (ownership && !isSuggestionRequestOwnerCurrent(ownership))) return false

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
      rollbackSuggestionMetadata,
    )
    return true
  }

  function rollbackSuggestionMetadata(snapshot: ChatRowMetadataSnapshot): void {
    if (charactersResourceState.status !== 'ready' || !snapshot.characterId) return
    restoreChatMetadataOwnerSnapshot({
      characterId: snapshot.characterId,
      chatId: snapshot.chatId,
      metadata: snapshot.metadata,
      attempted: snapshot.attempted,
    })
  }

  function clearFreshSuggestions(target: SuggestionTargetSnapshot | undefined) {
    if (destroyed) return false
    if (!target || !isFreshSuggestionTarget(target)) return false
    if (!persistSuggestions(target, [])) return false
    setVisibleSuggestions([], target)
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
      if (!result || effectiveGenerationActive) return
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
    if (destroyed || effectiveGenerationActive) return
    if (selectedCharacterIndex() > -1 && (!suggestMessages || suggestMessages.length === 0) && !progress) {
      const selected = selectedSuggestionChat()
      if (!selected) return
      const requestSelectedCharId = selected.selectedCharID
      const database = suggestionRequestDatabase()
      if (!database) return
      const currentChar = selected.character
      const requestCharacterId = currentChar?.chaId
      const requestChatPage = selected.chatPage
      const requestChat = selected.chat
      const requestChatId = requestChat?.id
      if (!currentChar || !requestChat) return
      const requestSuggestionTarget: SuggestionTargetSnapshot = {
        selectedCharID: requestSelectedCharId,
        chatPage: requestChatPage,
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

      const sharedOwnership = claimSuggestionRequestOwnership(suggestionRequestOwnershipKey(requestSuggestionTarget))
      if (!sharedOwnership) return

      const controller = new AbortController()
      progress = true
      progressChatId = requestChatId
      abortController = controller
      const requestId = ++suggestionRequestId
      const ownership: SuggestionRequestOwnership = {
        ...sharedOwnership,
        requestId,
        controller,
      }
      activeSuggestionRequest = ownership
      requestChatData(
        {
          database,
          formated: promptbody,
          bias: {},
          currentChar: currentChar as character,
        },
        'otherAx',
        controller.signal,
      )
        .then((rq2) => {
          if (!isSuggestionRequestOwnerCurrent(ownership)) return
          const liveSelection = selectedSuggestionChat()
          const liveChar = liveSelection?.character
          const liveChat = liveSelection?.chat
          const staleResponse =
            !isSuggestionRequestOwnerCurrent(ownership) ||
            requestSelectedCharId !== liveSelection?.selectedCharID ||
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
            if (persistSuggestions(requestSuggestionTarget, suggestMessagesNew, ownership)) {
              setVisibleSuggestions(suggestMessagesNew, {
                ...requestSuggestionTarget,
                suggestMessages: suggestMessagesNew,
              })
            }
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

  let observedGenerationActive: boolean | undefined
  $effect(() => {
    const active = effectiveGenerationActive
    if (active === observedGenerationActive) return
    observedGenerationActive = active
    untrack(() => handleDoingChatChange(active))
  })

  $effect(() => {
    const completion = findPendingChatSuggestionCompletion($pendingChatSuggestionCompletions, activeCompletionTarget())
    if (!completion || effectiveGenerationActive) return

    const resolved = resolveSuggestionTarget({
      selectedCharID: completion.target.selectedCharID,
      chatPage: completion.target.chatPage,
      characterId: completion.target.characterId,
      chatId: completion.target.chatId,
      suggestMessages: [],
    })
    const chat = resolved?.chat
    if (!chat) return
    if ((suggestionMessagesFor(resolved?.character.chaId, chat)?.length ?? 0) > 0) {
      untrack(() => {
        consumeChatSuggestionCompletion(completion.id)
      })
      return
    }
    if ((chat.message?.length ?? 0) === 0) return

    untrack(() => {
      if (consumeChatSuggestionCompletion(completion.id)) requestSuggestions()
    })
  })

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
      translationEnabled: translatorEnabled,
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
  })

  $effect.pre(() => {
    // Reads chatPage so suggestions update when the selected chat changes.
    charactersResourceState.currentChar
    charactersResourceState.status
    const selected = selectedSuggestionChat()
    const currentCharacter = selected?.character
    chatPage = selected?.chatPage
    const currentChat = selected?.chat
    const currentChatMetadata = chatMetadataFor(currentChat)
    const metadataOwner = currentChatMetadata
      ? `${currentCharacter?.chaId ?? charactersResourceState.currentChar}:${currentChatMetadata.chatId}`
      : undefined
    if (metadataOwner !== observedMetadataOwner) {
      observedMetadataOwner = metadataOwner
      toggleTranslate = currentChatMetadata?.autoTranslate === true
    }
    const residentMessageCount = currentChat?.message?.length ?? 0
    const persistedSuggestionCount = suggestionMessagesFor(currentCharacter?.chaId, currentChat)?.length ?? 0
    const transcriptOwner = currentChat
      ? JSON.stringify([currentCharacter?.chaId ?? charactersResourceState.currentChar, currentChat.id ?? chatPage])
      : undefined
    const hydrationCompleted =
      transcriptOwner !== undefined &&
      transcriptOwner === observedTranscriptOwner &&
      observedResidentMessageCount === 0 &&
      residentMessageCount > 0
    observedTranscriptOwner = transcriptOwner
    observedResidentMessageCount = residentMessageCount
    updateSuggestions()
    if (hydrationCompleted && !effectiveGenerationActive && persistedSuggestionCount === 0) {
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
  {:else if !effectiveGenerationActive}
    {#if translatorEnabled()}
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
          {#await ParseMarkdown(translatorEnabled() && toggleTranslate && suggestMessagesTranslated && suggestMessagesTranslated.length > 0 ? (suggestMessagesTranslated[i] ?? suggest) : suggest) then md}
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
