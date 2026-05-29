<!--
  A4R-group-chat-removed fixture (passing): the catalog renders a single character
  icon with no group branch. A benign `type === 'character'` comparison proves the
  rule keys on the 'group' literal, not on any `.type` comparison.
-->
<script lang="ts">
  let chars: { type: string; name: string }[] = []
</script>

{#each chars as char}
  <div>{char.name}</div>
  {#if char.type === 'character'}
    <User />
  {/if}
{/each}
