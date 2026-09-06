<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { language } from 'src/lang'
  import type { Chat, character as Character } from 'src/ts/storage/database.svelte'
  import { isServerChatMessagePlaceholder } from 'src/ts/storage/database.svelte'
  import { getChatToken } from 'src/ts/tokenizer'
  import { getChatVisibleTokens } from 'src/ts/chatVisibleTokens'
  import { fetchLoreTokenCounts } from 'src/ts/server/loreTokenCounts'
  import type { LoreTokenCounts } from '@risuai/protocol/lore-token-counts'
  import {
    getChatMessageOwnerState,
    hydrateChatMessages,
    isChatMessageTranscriptHydrated,
  } from 'src/ts/server/chatMessageHydration.svelte'
  import { collectionsResourceState, settingsResourceState } from 'src/ts/server/resourceState.svelte'
  import { ensureResourceSurfaces } from 'src/ts/server/routeResourceLoader'
  import { moduleRenderRevision } from 'src/ts/moduleRenderRevision'
  import { ReloadGUIPointer, VariableReloadGUIPointer } from 'src/ts/stores.svelte'
  import {
    RegexDisplayReloadPointer,
    RegexDisplayReloadScope,
    regexDisplayReloadTokenForContext,
  } from 'src/ts/process/regexDisplayReload'

  let { character, chat }: { character?: Character; chat?: Chat } = $props()
  let prepared = $state(false)
  let preparationFailed = $state(false)
  let refresh = $state(0)
  let lore = $state<LoreTokenCounts | null>(null)
  let current = $state<number | null>(null)
  let visible = $state<number | null>(null)
  let loreFailed = $state(false)
  let currentFailed = $state(false)
  let visibleFailed = $state(false)

  async function prepare() {
    preparationFailed = false
    try {
      await ensureResourceSurfaces(['runtime:chat-display', 'runtime:chat-generation'])
      prepared = true
    } catch {
      preparationFailed = true
    }
  }
  onMount(() => {
    void prepare()
  })

  const dependencies = $derived.by(() => {
    const transcript = chat?.id ? getChatMessageOwnerState(chat.id) : undefined
    // This diagnostic exists only while Tokens is open. Track message contents
    // as well as projection identity so local edits invalidate an in-flight count.
    return JSON.stringify({
      characterId: character?.chaId,
      chatId: chat?.id,
      epoch: transcript?.projectionEpoch,
      messages: transcript?.messages.map(({ chatId, data, role, translation }) => [chatId, data, role, translation]),
      variables: chat?.scriptstate,
      localLore: chat?.localLore,
      translation: [chat?.autoTranslate, chat?.bilingualDisplay, chat?.bilingualEmphasis],
      generation: chat?.generationSettings,
      modules: chat?.modules,
      character: character ? { ...character, chats: undefined } : null,
      settings: settingsResourceState.value,
      promptPresets: collectionsResourceState.values.promptPresets,
      personas: collectionsResourceState.values.personas,
      moduleRevision: $moduleRenderRevision,
      reload: [$ReloadGUIPointer, $VariableReloadGUIPointer],
      regex: regexDisplayReloadTokenForContext($RegexDisplayReloadPointer, $RegexDisplayReloadScope, {
        characterId: character?.chaId,
        chatId: chat?.id,
      }),
    })
  })

  $effect(() => {
    void dependencies
    void refresh
    if (!prepared) return
    const selectedCharacter = character
    const selectedChat = chat
    const controller = new AbortController()
    const { signal } = controller
    lore = null
    current = null
    visible = null
    loreFailed = currentFailed = visibleFailed = false
    if (!selectedCharacter || !selectedChat?.id) {
      current = visible = 0
      return
    }
    const chatId = selectedChat.id
    untrack(() => {
      void fetchLoreTokenCounts(selectedCharacter.chaId, chatId, signal)
        .then((result) => {
          if (!signal.aborted) lore = result
        })
        .catch(() => {
          if (!signal.aborted) loreFailed = true
        })

      void (async () => {
        try {
          if (!isChatMessageTranscriptHydrated(chatId)) await hydrateChatMessages(chatId, { strict: true, signal })
          signal.throwIfAborted()
          const transcript = getChatMessageOwnerState(chatId)
          if (!transcript || transcript.messages.some(isServerChatMessagePlaceholder))
            throw new Error('Incomplete transcript')
          const snapshot: Chat = { ...selectedChat, message: transcript.messages.map((message) => ({ ...message })) }
          const count = await getChatToken(snapshot)
          if (signal.aborted) return
          current = count
          try {
            const count = await getChatVisibleTokens(selectedCharacter, snapshot, signal)
            if (!signal.aborted) visible = count
          } catch {
            if (!signal.aborted) visibleFailed = true
          }
        } catch {
          if (!signal.aborted) currentFailed = visibleFailed = true
        }
      })()
    })
    return () => controller.abort()
  })

  const failed = $derived(preparationFailed || loreFailed || currentFailed || visibleFailed)
  const rows = $derived([
    { label: language.tokenCounts.characterActive, value: !chat ? 0 : lore?.character, failed: loreFailed },
    { label: language.tokenCounts.moduleActive, value: !chat ? 0 : lore?.module, failed: loreFailed },
    { label: language.tokenCounts.chatLoreActive, value: !chat ? 0 : lore?.chat, failed: loreFailed },
    { label: language.tokenCounts.currentChat, value: current, failed: currentFailed },
    { label: language.tokenCounts.visibleChat, value: visible, failed: visibleFailed },
  ])
</script>

{#each rows as row}
  <span>{row.label}</span>
  <div class="p-2 text-center">
    {#if preparationFailed || row.failed}{language.tokenCounts.unavailable}
    {:else if row.value == null}{language.loading}...
    {:else}{row.value} {language.tokens}{/if}
  </div>
{/each}
{#if lore?.hasRandomActivation}
  <p class="col-span-2 text-sm text-textcolor2" data-testid="token-random-warning">
    {language.tokenCounts.randomWarning}
  </p>
{/if}
{#if failed}
  <p class="col-span-2 text-sm text-textcolor2" role="alert">{language.tokenCounts.failed}</p>
{/if}
<button
  class="col-span-2 rounded-md border border-darkborderc p-2"
  onclick={() => {
    if (preparationFailed) void prepare()
    else refresh += 1
  }}>{failed ? language.retry : language.tokenCounts.recalculate}</button>
