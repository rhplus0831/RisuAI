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
    translateMessage: (message: string) => Promise<string>
    clear: () => void
    commit: (messages: string[]) => void
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
    translateMessage,
    clear,
    commit,
  }: SuggestionTranslationRun) {
    const snapshot = messages ? [...messages] : []

    const isCurrentRun = () =>
      runId === getCurrentRunId() && requestId === getCurrentRequestId() && toggle && translationEnabled()

    if (!toggle || !translationEnabled() || snapshot.length === 0) {
      if (runId === getCurrentRunId()) {
        clear()
      }
      return
    }

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
  import { type character, type Message } from '../../ts/storage/database.svelte'
  import { DBState } from 'src/ts/stores.svelte'
  import { selectedCharID } from '../../ts/stores.svelte'
  import { translate } from 'src/ts/translator/translator'
  import { CopyIcon, LanguagesIcon, RefreshCcwIcon } from '@lucide/svelte'
  import { alertConfirm } from 'src/ts/alert'
  import { language } from 'src/lang'
  import { getUserName, replacePlaceholders } from '../../ts/util'
  import { onDestroy } from 'svelte'
  import { ParseMarkdown } from 'src/ts/parser/parser.svelte'
  import { defaultAutoSuggestPrompt } from '../../ts/storage/defaultPrompts.js'
  import { dispatchUpdateChatRow, type ChatRowMetadataSnapshot } from 'src/ts/chatCommands'
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

  let { send, messageInput }: Props = $props()
  let suggestMessages: string[] | undefined = $state(
    DBState.db.characters[$selectedCharID]?.chats[DBState.db.characters[$selectedCharID].chatPage]?.suggestMessages,
  )
  let suggestMessagesTranslated: string[] = $state()
  let toggleTranslate: boolean = $state(DBState.db.autoTranslate)
  let progress: boolean = $state()
  let abortController: AbortController
  let chatPage: number | undefined = $state()
  let progressChatId: string | undefined
  let suggestionRequestId = 0
  let suggestionTranslationId = 0
  let suggestionTarget: SuggestionTargetSnapshot | undefined = $state()

  function copySuggestionMessages(messages: readonly string[] | undefined): string[] {
    return [...(messages ?? [])]
  }

  function activeSuggestionTarget(messages: readonly string[] | undefined): SuggestionTargetSnapshot | undefined {
    const selectedChar = $selectedCharID
    const currentChar = DBState.db.characters?.[selectedChar]
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
    suggestMessages = messages ? copySuggestionMessages(messages) : messages
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
    if (!target) return false
    if ($selectedCharID !== target.selectedCharID) return false
    const currentChar = DBState.db.characters?.[target.selectedCharID]
    const currentChat = currentChar?.chats?.[currentChar.chatPage]
    return (
      currentChar?.chaId === target.characterId &&
      currentChat?.id === target.chatId &&
      suggestionMessagesMatch(suggestMessages, target.suggestMessages)
    )
  }

  const updateSuggestions = () => {
    if ($selectedCharID > -1 && !$doingChat) {
      const currentChar = DBState.db.characters[$selectedCharID]
      const currentChat = currentChar?.chats[currentChar.chatPage]
      if (progress && progressChatId && progressChatId !== currentChat?.id) {
        progress = false
        abortController?.abort()
      }
      setVisibleSuggestions(currentChat?.suggestMessages)
    }
  }

  function persistSuggestions(target: SuggestionTargetSnapshot, suggestions: string[]) {
    if (!target.chatId) return
    const rollback: ChatRowMetadataSnapshot = {
      selectedCharID: target.selectedCharID,
      characterId: target.characterId,
      chatId: target.chatId,
      metadata: {
        suggestMessages: copySuggestionMessages(target.suggestMessages),
      },
    }
    dispatchUpdateChatRow(target.chatId, { suggestMessages: copySuggestionMessages(suggestions) }, rollback)
  }

  function clearFreshSuggestions(target: SuggestionTargetSnapshot | undefined) {
    if (!target || !isFreshSuggestionTarget(target)) return false
    setVisibleSuggestions([], target)
    persistSuggestions(target, [])
    return true
  }

  function sendFreshSuggestion(suggest: string, index: number) {
    const target = captureSuggestionTarget()
    if (target?.suggestMessages[index] !== suggest) return
    if (!clearFreshSuggestions(target)) return
    messageInput(suggest)
    send()
  }

  function copyFreshSuggestion(suggest: string, index: number) {
    const target = captureSuggestionTarget()
    if (target?.suggestMessages[index] !== suggest || !isFreshSuggestionTarget(target)) return
    messageInput(suggest)
  }

  function rerollFreshSuggestions() {
    const target = captureSuggestionTarget()
    alertConfirm(language.askReRollAutoSuggestions).then((result) => {
      if (result && clearFreshSuggestions(target)) {
        doingChat.set(true)
        doingChat.set(false)
      }
    })
  }

  const unsub = doingChat.subscribe(async (v) => {
    if (v) {
      progress = false
      abortController?.abort()
      setVisibleSuggestions([])
    }
    if (!v && $selectedCharID > -1 && (!suggestMessages || suggestMessages.length === 0) && !progress) {
      const requestSelectedCharId = $selectedCharID
      let currentChar: character = DBState.db.characters[$selectedCharID]
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
        DBState.db.autoSuggestPrompt && DBState.db.autoSuggestPrompt.length > 0
          ? DBState.db.autoSuggestPrompt
          : defaultAutoSuggestPrompt
      const autoSuggestionModel = resolveModelForRole(DBState.db, 'otherAx')
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
            content: replacePlaceholders(DBState.db.autoSuggestPrompt, currentChar.name),
          },
          ...lastMessages.map(({ role, data }) => ({
            role: role === 'user' ? ('user' as const) : ('assistant' as const),
            content: data,
          })),
        ]
      }

      progress = true
      progressChatId = requestChatId
      abortController = new AbortController()
      const requestId = ++suggestionRequestId
      requestChatData(
        {
          formated: promptbody,
          bias: {},
          currentChar: currentChar as character,
        },
        'otherAx',
        abortController.signal,
      ).then((rq2) => {
        const liveChar = DBState.db.characters[$selectedCharID]
        const liveChat = liveChar?.chats[liveChar.chatPage]
        const staleResponse =
          requestId !== suggestionRequestId ||
          requestSelectedCharId !== $selectedCharID ||
          requestCharacterId !== liveChar?.chaId ||
          requestChatId !== liveChat?.id ||
          !isFreshSuggestionTarget(requestSuggestionTarget)
        if (rq2.type !== 'fail' && rq2.type !== 'streaming' && rq2.type !== 'multiline' && progress && !staleResponse) {
          var suggestMessagesNew = rq2.result
            .split('\n')
            .filter((msg) => msg.startsWith('-'))
            .map((msg) => msg.replace('-', '').trim())
          setVisibleSuggestions(suggestMessagesNew, {
            ...requestSuggestionTarget,
            suggestMessages: suggestMessagesNew,
          })
          persistSuggestions(requestSuggestionTarget, suggestMessagesNew)
        }
        if (requestId === suggestionRequestId) {
          progress = false
          progressChatId = undefined
        }
      })
    }
  })

  const translateSuggest = async (toggle: boolean, messages: string[] | undefined) => {
    const runId = ++suggestionTranslationId
    const requestId = suggestionRequestId

    await runSuggestionTranslation({
      runId,
      requestId,
      toggle,
      messages,
      translationEnabled: () => DBState.db.translator !== '',
      getCurrentRunId: () => suggestionTranslationId,
      getCurrentRequestId: () => suggestionRequestId,
      getCurrentMessages: () => suggestMessages,
      translateMessage: (message) => translate(message, false),
      clear: () => {
        suggestMessagesTranslated = []
      },
      commit: (messages) => {
        suggestMessagesTranslated = messages
      },
    })
  }

  onDestroy(unsub)

  $effect.pre(() => {
    $selectedCharID
    // Reads chatPage so suggestions update when the selected chat changes.
    chatPage = DBState.db.characters[$selectedCharID]?.chatPage
    updateSuggestions()
  })
  $effect.pre(() => {
    translateSuggest(toggleTranslate, suggestMessages)
  })
</script>

<div class="ml-4 flex flex-wrap">
  {#if progress}
    <div class="flex bg-textcolor2 p-2 rounded-lg items-center">
      <div class="loadmove mx-2"></div>
      <div>{language.creatingSuggestions}</div>
    </div>
  {:else if !$doingChat}
    {#if DBState.db.translator !== ''}
      <div class="flex mr-2 mb-2">
        <button
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
        class="bg-textcolor2 hover:bg-darkbutton font-bold py-2 px-4 rounded-sm text-textcolor"
        onclick={rerollFreshSuggestions}>
        <RefreshCcwIcon />
      </button>
    </div>
    {#each suggestMessages ?? [] as suggest, i}
      <div class="flex mr-2 mb-2">
        <button
          class="bg-textcolor2 hover:bg-darkbutton text-textcolor font-bold py-2 px-4 rounded-sm"
          onclick={() => {
            sendFreshSuggestion(suggest, i)
          }}>
          {#await ParseMarkdown(DBState.db.translator !== '' && toggleTranslate && suggestMessagesTranslated && suggestMessagesTranslated.length > 0 ? (suggestMessagesTranslated[i] ?? suggest) : suggest) then md}
            {@html md}
          {/await}
        </button>
        <button
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
