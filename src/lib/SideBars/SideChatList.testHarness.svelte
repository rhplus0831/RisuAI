<script lang="ts">
  import SideChatList from './SideChatList.svelte'
  import { charactersResourceState, getCharacterResourceOwner } from 'src/ts/server/resourceState.svelte'

  let selectedOwner = $derived.by(() => {
    if (charactersResourceState.status !== 'ready') return undefined
    const candidate = charactersResourceState.characters[charactersResourceState.currentChar]
    return candidate?.chaId ? getCharacterResourceOwner(candidate.chaId) : undefined
  })
</script>

{#if selectedOwner}
  <SideChatList chara={selectedOwner} />
{/if}
