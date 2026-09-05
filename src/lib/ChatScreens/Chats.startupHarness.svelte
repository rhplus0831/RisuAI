<script lang="ts">
  import Chats from './Chats.svelte'
  import { getCharacterResourceOwner } from '../../ts/server/resourceState.svelte'
  import { getChatMessageOwnerState } from '../../ts/server/chatMessageHydration.svelte'
  let { characterId, chatId }: { characterId: string; chatId: string } = $props()
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
    loadPages={6}
    rerollTarget={null}
    onReroll={() => {}}
    unReroll={() => {}}
    onNewReroll={() => {}}
    onSelectRerollCandidate={() => {}} />
{/if}
