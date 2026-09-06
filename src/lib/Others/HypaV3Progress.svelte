<script lang="ts" module>
  import type { character } from 'src/ts/storage/database.svelte'

  export function resolveOpenChatId(characterOwner: character | undefined): string | null {
    return characterOwner?.chats?.[characterOwner.chatPage]?.id ?? null
  }

  export function resolveUniqueOpenChatId(
    characterOwner: character | undefined,
    characters: readonly character[],
  ): string | null {
    const chatId = resolveOpenChatId(characterOwner)
    if (!chatId || !characterOwner?.chaId) return null
    if (characters.filter((candidate) => candidate?.chaId === characterOwner.chaId).length !== 1) return null
    const chatMatches = characters.reduce(
      (count, character) => count + (character.chats ?? []).filter((chat) => chat?.id === chatId).length,
      0,
    )
    return chatMatches === 1 ? chatId : null
  }

  export function resolveUniqueChatLabel(
    characters: readonly character[],
    chatId: string,
    unnamedChatLabel: string,
    unknownChatLabel: string,
  ): string {
    const matches = characters.flatMap((character) =>
      (character.chats ?? []).filter((chat) => chat.id === chatId).map((chat) => ({ character, chat })),
    )
    if (matches.length !== 1) return unknownChatLabel
    const { character, chat } = matches[0]
    if (!character.chaId || characters.filter((candidate) => candidate.chaId === character.chaId).length !== 1) {
      return unknownChatLabel
    }
    const characterName = character.displayName || character.name
    return `${characterName} — ${chat.name || unnamedChatLabel}`
  }
</script>

<script lang="ts">
  import { language } from 'src/lang'
  import {
    charactersResourceState,
    getChatMetadataOwnerState,
    settingsResourceState,
  } from 'src/ts/server/resourceState.svelte'
  import { getSelectedCharacterOwner } from 'src/ts/characterState'
  import { memoryJobProjectionStore, selectMemoryProgress } from 'src/ts/server/memoryJobProjection.svelte'
  import { groupMemoryJobsForPresentation, type MemoryProgressGroup } from 'src/ts/server/memoryJobPresentation'
  import type { ServerMemoryJob } from 'src/ts/process/request/serverMemory'

  let isExpanded = $state(false)
  function characterRowsOwner(): readonly character[] {
    return charactersResourceState.status === 'ready' ? charactersResourceState.characters : []
  }

  function selectedCharacterOwner(): character | undefined {
    if (charactersResourceState.status !== 'ready') return undefined
    const character = getSelectedCharacterOwner()
    if (!character?.chaId || charactersResourceState.rowStatuses[character.chaId] === 'error') return undefined
    return character
  }

  function openChatOnlyOwner(): boolean {
    return (
      settingsResourceState.status !== 'error' &&
      settingsResourceState.groupStatuses.display === 'ready' &&
      settingsResourceState.value.hypaV3ProgressOpenChatOnly === true
    )
  }

  const selectedCharacter = $derived(selectedCharacterOwner())
  const openChatId = $derived.by(() => {
    const chatId = resolveUniqueOpenChatId(selectedCharacter, characterRowsOwner())
    return chatId && getChatMetadataOwnerState(chatId)?.chatId === chatId ? chatId : null
  })
  const openChatOnly = $derived(openChatOnlyOwner())
  const progress = $derived(selectMemoryProgress($memoryJobProjectionStore, openChatId, openChatOnly))
  const groups: MemoryProgressGroup[] = $derived.by(() =>
    groupMemoryJobsForPresentation(progress.presentedJobs, openChatId, chatLabel),
  )

  function toggleExpand(): void {
    isExpanded = !isExpanded
  }

  function chatLabel(chatId: string): string {
    if (getChatMetadataOwnerState(chatId)?.chatId !== chatId) {
      return language.hypaV3Progress.unknownChat(shortJobId(chatId))
    }
    return resolveUniqueChatLabel(
      characterRowsOwner(),
      chatId,
      language.hypaV3Progress.unnamedChat,
      language.hypaV3Progress.unknownChat(shortJobId(chatId)),
    )
  }

  function kindLabel(kind: ServerMemoryJob['kind']): string {
    return language.hypaV3Progress.kind[kind]
  }

  function statusLabel(status: ServerMemoryJob['status']): string {
    return status === 'running' ? language.hypaV3Progress.running : language.hypaV3Progress.pending
  }

  function shortJobId(jobId: string): string {
    return jobId.length > 12 ? jobId.slice(-12) : jobId
  }
