<script lang="ts">
  import { language } from 'src/lang'
  import { getCharImage } from 'src/ts/characters'
  import GenerationIndicator from './GenerationIndicator.svelte'
  import SidebarAvatar from './SidebarAvatar.svelte'
  import type { PinnedChatItem } from './sidebarMultitasking'

  interface Props {
    items: readonly PinnedChatItem[]
    generatingChatIds: ReadonlySet<string>
    rounded: boolean
    onOpen: (item: PinnedChatItem) => void
  }

  let { items, generatingChatIds, rounded, onOpen }: Props = $props()
</script>

{#if items.length > 0}
  <nav
    class="flex max-h-[35%] w-full shrink-0 flex-col items-center gap-2 overflow-x-hidden overflow-y-auto border-b border-b-selected px-1 py-2"
    aria-label={language.pinnedChats}
    data-risu-pinned-chats>
    {#each items as item (`${item.characterId}:${item.chatId}`)}
      <div class="relative flex w-full flex-col items-center" data-risu-pinned-chat={item.chatId}>
        <SidebarAvatar
          src={item.characterImage ? getCharImage(item.characterImage, 'plain') : '/none.webp'}
          size="42"
          {rounded}
          name={`${item.characterName} · ${item.chatName}`}
          onClick={() => onOpen(item)} />
        <span class="mt-0.5 w-16 truncate text-center text-[10px] leading-tight text-textcolor2">
          {item.chatName}
        </span>
        {#if generatingChatIds.has(item.chatId)}
          <GenerationIndicator label={`${language.generatingMessage}: ${item.chatName}`} />
        {/if}
      </div>
    {/each}
  </nav>
{/if}
