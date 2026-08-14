<script lang="ts">
  import { language } from 'src/lang'
  import { getCharImage } from 'src/ts/characters'
  import { currentRoute } from 'src/ts/router'
  import GenerationIndicator from './GenerationIndicator.svelte'
  import UnreadIndicator from './UnreadIndicator.svelte'
  import SidebarAvatar from './SidebarAvatar.svelte'
  import type { PinnedChatItem } from './sidebarMultitasking'

  interface Props {
    items: readonly PinnedChatItem[]
    generatingChatIds: ReadonlySet<string>
    warningChatIds?: ReadonlySet<string>
    unreadChatIds?: ReadonlySet<string>
    rounded: boolean
    onOpen: (item: PinnedChatItem) => void
    isInert?: boolean
  }

  let {
    items,
    generatingChatIds,
    warningChatIds = new Set(),
    unreadChatIds = new Set(),
    rounded,
    onOpen,
    isInert = false,
  }: Props = $props()
</script>

{#if items.length > 0}
  <nav
    class="flex max-h-[35%] w-full shrink-0 flex-col items-center gap-2 overflow-x-hidden overflow-y-auto border-b border-b-selected px-1 py-2"
    aria-label={language.pinnedChats}
    inert={isInert}
    data-risu-pinned-chats>
    {#each items as item (`${item.characterId}:${item.chatId}`)}
      {@const isCurrent =
        $currentRoute.kind === 'character' &&
        $currentRoute.chaId === item.characterId &&
        $currentRoute.chatId === item.chatId}
      <div
        class="relative flex w-full flex-col items-center rounded-md"
        class:bg-selected={isCurrent}
        data-risu-pinned-chat={item.chatId}
        data-risu-pinned-chat-current={isCurrent ? 'true' : 'false'}>
        <SidebarAvatar
          src={item.characterImage ? getCharImage(item.characterImage, 'plain') : '/none.webp'}
          size="42"
          {rounded}
          name={`${item.characterName} · ${item.chatName}`}
          {isCurrent}
          onClick={() => onOpen(item)} />
        <span class="mt-0.5 w-16 truncate text-center text-[10px] leading-tight text-textcolor2">
          {item.chatName}
        </span>
        {#if warningChatIds.has(item.chatId)}
          <GenerationIndicator
            state="warning"
            label={language.generationReattachFailure.sidebarWarning(item.chatName)}
            onActivate={() => onOpen(item)} />
        {:else if generatingChatIds.has(item.chatId)}
          <GenerationIndicator
            label={`${language.generatingMessage}: ${item.chatName}`}
            onActivate={() => onOpen(item)} />
        {:else if unreadChatIds.has(item.chatId)}
          <UnreadIndicator label={`${language.newMessage}: ${item.chatName}`} onActivate={() => onOpen(item)} />
        {/if}
      </div>
    {/each}
  </nav>
{/if}