</script>

<div class="fixed top-4 right-4 z-40 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2">
  <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
    {language.hypaV3Progress.activeJobs(progress.activeCount)}
    {#if progress.backgroundCount > 0}
      {language.hypaV3Progress.activeInOtherChats(progress.backgroundCount)}
    {/if}
  </span>
  {#if isExpanded && progress.presentedCount > 0}
    <section
      class="pointer-events-auto flex max-h-[min(34rem,calc(100vh-2rem))] w-[min(30rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-darkborderc bg-darkbg shadow-xl">
      <button
        class="flex items-center justify-between gap-4 border-b border-darkborderc px-4 py-3 text-left"
        type="button"
        aria-label={language.hypaV3Progress.closeDetailsAction}
        aria-expanded="true"
        onclick={toggleExpand}>
        <span class="font-medium text-gray-200">
          {language.hypaV3Progress.activeJobs(progress.presentedCount)}
        </span>
        <span aria-hidden="true" class="text-gray-400">×</span>
      </button>
      <div class="min-w-0 overflow-y-auto p-4">
        {#each groups as group (group.chatId)}
          <div class="mb-4 min-w-0 last:mb-0">
            <h2 class="truncate text-sm font-semibold text-gray-200" title={group.label}>{group.label}</h2>
            <ul class="mt-2 flex flex-col gap-2">
              {#each group.jobs as job (job.instanceId)}
                <li class="min-w-0 rounded-sm border border-darkborderc bg-black/15 px-3 py-2 text-sm text-gray-300">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <span>{kindLabel(job.kind)} · {statusLabel(job.status)}</span>
                    <span class="text-xs text-gray-500">
                      {language.hypaV3Progress.attempt(job.attemptCount, job.maxAttempts)}
                    </span>
                  </div>
                  <div class="mt-1 truncate text-xs text-gray-500" title={job.id}>{shortJobId(job.id)}</div>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
        <div class="mt-3 h-2 overflow-hidden rounded-md border border-darkborderc bg-darkbg" aria-hidden="true">
          <div class="saving-animation h-full bg-linear-to-r from-blue-500 to-purple-800"></div>
        </div>
      </div>
    </section>
  {:else if progress.presentedCount > 0}
    <button
      class="pointer-events-auto flex h-12 min-w-12 items-center justify-center rounded-full bg-darkbg p-2 shadow-lg transition-opacity duration-300"
      type="button"
      aria-label={language.hypaV3Progress.openDetailsAction(progress.presentedCount)}
      aria-expanded="false"
      title={language.hypaV3Progress.activeJobs(progress.presentedCount)}
      onclick={toggleExpand}>
      <span class="relative flex h-8 w-8 items-center justify-center">
        <span class="absolute inset-0 animate-spin rounded-full border-t-2 border-red-500" aria-hidden="true"></span>
        <span class="text-xs text-gray-200">{progress.presentedCount}</span>
      </span>
    </button>
  {/if}

  {#if progress.backgroundCount > 0}
    <div
      class="pointer-events-none rounded-full border border-darkborderc bg-darkbg/90 px-3 py-1 text-xs text-gray-300 shadow-md"
      aria-label={language.hypaV3Progress.activeInOtherChats(progress.backgroundCount)}>
      {language.hypaV3Progress.otherChatsCompact(progress.backgroundCount)}
    </div>
  {/if}
</div>
