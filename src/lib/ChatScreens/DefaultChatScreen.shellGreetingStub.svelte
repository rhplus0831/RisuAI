<script lang="ts">
  // Faithful Chat.svelte stub for the BOOT-1 probe: it reads the same greeting
  // props the real Chat.svelte reads (altGreeting at Chat.svelte:1070-1071,
  // totalPages/currentPage at :1079). Reading them forces evaluation of the
  // parent's *lazy* prop expressions — which is exactly what triggers the
  // unguarded `alternateGreetings.length` read in DefaultChatScreen.svelte:1066/1090.
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
