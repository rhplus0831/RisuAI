<!--
  A4R-group-chat-removed fixture (keep-layers-removed-bypass): the UI branch is gone
  (negative half clean) so only the dropped defense layers fail.
-->
<script lang="ts">
  let chars: { type: string; name: string }[] = []
</script>

{#each chars as char}
  <div>{char.name}</div>
  <User />
{/each}
