<script lang="ts">
  // Reads the greeting props the real Chat component consumes, forcing evaluation
  // of the parent's lazy prop expressions in the shell-greeting regression test.
  let {
    idx = -1,
    message = '',
    msgDisplay = '',
    altGreeting = false,
    currentPage = 1,
    totalPages = 1,
  }: {
    idx?: number
    message?: string
    msgDisplay?: string
    altGreeting?: boolean
    currentPage?: number
    totalPages?: number
  } = $props()
</script>

<div class="risu-chat" data-chat-index={idx}>
  {message || msgDisplay}
  {#if altGreeting}
    <span class="greeting-nav">{currentPage}/{totalPages}</span>
  {/if}
</div>
