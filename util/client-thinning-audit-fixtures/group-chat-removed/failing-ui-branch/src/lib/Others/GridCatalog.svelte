<!--
  A4R-group-chat-removed fixture (failing): the catalog reintroduces a group-chat UI
  branch in a markup `{#if}` logic block.
-->
<script lang="ts">
  let chars: { type: string; name: string }[] = []
</script>

{#each chars as char}
  <div>{char.name}</div>
  {#if char.type === 'group'}
    <Users />
  {:else}
    <User />
  {/if}
{/each}
