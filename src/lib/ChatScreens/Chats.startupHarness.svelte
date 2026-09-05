<script lang="ts">
  import Chats from './Chats.svelte'
  import { getCharacterResourceOwner } from '../../ts/server/resourceState.svelte'
  import { getChatMessageOwnerState } from '../../ts/server/chatMessageHydration.svelte'
  let { characterId, chatId, loadPages = 6 }: { characterId: string; chatId: string; loadPages?: number } = $props()
  export function setLoadPages(value: number) {
    loadPages = value
  }
  const character = $derived(getCharacterResourceOwner(characterId))
  const messages = $derived(getChatMessageOwnerState(chatId)?.messages ?? [])
</script>

{#if character}
  <Chats
    {chatId}
    currentCharacter={character}
    {messages}
    currentUsername="User"
    userIcon=""
    {loadPages}
    rerollTarget={null}
    onReroll={() => {}}
    unReroll={() => {}}
    onNewReroll={() => {}}
    onSelectRerollCandidate={() => {}} />
{/if}
